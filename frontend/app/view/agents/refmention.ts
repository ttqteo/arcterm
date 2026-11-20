// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat box's `@` picker lists the live agents, the project's runs and its councils, the past conversations and the
// initiatives beside its files: a pick puts `agent:<id>`, `run:<id>`, `council:<id>`, `session:<id>` or `effort:<id>` in
// the text, a reference for the agent to read with `wsh read` (the arc mod's prompt hook tells it so,
// claude/arc-mod/hooks/refs-core.ts), never an `@` mention, which a prompt starting with `@<tab id>` would send to that
// agent instead. Pure: the rows, the matching and the insert; filemention.tsx draws them.

import { normPath } from "./agentsidebarmodel";
import { formatAgo, type AgentVM } from "./agentsviewmodel";
import type { AgentTreeRow } from "./agenttreemodel";

export type RefKind = "agent" | "run" | "council" | "session" | "effort";

export interface RefItem {
    kind: RefKind;
    id: string;
    // the row's text: an agent's task title or name, a run's goal, a council's feature, a conversation's task, an
    // initiative's title
    label: string;
    // the line beside it: project, harness and state; status; state; project, runtime and age; chunks and status
    detail: string;
    // newest first within a kind
    ts: number;
}

// the characters of an id a reference keeps: what `wsh agents list` and `wsh runs list` print, and what wsh read takes
export const REF_ID_LEN = 8;
// the rows the picker shows at most, so the files under them stay in reach
export const REF_MAX_ROWS = 6;
// the runs, councils, conversations and initiatives a project lists at most before a query narrows them
const PER_KIND = 20;

