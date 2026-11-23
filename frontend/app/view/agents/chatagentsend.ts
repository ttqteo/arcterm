// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sender's side of a message between two agents, as Chat reads it from the sender's own tool calls: a
// `wsh agents send <tab> …` call is the message it sent (its text from the argument, or from the file `--file` names,
// as a Write in the same conversation wrote it), and the answer is what `wsh agents send … --wait` or
// `wsh agents read <tab>` printed, in the call's own output or, for a call run in the background, in the Read of the
// file Claude Code wrote that output to. Pure; chatmodel.ts places the parts, chatagentsendcard.tsx draws them.

/** A message this agent sent another with `wsh agents send`. */
export interface AgentSend {
    /** the tab as the call named it: an id or a unique prefix of one */
    tab: string;
    /** the message as sent: the argument, or the file's text when a Write in the conversation holds it */
    text?: string;
    /** the file `--file` named */
    file?: string;
    /** what the send did, from its output; absent while it runs in the background */
    how?: "started" | "joined";
    /** why the send failed: its error line */
    failed?: string;
}

/** What the other agent answered, as a `--wait` or a `wsh agents read` printed it. */
export interface AgentAnswer {
    tab: string;
    /** the answer, or the line saying the target waits on its user */
    text: string;
}

// `wsh agents send` or `wsh agents read`, the binary spelled any way (`wsh`, `~/.arc/bin/wsh`, `"C:/…/wsh.exe"`)
const AGENTS_CALL = /(?:^|[\s/\\"'`;&|(])wsh(?:\.exe)?["']?\s+agents\s+(send|read)(?=\s)/g;

// a heredoc fed through `$(cat <<'EOF' … EOF)`, the way an agent passes a long argument: its body is the argument
const HEREDOC = /^\$\(\s*cat\s+<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*\n?\s*\)/;

/** Pure: the words of a shell command from `at` to the end of that command (an unquoted newline, `;`, `&&`, `||` or
 *  `|`), with quotes and escapes taken off and a `$(cat <<'EOF' …)` heredoc read as its body. Only as much shell as an
 *  agent's call spells: no variables, no globs. */
export function shellWords(command: string, at = 0): string[] {
    const words: string[] = [];
    let word: string | null = null;
    const push = (s: string) => {
        word = (word ?? "") + s;
    };
    let i = at;
    while (i < command.length) {
        const c = command[i];
        if (c === "\\" && i + 1 < command.length) {
            // a line continuation joins the lines; any other escaped character is itself
            if (command[i + 1] !== "\n") {
                push(command[i + 1]);
            }
            i += 2;
            continue;
        }
        if (c === " " || c === "\t") {
            if (word != null) {
                words.push(word);
                word = null;
            }
            i++;
            continue;
        }
        if (c === "\n" || c === ";" || c === "|" || (c === "&" && command[i + 1] === "&")) {
            break;
        }
        if (c === "'") {
            const end = command.indexOf("'", i + 1);
            push(command.slice(i + 1, end < 0 ? command.length : end));
            i = end < 0 ? command.length : end + 1;
            continue;
        }
        const inQuotes = c === '"';
        const heredoc = HEREDOC.exec(command.slice(inQuotes ? i + 1 : i));
        if (heredoc != null) {
            push(heredoc[3]);
            i += (inQuotes ? 1 : 0) + heredoc[0].length;
            if (inQuotes && command[i] === '"') {
                i++;
            }
            continue;
        }
        if (inQuotes) {
            let j = i + 1;
            let s = "";
            while (j < command.length && command[j] !== '"') {
                if (command[j] === "\\" && '"\\$`'.includes(command[j + 1] ?? "")) {
                    s += command[j + 1];
                    j += 2;
                    continue;
                }
                s += command[j];
                j++;
            }
            push(s);
            i = j + 1;
            continue;
        }
        push(c);
        i++;
    }
    if (word != null) {
        words.push(word);
    }
    return words;
}

interface AgentsCall {
    verb: "send" | "read";
    tab: string;
    text?: string;
    file?: string;
    wait: boolean;
}

// the flags of `wsh agents send` / `read` that take a value
const VALUE_FLAGS = new Set(["--file", "--timeout", "-b", "--block"]);

/** Pure: the first `wsh agents send` or `wsh agents read` the command makes, with its arguments; null when it makes
 *  none, or names no tab. */
export function agentsCall(command: string): AgentsCall | null {
    AGENTS_CALL.lastIndex = 0;
    const m = AGENTS_CALL.exec(command);
    if (m == null) {
        return null;
    }
    const verb = m[1] as "send" | "read";
    const words = shellWords(command, m.index + m[0].length);
    const plain: string[] = [];
    let file: string | undefined;
    let wait = false;
    for (let k = 0; k < words.length; k++) {
        const w = words[k];
        if (w === "--wait") {
            wait = true;
        } else if (w.startsWith("--file=")) {
            file = w.slice("--file=".length);
        } else if (VALUE_FLAGS.has(w)) {
            if (w === "--file") {
                file = words[k + 1];
            }
            k++;
        } else if (w.startsWith("-") && w.length > 1) {
            // another flag (--timeout=5m, --json)
        } else {
            plain.push(w);
        }
    }
    const tab = plain[0];
    if (tab == null || tab === "") {
        return null;
    }
    return {
        verb,
        tab,
        wait,
        ...(verb === "send" && plain[1] != null ? { text: plain[1] } : {}),
        ...(verb === "send" && file != null && file !== "" ? { file } : {}),
    };
}

// what a send prints first (cmd/wsh/cmd/wshcmd-agents.go agentsSendLines)
const SENT_LINE = /^sent to \S+: it (started a turn|joined the turn)/m;
const READ_HINT = /^read the answer with: wsh agents read \S+[ \t]*$/m;
// what `wsh agents wait` prints when the agent stops (agentsWaitFor), which a "wait, then read" command prints first
const WAIT_LINE = /^\S+ \(.*\) (?:closed|is asleep|stopped working: it is \S+|is waiting on the user: .*)$/;
const NOT_ANSWERED = /^\S+ has not answered yet \(state: [^)]*\)\s*$/;
const WAITING_ON_USER = /^\S+ is waiting on the user: /;
// what Claude Code says of a call it ran in the background
const BACKGROUND = /Output is being written to: (\S[^\n]*?\.output)\b/;

/** Pure: the message a Bash call sent, or null when it is no `wsh agents send`. `exit` is the call's exit code (null:
 *  it never ran). A call that runs in the background has not said yet what the send did. */
export function agentSendOf(command: string, output: string, exit: number | null): AgentSend | null {
    const call = agentsCall(command);
    if (call == null || call.verb !== "send" || exit === null) {
        return null;
    }
    const send: AgentSend = {
        tab: call.tab,
        ...(call.text != null ? { text: call.text } : {}),
        ...(call.file != null ? { file: call.file } : {}),
    };
    const sent = SENT_LINE.exec(output);
    if (sent != null) {
        send.how = sent[1] === "started a turn" ? "started" : "joined";
    } else if (exit !== 0 && !BACKGROUND.test(output)) {
        const line = output
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l !== "" && !/^Exit code \d+$/.test(l));
        send.failed = (line ?? "failed").replace(/^Error:\s*/, "");
    }
    return send;
}

