// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The step line of one tool call in Chat (chatstepsview.tsx): an icon, a verb ("Read", "Edit", "Ran", "Search"…) and a chip
// for each thing the call touched, `+N` past the third. One step per call, as WorkItem.actions holds them (compacttimeline.ts),
// built only from the transcript entry, with no Thought lines (the projection skips thinking blocks). stepRows folds a run of
// calls with the same verb on the same one file into one line ("Edit a.ts ×4"), which opens to its calls. Pure.

import type { AgentActionEntry } from "./agentsviewmodel";
import { inFlight } from "./compacttimeline";

/** A line shows at most this many chips; the rest of what the call touched is its `more`. */
export const MAX_STEP_CHIPS = 3;

// a command or pattern past this is cut with an ellipsis (the chip truncates by width too; this keeps the DOM small)
const MAX_CHIP_TEXT = 160;

export type StepIcon =
    | "read"
    | "edit"
    | "write"
    | "run"
    | "search"
    | "find"
    | "web"
    | "spawn"
    | "skill"
    | "ask"
    | "blocked"
    | "tool";

// a command its call described ("Confirmed the server is no longer running") is a "description": the line shows those words
// in place of the verb and the command, and the command shows when the line opens
export type StepChip =
    | { kind: "file"; path: string }
    | { kind: "command"; text: string }
    | { kind: "description"; text: string; command: string }
    | { kind: "text"; text: string };

export interface Step {
    verb: string; // "" for a described command: its description says what it did
    icon: StepIcon;
    chips: StepChip[]; // at most MAX_STEP_CHIPS
    more: number; // the things the call touched past the chips shown
    running: boolean; // its result has not landed in a session that is working
}

// the verbs the transcripts write (lower case: transcriptprojection.ts VERB_BY_TOOL and the codex / pi / opencode ones),
// each with its icon and the word the line shows; any other verb keeps its own name
const KNOWN: Record<string, { verb: string; icon: StepIcon }> = {
    read: { verb: "Read", icon: "read" },
    edited: { verb: "Edit", icon: "edit" },
    wrote: { verb: "Write", icon: "write" },
    ran: { verb: "Ran", icon: "run" },
    grep: { verb: "Search", icon: "search" },
    glob: { verb: "Find", icon: "find" },
    webfetch: { verb: "Fetch", icon: "web" },
    websearch: { verb: "Web search", icon: "web" },
    spawned: { verb: "Spawned", icon: "spawn" },
    skill: { verb: "Skill", icon: "skill" },
    asked: { verb: "Asked", icon: "ask" },
    blocked: { verb: "Blocked", icon: "blocked" },
};

/** Pure: a verb we have no word for, as the line says it: "run_command" → "Run command". */
export function plainVerb(verb: string): string {
    const words = verb.replace(/[_-]+/g, " ").trim();
    return words === "" ? "Tool" : words[0].toUpperCase() + words.slice(1);
}

/** Pure: the first non-empty line of a command, cut at MAX_CHIP_TEXT. */
export function firstLine(text: string): string {
    const line =
        text
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l !== "") ?? "";
    return line.length > MAX_CHIP_TEXT ? `${line.slice(0, MAX_CHIP_TEXT - 1)}…` : line;
}

// "path:line" (or "path:line:col") as a grep hit's loc reads, to the path; a Windows drive's colon is not followed by digits
const LOC_TAIL = /:\d+(?::\d+)?$/;

/** Pure: each distinct file of a search's hits, in order of its first hit. A hit with no location (a line of output that is
 *  no "path:line") names nothing. */
function hitFiles(matches: { loc: string }[]): string[] {
    const out: string[] = [];
    for (const m of matches) {
        const path = m.loc.replace(LOC_TAIL, "");
        if (path !== "" && !out.includes(path)) {
            out.push(path);
        }
    }
    return out;
}

function distinct(paths: string[]): string[] {
    return [...new Set(paths.filter((p) => p !== ""))];
}

/** Pure: a command call's chip. `command` is the command line when the projection knows it apart from the target (the
 *  bash detail's once the result lands, or the action's own `command` before then); a target that differs from it is the
 *  call's description. With no command known the target is the command itself (pi, codex and opencode set it so). */
function commandChips(target: string, command: string | undefined): StepChip[] {
    const cmd = (command ?? "").trim();
    if (cmd !== "" && target !== "" && target !== cmd) {
        return [{ kind: "description", text: firstLine(target), command: cmd }];
    }
    const line = firstLine(cmd !== "" ? cmd : target);
    return line !== "" ? [{ kind: "command", text: line }] : [];
}

