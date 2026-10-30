// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LauncherKind } from "./launcher";
import {
    addTaskImages,
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    findLauncherSessions,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherFoundAtom,
    launcherGoalAtom,
    launcherImagesAtom,
    launcherKindAtom,
    launcherOnStartedAtom,
    launcherOwnProjectAtom,
    launcherPageAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherSessionsAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    loadLauncherSessions,
    loadMoreLauncherSessions,
    openLauncher,
    pickLauncherProject,
    pickLauncherRuntime,
    removeTaskImage,
    reopenLauncher,
    RESUME_PICK_KEEP_MS,
    takeLauncherOnStarted,
} from "./launcherstore";
import { planPathAtom, resetRunConfig, runShapeAtom, setRunShape, startAtom } from "./runconfigstore";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetRecentSessionsCommand: vi.fn() } }));
const recent = vi.mocked(RpcApi.GetRecentSessionsCommand);

const mocks = vi.hoisted(() => ({ blob: vi.fn(), file: vi.fn() }));
vi.mock("@/app/view/term/termutil", () => ({
    createTempFileFromBlob: mocks.blob,
    createTempFileFromFile: mocks.file,
}));

// the cast: without strictNullChecks, null picks atom's read-only overload
const model = () => ({ launcherAtom: atom<LauncherKind | null>(null) as PrimitiveAtom<LauncherKind | null> });

// The preview URLs are the browser's; the store only hands them out and takes them back.
const realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
let revoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    mocks.blob.mockReset();
    mocks.file.mockReset();
    globalStore.set(launcherKindAtom, "agent");
    globalStore.set(launcherRuntimeAtom, null);
    globalStore.set(launcherProjectAtom, "");
    globalStore.set(launcherPrefillAtom, null);
    globalStore.set(launcherOnStartedAtom, null);
    globalStore.set(launcherOwnProjectAtom, null);
    globalStore.set(launcherBusyAtom, false);
    endLauncherDraft();
    resetRunConfig();
});

afterEach(() => {
    URL.createObjectURL = realUrl.create;
    URL.revokeObjectURL = realUrl.revoke;
});

