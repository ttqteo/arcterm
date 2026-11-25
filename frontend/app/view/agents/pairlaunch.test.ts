// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// what openNewJudge and pickJudge call out to: the wavesrv commands, the launch, the toast, the conversation and the
// folders. Each is a spy so a test reads the order and the arguments.
const mocks = vi.hoisted(() => ({
    order: [] as string[],
    brief: vi.fn(),
    start: vi.fn(),
    launchAgent: vi.fn(),
    toast: vi.fn(),
    showPair: vi.fn(),
    resolveCwd: vi.fn(),
}));

vi.mock("@/app/cockpit/cockpit-actions", () => ({ launchAgent: mocks.launchAgent }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: mocks.toast }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { PairBriefCommand: mocks.brief, PairStartCommand: mocks.start },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/global-atoms", async () => {
    const { atom } = await import("jotai");
    return { atoms: { fullConfigAtom: atom({ projects: { "mit-thesis": { path: "C:/proj/mit-thesis" } } }) } };
});
vi.mock("./agentcenter", () => ({ showPair: mocks.showPair }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: mocks.resolveCwd }));
vi.mock("./railstore", async () => {
    const { atom } = await import("jotai");
    return { railCwdsAtom: atom<Record<string, string>>({}) };
});

import type { AgentsViewModel } from "./agents";
import type { AgentVM, PendingLaunch } from "./agentsviewmodel";
import {
    canPair,
    JUDGE_BOOT_MS,
    judgeBoot,
    judgeChoices,
    judgeFolder,
    judgeLabel,
    judgeLaunchOpts,
    openNewJudge,
    pairStartData,
    pickJudge,
} from "./pairlaunch";
import { railCwdsAtom } from "./railstore";

const WORKER = "61483cd6-5c1e-4b2a-9d3f-1a2b3c4d5e6f";
const JUDGE = "4c6ba858-0d7e-4f31-8a90-b1c2d3e4f5a6";
const OTHER = "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";
const PAIR_ID = "pair-1";

const agent = (extra: Partial<AgentVM> & Pick<AgentVM, "id" | "name">): AgentVM => ({
    task: "",
    state: "idle",
    agent: "claude",
    project: "mit-thesis",
    blockId: `blk-${extra.id.slice(0, 4)}`,
    ...extra,
});

const WORKER_VM = agent({ id: WORKER, name: "Plan oracle-tightening", transcriptPath: "C:/t/w.jsonl" });
const JUDGE_VM = agent({ id: JUDGE, name: "Judge: Plan oracle-tightening" });

const pending = (tabId: string): PendingLaunch => ({
    tabId,
    blockId: "blk-j",
    name: "Judge: Plan oracle-tightening",
    project: "mit-thesis",
    ts: 1,
    runtime: "claude",
});

const pairInfo = (worker: string, judges: string[]): PairInfo => ({
    id: PAIR_ID,
    project: "mit-thesis",
    worker: { tab: worker, name: "w", harness: "claude" },
    judges: judges.map((tab) => ({ tab, name: "j", harness: "claude" })),
    state: "relaying",
    stopreason: "",
    owed: false,
    messagecount: 0,
    lastts: 0,
});

describe("judgeLabel and judgeLaunchOpts", () => {
    it("names the worker in the judge's label", () => {
        expect(judgeLabel("Plan oracle-tightening")).toBe("Judge: Plan oracle-tightening");
    });

    it("launches claude on opus, in the worker's folder and project, with the brief as its task", () => {
        const opts = judgeLaunchOpts({
            workerName: "Plan oracle-tightening",
            project: "mit-thesis",
            folder: "C:/wt/oracle",
            brief: "You judge the work of agent 61483cd6.",
        });
        expect(opts).toStrictEqual({
            runtime: "claude",
            startupCommand: "claude",
            extraArgs: ["--model", "opus"],
            task: "You judge the work of agent 61483cd6.",
            projectPath: "C:/wt/oracle",
            projectName: "mit-thesis",
            label: "Judge: Plan oracle-tightening",
        });
    });

    it("leaves the launch its default focus: the judge's terminal must mount for its process to start", () => {
        const opts = judgeLaunchOpts({ workerName: "w", project: "p", folder: "C:/p", brief: "b" });
        expect(opts.focus).toBeUndefined();
        // a worktree would be a second copy of the code: the judge reads the worker's own folder
        expect(opts.branch).toBeUndefined();
    });
});

