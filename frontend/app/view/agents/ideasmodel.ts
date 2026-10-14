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

// a row's meta line: "turn 4 · agent", or "you"; a turn of 0 is "not known" and leaves its part out
export function ideaMeta(idea: Idea): string {
    return idea.turn ? `turn ${idea.turn} · ${idea.by}` : idea.by;
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
