// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Xử lý and Chọn thư mục… do (bugreportprocess.ts), with the wire and the launcher stood in for: which calls go out
// in what order, and what a failure at each step leaves behind.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
    status: vi.fn(),
    list: vi.fn(),
    claim: vi.fn(),
    setConfig: vi.fn(),
    launchAgent: vi.fn(),
    pushToast: vi.fn(),
    loadAttention: vi.fn(),
    registerProject: vi.fn(),
}));

vi.mock("@/app/store/jotaiStore", async () => ({ globalStore: (await import("jotai")).createStore() }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        BugReportStatusCommand: (...a: any[]) => m.status(...a),
        BugReportListCommand: (...a: any[]) => m.list(...a),
        BugReportClaimCommand: (...a: any[]) => m.claim(...a),
        SetConfigCommand: (...a: any[]) => m.setConfig(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/cockpit-actions", () => ({ launchAgent: (...a: any[]) => m.launchAgent(...a) }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: any[]) => m.pushToast(...a) }));
vi.mock("@/app/view/agents/attentionstore", () => ({ loadAttention: (...a: any[]) => m.loadAttention(...a) }));
vi.mock("@/app/view/agents/harnessstore", async () => {
    const { atom } = await import("jotai");
    return {
        harnessPreferenceAtom: atom({ route: undefined }),
        harnessesAtom: atom([]),
        resolveDefaultRuntime: (pref: string) => pref,
    };
});
vi.mock("@/app/view/agents/launch", () => ({
    composeStartupCommand: (cmd: string, runtime: string) => `${cmd}|${runtime}`,
    runtimeStartupCommand: (runtime: string) => `start-${runtime}`,
}));
vi.mock("@/app/view/agents/naflagsstore", async () => ({ naFlagsAtom: (await import("jotai")).atom({}) }));
vi.mock("@/app/view/agents/projectsstore", async () => {
    const { atom } = await import("jotai");
    return {
        projectsAtom: atom<Record<string, { path?: string }>>({}),
        registerProject: (...a: any[]) => m.registerProject(...a),
    };
});

import { globalStore } from "@/app/store/jotaiStore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import type { PrimitiveAtom } from "jotai";
import { pickBugReportRepo, processBugReports } from "./bugreportprocess";

// the real projectsAtom is derived from the config and read-only; the mock above makes it a plain atom the cases fill
const setProjects = (registry: Record<string, { path?: string }>) =>
    globalStore.set(projectsAtom as unknown as PrimitiveAtom<Record<string, { path?: string }>>, registry);

const model = {} as any;
const REPO = "D:\\work\\arcterm";

const report = (id: string) =>
    ({
        id,
        ts: 1,
        text: `report ${id}`,
        version: "0.1",
        state: "waiting",
        dir: `C:\\data\\reports\\${id}`,
        hasscreen: true,
    }) as BugReport;
const status = (over: Partial<BugReportStatus> = {}): BugReportStatus => ({
    waiting: 2,
    handling: 0,
    repopath: REPO,
    repoproject: "arcterm",
    ...over,
});

beforeEach(() => {
    m.status.mockResolvedValue(status());
    m.list.mockResolvedValue([report("20261119-153012"), report("20261119-154501")]);
    m.claim.mockResolvedValue({ claimed: ["20261119-153012", "20261119-154501"] });
    m.launchAgent.mockResolvedValue("tab-9");
    m.setConfig.mockResolvedValue(undefined);
    m.loadAttention.mockResolvedValue(undefined);
    m.registerProject.mockResolvedValue(undefined);
    setProjects({});
});

afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
});

describe("processBugReports", () => {
    it("starts one agent in arcterm's repo with every waiting report, then claims exactly those for its tab", async () => {
        await processBugReports(model);
        expect(m.list).toHaveBeenCalledWith(expect.anything(), { state: "waiting" });
        expect(m.launchAgent).toHaveBeenCalledTimes(1);
        const [passedModel, opts] = m.launchAgent.mock.calls[0];
        expect(passedModel).toBe(model);
        expect(opts).toMatchObject({
            runtime: "claude",
            projectPath: REPO,
            projectName: "arcterm",
            label: "Báo lỗi arcterm",
            startupCommand: "start-claude|claude",
        });
        // the seeded prompt names every report folder and id
        for (const id of ["20261119-153012", "20261119-154501"]) {
            expect(opts.task).toContain(id);
            expect(opts.task).toContain(`C:/data/reports/${id}`);
        }
        expect(m.claim).toHaveBeenCalledWith(expect.anything(), {
            agentid: "tab-9",
            ids: ["20261119-153012", "20261119-154501"],
        });
        // launch first, claim after: a failed launch must claim nothing
        expect(m.launchAgent.mock.invocationCallOrder[0]).toBeLessThan(m.claim.mock.invocationCallOrder[0]);
        expect(m.loadAttention).toHaveBeenCalled();
        expect(m.pushToast).not.toHaveBeenCalled();
    });

    it("refuses with a toast while an agent already holds reports, and starts nothing", async () => {
        m.status.mockResolvedValue(status({ waiting: 0, handling: 2, handler: "tab-3" }));
        await processBugReports(model);
        expect(m.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Đang xử lý 2 báo lỗi" }));
        expect(m.list).not.toHaveBeenCalled();
        expect(m.launchAgent).not.toHaveBeenCalled();
        expect(m.claim).not.toHaveBeenCalled();
    });

    it("says so when no arcterm repo is known", async () => {
        m.status.mockResolvedValue(status({ repopath: undefined, repoproject: undefined }));
        await processBugReports(model);
        expect(m.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Không tìm thấy repo arcterm", level: "error" })
        );
        expect(m.launchAgent).not.toHaveBeenCalled();
    });

    it("starts nothing when no report waits any more", async () => {
        m.list.mockResolvedValue([]);
        await processBugReports(model);
        expect(m.pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không có báo lỗi nào đang chờ" }));
        expect(m.launchAgent).not.toHaveBeenCalled();
        expect(m.claim).not.toHaveBeenCalled();
    });

    it("claims nothing when the launch fails, and says why", async () => {
        m.launchAgent.mockRejectedValue(new Error("no active workspace"));
        await processBugReports(model);
        expect(m.claim).not.toHaveBeenCalled();
        expect(m.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "Không mở được agent xử lý báo lỗi",
                message: "no active workspace",
                level: "error",
            })
        );
        expect(m.loadAttention).toHaveBeenCalled();
    });

    it("leaves the agent open and says so when the claim fails", async () => {
        m.claim.mockRejectedValue(new Error("a report is already handling"));
        await processBugReports(model);
        expect(m.launchAgent).toHaveBeenCalledTimes(1);
        expect(m.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: "Agent đã mở nhưng chưa giữ được các báo lỗi",
                message: "a report is already handling",
            })
        );
        expect(m.loadAttention).toHaveBeenCalled();
    });

    it("reads a failed status or list as a toast naming what failed", async () => {
        m.status.mockRejectedValue(new Error("rpc down"));
        await processBugReports(model);
        expect(m.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Không đọc được các báo lỗi", message: "rpc down" })
        );
        expect(m.launchAgent).not.toHaveBeenCalled();
    });

    it("registers the project at the repo first when the setting has no project, and launches under its name", async () => {
        m.status.mockResolvedValue(status({ repoproject: undefined }));
        await processBugReports(model);
        expect(m.registerProject).toHaveBeenCalledWith("arcterm", REPO);
        expect(m.launchAgent.mock.calls[0][1]).toMatchObject({ projectName: "arcterm", projectPath: REPO });
        expect(m.registerProject.mock.invocationCallOrder[0]).toBeLessThan(m.launchAgent.mock.invocationCallOrder[0]);
    });

    it("launches under the project already registered at the repo, registering none", async () => {
        m.status.mockResolvedValue(status({ repoproject: undefined }));
        setProjects({ "my-arcterm": { path: "d:/work/arcterm" } });
        await processBugReports(model);
        expect(m.registerProject).not.toHaveBeenCalled();
        expect(m.launchAgent.mock.calls[0][1]).toMatchObject({ projectName: "my-arcterm" });
    });

    it("starts no agent when the project cannot be registered", async () => {
        m.status.mockResolvedValue(status({ repoproject: undefined }));
        m.registerProject.mockRejectedValue(new Error("disk full"));
        await processBugReports(model);
        expect(m.launchAgent).not.toHaveBeenCalled();
        expect(m.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full", level: "error" }));
    });

    it("lets a second press while the first is still starting do nothing", async () => {
        let release: (tab: string) => void = () => {};
        m.launchAgent.mockReturnValue(new Promise<string>((r) => (release = r)));
        const first = processBugReports(model);
        // the first press is parked at the launch
        await vi.waitFor(() => expect(m.launchAgent).toHaveBeenCalledTimes(1));
        await processBugReports(model);
        expect(m.status).toHaveBeenCalledTimes(1);
        release("tab-9");
        await first;
        expect(m.launchAgent).toHaveBeenCalledTimes(1);
        expect(m.claim).toHaveBeenCalledTimes(1);
        // and a press after it finished works again
        m.launchAgent.mockResolvedValue("tab-10");
        await processBugReports(model);
        expect(m.launchAgent).toHaveBeenCalledTimes(2);
    });

    it("lets the DEV fake stand in for the launcher, with the same options", async () => {
        const fake = vi.fn().mockResolvedValue("fake-tab");
        vi.stubGlobal("window", { __bugReportLaunchFake: fake });
        await processBugReports(model);
        expect(m.launchAgent).not.toHaveBeenCalled();
        expect(fake).toHaveBeenCalledTimes(1);
        expect(fake.mock.calls[0][0]).toMatchObject({
            label: "Báo lỗi arcterm",
            projectName: "arcterm",
            projectPath: REPO,
        });
        expect(m.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentid: "fake-tab" }));
    });
});

