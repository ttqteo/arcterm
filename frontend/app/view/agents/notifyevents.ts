// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what is worth telling you, and where. diffEvents turns two snapshots of the roster and the attention list into
// edge events (an agent starts asking, finishes a turn, a decision item appears); routeNotify sends each to an OS toast
// while arcterm is in the background, an in-app toast or Sprout's bubble while it is focused, Sprout's bubble while
// folded, or nowhere for the agent you are looking at; coalesce folds a burst into one summary. NotifySync (notifysync.tsx) wires it up. No React, no store.

import type { ToastEyebrow, ToastNotification } from "@/app/cockpit/notificationstore";
import type { PetEvent } from "@/app/view/jarvis/petvoice";
import type { AgentState, AgentVM } from "./agentsviewmodel";
import type { WindowSize } from "./windowsize";

export type NotifyTarget =
    | { kind: "agent"; agentId: string }
    | { kind: "attention"; key: string }
    | { kind: "cockpit" }
    | { kind: "none" };

// how an event reads at a glance: amber for something blocked on you, green for a finished turn
export type NotifyTone = "asking" | "done" | "info";

export interface NotifyEvent {
    kind: "request" | "reply" | "attention" | "notify" | "summary";
    target: NotifyTarget;
    // the kind in words ("Needs you", "Finished"), shown above the title so the title is only the agent or item
    label: string;
    tone: NotifyTone;
    title: string;
    body: string;
    // where it comes from: the agent's project, or the channel
    meta?: string;
    // the agent's harness (claude, pi, …), for its mark beside the project
    runtime?: string;
    // a sound and a taskbar flash: something is blocked on you
    loud: boolean;
    // a request from an agent stopped at a prompt (a permission prompt): no agent:ask carries it to the pet
    atPrompt?: boolean;
}

interface AgentSnap {
    state: AgentState;
    name: string;
    task: string;
    project?: string;
    runtime?: string;
    runId?: string;
    question?: string;
    atPrompt?: boolean;
}

export interface NotifySnapshot {
    agents: ReadonlyMap<string, AgentSnap>;
    attention: ReadonlyMap<string, AttentionItem>;
    // false until the first attention poll lands, so the list it brings is a baseline rather than news
    attentionLoaded: boolean;
}

// attention kinds that wait on a decision of yours. An ask is left to the roster (its agent turns asking) and radar
// triage is a backlog, not a block. A chunk that came due is a decision you dated yourself, told once when it comes.
export const DECISION_KINDS: ReadonlySet<string> = new Set([
    "gate",
    "escalation",
    "dag-gate",
    "dag-blocked",
    "run-land-held",
    "run-unverified",
    "chunk-due",
]);

export function snapshotOf(
    agents: readonly AgentVM[],
    attention: readonly AttentionItem[],
    loaded: boolean
): NotifySnapshot {
    return {
        agents: new Map(
            agents.map((a) => [
                a.id,
                {
                    state: a.state,
                    name: a.name,
                    task: a.task,
                    project: a.project,
                    runtime: a.agent,
                    runId: a.runId,
                    question: a.ask?.questions?.[0]?.question?.split("\n")[0],
                    atPrompt: a.atPrompt,
                },
            ])
        ),
        attention: new Map(attention.filter((i) => DECISION_KINDS.has(i.kind)).map((i) => [i.key, i])),
        attentionLoaded: loaded,
    };
}

/** Pure: the events between two snapshots. The first snapshot is a baseline, and so is an agent seen for the first
 *  time: a reload or a websocket reconnect refills the roster, and that is not news. */
