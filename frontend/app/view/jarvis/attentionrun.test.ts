// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const dagAction = vi.fn();
const ackRun = vi.fn();
const landAgain = vi.fn();
const loadAttention = vi.fn();
const startNow = vi.fn();
const removeQueued = vi.fn();
const pushModal = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        DagActionCommand: (...a: any[]) => dagAction(...a),
        AckRunCommand: (...a: any[]) => ackRun(...a),
        RunQueueStartNowCommand: (...a: any[]) => startNow(...a),
        RunQueueRemoveCommand: (...a: any[]) => removeQueued(...a),
    },
}));
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { pushModal: (...a: any[]) => pushModal(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/agents/attentionstore", () => ({ loadAttention: (...a: any[]) => loadAttention(...a) }));
vi.mock("./landrun", () => ({ landAgain: (...a: any[]) => landAgain(...a) }));

import { attentionAct, attentionSecondAct } from "./attentionact";
import { attentionDoneText, runAttentionAct, START_NOW_TIMEOUT_MS, type AttentionRunRow } from "./attentionrun";

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
        expect(attentionDoneText("ack-run", row({ source: "" }))).toBe("Accepted · approve the plan");
    });

    it("keeps each act's own verb", () => {
        expect(attentionDoneText("retry-dag", row())).toBe("Retrying t-1");
        expect(attentionDoneText("ack-run", row())).toBe("Accepted · ship the thing");
        expect(attentionDoneText("land-run", row())).toBe("Landed · ship the thing");
        expect(attentionDoneText("start-queued", row())).toBe("Started · ship the thing");
        expect(attentionDoneText("remove-queued", row())).toBe("Removed · ship the thing");
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

    it("accepts an unverified run", async () => {
        const fb = feedback();
        const r = row({ wireKind: "run-unverified", taskId: "" });
        await runAttentionAct(attentionAct(r), r, fb);
        expect(ackRun).toHaveBeenCalledWith(expect.anything(), { channelid: "ch1", runid: "r1" });
        expect(fb.done).toHaveBeenCalledWith("Accepted · ship the thing");
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

    describe("a blocked queue entry", () => {
        const queued = (over: Partial<AttentionRunRow> = {}) =>
            row({ wireKind: "run-queue-blocked", channelId: "", runId: null, taskId: "", queueId: "q-1a2b", ...over });

        it("starts the entry now, with the time a start takes, then reloads the list and says so", async () => {
            const fb = feedback();
            const r = queued();
            await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(true);
            expect(startNow).toHaveBeenCalledWith(
                expect.anything(),
                { id: "q-1a2b" },
                { timeout: START_NOW_TIMEOUT_MS }
            );
            expect(START_NOW_TIMEOUT_MS).toBeGreaterThanOrEqual(180_000);
            expect(loadAttention).toHaveBeenCalledTimes(1);
            expect(fb.done).toHaveBeenCalledWith("Started · ship the thing");
        });

        // the server answers "another queued run is starting; try again in a moment" while it starts another entry:
        // the person reads it, and the row stays as it was
        it("shows the server's refusal as the error and leaves the row", async () => {
            startNow.mockRejectedValue(new Error("another queued run is starting; try again in a moment"));
            const fb = feedback();
            const r = queued();
            await expect(runAttentionAct(attentionAct(r), r, fb)).resolves.toBe(false);
            expect(fb.fail).toHaveBeenCalledWith("another queued run is starting; try again in a moment");
            expect(fb.done).not.toHaveBeenCalled();
            expect(loadAttention).not.toHaveBeenCalled();
        });

        it("asks before removing, and calls nothing until the person confirms", async () => {
            const fb = feedback();
            const r = queued();
            const second = attentionSecondAct(r)!;
            await expect(runAttentionAct(second, r, fb)).resolves.toBe(false);
            expect(pushModal).toHaveBeenCalledTimes(1);
            const [name, props] = pushModal.mock.calls[0];
            expect(name).toBe("ConfirmModal");
            expect(props).toMatchObject({ confirmLabel: "Remove", destructive: true });
            expect(props.message).toContain("ship the thing");
            expect(removeQueued).not.toHaveBeenCalled();
            expect(fb.done).not.toHaveBeenCalled();
        });

        it("removes the entry once confirmed, then reloads the list and says so", async () => {
            const fb = feedback();
            const r = queued();
            await runAttentionAct(attentionSecondAct(r)!, r, fb);
            pushModal.mock.calls[0][1].onConfirm();
            await vi.waitFor(() => expect(fb.done).toHaveBeenCalledWith("Removed · ship the thing"));
            expect(removeQueued).toHaveBeenCalledWith(expect.anything(), { id: "q-1a2b" });
            expect(loadAttention).toHaveBeenCalledTimes(1);
            expect(fb.fail).not.toHaveBeenCalled();
        });

        it("reports a refused remove", async () => {
            removeQueued.mockRejectedValue(new Error("no such queued entry: q-1a2b"));
            const fb = feedback();
            const r = queued();
            await runAttentionAct(attentionSecondAct(r)!, r, fb);
            pushModal.mock.calls[0][1].onConfirm();
            await vi.waitFor(() => expect(fb.fail).toHaveBeenCalledWith("no such queued entry: q-1a2b"));
            expect(fb.done).not.toHaveBeenCalled();
            expect(loadAttention).not.toHaveBeenCalled();
        });
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
