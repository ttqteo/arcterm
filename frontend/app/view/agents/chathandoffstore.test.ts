// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanFacts, planFactsAtom } from "./chathandoffstore";

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { FileReadCommand: vi.fn(), RunQueueListCommand: vi.fn() },
}));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: vi.fn() }));

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

const PLAN = [
    "# Chat verdict and handoff cards",
    "",
    "### Task 1: one",
    "**Depends on:** none",
    "",
    "### Task 2: two",
    "**Depends on:** none",
    "",
    "### Task 3: three",
    "**Depends on:** Task 1, Task 2",
    "",
].join("\n");

// each test reads a path of its own: a path is read once per app session
let n = 0;
const nextPath = () => `/r/plans/plan-${++n}.md`;

describe("loadPlanFacts", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        vi.mocked(RpcApi.FileReadCommand).mockReset();
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it("keeps the plan's title, tasks and width under its path", async () => {
        const path = nextPath();
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: b64(PLAN) });
        await loadPlanFacts(path);
        expect(RpcApi.FileReadCommand).toHaveBeenCalledWith({}, { info: { path } });
        expect(globalStore.get(planFactsAtom)[path]).toEqual({
            title: "Chat verdict and handoff cards",
            tasks: 3,
            width: 2,
        });
    });

    it("reads a path once, however often it is asked for", async () => {
        const path = nextPath();
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({ data64: b64(PLAN) });
        await Promise.all([loadPlanFacts(path), loadPlanFacts(path)]);
        await loadPlanFacts(path);
        expect(RpcApi.FileReadCommand).toHaveBeenCalledTimes(1);
    });

    it("logs a failed read once, leaves the facts out and does not try again", async () => {
        const path = nextPath();
        vi.mocked(RpcApi.FileReadCommand).mockRejectedValue(new Error("not found"));
        await loadPlanFacts(path);
        await loadPlanFacts(path);
        expect(RpcApi.FileReadCommand).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain(path);
        expect(globalStore.get(planFactsAtom)[path]).toBeUndefined();
    });

    it("treats a read with no content as a failure", async () => {
        const path = nextPath();
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({});
        await loadPlanFacts(path);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(globalStore.get(planFactsAtom)[path]).toBeUndefined();
    });

    it("keeps the facts of one plan beside another's", async () => {
        const a = nextPath();
        const b = nextPath();
        vi.mocked(RpcApi.FileReadCommand)
            .mockResolvedValueOnce({ data64: b64("# A\n") })
            .mockResolvedValueOnce({ data64: b64("# B\n") });
        await loadPlanFacts(a);
        await loadPlanFacts(b);
        expect(globalStore.get(planFactsAtom)[a]).toEqual({ title: "A" });
        expect(globalStore.get(planFactsAtom)[b]).toEqual({ title: "B" });
    });
});
