// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Office's dialog box (canvas .superpowers/design/office-controls: Main, Run, States): what the ▶ menu holds at
// each kind of desk, where the ▶ goes after a pick, and the box's words. Pure: no React, no Wave runtime imports.

import {
    canSubmitAsk,
    displayAgeMs,
    formatAgeShort,
    formatTokens,
    latestMessageText,
    terminalAskNote,
    type AgentEntry,
    type AgentVM,
} from "./agentsviewmodel";
import { REVIEW_ACTIONS, ROW_ACTION_LABEL, type RowAction } from "./leadcardmodel";
import type { BoardAct } from "./officeboardmodel";
import { firstSel } from "./officecontrols";

export type DeskKind = "agent" | "lead" | "worker" | "leadless" | "board";

export type DialogItemId =
    | "open"
    | "reply"
    | "terminal"
    | "background"
    | "adjust"
    | "card"
    | "send"
    | `opt:${number}`
    | `row:${number}`
    | `board:${BoardAct}`;

export interface DialogItem {
    id: DialogItemId;
    label: string;
    // the shortcut the item shows while the ▶ is on it
    key?: string;
    // drawn, but the ▶ passes over it: Send before every question has an answer
    dim?: boolean;
    // an answer already picked
    checked?: boolean;
    // a line above it, between the answers and what else the desk offers
    rule?: boolean;
    // an answer of a question that takes several
    multi?: boolean;
}

export interface DialogInput {
    kind: DeskKind;
    // who talks: the desk's agent, the run's lead, or the task's worker; none for a leadless run or a seat with no worker
    agent?: AgentVM;
    activeQuestion: number;
    selections: Record<number, Set<number>>;
    texts: Record<number, string>;
    // a task row's actions, in the order its number keys run them (rowKeyActions)
    rowActions?: string[];
    // the task row opens its worker (TaskRowVM.openId is set)
    canOpen?: boolean;
    // the run takes Adjust (runAdjustable)
    adjustable?: boolean;
}

/** Pure: a task row action's name, as the card's buttons say it. */
export function rowActionLabel(id: string): string {
    return REVIEW_ACTIONS.find(([a]) => a === id)?.[1] ?? ROW_ACTION_LABEL[id as RowAction] ?? id;
}

/** Pure: the ▶ menu of the desk at the boss: the answers first when someone asks (and a task row's own actions), then
 *  what else the desk offers, then the full card. A line parts the answers from the rest, or the rest from the card. */
export function dialogItems(input: DialogInput): DialogItem[] {
    const { kind, agent } = input;
    const qs = agent?.state === "asking" ? (agent.ask?.questions ?? []) : [];
    const answers: DialogItem[] = [];
    if (qs.length > 0) {
        const qi = Math.min(Math.max(input.activeQuestion, 0), qs.length - 1);
        const q = qs[qi];
        const picked = input.selections[qi] ?? new Set<number>();
        (q.options ?? []).forEach((o, oi) =>
            answers.push({
                id: `opt:${oi}`,
                label: o.label,
                key: String(oi + 1),
                checked: picked.has(oi),
                multi: !!q.multiSelect,
            })
        );
        answers.push({ id: "send", label: "Send", key: "↵", dim: !canSubmitAsk(qs, input.selections, input.texts) });
    }
    // an asking worker's number keys answer it, so its row's actions take no number then. Tell asks for words, which
    // the full card's input takes, so the box leaves it out (States: a worker at work offers Open and Terminal); the
    // others keep their index, the number key that runs them
    (input.rowActions ?? []).forEach((a, i) => {
        if (a !== "tell") {
            answers.push({ id: `row:${i}`, label: rowActionLabel(a), key: qs.length > 0 ? undefined : String(i + 1) });
        }
    });
    const acts: DialogItem[] = [];
    if (agent && (kind !== "worker" || input.canOpen)) {
        if (qs.length === 0) {
            acts.push({ id: "open", label: kind === "lead" ? "Open lead" : "Open", key: "↵" });
            if (kind !== "worker") {
                acts.push({ id: "reply", label: "Reply", key: "r" });
            }
        }
        acts.push({ id: "terminal", label: "Terminal", key: "t" });
        if (kind === "agent" && agent.state !== "asking") {
            acts.push({ id: "background", label: "Background", key: "b" });
        }
    }
    if ((kind === "lead" || kind === "leadless") && input.adjustable) {
        acts.push({ id: "adjust", label: "Adjust" });
    }
    const card: DialogItem = { id: "card", label: "Full card", key: "f" };
    if (answers.length > 0) {
        return [...answers, ...[...acts, card].map((it, i) => (i === 0 ? { ...it, rule: true } : it))];
    }
    return acts.length > 0 ? [...acts, { ...card, rule: true }] : [card];
}

