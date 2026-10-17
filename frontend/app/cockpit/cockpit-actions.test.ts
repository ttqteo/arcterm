import { atom } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";

// launchAgent configures the new tab's default block via SetMeta, but the frontend's cached
// (unsubscribed) block object stays stale at the pre-conversion shell meta — so the session
// sidebar never sees cmd:cwd and the agent never enters the roster (empty cockpit panel). The fix
// reloads the block object after SetMeta. These tests lock in that reload.

const createTab = vi.fn();
const setMeta = vi.fn().mockResolvedValue(undefined);
const reloadWaveObject = vi.fn().mockResolvedValue(undefined);
const fileInfo = vi.fn();
const agentSyncApply = vi.fn().mockResolvedValue({ actions: [] });
const wake = vi.fn().mockResolvedValue(undefined);
const controllerInput = vi.fn().mockResolvedValue(undefined);

const controllerStatus = vi.fn().mockResolvedValue(null);
// the store's tabs and blocks by oref, as WOS has them cached
let stored: Record<string, any> = {};

vi.mock("@/app/store/services", () => ({
    WorkspaceService: { CreateTab: (...a: any[]) => createTab(...a) },
    BlockService: { GetControllerStatus: (...a: any[]) => controllerStatus(...a) },
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        SetMetaCommand: (...a: any[]) => setMeta(...a),
        FileInfoCommand: (...a: any[]) => fileInfo(...a),
        AgentSyncApplyCommand: (...a: any[]) => agentSyncApply(...a),
        AgentsWakeCommand: (...a: any[]) => wake(...a),
        ControllerInputCommand: (...a: any[]) => controllerInput(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/agents/agents", () => ({ AgentsViewModel: class {} }));
vi.mock("@/app/store/global-atoms", async () => {
    const { atom } = await import("jotai");
    return { atoms: { workspace: atom({ oid: "ws1", tabids: [] as string[] }) } };
});
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    getWaveObjectAtom: () => atom({ blockids: ["blk-1"] }),
    reloadWaveObject: (...a: any[]) => reloadWaveObject(...a),
    getObjectValue: (oref: string) => stored[oref],
}));

import { atoms } from "@/app/store/global-atoms";
import { launchAgent } from "./cockpit-actions";

function fakeModel(agents: any[] = []) {
    return {
        agentsAtom: atom(agents),
        pendingLaunchesAtom: atom([]),
        focusIdAtom: atom<string | undefined>(undefined),
        surfaceAtom: atom("cockpit"),
        // launchAgent hands the new agent's terminal the keyboard through it, as AgentsViewModel's own does
        typingFollowsAtom: atom<string | null>(null),
    } as any;
}

afterEach(() => {
    createTab.mockReset().mockResolvedValue("tab-1");
    setMeta.mockClear();
    reloadWaveObject.mockClear();
    fileInfo.mockReset().mockResolvedValue({});
    wake.mockClear();
    controllerInput.mockClear();
    controllerStatus.mockReset().mockResolvedValue(null);
    stored = {};
    globalStore.set(atoms.workspace as any, { oid: "ws1", tabids: [] });
});

describe("launchAgent", () => {
    it("reloads the configured block's WOS object so the sidebar sees the agent meta (not stale shell)", async () => {
        createTab.mockResolvedValue("tab-1");
        await launchAgent(fakeModel(), {
            runtime: "claude",
            startupCommand: "claude",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
        });
        // the block was configured with the agent meta...
        const blockSetMeta = setMeta.mock.calls.find((c) => c[1]?.oref === "block:blk-1");
        expect(blockSetMeta, "SetMeta called on the tab's default block").toBeTruthy();
        expect(blockSetMeta[1].meta.controller).toBe("cmd");
        // ...and its stale FE cache must be refreshed so the roster recognizes it
        expect(reloadWaveObject).toHaveBeenCalledWith("block:blk-1");
    });

    it("opens the agent on the Agent surface with its terminal taking the keyboard", async () => {
        const model = fakeModel();
        await launchAgent(model, {
            runtime: "claude",
            startupCommand: "claude",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
        });
        expect(globalStore.get(model.focusIdAtom)).toBe("tab-1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(model.typingFollowsAtom)).toBe("tab-1");
    });

    it("opens a plain terminal on the Agent surface with the keyboard, as an agent", async () => {
        const model = fakeModel();
        await launchAgent(model, {
            runtime: "terminal",
            startupCommand: "",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
        });
        expect(globalStore.get(model.focusIdAtom)).toBe("tab-1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(model.typingFollowsAtom)).toBe("tab-1");
    });

    it("leaves a terminal asked not to focus (a tool opened into the panel) in the background", async () => {
        const model = fakeModel();
        await launchAgent(model, {
            runtime: "terminal",
            startupCommand: "lazygit",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
            toolId: "lazygit",
            focus: false,
        });
        expect(globalStore.get(model.focusIdAtom)).toBeUndefined();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(globalStore.get(model.typingFollowsAtom)).toBeNull();
    });

    it("records the tool on a terminal's block, with its command line to type at the first prompt", async () => {
        await launchAgent(fakeModel(), {
            runtime: "terminal",
            startupCommand: "lazygit",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
            toolId: "lazygit",
        });
        const blockSetMeta = setMeta.mock.calls.find((c) => c[1]?.oref === "block:blk-1");
        expect(blockSetMeta[1].meta).toMatchObject({
            controller: "shell",
            "cmd:cwd": "C:/proj",
            "cmd:firstcommand": "lazygit",
            "tool:id": "lazygit",
        });
    });

    it("preflights a missing Pi resumePath and refuses to create a tab", async () => {
        const missing = "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\gone.jsonl";
        fileInfo.mockRejectedValue(new Error("no such file"));
        const err = (await launchAgent(fakeModel(), {
            runtime: "pi",
            startupCommand: "pi",
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
            resumePath: missing,
        }).catch((e: unknown) => e)) as Error;
        expect(fileInfo).toHaveBeenCalledWith({}, { info: { path: missing } });
        expect(createTab).not.toHaveBeenCalled();
        expect(err.message).toContain("Pi session no longer exists");
        expect(err.message).toContain(missing);
    });

    it("forwards startupArgs into the block meta (pi resume is one argv element per arg)", async () => {
        await launchAgent(fakeModel(), {
            runtime: "pi",
            startupCommand: "pi",
            startupArgs: ["--session", "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl"],
            task: "",
            projectPath: "C:/proj",
            projectName: "proj",
        });
        const blockSetMeta = setMeta.mock.calls.find((c) => c[1]?.oref === "block:blk-1");
        expect(blockSetMeta[1].meta["cmd:args"]).toEqual([
            "--session",
            "C:\\Users\\Jane Doe\\.pi\\agent\\sessions\\s.jsonl",
        ]);
    });

    describe("a resume of a session a tab already holds", () => {
        const held = "/Users/me/.claude/projects/-p/s1.jsonl";
        const holder = (over: Record<string, unknown> = {}) => ({
            id: "tab-held",
            name: "Lumen",
            state: "idle",
            blockId: "blk-held",
            transcriptPath: held,
            ...over,
        });
        const resume = (model: any, task = "") =>
            launchAgent(model, {
                runtime: "claude",
                startupCommand: "claude --resume s1",
                task,
                projectPath: "/p",
                projectName: "p",
                resumeOf: held.toUpperCase(),
            });

        it("goes to that tab and opens no second one", async () => {
            const model = fakeModel([holder()]);
            expect(await resume(model)).toBe("tab-held");
            expect(createTab).not.toHaveBeenCalled();
            expect(globalStore.get(model.focusIdAtom)).toBe("tab-held");
            expect(globalStore.get(model.surfaceAtom)).toBe("agent");
            expect(wake).not.toHaveBeenCalled();
            expect(controllerInput).not.toHaveBeenCalled();
        });

        it("wakes a sleeping holder with the message given", async () => {
            const model = fakeModel([holder({ sleeping: { since: 1, freedBytes: 0 } })]);
            await resume(model, " next step ");
            expect(createTab).not.toHaveBeenCalled();
            expect(wake.mock.calls[0][1]).toEqual({ tab: "tab-held", message: "next step", fresh: undefined });
            // nothing to type into while it sleeps
            expect(globalStore.get(model.typingFollowsAtom)).toBeNull();
        });

        it("types the message given into an awake holder", async () => {
            const model = fakeModel([holder()]);
            await resume(model, "next step");
            expect(controllerInput.mock.calls[0][1]).toEqual({ blockid: "blk-held", inputdata64: btoa("next step\r") });
            expect(globalStore.get(model.typingFollowsAtom)).toBe("tab-held");
        });

        // an agent the server brought back after a restart runs its session before it reports in, so the roster does
        // not list it yet: the store's meta names the session it resumes
        const storeHolds = (meta: Record<string, unknown>) => {
            globalStore.set(atoms.workspace as any, { oid: "ws1", tabids: ["tab-held"] });
            stored = {
                "tab:tab-held": { oid: "tab-held", name: "arcterm", blockids: ["blk-held"] },
                "block:blk-held": { oid: "blk-held", meta: { controller: "cmd", cmd: "claude", ...meta } },
            };
        };

        it("goes to a tab the store says runs the session, before the roster lists it", async () => {
            storeHolds({ "cmd:args": ["--resume", "s1"] });
            controllerStatus.mockResolvedValue({ shellprocstatus: "running" });
            const model = fakeModel();
            expect(await resume(model)).toBe("tab-held");
            expect(createTab).not.toHaveBeenCalled();
            expect(controllerStatus).toHaveBeenCalledWith("blk-held");
            expect(globalStore.get(model.focusIdAtom)).toBe("tab-held");
        });

        it("goes to a tab the store says holds the session asleep", async () => {
            storeHolds({ "cmd:args": ["--resume", "s1"], "agent:sleeping": 5 });
            const model = fakeModel();
            expect(await resume(model)).toBe("tab-held");
            expect(createTab).not.toHaveBeenCalled();
        });

        it("opens a new tab when the tab that resumed the session has no process left", async () => {
            storeHolds({ "cmd:args": ["--resume", "s1"] });
            controllerStatus.mockResolvedValue({ shellprocstatus: "done" });
            expect(await resume(fakeModel())).toBe("tab-1");
            expect(createTab).toHaveBeenCalled();
        });

        it("still opens a new tab for a session no tab holds", async () => {
            const model = fakeModel([holder({ transcriptPath: "/Users/me/.claude/projects/-p/other.jsonl" })]);
            expect(await resume(model)).toBe("tab-1");
            expect(createTab).toHaveBeenCalled();
        });
    });
});
