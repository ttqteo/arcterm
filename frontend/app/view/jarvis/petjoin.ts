// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The join between the backend reads and the creature's pure modules: three adapters, one per source.
// Pure and separate from petsources.tsx for the same reason petcondition.ts is separate from petview.tsx
// (design §5) — the wire shapes are the part most likely to change, and an adapter is testable without a
// websocket.
//
// Every adapter is total: a shape it does not recognise yields undefined/null rather than a guess. That is
// the no-guessing property (design §2) applied at the boundary where it is easiest to lose.

import type { PetEvent } from "./petvoice";
import { ageLabel } from "./recallderive";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { detailOf } from "@/app/view/agents/runtimeline";

// The launch narrative. The id has to be stable across relaunches or the creature re-says "where we were"
// on every start; keying it to the run plus the narrative's own timestamp makes it stable until a NEW
// narrative is written, which is exactly when it should speak again.
//
// `card.updated` is epoch milliseconds (pkg/jarvisdossier/parse.go stamps it with UnixMilli), the same unit
// every other source carries — so the watermark orders them against each other correctly.
export function eventFromResume(rtn: CommandGetLatestResumeRtnData | null | undefined): PetEvent | null {
    const card = rtn?.card;
    const summary = card?.summary?.trim();
    if (card == null || !summary) {
        return null;
    }
    const at = card.updated > 0 ? card.updated : 0;
    if (at === 0) {
        return null; // undatable: the watermark could never advance past it, so it would re-speak forever
    }
    return {
        id: `resume:${rtn?.runoref ?? card.taskId}:${at}`,
        at,
        kind: "resume",
        text: `Where we were: ${summary}`,
    };
}

const VOLUNTEER_KINDS = ["connection", "loose-end", "ledger"] as const;
type VolunteerKind = (typeof VOLUNTEER_KINDS)[number];

// The backend stamps id and at from the FACT, not from emission time, so an unchanged fact re-emitted
// after a restart carries an identical pair and nextUtterance discards it against the watermark. This
// adapter must therefore pass both through untouched — deriving either here would break say-once.
//
// A payload with no `ref` still speaks; it just carries no source, so the peek grows no Open.
// The backend drops an address it could not resolve rather than faking one, and a bubble with nothing
// to open is better than a button that navigates nowhere.
export function eventFromVolunteer(d: VolunteerData | null | undefined): PetEvent | null {
    const cls = d?.class;
    if (d == null || cls == null || !(VOLUNTEER_KINDS as readonly string[]).includes(cls)) {
        return null;
    }
    if (!d.id || !d.at) {
        return null; // no stable id or no timestamp means the watermark cannot order it
    }
    const title = d.title?.trim() ?? "";
    const body = d.text?.trim() ?? "";
    if (!title && !body) {
        return null;
    }
    return {
        id: d.id,
        at: d.at,
        kind: cls as VolunteerKind,
        text: body ? `${title} - ${body}` : title,
        sources: d.ref
            ? [{ ref: d.ref, anchor: d.anchor || undefined, title: title || d.ref, sourceType: d.sourcetype ?? "" }]
            : undefined,
    };
}

// A notification is a message from elsewhere, so the text passes through verbatim — rewriting it would
// be guessing (design §2). The title is the utterance; the message body rides as detail for the peek.
// The id is session-unique (`seq` from the caller): notify events are ephemeral wave events, so no
// cross-reload stability is needed, and the pair `nowMs`/`seq` keeps same-millisecond events distinct.
export function eventFromNotify(
    d: NotifyCommandData | null | undefined,
    nowMs: number,
    seq: number
): PetEvent | null {
    const title = d?.title?.trim() ?? "";
    if (!title) {
        return null;
    }
    return {
        id: `notify:${nowMs}:${seq}`,
        at: nowMs,
        kind: "notify",
        text: title,
        detail: d.message?.trim() || undefined,
        level: d.level === "error" || d.level === "warn" ? d.level : "info",
    };
}

// The machine slept (pkg/sleepwatch, system:slept). Said only when agents were working through it, because then the
// gap is what stalled them, and a run that sat still for forty minutes otherwise reads as a hung agent. The times
// are local and each within the watcher's 30-second tick of the real moment.
export function eventFromSlept(d: SleptData | null | undefined, working: number, isMac: boolean): PetEvent | null {
    if (d == null || !(d.to > d.from) || working <= 0) {
        return null;
    }
    const mins = Math.round((d.to - d.from) / 60_000);
    const span = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
    const clock = (ms: number) => {
        const t = new Date(ms);
        return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    };
    const who = working === 1 ? "1 agent was" : `${working} agents were`;
    return {
        id: `slept:${d.from}`,
        at: d.to,
        kind: "notify",
        level: "warn",
        text: `The ${isMac ? "Mac" : "PC"} slept for ${span}, from ${clock(d.from)} to ${clock(d.to)}, while ${who} working.`,
    };
}