/** Pure: which items the ▶ can rest on. */
export function enabledOf(items: readonly DialogItem[]): boolean[] {
    return items.map((it) => !it.dim);
}

/** Pure: the ▶ kept on an item it can rest on: one left past the end (the desk changed under it) or on a dim item goes
 *  to the first it can rest on. */
export function clampSel(items: readonly DialogItem[], sel: number): number {
    return sel >= 0 && sel < items.length && !items[sel].dim ? sel : firstSel(enabledOf(items));
}

/** Pure: where the ▶ goes after ↵ on items[sel]: from an answer of a one-answer question to Send, so a second ↵ sends
 *  it; anywhere else it stays. */
export function selAfterActivate(items: readonly DialogItem[], sel: number): number {
    const it = items[sel];
    if (!it || !it.id.startsWith("opt:") || it.multi) {
        return sel;
    }
    const send = items.findIndex((x) => x.id === "send");
    return send < 0 ? sel : send;
}

export interface DialogWords {
    // what the agent said last, above the main line
    said?: string;
    // the line that matters: the question it asks, or why its terminal holds the choices
    main?: string;
}

/** Pure: the dialog box's words for an agent: its question under what it said last when it asks; else what it said
 *  last (an idle agent with nothing said gives its idle reason; a working one's activity line is drawn apart). */
export function dialogWords(agent: AgentVM, entries: AgentEntry[], activeQuestion: number): DialogWords {
    const said = latestMessageText(entries);
    if (agent.state === "asking") {
        const qs = agent.ask?.questions ?? [];
        const q = qs.length > 0 ? qs[Math.min(Math.max(activeQuestion, 0), qs.length - 1)] : undefined;
        return { said, main: q?.question ?? terminalAskNote(agent) };
    }
    return { said: said ?? (agent.state === "idle" ? agent.activity : undefined) };
}

export interface QuestionTabs {
    // the question the ▶ menu answers: its short header when it has one
    head: string;
    at: number;
    of: number;
}

/** Pure: the tab over a several-part ask's answers (canvas States): the question it is on, and which of how many.
 *  Nothing for one question. */
export function questionTabs(agent: AgentVM, activeQuestion: number): QuestionTabs | undefined {
    const qs = agent.state === "asking" ? (agent.ask?.questions ?? []) : [];
    if (qs.length < 2) {
        return undefined;
    }
    const at = Math.min(Math.max(activeQuestion, 0), qs.length - 1);
    return { head: qs[at].header || qs[at].question, at, of: qs.length };
}

/** Pure: the dialog box's foot line for an agent: its model, its session's tokens when known (liveTokensAtom), the
 *  context it has used, and how long it has waited, worked or idled. */
export function agentMeta(agent: AgentVM, now: number, tokens?: number): string {
    const ctx = agent.usage?.contextpct;
    const age = displayAgeMs(agent, now);
    const verb = agent.state === "asking" ? "waiting " : agent.state === "idle" ? "idle " : "";
    return [
        agent.model,
        tokens ? `${formatTokens(tokens)} tokens` : undefined,
        ctx != null ? `${Math.round(ctx)}% context` : undefined,
        age != null ? `${verb}${formatAgeShort(age)}` : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
}

/** Pure: a run's task column in the dialog box: the live rows, then the waiting ones (the done ones when nothing else
 *  is left), at most `max`, under a heading that counts them. Empty before a plan. */
export function runTaskList<T>(
    rows: T[],
    waiting: T[],
    done: T[],
    max: number
): { heading: string; shown: T[]; more: number } {
    const all = rows.length + waiting.length > 0 ? [...rows, ...waiting] : done;
    if (all.length === 0) {
        return { heading: "", shown: [], more: 0 };
    }
    const heading =
        rows.length > 0 && waiting.length > 0
            ? `Working · ${rows.length}, waiting · ${waiting.length}`
            : rows.length > 0
              ? `Working · ${rows.length}`
              : waiting.length > 0
                ? `Waiting · ${waiting.length}`
                : `Done · ${done.length}`;
    return { heading, shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
