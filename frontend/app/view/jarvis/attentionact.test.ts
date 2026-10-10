// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { attentionAct, type AttentionActInput } from "./attentionact";

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
        expect(attentionAct(a({ wireKind: "run-unverified" }))).toEqual({ label: "Acknowledge", kind: "ack-run" });
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