/** Pure: the file a Bash call run in the background writes its output to, when the call is a `wsh agents send --wait`
 *  or a `wsh agents read`, whose answer that file will hold; null for any other call. */
export function answerFileOf(command: string, output: string): string | null {
    const call = agentsCall(command);
    if (call == null || (call.verb === "send" && !call.wait)) {
        return null;
    }
    return BACKGROUND.exec(output)?.[1].trim() ?? null;
}

/** Pure: the answer what a `wsh agents send --wait` or `wsh agents read` printed holds, or null when it holds none (a
 *  plain send, a read that found no answer yet, a call still running in the background). */
export function agentAnswerOf(command: string, output: string): AgentAnswer | null {
    const call = agentsCall(command);
    if (call == null || (call.verb === "send" && !call.wait) || BACKGROUND.test(output)) {
        return null;
    }
    let text = output.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
    if (call.verb === "send") {
        const hint = READ_HINT.exec(text);
        if (hint == null) {
            return null;
        }
        text = text.slice(hint.index + hint[0].length);
    }
    const lines = text.replace(/^\s*\n/, "").split("\n");
    while (lines.length > 0 && WAIT_LINE.test(lines[0].trim()) && !WAITING_ON_USER.test(lines[0].trim())) {
        lines.shift();
    }
    const answer = lines.join("\n").trim();
    if (answer === "" || NOT_ANSWERED.test(answer)) {
        return null;
    }
    return { tab: call.tab, text: answer };
}

/** Pure: a file's text as Claude Code's Read gave it, without the line numbers it puts before each line. */
export function readText(snippet: string): string {
    return snippet
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
        .split("\n")
        .map((l) => l.replace(/^\s*\d+(?:\t|→)/, ""))
        .join("\n")
        .trim();
}

/** Pure: a path compared as Windows and Git Bash both spell it: forward slashes, no case, `/c/` read as `c:/`. */
export function pathKey(p: string): string {
    return p
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/([a-zA-Z])\//, "$1:/")
        .toLowerCase();
}

/** Pure: whether `named` (as a command spelled it, maybe relative) is the file at `known` (as a tool call spelled it). */
export function samePath(named: string, known: string): boolean {
    const a = pathKey(named).replace(/^\.\//, "");
    const b = pathKey(known);
    return a === b || b.endsWith("/" + a) || a.endsWith("/" + b);
}
