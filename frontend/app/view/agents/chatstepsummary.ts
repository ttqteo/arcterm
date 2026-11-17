// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The folded line of a stretch of tool calls in Chat (chatstepsview.tsx ChatSteps), as words: "Edited server.js, ran 2
// commands, read 5 files", then the stretch's +/− lines and its time. The clauses that change something come first, then
// the ones that only looked, merged into one; only calls that succeeded count, and a stretch in which every call failed
// reads by what it tried. While a call is in flight the line says what it is doing instead: "Running npm test +2". Pure.

import type { AgentActionEntry } from "./agentsviewmodel";
import { chipsOf, editCounts, plainVerb, type StepChip } from "./chatsteps";
import { inFlight, workedFor } from "./compacttimeline";

export interface StretchSummary {
    running: boolean;
    // finished: the sentence; running: what the latest call in flight is doing
    text: string;
    // running: the other calls in flight besides the one named
    more: number;
    // finished: the lines the stretch's edits added and removed; null when it edited nothing
    edits: { adds: number; dels: number } | null;
}

type Tense = "past" | "base";

// what a call did, as the sentence groups it: the changing kinds in the order they are said, then the looking ones
type Kind = "edit" | "write" | "run" | "spawn" | "skill" | "ask" | "read" | "grep" | "glob" | "fetch" | "web" | "tool";

const CHANGING: Kind[] = ["edit", "write", "run", "spawn", "skill", "ask"];
const SEARCHING: Kind[] = ["grep", "glob", "fetch", "web"];

const KIND_BY_VERB: Record<string, Kind> = {
    edited: "edit",
    wrote: "write",
    ran: "run",
    spawned: "spawn",
    skill: "skill",
    asked: "ask",
    read: "read",
    grep: "grep",
    glob: "glob",
    webfetch: "fetch",
    websearch: "web",
};

// the running line's verb, before what the call works on
const DOING: Record<Kind, string> = {
    edit: "Editing",
    write: "Writing",
    run: "Running",
    spawn: "Spawning",
    skill: "Using skill",
    ask: "Asking",
    read: "Reading",
    grep: "Searching for",
    glob: "Finding",
    fetch: "Fetching",
    web: "Searching the web for",
    tool: "Using",
};

function kindOf(a: AgentActionEntry): Kind {
    const known = KIND_BY_VERB[a.verb];
    if (known != null) {
        return known;
    }
    // a harness that names its tools its own way (agy's run_command) still says what the call was by its detail
    if (a.detail?.kind === "bash") {
        return "run";
    }
    if (a.detail?.kind === "edit") {
        return "edit";
    }
    return "tool";
}

const succeeded = (a: AgentActionEntry) => a.outcome !== "fail" && a.outcome !== "blocked" && a.verb !== "blocked";

function baseName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const times = (n: number) => (n === 1 ? "" : ` ${n} times`);

/** Pure: the files a group of file calls touched, distinct, as the base name of the one or the count of several; with no
 *  file named at all, the calls counted as files. */
function filesObject(calls: AgentActionEntry[]): string {
    const paths = new Set<string>();
    for (const a of calls) {
        for (const c of chipsOf(a)) {
            if (c.kind === "file") {
                paths.add(c.path.replace(/\\/g, "/"));
            }
        }
    }
    if (paths.size === 1) {
        return baseName([...paths][0]);
    }
    return count(paths.size || calls.length, "a file", "files");
}

const VERBS: Record<Kind, Record<Tense, string>> = {
    edit: { past: "edited", base: "edit" },
    write: { past: "wrote", base: "write" },
    run: { past: "ran", base: "run" },
    spawn: { past: "spawned", base: "spawn" },
    skill: { past: "used", base: "use" },
    ask: { past: "asked", base: "ask" },
    read: { past: "read", base: "read" },
    grep: { past: "searched", base: "search" },
    glob: { past: "looked for files", base: "look for files" },
    fetch: { past: "fetched", base: "fetch" },
    web: { past: "searched the web", base: "search the web" },
    tool: { past: "used", base: "use" },
};

