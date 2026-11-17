// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftAttachments, setDraftAttachments } from "./composerattachments";
import type { LauncherKind } from "./launcher";
import {
    applyLauncherPrefill,
    beginLauncherLaunch,
    checkRunStart,
    clearLauncherDraft,
    closeLauncher,
    endLauncherDraft,
    endLauncherLaunch,
    LAUNCHER_DRAFT,
    launcherBrainstormAtom,
    launcherBranchAtom,
    launcherBranchListAtom,
    launcherBusyAtom,
    launcherCommandAtom,
    launcherFlagMenuAtom,
    launcherGoalAtom,
    launcherKindAtom,
    launcherHandbackAtom,
    launcherOwnProjectAtom,
    launcherPageAtom,
    launcherPrefillAtom,
    launcherProjectAtom,
    launcherPrototypeAtom,
    launcherRestoredAtom,
    launcherResumeAtom,
    launcherRuntimeAtom,
    launcherSessionsAtom,
    launcherSpecPathAtom,
    launcherTaskAtom,
    launcherWhenAtom,
    launcherWorktreeAtom,
    loadLauncherSessions,
    loadMoreLauncherSessions,
    markRunStartChecking,
    openLauncher,
    peekLauncherHandback,
    pickLauncherProject,
    pickLauncherRuntime,
    pickWhen,
    reopenLauncher,
    RESUME_PICK_KEEP_MS,
    takeLauncherHandback,
    tickWhen,
} from "./launcherstore";
import { WHEN_START } from "./launcherwhen";
import {
    autonomousAtom,
    configTouchedAtom,
    forgetConfiguredChannel,
    hydrateRunConfigFromProfile,
    parallelismAtom,
    planPathAtom,
    resetRunConfig,
    resetRunConfigForChannel,
    runShapeAtom,
    setRunShape,
    shapePickedAtom,
    startAtom,
} from "./runconfigstore";

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetRecentSessionsCommand: vi.fn(), RunStartSuggestCommand: vi.fn() },
}));
const recent = vi.mocked(RpcApi.GetRecentSessionsCommand);
const suggest = vi.mocked(RpcApi.RunStartSuggestCommand);

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
    globalStore.set(launcherKindAtom, "agent");
    globalStore.set(launcherRuntimeAtom, null);
    globalStore.set(launcherProjectAtom, "");
    globalStore.set(launcherPrefillAtom, null);
    globalStore.set(launcherHandbackAtom, null);
    globalStore.set(launcherOwnProjectAtom, null);
    globalStore.set(launcherBusyAtom, false);
    suggest.mockReset();
    endLauncherDraft();
    forgetConfiguredChannel();
    globalStore.set(shapePickedAtom, false);
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
    it("a reopen within 30 seconds keeps the resume pick; a later one starts on New session but keeps the text", () => {
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
    it("clearLauncherDraft empties the attachments and frees their previews", () => {
        setDraftAttachments(LAUNCHER_DRAFT, [
            { id: "a", name: "a.png", kind: "image", status: "ready", previewUrl: "blob:a", path: "/tmp/a.png" },
            { id: "b", name: "b.png", kind: "image", status: "uploading", previewUrl: "blob:b" },
        ]);
        clearLauncherDraft();
        expect(draftAttachments(LAUNCHER_DRAFT)).toEqual([]);
        expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a", "blob:b"]);
    });
    it("a draft of only attachments is restored on the next open", () => {
        setDraftAttachments(LAUNCHER_DRAFT, [
            { id: "a", name: "notes.md", kind: "file", status: "ready", path: "/tmp/notes.md" },
        ]);
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
    it("a close keeps the spec path, the brainstorm and the When pick with the draft; Clear drops the first two", () => {
        const m = model();
        const brainstorm = { tab: "tab-1", path: "C:/p/brainstorm.json" };
        globalStore.set(launcherSpecPathAtom, "C:/p/spec.md");
        globalStore.set(launcherBrainstormAtom, brainstorm);
        pickWhen("queue");
        closeLauncher(m);
        expect(globalStore.get(launcherSpecPathAtom)).toBe("C:/p/spec.md");
        expect(globalStore.get(launcherBrainstormAtom)).toBe(brainstorm);
        expect(globalStore.get(launcherWhenAtom).choice).toBe("queue");
        clearLauncherDraft();
        expect(globalStore.get(launcherSpecPathAtom)).toBe("");
        expect(globalStore.get(launcherBrainstormAtom)).toBeNull();
        // Clear empties text and leaves picks, as it does the shape and the project
        expect(globalStore.get(launcherWhenAtom).choice).toBe("queue");
    });
    it("a launch ends the When pick too, so the next launch starts on Jarvis's suggestion", () => {
        pickWhen("queue");
        endLauncherDraft();
        expect(globalStore.get(launcherWhenAtom)).toEqual(WHEN_START);
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
    // a brainstorm's Approve opens the dialog this way: a door, not a hand edit, so the project's saved profile
    // (Approvals, workers, width) still fills it, and the shape it picked survives the profile and the project switch
    it("leaves the draft untouched, so the project's profile still fills Approvals", () => {
        globalStore.set(launcherPrefillAtom, prefill);
        applyLauncherPrefill(["arcterm"]);
        expect(globalStore.get(configTouchedAtom)).toBe(false);
        resetRunConfigForChannel("chan-arcterm", true);
        hydrateRunConfigFromProfile({
            playbook: [],
            autonomous: true,
            parallelism: 5,
            defaultmode: "quick",
        } as JarvisProfile);
        expect(globalStore.get(autonomousAtom)).toBe(true);
        expect(globalStore.get(parallelismAtom)).toBe(5);
        expect(globalStore.get(runShapeAtom)).toBe("orchestrator");
        expect(globalStore.get(startAtom)).toBe("goal");
    });

    it("fills the spec path and the brainstorm, and a later prefill without them clears them", () => {
        const brainstorm = { tab: "tab-1", path: "C:/p/brainstorm.json" };
        globalStore.set(launcherPrefillAtom, { ...prefill, specPath: "C:/p/spec.md", brainstorm });
        applyLauncherPrefill(["arcterm"]);
        expect(globalStore.get(launcherSpecPathAtom)).toBe("C:/p/spec.md");
        expect(globalStore.get(launcherBrainstormAtom)).toEqual(brainstorm);
        globalStore.set(launcherPrefillAtom, prefill);
        applyLauncherPrefill(["arcterm"]);
        expect(globalStore.get(launcherSpecPathAtom)).toBe("");
        expect(globalStore.get(launcherBrainstormAtom)).toBeNull();
    });

    describe("the handback of the run it starts", () => {
        const handback = () => ({ handedOff: vi.fn(), started: vi.fn(), stopped: vi.fn() });
        it("can be read without taking it, so a queue that fails leaves it for the next try", () => {
            const h = handback();
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: h });
            applyLauncherPrefill(["arcterm"]);
            expect(peekLauncherHandback()).toBe(h);
            expect(peekLauncherHandback()).toBe(h);
            expect(takeLauncherHandback()).toBe(h);
            expect(peekLauncherHandback()).toBeNull();
        });
        it("keeps the prefill's handback after the prefill itself is consumed, until it is taken", () => {
            const h = handback();
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: h });
            expect(applyLauncherPrefill(["arcterm"])).toBe(true);
            expect(globalStore.get(launcherPrefillAtom)).toBeNull();
            expect(globalStore.get(launcherHandbackAtom)).toBe(h);
            expect(takeLauncherHandback()).toBe(h);
            // taken once: the run it was for has started
            expect(takeLauncherHandback()).toBeNull();
            expect(globalStore.get(launcherHandbackAtom)).toBeNull();
            // taking it tells it nothing: the start does
            expect(h.handedOff).not.toHaveBeenCalled();
        });
        it("keeps nothing for a prefill with none, replacing an earlier prefill's", () => {
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: handback() });
            applyLauncherPrefill(["arcterm"]);
            globalStore.set(launcherPrefillAtom, prefill);
            applyLauncherPrefill(["arcterm"]);
            expect(takeLauncherHandback()).toBeNull();
        });
        it("is kept while the project list is still empty, so a late list does not lose it", () => {
            const h = handback();
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: h });
            expect(applyLauncherPrefill([])).toBe(false);
            expect(applyLauncherPrefill(["arcterm"])).toBe(true);
            expect(takeLauncherHandback()).toBe(h);
        });
        it("goes when the launcher closes: the next New is no handback's run", () => {
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: handback() });
            applyLauncherPrefill(["arcterm"]);
            closeLauncher(model());
            expect(globalStore.get(launcherHandbackAtom)).toBeNull();
        });
        it("goes when another open starts without it", () => {
            globalStore.set(launcherPrefillAtom, { ...prefill, handback: handback() });
            applyLauncherPrefill(["arcterm"]);
            openLauncher(model(), "run");
            expect(globalStore.get(launcherHandbackAtom)).toBeNull();
        });
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
});

