// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Ideas list of an agent session (pkg/ideastore): which ideas fall in which group, which are new since the user last
// looked, and the one-line meta of a row. Pure; ideasstore.ts holds the state and ideassection.tsx draws it.

export type IdeaKind = "decision" | "idea" | "question";

// the three groups, in the order the section lists them: what is settled, what was floated, what is still open. `label`
// heads the group; `choiceLabel` is the same kind as one option of the edit box's three-way choice ("Idea", not "Ideas")
export const IDEA_GROUPS: { kind: IdeaKind; label: string; choiceLabel: string }[] = [
    { kind: "decision", label: "Decided", choiceLabel: "Decided" },
    { kind: "idea", label: "Ideas", choiceLabel: "Idea" },
    { kind: "question", label: "Open", choiceLabel: "Open" },
];

export function ideaKindLabel(kind: string): string {
    return IDEA_GROUPS.find((g) => g.kind === kind)?.label ?? "Ideas";
}

// sessionIdFromTranscript names the agent session a transcript path belongs to: its file name without ".jsonl", split on
// either slash. wavesrv takes the same name from the block's agent:transcriptpath (agentobserve.TranscriptSession), so
// the rail and `wsh idea` land on the same list.
export function sessionIdFromTranscript(path?: string): string | null {
    if (!path) {
        return null;
    }
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    const id = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
    return id === "" ? null : id;
}

