import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_GRID } from "./agentgrid";
import {
    backgroundConfirmText,
    sleepingAge,
    sleepingOf,
    sleepToastText,
    sleepWithConfirm,
    viewingTabIds,
    wakeAgent,
    wakeErrorToast,
} from "./agentsleep";

const sleepCmd = vi.fn();
const wakeCmd = vi.fn();
const pushModal = vi.fn();
const pushToast = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        AgentsSleepCommand: (...a: any[]) => sleepCmd(...a),
        AgentsWakeCommand: (...a: any[]) => wakeCmd(...a),
        AgentsSetViewingCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: { pushModal: (...a: any[]) => pushModal(...a) } }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: any[]) => pushToast(...a) }));
vi.mock("@/app/store/global", () => ({ atoms: { documentHasFocus: {} } }));
vi.mock("@/app/store/jotaiStore", () => ({ globalStore: { get: () => undefined, set: () => {} } }));

const MB = 2 ** 20;
const SINCE = 1_700_000_000_000;

describe("sleepingOf", () => {
    it("reads the sleep keys of a sleeping block", () => {
        expect(sleepingOf({ "agent:sleeping": SINCE, "agent:sleepfreed": 330 * MB })).toEqual({
            since: SINCE,
            freedBytes: 330 * MB,
        });
    });

    it("carries the reason a wake failed", () => {
        expect(
            sleepingOf({ "agent:sleeping": SINCE, "agent:sleepfreed": 1, "agent:wakefailed": "session file is gone" })
        ).toEqual({ since: SINCE, freedBytes: 1, wakeFailed: "session file is gone" });
    });

    it("counts a missing freed size as zero and an empty failure reason as none", () => {
        expect(sleepingOf({ "agent:sleeping": SINCE, "agent:wakefailed": "" })).toEqual({
            since: SINCE,
            freedBytes: 0,
        });
    });

    it("is undefined for an awake block: absent, 0, or not a number", () => {
        expect(sleepingOf({ "agent:sleeping": 0, "agent:sleepfreed": 5 })).toBeUndefined();
        expect(sleepingOf({ "agent:sleeping": "yes" })).toBeUndefined();
        expect(sleepingOf({ cmd: "claude" })).toBeUndefined();
        expect(sleepingOf(undefined)).toBeUndefined();
        expect(sleepingOf(null)).toBeUndefined();
    });
});

describe("sleepingAge", () => {
    const vm = { sleeping: { since: SINCE, freedBytes: 0 } };

    it("reads how long it has slept", () => {
        expect(sleepingAge(vm, SINCE + 2 * 3_600_000)).toBe("sleeping 2h");
        expect(sleepingAge(vm, SINCE + 5 * 60_000)).toBe("sleeping 5m");
        expect(sleepingAge(vm, SINCE + 3 * 86_400_000)).toBe("sleeping 3d");
    });

    it("reads under a minute as <1m, and a clock behind the stamp as no time", () => {
        expect(sleepingAge(vm, SINCE + 10_000)).toBe("sleeping <1m");
        expect(sleepingAge(vm, SINCE - 5000)).toBe("sleeping <1m");
    });

    it("is empty for an awake agent", () => {
        expect(sleepingAge({}, SINCE)).toBe("");
    });
});

describe("viewingTabIds", () => {
    const grid = { ...EMPTY_GRID, ids: ["a", "b", "c"] };
    const solo = { ...EMPTY_GRID, ids: [] };

    it("is the focused agent, and every cell of the grid when it is one of them", () => {
        expect(viewingTabIds(true, true, "terminal", "b", grid)).toEqual(["a", "b", "c"]);
        expect(viewingTabIds(true, true, "terminal", "z", grid)).toEqual(["z"]);
        expect(viewingTabIds(true, true, "terminal", "z", solo)).toEqual(["z"]);
    });

    it("is nothing while the window is unfocused, off the Agent surface, or showing history", () => {
        expect(viewingTabIds(false, true, "terminal", "b", grid)).toEqual([]);
        expect(viewingTabIds(true, false, "terminal", "b", grid)).toEqual([]);
        expect(viewingTabIds(true, true, "history", "b", grid)).toEqual([]);
        expect(viewingTabIds(true, true, "terminal", undefined, grid)).toEqual([]);
    });

    it("lists ids in a fixed order, so an unchanged view compares equal", () => {
        const shuffled = { ...EMPTY_GRID, ids: ["c", "a", "b"] };
        expect(viewingTabIds(true, true, "terminal", "a", shuffled)).toEqual(["a", "b", "c"]);
    });
});

