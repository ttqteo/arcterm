// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    answerLine,
    coalesce,
    diffEvents,
    notifyEventOf,
    osText,
    parseTarget,
    petEventOf,
    routeNotify,
    snapshotOf,
    toastOf,
    type NotifyEvent,
    type RouteCtx,
} from "./notifyevents";

const agent = (id: string, state: AgentVM["state"], extra: Partial<AgentVM> = {}): AgentVM =>
    ({ id, name: `agent ${id}`, task: `task ${id}`, state, ...extra }) as AgentVM;
const item = (key: string, kind = "gate"): AttentionItem =>
    ({ kind, key, source: "lead", text: `decide ${key}`, action: "", phaseidx: 0, waitingsince: 0 }) as AttentionItem;
const snap = (agents: AgentVM[], attention: AttentionItem[] = [], loaded = true) =>
    snapshotOf(agents, attention, loaded);

describe("diffEvents", () => {
    it("emits nothing for the first snapshot", () => {
        expect(diffEvents(null, snap([agent("a", "asking")], [item("g1")]))).toEqual([]);
    });
    it("emits a loud request when a known agent starts asking", () => {
        const [e] = diffEvents(snap([agent("a", "working")]), snap([agent("a", "asking")]));
        expect(e).toMatchObject({
            kind: "request",
            target: { kind: "agent", agentId: "a" },
            label: "Needs you",
            tone: "asking",
            loud: true,
        });
        expect(e.title).toBe("agent a");
    });
    it("uses the ask's first question line as the body", () => {
        const asking = agent("a", "asking", {
            ask: { questions: [{ question: "Pick one\nmore" }] } as unknown as AgentVM["ask"],
        });
        expect(diffEvents(snap([agent("a", "working")]), snap([asking]))[0].body).toBe("Pick one");
    });
    it("does not repeat a request while the agent keeps asking", () => {
        expect(diffEvents(snap([agent("a", "asking")]), snap([agent("a", "asking")]))).toEqual([]);
    });
    it("ignores an agent it has not seen before, whatever its state", () => {
        expect(diffEvents(snap([]), snap([agent("a", "asking")]))).toEqual([]);
    });
    it("emits a quiet reply on working -> idle", () => {
        const [e] = diffEvents(snap([agent("a", "working")]), snap([agent("a", "idle")]));
        expect(e).toMatchObject({
            kind: "reply",
            target: { kind: "agent", agentId: "a" },
            label: "Finished",
            tone: "done",
            loud: false,
        });
        expect(e.title).toBe("agent a");
        expect(e.body).toBe("task a");
    });
    it("names the agent's project, and drops a task that only repeats the name", () => {
        const before = agent("a", "working", { task: "agent a", project: "arcterm" });
        const [e] = diffEvents(snap([before]), snap([{ ...before, state: "idle" }]));
        expect(e.body).toBe("");
        expect(e.meta).toBe("arcterm");
    });
    it("emits no reply for an agent working for a run", () => {
        expect(
            diffEvents(snap([agent("w", "working", { runId: "r1" })]), snap([agent("w", "idle", { runId: "r1" })]))
        ).toEqual([]);
    });
    it("emits a loud attention event for a new decision item, once", () => {
        const before = snap([], [item("g1")]);
        const after = snap([], [item("g1"), item("g2", "run-land-held")]);
        const evs = diffEvents(before, after);
        expect(evs).toHaveLength(1);
        expect(evs[0]).toMatchObject({
            kind: "attention",
            target: { kind: "attention", key: "g2" },
            label: "Decision",
            tone: "asking",
            title: "decide g2",
            loud: true,
        });
        expect(diffEvents(after, after)).toEqual([]);
    });
    it("skips asks and radar triage in attention (the roster covers asks)", () => {
        expect(diffEvents(snap([], []), snap([], [item("ask:b", "ask"), item("r", "radar-triage")]))).toEqual([]);
    });
    it("takes the first loaded attention list as a baseline", () => {
        expect(diffEvents(snap([], [], false), snap([], [item("g1")], true))).toEqual([]);
    });
    it("fires an item again after it left the list and came back", () => {
        // the model keeps no seen set: the previous snapshot is the memory, so an item absent from it is new
        expect(diffEvents(snap([], []), snap([], [item("g1")]))).toHaveLength(1);
    });
});

