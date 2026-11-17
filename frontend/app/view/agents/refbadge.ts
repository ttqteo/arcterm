// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A reference to an agent, a run, a council, a past conversation (`session:`) or an initiative (`effort:`) in Chat
// (`agent:7cd99627`, as the `@` picker writes it, refmention.ts refToken), drawn as a badge: which words are references,
// what each names, and how its badge looks. Pure: the box's pills (chateditorrefpill.tsx) and your sent bubble's
// (remarkrefmention.ts, chatrefbadge.tsx) share it, so the two agree. The text is never changed: a badge stands for its
// token as written.

import { formatAge, formatAgo } from "./agentsviewmodel";
import type { RefKind } from "./refmention";
import { runtimeMeta } from "./runtimemeta";

export interface RefSpan {
    start: number;
    end: number;
    kind: RefKind;
    /** lowercased */
    id: string;
    /** the token as written, `@` and case kept */
    raw: string;
}

// a token stands as its own word: at the start, or after whitespace or an opening bracket; it ends at whitespace,
// punctuation or the end. 4+ hex characters, dashes inside (a whole uuid pastes too).
const REF_RE =
    /(^|[\s([{])(@?(agent|tab|run|council|session|effort):([0-9a-f]{4,}(?:-[0-9a-f]+)*))(?=$|[\s.,;:!?)\]}'"])/gi;

/** Pure: the references in `text`, in order. With `caret`, one the caret is in or at the end of (still being typed) is
 *  left out, as `mentionTokens` does for a file. */
export function refSpans(text: string, caret?: number): RefSpan[] {
    const out: RefSpan[] = [];
    for (const m of text.matchAll(REF_RE)) {
        const start = (m.index ?? 0) + m[1].length;
        const raw = m[2];
        const end = start + raw.length;
        if (caret != null && caret > start && caret <= end) {
            continue;
        }
        const k = m[3].toLowerCase();
        out.push({ start, end, raw, kind: k === "tab" ? "agent" : (k as RefKind), id: m[4].toLowerCase() });
    }
    return out;
}

export interface RefSources {
    agents: readonly { id: string; name: string; state: "asking" | "working" | "idle"; agent?: string }[];
    runs: readonly { oid: string; goal?: string }[];
    councils: readonly { id: string; feature?: string }[];
    /** the chat's project folder, "" for a chat outside one (its runs and councils are not looked up) */
    project: string;
    /** the past conversations a `session:` can name, from any project; missing reads as none */
    sessions?: readonly Pick<SessionActivity, "id" | "runtime" | "task" | "projectname" | "lastactivets">[];
    /** the initiatives an `effort:` can name, from any project; missing reads as none */
    efforts?: readonly Pick<EffortSummary, "oref" | "title" | "done" | "total">[];
    /** the clock a conversation's age is read against; missing reads as Date.now() */
    now?: number;
}

export type ResolvedRef =
    | {
          status: "resolved";
          kind: RefKind;
          /** the full id, for the router (an initiative's is its oid, without `effort:`) */
          id: string;
          name: string;
          runtime?: string;
          state?: "asking" | "working" | "idle";
          /** a conversation's project name */
          project?: string;
          /** the short fact beside the name: a conversation's age ("3d"), an initiative's chunks ("4/9") */
          meta?: string;
          /** an initiative with all its chunks done */
          metaDone?: boolean;
          /** a conversation's age in ms (now - its last activity), for the tooltip */
          ageMs?: number;
          /** an initiative's chunks done and in all, for the tooltip */
          done?: number;
          total?: number;
      }
    | { status: "unresolved"; reason: string };

const firstLine = (s: string | undefined) => (s ?? "").split("\n")[0].replace(/\s+/g, " ").trim();

function pick<T>(items: readonly T[], idOf: (t: T) => string, id: string): T[] {
    const exact = items.filter((t) => idOf(t).toLowerCase() === id);
    return exact.length > 0 ? exact : items.filter((t) => idOf(t).toLowerCase().startsWith(id));
}

const PLURALS: Record<RefKind, string> = {
    agent: "agents",
    run: "runs",
    council: "councils",
    session: "conversations",
    effort: "initiatives",
};

const effortOid = (oref: string) => oref.replace(/^effort:/, "");

/** Pure: what `kind:id` names among the chat's sources: the exact id, else the one id it starts. A conversation and an
 *  initiative are looked up first: they belong to no project, so a chat outside one names them too. */
export function resolveRef(kind: RefKind, id: string, src: RefSources): ResolvedRef {
    id = id.toLowerCase();
    const many = (n: number): ResolvedRef => ({
        status: "unresolved",
        reason: `${kind}:${id} names ${n} ${PLURALS[kind]}`,
    });
    if (kind === "agent") {
        const hits = pick(src.agents, (a) => a.id, id);
        if (hits.length === 0) return { status: "unresolved", reason: `No agent ${id} is open` };
        if (hits.length > 1) return many(hits.length);
        const a = hits[0];
        return { status: "resolved", kind, id: a.id, name: a.name, runtime: a.agent, state: a.state };
    }
    if (kind === "session") {
        const hits = pick(src.sessions ?? [], (s) => s.id, id);
        if (hits.length === 0) return { status: "unresolved", reason: `No conversation ${id} in the loaded history` };
        if (hits.length > 1) return many(hits.length);
        const s = hits[0];
        const ageMs = (src.now ?? Date.now()) - s.lastactivets;
        return {
            status: "resolved",
            kind,
            id: s.id,
            name: firstLine(s.task) || s.projectname || id,
            runtime: s.runtime,
            project: s.projectname,
            meta: formatAge(ageMs),
            ageMs,
        };
    }
    if (kind === "effort") {
        const hits = pick(src.efforts ?? [], (e) => effortOid(e.oref), id);
        if (hits.length === 0) return { status: "unresolved", reason: `No initiative ${id}` };
        if (hits.length > 1) return many(hits.length);
        const e = hits[0];
        return {
            status: "resolved",
            kind,
            id: effortOid(e.oref),
            name: firstLine(e.title) || id,
            meta: `${e.done}/${e.total}`,
            metaDone: e.total > 0 && e.done === e.total,
            done: e.done,
            total: e.total,
        };
    }
    if (src.project === "") {
        return { status: "unresolved", reason: `This chat has no project to find ${kind} ${id} in` };
    }
    if (kind === "run") {
        const hits = pick(src.runs, (r) => r.oid, id);
        if (hits.length === 0) return { status: "unresolved", reason: `No run ${id} in this project` };
        if (hits.length > 1) return many(hits.length);
        return { status: "resolved", kind, id: hits[0].oid, name: firstLine(hits[0].goal) || id };
    }
    const hits = pick(src.councils, (c) => c.id, id);
    if (hits.length === 0) return { status: "unresolved", reason: `No council ${id} in this project` };
    if (hits.length > 1) return many(hits.length);
    return { status: "resolved", kind, id: hits[0].id, name: firstLine(hits[0].feature) || id };
}

export interface BadgeLook {
    /** border and fill classes (the frame itself is chatrefbadge.tsx's) */
    frame: string;
    mark: "runtime" | "run" | "council" | "session" | "effort" | null;
    dot: "working" | "asking" | null;
}

const UNRESOLVED_FRAME = "border-dashed border-edge-strong bg-transparent text-muted";
const NEUTRAL_FRAME = "border-edge-mid bg-surface";

/** Pure: how a badge looks (option C): an agent in its runtime's tint with its state's dot, a run and a council in
 *  their marks' tints, a conversation and an initiative neutral and told apart by their marks, an unresolved token
 *  dashed. */
export function badgeLook(r: ResolvedRef): BadgeLook {
    if (r.status === "unresolved") {
        return { frame: UNRESOLVED_FRAME, mark: null, dot: null };
    }
    if (r.kind === "session" || r.kind === "effort") return { frame: NEUTRAL_FRAME, mark: r.kind, dot: null };
    if (r.kind === "run") return { frame: "border-mark-run-line bg-mark-run-soft", mark: "run", dot: null };
    if (r.kind === "council")
        return { frame: "border-mark-council-line bg-mark-council-soft", mark: "council", dot: null };
    const meta = runtimeMeta(r.runtime);
    const dot = r.state === "working" || r.state === "asking" ? r.state : null;
    return { frame: `${meta.line} ${meta.softBg}`, mark: "runtime", dot };
}

/** Pure: the badge's tooltip: name · kind short-id · what else is known (an agent's state; a conversation's runtime,
 *  project and age; an initiative's chunks), ending "(click to open)" when the badge opens what it names (the bubble's
 *  does, the message box's only selects: `opens: false`), or why it is not one. */
export function refTitle(r: ResolvedRef, { opens = true }: { opens?: boolean } = {}): string {
    if (r.status === "unresolved") {
        return r.reason;
    }
    const id8 = r.id.slice(0, 8);
    const parts = [r.name];
    if (r.kind === "session") {
        parts.push(`conversation ${id8}`);
        for (const p of [r.runtime, r.project]) if (p) parts.push(p);
        parts.push(formatAgo(r.ageMs));
    } else if (r.kind === "effort") {
        parts.push(`initiative ${id8}`);
        if (r.total != null) parts.push(`${r.done} of ${r.total} chunks done`);
    } else {
        parts.push(`${r.kind} ${id8}`);
        if (r.kind === "agent" && r.state != null) parts.push(r.state);
    }
    return parts.join(" · ") + (opens ? " (click to open)" : "");
}
