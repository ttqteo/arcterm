// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { eventFromResume, eventFromVolunteer } from "./petjoin";

describe("eventFromResume", () => {
    const card: ResumeCardData = {
        taskId: "t1",
        summary: "  paused at the migration step  ",
        status: "blocked",
        updated: 1_700_000_000_500,
    };

    it("speaks the narrative, trimmed", () => {
        const e = eventFromResume({ card, runoref: "run:abc" });
        expect(e?.kind).toBe("resume");
        expect(e?.at).toBe(1_700_000_000_500);
        expect(e?.text).toBe("Where we were: paused at the migration step");
    });

    // stability is the whole point: an id derived from the read time would re-say the same narrative on
    // every launch, which is the opposite of push-once.
    it("derives an id that is stable across reads and changes only with a new narrative", () => {
        const a = eventFromResume({ card, runoref: "run:abc" });
        const b = eventFromResume({ card, runoref: "run:abc" });
        expect(a?.id).toBe(b?.id);
        const later = eventFromResume({ card: { ...card, updated: 1_700_000_001_000 }, runoref: "run:abc" });
        expect(later?.id).not.toBe(a?.id);
    });

    it("falls back to the task id when no run oref came back", () => {
        expect(eventFromResume({ card })?.id).toContain("t1");
    });

    it("stays silent on an absent, empty or undatable narrative", () => {
        expect(eventFromResume({})).toBeNull();
        expect(eventFromResume(null)).toBeNull();
        expect(eventFromResume({ card: { ...card, summary: "   " } })).toBeNull();
        expect(eventFromResume({ card: { ...card, updated: 0 } })).toBeNull();
    });
});

describe("eventFromVolunteer", () => {
    const base: VolunteerData = {
        class: "loose-end",
        id: "loose-end:task-a:900",
        at: 900,
        title: "Finish the migration",
        text: "untouched for 21 days",
        sourcetype: "dossier",
        ref: "task:task-a",
    };

    // volunteered knowledge points at exactly one thing, so its `sources` list has exactly one entry — the
    // field is a list because a distillation pass carries several, not because this register ever does
    it("maps a payload to an utterance carrying its one source", () => {
        const ev = eventFromVolunteer(base);
        expect(ev).not.toBeNull();
        expect(ev!.kind).toBe("loose-end");
        expect(ev!.at).toBe(900);
        expect(ev!.text).toContain("Finish the migration");
        expect(ev!.sources).toEqual([
            {
                ref: "task:task-a",
                anchor: undefined,
                title: "Finish the migration",
                sourceType: "dossier",
            },
        ]);
    });

    it("carries an anchor through so a decision can name its card", () => {
        const ev = eventFromVolunteer({ ...base, class: "connection", ref: "task:task-p", anchor: "dec-abc123" });
        expect(ev!.sources?.[0].anchor).toBe("dec-abc123");
    });

    // a payload the backend could not address is still worth saying; it just grows no Open button
    it("keeps an utterance with no ref but leaves it sourceless", () => {
        const ev = eventFromVolunteer({ ...base, ref: "" });
        expect(ev).not.toBeNull();
        expect(ev!.sources).toBeUndefined();
    });

    it("rejects an unknown class rather than inventing a label", () => {
        expect(eventFromVolunteer({ ...base, class: "made-up" })).toBeNull();
    });

    it("rejects a payload with no stable id or no timestamp", () => {
        expect(eventFromVolunteer({ ...base, id: "" })).toBeNull();
        expect(eventFromVolunteer({ ...base, at: 0 })).toBeNull();
    });

    it("rejects an empty payload rather than speaking a blank bubble", () => {
        expect(eventFromVolunteer({ ...base, title: "  ", text: "  " })).toBeNull();
        expect(eventFromVolunteer(null)).toBeNull();
        expect(eventFromVolunteer(undefined)).toBeNull();
    });

    // the ledger register reports the state of your work, so its payload carries a run source
    it("maps the ledger class to an utterance with a run source", () => {
        const ev = eventFromVolunteer({
            class: "ledger",
            id: "shipped:run-1",
            at: 900,
            title: "shipped: ask bridge",
            text: "landed, changed 12 files",
            sourcetype: "run",
            ref: "run:run-1",
        });
        expect(ev?.kind).toBe("ledger");
        expect(ev?.text).toBe("shipped: ask bridge - landed, changed 12 files");
        expect(ev?.sources?.[0].ref).toBe("run:run-1");
    });
});

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import {
    agentFinishedFromDiff,
    askAgent,
    eventFromAsk,
    eventFromNotify,
    eventFromRunLanded,
    eventFromSlept,
    shouldSpeakAsk,
    type AskGateCtx,
} from "./petjoin";