/** Pure: everything the call touched, as chips in the order it names them (before the cut at MAX_STEP_CHIPS). */
export function chipsOf(a: AgentActionEntry): StepChip[] {
    const target = a.target.trim();
    const d = a.detail;
    // an edit names its files: one chip each (a call may touch several: codex and pi project a multi-file patch)
    if (d?.kind === "edit") {
        const files = distinct(d.files.map((f) => f.path));
        if (files.length > 0) {
            return files.map((path) => ({ kind: "file", path }));
        }
    }
    // a search with hits names the files that matched, a search without any the pattern it looked for
    if (d?.kind === "grep") {
        const files = hitFiles(d.matches);
        if (files.length > 0) {
            return files.map((path) => ({ kind: "file", path }));
        }
    }
    // a command: by its description when the call gave one, else by its first line
    if (d?.kind === "bash" || a.verb === "ran") {
        return commandChips(target, d?.kind === "bash" ? (d.command ?? a.command) : a.command);
    }
    if (a.path != null && a.path !== "") {
        return [{ kind: "file", path: a.path }];
    }
    if (target === "") {
        return [];
    }
    // a file tool whose transcript gave no full path: the name it did give
    if (a.verb === "read" || a.verb === "edited" || a.verb === "wrote") {
        return [{ kind: "file", path: target }];
    }
    return [{ kind: "text", text: firstLine(target) }];
}

/** Pure: how long a running step has gone, in whole seconds so it ticks without a decimal: "12s", "3m 5s", "2m". */
export function stepElapsed(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s < 60 ? `${s}s` : s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s / 60}m`;
}

/** Pure: the lines an edit call added and removed, over its files; null for a call with no edit detail (yet). */
export function editCounts(action: AgentActionEntry): { adds: number; dels: number } | null {
    const d = action.detail;
    if (d?.kind !== "edit" || d.files.length === 0) {
        return null;
    }
    return d.files.reduce((n, f) => ({ adds: n.adds + f.adds, dels: n.dels + f.dels }), { adds: 0, dels: 0 });
}

// the file tools a run of calls folds for: the same verb on the same file again and again is the agent working one file
const FOLDS = new Set(["read", "edited", "wrote"]);

/** Pure: what a call folds by, or null when it stands alone: a call that failed or was blocked keeps its own line, so its
 *  red or its refusal is never hidden inside a fold. */
function foldKey(a: AgentActionEntry): string | null {
    if (!FOLDS.has(a.verb) || a.outcome === "fail" || a.outcome === "blocked") {
        return null;
    }
    const chips = chipsOf(a);
    if (chips.length !== 1 || chips[0].kind !== "file") {
        return null;
    }
    return `${a.verb}\n${chips[0].path.replace(/\\/g, "/")}`;
}

/** One line of a stretch: one call, or a run of calls folded. `start` is the first call's position in the stretch, so the
 *  line keeps its key as the run grows (actions are append-only). */
export interface StepRow {
    start: number;
    actions: AgentActionEntry[];
}

/** Pure: a stretch's calls as lines, a run of the same verb on the same one file folded into one, in order. */
export function stepRows(actions: AgentActionEntry[]): StepRow[] {
    const rows: StepRow[] = [];
    let lastKey: string | null = null;
    actions.forEach((a, k) => {
        const key = foldKey(a);
        if (key != null && key === lastKey) {
            rows[rows.length - 1].actions.push(a);
        } else {
            rows.push({ start: k, actions: [a] });
        }
        lastKey = key;
    });
    return rows;
}

export interface StepFold {
    step: Step; // the run's verb and file, running while any call in it is
    count: number;
    durationMs: number; // the calls that finished, added up
    runningSince?: number; // the startedAt of the call in flight, when it carried one
    summary?: string; // a read's "25 lines", when every call in the run says the same
    edits?: { adds: number; dels: number }; // an edit run's lines, over the calls whose diff landed
}

/** Pure: a folded run as its one line. */
export function foldOf(actions: AgentActionEntry[], live: boolean): StepFold {
    const running = actions.find((a) => inFlight(a, live));
    const summaries = new Set(actions.map((a) => a.summary ?? ""));
    const [summary] = summaries;
    let edits: StepFold["edits"];
    for (const a of actions) {
        const c = editCounts(a);
        if (c != null) {
            edits = { adds: (edits?.adds ?? 0) + c.adds, dels: (edits?.dels ?? 0) + c.dels };
        }
    }
    return {
        step: { ...stepOf(actions[0], live), running: running != null },
        count: actions.length,
        durationMs: actions.reduce((n, a) => n + (a.durationMs ?? 0), 0),
        runningSince: running?.startedAt,
        summary: summaries.size === 1 && summary !== "" ? summary : undefined,
        edits,
    };
}

/** Pure: one tool call as a step line. `live`: the session is working, so a call with no result is running. */
export function stepOf(action: AgentActionEntry, live: boolean): Step {
    const known = KNOWN[action.verb];
    const all = chipsOf(action);
    return {
        verb: all[0]?.kind === "description" ? "" : (known?.verb ?? plainVerb(action.verb)),
        icon: known?.icon ?? "tool",
        chips: all.slice(0, MAX_STEP_CHIPS),
        more: Math.max(0, all.length - MAX_STEP_CHIPS),
        running: inFlight(action, live),
    };
}
