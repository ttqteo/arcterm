// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LauncherKind } from "./launcher";
import {
    abandonLauncherLaunch,
    addTaskImages,
    applyLauncherPrefill,
    beginLauncherLaunch,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherImagesAtom,
    launcherKindAtom,
    launcherLaunchAbandoned,
    launcherLaunchTicket,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherTaskAtom,
    launcherWorktreeAtom,
    openLauncher,
    pickLauncherProject,
    pickLauncherRuntime,
    removeTaskImage,
    reopenLauncher,
} from "./launcherstore";
import { planPathAtom, resetRunConfig, runShapeAtom, setRunShape, startAtom } from "./runconfigstore";

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
    it("a close mid-start gives the start up and frees the dialog at once", () => {
        globalStore.set(launcherBusyAtom, false);
        expect(beginLauncherLaunch()).toBe(true);
        const ticket = launcherLaunchTicket();
        abandonLauncherLaunch();
        expect(globalStore.get(launcherBusyAtom)).toBe(false);
        expect(launcherLaunchAbandoned(ticket)).toBe(true);
        // a new start is not ended by the given-up one returning
        expect(beginLauncherLaunch()).toBe(true);
        expect(launcherLaunchAbandoned(launcherLaunchTicket())).toBe(false);
    });
    it("a close with no start in flight gives nothing up", () => {
        globalStore.set(launcherBusyAtom, false);
        const ticket = launcherLaunchTicket();
        abandonLauncherLaunch();
        expect(launcherLaunchAbandoned(ticket)).toBe(false);
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