function notify(over: Partial<NotifyCommandData> = {}): NotifyCommandData {
    return { title: "build finished", message: "all 214 tests green", level: "info", ...over };
}

describe("eventFromNotify", () => {
    it("turns a notification into an event: title is the utterance, message is the detail", () => {
        const e = eventFromNotify(notify(), 1000, 1);
        expect(e).toEqual({
            id: "notify:1000:1",
            at: 1000,
            kind: "notify",
            text: "build finished",
            detail: "all 214 tests green",
            level: "info",
        });
    });

    it("carries the level, and reads anything unrecognised as info", () => {
        expect(eventFromNotify(notify({ level: "error" }), 1000, 1)?.level).toBe("error");
        expect(eventFromNotify(notify({ level: "warn" }), 1000, 1)?.level).toBe("warn");
        expect(eventFromNotify(notify({ level: "loud" }), 1000, 1)?.level).toBe("info");
    });

    it("ignores a missing or empty title", () => {
        expect(eventFromNotify(null, 1000, 1)).toBeNull();
        expect(eventFromNotify(notify({ title: "" }), 1000, 1)).toBeNull();
    });

    it("leaves detail unset when there is no message", () => {
        expect(eventFromNotify(notify({ message: "" }), 1000, 2)?.detail).toBeUndefined();
    });
});

function ask(over: Partial<AgentAskData> = {}): AgentAskData {
    return {
        oref: "block:abc",
        askid: "ask-1",
        ts: 2000,
        questions: [{ question: "which rollout approach?", header: "Rollout", options: [] }],
        ...over,
    };
}

describe("eventFromAsk", () => {
    it("turns a raised ask into an event keyed by askid", () => {
        expect(eventFromAsk(ask())).toEqual({
            event: { id: "ask:ask-1", at: 2000, kind: "ask", text: "which rollout approach?", ref: "block:abc" },
        });
    });

    it("a cleared ask yields a cancel id, never an event", () => {
        expect(eventFromAsk(ask({ cleared: true }))).toEqual({ cancelId: "ask:ask-1" });
    });

    it("an ask with no questions, or no data at all, yields nothing", () => {
        expect(eventFromAsk(ask({ questions: [] }))).toEqual({});
        expect(eventFromAsk(null)).toEqual({});
    });
});

describe("askAgent", () => {
    it("finds the roster agent whose block matches the ask oref", () => {
        const agents = [{ id: "tab1", name: "radar-triage", blockId: "abc" } as unknown as AgentVM];
        expect(askAgent(agents, "block:abc")?.id).toBe("tab1");
    });

    it("yields undefined when nothing matches", () => {
        expect(askAgent([], "block:abc")).toBeUndefined();
    });
});

function gateCtx(over: Partial<AskGateCtx> = {}): AskGateCtx {
    return {
        surface: "jarvis",
        focusTabId: undefined,
        askTabId: undefined,
        focusedBlockId: null,
        folded: false,
        ...over,
    };
}

describe("shouldSpeakAsk", () => {
    it("suppresses when keyboard focus is inside the ask's block", () => {
        expect(shouldSpeakAsk("block:abc", gateCtx({ focusedBlockId: "abc" }))).toBe(false);
    });

    it("suppresses on the agent surface when that agent is focused", () => {
        expect(shouldSpeakAsk("block:abc", gateCtx({ surface: "agent", focusTabId: "tab1", askTabId: "tab1" }))).toBe(
            false
        );
    });

    it("speaks when a different agent is focused", () => {
        expect(shouldSpeakAsk("block:abc", gateCtx({ surface: "agent", focusTabId: "tab2", askTabId: "tab1" }))).toBe(
            true
        );
    });

    it("speaks when the ask's agent is not on the roster", () => {
        expect(
            shouldSpeakAsk("block:abc", gateCtx({ surface: "agent", focusTabId: "tab1", askTabId: undefined }))
        ).toBe(true);
    });

    it("speaks when there is no oref to match against", () => {
        expect(shouldSpeakAsk(undefined, gateCtx({ focusedBlockId: "abc" }))).toBe(true);
    });

    // folded, the terminal is hidden: the floated agent's question is Sprout's to say, as any other's
    it("speaks for the agent in focus while folded", () => {
        expect(
            shouldSpeakAsk(
                "block:abc",
                gateCtx({ folded: true, surface: "agent", askTabId: "t1", focusTabId: "t1", focusedBlockId: "abc" })
            )
        ).toBe(true);
    });
});

