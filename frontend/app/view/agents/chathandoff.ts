// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plan handoff card in Chat, the pure model (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md
// section 3 and its plan, decisions 8 and 9): recognizing the AskUserQuestion with header `Handoff`, the four rows in
// their fixed order mapped back to the agent's own options, the plan file's path and facts, the facts line, and the ✓
// row. No React, no jotai, no RPC: the card (chathandoffcard.tsx) draws, the dock and the conversation place it.

export const HANDOFF_HEADER = "Handoff";

/** The four choices, in the order AGENTS.md ("A finished plan offers the engine first") sets. The wording is fixed:
 *  the arc:handoff skill teaches the agent to ask with these labels, and the rows map back to its options by them. */
export const HANDOFF_CHOICES = [
    "Arc engine",
    "Arc engine, queued",
    "Inline in this session",
    "Subagent-driven",
] as const;

export type HandoffChoice = (typeof HANDOFF_CHOICES)[number];

const LETTERS = ["A", "B", "C", "D"] as const;

// The row's sentence when the agent's option had no description (the board's wording, without its sample route or
// run limit: the card does not know them).
const DEFAULT_DETAIL: Record<HandoffChoice, string> = {
    "Arc engine": "Start the run now: a lead and workers build it in separate worktrees.",
    "Arc engine, queued": "Starts when fewer runs are active than the limit allows.",
    "Inline in this session": "This agent works through the plan here (executing-plans).",
    "Subagent-driven": "This agent sends a subagent per task and reviews each one.",
};

const RECOMMENDED = /\(recommended\)/i;

// An option label as the choices are matched: the (Recommended) marker dropped (Claude Code's AskUserQuestion has no
// flag for it, so the agent appends it to the label), whitespace squeezed.
function clean(label: string): string {
    return label
        .replace(/\(recommended\)/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Pure: whether an AskUserQuestion is the plan handoff: exactly one question, with the header `Handoff`. */
export function isHandoffAsk(questions: readonly { header?: string }[] | undefined): boolean {
    return questions?.length === 1 && questions[0].header?.trim().toLowerCase() === HANDOFF_HEADER.toLowerCase();
}

/** Pure: whether words typed in the message box answer the agent's live ask, sent as its typed answer, instead of
 *  waiting behind it as any other question's do (sendHold). The handoff card has no field of its own and points at the
 *  box ("Or type below to answer in your own words"); a held ask is answered on its card, so it never is. */
export function boxAnswersAsk(
    ask: { hold?: boolean; questions?: readonly { header?: string }[] } | undefined
): boolean {
    return ask != null && !ask.hold && isHandoffAsk(ask.questions);
}

export type HandoffRow = {
    letter: "A" | "B" | "C" | "D";
    label: HandoffChoice;
    /** the one-sentence detail: the agent's option description, else the default */
    detail: string;
    /** the agent put (Recommended) on this choice's option */
    recommended: boolean;
    /** the index of the agent's own option for this choice, which a click sends; null when the agent left it out */
    optionIndex: number | null;
};

/** Pure: the four rows of the card, always in the fixed order whatever order the agent listed its options in (Claude
 *  Code's guidance puts the recommended option first). Each row finds the agent's option by its label, the
 *  (Recommended) marker dropped and the case ignored; a choice the agent did not offer has a null optionIndex. Chat
 *  computes no recommendation itself: the rules for it need what only the agent knows. */
export function handoffRows(q: { options?: readonly { label: string; description?: string }[] }): HandoffRow[] {
    const options = q.options ?? [];
    const keys = options.map((o) => clean(o.label).toLowerCase());
    return HANDOFF_CHOICES.map((label, n) => {
        const idx = keys.indexOf(label.toLowerCase());
        const opt = idx >= 0 ? options[idx] : undefined;
        return {
            letter: LETTERS[n],
            label,
            detail: opt?.description?.trim() || DEFAULT_DETAIL[label],
            recommended: opt != null && RECOMMENDED.test(opt.label),
            optionIndex: idx >= 0 ? idx : null,
        };
    });
}

// A backticked path (which may hold spaces), or a bare token that ends .md and is not the start of a longer name
// (notes.mdx, x.md5, x.md.bak). The leftmost match wins, so the first path in the text is the one returned.
const PLAN_PATH = /`([^`\n]*?\.md)`|([^\s`'"()<>[\]{}|*?,;]+\.md)(?![\w\-/\\]|\.\w)/i;

/** Pure: the plan's path, the first `.md` path in the handoff question's text (backticked or bare, relative or
 *  absolute); null when the text names none. A relative path resolves against the agent's working directory, which is
 *  the caller's to know. */
export function planPathOf(question: string): string | null {
    const m = PLAN_PATH.exec(question);
    const path = (m?.[1] ?? m?.[2])?.trim();
    return path || null;
}

export type PlanFacts = {
    /** the plan's first `# ` heading */
    title?: string;
    /** the `### Task N` / `## Task N` headings */
    tasks?: number;
    /** how many tasks can run at once: the widest level of the Depends graph */
    width?: number;
};

const TITLE_RE = /^# (.+?)\s*$/;
const TASK_RE = /^#{2,3} Task (\d+)(?::\s*(.*?))?\s*$/;
const DEPENDS_RE = /^\*\*Depends on:\*\*\s*(.*?)\s*$/;