// A run's branch merged back into its base. The run rides as the source, so the update peeks it from whatever
// surface the user is on. Keyed by run: a run lands once, so a re-delivered event cannot speak twice.
export function eventFromRunLanded(d: RunEventData | null | undefined): PetEvent | null {
    if (d?.event?.kind !== "landed" || !d.runid) {
        return null;
    }
    const title = detailOf<{ title?: string }>(d.event)?.title?.trim() ?? "";
    return {
        id: `landed:${d.runid}`,
        at: d.event.ts > 0 ? d.event.ts : Date.now(),
        kind: "notify",
        level: "info",
        text: `${title || "A run"} landed`,
        sources: [{ ref: `run:${d.runid}`, title: title || "the run", sourceType: "run" }],
    };
}

// The raise/clear pair shares the askid so the cleared event can retract the pending one. A raised ask
// without a question carries nothing to say; a cleared ask carries no utterance at all, only the retract.
export interface AskEventResult {
    event?: PetEvent;
    cancelId?: string;
}

export function eventFromAsk(d: AgentAskData | null | undefined): AskEventResult {
    if (d == null || !d.askid) {
        return {};
    }
    if (d.cleared) {
        return { cancelId: `ask:${d.askid}` };
    }
    const question = d.questions?.[0]?.question?.trim() ?? "";
    if (!question) {
        return {};
    }
    return {
        event: {
            id: `ask:${d.askid}`,
            at: d.ts > 0 ? d.ts : Date.now(),
            kind: "ask",
            text: question,
            ref: d.oref || undefined,
        },
    };
}

// The roster join: an ask's block oref matches the roster row's termBlockOref, whose id IS the tab the
// Agent surface focuses. `blockId` is the oref with the "block:" prefix stripped (agentsviewmodel.ts:519).
// The VM is returned whole: the gate needs the tab id, and the open affordance needs the name.
export function askAgent(agents: ReadonlyArray<AgentVM>, askOref: string | undefined): AgentVM | undefined {
    const oid = askOref?.split(":")[1];
    if (oid == null) {
        return undefined;
    }
    return agents.find((a) => a.blockId === oid);
}

// The focus gate (design §4.2): an ask you are already looking at is already reported — speaking it too
// would be the double-count the report-once rule exists to prevent. Suppressed when keyboard focus sits
// inside the ask's block (cockpit) or when the Agent surface is focused on that agent's tab. Everything
// else speaks. An oref the gate cannot match always speaks: absence of evidence is not suppression.
// The pet's bubble is where a focused arcterm says the question (notifyevents.ts routeNotify sends no toast); only in
// float mode, where the pet is not drawn, does the Needs-you toast say it, and then the pet leaves it to the toast.
export interface AskGateCtx {
    surface: string;
    focusTabId: string | undefined;
    askTabId: string | undefined;
    focusedBlockId: string | null;
    // a toast says the question (notifyevents.ts toastSaysAsk): focused, in float mode, with toasts on
    toastSays: boolean;
}

export function shouldSpeakAsk(askOref: string | undefined, ctx: AskGateCtx): boolean {
    if (ctx.toastSays) {
        return false;
    }
    if (askOref == null) {
        return true;
    }
    const oid = askOref.split(":")[1];
    if (oid != null && ctx.focusedBlockId != null && oid === ctx.focusedBlockId) {
        return false;
    }
    if (ctx.surface === "agent" && ctx.askTabId != null && ctx.askTabId === ctx.focusTabId) {
        return false;
    }
    return true;
}

// A background agent finishing is a presence→absence transition in the poll listing. The first load
// diffs against nothing (prev is empty) so it can never fabricate completions, and a dismissed id is
// excluded so the Dismiss button cannot fake one either. Each finisher is one event; the voice speaks
// the newest and the peek keeps the rest.
export function agentFinishedFromDiff(
    prev: ReadonlyArray<BackgroundAgentData>,
    next: ReadonlyArray<BackgroundAgentData>,
    dismissed: ReadonlySet<string>,
    nowMs: number
): PetEvent[] {
    const nextIds = new Set(next.filter((a) => a?.kind === "background").map((a) => a.sessionid));
    return prev
        .filter((a) => a?.kind === "background" && a.sessionid && !nextIds.has(a.sessionid) && !dismissed.has(a.sessionid))
        .map((a) => ({
            id: `bgdone:${a.sessionid}:${nowMs}`,
            at: nowMs,
            kind: "bg-agent-done",
            text: `${(a.name ?? "").trim() || "A background agent"} finished`,
        }));
}