function bg(over: Partial<BackgroundAgentData> = {}): BackgroundAgentData {
    return {
        sessionid: "s1",
        cwd: "/x",
        kind: "background",
        name: "radar-triage",
        state: "working",
        startedts: 1,
        ...over,
    };
}

describe("eventFromRunLanded", () => {
    const landed = (kind: string, detail: unknown): RunEventData =>
        ({
            channelid: "c1",
            runid: "r1",
            event: { id: "e1", runid: "r1", channelid: "c1", ts: 5000, kind, detail },
        }) as any;

    it("says the run landed and carries the run to peek", () => {
        expect(eventFromRunLanded(landed("landed", { commit: "abc", title: "Coupon codes" }))).toEqual({
            id: "landed:r1",
            at: 5000,
            kind: "notify",
            level: "info",
            text: "Coupon codes landed",
            sources: [{ ref: "run:r1", title: "Coupon codes", sourceType: "run" }],
        });
    });

    it("ignores every other run event", () => {
        expect(eventFromRunLanded(landed("land-held", { reason: "x" }))).toBeNull();
        expect(eventFromRunLanded(undefined)).toBeNull();
    });

    it("still speaks without a title", () => {
        expect(eventFromRunLanded(landed("landed", null))?.text).toBe("A run landed");
    });
});

describe("agentFinishedFromDiff", () => {
    it("reports a background agent that disappeared between polls", () => {
        expect(agentFinishedFromDiff([bg()], [], new Set(), 3000)).toEqual([
            { id: "bgdone:s1:3000", at: 3000, kind: "bg-agent-done", text: "radar-triage finished" },
        ]);
    });

    it("ignores agents still present", () => {
        expect(agentFinishedFromDiff([bg()], [bg()], new Set(), 3000)).toEqual([]);
    });

    it("ignores dismissed ids", () => {
        expect(agentFinishedFromDiff([bg()], [], new Set(["s1"]), 3000)).toEqual([]);
    });

    it("ignores non-background entries", () => {
        expect(agentFinishedFromDiff([bg({ kind: "agent" })], [], new Set(), 3000)).toEqual([]);
    });

    it("never reports on a first load (empty prev)", () => {
        expect(agentFinishedFromDiff([], [bg()], new Set(), 3000)).toEqual([]);
    });

    it("falls back to a generic name when the agent has none", () => {
        expect(agentFinishedFromDiff([bg({ name: "" })], [], new Set(), 3000)[0]?.text).toBe(
            "A background agent finished"
        );
    });
});

// A run that stalls through a sleep reads as a hung agent; the gap says it was the machine. Local times, so the
// expectations are built from the same local clock the line is written in.
describe("eventFromSlept", () => {
    const from = new Date(2026, 9, 9, 14, 2).getTime();
    const to = new Date(2026, 9, 9, 14, 42).getTime();

    it("says how long the Mac slept, when, and how many agents it held up", () => {
        expect(eventFromSlept({ from, to }, 2, true)).toEqual({
            id: `slept:${from}`,
            at: to,
            kind: "notify",
            level: "warn",
            text: "The Mac slept for 40 min, from 14:02 to 14:42, while 2 agents were working.",
        });
    });

    it("counts one agent in the singular, and calls another machine a PC", () => {
        expect(eventFromSlept({ from, to }, 1, false)?.text).toBe(
            "The PC slept for 40 min, from 14:02 to 14:42, while 1 agent was working."
        );
    });

    it("words a long sleep in hours", () => {
        const late = new Date(2026, 9, 9, 16, 17).getTime();
        expect(eventFromSlept({ from, to: late }, 1, true)?.text).toBe(
            "The Mac slept for 2h 15m, from 14:02 to 16:17, while 1 agent was working."
        );
    });

    // a sleep with nothing running cost nothing, so it is not news
    it("says nothing when no agent was working", () => {
        expect(eventFromSlept({ from, to }, 0, true)).toBeNull();
    });

    it("says nothing for a payload it cannot read", () => {
        expect(eventFromSlept(undefined, 2, true)).toBeNull();
        expect(eventFromSlept({ from: to, to: from }, 2, true)).toBeNull();
    });
});
