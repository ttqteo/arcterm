import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistResume, shouldPersistResume, shouldRelaunchWorker } from "./agentresumestore";

const setMeta = vi.fn();
const reloadWaveObject = vi.fn();

vi.mock("@/app/store/jotaiStore", () => ({ globalStore: { get: () => true } }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { SetMetaCommand: (...a: any[]) => setMeta(...a) } }));
const agyBlocks = new Set(["block:agy-1", "block:agy-2", "block:agy-3"]);
vi.mock("@/app/store/wos", () => ({
    getObjectValue: (oref: string) =>
        agyBlocks.has(oref)
            ? {
                  meta: {
                      controller: "cmd",
                      cmd: "agy",
                      "agent:baseargs": ["--continue", "--sandbox"],
                      "cmd:args": ["--continue", "--sandbox", "-i", "task"],
                  },
              }
            : {
                  meta: {
                      controller: "cmd",
                      cmd: "pi",
                      "agent:baseargs": ["--session", "C:\\old\\s.jsonl", "--model", "x"],
                      "cmd:args": ["--session", "C:\\old\\s.jsonl", "--model", "x"],
                  },
              },
    reloadWaveObject: (...a: any[]) => reloadWaveObject(...a),
}));

describe("shouldPersistResume", () => {
    it("resumes a claude, opencode, or pi agent when Remember flags is on", () => {
        expect(shouldPersistResume("claude", true)).toBe(true);
        expect(shouldPersistResume("opencode", true)).toBe(true);
        expect(shouldPersistResume("pi", true)).toBe(true);
        expect(shouldPersistResume("agy", true)).toBe(true);
    });

    it("does not resume when Remember flags is off (user wants a clean slate)", () => {
        expect(shouldPersistResume("opencode", false)).toBe(false);
        expect(shouldPersistResume("pi", false)).toBe(false);
    });

    it("never resumes codex or unknown providers", () => {
        expect(shouldPersistResume("codex", true)).toBe(false);
        expect(shouldPersistResume(undefined, true)).toBe(false);
    });

    it("matches the provider case-insensitively", () => {
        expect(shouldPersistResume("OpEnCoDe", true)).toBe(true);
        expect(shouldPersistResume("PI", true)).toBe(true);
    });
});

describe("persistResume (pi)", () => {
    beforeEach(() => {
        setMeta.mockClear();
        reloadWaveObject.mockClear();
    });

    it("bakes the full transcript path as pi's resume args", async () => {
        const oref = "block:pi-1";
        const path = "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl";
        await persistResume(oref, "pi", path);
        expect(setMeta.mock.calls[0][1]).toEqual({
            oref,
            meta: { "cmd:args": ["--session", path, "--model", "x"] },
        });
        expect(reloadWaveObject).toHaveBeenCalledWith(oref);
    });

    it("dedups on the full transcript path so a repeat status update skips the write", async () => {
        const oref = "block:pi-2";
        const path = "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl";
        await persistResume(oref, "pi", path);
        setMeta.mockClear();
        await persistResume(oref, "pi", path);
        expect(setMeta).not.toHaveBeenCalled();
    });

    it("drops a pi session with no transcript path (no id fallback for pi)", async () => {
        const oref = "block:pi-3";
        await persistResume(oref, "pi", undefined);
        expect(setMeta).not.toHaveBeenCalled();
    });
});

describe("persistResume (agy)", () => {
    // every agy transcript is named transcript_full.jsonl, so the transcript stem is no key: the status's
    // sessionid is
    const transcript = (id: string) =>
        `/Users/x/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`;

    beforeEach(() => {
        setMeta.mockClear();
        reloadWaveObject.mockClear();
    });

    it("bakes the status sessionid as agy's --conversation, dropping --continue and the task", async () => {
        await persistResume("block:agy-1", "agy", transcript("c1"), "c1");
        expect(setMeta.mock.calls[0][1]).toEqual({
            oref: "block:agy-1",
            meta: { "cmd:args": ["--conversation", "c1", "--sandbox"] },
        });
    });

    it("gives two agy blocks whose transcripts both end in transcript_full.jsonl their own ids", async () => {
        await persistResume("block:agy-2", "agy", transcript("c2"), "c2");
        await persistResume("block:agy-3", "agy", transcript("c3"), "c3");
        expect(setMeta.mock.calls.map((c) => (c[1] as any).meta["cmd:args"].slice(0, 2))).toEqual([
            ["--conversation", "c2"],
            ["--conversation", "c3"],
        ]);
    });

    it("writes nothing for an agy status with no sessionid (the stem would be the same for every agy)", async () => {
        await persistResume("block:agy-1", "agy", transcript("c9"), undefined);
        expect(setMeta).not.toHaveBeenCalled();
    });
});

describe("shouldRelaunchWorker", () => {
    const worker = { "agent:runid": "r1", "agent:taskid": "t-1" };

    it("does not relaunch a worker whose run is over", () => {
        expect(shouldRelaunchWorker(worker, "done")).toBe(false);
        expect(shouldRelaunchWorker(worker, "failed")).toBe(false);
        expect(shouldRelaunchWorker(worker, "cancelled")).toBe(false);
    });

    it("relaunches a worker whose run is still live", () => {
        expect(shouldRelaunchWorker(worker, "executing")).toBe(true);
    });

    it("does not relaunch a blocked run's stopped worker: Resume brings it back in its session", () => {
        expect(shouldRelaunchWorker(worker, "blocked")).toBe(false);
        expect(shouldRelaunchWorker({ cmd: "claude" }, "blocked")).toBe(true);
    });

    it("relaunches when the run status is unknown", () => {
        expect(shouldRelaunchWorker(worker, undefined)).toBe(true);
    });

    it("relaunches a hand-launched agent that carries no agent:runid, whatever the status", () => {
        expect(shouldRelaunchWorker({ cmd: "claude" }, "done")).toBe(true);
        expect(shouldRelaunchWorker(undefined, undefined)).toBe(true);
    });
});
