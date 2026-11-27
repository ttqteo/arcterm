// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The row of one tool call in an opened stretch in Chat (chatstepsview.tsx): a past-tense verb ("Read", "Edited", "Ran
// skill"…), what the call touched (`+N` past the third) and a muted meta ("25 lines", a failed call's error); a command is
// its description alone, or its first line. One step per call, as WorkItem.actions holds them (compacttimeline.ts), built
// only from the transcript entry, with no Thought lines (the projection skips thinking blocks). stepRows folds a run of
// calls with the same verb on the same one file into one row ("Edited a.ts ×4"), which opens to its calls. turnFiles is
// what a finished turn's edits changed, for the card at its end (chatturnfiles.tsx). Pure.

import type { AgentActionEntry } from "./agentsviewmodel";
import type { AgentPart } from "./chatmodel";
import { inFlight } from "./compacttimeline";

/** A line shows at most this many chips; the rest of what the call touched is its `more`. */
export const MAX_STEP_CHIPS = 3;

// a command or pattern past this is cut with an ellipsis (the chip truncates by width too; this keeps the DOM small)
const MAX_CHIP_TEXT = 160;

// a command its call described ("Confirmed the server is no longer running") is a "description": the row shows those words
// alone, and the command shows when the row opens
export type StepChip =
    | { kind: "file"; path: string }
    | { kind: "command"; text: string }
    | { kind: "description"; text: string; command: string }
    | { kind: "text"; text: string };

export interface Step {
    verb: string; // "" for a command: its description or its first line says what it did
    chips: StepChip[]; // at most MAX_STEP_CHIPS
    more: number; // the things the call touched past the chips shown
    meta?: string; // muted words after them: a read's "25 lines", a failed call's error, a subagent's task
    command: boolean; // a command row: its text alone, no verb
    running: boolean; // its result has not landed in a session that is working
    failed: boolean; // the verb reads "Edit failed", in red
}

// a verb in the three forms a row says it: done ("Edited"), running ("Editing"), and the stem a failure is worded on
// ("Edit failed")
interface Verb {
    done: string;
    doing: string;
    stem: string;
}

// the verbs the transcripts write (lower case: transcriptprojection.ts VERB_BY_TOOL and the codex / pi / opencode ones)
const KNOWN: Record<string, Verb> = {
    read: { done: "Read", doing: "Reading", stem: "Read" },
    edited: { done: "Edited", doing: "Editing", stem: "Edit" },
    wrote: { done: "Created", doing: "Creating", stem: "Create" },
    ran: { done: "Ran", doing: "Running", stem: "Run" },
    grep: { done: "Searched", doing: "Searching", stem: "Search" },
    glob: { done: "Found", doing: "Finding", stem: "Find" },
    webfetch: { done: "Fetched", doing: "Fetching", stem: "Fetch" },
    websearch: { done: "Searched the web", doing: "Searching the web", stem: "Web search" },
    spawned: { done: "Spawned", doing: "Spawning", stem: "Spawn" },
    skill: { done: "Ran skill", doing: "Running skill", stem: "Skill" },
    asked: { done: "Asked", doing: "Asking", stem: "Ask" },
    blocked: { done: "Blocked", doing: "Blocked", stem: "Blocked" },
};

// any other tool: "Used mcp__github__get_pull_request", its name as what the row names
const USED: Verb = { done: "Used", doing: "Using", stem: "Tool" };

/** Pure: a verb we have no word for, as words: "run_command" → "Run command". */
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
    summary?: string; // a read's "25 lines", when every call in the run says the same
    edits?: { adds: number; dels: number }; // an edit run's lines, over the calls whose diff landed
}

/** Pure: a folded run as its one row. */
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
        // the call in flight words the run's verb ("Editing"); every call in a run has the same verb and file
        step: stepOf(running ?? actions[0], live),
        count: actions.length,
        summary: summaries.size === 1 && summary !== "" ? summary : undefined,
        edits,
    };
}

/** Pure: the verb a call's row says, or null for a tool we have no word for. A harness that names its tools its own way
 *  (agy's run_command) still says what the call was by its detail. */