export function diffEvents(prev: NotifySnapshot | null, next: NotifySnapshot): NotifyEvent[] {
    if (prev == null) {
        return [];
    }
    const out: NotifyEvent[] = [];
    for (const [id, a] of next.agents) {
        const before = prev.agents.get(id);
        if (before == null) {
            continue;
        }
        if (a.state === "asking" && before.state !== "asking") {
            out.push({
                kind: "request",
                target: { kind: "agent", agentId: id },
                label: "Needs you",
                tone: "asking",
                title: a.name,
                body: a.question ?? "Waiting for your input",
                meta: a.project,
                runtime: a.runtime,
                loud: true,
                atPrompt: a.atPrompt,
            });
        } else if (a.state === "idle" && before.state === "working" && a.runId == null) {
            out.push({
                kind: "reply",
                target: { kind: "agent", agentId: id },
                label: "Finished",
                tone: "done",
                title: a.name,
                body: a.task && a.task !== a.name ? a.task : "",
                meta: a.project,
                runtime: a.runtime,
                loud: false,
            });
        }
    }
    if (prev.attentionLoaded) {
        for (const [key, i] of next.attention) {
            if (!prev.attention.has(key)) {
                // a due chunk's text is the chunk; the initiative it belongs to says more than its date
                const due = i.kind === "chunk-due";
                out.push({
                    kind: "attention",
                    target: { kind: "attention", key },
                    label: due ? "Due" : "Decision",
                    tone: "asking",
                    title: i.text,
                    body: due ? i.source : (i.why ?? i.source),
                    meta: i.channelname ? `#${i.channelname}` : undefined,
                    loud: true,
                });
            }
        }
    }
    return out;
}

/** Pure: a `wsh notify` as an event; null for one with nothing to say. */
export function notifyEventOf(data: NotifyCommandData | undefined): NotifyEvent | null {
    if (data == null || (!data.title && !data.message)) {
        return null;
    }
    return {
        kind: "notify",
        target: { kind: "none" },
        label: "Message",
        tone: "info",
        title: data.title || data.message,
        body: data.title ? data.message : "",
        loud: false,
    };
}

/** Pure: the target an OS toast hands back on click (notify.rs emits the JSON notify_os was given); none for anything
 *  unreadable. */
export function parseTarget(raw: unknown): NotifyTarget {
    try {
        const t = JSON.parse(String(raw)) as NotifyTarget | null;
        return t?.kind ? t : { kind: "none" };
    } catch {
        return { kind: "none" };
    }
}

export interface RouteCtx {
    focused: boolean;
    // the window's size (windowsize.ts): in Float and folded, Sprout says what a toast said
    size: WindowSize;
    viewing: ReadonlySet<string>;
    settings: { os: boolean; toast: boolean; reply: boolean };
}

export type NotifyRoute = "os" | "toast" | "avatar" | "none";

/** Pure: where one event goes. While focused, a `wsh notify` and anything that needs you are the avatar's (Sprout's
 *  bubble, petsources.tsx), so the two never say the same thing in the same corner; in Float, where Sprout walks the
 *  ledge, a finished turn is too. Folded, Sprout floats over every app, so it says everything, whichever app is in
 *  front, and the hidden terminal is not in view. */
export function routeNotify(e: NotifyEvent, ctx: RouteCtx): NotifyRoute {
    if (e.kind === "reply" && !ctx.settings.reply) {
        return "none";
    }
    if (ctx.size === "sprout") {
        // in the background, Sprout may be on another Space or under a fullscreen app: what needs you reaches the OS
        // too (saysOnSprout keeps the bubble)
        return !ctx.focused && e.loud && ctx.settings.os ? "os" : "avatar";
    }
    if (!ctx.focused) {
        return ctx.settings.os ? "os" : "none";
    }
    if (e.target.kind === "agent" && ctx.viewing.has(e.target.agentId)) {
        return "none";
    }
    const pets = e.kind === "notify" || e.kind === "request" || e.kind === "attention";
    if (pets || ctx.size === "float") {
        return "avatar";
    }
    return ctx.settings.toast ? "toast" : "none";
}

/** Pure: what Sprout says in place of a toast. A decision, and (in Float and folded) a finished turn, which opens its
 *  agent, and a permission prompt. An agent's question is not one: it reaches the pet from its own agent:ask event,
 *  which also retracts it once answered; a `wsh notify` from its own notify event. */
export function petEventOf(e: NotifyEvent, nowMs: number, size: WindowSize): PetEvent | null {
    if (e.kind === "attention" && e.target.kind === "attention") {
        return { id: `needs:${e.target.key}`, at: nowMs, kind: "ask", text: e.title };
    }
    if (e.kind === "reply" && e.target.kind === "agent") {
        return {
            id: `reply:${e.target.agentId}:${nowMs}`,
            at: nowMs,
            kind: "notify",
            text: `${e.title} finished`,
            detail: e.body || undefined,
            sources: [{ ref: `agent:${e.target.agentId}`, title: e.title, sourceType: "" }],
        };
    }
    // a permission prompt: in Full the agent's row and the nav badge say it, in Float and folded only Sprout can
    if (e.kind === "request" && e.atPrompt && size !== "full" && e.target.kind === "agent") {
        return {
            id: `request:${e.target.agentId}:${nowMs}`,
            at: nowMs,
            kind: "ask",
            text: e.body,
            sources: [{ ref: `agent:${e.target.agentId}`, title: e.title, sourceType: "" }],
        };
    }
    return null;
}

