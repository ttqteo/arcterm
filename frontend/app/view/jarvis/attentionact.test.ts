// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { attentionAct, attentionSecondAct, type AttentionActInput } from "./attentionact";

function a(over: Partial<AttentionActInput>): AttentionActInput {
    return { wireKind: "gate", channelId: "ch1", runId: "run1", taskId: "", retry: false, ...over };
}

describe("attentionAct", () => {
    it("approves a dag task's gate in place", () => {
        expect(attentionAct(a({ wireKind: "dag-gate", taskId: "t-3" }))).toEqual({
            label: "Approve",
            kind: "approve-dag",
        });
    });

    it("retries a failed task in place", () => {
        expect(attentionAct(a({ wireKind: "dag-blocked", taskId: "t-4", retry: true }))).toEqual({
            label: "Retry",
            kind: "retry-dag",
        });
    });

    it("acknowledges an unverified run and lands a held one again", () => {
        expect(attentionAct(a({ wireKind: "run-unverified" }))).toEqual({ label: "Accept", kind: "ack-run" });
        expect(attentionAct(a({ wireKind: "run-land-held" }))).toEqual({ label: "Land again", kind: "land-run" });
    });

    // a blocked dag with no failed task (a failed final stage, a review or merge failure) needs a judgment,
    // not a button; and an approve or retry needs the exact task the server named
    it("opens what needs a judgment or names nothing exact to act on", () => {
        const open = { label: "Open", kind: "open" };
        expect(attentionAct(a({ wireKind: "dag-blocked", taskId: "", retry: false }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "dag-blocked", taskId: "t-2", retry: false }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "dag-gate", taskId: "" }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "escalation" }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "ask" }))).toEqual(open);
        // the run-level review gate is gone; a stale item of that kind only opens its run
        expect(attentionAct(a({ wireKind: "gate" }))).toEqual(open);
    });

    it("opens rather than acting without the run or channel the act needs", () => {
        const open = { label: "Open", kind: "open" };
        expect(attentionAct(a({ wireKind: "run-unverified", runId: null }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "run-land-held", channelId: "" }))).toEqual(open);
        expect(attentionAct(a({ wireKind: "dag-blocked", taskId: "t-4", retry: true, runId: null }))).toEqual(open);
    });
});

describe("attentionAct: a chunk that came due", () => {
    it("offers Work on, which needs no run", () => {
        expect(attentionAct({ wireKind: "chunk-due", channelId: "", runId: null, taskId: "", retry: false })).toEqual({
            label: "Work on",
            kind: "work-on",
        });
    });
});

describe("attentionAct: a plan to review", () => {
    it("opens, with no wire act, since it has no run", () => {
        expect(attentionAct({ wireKind: "plan-review", channelId: "", runId: null, taskId: "", retry: false })).toEqual(
            {
                label: "Open",
                kind: "open",
            }
        );
    });
});

describe("a blocked queue entry", () => {
    const blocked = (over: Partial<AttentionActInput> = {}): AttentionActInput =>
        a({ wireKind: "run-queue-blocked", channelId: "", runId: null, queueId: "q-1a2b", ...over });

    it("starts now in place, with Remove as the second act", () => {
        expect(attentionAct(blocked())).toEqual({ label: "Start now", kind: "start-queued" });
        expect(attentionSecondAct(blocked())).toEqual({ label: "Remove", kind: "remove-queued" });
    });

    it("opens, with no second act, when the item names no queue entry", () => {
        const open = { label: "Open", kind: "open" };
        expect(attentionAct(blocked({ queueId: undefined }))).toEqual(open);
        expect(attentionAct(blocked({ queueId: "" }))).toEqual(open);
        expect(attentionSecondAct(blocked({ queueId: undefined }))).toBeNull();
        expect(attentionSecondAct(blocked({ queueId: "" }))).toBeNull();
    });

    it("is the only kind with a second act, even when it carries a queue id", () => {
        for (const wireKind of [
            "dag-gate",
            "dag-blocked",
            "run-unverified",
            "run-land-held",
            "chunk-due",
            "escalation",
            "ask",
            "gate",
        ]) {
            expect(attentionSecondAct(a({ wireKind, taskId: "t-1", retry: true, queueId: "q-1a2b" }))).toBeNull();
        }
    });
});
