import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgentTranscriptCommand = vi.fn();
const loadAndPinWaveObject = vi.fn();
const makeORef = vi.fn((otype: string, oid: string) => `${otype}:${oid}`);

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetAgentTranscriptCommand: (...args: any[]) => getAgentTranscriptCommand(...args),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({
    loadAndPinWaveObject: (...args: any[]) => loadAndPinWaveObject(...args),
    makeORef: (otype: string, oid: string) => makeORef(otype, oid),
}));

import { resolveCwd } from "./agentcwdresolve";

const cwdLines = (cwd: string) => [JSON.stringify({ type: "user", cwd })];

beforeEach(() => {
    getAgentTranscriptCommand.mockReset();
    loadAndPinWaveObject.mockReset();
    makeORef.mockClear();
});

describe("resolveCwd", () => {
    it("uses block cmd:cwd without reading the transcript", async () => {
        loadAndPinWaveObject.mockResolvedValueOnce({ meta: { view: "term", "cmd:cwd": "/block" } });

        await expect(resolveCwd("/transcript.jsonl", "block-1")).resolves.toBe("/block");

        expect(makeORef).toHaveBeenCalledWith("block", "block-1");
        expect(getAgentTranscriptCommand).not.toHaveBeenCalled();
    });

    it("falls through from a missing block cwd to the transcript tail", async () => {
        loadAndPinWaveObject.mockResolvedValueOnce({ meta: { view: "term" } });
        getAgentTranscriptCommand.mockResolvedValueOnce({ lines: cwdLines("/tail") });

        await expect(resolveCwd("/transcript.jsonl", "block-1")).resolves.toBe("/tail");

        expect(getAgentTranscriptCommand).toHaveBeenCalledTimes(1);
        expect(getAgentTranscriptCommand).toHaveBeenCalledWith(expect.anything(), {
            path: "/transcript.jsonl",
            maxlines: 200,
        });
    });

    it("does not read the head when the tail contains a cwd", async () => {
        getAgentTranscriptCommand.mockResolvedValueOnce({ lines: cwdLines("/tail") });

        await expect(resolveCwd("/transcript.jsonl")).resolves.toBe("/tail");

        expect(getAgentTranscriptCommand).toHaveBeenCalledTimes(1);
    });

    it("reads from the start only after a tail miss", async () => {
        getAgentTranscriptCommand
            .mockResolvedValueOnce({ lines: [JSON.stringify({ type: "assistant" })] })
            .mockResolvedValueOnce({
                lines: [JSON.stringify({ type: "session_meta", payload: { cwd: "/head" } })],
            });

        await expect(resolveCwd("/transcript.jsonl")).resolves.toBe("/head");

        expect(getAgentTranscriptCommand.mock.calls).toEqual([
            [expect.anything(), { path: "/transcript.jsonl", maxlines: 200 }],
            [expect.anything(), { path: "/transcript.jsonl", maxlines: 200, fromstart: true }],
        ]);
    });

    it("returns null for missing inputs or boundary failures", async () => {
        await expect(resolveCwd(undefined)).resolves.toBeNull();
        expect(getAgentTranscriptCommand).not.toHaveBeenCalled();

        getAgentTranscriptCommand.mockRejectedValueOnce(new Error("unavailable"));
        await expect(resolveCwd("/transcript.jsonl")).resolves.toBeNull();
    });

    it("does not load a block when there is no block id", async () => {
        getAgentTranscriptCommand.mockResolvedValue({ lines: cwdLines("/tail") });

        await expect(resolveCwd("/transcript.jsonl")).resolves.toBe("/tail");
        await expect(resolveCwd("/transcript.jsonl", "")).resolves.toBe("/tail");

        expect(loadAndPinWaveObject).not.toHaveBeenCalled();
    });

    it("ignores a block cmd:cwd that is not a non-empty string", async () => {
        for (const cwd of [42, true, "", null]) {
            getAgentTranscriptCommand.mockResolvedValueOnce({ lines: cwdLines("/tail") });
            loadAndPinWaveObject.mockResolvedValueOnce({ meta: { "cmd:cwd": cwd } });

            await expect(resolveCwd("/transcript.jsonl", "block-1")).resolves.toBe("/tail");
        }
    });
});