describe("notifyEventOf", () => {
    it("maps a wsh notify to a quiet notify event", () => {
        expect(notifyEventOf({ title: "Build", message: "done", level: "info" })).toMatchObject({
            kind: "notify",
            title: "Build",
            body: "done",
            loud: false,
            target: { kind: "none" },
        });
    });
    it("drops an empty one", () => {
        expect(notifyEventOf(undefined)).toBeNull();
        expect(notifyEventOf({ title: "", message: "", level: "info" })).toBeNull();
    });
});

describe("parseTarget", () => {
    it("reads the target an OS toast carried back", () => {
        expect(parseTarget('{"kind":"agent","agentId":"a"}')).toEqual({ kind: "agent", agentId: "a" });
    });
    it("falls back to none for garbage or a payload with no kind", () => {
        expect(parseTarget("not json")).toEqual({ kind: "none" });
        expect(parseTarget("{}")).toEqual({ kind: "none" });
        expect(parseTarget(undefined)).toEqual({ kind: "none" });
    });
});

const ctx = (over: Partial<RouteCtx> = {}): RouteCtx => ({
    focused: true,
    size: "full",
    viewing: new Set(),
    settings: { os: true, toast: true, reply: true },
    ...over,
});
const ev = (kind: NotifyEvent["kind"], agentId = "a"): NotifyEvent => ({
    kind,
    target: kind === "notify" ? { kind: "none" } : { kind: "agent", agentId },
    label: kind,
    tone: "info",
    title: "t",
    body: "",
    loud: kind === "request",
});

describe("routeNotify", () => {
    // the pet's bubble says it, and you are already looking at the pet's "?": a toast too would say it twice
    it("leaves a focused request to the pet", () => expect(routeNotify(ev("request"), ctx())).toBe("avatar"));
    it("leaves a focused decision to the pet", () => expect(routeNotify(ev("attention"), ctx())).toBe("avatar"));
    it("leaves it to the pet even with in-app toasts off", () =>
        expect(routeNotify(ev("request"), ctx({ settings: { os: true, toast: false, reply: true } }))).toBe("avatar"));
    it("toasts a focused finished turn", () => expect(routeNotify(ev("reply"), ctx())).toBe("toast"));
    // in Float, Sprout walks the ledge and says what a toast said, a finished turn included
    it("leaves a request in Float to Sprout", () =>
        expect(routeNotify(ev("request"), ctx({ size: "float" }))).toBe("avatar"));
    it("leaves a wsh notify in Float to Sprout", () =>
        expect(routeNotify(ev("notify"), ctx({ size: "float" }))).toBe("avatar"));
    it("says a finished turn in Float as Sprout's bubble", () =>
        expect(routeNotify(ev("reply"), ctx({ size: "float" }))).toBe("avatar"));
    it("still sends a backgrounded Float's news to the OS", () =>
        expect(routeNotify(ev("request"), ctx({ size: "float", focused: false }))).toBe("os"));
    // folded, Sprout floats over every app: it says everything, whichever app is in front
    it("sends everything to the folded Sprout, focused or not", () => {
        for (const kind of ["request", "reply", "notify", "attention"] as const) {
            expect(routeNotify(ev(kind), ctx({ size: "sprout", focused: false }))).toBe("avatar");
            expect(routeNotify(ev(kind), ctx({ size: "sprout" }))).toBe("avatar");
        }
    });
    // the floated terminal is hidden while folded: its agent is not in view
    it("has nothing in view while folded", () =>
        expect(routeNotify(ev("request"), ctx({ size: "sprout", viewing: new Set(["a"]) }))).toBe("avatar"));
    it("honours notify:reply off while folded", () =>
        expect(
            routeNotify(ev("reply"), ctx({ size: "sprout", settings: { os: true, toast: true, reply: false } }))
        ).toBe("none"));
    it("goes to the OS while backgrounded", () =>
        expect(routeNotify(ev("request"), ctx({ focused: false }))).toBe("os"));
    it("says nothing about the agent in view", () =>
        expect(routeNotify(ev("request"), ctx({ viewing: new Set(["a"]) }))).toBe("none"));
    it("leaves a focused wsh notify to the avatar", () => expect(routeNotify(ev("notify"), ctx())).toBe("avatar"));
    it("sends a backgrounded wsh notify to the OS", () =>
        expect(routeNotify(ev("notify"), ctx({ focused: false }))).toBe("os"));
    it("honours notify:os off", () =>
        expect(
            routeNotify(ev("request"), ctx({ focused: false, settings: { os: false, toast: true, reply: true } }))
        ).toBe("none"));
    it("honours notify:toast off", () =>
        expect(routeNotify(ev("reply"), ctx({ settings: { os: true, toast: false, reply: true } }))).toBe("none"));
    it("honours notify:reply off, focused or not", () => {
        const off = { os: true, toast: true, reply: false };
        expect(routeNotify(ev("reply"), ctx({ settings: off }))).toBe("none");
        expect(routeNotify(ev("reply"), ctx({ focused: false, settings: off }))).toBe("none");
    });
});

