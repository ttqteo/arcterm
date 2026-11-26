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

    // Land again re-reads the same failed final stage, so that hold is moved only by the forced land
    it("offers Land anyway for a land held by a failed final stage, and Land again for any other hold", () => {
        expect(attentionAct(a({ wireKind: "run-land-held", reason: "the final stage failed" }))).toEqual({
            label: "Land anyway",
            kind: "force-land",
        });
        expect(attentionAct(a({ wireKind: "run-land-held", reason: "the checkout has uncommitted changes" }))).toEqual({
            label: "Land again",
            kind: "land-run",
        });
        // the reason alone never forces anything on another kind
        expect(attentionAct(a({ wireKind: "run-unverified", reason: "the final stage failed" })).kind).toBe("ack-run");
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

    // Work on links the agent it starts to the initiative, so the row says where the button now goes
    it("says Go to agent once an agent is open on its initiative", () => {
        expect(
            attentionAct({
                wireKind: "chunk-due",
                channelId: "",
                runId: null,
                taskId: "",
                retry: false,
                agentOpen: true,
            })
        ).toEqual({ label: "Go to agent", kind: "work-on" });
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

// the waiting bug reports are one row in three forms, told apart by what the item names (pkg/jarvis/attention.go)
describe("attentionAct: the bug-reports row", () => {
    const reports = (over: Partial<AttentionActInput> = {}): AttentionActInput =>
        a({ wireKind: "bug-reports", channelId: "", runId: null, ...over });

    it("offers Xử lý once an arcterm repo is known and nothing holds the reports", () => {
        expect(attentionAct(reports({ projectPath: "D:/work/arcterm", oref: "" }))).toEqual({
            label: "Xử lý",
            kind: "process-reports",
        });
        // an oref that is not an agent's does not make it the handling form
        expect(attentionAct(reports({ projectPath: "D:/work/arcterm", oref: "effort:abc" }))).toEqual({
            label: "Xử lý",
            kind: "process-reports",
        });
    });

    it("offers Chọn thư mục… when no repo path rides on the item", () => {
        const pick = { label: "Chọn thư mục…", kind: "pick-repo" };
        expect(attentionAct(reports({ projectPath: "" }))).toEqual(pick);
        expect(attentionAct(reports({ projectPath: undefined, oref: "" }))).toEqual(pick);
    });

    it("offers Mở agent while an agent holds them, whether or not the item carries the repo path", () => {
        const open = { label: "Mở agent", kind: "open" };
        expect(attentionAct(reports({ oref: "agent:tab-1", projectPath: "D:/work/arcterm" }))).toEqual(open);
        expect(attentionAct(reports({ oref: "agent:tab-1" }))).toEqual(open);
    });

    it("has no second act", () => {
        expect(attentionSecondAct(reports({ projectPath: "D:/work/arcterm" }))).toBeNull();
    });

    it("does not touch any other kind that happens to carry an oref or a path", () => {
        expect(attentionAct(a({ wireKind: "council", oref: "council:c1", projectPath: "D:/x" }))).toEqual({
            label: "Open",
            kind: "open",
        });
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

    it("is the only kind of these with a second act, even when it carries a queue id", () => {
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

describe("attentionAct: the session ideas' line", () => {
    const ideas = (over: Partial<AttentionActInput> = {}): AttentionActInput =>
        a({ wireKind: "session-ideas", channelId: "", runId: null, ...over });

    it("opens as Review, with no wire act, and offers Next week beside it", () => {
        expect(attentionAct(ideas())).toEqual({ label: "Review", kind: "open" });
        expect(attentionSecondAct(ideas())).toEqual({ label: "Next week", kind: "snooze-ideas" });
    });

    it("gives the same two acts whatever else the item carries", () => {
        const extra = ideas({ taskId: "t-1", retry: true, queueId: "q-1", oref: "agent:t1", projectPath: "D:/x" });
        expect(attentionAct(extra)).toEqual({ label: "Review", kind: "open" });
        expect(attentionSecondAct(extra)).toEqual({ label: "Next week", kind: "snooze-ideas" });
    });
});
