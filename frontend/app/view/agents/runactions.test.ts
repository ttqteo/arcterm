import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stopRunWorkerCommand = vi.fn();
const cancelRunCommand = vi.fn();
const createRunCommand = vi.fn();
const getJarvisProfileCommand = vi.fn();
const pushModal = vi.fn();

vi.mock("@/app/store/global-atoms", async () => {
    const actual = await vi.importActual<typeof import("@/app/store/global-atoms")>("@/app/store/global-atoms");
    const { atom } = await import("jotai");
    return { ...actual, atoms: { workspaceId: atom("workspace-1") as any, settingsAtom: atom({}) as any } };
});
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        StopRunWorkerCommand: (...args: any[]) => stopRunWorkerCommand(...args),
        CancelRunCommand: (...args: any[]) => cancelRunCommand(...args),
        CreateRunCommand: (...args: any[]) => createRunCommand(...args),
        GetJarvisProfileCommand: (...args: any[]) => getJarvisProfileCommand(...args),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { pushModal: (...args: any[]) => pushModal(...args) },
}));

import {
    cancelRun,
    cancellingRunIdsAtom,
    confirmCancelRun,
    stopRunWorker,
    stoppingWorkerIdsAtom,
    cacheJarvisProfile,
    resolvedProfileAtom,
    channelOverrideAtom,
    createRun,
    resolveChannelLaunchRoute,
} from "./runactions";
import { harnessesAtom, harnessPreferenceAtom } from "./harnessstore";

function deferred() {
    let resolve!: () => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    stopRunWorkerCommand.mockReset();
    cancelRunCommand.mockReset();
    createRunCommand.mockReset();
    pushModal.mockReset();
    globalStore.set(stoppingWorkerIdsAtom, new Set());
    globalStore.set(cancellingRunIdsAtom, new Set());
    globalStore.set(resolvedProfileAtom, {});
    globalStore.set(channelOverrideAtom, {});
});

describe("profile cache", () => {
    it("stores resolved profile and channel override together", () => {
        const response = {
            global: {} as JarvisProfile,
            override: { route: { runtime: "pi" } },
            resolved: { defaultmode: "pipeline" } as JarvisProfile,
        } as CommandGetJarvisProfileRtnData;
        cacheJarvisProfile("channel-1", response);
        expect(globalStore.get(resolvedProfileAtom)["channel-1"]).toBe(response.resolved);
        expect(globalStore.get(channelOverrideAtom)["channel-1"]).toBe(response.override);
    });
});