/** Pure: whether Sprout says an event: what routeNotify gave it, and folded anything not dropped, since the bubble is
 *  how a folded window speaks even when the OS speaks too. */
export function saysOnSprout(route: NotifyRoute, size: WindowSize): boolean {
    return route === "avatar" || (size === "sprout" && route !== "none");
}

export const COALESCE_MS = 2000;
const SUMMARY_AT = 3;

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Pure: a burst of three or more events becomes one summary that opens the Cockpit. */
export function coalesce(events: NotifyEvent[]): NotifyEvent[] {
    if (events.length < SUMMARY_AT) {
        return events;
    }
    const waiting = events.filter((e) => e.kind === "request" || e.kind === "attention").length;
    const replied = events.filter((e) => e.kind === "reply").length;
    const messages = events.length - waiting - replied;
    const parts = [
        waiting > 0 ? `${waiting} waiting on you` : "",
        replied > 0 ? `${replied} replied` : "",
        messages > 0 ? plural(messages, "message", "messages") : "",
    ].filter(Boolean);
    return [
        {
            kind: "summary",
            target: { kind: "cockpit" },
            label: waiting > 0 ? "Needs you" : replied > 0 ? "Finished" : "Messages",
            tone: waiting > 0 ? "asking" : replied > 0 ? "done" : "info",
            title: parts.join(" · "),
            body: "",
            loud: events.some((e) => e.loud),
        },
    ];
}

/** Pure: an OS toast has no eyebrow row, so the project and the kind lead its title ("[arcterm] Finished: <agent>").
 *  The line below is the agent's answer when NotifySync could read one (answerLine), else the event's body. */
export function osText(e: NotifyEvent, answer?: string): { title: string; body: string } {
    if (e.kind === "summary") {
        return { title: e.title, body: [e.body, e.meta].filter(Boolean).join(" · ") };
    }
    const project = e.meta ? `[${e.meta}] ` : "";
    return { title: `${project}${e.label}: ${e.title}`, body: answer || e.body };
}

const ANSWER_LINE_MAX = 80;

/** Pure: what an OS toast shows of an agent's last answer: the first sentence of its first line with text, markdown
 *  marks dropped, cut at a word past ANSWER_LINE_MAX characters, so the banner stays one line. */
export function answerLine(answer: string): string {
    for (const raw of answer.split("\n")) {
        if (raw.trim().startsWith("```")) {
            continue;
        }
        const line = raw
            .replace(/^\s*(?:#+\s+|>\s*)*/, "")
            .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\*\*|__|`/g, "")
            .trim();
        if (line === "") {
            continue;
        }
        // a sentence ends at . ! or ? followed by a space, so v0.15.4 and notifyevents.ts stay whole
        const sentence = line.match(/^.*?[.!?](?=\s)/)?.[0] ?? line;
        if (sentence.length <= ANSWER_LINE_MAX) {
            return sentence;
        }
        const cut = sentence.slice(0, ANSWER_LINE_MAX);
        const space = cut.lastIndexOf(" ");
        return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
    }
    return "";
}

const TOAST_ICON: Record<NotifyEvent["kind"], ToastEyebrow["icon"]> = {
    request: "ask",
    reply: "done",
    attention: "decision",
    notify: "message",
    summary: "summary",
};

// something blocked on you stays up long enough to be read; a finished turn is the default six seconds
export const ASKING_TOAST_TTL_MS = 15000;

/** Pure: the in-app toast for an event, short of its open action. */
export function toastOf(e: NotifyEvent): Omit<ToastNotification, "id" | "onOpen"> {
    return {
        title: e.title,
        message: e.body,
        level: "info",
        eyebrow: { label: e.label, tone: e.tone, icon: TOAST_ICON[e.kind], meta: e.meta, runtime: e.runtime },
        ttlMs: e.tone === "asking" ? ASKING_TOAST_TTL_MS : undefined,
    };
}
