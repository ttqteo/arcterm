// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { actsForAttention, actsForEvent } from "./petacts";

function gate(): AttentionItem {
    return {
        kind: "gate",
        key: "gate:run1",
        channelid: "ch1",
        channelname: "wave",
        runid: "run1",
        phaseidx: 1,
        source: "refactor the parser",
        text: "Approve before Jarvis proceeds.",
        action: "Review",
        waitingsince: 1000,
    } as AttentionItem;
}

describe("actsForAttention", () => {
    it("escorts to the waiting thing", () => {
        const escalation = { ...gate(), kind: "escalation", key: "escalation:m1" } as AttentionItem;
        expect(actsForAttention(escalation).map((a) => a.label)).toEqual(["Open"]);
        expect(actsForAttention(escalation)[0]).toMatchObject({
            verb: "open",
            target: { kind: "oref", ref: "run:run1" },
        });
    });

    // a question needs a written answer or a picked option, and a blocked dag with no failed task (a failed
    // final stage, a review or merge failure) needs a judgment: neither is a button
    it("offers an escort and nothing else for a kind a click cannot settle", () => {
        for (const kind of ["escalation", "ask", "dag-blocked"]) {
            const it = { ...gate(), kind, key: `${kind}:m1` } as AttentionItem;
            expect(actsForAttention(it).map((a) => a.label)).toEqual(["Open"]);
        }
    });

    // the server no longer emits a run's review gate (the dag's own gate replaced it), so the escort alone covers it
    it("only escorts a run-level gate", () => {
        expect(actsForAttention(gate()).map((a) => a.verb)).toEqual(["open"]);
    });

    it("approves a dag task's gate in place", () => {
        const dagGate = { ...gate(), kind: "dag-gate", key: "dag-gate:g1:t-3", taskid: "t-3" } as AttentionItem;
        expect(actsForAttention(dagGate)[0]).toEqual({
            id: "dag-gate:g1:t-3:approve",
            verb: "approve-task",
            label: "Approve",
            channelId: "ch1",
            runId: "run1",
            taskId: "t-3",
        });
        const unnamed = { ...dagGate, taskid: "" } as AttentionItem;
        expect(actsForAttention(unnamed).map((a) => a.verb)).toEqual(["open"]);
    });

    it("retries a failed task in place, but only opens a blocked dag that names no failed task", () => {
        const failed = {
            ...gate(),
            kind: "dag-blocked",
            key: "dag-blocked:g2",
            taskid: "t-4",
            retry: true,
        } as AttentionItem;
        expect(actsForAttention(failed)[0]).toEqual({
            id: "dag-blocked:g2:retry",
            verb: "retry-task",
            label: "Retry",
            channelId: "ch1",
            runId: "run1",
            taskId: "t-4",
        });
        const finalFailed = { ...failed, taskid: "", retry: false } as AttentionItem;
        expect(actsForAttention(finalFailed).map((a) => a.verb)).toEqual(["open"]);
    });

    // the button used to be an Open relabelled "Acknowledge", so pressing it never cleared the row
    it("acknowledges an unverified run in place, and still escorts to it for reading first", () => {
        const unverified = { ...gate(), kind: "run-unverified", key: "run-unverified:run1" } as AttentionItem;
        expect(actsForAttention(unverified)).toEqual([
            { id: "run-unverified:run1:ack", verb: "ack", label: "Acknowledge", channelId: "ch1", runId: "run1" },
            {
                id: "run-unverified:run1:open",
                verb: "open",
                label: "Open",
                target: { kind: "oref", ref: "run:run1" },
            },
        ]);
    });

    it("lands a held run again or dismisses it in place, and still escorts to its run", () => {
        const held = { ...gate(), kind: "run-land-held", key: "run-land-held:run1" } as AttentionItem;
        expect(actsForAttention(held)).toEqual([
            { id: "run-land-held:run1:land", verb: "land", label: "Land again", channelId: "ch1", runId: "run1" },
            { id: "run-land-held:run1:dismiss", verb: "ack", label: "Dismiss", land: true, channelId: "ch1", runId: "run1" }, // prettier-ignore
            { id: "run-land-held:run1:open", verb: "open", label: "Open", target: { kind: "oref", ref: "run:run1" } },
        ]);
        expect(actsForAttention({ ...held, channelid: "" } as AttentionItem).map((a) => a.verb)).toEqual(["open"]);
    });

    it("escorts an unverified run that names no channel, since the ack needs one", () => {
        const unverified = { ...gate(), kind: "run-unverified", channelid: "" } as AttentionItem;
        expect(actsForAttention(unverified).map((a) => a.verb)).toEqual(["open"]);
    });

    it("offers nothing at all for an item with no run to address", () => {
        const orphan = { ...gate(), runid: "" } as AttentionItem;
        expect(actsForAttention(orphan)).toEqual([]);
    });
});

describe("actsForEvent", () => {
    it("offers one Open per source and nothing else", () => {
        const acts = actsForEvent({
            id: "e1",
            sources: [
                { ref: "task:t1", title: "Spawn test", sourceType: "task" },
                { ref: "run:r1", title: "Run r1", sourceType: "run", anchor: "a1" },
            ],
        } as any);
        expect(acts).toEqual([
            {
                id: "e1:task:t1:open",
                verb: "open",
                label: "Open Spawn test",
                target: { kind: "oref", ref: "task:t1", anchor: undefined },
            },
            {
                id: "e1:run:r1:open",
                verb: "open",
                label: "Open Run r1",
                target: { kind: "oref", ref: "run:r1", anchor: "a1" },
            },
        ]);
    });

    it("offers nothing for an event with no sources", () => {
        expect(actsForEvent({ id: "e2" })).toEqual([]);
    });
});

describe("actsForAttention: a chunk that came due", () => {
    it("is Work on its initiative, then Open, with no run to address", () => {
        const item = {
            kind: "chunk-due",
            key: "chunk-due:e1:re-measure:2026-10-20",
            source: "Nav rail",
            text: "re-measure",
            action: "Open",
            phaseidx: 0,
            waitingsince: 1000,
            oref: "effort:e1",
            effortoid: "e1",
            chunklabel: "re-measure",
            why: "Due 2026-10-20.",
        } as AttentionItem;
        expect(actsForAttention(item)).toEqual([
            {
                id: `${item.key}:work`,
                verb: "work-on",
                label: "Work on",
                effortORef: "effort:e1",
                chunk: "re-measure",
            },
            { id: `${item.key}:open`, verb: "open", label: "Open", target: { kind: "oref", ref: "effort:e1" } },
        ]);
    });
});
