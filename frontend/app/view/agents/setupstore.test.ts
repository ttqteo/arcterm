// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorReload, editorTyped } from "./setupmodel";
import {
    adoptSkills,
    discardShared,
    loadSetup,
    reloadShared,
    saveShared,
    setupErrorAtom,
    setupSharedAtom,
    setupSharedDiskAtom,
    setupSkillKeepAtom,
    setupSkillsAtom,
    setupStatusAtom,
    setupSyncAtom,
    syncNow,
} from "./setupstore";
import { KEEP_LEAVE, KEEP_VAULT } from "./skillsmatrix";

const toast = vi.fn();
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: any[]) => toast(...a) }));
vi.mock("@/app/cockpit/openfilestore", () => ({ openFileInCode: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        AgentSyncStatusCommand: vi.fn(),
        AgentSyncSteeringReadCommand: vi.fn(),
        AgentSyncSkillsCommand: vi.fn(),
        AgentSyncApplyCommand: vi.fn(),
        AgentSyncSteeringWriteCommand: vi.fn(),
        AgentSyncAdoptCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const harness = (steering: string): AgentSyncHarness => ({
    runtime: "claude",
    label: "Claude Code",
    present: true,
    path: "/h/CLAUDE.md",
    steering,
    skillsmanaged: 0,
    skillsunmanaged: 0,
});
const STATUS: CommandAgentSyncStatusRtnData = {
    harnesses: [harness("stale")],
    steeringdoc: "/v/AGENTS.md",
    skillsroot: "/v/skills",
};
const DOC: CommandAgentSyncSteeringReadRtnData = { path: "/v/AGENTS.md", content: "# doc\n", mtime: 1000 };

beforeEach(() => {
    toast.mockClear();
    vi.mocked(RpcApi.AgentSyncStatusCommand).mockReset().mockResolvedValue(STATUS);
    vi.mocked(RpcApi.AgentSyncSteeringReadCommand).mockReset().mockResolvedValue(DOC);
    vi.mocked(RpcApi.AgentSyncSkillsCommand).mockReset();
    vi.mocked(RpcApi.AgentSyncApplyCommand).mockReset().mockResolvedValue({ actions: [] });
    vi.mocked(RpcApi.AgentSyncSteeringWriteCommand).mockReset();
    vi.mocked(RpcApi.AgentSyncAdoptCommand).mockReset().mockResolvedValue({});
    globalStore.set(setupStatusAtom, null);
    globalStore.set(setupErrorAtom, null);
    globalStore.set(setupSyncAtom, null);
    globalStore.set(setupSharedDiskAtom, null);
    globalStore.set(setupSkillKeepAtom, {});
    globalStore.set(setupSkillsAtom, null);
});

describe("syncNow", () => {
    const two = [
        { kind: "steering-write", runtime: "claude", path: "/h/CLAUDE.md" },
        { kind: "steering-write", runtime: "codex", path: "/h/AGENTS.md" },
    ];

    it("runs a dry run first, applies for real, then reads the status again", async () => {
        vi.mocked(RpcApi.AgentSyncApplyCommand)
            .mockResolvedValueOnce({ actions: two })
            .mockResolvedValueOnce({ actions: two });
        const synced = { ...STATUS, harnesses: [harness("current")] };
        vi.mocked(RpcApi.AgentSyncStatusCommand).mockResolvedValue(synced);
        await syncNow();
        const calls = vi.mocked(RpcApi.AgentSyncApplyCommand).mock.calls;
        expect(calls.map((c) => c[1])).toEqual([{ dryrun: true }, { dryrun: false }]);
        const order = vi.mocked(RpcApi.AgentSyncApplyCommand).mock.invocationCallOrder;
        expect(vi.mocked(RpcApi.AgentSyncStatusCommand).mock.invocationCallOrder[0]).toBeGreaterThan(order[1]);
        expect(globalStore.get(setupStatusAtom)).toEqual(synced);
        expect(globalStore.get(setupErrorAtom)).toBeNull();
    });

    it("keeps the dry run's counts in the result it leaves behind", async () => {
        vi.mocked(RpcApi.AgentSyncApplyCommand)
            .mockResolvedValueOnce({ actions: two })
            .mockResolvedValueOnce({ actions: two });
        await syncNow();
        expect(globalStore.get(setupSyncAtom)).toEqual({
            phase: "done",
            plan: { harnessFiles: 2, skillCopies: 0, skillsRemoved: 0, leftAlone: 0 },
        });
    });

    it("shows the counts as the plan while the write is still going", async () => {
        let release!: () => void;
        vi.mocked(RpcApi.AgentSyncApplyCommand)
            .mockResolvedValueOnce({ actions: two })
            .mockReturnValueOnce(new Promise((r) => (release = () => r({ actions: two }))));
        const running = syncNow();
        await vi.waitFor(() => expect(globalStore.get(setupSyncAtom)?.phase).toBe("writing"));
        expect(globalStore.get(setupSyncAtom)?.plan.harnessFiles).toBe(2);
        release();
        await running;
        expect(globalStore.get(setupSyncAtom)?.phase).toBe("done");
    });

    it("shows a failed dry run in the Setup banner and writes nothing", async () => {
        vi.mocked(RpcApi.AgentSyncApplyCommand).mockRejectedValue(new Error("plan failed"));
        await syncNow();
        expect(globalStore.get(setupErrorAtom)).toBe("plan failed");
        expect(RpcApi.AgentSyncApplyCommand).toHaveBeenCalledTimes(1);
        expect(RpcApi.AgentSyncStatusCommand).not.toHaveBeenCalled();
        expect(globalStore.get(setupSyncAtom)).toBeNull();
    });

    it("shows a failed write in the banner, drops the result and still reads the status again", async () => {
        vi.mocked(RpcApi.AgentSyncApplyCommand)
            .mockResolvedValueOnce({ actions: two })
            .mockRejectedValueOnce(new Error("disk full"));
        await syncNow();
        expect(globalStore.get(setupErrorAtom)).toBe("disk full");
        expect(globalStore.get(setupSyncAtom)).toBeNull();
        // a partial write may have landed, so the rows are read again either way
        expect(RpcApi.AgentSyncStatusCommand).toHaveBeenCalled();
    });

    it("is cleared by the next read of Setup", async () => {
        globalStore.set(setupSyncAtom, {
            phase: "done",
            plan: { harnessFiles: 1, skillCopies: 0, skillsRemoved: 0, leftAlone: 0 },
        });
        await loadSetup();
        expect(globalStore.get(setupSyncAtom)).toBeNull();
    });
});

describe("saveShared conflict", () => {
    const MINE = "# doc\nmine\n";
    const THEIRS = "# doc\ntheirs\n";

    beforeEach(() => {
        globalStore.set(setupSharedAtom, editorTyped(editorReload(DOC.content, 1000), MINE));
        vi.mocked(RpcApi.AgentSyncSteeringWriteCommand).mockResolvedValue({ mtime: 2000, conflict: true });
    });

    it("reads the doc as it is on disk beside the draft", async () => {
        vi.mocked(RpcApi.AgentSyncSteeringReadCommand).mockResolvedValue({ ...DOC, content: THEIRS });
        await saveShared(false);
        expect(globalStore.get(setupSharedAtom)).toMatchObject({ conflict: true, draft: MINE, base: DOC.content });
        expect(globalStore.get(setupSharedDiskAtom)).toEqual({ text: THEIRS });
        expect(RpcApi.AgentSyncApplyCommand).not.toHaveBeenCalled();
    });

    it("keeps the conflict with no disk text when that read fails", async () => {
        vi.mocked(RpcApi.AgentSyncSteeringReadCommand).mockRejectedValue(new Error("unreadable"));
        await saveShared(false);
        expect(globalStore.get(setupSharedAtom)).toMatchObject({ conflict: true, draft: MINE });
        expect(globalStore.get(setupSharedDiskAtom)).toEqual({ text: null });
        // the failed read is no banner: Reload and Overwrite stay the way out
        expect(globalStore.get(setupErrorAtom)).toBeNull();
    });

    it("forgets the disk text once Reload, Discard or a clean save settles the conflict", async () => {
        globalStore.set(setupSharedDiskAtom, { text: THEIRS });
        discardShared();
        expect(globalStore.get(setupSharedDiskAtom)).toBeNull();

        globalStore.set(setupSharedDiskAtom, { text: THEIRS });
        await reloadShared();
        expect(globalStore.get(setupSharedDiskAtom)).toBeNull();

        globalStore.set(setupSharedDiskAtom, { text: THEIRS });
        vi.mocked(RpcApi.AgentSyncSteeringWriteCommand).mockResolvedValue({ mtime: 3000, conflict: false });
        await saveShared(true);
        expect(globalStore.get(setupSharedDiskAtom)).toBeNull();
    });
});

describe("adoptSkills", () => {
    const move = (runtime: string, name: string, over: Partial<AgentSyncSkillMove> = {}): AgentSyncSkillMove => ({
        runtime,
        name,
        from: `/h/${runtime}/skills/${name}`,
        seed: false,
        bodydiff: false,
        ...over,
    });
    const columns: AgentSyncSkillColumn[] = [
        { runtime: "claude", label: "Claude Code", present: true, path: "/h/claude/skills" },
        { runtime: "codex", label: "Codex", present: true, path: "/h/codex/skills" },
    ];
    function skills(over: Partial<CommandAgentSyncSkillsRtnData> = {}): CommandAgentSyncSkillsRtnData {
        return {
            skills: [{ name: "helper", states: { claude: "synced", codex: "unmanaged" } }],
            columns,
            skillsroot: "/v/skills",
            unmanaged: [
                move("claude", "solo", { seed: true }),
                move("claude", "keepme", { seed: true }),
                move("codex", "helper", { vault: true }),
            ],
            unresolved: [],
            ...over,
        };
    }

    beforeEach(() => {
        vi.mocked(RpcApi.AgentSyncSkillsCommand).mockReset().mockResolvedValue(skills());
        globalStore.set(setupSkillsAtom, skills());
    });

    it("sends the request it always did when no skill is left alone", async () => {
        await adoptSkills();
        expect(RpcApi.AgentSyncAdoptCommand).toHaveBeenCalledWith({}, { apply: true, keep: {} });
    });

    it("sends the vault keep and the left-alone names, and toasts what the reply says happened", async () => {
        globalStore.set(setupSkillKeepAtom, { helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        vi.mocked(RpcApi.AgentSyncAdoptCommand).mockResolvedValue({
            moves: [move("claude", "solo", { seed: true }), move("codex", "helper", { vault: true })],
        });
        await adoptSkills();
        expect(RpcApi.AgentSyncAdoptCommand).toHaveBeenCalledWith(
            {},
            { apply: true, keep: { helper: "vault" }, skip: ["keepme"] }
        );
        expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "info", title: "Moved 2 skills into the vault · 1 left alone" })
        );
    });

    it("drops every choice but leave-alone after a move, so a left skill stays left", async () => {
        globalStore.set(setupSkillKeepAtom, { helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        await adoptSkills();
        expect(globalStore.get(setupSkillKeepAtom)).toEqual({ keepme: KEEP_LEAVE });
    });

    it("keeps every choice after a snapshot, which moved nothing", async () => {
        globalStore.set(setupSkillKeepAtom, { helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        vi.mocked(RpcApi.AgentSyncAdoptCommand).mockResolvedValue({ dryrun: true, moves: [move("claude", "solo")] });
        await adoptSkills();
        expect(globalStore.get(setupSkillKeepAtom)).toEqual({ helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        expect(toast).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Snapshot: nothing moved (would move 1)" })
        );
    });

    it("shows a failed adopt in the banner, toasts nothing, and still reads the skills again", async () => {
        vi.mocked(RpcApi.AgentSyncAdoptCommand).mockRejectedValue(new Error("adopt failed"));
        await adoptSkills();
        expect(globalStore.get(setupErrorAtom)).toBe("adopt failed");
        expect(toast).not.toHaveBeenCalled();
        expect(RpcApi.AgentSyncSkillsCommand).toHaveBeenCalled();
    });

    // the reason rides in the reply, beside the plan it was applying: an rpc error reply carries no data
    it("treats a reply carrying an error as a failed adopt: banner, no toast, choices kept", async () => {
        globalStore.set(setupSkillKeepAtom, { helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        vi.mocked(RpcApi.AgentSyncAdoptCommand).mockResolvedValue({
            moves: [move("claude", "helper")],
            error: "adopting harness skills: disk full",
        });
        await adoptSkills();
        expect(globalStore.get(setupErrorAtom)).toBe("adopting harness skills: disk full");
        expect(toast).not.toHaveBeenCalled();
        expect(globalStore.get(setupSkillKeepAtom)).toEqual({ helper: KEEP_VAULT, keepme: KEEP_LEAVE });
        expect(RpcApi.AgentSyncSkillsCommand).toHaveBeenCalled();
    });
});