const KIND_WORDS: Record<RefKind, readonly string[]> = {
    agent: ["agent", "agents", "chat", "tab"],
    run: ["run", "runs"],
    council: ["council", "councils", "hội đồng"],
    session: ["session", "sessions", "conversation", "conversations", "hội thoại"],
    effort: ["effort", "efforts", "initiative", "initiatives"],
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The agents the Agent tree gives a row of their own at its top level (buildAgentTree's `parent` and `lead` rows): not a
 *  run's workers, its stage sessions (plan reviewer, verifier, land resolver) or a brainstorm's check and judge
 *  sessions, which sit under the row that started them. An agent waiting on another keeps its place: it nests, but it is
 *  an agent of its own. */
export function topLevelAgentIds(tree: readonly AgentTreeRow[]): Set<string> {
    const ids = new Set<string>();
    for (const r of tree) {
        if (r.kind === "parent" || r.kind === "lead") {
            ids.add(r.agent.id);
        }
    }
    return ids;
}

/** The live agents a chat can refer to: every agent but the chat's own, plain terminals, the lead of a run the picker
 *  lists (`listedRuns`, run ids: the run's row stands for it, with the same title, and `wsh read run:` reads its lead
 *  too) and, given `topLevel` (topLevelAgentIds), the agents the Agent tree nests under another row; the ones in the
 *  chat's own project first (the likeliest to name, and the ones the row cap would otherwise push out), each group in
 *  roster order. */
export function agentRefs(
    agents: readonly AgentVM[],
    selfId: string,
    listedRuns: ReadonlySet<string> = new Set(),
    topLevel?: ReadonlySet<string>
): RefItem[] {
    const project = agents.find((a) => a.id === selfId)?.project ?? "";
    const others = agents.filter(
        (a) =>
            a.id !== selfId &&
            (a.kind == null || a.kind === "agent" || a.kind === "background") &&
            !(a.runId != null && listedRuns.has(a.runId)) &&
            (topLevel == null || topLevel.has(a.id))
    );
    const ordered =
        project === ""
            ? others
            : [...others.filter((a) => a.project === project), ...others.filter((a) => a.project !== project)];
    return ordered.map((a, i) => ({
        kind: "agent" as const,
        id: a.id,
        label: clip(oneLine(a.task) || a.name, 80),
        detail: [a.project, a.agent, a.state].filter(Boolean).join(" · "),
        // the roster's order (asking, working, idle) is kept within each group
        ts: -i,
    }));
}

/** A project's runs a chat can refer to: the top-level ones the Agent tree gives a row, newest first. A task's run, a
 *  stage session's (plan reviewer, verifier, land resolver, builder check, judge) and a reviewer's are read through the
 *  run that started them; the rule is the backend's top-level run (pkg/runqueue/rules.go). */
export function runRefs(runs: readonly Run[] | null | undefined): RefItem[] {
    return (runs ?? [])
        .filter((r) => !r.parentleadoref && !r.taskid && !r.stagerole && !r.review)
        .map((r) => ({
            kind: "run" as const,
            id: r.oid,
            label: clip(oneLine(r.goal) || r.oid, 80),
            detail: [r.status, r.mode].filter(Boolean).join(" · "),
            ts: r.createdts ?? 0,
        }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, PER_KIND);
}

/** A project's councils a chat can refer to, newest save first, as the list holds them. */
export function councilRefs(councils: readonly Council[] | null | undefined): RefItem[] {
    return (councils ?? []).slice(0, PER_KIND).map((c, i) => ({
        kind: "council" as const,
        id: c.id,
        label: clip(oneLine(c.feature) || c.id, 80),
        detail: c.state ?? "",
        // the list is newest first already; its order is kept
        ts: -i,
    }));
}

/** The past conversations a chat can refer to, from the archive's loaded pages: the ones the command palette lists
 *  (resumable, outside an engine run or its lead; a run's workers, reviewers and stages would fill the 20), the newest
 *  20, those at the chat project's path first (`projectPath`, the registered path; the scan names a session's project for the last segment of
 *  its cwd, which a registered name need not equal), each group newest first. Ordered before the cut, so the project's one
 *  old conversation is not pushed out by 20 newer ones elsewhere. */
export function sessionRefs(
    sessions: readonly SessionActivity[] | null | undefined,
    projectPath: string,
    now: number
): RefItem[] {
    const here = projectPath === "" ? "" : normPath(projectPath);
    // paletteSessions' rule; sessionsarchivestore.ts is not pure, so it is repeated here
    const picked = (sessions ?? []).filter((s) => s.resumecommand && (!s.role || s.role === "lead"));
    const newestFirst = [...picked].sort((a, b) => b.lastactivets - a.lastactivets);
    const ordered =
        here === ""
            ? newestFirst
            : [
                  ...newestFirst.filter((s) => normPath(s.projectpath ?? "") === here),
                  ...newestFirst.filter((s) => normPath(s.projectpath ?? "") !== here),
              ];
    return ordered.slice(0, PER_KIND).map((s, i) => ({
        kind: "session" as const,
        id: s.id,
        label: clip(oneLine((s.task ?? "").trim().split(/\r?\n/, 1)[0]) || s.projectname, 80),
        detail: [s.projectname, s.runtime, formatAgo(now - s.lastactivets)].filter(Boolean).join(" · "),
        // the project's group leads, then the rest; refMatches' ts sort keeps that order
        ts: -i,
    }));
}

/** The initiatives a chat can refer to: those not archived, the ones of the chat's project first (`projectName`, the
 *  registered name an initiative's `project` holds), each group by last update, newest first. */
export function effortRefs(efforts: readonly EffortSummary[] | null | undefined, projectName: string): RefItem[] {
    const open = (efforts ?? []).filter((e) => e.status !== "archived").sort((a, b) => b.updatedts - a.updatedts);
    const ordered =
        projectName === ""
            ? open
            : [...open.filter((e) => e.project === projectName), ...open.filter((e) => e.project !== projectName)];
    return ordered.slice(0, PER_KIND).map((e, i) => ({
        kind: "effort" as const,
        id: e.oref.replace(/^effort:/, ""),
        label: clip(oneLine(e.title) || e.oref, 80),
        detail: `${e.done}/${e.total} chunks · ${e.status}`,
        ts: -i,
    }));
}

// The text as the picker compares it: lowercase, with no diacritics (đ read as d) and, with `dropSpaces`, no whitespace,
// and where each kept character sits in the text. Vietnamese is typed with its tone on either vowel ("báo", "baó"), so a
// query only matches what it spells when both lose their marks.
function fold(text: string, dropSpaces = false): { text: string; at: number[] } {
    let out = "";
    const at: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (dropSpaces && /\s/.test(c)) {
            continue;
        }
        const base = c.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
        for (const b of base) {
            out += b;
            at.push(i);
        }
    }
    return { text: out, at };
}

/** Whether `hay` holds `q` once both are folded and their whitespace taken out: `buildl` is in "Build Library". */
function holdsCompact(hay: string, q: string): boolean {
    const needle = fold(q, true).text;
    return needle !== "" && fold(hay, true).text.includes(needle);
}

/** Whether `hay` holds every word of `q`, both folded: `baó` is in "Nút báo lỗi". */
function holdsWords(hay: string, q: string): boolean {
    const folded = fold(hay).text;
    return q
        .split(/\s+/)
        .filter((w) => w !== "")
        .every((w) => folded.includes(fold(w).text));
}

/**
 * Which characters of a row's label the query matched, for the picker to draw in the accent: each word of the query
 * where it first sits in the label, or, when a word is not there, the whole query read without its spaces (`buildl`
 * marks "Build L" in "Build Library"), both with the diacritics aside (`baó` marks "báo"). A kind word or an id the
 * row matched by marks nothing.
 */
export function refHitMask(query: string, label: string): boolean[] {
    const mask = new Array<boolean>(label.length).fill(false);
    const q = query.trim().toLowerCase();
    if (q === "" || queryKind(q) != null || ADDRESS_QUERY.test(q)) {
        return mask;
    }
    const flat = fold(label);
    const words = q
        .split(/\s+/)
        .map((w) => fold(w).text)
        .filter((w) => w !== "");
    if (words.length > 0 && words.every((w) => flat.text.includes(w))) {
        for (const w of words) {
            const at = flat.text.indexOf(w);
            mask.fill(true, flat.at[at], flat.at[at + w.length - 1] + 1);
        }
        return mask;
    }
    const tight = fold(label, true);
    const needle = fold(q, true).text;
    const at = tight.text.indexOf(needle);
    if (needle !== "" && at >= 0) {
        for (let i = at; i < at + needle.length; i++) {
            mask[tight.at[i]] = true;
        }
    }
    return mask;
}

const kindOrder: Record<RefKind, number> = { agent: 0, run: 1, council: 2, session: 3, effort: 4 };

/** The kind a query asks for by name: "@run", "@coun", "@agent" (two letters at least), else null. */
export function queryKind(query: string): RefKind | null {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
        return null;
    }
    for (const kind of Object.keys(KIND_WORDS) as RefKind[]) {
        if (KIND_WORDS[kind].some((w) => w.startsWith(q))) {
            return kind;
        }
    }
    return null;
}

// a query written as a reference: `agent:b9b1`, `tab:b9b1`, `run:`, `council:0c28`, `session:9f31`, `effort:e9b2` (an id
// pasted after the `@`)
const ADDRESS_QUERY = /^(agent|tab|run|council|session|effort):([0-9a-f-]*)$/;

/**
 * The rows the `@` query lists, at most REF_MAX_ROWS: with no query none (a bare `@` lists files, as it always has); a
 * query that names a kind lists that kind's items; a query written as `kind:<id>` lists that kind's items whose id
 * starts with it; any other lists the items whose id starts with it, whose label or detail holds every word of it, or
 * whose label holds it once the spaces of both are taken out (`buildl` finds "Build Library"), diacritics aside in
 * both (`baó` finds "báo", the tone typed on the other vowel).
 * A query that holds a `/` or a `.` is a path, and lists none. Agents first, then runs, councils, conversations and
 * initiatives, each newest first.
 */
export function refMatches(query: string, items: readonly RefItem[]): RefItem[] {
    const q = query.trim().toLowerCase();
    if (q === "" || /[/.\\]/.test(q)) {
        return [];
    }
    const address = ADDRESS_QUERY.exec(q);
    if (address != null) {
        const kind: RefKind = address[1] === "tab" ? "agent" : (address[1] as RefKind);
        const id = address[2];
        return items
            .filter((it) => it.kind === kind && it.id.toLowerCase().startsWith(id))
            .sort((a, b) => b.ts - a.ts)
            .slice(0, REF_MAX_ROWS);
    }
    const kind = queryKind(q);
    const hit = (it: RefItem) => {
        if (kind != null) {
            return it.kind === kind;
        }
        if (it.id.toLowerCase().startsWith(q)) {
            return true;
        }
        return holdsWords(`${it.label} ${it.detail}`, q) || holdsCompact(it.label, q);
    };
    return items
        .filter(hit)
        .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.ts - a.ts)
        .slice(0, REF_MAX_ROWS);
}

/** What a pick writes: `kind:` and the id's first REF_ID_LEN characters. */
export function refToken(item: Pick<RefItem, "kind" | "id">): string {
    return `${item.kind}:${item.id.slice(0, REF_ID_LEN)}`;
}

/** The text with the `@query` from `start` to `caret` replaced by the item's reference and one space, and the caret
 *  after that space (a space already after the caret is not doubled). */
export function insertRef(
    text: string,
    start: number,
    caret: number,
    item: Pick<RefItem, "kind" | "id">
): { text: string; caret: number } {
    const token = refToken(item);
    const rest = text.slice(caret);
    const next = text.slice(0, start) + token + (rest.startsWith(" ") ? "" : " ") + rest;
    return { text: next, caret: start + token.length + 1 };
}
