// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { pasteIntoTerm } from "@/app/view/term/termpaste";
import { base64ToString } from "@/util/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { sendLineComments } from "./linereviewsend";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { ControllerInputCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/term/termpaste", () => ({ pasteIntoTerm: vi.fn() }));

const AGENT = { id: "a1", name: "paper-writer", blockId: "blk-1" } as AgentVM;
const TEXT = "Review comments on your changes (1):\n\n1. a.ts:42\n   Why?";

const paste = vi.mocked(pasteIntoTerm);
const input = vi.mocked(RpcApi.ControllerInputCommand);

beforeEach(() => {
    paste.mockReset();
    input.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("sendLineComments", () => {
    it("pastes the text into the agent's terminal, then presses Enter", async () => {
        paste.mockReturnValue(true);
        input.mockResolvedValue(undefined);
        expect(await sendLineComments(AGENT, TEXT)).toEqual({ ok: true });
        expect(paste).toHaveBeenCalledWith("blk-1", TEXT);
        expect(input).toHaveBeenCalledTimes(1);
        const [, data] = input.mock.calls[0];
        expect(data.blockid).toBe("blk-1");
        expect(base64ToString(data.inputdata64)).toBe("\r");
        expect(paste.mock.invocationCallOrder[0]).toBeLessThan(input.mock.invocationCallOrder[0]);
    });

    it("fails without pressing Enter when the terminal takes no paste", async () => {
        paste.mockReturnValue(false);
        const r = await sendLineComments(AGENT, TEXT);
        expect(r).toEqual({ ok: false, error: expect.stringContaining("paper-writer") });
        expect(input).not.toHaveBeenCalled();
    });

    it("fails with the RPC's message when Enter can't be sent", async () => {
        paste.mockReturnValue(true);
        input.mockRejectedValue(new Error("route not found"));
        expect(await sendLineComments(AGENT, TEXT)).toEqual({ ok: false, error: "route not found" });
    });

    it("hands the text to the DEV sink and touches no terminal", async () => {
        const sink = vi.fn();
        vi.stubGlobal("window", { __lineReviewSink: sink });
        expect(await sendLineComments(AGENT, TEXT)).toEqual({ ok: true });
        expect(sink).toHaveBeenCalledWith(TEXT);
        expect(paste).not.toHaveBeenCalled();
        expect(input).not.toHaveBeenCalled();
    });

    it("fails when the DEV sink throws", async () => {
        vi.stubGlobal("window", {
            __lineReviewSink: () => {
                throw new Error("sink says no");
            },
        });
        expect(await sendLineComments(AGENT, TEXT)).toEqual({ ok: false, error: "sink says no" });
        expect(paste).not.toHaveBeenCalled();
    });
});