describe("createRun", () => {
    it.each([undefined, "quick", "pipeline"])("omits orchestrator options for mode %s", async (mode) => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "fix", { runtime: "pi" }, {
            mode,
            orchestration: "engine",
            workerRoute: { runtime: "claude", model:"sonnet" },
        });
        const payload = createRunCommand.mock.calls[0][1];
        expect(payload.mode).toBe(mode);
        expect(payload).not.toHaveProperty("orchestration");
        expect(payload).not.toHaveProperty("workerroute");
    });

    it("preserves an explicitly selected engine orchestrator", async () => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "coordinate", { runtime: "pi" }, {
            mode: "orchestrator",
            orchestration: "engine",
            workerRoute: { runtime: "claude", model:"sonnet" },
        });
        expect(createRunCommand.mock.calls[0][1]).toMatchObject({
            mode: "orchestrator",
            orchestration: "engine",
            workerroute: { runtime: "claude", model: "sonnet" },
        });
    });

    it("sends workerRoute when B1b workers picker is set", async () => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "ship", { runtime: "claude", model:"opus" }, { mode: "orchestrator", workerRoute: { runtime: "pi", model: "opencode/deepseek-v4-pro" } as RoutePin });
        expect(createRunCommand).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workerroute: { runtime: "pi", model: "opencode/deepseek-v4-pro" } }), expect.anything());
    });
    it("omits workerRoute when workers inherit (collapsed)", async () => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-2" } });
        await createRun("channel-1", "ship", { runtime: "claude", model:"opus" }, { mode: "orchestrator" });
        expect(createRunCommand).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ workerroute: expect.anything() }), expect.anything());
    });
    it("maps deferred orchestrator options to the RPC shape", async () => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "ship", { runtime: "pi" }, { mode: "orchestrator", deferStart: true });
        expect(createRunCommand).toHaveBeenCalledWith(
            expect.anything(),
            {
                channelid: "channel-1",
                workspaceid: "workspace-1",
                goal: "ship",
                runtime: "pi",
                mode: "orchestrator",
                deferstart: true,
                radarorigin: undefined,
            },
            expect.objectContaining({ timeout: expect.any(Number) }),
        );

        createRunCommand.mockResolvedValueOnce({ run: { id: "run-2" } });
        await createRun("channel-1", "direct", { runtime: "pi" });
        expect(createRunCommand.mock.calls[1][1]).toEqual(
            expect.objectContaining({ runtime: "pi", mode: undefined, deferstart: undefined }),
        );
    });

    it("sends an orchestrator run's prototype, and drops it from any other mode", async () => {
        const prototype = "C:/p/.superpowers/design/t/project/Main.dc.html";
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "build", { runtime: "pi" }, { mode: "orchestrator", prototype });
        expect(createRunCommand.mock.calls[0][1]).toMatchObject({ mode: "orchestrator", prototype });

        createRunCommand.mockResolvedValueOnce({ run: { id: "run-2" } });
        await createRun("channel-1", "build", { runtime: "pi" }, { mode: "quick", prototype });
        expect(createRunCommand.mock.calls[1][1]).not.toHaveProperty("prototype");
    });

    it("sends a budget that covers a whole engine launch", async () => {
        createRunCommand.mockResolvedValueOnce({ run: { id: "run-1" } });
        await createRun("channel-1", "ship", { runtime: "pi" }, { mode: "orchestrator", planPath: "plan.md" });
        const opts = createRunCommand.mock.calls[0][2];
        expect(opts?.timeout).toBeGreaterThanOrEqual(60_000);
    });

    it("throws a clear error when the server returns no run", async () => {
        createRunCommand.mockResolvedValueOnce({ run: null });
        await expect(createRun("ch-1", "goal", { runtime: "claude" })).rejects.toThrow("returned no run");
    });
});

describe("stopRunWorker", () => {
    it("tracks the stripped tab id while preserving the worker oref in the RPC", async () => {
        const pending = deferred();
        stopRunWorkerCommand.mockReturnValueOnce(pending.promise);

        const call = stopRunWorker("channel-1", "run-1", "tab:worker-1");

        expect([...globalStore.get(stoppingWorkerIdsAtom)]).toEqual(["worker-1"]);
        expect(stopRunWorkerCommand).toHaveBeenCalledWith(expect.anything(), {
            channelid: "channel-1",
            runid: "run-1",
            workeroref: "tab:worker-1",
        });

        pending.resolve();
        await call;
        expect(globalStore.get(stoppingWorkerIdsAtom).size).toBe(0);
    });

    it("removes the in-flight id when the RPC rejects", async () => {
        const pending = deferred();
        stopRunWorkerCommand.mockReturnValueOnce(pending.promise);
        const call = stopRunWorker("channel-1", "run-1", "worker-1");
        const rejected = expect(call).rejects.toThrow("stop failed");

        expect([...globalStore.get(stoppingWorkerIdsAtom)]).toEqual(["worker-1"]);
        pending.reject(new Error("stop failed"));

        await rejected;
        expect(globalStore.get(stoppingWorkerIdsAtom).size).toBe(0);
    });
});

