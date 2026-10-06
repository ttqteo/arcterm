import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import {
    dedupeUpdates,
    enterHintLabel,
    eventPeekTarget,
    peekActForCommand,
    peekConditions,
    peekKeyCommand,
    queueRows,
    rowKindLabel,
    rowPeekTarget,
} from "./petpeekmodel";
import type { PetEvent } from "./petvoice";

const RUN = "run-1";
const CH = "chan-1";

function item(over: Partial<AttentionItem> & Pick<AttentionItem, "kind" | "key">): AttentionItem {
    return {
        source: "a source",
        text: "some text",
        action: "Review",
        phaseidx: 0,
        waitingsince: 1_000,
        channelid: CH,
        runid: RUN,
        ...over,
    } as AttentionItem;
}

// pkg/jarvis/attention.go fills Text per kind: a gate's is the constant "Approve before Jarvis proceeds.",
// while an escalation's and an ask's are the worker's actual question.
const GATE = item({ kind: "gate", key: "gate:" + RUN, source: "Ship autonomy ladder tier gating", text: "Approve before Jarvis proceeds." }); // prettier-ignore
const DAG_GATE = item({ kind: "dag-gate", key: "dag-gate:g1", text: "Approve the gate before the DAG proceeds." }); // prettier-ignore
const ESCALATION = item({ kind: "escalation", key: "esc:m1", source: "gatekeeper", action: "Decide", text: "Phase 3 wants to rewrite peterrandmodel.ts — the tier only covers reads. Allow?" }); // prettier-ignore
const DAG_BLOCKED = item({ kind: "dag-blocked", key: "dag-blocked:g2", text: "3 consecutive failures — decide retry/skip." }); // prettier-ignore
const ASK = item({ kind: "ask", key: "ask:block:b1", source: "phase-2 worker", action: "Answer", text: "Keep the no-transcript fallback for pi workers, or drop it?" }); // prettier-ignore

const RADAR = item({ kind: "radar-triage", key: "radar:rep-1", source: "waveterm", action: "Triage", text: "4 findings need triage.", channelid: "", runid: "", oref: "radarreport:rep-1" } as Partial<AttentionItem> & Pick<AttentionItem, "kind" | "key">); // prettier-ignore

describe("queueRows — the creature only holds what it can resolve", () => {
    // Radar triage names no channel and no run, so actsForAttention has nothing to offer it and the row
    // rendered as a project name, an age, and nothing to press. The Radar rail's badge and the Brief's
    // queue both address it through its ORef; the peek cannot, so it must not claim it is waiting here.
    it("drops radar triage, whose destination the peek cannot reach", () => {
        expect(queueRows([RADAR])).toEqual([]);
    });

    it("keeps every other waiting kind in wire order", () => {
        expect(queueRows([GATE, RADAR, ESCALATION]).map((r) => r.kind)).toEqual(["gate", "escalation"]);
    });
});

describe("queueRows — detail earns its line, it is not given one", () => {
    // The row's scarcest resource is horizontal space, and four of the five kinds spend it on a constant
    // string that the verb button already implies. Only a question is worth the width.
    it("drops the detail of kinds whose text is boilerplate", () => {
        const rows = queueRows([GATE, DAG_GATE]);
        expect(rows.map((r) => r.detail)).toEqual([null, null]);
    });

    it("keeps the detail of kinds whose text is the payload", () => {
        const rows = queueRows([ESCALATION, DAG_BLOCKED, ASK]);
        expect(rows[0].detail).toBe("Phase 3 wants to rewrite peterrandmodel.ts — the tier only covers reads. Allow?");
        expect(rows[1].detail).toBe("3 consecutive failures — decide retry/skip.");
        expect(rows[2].detail).toBe("Keep the no-transcript fallback for pi workers, or drop it?");
    });

    // the row's left bar is toned by kind, and the renderer must not have to re-look-up the item to know
    // which — a second lookup is how the bar and the verb get to disagree about what a row is.
    it("carries the kind through, so the row can be toned without a second lookup", () => {
        expect(queueRows([GATE, ESCALATION, ASK]).map((r) => r.kind)).toEqual(["gate", "escalation", "ask"]);
    });

    it("still carries the source of every row, boilerplate or not", () => {
        expect(queueRows([GATE, ASK]).map((r) => r.source)).toEqual([
            "Ship autonomy ladder tier gating",
            "phase-2 worker",
        ]);
    });
});