describe("sleepToastText", () => {
    it("names the agent and what its sleep freed", () => {
        expect(sleepToastText("Lumen", 330 * MB)).toBe("Put Lumen to sleep · freed 330 MB");
        expect(sleepToastText("Lumen", 1.5 * 2 ** 30)).toBe("Put Lumen to sleep · freed 1.5 GB");
    });

    it("leaves out a freed size the server did not measure", () => {
        expect(sleepToastText("Lumen", 0)).toBe("Put Lumen to sleep");
        expect(sleepToastText("Lumen", undefined)).toBe("Put Lumen to sleep");
    });
});

describe("backgroundConfirmText", () => {
    it("names each running task", () => {
        const text = backgroundConfirmText("Lumen", ["npm run build", "subagent: review"]);
        expect(text).toContain("Lumen");
        expect(text).toContain("npm run build");
        expect(text).toContain("subagent: review");
        expect(text).toContain("2 tasks");
    });

    it("says one task in the singular", () => {
        const text = backgroundConfirmText("Lumen", ["npm run build"]);
        expect(text).toContain("1 task ");
        expect(text).toContain("npm run build");
    });
});

describe("wakeAgent", () => {
    beforeEach(() => {
        wakeCmd.mockReset();
    });

    it("sends the tab, the message and fresh through AgentsWakeCommand with a 70s timeout", async () => {
        wakeCmd.mockResolvedValue(undefined);
        await wakeAgent("tab-1", { message: "carry on", fresh: true });
        expect(wakeCmd).toHaveBeenCalledWith(
            expect.anything(),
            { tab: "tab-1", message: "carry on", fresh: true },
            { timeout: 70_000 }
        );
    });

    it("rejects with the server's reason", async () => {
        wakeCmd.mockRejectedValue(new Error("session file is gone"));
        await expect(wakeAgent("tab-1")).rejects.toThrow("session file is gone");
    });
});

describe("wakeErrorToast", () => {
    beforeEach(() => {
        pushToast.mockReset();
    });

    it("names the agent and carries the server's reason", () => {
        wakeErrorToast("Lumen", new Error("session file is gone"));
        expect(pushToast).toHaveBeenCalledWith({
            title: "Couldn't wake Lumen",
            message: "session file is gone",
            level: "error",
        });
    });

    it("still reads without a name", () => {
        wakeErrorToast(undefined, "it timed out");
        expect(pushToast).toHaveBeenCalledWith({
            title: "Couldn't wake the agent",
            message: "it timed out",
            level: "error",
        });
    });
});

describe("sleepWithConfirm", () => {
    const agent = { id: "tab-1", name: "Lumen" };
    beforeEach(() => {
        sleepCmd.mockReset();
        pushModal.mockReset();
        pushToast.mockReset();
    });

    it("sleeps the agent and toasts what it freed", async () => {
        sleepCmd.mockResolvedValue({ freedbytes: 330 * MB });
        await sleepWithConfirm(agent);
        expect(sleepCmd).toHaveBeenCalledTimes(1);
        expect(sleepCmd.mock.calls[0][1]).toEqual({ tab: "tab-1" });
        expect(sleepCmd.mock.calls[0][2]).toEqual({ timeout: 15_000 }); // the server may take 5 s to see its tree die
        expect(pushModal).not.toHaveBeenCalled();
        expect(pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Put Lumen to sleep · freed 330 MB", level: "info" })
        );
    });

    it("asks first when background tasks run, and sleeps anyway with force once confirmed", async () => {
        sleepCmd.mockResolvedValueOnce({ background: ["npm run build"] });
        await sleepWithConfirm(agent);
        expect(pushToast).not.toHaveBeenCalled();
        expect(pushModal).toHaveBeenCalledTimes(1);
        const [name, props] = pushModal.mock.calls[0];
        expect(name).toBe("ConfirmModal");
        expect(props.confirmLabel).toBe("Sleep anyway");
        expect(props.message).toContain("npm run build");

        sleepCmd.mockResolvedValueOnce({ freedbytes: 100 * MB });
        props.onConfirm();
        await vi.waitFor(() => expect(sleepCmd).toHaveBeenCalledTimes(2));
        expect(sleepCmd.mock.calls[1][1]).toEqual({ tab: "tab-1", force: true });
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledTimes(1));
    });

    it("toasts the server's error and never throws", async () => {
        sleepCmd.mockRejectedValue(new Error("Lumen did not stop"));
        await expect(sleepWithConfirm(agent)).resolves.toBeUndefined();
        expect(pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Couldn't put Lumen to sleep", level: "error" })
        );
        expect(pushToast.mock.calls[0][0].message).toContain("Lumen did not stop");
    });
});
