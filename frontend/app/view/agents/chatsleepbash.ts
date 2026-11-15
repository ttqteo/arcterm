// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A `! cmd` typed to a sleeping agent runs without waking it (wavesrv's ShellRunCommand, in the agent's folder), so a
// quick `git status` costs no relaunch. Chat draws the run under the conversation as the `!` row it would have been, and
// what it printed rides in front of the next message you send, which is the one that wakes the agent: it reads the
// commands and their output as it would have read them had it run them awake. A run that failed offers Ask agent to fix,
// a message of its own that wakes the agent with it. Pure; the per-agent list is chatsleepbashstore.ts's.
//
// On the wire a run is one block, several in the order they ran, then one blank line and the message (withResultLines):
//
//   <arc-asleep-bash exit="1">
//   <command>npm test</command>
//   <stdout>…</stdout>
//   <stderr>…</stderr>
//   </arc-asleep-bash>
//
// Chat strips the blocks from the bubble (stripResultLines) and draws each as a `!` row over it (chatmodel.ts). Its own
// tags, not Claude Code's <bash-input>/<bash-stdout>: the transcript projection reads those as a bash-mode record.

import type { ShellResult } from "./agentsviewmodel";
import { unwrapWholePaste } from "./chattagblocks";

/** How a run ended: its exit code, or "timeout" when it was stopped at the server's 2-minute limit. */
export type RunExit = number | "timeout";

/** A run that finished, as it rides a message and comes back out of the transcript. */
export interface CarriedRun {
    command: string;
    stdout: string;
    stderr: string;
    exit: RunExit;
}

/** A run in the agent's list: `result` once it finished, `error` when it could not run at all (no shell, the folder
 *  gone), neither while it runs. Only a run with a result rides a message. */
export interface SleepRun {
    id: string;
    command: string;
    cwd: string;
    at: number;
    result?: CarriedRun & { truncated?: boolean; durMs?: number };
    error?: string;
}

/** Pure: whether Chat runs `text` itself instead of waking the agent with it: a `!` command with something after the
 *  `!`, to a sleeping agent, with no files attached (a file rides a message, which is the agent's to read). */
export function runsAsleep(text: string, asleep: boolean, attachments: number): boolean {
    return asleep && attachments === 0 && text.startsWith("!") && text.slice(1).trim() !== "";
}

/** Pure: the command of a `! cmd` as it runs: the text after the `!`, its edges trimmed. */
export function asleepCommand(text: string): string {
    return text.slice(1).trim();
}

/** Pure: the run's exit as the block writes it. */
function exitAttr(exit: RunExit): string {
    return exit === "timeout" ? "timeout" : String(exit);
}

/** Pure: one run as the block that rides a message. */
export function runBlock(run: CarriedRun): string {
    return [
        `<arc-asleep-bash exit="${exitAttr(run.exit)}">`,
        `<command>${run.command}</command>`,
        `<stdout>${run.stdout}</stdout>`,
        `<stderr>${run.stderr}</stderr>`,
        `</arc-asleep-bash>`,
    ].join("\n");
}

/** Pure: the finished runs (oldest first) as the blocks to put in front of a message; a run still going or one that
 *  could not run is left out. */
export function runBlocks(runs: readonly SleepRun[]): string[] {
    return runs.filter((r) => r.result != null).map((r) => runBlock(r.result!));
}

const BLOCK =
    /^<arc-asleep-bash exit="([^"]*)">\n<command>([^]*?)<\/command>\n<stdout>([^]*?)<\/stdout>\n<stderr>([^]*?)<\/stderr>\n<\/arc-asleep-bash>(?:\n|$)/;

function parseExit(s: string): RunExit {
    if (s === "timeout") {
        return "timeout";
    }
    const n = Number(s);
    return Number.isInteger(n) ? n : -1;
}

/** Pure: the runs a message carries in front of it and the message after them and the one blank line that follows.
 *  Claude Code wraps a whole multi-line message as one pasted block, so a text that does not start with a block is
 *  read as that paste first. No runs leave `body` as the text was. */
export function splitSleepRuns(text: string): { runs: CarriedRun[]; body: string } {
    let rest = text.replace(/\r\n/g, "\n");
    if (!rest.startsWith("<arc-asleep-bash ")) {
        const unwrapped = unwrapWholePaste(rest).replace(/\r\n/g, "\n");
        if (!unwrapped.startsWith("<arc-asleep-bash ")) {
            return { runs: [], body: text };
        }
        rest = unwrapped;
    }
    const runs: CarriedRun[] = [];
    for (let m = BLOCK.exec(rest); m != null; m = BLOCK.exec(rest)) {
        runs.push({ exit: parseExit(m[1]), command: m[2], stdout: m[3], stderr: m[4] });
        rest = rest.slice(m[0].length);
    }
    if (runs.length === 0) {
        return { runs: [], body: text };
    }
    return { runs, body: rest.startsWith("\n") ? rest.slice(1) : rest };
}

/** Pure: whether a finished run failed: a nonzero exit, or stopped at the timeout. */
export function runFailed(run: Pick<CarriedRun, "exit">): boolean {
    return run.exit !== 0;
}

/** Pure: the row's status line: "exit 1 · 2.3s", "stopped after 2 min", "exit 0". */
export function runStatus(run: Pick<CarriedRun, "exit"> & { durMs?: number }): string {
    if (run.exit === "timeout") {
        return "Stopped after 2 min";
    }
    const dur =
        run.durMs == null ? "" : ` · ${run.durMs < 1000 ? `${run.durMs}ms` : `${(run.durMs / 1000).toFixed(1)}s`}`;
    return `exit ${run.exit}${dur}`;
}

/** Pure: what the row draws under the command, as a bash-mode record's output draws. */
export function runShell(run: Pick<CarriedRun, "stdout" | "stderr">): ShellResult {
    return { output: run.stdout.replace(/\n$/, ""), error: run.stderr.replace(/\n$/, "") };
}

/** Pure: the message Ask agent to fix sends behind the runs: it names the failed command, since several may ride. */
export function fixMessage(run: Pick<CarriedRun, "command" | "exit">): string {
    const how = run.exit === "timeout" ? "ran past the 2-minute limit and was stopped" : `failed with exit ${run.exit}`;
    return `\`${run.command}\` ${how} while you were asleep. Find out why and fix it.`;
}
