// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { RunCardView } from "./chatbrainstorm";
import { queuedState, runBody, runTag } from "./chatruncardmodel";
import { queuedLabel } from "./chatruncards";
import { queuedRows } from "./runqueuemodel";

const RUN = "3fa21b0c-9d4e-4f6a-8b1c-0123456789ab";
const OTHER_RUN = "77c0de11-1111-4222-8333-444455556666";
const ENTRY = "q4k9x2mz";

const stage = { key: "working", label: "Working · 2 of 5 tasks", tone: "working", needsYou: false };
const view = (over: Partial<RunCardView> = {}): RunCardView =>
    ({ name: "Chat verdict handoff", kind: "Orchestrator run", stage, done: false, ...over }) as RunCardView;

describe("runBody", () => {
    it("is loading until the store has read the run", () => {
        expect(runBody(view({ stage: null }), false)).toEqual({ kind: "loading" });
    });

    it("says Arc cannot find a loaded run it does not know", () => {
        expect(runBody(view({ name: "", stage: null }), true)).toEqual({ kind: "missing" });
    });

    it("is the name and the stage line of a run Arc knows", () => {
        expect(runBody(view(), true)).toEqual({ kind: "shown", name: "Chat verdict handoff", line: stage });
    });
});

describe("runTag", () => {
    it("is Working for a live run and amber only when the run needs the person", () => {
        expect(runTag(true, false)).toBe("working");
        expect(runTag(true, true)).toBe("waiting");
    });

    it("is static once the agent exited, whatever the run needs", () => {
        expect(runTag(false, false)).toBe("static");
        expect(runTag(false, true)).toBe("static");
    });
});

describe("queuedState", () => {
    const entry = (over: Partial<RunQueueEntry> = {}): RunQueueEntry =>
        ({
            id: ENTRY,
            data: {},
            title: "Add a thing",
            projectpath: "/p",
            queuedts: 1,
            state: "waiting",
            ...over,
        }) as RunQueueEntry;
    const read = (
        queue: RunQueueEntry[],
        started: Record<string, string> = {},
        titles: Record<string, string> = {},
        landed: string[] = []
    ) => queuedState(ENTRY, queue, started, queuedRows(queue, titles, new Set(landed)));

    it("waits for room under the entry's own name, as an orchestrator run", () => {
        const s = read([entry()]);
        expect(s).toEqual({ view: { state: "waiting" }, name: "Add a thing", head: "Orchestrator run" });
        expect(queuedLabel(s.view)).toBe("Queued");
    });

    it("is a quick run when the entry's data says so", () => {
        expect(read([entry({ data: { mode: "quick" } as RunQueueEntry["data"] })]).head).toBe("Quick run");
    });

    it("waits after a run, named by the title the tree's row resolves", () => {
        const s = read([entry({ after: [RUN] })], {}, { [RUN]: "Chat verdict handoff" });
        expect(queuedLabel(s.view)).toBe("Queued · after Chat verdict handoff");
    });

    it("waits after two runs, named by both titles", () => {
        const s = read([entry({ after: [RUN, OTHER_RUN] })], {}, { [RUN]: "run A", [OTHER_RUN]: "run B" });
        expect(queuedLabel(s.view)).toBe("Queued · after run A, run B");
    });

    it("keeps naming both while only one of two runs has landed, and says Queued once both have", () => {
        const e = entry({ after: [RUN, OTHER_RUN] });
        const titles = { [RUN]: "run A", [OTHER_RUN]: "run B" };
        expect(queuedLabel(read([e], {}, titles, [RUN]).view)).toBe("Queued · after run A, run B");
        expect(queuedLabel(read([e], {}, titles, [OTHER_RUN]).view)).toBe("Queued · after run A, run B");
        const both = read([e], {}, titles, [RUN, OTHER_RUN]);
        expect(both.view).toEqual({ state: "waiting" });
        expect(queuedLabel(both.view)).toBe("Queued");
    });

    it("names the run it waits after by its short id while its title is unknown", () => {
        expect(queuedLabel(read([entry({ after: [RUN] })]).view)).toBe("Queued · after 3fa21b0c");
    });

    it("waits for room only once the run it waited after has landed", () => {
        const s = read([entry({ after: [RUN] })], {}, { [RUN]: "Chat verdict handoff" }, [RUN]);
        expect(s.view).toEqual({ state: "waiting" });
        expect(queuedLabel(s.view)).toBe("Queued");
    });

    it("is blocked with its reason", () => {
        const s = read([entry({ state: "blocked", reason: "the base moved on" })]);
        expect(queuedLabel(s.view)).toBe("Queued · blocked: the base moved on");
    });

    it("reads its own entry among others", () => {
        const s = read([entry({ id: "zzzz", state: "blocked", reason: "no" }), entry({ title: "Mine" })]);
        expect(s).toMatchObject({ view: { state: "waiting" }, name: "Mine" });
    });

    it("has started once the queue let it go, and names the run", () => {
        expect(read([], { [ENTRY]: RUN }).view).toEqual({ state: "started", runId: RUN });
    });

    it("is gone when it left the queue and no run is known", () => {
        expect(read([entry({ id: "other" })]).view).toEqual({ state: "gone" });
    });
});