// the ids wavesrv's ideastore accepts (the session's uuid; the pattern also keeps a file inside its ideas folder): a
// transcript named otherwise has no list, so nothing asks for one
export function validSessionId(id: string | null | undefined): id is string {
    return id != null && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

// "i7" → 7; an id the store did not make sorts first
function idNum(id: string): number {
    const n = Number.parseInt(id.slice(1), 10);
    return Number.isNaN(n) ? 0 : n;
}

// newest first; two ideas added in the same millisecond order by their ids
function newestFirst(a: Idea, b: Idea): number {
    return b.ts - a.ts || idNum(b.id) - idNum(a.id);
}

function listed(s: SessionIdeas | null | undefined): Idea[] {
    return s?.ideas ?? [];
}

export interface IdeaGroups {
    decided: Idea[];
    ideas: Idea[];
    open: Idea[];
    dropped: Idea[];
}

// groupIdeas sorts a session's ideas into its groups, newest first in each; a dropped idea is only in `dropped`
export function groupIdeas(s: SessionIdeas | null | undefined): IdeaGroups {
    const out: IdeaGroups = { decided: [], ideas: [], open: [], dropped: [] };
    for (const idea of [...listed(s)].sort(newestFirst)) {
        if (idea.dropped) {
            out.dropped.push(idea);
        } else if (idea.kind === "decision") {
            out.decided.push(idea);
        } else if (idea.kind === "question") {
            out.open.push(idea);
        } else {
            out.ideas.push(idea);
        }
    }
    return out;
}

// a section of the live list as the section draws it: `key` is its kind, "topic" or "other"
export interface IdeaSection {
    key: string;
    label: string;
    items: Idea[];
    topical: boolean; // the list is laid out by topic: a row in Open names its topic
}

// the section of the decisions and ideas with no topic, once some have one
export const OTHER_LABEL = "Other";

// a topic's key: "RAM" and "ram" are one topic, shown as the first idea to use it spelled it
function topicKey(idea: Idea): string {
    return (idea.topic ?? "").trim().toLocaleLowerCase();
}

function oldestFirst(a: Idea, b: Idea): number {
    return newestFirst(b, a);
}

// ideaSections lays out the live groups. While no live idea has a topic it is the three kind groups, as they always were.
// Once one has: Open first (every topic's questions, since they wait on the user), then a section per topic in the order
// the topic first came up, its decisions before its ideas, then Other for the decisions and ideas with no topic. An empty
// section is left out; rows stay newest first.
export function ideaSections(groups: IdeaGroups): IdeaSection[] {
    const byKind: Record<IdeaKind, Idea[]> = { decision: groups.decided, idea: groups.ideas, question: groups.open };
    const live = [...groups.decided, ...groups.ideas, ...groups.open];
    if (!live.some((i) => topicKey(i) !== "")) {
        return IDEA_GROUPS.map((g) => ({ key: g.kind, label: g.label, items: byKind[g.kind], topical: false })).filter(
            (s) => s.items.length > 0
        );
    }
    const labels = new Map<string, string>();
    for (const idea of [...live].sort(oldestFirst)) {
        const key = topicKey(idea);
        if (key !== "" && !labels.has(key)) {
            labels.set(key, (idea.topic ?? "").trim());
        }
    }
    const settled = [...groups.decided, ...groups.ideas];
    const sections: IdeaSection[] = [
        { key: "question", label: ideaKindLabel("question"), items: groups.open, topical: true },
        ...[...labels].map(([key, label]) => ({
            key: "topic",
            label,
            items: settled.filter((i) => topicKey(i) === key),
            topical: true,
        })),
        { key: "other", label: OTHER_LABEL, items: settled.filter((i) => topicKey(i) === ""), topical: true },
    ];
    return sections.filter((s) => s.items.length > 0);
}

// sectionFoldKey names a section the user can fold: a topic (by its key, so "RAM" and "ram" fold together) or Other.
// Open and the three kind groups have none: what waits on the user, and a list too small to need folding, always show.
export function sectionFoldKey(sec: IdeaSection): string | null {
    if (sec.key === "topic") {
        return `topic:${sec.label.trim().toLocaleLowerCase()}`;
    }
    return sec.key === "other" ? "other" : null;
}

// sectionOpen: a section with no fold key always shows; a foldable one is as the user last left it (`overrides`, by fold
// key), else open only while it holds the newest of the foldable sections' ideas, so the part of the brainstorm under
// way stays open and the ones it has moved on from fold
export function sectionOpen(sec: IdeaSection, sections: IdeaSection[], overrides: Record<string, boolean>): boolean {
    const key = sectionFoldKey(sec);
    if (key == null) {
        return true;
    }
    if (key in overrides) {
        return overrides[key];
    }
    let newest: { key: string; idea: Idea } | null = null;
    for (const s of sections) {
        const k = sectionFoldKey(s);
        for (const idea of k == null ? [] : s.items) {
            if (newest == null || newestFirst(idea, newest.idea) < 0) {
                newest = { key: k, idea };
            }
        }
    }
    return newest?.key === key;
}

// a row's hover tip: its whole text, which the row clamps to two lines, then its meta on a line of its own
export function ideaTip(idea: Idea, withTopic: boolean, fresh: boolean): string {
    return `${idea.text}\n${ideaMeta(idea, withTopic)}${fresh ? " · new" : ""}`;
}

// an idea is new while it is live and was added after the user last marked the list read
export function isFresh(idea: Idea, seenAt: number): boolean {
    return !idea.dropped && idea.ts > seenAt;
}

// ideaCounts: `live` are the ideas not dropped (the rail's count), `fresh` those of them that are new
export function ideaCounts(s: SessionIdeas | null | undefined): { live: number; fresh: number } {
    let live = 0;
    let fresh = 0;
    for (const idea of listed(s)) {
        if (idea.dropped) {
            continue;
        }
        live++;
        if (isFresh(idea, s?.seenat ?? 0)) {
            fresh++;
        }
    }
    return { live, fresh };
}

// a row's meta line: "turn 4 · agent", or "you"; a turn of 0 is "not known" and leaves its part out. `withTopic` leads
// with the idea's topic, for a row shown outside its topic's section (an open question)
export function ideaMeta(idea: Idea, withTopic = false): string {
    const meta = idea.turn ? `turn ${idea.turn} · ${idea.by}` : idea.by;
    const topic = withTopic ? idea.topic?.trim() : "";
    return topic ? `${topic} · ${meta}` : meta;
}

// the rows' check boxes: toggling one, and forgetting the ones the list no longer holds live (dropped, merged away)
export function toggleChecked(checked: string[], id: string): string[] {
    return checked.includes(id) ? checked.filter((c) => c !== id) : [...checked, id];
}

export function pruneChecked(checked: string[], s: SessionIdeas | null | undefined): string[] {
    const live = new Set(
        listed(s)
            .filter((i) => !i.dropped)
            .map((i) => i.id)
    );
    const kept = checked.filter((c) => live.has(c));
    return kept.length === checked.length ? checked : kept;
}

// Merge folds two or more ideas into one; Esc and the bar's X clear the checks
export function canMerge(checked: string[]): boolean {
    return checked.length >= 2;
}

export function selectionLabel(n: number): string {
    return `${n} selected`;
}

// "Mark as decided" is no use on an idea that is already a decision
export function canMarkDecided(idea: Idea): boolean {
    return idea.kind !== "decision";
}

// planEdit is what saving the edit box changes: null while its text is blank (nothing to save), else the new text and the
// new kind, each absent when it is as it was (both absent: the box just closes)
export function planEdit(
    idea: Idea,
    draft: { text: string; kind: IdeaKind }
): { text?: string; kind?: IdeaKind } | null {
    const text = draft.text.trim();
    if (text === "") {
        return null;
    }
    return {
        ...(text !== idea.text ? { text } : {}),
        ...(draft.kind !== ideaKindOf(idea) ? { kind: draft.kind } : {}),
    };
}

// the kind a stored idea edits as: an unknown kind reads as an idea, as groupIdeas files it
export function ideaKindOf(idea: Idea): IdeaKind {
    return idea.kind === "decision" || idea.kind === "question" ? idea.kind : "idea";
}
