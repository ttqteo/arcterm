// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const dagAction = vi.fn();
const ackRun = vi.fn();
const landAgain = vi.fn();
const loadAttention = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        DagActionCommand: (...a: any[]) => dagAction(...a),
        AckRunCommand: (...a: any[]) => ackRun(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/agents/attentionstore", () => ({ loadAttention: (...a: any[]) => loadAttention(...a) }));
vi.mock("./landrun", () => ({ landAgain: (...a: any[]) => landAgain(...a) }));

import { attentionAct } from "./attentionact";
import { attentionDoneText, runAttentionAct, type AttentionRunRow } from "./attentionrun";

const row = (over: Partial<AttentionRunRow> = {}): AttentionRunRow => ({
    wireKind: "dag-gate",
    channelId: "ch1",
    runId: "r1",
    taskId: "t-1",
    retry: false,
    source: "ship the thing",
    title: "approve the plan",
    ...over,
});

const feedback = () => ({ done: vi.fn(), fail: vi.fn() });

afterEach(() => vi.resetAllMocks());

describe("attentionDoneText", () => {
    it("names the task and the run for an approve", () => {
        expect(attentionDoneText("approve-dag", row())).toBe("Approved t-1 · ship the thing");
    });

    it("falls back to the title when the item names no source", () => {
        expect(attentionDoneText("approve-dag", row({ source: "" }))).toBe("Approved t-1 · approve the plan");
        expect(attentionDoneText("ack-run", row({ source: "" }))).toBe("Acknowledged · approve the plan");
    });

    it("keeps each act's own verb", () => {
        expect(attentionDoneText("retry-dag", row())).toBe("Retrying t-1");
        expect(attentionDoneText("ack-run", row())).toBe("Acknowledged · ship the thing");
        expect(attentionDoneText("land-run", row())).toBe("Landed · ship the thing");
    });
});

describe("runAttentionAct", () => {
    it("approves the exact task the server named, then reloads the list and says so", async () => {
        const fb = feedback();
        const r = row();
        await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(true);
        expect(dagAction).toHaveBeenCalledWith(expect.anything(), {
            channelid: "ch1",
            runid: "r1",
            taskid: "t-1",
            action: "approve",
        });
        expect(loadAttention).toHaveBeenCalledTimes(1);
        expect(fb.done).toHaveBeenCalledWith("Approved t-1 · ship the thing");
        expect(fb.fail).not.toHaveBeenCalled();
    });

    it("retries a failed task", async () => {
        const fb = feedback();
        const r = row({ wireKind: "dag-blocked", retry: true });
        await runAttentionAct(attentionAct(r), r, fb);
        expect(dagAction).toHaveBeenCalledWith(expect.anything(), {
            channelid: "ch1",
            runid: "r1",
            taskid: "t-1",
            action: "retry",
        });
        expect(fb.done).toHaveBeenCalledWith("Retrying t-1");
    });

    it("acknowledges an unverified run", async () => {
        const fb = feedback();
        const r = row({ wireKind: "run-unverified", taskId: "" });
        await runAttentionAct(attentionAct(r), r, fb);
        expect(ackRun).toHaveBeenCalledWith(expect.anything(), { channelid: "ch1", runid: "r1" });
        expect(fb.done).toHaveBeenCalledWith("Acknowledged · ship the thing");
    });

    it("lands a held run again", async () => {
        landAgain.mockResolvedValue({ failed: false, text: "Landed." });
        const fb = feedback();
        const r = row({ wireKind: "run-land-held", taskId: "" });
        await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(true);
        expect(landAgain).toHaveBeenCalledWith("ch1", "r1");
        expect(fb.done).toHaveBeenCalledWith("Landed · ship the thing");
    });

    // a held answer is not an rpc error, so it is read as one here: the feedback must carry the reason, never "Landed"
    it("reports a land that stays held as a failure carrying the reason", async () => {
        landAgain.mockResolvedValue({ failed: true, text: "Still held: verify failed" });
        const fb = feedback();
        const r = row({ wireKind: "run-land-held", taskId: "" });
        await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(false);
        expect(fb.fail).toHaveBeenCalledWith("Still held: verify failed");
        expect(fb.done).not.toHaveBeenCalled();
    });

    it("reports a refused call and leaves the list as it was", async () => {
        dagAction.mockRejectedValue(new Error("the task is not at a gate"));
        const fb = feedback();
        const r = row();
        await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(false);
        expect(fb.fail).toHaveBeenCalledWith("the task is not at a gate");
        expect(fb.done).not.toHaveBeenCalled();
        expect(loadAttention).not.toHaveBeenCalled();
    });

    it("does nothing for an act that only opens", async () => {
        const fb = feedback();
        const r = row({ wireKind: "escalation", taskId: "" });
        await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(false);
        expect(dagAction).not.toHaveBeenCalled();
        expect(ackRun).not.toHaveBeenCalled();
        expect(landAgain).not.toHaveBeenCalled();
        expect(fb.done).not.toHaveBeenCalled();
        expect(fb.fail).not.toHaveBeenCalled();
    });
});