describe("judgeFolder", () => {
    it("is the worker's own folder (its worktree when it has one), else the project's root", () => {
        expect(judgeFolder("C:/wt/oracle", "C:/proj/mit-thesis")).toBe("C:/wt/oracle");
        expect(judgeFolder(undefined, "C:/proj/mit-thesis")).toBe("C:/proj/mit-thesis");
        expect(judgeFolder(null, "C:/proj/mit-thesis")).toBe("C:/proj/mit-thesis");
        expect(judgeFolder("  ", "C:/proj/mit-thesis")).toBe("C:/proj/mit-thesis");
    });

    it("is null with neither, so nothing launches in the wrong place", () => {
        expect(judgeFolder(undefined, undefined)).toBeNull();
        expect(judgeFolder("", "")).toBeNull();
    });
});

describe("canPair", () => {
    it("is a claude or pi agent with a tab of its own", () => {
        expect(canPair(agent({ id: "a", name: "a", agent: "claude" }))).toBe(true);
        expect(canPair(agent({ id: "a", name: "a", agent: "pi" }))).toBe(true);
    });

    it("is not a codex agent, a terminal, a background agent or one with no block yet", () => {
        expect(canPair(agent({ id: "a", name: "a", agent: "codex" }))).toBe(false);
        expect(canPair(agent({ id: "a", name: "a", kind: "terminal" }))).toBe(false);
        expect(canPair(agent({ id: "a", name: "a", kind: "background" }))).toBe(false);
        expect(canPair(agent({ id: "a", name: "a", blockId: undefined }))).toBe(false);
    });
});

describe("judgeChoices", () => {
    it("lists the project's live claude and pi agents that are in no pair, as name, short id and state", () => {
        const agents = [
            WORKER_VM,
            JUDGE_VM,
            agent({ id: OTHER, name: "Pull history and sync", state: "working" }),
            agent({ id: "7a7a7a7a-0000-4000-8000-000000000001", name: "A pi agent", agent: "pi" }),
        ];
        expect(judgeChoices(agents, WORKER, "mit-thesis", [])).toStrictEqual([
            { id: JUDGE, name: "Judge: Plan oracle-tightening", short: "4c6ba858", state: "idle" },
            { id: OTHER, name: "Pull history and sync", short: "9e0f1a2b", state: "working" },
            { id: "7a7a7a7a-0000-4000-8000-000000000001", name: "A pi agent", short: "7a7a7a7a", state: "idle" },
        ]);
    });

    it("leaves out another project's agents, codex, terminals, and agents without a tab", () => {
        const agents = [
            WORKER_VM,
            agent({ id: "1", name: "elsewhere", project: "other-project" }),
            agent({ id: "2", name: "codex one", agent: "codex" }),
            agent({ id: "3", name: "a shell", kind: "terminal" }),
            agent({ id: "4", name: "no block", blockId: undefined }),
        ];
        expect(judgeChoices(agents, WORKER, "mit-thesis", [])).toStrictEqual([]);
    });

    it("leaves out agents already in a pair, on either side (an agent is in at most one)", () => {
        const agents = [WORKER_VM, JUDGE_VM, agent({ id: OTHER, name: "Pull history and sync" })];
        // JUDGE judges someone else's worker; OTHER is a worker of its own
        const pairs = [pairInfo("someone-else", [JUDGE]), { ...pairInfo(OTHER, ["a-judge"]), id: "pair-2" }];
        expect(judgeChoices(agents, WORKER, "mit-thesis", pairs)).toStrictEqual([]);
    });

    it("reads an asleep agent as asleep, since its state stays idle", () => {
        const asleep = agent({ id: OTHER, name: "Napping", sleeping: { since: 1, freedBytes: 0 } });
        expect(judgeChoices([WORKER_VM, asleep], WORKER, "mit-thesis", [])[0].state).toBe("asleep");
    });
});

describe("pairStartData", () => {
    it("holds heavy commands and takes the default cap (0 is wavesrv's 3,000,000)", () => {
        expect(pairStartData(WORKER, JUDGE, false)).toStrictEqual({
            workertab: WORKER,
            judgetab: JUDGE,
            holdheavy: true,
            tokencap: 0,
            note: "",
            briefed: false,
        });
    });

    it("says briefed for a judge arcterm launched with the brief as its task", () => {
        expect(pairStartData(WORKER, JUDGE, true).briefed).toBe(true);
    });
});