describe("cancelRun", () => {
    it("tracks the run id until cancellation resolves", async () => {
        const pending = deferred();
        cancelRunCommand.mockReturnValueOnce(pending.promise);

        const call = cancelRun("channel-1", "run-1");

        expect([...globalStore.get(cancellingRunIdsAtom)]).toEqual(["run-1"]);
        expect(cancelRunCommand).toHaveBeenCalledWith(expect.anything(), {
            channelid: "channel-1",
            runid: "run-1",
        });

        pending.resolve();
        await call;
        expect(globalStore.get(cancellingRunIdsAtom).size).toBe(0);
    });

    it("removes the in-flight id when cancellation rejects", async () => {
        const pending = deferred();
        cancelRunCommand.mockReturnValueOnce(pending.promise);
        const call = cancelRun("channel-1", "run-1");
        const rejected = expect(call).rejects.toThrow("cancel failed");

        expect([...globalStore.get(cancellingRunIdsAtom)]).toEqual(["run-1"]);
        pending.reject(new Error("cancel failed"));

        await rejected;
        expect(globalStore.get(cancellingRunIdsAtom).size).toBe(0);
    });
});

describe("confirmCancelRun", () => {
    it("cancels directly when no workers are live", async () => {
        cancelRunCommand.mockResolvedValueOnce(undefined);

        confirmCancelRun("channel-1", "run-1", 0);

        expect(pushModal).not.toHaveBeenCalled();
        await vi.waitFor(() =>
            expect(cancelRunCommand).toHaveBeenCalledWith(expect.anything(), {
                channelid: "channel-1",
                runid: "run-1",
            })
        );
    });

    it.each([
        [1, "Stop 1 running worker and cancel this run? Completed phases, transcripts, and artifacts are kept."],
        [2, "Stop 2 running workers and cancel this run? Completed phases, transcripts, and artifacts are kept."],
    ])("confirms before stopping %i live worker(s)", async (liveCount, message) => {
        cancelRunCommand.mockResolvedValueOnce(undefined);

        confirmCancelRun("channel-1", "run-1", liveCount);

        expect(cancelRunCommand).not.toHaveBeenCalled();
        expect(pushModal).toHaveBeenCalledTimes(1);
        const [displayName, props] = pushModal.mock.calls[0];
        expect(displayName).toBe("ConfirmModal");
        expect(props).toEqual(
            expect.objectContaining({
                title: "Cancel run",
                message,
                confirmLabel: "Cancel run",
                cancelLabel: "Keep running",
                destructive: true,
            })
        );

        props.onConfirm();
        await vi.waitFor(() => expect(cancelRunCommand).toHaveBeenCalledTimes(1));
    });
});

describe("resolveChannelLaunchRoute", () => {
    const h = (runtime: string, leadcapable: boolean) =>
        ({ runtime, label: runtime, installed: true, leadcapable, routecapabilities: [{ runtime, resolvedmodel: "default" }] }) as HarnessInfo;

    beforeEach(() => {
        getJarvisProfileCommand.mockReset();
        getJarvisProfileCommand.mockResolvedValue({ override: {} });
        globalStore.set(harnessesAtom, [h("agy", false), h("claude", true), h("pi", true)]);
    });

    it("never launches a run with an agy lead when the shared preference is agy", async () => {
        globalStore.set(harnessPreferenceAtom, { route: { runtime: "agy" }, persistedRoute: { runtime: "agy" }, saving: false });
        const pin = await resolveChannelLaunchRoute("channel-1");
        expect(["claude", "pi"]).toContain(pin.runtime);
    });

    it("keeps a lead-capable channel override over an agy preference", async () => {
        globalStore.set(harnessPreferenceAtom, { route: { runtime: "agy" }, persistedRoute: { runtime: "agy" }, saving: false });
        getJarvisProfileCommand.mockResolvedValue({ override: { route: { runtime: "pi" } } });
        expect(await resolveChannelLaunchRoute("channel-1")).toEqual({ runtime: "pi" });
    });
});