function verbOf(a: AgentActionEntry): Verb | null {
    return KNOWN[a.verb] ?? (a.detail?.kind === "edit" ? KNOWN.edited : a.detail?.kind === "bash" ? KNOWN.ran : null);
}

function rowVerb(verb: Verb, a: AgentActionEntry, running: boolean): string {
    if (a.outcome === "blocked") {
        return KNOWN.blocked.done;
    }
    if (a.outcome === "fail") {
        return `${verb.stem} failed`;
    }
    return running ? verb.doing : verb.done;
}

/** Pure: one tool call as a row. `live`: the session is working, so a call with no result is running. */
export function stepOf(action: AgentActionEntry, live: boolean): Step {
    const known = verbOf(action);
    // a subagent is named by its type ("Explore"), its task after it; a tool we have no word for by its own name
    const type = action.verb === "spawned" ? action.subagent?.subagentType : undefined;
    let all: StepChip[];
    if (type != null) {
        all = [{ kind: "text", text: type }];
    } else if (known != null) {
        all = chipsOf(action);
    } else {
        all = [{ kind: "text", text: action.verb }];
    }
    const failed = action.outcome === "fail";
    let meta = action.summary;
    if (failed) {
        meta = action.note ?? action.summary;
    } else if (type != null) {
        meta = action.subagent?.description;
    } else if (known == null && action.target.trim() !== "") {
        meta = firstLine(action.target);
    }
    const command = all[0]?.kind === "command" || all[0]?.kind === "description";
    const running = inFlight(action, live);
    return {
        verb: command ? "" : rowVerb(known ?? USED, action, running),
        chips: all.slice(0, MAX_STEP_CHIPS),
        more: Math.max(0, all.length - MAX_STEP_CHIPS),
        meta: meta != null && meta !== "" ? meta : undefined,
        command,
        running,
        failed,
    };
}

/** A file a turn changed, with the lines its edits added and removed over the turn. */
export interface TurnFile {
    path: string; // as the first call that touched it named it
    adds: number;
    dels: number;
}

// the pictures a webview draws from a blob (createImageBitmap, useLocalImage): no svg, no heic
const PICTURE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/** Pure: the picture a call read, as its absolute path, or null. Only a read that did not fail, of a file whose full path
 *  the transcript gave (a bare name cannot be found on disk) and whose extension is a picture's. */
export function pictureOf(a: AgentActionEntry): string | null {
    if (a.verb !== "read" || a.outcome === "fail" || a.outcome === "blocked") {
        return null;
    }
    const path = (a.path != null && a.path !== "" ? a.path : a.target).trim();
    const dot = path.lastIndexOf(".");
    if (!ABSOLUTE.test(path) || dot < 0 || !PICTURE_EXTS.has(path.slice(dot + 1).toLowerCase())) {
        return null;
    }
    return path;
}

/** Pure: the pictures a stretch read, once each in the order first read, at most `max`: the thumbnails its folded line
 *  shows. */
export function stretchPictures(actions: readonly AgentActionEntry[], max: number): string[] {
    const out: string[] = [];
    for (const a of actions) {
        const path = pictureOf(a);
        if (path != null && !out.includes(path)) {
            out.push(path);
            if (out.length >= max) {
                break;
            }
        }
    }
    return out;
}

/** Pure: the call did what it set out to: it neither failed nor was refused. */
export const succeeded = (a: AgentActionEntry) =>
    a.outcome !== "fail" && a.outcome !== "blocked" && a.verb !== "blocked";

// a file in the visuals folder (chatvisual.ts visualsDirOf), slashes forward; any case, as on a Windows disk
const VISUAL_PAGE = /(?:^|\/)\.arc\/visuals\//i;

/** Pure: every file a turn's edits and creates changed, once each, in the order first touched, its lines summed over the
 *  turn: the card at a finished turn's end (chatturnfiles.tsx). A call that failed or was refused adds nothing, and so do
 *  reads, commands and other tools (a command that wrote a file is not seen). A page written under ~/.arc/visuals is left
 *  out: it is drawn in the reply as an inline visual, and is no change to the project. */