describe("petEventOf", () => {
    const decision: NotifyEvent = {
        kind: "attention",
        target: { kind: "attention", key: "gate:r1" },
        label: "Decision",
        tone: "asking",
        title: "Review the plan for run r1",
        body: "lead",
        loud: true,
    };

    it("says a decision as a Needs-you utterance keyed by its item", () => {
        expect(petEventOf(decision, 1000)).toEqual({
            id: "needs:gate:r1",
            at: 1000,
            kind: "ask",
            text: "Review the plan for run r1",
        });
    });

    // an agent's question and a wsh notify already reach the pet from their own events
    it("leaves an agent's request and a wsh notify to the pet's own sources", () => {
        expect(petEventOf(ev("request"), 1000)).toBeNull();
        expect(petEventOf(ev("notify"), 1000)).toBeNull();
    });

    it("says a finished turn, which opens its agent", () => {
        const done: NotifyEvent = { ...ev("reply", "t1"), title: "loom", body: "Fix the race" };
        expect(petEventOf(done, 1000)).toEqual({
            id: "reply:t1:1000",
            at: 1000,
            kind: "notify",
            text: "loom finished",
            detail: "Fix the race",
            sources: [{ ref: "agent:t1", title: "loom", sourceType: "" }],
        });
    });
});

describe("coalesce", () => {
    it("passes one or two events through", () => {
        const two = [ev("request"), ev("reply", "b")];
        expect(coalesce(two)).toEqual(two);
    });
    it("folds three or more into one summary on the Cockpit", () => {
        const [s, ...rest] = coalesce([ev("request"), ev("request", "b"), ev("reply", "c"), ev("notify")]);
        expect(rest).toEqual([]);
        expect(s).toMatchObject({
            kind: "summary",
            target: { kind: "cockpit" },
            label: "Needs you",
            tone: "asking",
            loud: true,
        });
        expect(s.title).toBe("2 waiting on you · 1 replied · 1 message");
    });
    it("is quiet when nothing in it is loud", () => {
        expect(coalesce([ev("reply"), ev("reply", "b"), ev("reply", "c")])[0]).toMatchObject({
            loud: false,
            title: "3 replied",
        });
    });
});