/** Pure: one clause for the calls of one kind ("edited 3 files", "ran a command"). */
function clause(kind: Kind, calls: AgentActionEntry[], tense: Tense): string {
    const verb = VERBS[kind][tense];
    const n = calls.length;
    switch (kind) {
        case "edit":
        case "write":
        case "read":
            return `${verb} ${filesObject(calls)}`;
        case "run":
            return `${verb} ${count(n, "a command", "commands")}`;
        case "spawn":
            return `${verb} ${count(n, "an agent", "agents")}`;
        case "skill": {
            const name = calls[0].target.trim();
            return n === 1 && name !== "" ? `${verb} skill ${name}` : `${verb} ${count(n, "a skill", "skills")}`;
        }
        case "ask":
            return `${verb} ${count(n, "a question", "questions")}`;
        case "fetch":
            return `${verb} ${count(n, "a page", "pages")}`;
        case "tool":
            return `${verb} ${count(n, "a tool", "tools")}`;
        default:
            return `${verb}${times(n)}`;
    }
}

/** Pure: the calls as clauses, in the sentence's order: what changed something, then one clause for what only looked
 *  ("read 5 files and searched 3 times"), then any tool it has no word for ("used 2 tools"). */
function clauses(actions: AgentActionEntry[], tense: Tense): string[] {
    const byKind = new Map<Kind, AgentActionEntry[]>();
    for (const a of actions) {
        const k = kindOf(a);
        byKind.set(k, [...(byKind.get(k) ?? []), a]);
    }
    const out = CHANGING.filter((k) => byKind.has(k)).map((k) => clause(k, byKind.get(k), tense));
    const looked: string[] = [];
    if (byKind.has("read")) {
        looked.push(clause("read", byKind.get("read"), tense));
    }
    const searches = SEARCHING.filter((k) => byKind.has(k));
    if (searches.length === 1) {
        looked.push(clause(searches[0], byKind.get(searches[0]), tense));
    } else if (searches.length > 1) {
        // a mix of searches, finds and fetches is one count: the clause stays short
        const n = searches.reduce((sum, k) => sum + byKind.get(k).length, 0);
        looked.push(`${VERBS.grep[tense]}${times(n)}`);
    }
    if (looked.length > 0) {
        out.push(looked.join(" and "));
    }
    if (byKind.has("tool")) {
        out.push(clause("tool", byKind.get("tool"), tense));
    }
    return out;
}

const capitalised = (s: string) => (s === "" ? s : s[0].toUpperCase() + s.slice(1));

/** Pure: what a chip names, as the running line says it. */
function chipText(chip: StepChip): string {
    return chip.kind === "file" ? baseName(chip.path) : chip.text;
}

/** Pure: what a call in flight is doing: "Running npm test", "Reading server.js"; a described command by its
 *  description alone ("Run the test suite"), which already says what it does. */
export function doingText(a: AgentActionEntry): string {
    const [chip] = chipsOf(a);
    if (chip?.kind === "description") {
        return chip.text;
    }
    const kind = kindOf(a);
    const verb = kind === "tool" ? `${DOING.tool} ${plainVerb(a.verb).toLowerCase()}` : DOING[kind];
    return chip != null ? `${verb} ${chipText(chip)}` : verb;
}

/** Pure: a stretch of tool calls as its folded line's words. `live`: the session is working, so a call with no result is
 *  in flight. */
export function stepSummary(actions: AgentActionEntry[], live: boolean): StretchSummary {
    const flying = actions.filter((a) => inFlight(a, live));
    if (flying.length > 0) {
        // the latest to start names the line; a call with no start time counts by its place in the stretch
        const latest = flying.reduce((best, a) =>
            (a.startedAt ?? -Infinity) >= (best.startedAt ?? -Infinity) ? a : best
        );
        return { running: true, text: doingText(latest), more: flying.length - 1, edits: null };
    }
    const ok = actions.filter(succeeded);
    let edits: StretchSummary["edits"] = null;
    for (const a of ok) {
        const c = editCounts(a);
        if (c != null) {
            edits = { adds: (edits?.adds ?? 0) + c.adds, dels: (edits?.dels ?? 0) + c.dels };
        }
    }
    let text: string;
    if (ok.length > 0) {
        text = capitalised(clauses(ok, "past").join(", "));
    } else if (actions.length > 0) {
        text = `Tried to ${clauses(actions, "base").join(", ")}`;
    } else {
        text = "Worked";
    }
    return { running: false, text, more: 0, edits };
}

/** Pure: a stretch's time as the line's tail says it, "38s", "3m 12s", "1h 5m" (workedFor's numbers); "" under a second. */
export function stretchTime(durationMs: number): string {
    return workedFor(durationMs).replace(/^Worked(?: for )?/, "");
}
