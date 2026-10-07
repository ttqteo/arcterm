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

vi.mock("@/app/store/services", () => ({ WorkspaceService: { CreateTab: (...a: any[]) => createTab(...a) } }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        SetMetaCommand: (...a: any[]) => setMeta(...a),
        FileInfoCommand: (...a: any[]) => fileInfo(...a),
        AgentSyncApplyCommand: (...a: any[]) => agentSyncApply(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/view/agents/agents", () => ({ AgentsViewModel: class {} }));
vi.mock("@/app/store/global-atoms", () => ({ atoms: { workspace: atom({ oid: "ws1", tabids: [] }) } }));
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    getWaveObjectAtom: () => atom({ blockids: ["blk-1"] }),
    reloadWaveObject: (...a: any[]) => reloadWaveObject(...a),
}));

import { launchAgent } from "./cockpit-actions";

function fakeModel() {
    return {
        pendingLaunchesAtom: atom([]),
        focusIdAtom: atom<string | undefined>(undefined),
        surfaceAtom: atom("cockpit"),
        typingFollowsAtom: atom<string | null>(null),
    } as any;
}

afterEach(() => {
    createTab.mockReset().mockResolvedValue("tab-1");
    setMeta.mockClear();
    reloadWaveObject.mockClear();
    fileInfo.mockReset().mockResolvedValue({});
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
});