describe("the When row's suggestion", () => {
    const ask: CommandRunStartSuggestData = { projectpath: "/p/a", goal: "land the resolver" };
    const answer = (over: Partial<RunStartSuggestion> = {}): RunStartSuggestion => ({
        choice: "after",
        after: ["r-1"],
        reason: "Edits land.go like run Land",
        live: [{ runid: "r-1", title: "Land", files: ["land.go"] }],
        active: 1,
        maxactive: 3,
        ...over,
    });
    const deferred = () => {
        let resolve!: (v: RunStartSuggestion) => void;
        let reject!: (e: unknown) => void;
        const promise = new Promise<RunStartSuggestion>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
    const when = () => globalStore.get(launcherWhenAtom);

    it("reads Checking… while the call is out, then takes the suggestion", async () => {
        const d = deferred();
        suggest.mockReturnValueOnce(d.promise);
        const done = checkRunStart(ask);
        expect(when().checking).toBe(true);
        expect(suggest.mock.calls[0][1]).toEqual(ask);
        d.resolve(answer());
        await done;
        expect(when()).toMatchObject({ checking: false, choice: "after", ticked: ["r-1"], error: null });
    });

    it("says what failed and leaves Run now", async () => {
        suggest.mockRejectedValueOnce(new Error("run start suggestions are not built yet"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            await checkRunStart(ask);
            expect(when()).toMatchObject({
                checking: false,
                choice: "now",
                error: "run start suggestions are not built yet",
            });
            // handled at the boundary and logged, not swallowed
            expect(warn).toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it("keeps a choice the person made while it was checking", async () => {
        const d = deferred();
        suggest.mockReturnValueOnce(d.promise);
        const done = checkRunStart(ask);
        pickWhen("queue");
        d.resolve(answer());
        await done;
        expect(when().choice).toBe("queue");
        expect(when().suggestion?.reason).toBe("Edits land.go like run Land");
    });

    it("takes only the newest answer: a slow one for an older goal lands after and is dropped", async () => {
        const slow = deferred();
        const fast = deferred();
        suggest.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
        const first = checkRunStart(ask);
        const second = checkRunStart({ ...ask, goal: "something else" });
        fast.resolve(answer({ choice: "queue", after: [], reason: "3 runs are already active" }));
        await second;
        slow.resolve(answer({ reason: "old" }));
        await first;
        expect(when().suggestion?.reason).toBe("3 runs are already active");
        expect(when().choice).toBe("queue");
    });

    it("a failure of an older call does not overwrite the newest answer", async () => {
        const slow = deferred();
        suggest.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(answer({ reason: "fresh" }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const first = checkRunStart(ask);
            await checkRunStart(ask);
            slow.reject(new Error("late failure"));
            await first;
            expect(when().error).toBeNull();
            expect(when().suggestion?.reason).toBe("fresh");
        } finally {
            warn.mockRestore();
        }
    });

    it("an input that changed drops the answer still on its way", async () => {
        const d = deferred();
        suggest.mockReturnValueOnce(d.promise);
        const done = checkRunStart(ask);
        // the row marks the next check at once, then asks after its pause
        markRunStartChecking();
        d.resolve(answer({ reason: "for the old goal" }));
        await done;
        expect(when()).toMatchObject({ checking: true, suggestion: null });
    });

    it("ticks and unticks through the store", async () => {
        suggest.mockResolvedValueOnce(
            answer({
                choice: "now",
                after: [],
                live: [
                    { runid: "r-1", title: "Land" },
                    { runid: "r-2", title: "Chat" },
                ],
            })
        );
        await checkRunStart(ask);
        pickWhen("after");
        tickWhen("r-2");
        expect(when().ticked).toEqual(["r-2"]);
        tickWhen("r-2");
        expect(when().ticked).toEqual([]);
    });
});