describe("reopenLauncher", () => {
    it("opens on the half the last open left picked", () => {
        const m = model();
        globalStore.set(launcherKindAtom, "run");
        reopenLauncher(m);
        expect(globalStore.get(m.launcherAtom)).toBe("run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
    });
    it("says draft restored like any other open", () => {
        globalStore.set(launcherTaskAtom, "fix it");
        reopenLauncher(model());
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
});

describe("openLauncher", () => {
    it("opens at the agent door on the agent half", () => {
        const m = model();
        globalStore.set(launcherKindAtom, "run");
        openLauncher(m, "agent");
        expect(globalStore.get(m.launcherAtom)).toBe("agent");
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
    });
    it("opens at the run door on the run half and keeps the agent row for the next agent", () => {
        const m = model();
        globalStore.set(launcherRuntimeAtom, "terminal");
        openLauncher(m, "run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
    });
    it("the agent door keeps an agent row already picked", () => {
        globalStore.set(launcherRuntimeAtom, "terminal");
        globalStore.set(launcherKindAtom, "agent");
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherKindAtom)).toBe("agent");
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
    });
    it("the run door keeps a run shape already picked", () => {
        setRunShape("orchestrator");
        globalStore.set(launcherKindAtom, "run");
        openLauncher(model(), "run");
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
    });
    it("a prefill opens on the run half and waits there for the dialog", () => {
        const m = model();
        const prefill = { projectName: "arcterm", goal: "fix it", shape: "orchestrator" as const };
        openLauncher(m, "run", prefill);
        expect(globalStore.get(launcherKindAtom)).toBe("run");
        expect(globalStore.get(launcherPrefillAtom)).toEqual(prefill);
    });
    it("says draft restored when a close kept a task, a goal, a plan path or a prototype, at either door", () => {
        globalStore.set(launcherTaskAtom, "fix it");
        openLauncher(model(), "run");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
        endLauncherDraft();
        globalStore.set(planPathAtom, "/p/plan.md");
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
    it("does not when nothing was kept", () => {
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(false);
    });
    it("does not for a prefill, which replaces the goal", () => {
        globalStore.set(launcherGoalAtom, "old goal");
        openLauncher(model(), "run", { projectName: "", goal: "new", shape: "quick" });
        expect(globalStore.get(launcherRestoredAtom)).toBe(false);
    });
    it("a project given is picked and recorded as this open's own, at either door", () => {
        globalStore.set(launcherProjectAtom, "other");
        openLauncher(model(), "agent", undefined, "arc");
        expect(globalStore.get(launcherProjectAtom)).toBe("arc");
        expect(globalStore.get(launcherOwnProjectAtom)).toBe("arc");
        openLauncher(model(), "run", undefined, "alpha");
        expect(globalStore.get(launcherProjectAtom)).toBe("alpha");
        expect(globalStore.get(launcherOwnProjectAtom)).toBe("alpha");
    });
    it("a project given picks it over a kept draft's, and leaves the draft", () => {
        globalStore.set(launcherProjectAtom, "other");
        globalStore.set(launcherTaskAtom, "fix it");
        openLauncher(model(), "agent", undefined, "arc");
        expect(globalStore.get(launcherProjectAtom)).toBe("arc");
        expect(globalStore.get(launcherTaskAtom)).toBe("fix it");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
    it("a project given that differs re-defaults the worktree branch, as picking one does", () => {
        globalStore.set(launcherProjectAtom, "other");
        globalStore.set(launcherBranchAtom, "feat/x");
        openLauncher(model(), "agent", undefined, "arc");
        expect(globalStore.get(launcherBranchAtom)).toBeNull();
    });
    it("every other open, a reopen included, records none and keeps the last pick", () => {
        openLauncher(model(), "agent", undefined, "arc");
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherOwnProjectAtom)).toBeNull();
        expect(globalStore.get(launcherProjectAtom)).toBe("arc");
        openLauncher(model(), "run", undefined, "arc");
        reopenLauncher(model());
        expect(globalStore.get(launcherOwnProjectAtom)).toBeNull();
        openLauncher(model(), "run", { projectName: "alpha", goal: "", shape: "quick" });
        expect(globalStore.get(launcherOwnProjectAtom)).toBeNull();
    });
});

describe("closing, clearing and launching", () => {
    it("a close keeps the draft", () => {
        const m = model();
        openLauncher(m, "agent");
        globalStore.set(launcherTaskAtom, "fix it");
        globalStore.set(launcherWorktreeAtom, true);
        closeLauncher(m);
        expect(globalStore.get(m.launcherAtom)).toBeNull();
        expect(globalStore.get(launcherTaskAtom)).toBe("fix it");
        expect(globalStore.get(launcherWorktreeAtom)).toBe(true);
    });
    it("a close shuts the flag menu and the branch list, so the next open shows neither", () => {
        const m = model();
        openLauncher(m, "agent");
        globalStore.set(launcherFlagMenuAtom, true);
        globalStore.set(launcherBranchListAtom, true);
        closeLauncher(m);
        expect(globalStore.get(launcherFlagMenuAtom)).toBe(false);
        expect(globalStore.get(launcherBranchListAtom)).toBe(false);
    });
    it("Clear empties what a close kept and leaves the pick, the project and the commands", () => {
        globalStore.set(launcherRuntimeAtom, "terminal");
        globalStore.set(launcherProjectAtom, "thesis");
        globalStore.set(launcherTaskAtom, "a");
        globalStore.set(launcherGoalAtom, "b");
        globalStore.set(planPathAtom, "/p/plan.md");
        globalStore.set(launcherPrototypeAtom, "/c/Main.dc.html");
        globalStore.set(launcherWorktreeAtom, true);
        globalStore.set(launcherBranchAtom, "feat/x");
        globalStore.set(launcherRestoredAtom, true);
        globalStore.set(launcherCommandAtom, { claude: "claude --verbose" });
        clearLauncherDraft();
        expect([
            globalStore.get(launcherTaskAtom),
            globalStore.get(launcherGoalAtom),
            globalStore.get(planPathAtom),
            globalStore.get(launcherPrototypeAtom),
            globalStore.get(launcherWorktreeAtom),
            globalStore.get(launcherBranchAtom),
            globalStore.get(launcherRestoredAtom),
        ]).toEqual(["", "", "", "", false, null, false]);
        expect(globalStore.get(launcherRuntimeAtom)).toBe("terminal");
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
        expect(globalStore.get(launcherCommandAtom)).toEqual({ claude: "claude --verbose" });
    });
    it("clearLauncherDraft clears the resume pick", () => {
        globalStore.set(launcherResumeAtom, "sess-1");
        clearLauncherDraft();
        expect(globalStore.get(launcherResumeAtom)).toBeNull();
    });
    it("a reopen within two minutes keeps the resume pick; a later one starts on New session but keeps the text", () => {
        vi.useFakeTimers();
        try {
            const m = model();
            globalStore.set(launcherResumeAtom, "sess-1");
            globalStore.set(launcherTaskAtom, "fix it");
            closeLauncher(m);
            vi.advanceTimersByTime(RESUME_PICK_KEEP_MS);
            openLauncher(m, "agent");
            expect(globalStore.get(launcherResumeAtom)).toBe("sess-1");
            closeLauncher(m);
            vi.advanceTimersByTime(RESUME_PICK_KEEP_MS + 1);
            openLauncher(m, "agent");
            expect(globalStore.get(launcherResumeAtom)).toBeNull();
            expect(globalStore.get(launcherTaskAtom)).toBe("fix it");
        } finally {
            vi.useRealTimers();
        }
    });
    it("clearLauncherDraft empties the images and frees their previews", () => {
        globalStore.set(launcherImagesAtom, [
            { id: "a", previewUrl: "blob:a", path: "/tmp/a.png" },
            { id: "b", previewUrl: "blob:b" },
        ]);
        clearLauncherDraft();
        expect(globalStore.get(launcherImagesAtom)).toEqual([]);
        expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a", "blob:b"]);
    });
    it("a draft of only images is restored on the next open", () => {
        globalStore.set(launcherImagesAtom, [{ id: "a", previewUrl: "blob:a", path: "/tmp/a.png" }]);
        openLauncher(model(), "agent");
        expect(globalStore.get(launcherRestoredAtom)).toBe(true);
    });
    it("a launch also drops hand-edited commands", () => {
        globalStore.set(launcherCommandAtom, { claude: "claude --verbose" });
        globalStore.set(launcherTaskAtom, "a");
        endLauncherDraft();
        expect(globalStore.get(launcherCommandAtom)).toEqual({});
        expect(globalStore.get(launcherTaskAtom)).toBe("");
    });
    it("one launch at a time: a second begin fails until the first ends", () => {
        expect(beginLauncherLaunch()).toBe(true);
        expect(beginLauncherLaunch()).toBe(false);
        endLauncherLaunch();
        expect(beginLauncherLaunch()).toBe(true);
    });
});

describe("pickLauncherProject", () => {
    it("a different project re-defaults the worktree branch", () => {
        globalStore.set(launcherBranchAtom, "feat/x");
        pickLauncherProject("thesis", "arcterm");
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
        expect(globalStore.get(launcherBranchAtom)).toBeNull();
    });
    it("the same project keeps the typed branch", () => {
        globalStore.set(launcherBranchAtom, "feat/x");
        pickLauncherProject("arcterm", "arcterm");
        expect(globalStore.get(launcherBranchAtom)).toBe("feat/x");
    });
    it("pickLauncherProject resets the resume pick", () => {
        globalStore.set(launcherResumeAtom, "sess-1");
        pickLauncherProject("b", "a");
        expect(globalStore.get(launcherResumeAtom)).toBeNull();
        // the project already on show keeps the pick
        globalStore.set(launcherResumeAtom, "sess-1");
        pickLauncherProject("b", "b");
        expect(globalStore.get(launcherResumeAtom)).toBe("sess-1");
    });
});

describe("pickLauncherRuntime", () => {
    it("pickLauncherRuntime resets the resume pick", () => {
        globalStore.set(launcherRuntimeAtom, "claude");
        globalStore.set(launcherResumeAtom, "sess-1");
        pickLauncherRuntime("codex");
        expect(globalStore.get(launcherRuntimeAtom)).toBe("codex");
        expect(globalStore.get(launcherResumeAtom)).toBeNull();
        // picking the runtime already on show keeps the pick
        globalStore.set(launcherResumeAtom, "sess-2");
        pickLauncherRuntime("codex");
        expect(globalStore.get(launcherResumeAtom)).toBe("sess-2");
    });
});

describe("applyLauncherPrefill", () => {
    const prefill = { projectName: "arcterm", goal: "build it", shape: "quick" as const, prototype: "/c/Main.dc.html" };
    it("waits while the project list is empty", () => {
        globalStore.set(launcherPrefillAtom, prefill);
        expect(applyLauncherPrefill([])).toBe(false);
        expect(globalStore.get(launcherPrefillAtom)).toEqual(prefill);
    });
    it("fills the project, the goal, the prototype and an orchestrator shape once projects are in", () => {
        globalStore.set(launcherPrefillAtom, prefill);
        expect(applyLauncherPrefill(["arcterm", "thesis"])).toBe(true);
        expect(globalStore.get(launcherPrefillAtom)).toBeNull();
        expect(globalStore.get(launcherProjectAtom)).toBe("arcterm");
        expect(globalStore.get(launcherGoalAtom)).toBe("build it");
        expect(globalStore.get(launcherPrototypeAtom)).toBe("/c/Main.dc.html");
        // a prototype only rides an orchestrator run (prefillToLaunch)
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(startAtom)).toBe("goal");
    });
    it("leaves the project alone when the prefill's is not registered", () => {
        globalStore.set(launcherProjectAtom, "thesis");
        globalStore.set(launcherPrefillAtom, { ...prefill, projectName: "gone" });
        applyLauncherPrefill(["arcterm", "thesis"]);
        expect(globalStore.get(launcherProjectAtom)).toBe("thesis");
    });
    it("does nothing without a prefill", () => {
        expect(applyLauncherPrefill(["arcterm"])).toBe(false);
    });

    describe("the handback of the run it starts (onStarted)", () => {
        it("keeps the prefill's onStarted after the prefill itself is consumed, until it is taken", () => {
            const onStarted = vi.fn();
            globalStore.set(launcherPrefillAtom, { ...prefill, onStarted });
            expect(applyLauncherPrefill(["arcterm"])).toBe(true);
            expect(globalStore.get(launcherPrefillAtom)).toBeNull();
            expect(globalStore.get(launcherOnStartedAtom)).toBe(onStarted);
            expect(takeLauncherOnStarted()).toBe(onStarted);
            // taken once: the run it was for has started
            expect(takeLauncherOnStarted()).toBeNull();
            expect(globalStore.get(launcherOnStartedAtom)).toBeNull();
        });
        it("keeps nothing for a prefill with none, replacing an earlier prefill's", () => {
            globalStore.set(launcherPrefillAtom, { ...prefill, onStarted: vi.fn() });
            applyLauncherPrefill(["arcterm"]);
            globalStore.set(launcherPrefillAtom, prefill);
            applyLauncherPrefill(["arcterm"]);
            expect(takeLauncherOnStarted()).toBeNull();
        });
        it("is kept while the project list is still empty, so a late list does not lose it", () => {
            const onStarted = vi.fn();
            globalStore.set(launcherPrefillAtom, { ...prefill, onStarted });
            expect(applyLauncherPrefill([])).toBe(false);
            expect(applyLauncherPrefill(["arcterm"])).toBe(true);
            expect(takeLauncherOnStarted()).toBe(onStarted);
        });
        it("goes when the launcher closes: the next New is no handback's run", () => {
            const onStarted = vi.fn();
            globalStore.set(launcherPrefillAtom, { ...prefill, onStarted });
            applyLauncherPrefill(["arcterm"]);
            closeLauncher(model());
            expect(globalStore.get(launcherOnStartedAtom)).toBeNull();
        });
        it("goes when another open starts without it", () => {
            globalStore.set(launcherPrefillAtom, { ...prefill, onStarted: vi.fn() });
            applyLauncherPrefill(["arcterm"]);
            openLauncher(model(), "run");
            expect(globalStore.get(launcherOnStartedAtom)).toBeNull();
        });
    });
});

describe("task images", () => {
    const png = (name = "a.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("a paste shows a tile at once and gives it the temp path when the write lands", async () => {
        mocks.blob.mockResolvedValue("/tmp/paste.png");
        addTaskImages([png()], "paste");
        expect(globalStore.get(launcherImagesAtom)).toEqual([{ id: expect.any(String), previewUrl: "blob:preview-1" }]);
        await flush();
        expect(globalStore.get(launcherImagesAtom)[0].path).toBe("/tmp/paste.png");
        expect(mocks.blob).toHaveBeenCalledTimes(1);
        expect(mocks.file).not.toHaveBeenCalled();
    });
    it("a drop keeps the file's name, so it goes through the file writer", async () => {
        mocks.file.mockResolvedValue("/tmp/dir/shot.png");
        addTaskImages([png("shot.png")], "drop");
        await flush();
        expect(globalStore.get(launcherImagesAtom)[0].path).toBe("/tmp/dir/shot.png");
        expect(mocks.file).toHaveBeenCalledTimes(1);
        expect(mocks.blob).not.toHaveBeenCalled();
    });
    it("a write that fails keeps its tile with the error", async () => {
        mocks.blob.mockRejectedValue(new Error("Image too large (>3.5 MB)"));
        addTaskImages([png()], "paste");
        await flush();
        const [img] = globalStore.get(launcherImagesAtom);
        expect(img.path).toBeUndefined();
        expect(img.error).toBe("Image too large (>3.5 MB)");
    });
    it("takes no more than eight images in all", () => {
        mocks.blob.mockResolvedValue("/tmp/x.png");
        addTaskImages(
            Array.from({ length: 6 }, () => png()),
            "paste"
        );
        addTaskImages(
            Array.from({ length: 6 }, () => png()),
            "paste"
        );
        expect(globalStore.get(launcherImagesAtom)).toHaveLength(8);
        expect(mocks.blob).toHaveBeenCalledTimes(8);
    });
    it("removeTaskImage drops only its id and frees its preview", () => {
        globalStore.set(launcherImagesAtom, [
            { id: "a", previewUrl: "blob:a", path: "/tmp/a.png" },
            { id: "b", previewUrl: "blob:b", path: "/tmp/b.png" },
        ]);
        removeTaskImage("a");
        expect(globalStore.get(launcherImagesAtom).map((i) => i.id)).toEqual(["b"]);
        expect(revoke).toHaveBeenCalledWith("blob:a");
        expect(revoke).not.toHaveBeenCalledWith("blob:b");
    });
    it("an image written after its tile was removed does not bring it back", async () => {
        let land: (p: string) => void = () => {};
        mocks.blob.mockReturnValue(new Promise<string>((r) => (land = r)));
        addTaskImages([png()], "paste");
        const [{ id }] = globalStore.get(launcherImagesAtom);
        removeTaskImage(id);
        land("/tmp/late.png");
        await flush();
        expect(globalStore.get(launcherImagesAtom)).toEqual([]);
    });
});

describe("the Resume list's pages", () => {
    const sess = (id: string): SessionInfo => ({
        id,
        runtime: "claude",
        projectpath: "/p/a",
        projectname: "a",
        branch: "",
        task: id,
        model: "",
        tokenstotal: 0,
        lastactivets: 1,
        resumecommand: "",
        transcriptpath: "",
    });
    const lastArgs = () => recent.mock.calls.at(-1)?.[1];
    const ids = () => (globalStore.get(launcherSessionsAtom) ?? []).map((x) => x.id);
    const deferred = () => {
        let resolve!: (v: CommandGetRecentSessionsRtnData) => void;
        const promise = new Promise<CommandGetRecentSessionsRtnData>((r) => (resolve = r));
        return { promise, resolve };
    };

    beforeEach(async () => {
        recent.mockReset();
        recent.mockResolvedValue({ sessions: [] });
        await loadLauncherSessions("terminal", "");
        globalStore.set(launcherSessionsAtom, null);
        recent.mockClear();
    });

    it("loads the first page for the runtime and project", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")], nextcursor: "c1" });
        await loadLauncherSessions("claude", "/p/a");
        expect(lastArgs()).toEqual({ runtime: "claude", projectpath: "/p/a", limit: 30 });
        expect(ids()).toEqual(["a"]);
        expect(globalStore.get(launcherPageAtom)).toMatchObject({ cursor: "c1", loading: false });
    });

    it("sends the answer's cursor for the next page and appends it", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")], nextcursor: "c1" });
        await loadLauncherSessions("claude", "/p/a");
        recent.mockResolvedValueOnce({ sessions: [sess("a"), sess("b")], nextcursor: "c2" });
        await loadMoreLauncherSessions();
        expect(lastArgs()).toEqual({
            runtime: "claude",
            projectpath: "/p/a",
            limit: 30,
            cursor: "c1",
        });
        expect(ids()).toEqual(["a", "b"]);
        expect(globalStore.get(launcherPageAtom).cursor).toBe("c2");
    });

    it("sends one request at a time", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")], nextcursor: "c1" });
        await loadLauncherSessions("claude", "/p/a");
        const d = deferred();
        recent.mockReturnValueOnce(d.promise);
        const first = loadMoreLauncherSessions();
        await loadMoreLauncherSessions();
        expect(recent).toHaveBeenCalledTimes(2);
        d.resolve({ sessions: [sess("b")] });
        await first;
        expect(ids()).toEqual(["a", "b"]);
    });

    it("sends nothing once an answer has no cursor", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")] });
        await loadLauncherSessions("claude", "/p/a");
        await loadMoreLauncherSessions();
        expect(recent).toHaveBeenCalledTimes(1);
        expect(globalStore.get(launcherPageAtom).cursor).toBe("");
    });

    it("ends the loading on an empty page and on a failed one", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")], nextcursor: "c1" });
        await loadLauncherSessions("claude", "/p/a");
        recent.mockRejectedValueOnce(new Error("boom"));
        await loadMoreLauncherSessions();
        expect(globalStore.get(launcherPageAtom)).toMatchObject({ cursor: "", loading: false });
        await loadMoreLauncherSessions();
        expect(recent).toHaveBeenCalledTimes(2);
    });

    it("drops the first page of a project the list has moved off", async () => {
        const a = deferred();
        recent.mockReturnValueOnce(a.promise);
        const loadA = loadLauncherSessions("claude", "/p/a");
        recent.mockResolvedValueOnce({ sessions: [sess("b1")], nextcursor: "cb" });
        await loadLauncherSessions("claude", "/p/b");
        a.resolve({ sessions: [sess("a1")], nextcursor: "ca" });
        await loadA;
        expect(ids()).toEqual(["b1"]);
        expect(globalStore.get(launcherPageAtom)).toMatchObject({ cursor: "cb", loading: false });
    });

    it("drops a later page of a project the list has moved off", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a1")], nextcursor: "ca" });
        await loadLauncherSessions("claude", "/p/a");
        const a2 = deferred();
        recent.mockReturnValueOnce(a2.promise);
        const more = loadMoreLauncherSessions();
        recent.mockResolvedValueOnce({ sessions: [sess("b1")] });
        await loadLauncherSessions("claude", "/p/b");
        a2.resolve({ sessions: [sess("a2")], nextcursor: "ca2" });
        await more;
        expect(ids()).toEqual(["b1"]);
        expect(globalStore.get(launcherPageAtom).cursor).toBe("");
    });

    it("asks nothing for a terminal or no project", async () => {
        await loadLauncherSessions("terminal", "/p/a");
        await loadLauncherSessions("claude", "");
        expect(recent).not.toHaveBeenCalled();
    });

    it("searches the backend and keeps the answer for its scope", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")], nextcursor: "c1" });
        await loadLauncherSessions("claude", "/p/a");
        recent.mockResolvedValueOnce({ sessions: [sess("old")] });
        await findLauncherSessions("old");
        expect(lastArgs()).toEqual({
            runtime: "claude",
            projectpath: "/p/a",
            limit: 30,
            query: "old",
        });
        expect(globalStore.get(launcherFoundAtom)).toMatchObject({ query: "old", sessions: [{ id: "old" }] });
        recent.mockResolvedValueOnce({ sessions: [] });
        await loadLauncherSessions("claude", "/p/b");
        expect(globalStore.get(launcherFoundAtom)).toBeNull();
    });

    it("drops an answer for a query that has been typed past", async () => {
        recent.mockResolvedValueOnce({ sessions: [sess("a")] });
        await loadLauncherSessions("claude", "/p/a");
        const ol = deferred();
        recent.mockReturnValueOnce(ol.promise);
        const first = findLauncherSessions("ol");
        recent.mockResolvedValueOnce({ sessions: [sess("old")] });
        await findLauncherSessions("old");
        ol.resolve({ sessions: [sess("olive")] });
        await first;
        expect(globalStore.get(launcherFoundAtom)).toMatchObject({ query: "old" });
    });
});