export function turnFiles(parts: readonly AgentPart[]): TurnFile[] {
    const byPath = new Map<string, TurnFile>();
    for (const part of parts) {
        if (part.kind !== "work") {
            continue;
        }
        for (const a of part.work.actions) {
            if (a.detail?.kind !== "edit" || !succeeded(a)) {
                continue;
            }
            for (const f of a.detail.files) {
                if (f.path === "") {
                    continue;
                }
                const key = f.path.replace(/\\/g, "/");
                if (VISUAL_PAGE.test(key)) {
                    continue;
                }
                const seen = byPath.get(key);
                if (seen != null) {
                    seen.adds += f.adds;
                    seen.dels += f.dels;
                } else {
                    byPath.set(key, { path: f.path, adds: f.adds, dels: f.dels });
                }
            }
        }
    }
    return [...byPath.values()];
}

/** Pure: a file as the card's row names it: its name, and its folder relative to the agent's working directory ("" at
 *  its root), or the folder's own name when the file is outside it or the directory is not known. */
export function fileWhere(path: string, cwd: string | null | undefined): { name: string; folder: string } {
    const norm = path.replace(/\\/g, "/");
    const cut = norm.lastIndexOf("/");
    const name = norm.slice(cut + 1);
    const dir = cut > 0 ? norm.slice(0, cut) : "";
    const root = (cwd ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (root !== "" && dir.toLowerCase() === root.toLowerCase()) {
        return { name, folder: "" };
    }
    if (root !== "" && dir.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        return { name, folder: dir.slice(root.length + 1) };
    }
    // a relative path keeps its folder as written; an absolute one outside the directory, its folder's own name
    const absolute = /^(?:[a-z]:)?\//i.test(norm);
    return { name, folder: absolute ? (dir.split("/").pop() ?? "") : dir };
}

/** Pure: where a turn's file is on disk, to open it: an absolute path as written, a relative one read against the agent's
 *  directory (in that directory's separator), or null when it is relative and the directory is not known. */
export function turnFileAbs(path: string, cwd: string | null | undefined): string | null {
    if (/^(?:[a-z]:)?[\\/]/i.test(path)) {
        return path;
    }
    if (cwd == null || cwd === "") {
        return null;
    }
    const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
    return `${cwd.replace(/[\\/]+$/, "")}${sep}${path.replace(/^\.[\\/]/, "")}`;
}

/** Pure: what a turn's file opens its Diff against: the last commit, read by git from the file's own folder, so a file in
 *  a worktree under the agent's directory (`.worktrees/x/a.ts`, another work tree of the repo) is measured in that tree.
 *  Null for a path with no folder in it. */
export function turnFileDiff(abs: string): { cwd: string; rel: string; base: string } | null {
    const cut = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
    if (cut <= 0 || cut === abs.length - 1) {
        return null;
    }
    // a drive root keeps its separator: `C:` alone is the drive's current folder, not its root
    const dir = /^[a-z]:$/i.test(abs.slice(0, cut)) ? abs.slice(0, cut + 1) : abs.slice(0, cut);
    return { cwd: dir, rel: abs.slice(cut + 1), base: "" };
}

/** Pure: where a file the agent edited on another machine may be here, longest guess first. A session started on Windows
 *  and resumed on a Mac (or the other way) keeps the other machine's absolute paths in its transcript (`d:\proj\a\b.html`),
 *  which this machine cannot open; the project is the agent's directory here, under another name and parent, so each tail
 *  of the path (`proj\a\b.html`, `a\b.html`, `b.html`) is read against it and the first that exists is the file. Empty
 *  for a path this machine can open as written, or with no directory to read it against. */
export function foreignPathGuesses(path: string, cwd: string | null | undefined, windows: boolean): string[] {
    const foreign = windows ? /^\/(?!\/)/.test(path) : /^[a-z]:[\\/]/i.test(path);
    if (!foreign || cwd == null || cwd === "") {
        return [];
    }
    const parts = path
        .replace(/^[a-z]:/i, "")
        .split(/[\\/]+/)
        .filter((p) => p !== "");
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        out.push(turnFileAbs(parts.slice(i).join(windows ? "\\" : "/"), cwd)!);
    }
    return out;
}
