// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The step line of one tool call in Chat (chatstepsview.tsx): an icon, a verb ("Read", "Edit", "Ran", "Search"…) and a chip
// for each thing the call touched, `+N` past the third. One step per call, as WorkItem.actions holds them (compacttimeline.ts),
// built only from the transcript entry: no merging of calls, no Thought lines (the projection skips thinking blocks). Pure.

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

export type StepChip =
    | { kind: "file"; path: string }
    | { kind: "command"; text: string }
    | { kind: "text"; text: string };

export interface Step {
    verb: string;
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
function plainVerb(verb: string): string {
    const words = verb.replace(/[_-]+/g, " ").trim();
    return words === "" ? "Tool" : words[0].toUpperCase() + words.slice(1);
}

/** Pure: the first non-empty line of a command, cut at MAX_CHIP_TEXT. */
function firstLine(text: string): string {
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

/** Pure: everything the call touched, as chips in the order it names them (before the cut at MAX_STEP_CHIPS). */
function chipsOf(a: AgentActionEntry): StepChip[] {
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
    // a command, from its detail once the result lands (the target is its description then), else the target
    if (d?.kind === "bash") {
        const command = firstLine(d.command ?? target);
        return command !== "" ? [{ kind: "command", text: command }] : [];
    }
    if (a.verb === "ran") {
        const command = firstLine(target);
        return command !== "" ? [{ kind: "command", text: command }] : [];
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

/** Pure: one tool call as a step line. `live`: the session is working, so a call with no result is running. */
export function stepOf(action: AgentActionEntry, live: boolean): Step {
    const known = KNOWN[action.verb];
    const all = chipsOf(action);
    return {
        verb: known?.verb ?? plainVerb(action.verb),
        icon: known?.icon ?? "tool",
        chips: all.slice(0, MAX_STEP_CHIPS),
        more: Math.max(0, all.length - MAX_STEP_CHIPS),
        running: inFlight(action, live),
    };
}