describe("judgeBoot", () => {
    it("is booting while the launch is pending, even though the overlay already lists the tab", () => {
        expect(judgeBoot(JUDGE, [pending(JUDGE)], [WORKER_VM, JUDGE_VM])).toBe("booting");
    });

    it("is up once its row has reported in: no pending launch and the tab on the roster", () => {
        expect(judgeBoot(JUDGE, [], [WORKER_VM, JUDGE_VM])).toBe("up");
        // another tab's launch pending is not this one's
        expect(judgeBoot(JUDGE, [pending(OTHER)], [WORKER_VM, JUDGE_VM])).toBe("up");
    });

    it("is gone when the pending launch cleared because its tab closed: it never reached the roster", () => {
        expect(judgeBoot(JUDGE, [], [WORKER_VM])).toBe("gone");
    });
});

describe("openNewJudge", () => {
    const fakeModel = () =>
        ({
            agentsAtom: atom<AgentVM[]>([WORKER_VM]),
            pendingLaunchesAtom: atom<PendingLaunch[]>([]),
            focusIdAtom: atom<string | undefined>(WORKER),
            surfaceAtom: atom("agent"),
        }) as unknown as AgentsViewModel;

    // in the order the app has it: the roster gains the row, and that is what clears the pending launch (cockpitshell.tsx's
    // usePrunePendingLaunches); a launch cleared with no row on the roster is a closed tab
    const reportIn = (m: AgentsViewModel) => {
        // the real roster atom is derived; the fake model's is a plain one
        globalStore.set(m.agentsAtom as PrimitiveAtom<AgentVM[]>, [WORKER_VM, JUDGE_VM]);
        globalStore.set(m.pendingLaunchesAtom, []);
    };
    const settle = () => new Promise<void>((r) => setTimeout(r, 0));
    const focused = (m: AgentsViewModel) => globalStore.get(m.focusIdAtom);

    beforeEach(() => {
        mocks.order.length = 0;
        globalStore.set(railCwdsAtom, { [WORKER]: "C:/wt/oracle" });
        mocks.resolveCwd.mockReset().mockResolvedValue(null);
        mocks.brief.mockReset().mockImplementation(async () => {
            mocks.order.push("brief");
            return { text: "You judge the work of agent 61483cd6." };
        });
        // as the real launchAgent leaves things: a pending launch, and the new tab focused so its terminal mounts
        mocks.launchAgent.mockReset().mockImplementation(async (m: AgentsViewModel) => {
            mocks.order.push("launch");
            globalStore.set(m.pendingLaunchesAtom, [pending(JUDGE)]);
            globalStore.set(m.focusIdAtom, JUDGE);
            return JUDGE;
        });
        mocks.start.mockReset().mockImplementation(async () => {
            mocks.order.push("start");
            return { id: PAIR_ID };
        });
        mocks.toast.mockReset();
        mocks.showPair.mockReset();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("briefs, launches the judge, and pairs only once its row has reported in", async () => {
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        await settle();
        // still booting: nothing paired, the judge's tab is the focus so its terminal mounts and its process starts
        expect(mocks.start).not.toHaveBeenCalled();
        expect(focused(model)).toBe(JUDGE);

        reportIn(model);
        await done;

        expect(mocks.order).toStrictEqual(["brief", "launch", "start"]);
        expect(mocks.brief).toHaveBeenCalledWith({}, { workertab: WORKER });
        expect(mocks.launchAgent).toHaveBeenCalledWith(model, {
            runtime: "claude",
            startupCommand: "claude",
            extraArgs: ["--model", "opus"],
            task: "You judge the work of agent 61483cd6.",
            projectPath: "C:/wt/oracle",
            projectName: "mit-thesis",
            label: "Judge: Plan oracle-tightening",
        });
        expect(mocks.start).toHaveBeenCalledWith({}, pairStartData(WORKER, JUDGE, true));
        // back on the worker, showing the conversation
        expect(focused(model)).toBe(WORKER);
        expect(mocks.showPair).toHaveBeenCalledWith(PAIR_ID);
        expect(mocks.toast).not.toHaveBeenCalled();
    });

    it("falls back to the folder the worker's block or transcript names, then the project's root", async () => {
        globalStore.set(railCwdsAtom, {});
        mocks.resolveCwd.mockResolvedValue("C:/from/the/block");
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        expect(mocks.resolveCwd).toHaveBeenCalledWith("C:/t/w.jsonl", WORKER_VM.blockId);
        expect(mocks.launchAgent.mock.calls[0][1].projectPath).toBe("C:/from/the/block");
        reportIn(model);
        await done;

        mocks.launchAgent.mockClear();
        mocks.resolveCwd.mockResolvedValue(null);
        const second = fakeModel();
        const again = openNewJudge(second, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        expect(mocks.launchAgent.mock.calls[0][1].projectPath).toBe("C:/proj/mit-thesis");
        reportIn(second);
        await again;
    });

    it("pairs nothing when the judge's tab closes before it reports in, and says so", async () => {
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        await settle();
        // the pending launch clears because its tab is gone: the roster never listed it
        globalStore.set(model.pendingLaunchesAtom, []);
        await done;

        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.showPair).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledTimes(1);
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", title: "The judge did not start" })
        );
    });

    it("pairs nothing when the judge never reports in, after JUDGE_BOOT_MS", async () => {
        vi.useFakeTimers();
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.launchAgent).toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(JUDGE_BOOT_MS - 2);
        expect(mocks.toast).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2);
        await done;

        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", title: "The judge did not start" })
        );
    });

    it("stops listening once it has an answer: a report-in after the timeout starts nothing", async () => {
        vi.useFakeTimers();
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.advanceTimersByTimeAsync(JUDGE_BOOT_MS + 1);
        await done;
        reportIn(model);
        await vi.advanceTimersByTimeAsync(10);
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it("shows the error and launches nothing when the brief cannot be read", async () => {
        mocks.brief.mockReset().mockRejectedValue(new Error("no such agent"));
        const model = fakeModel();
        await openNewJudge(model, WORKER_VM, "mit-thesis");
        expect(mocks.launchAgent).not.toHaveBeenCalled();
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({
                level: "error",
                title: "Couldn't add a judge to Plan oracle-tightening",
                message: "no such agent",
            })
        );
    });

    it("shows the error and pairs nothing when the launch fails", async () => {
        mocks.launchAgent.mockReset().mockRejectedValue(new Error("no active workspace"));
        await openNewJudge(fakeModel(), WORKER_VM, "mit-thesis");
        expect(mocks.start).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", message: "no active workspace" })
        );
    });

    it("launches nothing when the worker's folder cannot be found", async () => {
        globalStore.set(railCwdsAtom, {});
        const model = fakeModel();
        await openNewJudge(model, WORKER_VM, "no-such-project");
        expect(mocks.launchAgent).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", title: "Couldn't add a judge to Plan oracle-tightening" })
        );
    });

    it("shows the error and leaves the focus where it is when PairStart refuses", async () => {
        mocks.start.mockReset().mockRejectedValue(new Error("the judge is already in a pair"));
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        await settle();
        reportIn(model);
        await done;

        expect(mocks.showPair).not.toHaveBeenCalled();
        expect(focused(model)).toBe(JUDGE);
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", message: "the judge is already in a pair" })
        );
    });

    it("pairs but leaves the person where they went while the judge booted", async () => {
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        await settle();
        globalStore.set(model.focusIdAtom, OTHER);
        reportIn(model);
        await done;

        expect(mocks.start).toHaveBeenCalledTimes(1);
        expect(focused(model)).toBe(OTHER);
        expect(mocks.showPair).not.toHaveBeenCalled();
    });

    it("shows the conversation too when the person already went back to the worker", async () => {
        const model = fakeModel();
        const done = openNewJudge(model, WORKER_VM, "mit-thesis");
        await vi.waitFor(() => expect(mocks.launchAgent).toHaveBeenCalled());
        await settle();
        globalStore.set(model.focusIdAtom, WORKER);
        reportIn(model);
        await done;

        expect(focused(model)).toBe(WORKER);
        expect(mocks.showPair).toHaveBeenCalledWith(PAIR_ID);
    });
});

describe("pickJudge", () => {
    beforeEach(() => {
        mocks.start.mockReset().mockResolvedValue({ id: PAIR_ID });
        mocks.toast.mockReset();
        mocks.showPair.mockReset();
    });

    it("pairs with the live agent (hold on, default cap, not briefed) and opens the conversation", async () => {
        await pickJudge(WORKER_VM, JUDGE);
        expect(mocks.start).toHaveBeenCalledWith({}, pairStartData(WORKER, JUDGE, false));
        expect(mocks.showPair).toHaveBeenCalledWith(PAIR_ID);
    });

    it("shows the error and opens nothing when PairStart refuses", async () => {
        mocks.start.mockReset().mockRejectedValue(new Error("an agent is in at most one pair"));
        await pickJudge(WORKER_VM, JUDGE);
        expect(mocks.showPair).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({
                level: "error",
                title: "Couldn't add a judge to Plan oracle-tightening",
                message: "an agent is in at most one pair",
            })
        );
    });
});