// A Depends value's task numbers: the reasons in parentheses ("Task 1 (uses its types, its parser)") are dropped
// first, so a number inside one is not read as a dependency.
function dependsOf(value: string): number[] {
    let bare = "";
    let depth = 0;
    for (const ch of value) {
        if (ch === "(") {
            depth++;
        } else if (ch === ")" && depth > 0) {
            depth--;
        } else if (depth === 0) {
            bare += ch;
        }
    }
    return [...bare.matchAll(/Task\s+(\d+)/gi)].map((m) => Number(m[1]));
}

/** Pure: a plan file's title, task count and width, as pkg/jarvis/plan.go's PlanFormat reads it (the code fences of a
 *  plan's own examples skipped). A task's level is 0 for `none`, one below its deepest listed task otherwise, and one
 *  below the previous task when it has no Depends line (a plan with none is one serial chain); the width is the most
 *  tasks on one level. A part that cannot be read is left out, so a plan with no tasks gives its title alone. */
export function planFacts(planText: string): PlanFacts {
    let title: string | undefined;
    let fence: string | null = null;
    // the task whose Depends line is still to come: it is the first non-blank line under the heading
    let awaiting: { n: number; index: number } | null = null;
    const levels: number[] = [];
    const levelOf = new Map<number, number>();
    for (const line of planText.split(/\r?\n/)) {
        const marker = /^[ \t]*(```|~~~)/.exec(line)?.[1];
        if (marker) {
            fence = fence == null ? marker : fence === marker ? null : fence;
            continue;
        }
        if (fence != null) {
            continue;
        }
        const task = TASK_RE.exec(line);
        if (task) {
            const n = Number(task[1]);
            // no Depends line (yet): after the previous task
            const level = levels.length > 0 ? levels[levels.length - 1] + 1 : 0;
            levels.push(level);
            levelOf.set(n, level);
            awaiting = { n, index: levels.length - 1 };
            continue;
        }
        if (title === undefined) {
            const t = TITLE_RE.exec(line);
            if (t) {
                title = t[1];
                continue;
            }
        }
        if (awaiting && line.trim() !== "") {
            const depends = DEPENDS_RE.exec(line);
            if (depends) {
                const known = dependsOf(depends[1])
                    .map((d) => levelOf.get(d))
                    .filter((l): l is number => l !== undefined);
                const level = known.length > 0 ? Math.max(...known) + 1 : 0;
                levels[awaiting.index] = level;
                levelOf.set(awaiting.n, level);
            }
            awaiting = null;
        }
    }
    const facts: PlanFacts = {};
    if (title !== undefined) {
        facts.title = title;
    }
    if (levels.length > 0) {
        const perLevel = new Map<number, number>();
        for (const l of levels) {
            perLevel.set(l, (perLevel.get(l) ?? 0) + 1);
        }
        facts.tasks = levels.length;
        facts.width = Math.max(...perLevel.values());
    }
    return facts;
}

function fileName(path: string | null | undefined): string {
    return (
        (path ?? "")
            .trim()
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() ?? ""
    );
}

function tasksPart(facts: PlanFacts | null | undefined): string {
    const tasks = facts?.tasks;
    if (tasks == null || !Number.isFinite(tasks) || tasks <= 0) {
        return "";
    }
    const noun = `${tasks} task${tasks === 1 ? "" : "s"}`;
    const width = facts?.width;
    if (tasks === 1 || width == null || !Number.isFinite(width) || width < 1) {
        return noun;
    }
    return `${noun}, ${width === 1 ? "one at a time" : `up to ${width} at once`}`;
}

// `runs:maxactive` 0 means no cap (wavesrv's ClampMaxActive), so there is no "of" to say.
function runsPart(runs: { active: number; max: number } | null | undefined): string {
    if (!runs || !Number.isFinite(runs.active) || !Number.isFinite(runs.max) || runs.active < 0 || runs.max <= 0) {
        return "";
    }
    return `${runs.active} of ${runs.max} run${runs.max === 1 ? "" : "s"} active`;
}

/** Pure: the card's facts line, as the board draws it: `<file name> · 5 tasks, up to 3 at once · 2 of 3 runs active`.
 *  A part that is unknown is left out (and the whole line is "" when nothing is known): the card always draws. */
export function factsLine(i: {
    path?: string | null;
    facts?: PlanFacts | null;
    runs?: { active: number; max: number } | null;
}): string {
    return [fileName(i.path), tasksPart(i.facts), runsPart(i.runs)].filter((p) => p !== "").join(" · ");
}

/** Pure: whether the choice is one of the two that start an engine run, so a run card follows its ✓ row. Takes a label as
 *  the agent wrote it, its (Recommended) marker and its case aside. */
export function isEngineChoice(choice: string): boolean {
    const key = clean(choice).toLowerCase();
    return key === HANDOFF_CHOICES[0].toLowerCase() || key === HANDOFF_CHOICES[1].toLowerCase();
}

// A picked label by the fixed wording when it is one of the choices, else as written less its marker.
function pickedName(label: string): string {
    const key = clean(label);
    return HANDOFF_CHOICES.find((c) => c.toLowerCase() === key.toLowerCase()) ?? key;
}

/** Pure: the handoff's ✓ row, `Handoff · Arc engine`; `Handoff · You replied` for words typed in the box; `Handoff`
 *  when nothing is answered. `picked` and `typed` are the answered question's own fields. */
export function handoffDoneLine(a: { picked: readonly string[]; typed?: string }): string {
    const picked = a.picked.map(pickedName).filter((p) => p !== "");
    if (picked.length > 0) {
        return `${HANDOFF_HEADER} · ${picked.join(", ")}`;
    }
    return a.typed?.trim() ? `${HANDOFF_HEADER} · You replied` : HANDOFF_HEADER;
}
