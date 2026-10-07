// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";

const openAddress = vi.fn();
const openOrPeekAddress = vi.fn();
const postMessage = vi.fn();
const consult = vi.fn();
const ackRun = vi.fn();
const landRun = vi.fn();
const getAttention = vi.fn();

vi.mock("./openref", () => ({
    openAddress: (...a: any[]) => openAddress(...a),
    openOrPeekAddress: (...a: any[]) => openOrPeekAddress(...a),
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        PostChannelMessageCommand: (...a: any[]) => postMessage(...a),
        ConsultCommand: (...a: any[]) => consult(...a),
        AckRunCommand: (...a: any[]) => ackRun(...a),
        LandRunCommand: (...a: any[]) => landRun(...a),
        GetAttentionCommand: (...a: any[]) => getAttention(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { attentionAtom } from "@/app/view/agents/attentionstore";
import { atom } from "jotai";
import { actNavigates, runAct, sendErrand } from "./petactrun";
import type { PetAct } from "./petacts";
import { petActStateAtom, petErrandAtom, petPeekOpenAtom } from "./petstore";

// the runner only ever reads surfaceAtom off the model, so a bare atom pair is a sufficient stand-in
const model = { surfaceAtom: atom("cockpit") } as any;

afterEach(() => {
    vi.clearAllMocks();
    globalStore.set(petActStateAtom, {});
    globalStore.set(petPeekOpenAtom, false);
});

describe("runAct — escorts", () => {
    it("closes the peek once the landing succeeds, so an anchored overlay is not stranded", async () => {
        globalStore.set(petPeekOpenAtom, true);
        openAddress.mockResolvedValue({ ok: true });
        const act: PetAct = {
            id: "x",
            verb: "open",
            label: "Open",
            target: { kind: "oref", ref: "memnote:abc" },
        };
        await runAct(model, act);
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(openAddress).toHaveBeenCalledWith(model, "memnote:abc", { anchor: undefined }, expect.any(Function));
    });

    // the landing leaves the user where they were, so the act that asked is where its failure is read
    it("keeps the peek open and reports a failed landing on the act", async () => {
        globalStore.set(petPeekOpenAtom, true);
        openAddress.mockImplementation(
            async (_model: unknown, _address: string, _hint: unknown, report: (r: unknown) => void) => {
                const result = { ok: false, reason: "unavailable", message: "That record no longer exists" };
                report(result);
                return result;
            }
        );
        const act: PetAct = { id: "gone", verb: "open", label: "Open", target: { kind: "oref", ref: "task:gone" } };
        await runAct(model, act);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(petActStateAtom)["gone"]).toEqual({
            status: "error",
            text: "That record no longer exists",
        });
    });
});

describe("runAct — Ctrl+click", () => {
    it("peeks the escort's address and leaves the popup open for the item", async () => {
        globalStore.set(petPeekOpenAtom, true);
        openOrPeekAddress.mockResolvedValue({ ok: true });
        const act: PetAct = {
            id: "x",
            verb: "open",
            label: "Open",
            target: { kind: "oref", ref: "run:r1", anchor: "a" },
        };
        const gesture = { ctrlKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        await runAct(model, act, gesture);
        expect(openOrPeekAddress).toHaveBeenCalledWith(model, "run:r1", gesture, { anchor: "a" });
        expect(openAddress).not.toHaveBeenCalled();
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("a peek does not leave the popup, so focus-return stays", () => {
        const act: PetAct = { id: "x", verb: "open", label: "Open", target: { kind: "oref", ref: "run:r1" } };
        expect(actNavigates(act)).toBe(true);
        expect(actNavigates(act, { ctrlKey: true })).toBe(false);
    });
});

describe("runAct — ack", () => {
    const act: PetAct = {
        id: "run-unverified:r1:ack",
        verb: "ack",
        label: "Acknowledge",
        channelId: "ch1",
        runId: "r1",
    };

    afterEach(() => globalStore.set(attentionAtom, []));

    it("acknowledges the run, drops its row at once, and leaves the peek open", async () => {
        globalStore.set(petPeekOpenAtom, true);
        globalStore.set(attentionAtom, [{ key: "run-unverified:r1" } as AttentionItem]);
        ackRun.mockResolvedValue(undefined);
        getAttention.mockResolvedValue({ items: [] });
        await runAct(model, act);
        expect(ackRun).toHaveBeenCalledWith(expect.anything(), { channelid: "ch1", runid: "r1" });
        expect(globalStore.get(attentionAtom)).toEqual([]);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(openAddress).not.toHaveBeenCalled();
        expect(globalStore.get(petActStateAtom)[act.id]).toEqual({ status: "done" });
    });

    it("reports a failed ack on the act and keeps the row", async () => {
        const row = { key: "run-unverified:r1" } as AttentionItem;
        globalStore.set(attentionAtom, [row]);
        ackRun.mockRejectedValue(new Error("acknowledging run: not found"));
        await runAct(model, act);
        expect(globalStore.get(petActStateAtom)[act.id]).toEqual({
            status: "error",
            text: "acknowledging run: not found",
        });
        expect(globalStore.get(attentionAtom)).toEqual([row]);
    });
});

describe("runAct — a held land", () => {
    const row = { key: "run-land-held:r1" } as AttentionItem;
    const act: PetAct = {
        id: "run-land-held:r1:land",
        verb: "land",
        label: "Land again",
        channelId: "ch1",
        runId: "r1",
    };
    const dismiss: PetAct = { id: "run-land-held:r1:dismiss", verb: "ack", label: "Dismiss", land: true, channelId: "ch1", runId: "r1" }; // prettier-ignore

    afterEach(() => globalStore.set(attentionAtom, []));

    it("lands the run with the land's own budget, drops its row, and leaves the peek open", async () => {
        globalStore.set(petPeekOpenAtom, true);
        globalStore.set(attentionAtom, [row]);
        landRun.mockResolvedValue({ state: "landed", commit: "af6760b07d6b" });
        getAttention.mockResolvedValue({ items: [] });
        await runAct(model, act);
        expect(landRun).toHaveBeenCalledWith(
            expect.anything(),
            { channelid: "ch1", runid: "r1" },
            { timeout: expect.any(Number) }
        );
        expect(landRun.mock.calls[0][2].timeout).toBeGreaterThan(40 * 60_000);
        expect(globalStore.get(attentionAtom)).toEqual([]);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(petActStateAtom)[act.id]).toEqual({ status: "done", text: "Landed as af6760b0." });
    });

    // the server answers a held land with its reason, not an error: the act must not read as done
    it("reports a land that is still held as the act's error, with the reason", async () => {
        landRun.mockResolvedValue({ state: "held", reason: "the checkout has uncommitted changes" });
        getAttention.mockResolvedValue({ items: [] });
        await runAct(model, act);
        expect(globalStore.get(petActStateAtom)[act.id]).toEqual({
            status: "error",
            text: "Still held: the checkout has uncommitted changes",
        });
    });

    it("reports a refused land on the act", async () => {
        landRun.mockRejectedValue(new Error("run r1 is running; only a done run lands"));
        await runAct(model, act);
        expect(globalStore.get(petActStateAtom)[act.id]).toEqual({
            status: "error",
            text: "run r1 is running; only a done run lands",
        });
    });

    it("dismisses the held land, not the run's unverified outcome", async () => {
        globalStore.set(attentionAtom, [row]);
        ackRun.mockResolvedValue(undefined);
        getAttention.mockResolvedValue({ items: [] });
        await runAct(model, dismiss);
        expect(ackRun).toHaveBeenLastCalledWith(expect.anything(), { channelid: "ch1", runid: "r1", land: true });
        expect(globalStore.get(attentionAtom)).toEqual([]);
    });
});

describe("sendErrand", () => {
    afterEach(() => globalStore.set(petErrandAtom, null));

    it("posts the question into the channel and streams the reply into the panel", async () => {
        postMessage.mockResolvedValue(undefined);
        consult.mockReturnValue(
            (async function* () {
                yield { text: "the parser " };
                yield { text: "is fine." };
            })()
        );
        await sendErrand("ch1", "claude", "is the parser ok?");
        expect(postMessage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ channelid: "ch1", kind: "consult", author: "you", text: "is the parser ok?" })
        );
        expect(globalStore.get(petErrandAtom)).toEqual({
            prompt: "is the parser ok?",
            runtime: "claude",
            text: "the parser is fine.",
            status: "done",
        });
    });

    it("marks the errand failed with its reason, keeping whatever streamed first", async () => {
        postMessage.mockResolvedValue(undefined);
        consult.mockReturnValue(
            (async function* () {
                yield { text: "partial" };
                throw new Error("runtime not installed");
            })()
        );
        await sendErrand("ch1", "claude", "q");
        expect(globalStore.get(petErrandAtom)).toMatchObject({ text: "partial", status: "error" });
    });

    it("reports the reason when nothing streamed at all", async () => {
        postMessage.mockRejectedValue(new Error("no such channel"));
        await sendErrand("ch-gone", "claude", "q");
        expect(globalStore.get(petErrandAtom)).toEqual({
            prompt: "q",
            runtime: "claude",
            text: "no such channel",
            status: "error",
        });
    });
});
