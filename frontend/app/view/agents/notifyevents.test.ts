// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    coalesce,
    diffEvents,
    notifyEventOf,
    osText,
    parseTarget,
    routeNotify,
    snapshotOf,
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
    it("toasts while focused", () => expect(routeNotify(ev("request"), ctx())).toBe("toast"));
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
        expect(routeNotify(ev("request"), ctx({ settings: { os: true, toast: false, reply: true } }))).toBe("none"));
    it("honours notify:reply off, focused or not", () => {
        const off = { os: true, toast: true, reply: false };
        expect(routeNotify(ev("reply"), ctx({ settings: off }))).toBe("none");
        expect(routeNotify(ev("reply"), ctx({ focused: false, settings: off }))).toBe("none");
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
    it("leads the title with the kind, since an OS toast has no eyebrow", () => {
        expect(osText(e({ label: "Finished", title: "Hỗ trợ LaTeX", body: "", meta: "arcterm" }))).toEqual({
            title: "Finished: Hỗ trợ LaTeX",
            body: "arcterm",
        });
    });
    it("keeps the body before the project", () => {
        expect(osText(e({ label: "Needs you", title: "a", body: "Pick one", meta: "arcterm" })).body).toBe(
            "Pick one · arcterm"
        );
    });
    it("leaves a summary's title alone", () => {
        expect(osText(e({ kind: "summary", label: "Needs you", title: "2 waiting on you" })).title).toBe(
            "2 waiting on you"
        );
    });
});