describe("queueRows — the button says what the item needs, not how to get there", () => {
    // actsForAttention returns exactly one act for any item with a run, and it is labelled "Open". "Review" / "Decide" / "Answer" is the same navigation named by its purpose.
    it("labels the primary act from the item's own action verb", () => {
        expect(queueRows([GATE])[0].primary?.label).toBe("Review");
        expect(queueRows([ESCALATION])[0].primary?.label).toBe("Decide");
        expect(queueRows([ASK])[0].primary?.label).toBe("Answer");
    });

    it("keeps the relabelled act pointed at the run it came from", () => {
        const primary = queueRows([GATE])[0].primary;
        if (primary?.verb !== "open") {
            throw new Error(`expected an open escort, got ${primary?.verb}`);
        }
        expect(primary.target).toEqual({ kind: "oref", ref: `run:${RUN}` });
    });

    it("offers no button at all for an item with nothing addressable behind it", () => {
        const orphan = item({ kind: "ask", key: "ask:block:b9", runid: undefined, action: "Answer" });
        const row = queueRows([orphan])[0];
        expect(row.primary).toBeNull();
        expect(row.source).toBe("a source");
    });

    // an ask with no run behind it still has somewhere to answer: the agent's own terminal, found by the
    // ask's block in the roster
    it("answers a run-less ask in the agent that raised it", () => {
        const orphan = item({ kind: "ask", key: "ask:block:b9", runid: undefined, action: "Answer" });
        const agents = [{ id: "tab-9", name: "pi · scratch", blockId: "b9" } as unknown as AgentVM];
        const primary = queueRows([orphan], agents)[0].primary;
        expect(primary).toMatchObject({ label: "Answer", target: { kind: "oref", ref: "agent:tab-9" } });
    });
});

describe("queueRows — the server's ranking is authoritative", () => {
    // BuildAttention already sorts gates, then escalations, then asks, oldest first within a kind.
    // Re-sorting here would make the peek and the nav badge disagree about which waiting matters most.
    it("preserves the order it is given", () => {
        const rows = queueRows([GATE, ESCALATION, ASK]);
        expect(rows.map((r) => r.key)).toEqual([GATE.key, ESCALATION.key, ASK.key]);
    });

    it("gives every waiting row its escort, relabelled by what the item needs", () => {
        const rows = queueRows([GATE]);
        expect(rows[0].primary?.label).toBe("Review");
    });
});

describe("dedupeUpdates — report each thing once", () => {
    const askEvent: PetEvent = { id: "ask:a1", at: 5, kind: "ask", text: "phase-2 worker is waiting", ref: "block:b1" };
    const sweep: PetEvent = { id: "sweep:1", at: 4, kind: "sweep", text: "Swept the vault while you were out." };

    it("drops a spoken ask that is already a row in the queue", () => {
        expect(dedupeUpdates([askEvent, sweep], [ASK]).map((e) => e.id)).toEqual(["sweep:1"]);
    });

    it("keeps a spoken ask that no queue row covers", () => {
        expect(dedupeUpdates([askEvent, sweep], [GATE]).map((e) => e.id)).toEqual(["ask:a1", "sweep:1"]);
        expect(dedupeUpdates([askEvent], []).map((e) => e.id)).toEqual(["ask:a1"]);
    });

    it("matches on the ask's block oref, not on the event id", () => {
        // the queue keys an ask "ask:<block oref>" while the event ids itself by ask id — only `ref` joins them
        expect(askEvent.id).not.toBe(ASK.key);
        expect(dedupeUpdates([askEvent], [ASK])).toEqual([]);
    });

    it("leaves every other kind of update alone", () => {
        const events: PetEvent[] = [
            sweep,
            { id: "connection:1", at: 3, kind: "connection", text: "This ties to the parser work." },
        ];
        expect(dedupeUpdates(events, [ASK, GATE])).toEqual(events);
    });
});

describe("peekKeyCommand", () => {
    it("maps navigation keys", () => {
        expect(peekKeyCommand("j")).toBe("next");
        expect(peekKeyCommand("ArrowDown")).toBe("next");
        expect(peekKeyCommand("k")).toBe("previous");
        expect(peekKeyCommand("ArrowUp")).toBe("previous");
        expect(peekKeyCommand("Enter")).toBe("open");
        expect(peekKeyCommand(" ")).toBe("peek");
    });

    it("maps panel controls", () => {
        expect(peekKeyCommand("/")).toBe("composer");
        expect(peekKeyCommand("Escape")).toBe("close");
    });

    // a/s were the gate's approve and send back; slice 5c deleted both, so the keys are free again and must
    // not silently keep firing something
    it("ignores unrelated and uppercase keys", () => {
        expect(peekKeyCommand("a")).toBeNull();
        // conditions are static lines now, with nothing to toggle
        expect(peekKeyCommand("c")).toBeNull();
        expect(peekKeyCommand("s")).toBeNull();
        expect(peekKeyCommand("x")).toBeNull();
        expect(peekKeyCommand("A")).toBeNull();
    });
});

