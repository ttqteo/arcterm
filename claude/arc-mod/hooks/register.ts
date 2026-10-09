// arcterm's Claude Code mod. `wsh install-agent-hooks` writes it to ~/.arc/claude-mod with the wsh path
// substituted and lists that folder in CLAUDE_CODE_PLUGIN_DIRS, so every claude launch loads it.
// outside an arcterm block every hook passes straight through.
import type { EngineInterface, Register } from "claude-code";
import type { AskQuestion } from "./ask-core";
import { askPayload, cardAnswer, cardCanAsk, parseAskReply } from "./ask-core";
import { controlMsg, deliver, endTurn, steerNotice, takeLines } from "./control-core";
import type { Turn } from "./control-core";
import { denial } from "./guard-core";
import { jobslotArgs, jobslotLine } from "./jobslot-core";
import { idleArgs } from "./status-core";
import { usageArgs } from "./usage-core";

const WSH = "__WSH_PATH__";

// set at session.start; a reload runs register and session.start again, so it never goes stale
let active = false;

// the session's transcript, as its latest prompt named it; a status report carries it so a cockpit
// that replays the report still follows the file. null after a reload until the next prompt
let transcriptPath: string | null = null;

// the line under claude's dialog while the card asks beside it
const ALSO_ON_CARD = "Also answerable in arcterm's ask card";

// the calls the card races claude's dialog for. one predicate for both hooks below, so the settings
// hooks are skipped exactly where the mod has a card up
function racesCard(questions: readonly AskQuestion[]): boolean {
    return active && cardCanAsk(questions);
}

// the tool_use_ids of the calls the card is racing right now, so the PostToolUse hook below knows them
const racing = new Set<string>();

// ponytail: turn.start does not say whose turn it is, so a background subagent starting one while the
// session is idle reads as open, and a mid-turn text sent then waits for the next turn. track turn ids
// against turn.step's agentId if that ever loses a tell
const turn: Turn = { isOpen: false, unread: [] };

// true while the cockpit's prompt stream is held, so a second session.start (a /clear) opens no second one
let listening = false;