describe("pickBugReportRepo", () => {
    const pickFake = (picked: string | null) => vi.stubGlobal("window", { __bugReportPickFake: async () => picked });

    it("keeps the folder as bugreport:repo and registers a project named after it", async () => {
        pickFake("D:\\work\\arcterm");
        await pickBugReportRepo(model);
        expect(m.setConfig).toHaveBeenCalledWith(expect.anything(), { "bugreport:repo": "D:\\work\\arcterm" });
        expect(m.registerProject).toHaveBeenCalledWith("arcterm", "D:\\work\\arcterm");
        expect(m.setConfig.mock.invocationCallOrder[0]).toBeLessThan(m.registerProject.mock.invocationCallOrder[0]);
        expect(m.loadAttention).toHaveBeenCalled();
    });

    it("registers nothing when a project already sits at the folder", async () => {
        setProjects({ arcterm: { path: "D:/work/arcterm" } });
        pickFake("D:\\work\\arcterm");
        await pickBugReportRepo(model);
        expect(m.setConfig).toHaveBeenCalledTimes(1);
        expect(m.registerProject).not.toHaveBeenCalled();
    });

    it("takes the first free -2 when another folder holds the name", async () => {
        setProjects({ arcterm: { path: "D:/old/arcterm" } });
        pickFake("D:\\work\\arcterm");
        await pickBugReportRepo(model);
        expect(m.registerProject).toHaveBeenCalledWith("arcterm-2", "D:\\work\\arcterm");
    });

    it("does nothing for a cancelled dialog", async () => {
        pickFake(null);
        await pickBugReportRepo(model);
        expect(m.setConfig).not.toHaveBeenCalled();
        expect(m.registerProject).not.toHaveBeenCalled();
        expect(m.pushToast).not.toHaveBeenCalled();
    });

    it("keeps nothing and says so when the setting cannot be written", async () => {
        m.setConfig.mockRejectedValue(new Error("read-only config"));
        pickFake("D:\\work\\arcterm");
        await pickBugReportRepo(model);
        expect(m.registerProject).not.toHaveBeenCalled();
        expect(m.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ message: "read-only config", level: "error" })
        );
    });

    it("keeps the setting and says so when the project cannot be registered", async () => {
        m.registerProject.mockRejectedValue(new Error("disk full"));
        pickFake("D:\\work\\arcterm");
        await pickBugReportRepo(model);
        expect(m.setConfig).toHaveBeenCalledTimes(1);
        expect(m.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full", level: "error" }));
        expect(m.loadAttention).toHaveBeenCalled();
    });
});