describe("osText", () => {
    const e = (over: Partial<NotifyEvent>): NotifyEvent => ({ ...ev("reply"), ...over });
    it("leads the title with the project and the kind, since an OS toast has no eyebrow", () => {
        expect(osText(e({ label: "Finished", title: "Hỗ trợ LaTeX", body: "", meta: "arcterm" }))).toEqual({
            title: "[arcterm] Finished: Hỗ trợ LaTeX",
            body: "",
        });
    });
    it("keeps the body on the line below, without the project", () => {
        expect(osText(e({ label: "Needs you", title: "a", body: "Pick one", meta: "arcterm" }))).toEqual({
            title: "[arcterm] Needs you: a",
            body: "Pick one",
        });
    });
    it("has no brackets without a project", () => {
        expect(osText(e({ label: "Finished", title: "a", body: "", meta: undefined })).title).toBe("Finished: a");
    });
    it("puts the agent's answer below in place of the body", () => {
        expect(
            osText(e({ label: "Finished", title: "a", body: "task a", meta: "arcterm" }), "Done: tests pass.")
        ).toEqual({
            title: "[arcterm] Finished: a",
            body: "Done: tests pass.",
        });
    });
    it("leaves a summary's title alone", () => {
        expect(osText(e({ kind: "summary", label: "Needs you", title: "2 waiting on you" })).title).toBe(
            "2 waiting on you"
        );
    });
});

describe("toastOf", () => {
    it("gives an ask the question icon, its harness and a longer life", () => {
        const before = agent("a", "working", { agent: "claude", project: "arcterm" });
        const [e] = diffEvents(snap([before]), snap([{ ...before, state: "asking" }]));
        expect(toastOf(e)).toMatchObject({
            title: "agent a",
            eyebrow: { label: "Needs you", tone: "asking", icon: "ask", meta: "arcterm", runtime: "claude" },
            ttlMs: 15000,
        });
    });
    it("gives a finished turn the check icon and the default life", () => {
        const before = agent("a", "working");
        const [e] = diffEvents(snap([before]), snap([{ ...before, state: "idle" }]));
        const t = toastOf(e);
        expect(t.eyebrow?.icon).toBe("done");
        expect(t.ttlMs).toBeUndefined();
    });
    it("marks a decision and a summary by their own icons", () => {
        expect(toastOf({ ...ev("attention"), tone: "asking" }).eyebrow?.icon).toBe("decision");
        expect(toastOf({ ...ev("summary"), tone: "done" }).eyebrow?.icon).toBe("summary");
    });
});

describe("answerLine", () => {
    it("is the answer's first line with text", () => {
        expect(answerLine("\n\nShortcut done and documented.\n\n- Drop: it falls")).toBe(
            "Shortcut done and documented."
        );
    });
    it("drops markdown marks", () => {
        expect(answerLine("## **Done:** the `g w` shortcut opens the [peek](x.md)")).toBe(
            "Done: the g w shortcut opens the peek"
        );
        expect(answerLine("> - **Drop:** it falls")).toBe("Drop: it falls");
    });
    it("keeps only the first sentence", () => {
        expect(answerLine("Shortcut done and documented. Adding the changelog lines, then the tests.")).toBe(
            "Shortcut done and documented."
        );
        expect(answerLine("Done! Next up: tests.")).toBe("Done!");
    });
    it("does not end a sentence inside a version or a file name", () => {
        expect(answerLine("Built v0.15.4 from notifyevents.ts and installed it.")).toBe(
            "Built v0.15.4 from notifyevents.ts and installed it."
        );
    });
    it("cuts a long sentence at a word and marks it", () => {
        const line = answerLine("word ".repeat(60));
        expect(line.length).toBeLessThanOrEqual(81);
        expect(line.endsWith("…")).toBe(true);
        expect(line).not.toMatch(/\s…$/);
    });
    it("is empty for an empty answer", () => {
        expect(answerLine("")).toBe("");
        expect(answerLine("  \n ```\n")).toBe("");
    });
});