// holds `wsh agentctl` for the session's life and runs each prompt the cockpit sends, so the engine need
// not type into the terminal. when the stream ends the engine goes back to typing
async function listenToCockpit($: EngineInterface) {
    if (listening) {
        return;
    }
    listening = true;
    const session = {
        // asUser: the model reads the engine's or the person's words bare, not as a note from a plugin
        submit: (text: string) => $.prompt.submit({ text, asUser: true }),
        steer: (text: string) => steerTurn($, text),
        command: (name: string, args: string) => $.command.run({ command: name, args }),
        compact: (instructions: string) => $.session.compact({ instructions }),
    };
    let buffered = "";
    try {
        for await (const chunk of $.process.spawn({ argv: [WSH, "agentctl"] })) {
            if (chunk.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + chunk.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const msg = controlMsg(line);
                if (msg === null) {
                    continue;
                }
                // not awaited: a prompt resolves only when its turn starts, and the next line may be due first
                void deliver(session, msg, turn).catch((err) =>
                    $.ui.log(`arc: running the cockpit's prompt failed: ${String(err)}`, { to: "debug" })
                );
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh agentctl failed: ${String(err)}`, { to: "debug" });
    } finally {
        listening = false;
    }
}

// appends text to the running turn as a row the model reads at its next request. that row draws nothing,
// so a log line the model never reads shows the person what arrived
async function steerTurn($: EngineInterface, text: string) {
    const kept = await $.session.append({ message: { type: "user", content: [{ type: "text", text }] } });
    if (kept.deny !== undefined) {
        throw new Error(kept.deny);
    }
    $.ui.log(steerNotice(text));
}

// why this session may not run the shell command; null when it may, and always outside arcterm
async function refusal($: EngineInterface, command: string): Promise<string | null> {
    return active ? denial(command, await $.session.cwd()) : null;
}

// a heavy command (a build, the typecheck, a whole test suite) waits for its turn in arcterm's job queue, and
// holds the slot while it runs: `wsh jobslot` stays alive until this ends its stream, which kills it and
// frees the slot. the stream's loop is the child's life, so this holds the iterator open across run(). its
// queued lines show here meanwhile, and a refusal (the person skipped it on the card) denies the command.
// any failure of wsh's lets the command run. spawn, not run: run gives up after ten minutes, and a queue
// can wait longer
async function withJobSlot<T>(
    $: EngineInterface,
    command: string,
    run: () => Promise<T>
): Promise<T | { deny: string }> {
    if (!active) {
        return run();
    }
    const stream = $.process.spawn({ argv: [WSH, ...jobslotArgs(command)] });
    let buffered = "";
    let denied: string | null = null;
    try {
        wait: for (;;) {
            const step = await stream.next();
            if (step.done) {
                break;
            }
            if (step.value.stream !== "stdout") {
                continue;
            }
            const taken = takeLines(buffered + step.value.text);
            buffered = taken.rest;
            for (const line of taken.lines) {
                const read = jobslotLine(line);
                if (read && "hold" in read) {
                    $.ui.log(`arc: ${read.hold}`);
                } else if (read) {
                    denied = read.refusal;
                    break wait;
                }
            }
        }
    } catch (err) {
        $.ui.log(`arc: wsh jobslot failed: ${String(err)}`, { to: "debug" });
    }
    try {
        return denied !== null ? { deny: denied } : await run();
    } finally {
        // ending the stream kills wsh, and the server's waiter cancel frees the slot. a no-op once wsh has exited
        await stream.return(undefined as never).catch(() => undefined);
    }
}

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        active = Boolean((await $.env.get("WAVETERM_BLOCKID")) && (await $.env.get("WAVETERM_JWT")));
        const started = await next(e);
        if (active) {
            void listenToCockpit($);
        }
        return started;
    });

    on("session.measure", async ($, e, next) => {
        const args = active ? usageArgs(e) : null;
        if (args) {
            try {
                const ran = await $.process.run([WSH, ...args]);
                if (ran.exitCode !== 0) {
                    $.ui.log(`arc: wsh agentstatus --usage exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
                }
            } catch (err) {
                // a dropped measurement self-heals on the next one, as a dropped statusLine publish did
                $.ui.log(`arc: wsh agentstatus --usage failed: ${String(err)}`, { to: "debug" });
            }
        }
        return next(e);
    });

    on("classic.UserPromptSubmit", ($, e, next) => {
        transcriptPath = e.transcript_path || null;
        return next(e);
    });

    on("turn.start", ($, e, next) => {
        turn.isOpen = true;
        return next(e);
    });

    // a tool's result means another request follows, and it carries every row joined so far.
    // ponytail: a text joined between the last result and a final answer's request is read and then
    // submitted again at the turn's end; twice beats never
    on("session.append", { door: "tool-result" }, ($, e, next) => {
        if (!e.agentId) {
            turn.unread = [];
        }
        return next(e);
    });

    on("turn.complete", async ($, e, next) => {
        for (const text of e.agentId ? [] : endTurn(turn)) {
            void $.prompt.submit({ text, asUser: true }).catch((err) =>
                $.ui.log(`arc: submitting an unread mid-turn text failed: ${String(err)}`, { to: "debug" })
            );
        }
        const args = active ? idleArgs(e, transcriptPath) : null;
        if (args) {
            try {
                const ran = await $.process.run([WSH, ...args]);
                if (ran.exitCode !== 0) {
                    $.ui.log(`arc: wsh agentstatus --state idle exited ${ran.exitCode}: ${ran.stderr.trim()}`, { to: "debug" });
                }
            } catch (err) {
                // the idle notification still corrects the cockpit, later
                $.ui.log(`arc: wsh agentstatus --state idle failed: ${String(err)}`, { to: "debug" });
            }
        }
        return next(e);
    });

    // refused in code: a prompt's rule is one the model can talk itself out of
    on("tool.call", { tool: "Bash" }, async ($, e, next) => {
        const why = await refusal($, e.command);
        return why === null ? withJobSlot($, e.command, () => next(e)) : { deny: why };
    });

    on("tool.call", { tool: "PowerShell" }, async ($, e, next) => {
        const why = await refusal($, e.command);
        return why === null ? withJobSlot($, e.command, () => next(e)) : { deny: why };
    });

    // claude's own dialog asks in the terminal while the cockpit card asks beside it, and the first answer
    // wins. a hook that settles before next(e) takes the dialog down (probed on 2.1.291), so the terminal
    // is always claude's current dialog, previews and all, and the mod draws no picker of its own
    on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
        if (!racesCard(e.questions)) {
            return next(e);
        }
        if (e.tool_use_id) {
            $.ui.notice(e.tool_use_id, ALSO_ON_CARD);
            racing.add(e.tool_use_id);
        }
        // spawn, not run: run gives up after ten minutes, and a question can wait longer
        const wait = $.process.spawn({ argv: [WSH, "ask", "--wait"], input: askPayload(e.questions) });
        const fromCard = (async () => {
            let out = "";
            try {
                for await (const chunk of wait) {
                    if (chunk.stream === "stdout") {
                        out += chunk.text;
                    }
                }
            } catch (err) {
                $.ui.log(`arc: wsh ask --wait failed: ${String(err)}`, { to: "debug" });
            }
            return parseAskReply(out);
        })();
        const fromDialog = next(e);
        try {
            const first = await Promise.race([
                fromDialog.then((result) => ({ isDialog: true as const, result })),
                fromCard.then((reply) => ({ isDialog: false as const, reply })),
            ]);
            if (first.isDialog) {
                return first.result;
            }
            const answer = cardAnswer(e.questions, first.reply);
            if (answer) {
                return answer;
            }
        } finally {
            if (e.tool_use_id) {
                racing.delete(e.tool_use_id);
            }
            // answered or dismissed in the terminal: ending the stream kills wsh, and the server's waiter
            // cancel takes the card down. a no-op once wsh has exited
            void wait.return(undefined as never).catch(() => undefined);
        }
        // wsh failed or hit its 30-minute ceiling: take the card down, and the dialog still up answers alone
        try {
            await $.process.run([WSH, "ask", "--clear"]);
        } catch (err) {
            $.ui.log(`arc: wsh ask --clear failed: ${String(err)}`, { to: "debug" });
        }
        return fromDialog;
    });

    // the settings hooks arcterm installs for AskUserQuestion project a keystroke-answered card of their own
    // (`wsh ask`), which would stand over the one the call above is waiting on. answering here without
    // next(e) skips every settings PreToolUse hook beneath, so the call goes on to its dialog
    on("classic.PreToolUse", { tool: "AskUserQuestion" }, ($, e, next) => (racesCard(e.questions) ? {} : next(e)));

    // an answer in claude's dialog runs the PostToolUse hooks inside the tool.call's next(e), before it
    // resolves, and both settings hooks there cancel the card's waiter: `wsh ask --clear` directly, and
    // agent-hook's working report through the server's retire-on-resume. the card then won the race with a
    // cancel, and a pick in the terminal came back as "The user dismissed the question." skipping them for a
    // raced call leaves the dialog's answer to win; tool.call's own teardown takes the card down
    on("classic.PostToolUse", { tool_name: "AskUserQuestion" }, ($, e, next) =>
        racing.has(e.tool_use_id) ? {} : next(e)
    );
};
