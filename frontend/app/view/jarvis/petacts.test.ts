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
        expect(actsForAttention(gate()).map((a) => a.label)).toEqual(["Open"]);
        expect(actsForAttention(gate())[0]).toMatchObject({ verb: "open", target: { kind: "oref", ref: "run:run1" } });
    });

    // Slice 5c deleted the review gate; nothing but an unverified run is settled by a click, so every other
    // kind offers the escort alone.
    it("offers an escort and nothing else for a kind a click cannot settle", () => {
        for (const kind of ["gate", "escalation", "ask", "dag-blocked"]) {
            const it = { ...gate(), kind, key: `${kind}:m1` } as AttentionItem;
            expect(actsForAttention(it).map((a) => a.label)).toEqual(["Open"]);
        }
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

    it("lands a held run again in place, and still escorts to it", () => {
        const held = { ...gate(), kind: "run-land-held", key: "run-land-held:run1" } as AttentionItem;
        expect(actsForAttention(held)).toEqual([
            { id: "run-land-held:run1:land", verb: "land", label: "Land again", channelId: "ch1", runId: "run1" },
            {
                id: "run-land-held:run1:open",
                verb: "open",
                label: "Open",
                target: { kind: "oref", ref: "run:run1" },
            },
        ]);
        expect(actsForAttention({ ...held, channelid: "" }).map((a) => a.verb)).toEqual(["open"]);
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