describe("peekActForCommand", () => {
    it("opens the focused row through its primary act", () => {
        const row = queueRows([ASK])[0];
        expect(peekActForCommand(row, "open")).toBe(row.primary);
    });

    // open is the only command that resolves to an act: no attention kind carries a verb a key could fire.
    it("returns no act for every other command", () => {
        const row = queueRows([GATE])[0];
        for (const command of ["next", "previous", "composer", "close"] as const) {
            expect(peekActForCommand(row, command)).toBeNull();
        }
    });

    it("returns no act without a focused row", () => {
        expect(peekActForCommand(undefined, "open")).toBeNull();
    });
});

describe("queueRows — an unverified run settles in place", () => {
    const UNVERIFIED = item({ kind: "run-unverified", key: "run-unverified:" + RUN, action: "Acknowledge" });

    it("puts the ack on the button and the escort beside it", () => {
        const row = queueRows([UNVERIFIED])[0];
        expect(row.primary).toMatchObject({ verb: "ack", label: "Acknowledge", channelId: CH, runId: RUN });
        expect(row.secondary).toMatchObject({ verb: "open", target: { kind: "oref", ref: `run:${RUN}` } });
    });

    it("gives every other kind no second act", () => {
        expect(queueRows([GATE, ESCALATION, ASK]).map((r) => r.secondary)).toEqual([null, null, null]);
    });
});

describe("queueRows — a held land", () => {
    const HELD = item({ kind: "run-land-held", key: "run-land-held:" + RUN, text: "The run's branch was not merged back: git refused the merge" }); // prettier-ignore

    // the item's action is "Review", which names the escort; relabelling the retry with it would hide what it does
    it("keeps Land again on the button, shows the reason, and escorts beside it", () => {
        const [row] = queueRows([HELD]);
        expect(row.primary).toMatchObject({ verb: "land", label: "Land again" });
        expect(row.secondary).toMatchObject({ verb: "open" });
        expect(row.detail).toBe(HELD.text);
        expect(rowKindLabel(row.kind)).toBe("Not merged");
    });
});

describe("enterHintLabel", () => {
    it("names what Enter does to the focused row", () => {
        expect(enterHintLabel(queueRows([item({ kind: "run-unverified", key: "u" })])[0].primary)).toBe("acknowledge");
        expect(enterHintLabel(queueRows([GATE])[0].primary)).toBe("open");
        expect(enterHintLabel(queueRows([item({ kind: "run-land-held", key: "l" })])[0].primary)).toBe("land again");
        expect(enterHintLabel(null)).toBe("open");
    });
});

describe("peekConditions — every standing condition, readout marked", () => {
    const HOT = { provider: "claude", pct: 94, resetAt: 1_800_000_000 };

    // documented in petacts.ts: the countdown is the one row with genuinely nothing to do, and it is
    // honest rather than an omission.
    it("marks a depleting window a readout", () => {
        const [tired] = peekConditions({ rateLimit: HOT });
        expect(tired.expr.kind).toBe("tired");
        expect(tired.readout).toBe(true);
    });

    it("stays empty when nothing is degraded", () => {
        expect(peekConditions({})).toEqual([]);
    });
});

describe("rowKindLabel — a row names its kind in a word", () => {
    it("reads every queue kind", () => {
        expect(["gate", "dag-gate", "escalation", "dag-blocked", "ask"].map(rowKindLabel)).toEqual([
            "Gate",
            "Gate",
            "Escalation",
            "Blocked",
            "Question",
        ]);
    });
});

describe("what the hub peeks", () => {
    it("an update peeks its first source", () => {
        const event = {
            sources: [
                { ref: "task:d1", anchor: "dec-2", title: "the record", sourceType: "dossier" },
                { ref: "run:r1", title: "the run", sourceType: "run" },
            ],
        };
        expect(eventPeekTarget(event)).toEqual({ kind: "oref", ref: "task:d1", anchor: "dec-2" });
    });

    it("an update with no source is not peekable", () => {
        expect(eventPeekTarget({})).toBeNull();
        expect(eventPeekTarget({ sources: [] })).toBeNull();
        expect(eventPeekTarget(undefined)).toBeNull();
    });

    it("a queue row peeks where its escort lands, past an in-place ack", () => {
        const [unverified] = queueRows([item({ kind: "run-unverified", key: "run-unverified:x" })]);
        expect(unverified.primary?.verb).toBe("ack");
        expect(rowPeekTarget(unverified)).toEqual({ kind: "oref", ref: `run:${RUN}` });
        const [gate] = queueRows([item({ kind: "gate", key: "gate:x" })]);
        expect(rowPeekTarget(gate)).toEqual({ kind: "oref", ref: `run:${RUN}` });
    });

    it("a row with nothing behind it is not peekable", () => {
        const [bare] = queueRows([item({ kind: "gate", key: "gate:x", runid: "" })]);
        expect(rowPeekTarget(bare)).toBeNull();
        expect(rowPeekTarget(undefined)).toBeNull();
    });
});
