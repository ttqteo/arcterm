// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { registerModal } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { centerModeAtom } from "@/app/view/agents/agentcenter";
import { SURFACE_ORDER, type SurfaceKey } from "@/app/view/agents/agents";
import type { GalleryCanvas } from "@/app/view/agents/canvasgallery";
import {
    canvasGalleryAtom,
    canvasListAtom,
    cleanupAtom,
    linkPickerAtom,
    openLinkPicker,
    scanAtom,
    startCleanup,
} from "@/app/view/agents/canvasgallerystore";
import type { LauncherKind } from "@/app/view/agents/launcher";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusSubagentAtom } from "@/app/view/agents/subagentsstore";
import { activeChannelRunsAtom } from "@/app/view/agents/channelsstore";
import { getProcExitAtom } from "@/app/view/agents/agentcontrollerstore";
import { railPanelsAtom, railTranscriptFocusAtom } from "@/app/view/agents/agentrailstore";
import type { BrainstormFile } from "@/app/view/agents/brainstormmodel";
import { sendBrainstorm } from "@/app/view/agents/brainstormsend";
import {
    attachBrainstorm,
    detachBrainstorm,
    getBrainstorm,
    openBrainstormBoard,
    openBrainstormDesign,
    setReviewCursor,
    updateBrainstorm,
} from "@/app/view/agents/brainstormstore";
import {
    attachCanvas,
    detachCanvas,
    getCanvas,
    setCanvasMode,
    setMarking,
    updateCanvas,
} from "@/app/view/agents/canvasstore";
import { setAgentView } from "@/app/view/agents/agentview";
import { getChatMode, setChatMode } from "@/app/view/agents/chatmodestore";
import { compareRefsAtom, setCompareRefs } from "@/app/view/agents/comparestore";
import { diffScopeAtom } from "@/app/view/agents/diffscopeatom";
import { docReviewAtom } from "@/app/view/agents/docreview";
import { addComment, getDocReview, setGeneralNote, syncDocReview } from "@/app/view/agents/docreviewstore";
import { filesStateAtom, reloadChanges } from "@/app/view/agents/filesstore";
import { treeModeAtom } from "@/app/view/agents/filetree";
import { graphOnAtom, historyFiltersAtom, historyScrollAtom, refreshHistory } from "@/app/view/agents/githistorystore";
import { NO_FILTERS } from "@/app/view/agents/historyquery";
import type { LineComment } from "@/app/view/agents/linecomments";
import { activeReviewKeyAtom, lineReviewsAtom, type LineReviewState } from "@/app/view/agents/linecommentstore";
import { confirmCloseSession } from "@/app/view/agents/agentactions";
import { floatModeAtom, minimizeRequested } from "@/app/view/agents/floatstore";
import {
    dockedTerminalAtom,
    railVisibleAtom,
    terminalDockFoldedAtom,
    terminalFullscreenAtom,
} from "@/app/view/agents/railstore";
import { NO_LINEAGE } from "@/app/view/agents/runlineage";
import { closeSwitcher, tabSwitcherAtom } from "@/app/view/agents/tabswitcherstore";
import { activeReviewAtom, reviewMarksAtom } from "@/app/view/agents/reviewmarks";
import { reopenClosedAgent } from "@/app/cockpit/cockpit-actions";
import { START_DEFS } from "@/app/cockpit/palette-commands";
import { openNewCouncil } from "@/app/view/agents/newcouncil";
import { openToolPicker } from "@/app/view/agents/toolsstore";
import { renamingRowAtom } from "@/app/view/agents/rowrenameatom";
import { autonomyPanelOpenAtom } from "@/app/view/jarvis/autonomyladder";
import { bandOpenAtom } from "@/app/view/agents/initiativebandstore";
import { initiativeLinkPickerAtom, initiativePopoverAtom } from "@/app/view/agents/initiativepopover";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
import { briefPeekRecordAtom, briefSheetOpenAtom, chunkMoveAtom } from "@/app/view/jarvis/jarvisstore";
import { initiativeSheetAtom, sheetChunkMoveAtom } from "@/app/view/jarvis/initiativesheetstore";
import { activeRunIdAtom, activeSubjectAtom } from "@/app/view/jarvis/jarvissubjectstore";
import { tourAtom } from "@/app/view/jarvis/jarvistourstore";
import { peekTarget } from "@/app/view/jarvis/openref";
import { itemKeyCommand } from "@/app/view/jarvis/peekitemmodel";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { peekKeyCommand } from "@/app/view/jarvis/petpeekmodel";
import { briefCursorInitiativeAtom } from "@/app/view/jarvis/jarvisstore";
import { councilSheetAtom } from "@/app/view/jarvis/councilsheetstore";
import { togglePin } from "@/app/view/jarvis/effortstore";
import { enterReview, exitReview, reviewModeAtom, reviewedAtom, reviewQueueAtom } from "@/app/view/jarvis/reviewstore";
import { dagModalStateAtom } from "@/app/view/orchestrate/dagmodalstate";
import { focusedTerminalBlockId, redrawTerminal } from "@/app/view/term/termwrap";
import { codeTreeFocusedAtom } from "@/app/view/code/codestore";
import { codeSearchModeAtom } from "@/app/view/code/codesearchstore";
import { escapeMenusOpenAtom } from "@/app/hook/useEscapeClose";
import { registerCommentSend } from "@/app/view/agents/commentsend";
import { commentOnSelection } from "@/app/view/agents/diffcommentlayer";
import { splitAvailableAtom, splitViewAtom } from "@/app/view/agents/diffoptions";
import { LIST_COLLAPSED_ROWS } from "@/app/view/agents/usageattribution";
import { usageLensAtom, usageListShownAtom, usageWorkItemAtom, usageWorkScopeAtom } from "@/app/view/agents/usagestore";
import { codeReviewsAtom, codeReviewSendOpenAtom, startComment } from "@/app/view/code/codereviewstore";
import {
    caretWord,
    codeIndexAtom,
    codeProjectAtom,
    findReferences,
    goToDefinition,
} from "@/app/view/code/codestore";
import {
    buildAgentBindings,
    buildChannelsAskBindings,
    buildCockpitBindings,
    buildCodeBindings,
    buildCouncilBindings,
    buildFilesBindings,
    buildFinalShotsBindings,
    buildGlobalBindings,
    buildInitiativeSheetBindings,
    buildJarvisBindings,
    buildJarvisTourBindings,
    buildListNavBindings,
    buildUsageBindings,
    closeTarget,
} from "./bindings";
import { councilChatNavAtom, type CouncilChatNav } from "@/app/view/agents/councilchatnav";
import { setPlatform } from "@/util/platformutil";
import { listNavAtom } from "./listnav";
import { matchBinding } from "./matcher";
import type { KeyContext } from "./types";

vi.mock("@/app/view/jarvis/openref", async (orig) => ({
    ...(await orig<typeof import("@/app/view/jarvis/openref")>()),
    peekTarget: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/view/jarvis/effortstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/jarvis/effortstore")>()),
    togglePin: vi.fn(async () => {}),
}));

// r's re-reads go to the backend; the Diff key tests only ask which of them ran
vi.mock("@/app/view/agents/comparestore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/comparestore")>()),
    setCompareRefs: vi.fn(async () => {}),
}));
vi.mock("@/app/view/agents/githistorystore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/githistorystore")>()),
    refreshHistory: vi.fn(),
}));
vi.mock("@/app/view/agents/filesstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/filesstore")>()),
    reloadChanges: vi.fn(async () => {}),
}));
// The Kael-sync keys call into Code and the Diff comment layer. Each is the real function, watched: with no editor
// mounted they decline on their own, and a case that needs another answer sets it for that case alone.
vi.mock("@/app/view/code/codestore", async (orig) => {
    const mod = await orig<typeof import("@/app/view/code/codestore")>();
    return {
        ...mod,
        caretWord: vi.fn(mod.caretWord),
        goToDefinition: vi.fn(mod.goToDefinition),
        findReferences: vi.fn(mod.findReferences),
    };
});
vi.mock("@/app/view/code/codereviewstore", async (orig) => {
    const mod = await orig<typeof import("@/app/view/code/codereviewstore")>();
    return { ...mod, startComment: vi.fn(mod.startComment) };
});
vi.mock("@/app/view/agents/diffcommentlayer", async (orig) => {
    const mod = await orig<typeof import("@/app/view/agents/diffcommentlayer")>();
    return { ...mod, commentOnSelection: vi.fn(mod.commentOnSelection) };
});

// it reads the project list from the app's global atoms, which this node suite does not set up
vi.mock("@/app/view/agents/worktreesidebarstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/worktreesidebarstore")>()),
    refreshSidebar: vi.fn(async () => {}),
}));

vi.mock("@/app/view/agents/floatstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/floatstore")>()),
    minimizeRequested: vi.fn(),
}));

// the picker reads the tool status over the wire when it opens; the chord is only asked to open it
vi.mock("@/app/view/agents/toolsstore", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/toolsstore")>()),
    openToolPicker: vi.fn(),
}));

// a reopen rescans the sessions archive and launches over the wire; the chord is only asked to start it
vi.mock("@/app/cockpit/cockpit-actions", async (orig) => ({
    ...(await orig<typeof import("@/app/cockpit/cockpit-actions")>()),
    reopenClosedAgent: vi.fn(async () => {}),
}));

// Setup reads the registered projects and the focused agent; the binding is only asked to open it
vi.mock("@/app/view/agents/newcouncil", () => ({ openNewCouncil: vi.fn() }));

vi.mock("@/app/view/agents/agentactions", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/agentactions")>()),
    confirmCloseSession: vi.fn(),
}));

vi.mock("@/app/view/term/termwrap", async (orig) => ({
    ...(await orig<typeof import("@/app/view/term/termwrap")>()),
    redrawTerminal: vi.fn(() => true),
    focusedTerminalBlockId: vi.fn(() => undefined),
}));

// the brainstorm keys send their lines over the wire; the tests only ask which line a key sends
vi.mock("@/app/view/agents/brainstormsend", async (orig) => ({
    ...(await orig<typeof import("@/app/view/agents/brainstormsend")>()),
    sendBrainstorm: vi.fn(async () => {}),
}));

// the canvas guards read the focused agent id from the model
const stubModel = (focusId?: string): any => ({
    focusIdAtom: atom<string | undefined>(focusId) as PrimitiveAtom<string | undefined>,
    agentsAtom: atom([]),
});

const docAsk = (path: string) => ({
    askId: `doc:${path}`,
    questions: [
        {
            header: "Doc review",
            question: `${path}\n- §3.2: rewritten`,
            options: [{ label: "Approve" }, { label: "Request changes" }],
        },
    ],
});

const ctx = (surface: SurfaceKey = "cockpit"): KeyContext => ({
    surface,
    editable: false,
    modalOpen: false,
    leader: null,
});

describe("closeTarget", () => {
    const items = [
        { id: "agent-tab", name: "Agent", state: "working" },
        { id: "terminal-tab", name: "Terminal", state: "idle", kind: "terminal" },
    ] as any;

    it("closes the focused agent", () => {
        expect(closeTarget(items, "agent-tab")).toEqual(items[0]);
    });

    it("closes a plain terminal too, as a terminal app's tab closes", () => {
        expect(closeTarget(items, "terminal-tab")).toEqual(items[1]);
    });

    it("goes by the pane that took the keys, not the selected agent: a terminal docked under it closes the terminal", () => {
        expect(closeTarget(items, "agent-tab", "terminal-tab")).toEqual(items[1]);
        expect(closeTarget(items, "terminal-tab", "agent-tab")).toEqual(items[0]);
    });

    it("returns null (no close) when nothing is focused", () => {
        expect(closeTarget(items, undefined)).toBeNull();
    });

    it("returns null when the focused id is not in the roster", () => {
        expect(closeTarget(items, "gone")).toBeNull();
    });
});

// ⌘⇧W on a Mac and Ctrl+Shift+W on Windows, as a terminal app closes its tab; Ctrl+W deletes a word in the terminal
describe("close-agent chord", () => {
    beforeEach(() => vi.stubGlobal("document", { activeElement: null }));
    afterEach(() => {
        setPlatform("darwin");
        vi.unstubAllGlobals();
    });

    const model = () =>
        ({
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([{ id: "a1", name: "Agent", state: "idle" }]),
            terminalsAtom: atom([]),
            focusIdAtom: atom<string | undefined>("a1"),
        }) as any;

    it("is Mod+Shift+W: ⌘⇧W on a Mac, Ctrl+Shift+W on Windows, with no plain Ctrl+W", () => {
        expect(buildGlobalBindings(model()).find((x) => x.id === "close-agent")!.keys).toBe("Mod:Shift:w");
        setPlatform("win32");
        const all = buildGlobalBindings(model());
        expect(all.find((x) => x.id === "close-agent")!.keys).toBe("Mod:Shift:w");
        expect(all.find((x) => x.id === "close-agent:ctrl")).toBeUndefined();
    });

    it("works from inside the terminal on the Agent surface, and asks before closing the focused agent", () => {
        const m = model();
        const b = buildGlobalBindings(m).find((x) => x.id === "close-agent")!;
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.(ctx("cockpit"))).toBe(false);
        expect(b.when?.({ ...ctx("agent"), modalOpen: true })).toBe(false);
        vi.mocked(confirmCloseSession).mockClear();
        b.run(ctx("agent"));
        expect(confirmCloseSession).toHaveBeenCalledWith(
            expect.objectContaining({ id: "a1" }),
            m,
            "Mod+Shift+W"
        );
    });
});

describe("Ctrl+Tab switcher", () => {
    afterEach(() => {
        closeSwitcher();
        globalStore.set(floatModeAtom, false);
        globalStore.set(terminalFullscreenAtom, false);
        globalStore.set(centerModeAtom, "terminal");
        vi.useRealTimers();
    });

    const model = () =>
        ({
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([
                { id: "a1", name: "one", state: "working" },
                { id: "a2", name: "two", state: "idle" },
            ]),
            terminalsAtom: atom([{ id: "t1", name: "zsh", state: "idle", kind: "terminal" }]),
            focusIdAtom: atom<string | undefined>("a1"),
            lineageAtom: atom(NO_LINEAGE),
        }) as any;
    const ctrlTab: WaveKeyboardEvent = {
        control: true,
        shift: false,
        cmd: false,
        option: false,
        meta: false,
        alt: false,
        key: "Tab",
        code: "Tab",
        location: 0,
        repeat: false,
        type: "keydown",
    } as WaveKeyboardEvent;
    // what the dispatcher would run for Ctrl+Tab from inside the terminal
    const ctrlTabRuns = (m: any) => {
        const r = matchBinding(ctrlTab, { ...ctx("agent"), editable: true }, buildGlobalBindings(m));
        return r.kind === "run" ? r.binding.id : r.kind;
    };

    it("opens the switcher in the plain Agent surface", () => expect(ctrlTabRuns(model())).toBe("switcher:next"));

    it("opens the switcher in terminal fullscreen", () => {
        globalStore.set(terminalFullscreenAtom, true);
        expect(ctrlTabRuns(model())).toBe("switcher:next");
    });

    it("opens the switcher in a float", () => {
        globalStore.set(floatModeAtom, true);
        expect(ctrlTabRuns(model())).toBe("switcher:next");
    });

    it("opens the switcher over History too", () => {
        globalStore.set(centerModeAtom, "history");
        expect(ctrlTabRuns(model())).toBe("switcher:next");
    });

    it("stands down under another modal, not under its own", () => {
        const m = model();
        const b = buildGlobalBindings(m).find((x) => x.id === "switcher:next")!;
        expect(b.when?.({ ...ctx("agent"), modalOpen: true })).toBe(false);
        b.run(ctx("agent"));
        expect(b.when?.({ ...ctx("agent"), modalOpen: true })).toBe(true);
        expect(b.when?.(ctx("cockpit"))).toBe(false);
    });

    it("picks the next tab and draws the switcher after a moment", () => {
        vi.useFakeTimers();
        globalStore.set(terminalFullscreenAtom, true);
        const m = model();
        buildGlobalBindings(m)
            .find((b) => b.id === "switcher:next")!
            .run(ctx("agent"));
        expect(globalStore.get(tabSwitcherAtom)).toMatchObject({ ids: ["a1", "a2", "t1"], sel: 1, shown: false });
        vi.runAllTimers();
        expect(globalStore.get(tabSwitcherAtom)?.shown).toBe(true);
    });
});

describe("surface switch [ / ]", () => {
    it("cycles SURFACE_ORDER forward/back with wrap, past Diff back to the cockpit", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const bindings = buildGlobalBindings(model);
        const next = bindings.find((b) => b.id === "surface:next")!;
        const prev = bindings.find((b) => b.id === "surface:prev")!;
        expect(next.keys).toBe("]");
        expect(prev.keys).toBe("[");

        next.run(ctx()); // cockpit -> jarvis
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");

        globalStore.set(model.surfaceAtom, "files");
        next.run(ctx()); // files (Diff) is last now that Radar is off the rail: it wraps to the cockpit
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");

        globalStore.set(model.surfaceAtom, SURFACE_ORDER[SURFACE_ORDER.length - 1]);
        next.run(ctx()); // wrap forward to first
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[0]);

        prev.run(ctx()); // wrap back to last
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[SURFACE_ORDER.length - 1]);
    });

    it("binds Mod+1..6 to SURFACE_ORDER, so Usage is Mod+4 and Diff is Mod+6", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const chords = buildGlobalBindings(model).filter(
            (b) => /^Mod:\d$/.test(b.keys) && b.id.startsWith("surface:")
        );
        expect(chords.map((b) => b.keys)).toEqual([
            "Mod:1",
            "Mod:2",
            "Mod:3",
            "Mod:4",
            "Mod:5",
            "Mod:6",
        ]);
        chords.find((b) => b.keys === "Mod:4")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("usage");
        chords.find((b) => b.keys === "Mod:6")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("files");
    });

    it("binds Alt+1..9 to the Active list's agents on the Agent surface, inside a terminal too", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent"), focusAgentAt: vi.fn() } as any;
        const chords = buildGlobalBindings(model).filter((b) => b.id.startsWith("agent:jump-"));
        expect(chords.map((b) => b.keys)).toEqual(Array.from({ length: 9 }, (_, i) => `Alt:${i + 1}`));
        const inTerminal: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
        expect(chords.every((b) => b.when!(inTerminal))).toBe(true);
        expect(chords[0].when!({ ...inTerminal, surface: "code" })).toBe(false);
        expect(chords[0].when!({ ...inTerminal, modalOpen: true })).toBe(false);
        chords[2].run(ctx());
        expect(model.focusAgentAt).toHaveBeenCalledWith(3);
    });

    it("enters the cycle gracefully from a surface not in SURFACE_ORDER (settings)", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("settings") } as any;
        const bindings = buildGlobalBindings(model);
        bindings.find((b) => b.id === "surface:next")!.run(ctx("settings"));
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[0]);
    });

    it("switch bindings are suppressed while typing / modal open", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const next = buildGlobalBindings(model).find((b) => b.id === "surface:next")!;
        expect(next.when!({ surface: "cockpit", editable: true, modalOpen: false, leader: null })).toBe(false);
        expect(next.when!({ surface: "cockpit", editable: false, modalOpen: true, leader: null })).toBe(false);
        expect(next.when!(ctx())).toBe(true);
    });

    it("exposes a g r leader teleport to radar", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:radar")!;
        expect(b.keys).toBe("g r");
        b.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");
    });
});

describe("Escape back to the Cockpit", () => {
    const backHome = () =>
        buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("jarvis") } as any).find(
            (b) => b.id === "surface:back-home"
        )!;

    it("leaves a deep surface, but is not bound on the Cockpit itself", () => {
        globalStore.set(autonomyPanelOpenAtom, false);
        const b = backHome();
        expect(b.keys).toBe("Escape");
        expect(b.when!(ctx("jarvis"))).toBe(true);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    // an overlay that dismisses on Escape must also suppress this, or one press does both: closes the
    // overlay AND leaves the surface. The dispatcher runs on window capture, so the overlay cannot win
    // the key by registering its own handler — it has to be declared here.
    it("yields to the Jarvis autonomy panel, which owns Escape while open", () => {
        const b = backHome();
        globalStore.set(autonomyPanelOpenAtom, true);
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(autonomyPanelOpenAtom, false);
        expect(b.when!(ctx("jarvis"))).toBe(true);
    });

    // the pet lives in window chrome, so unlike the autonomy panel its peek can be open on ANY deep surface
    it("yields to the pet's peek on every deep surface it can be open over", () => {
        const b = backHome();
        globalStore.set(petPeekOpenAtom, true);
        expect(b.when!(ctx("jarvis"))).toBe(false);
        expect(b.when!(ctx("files"))).toBe(false);
        expect(b.when!(ctx("usage"))).toBe(false);
        globalStore.set(petPeekOpenAtom, false);
        expect(b.when!(ctx("usage"))).toBe(true);
    });

    // The Brief mounts two overlays that take Escape themselves and were missing from this list, so one
    // press both closed the overlay and left the surface — and because the overlay's owner state was never
    // cleared, returning to the Brief showed it open again. The peek is the Brief's only record
    // destination, and the DAG modal is reachable from its run sheet.
    it("yields to the Brief's record peek and DAG modal", () => {
        const b = backHome();
        globalStore.set(autonomyPanelOpenAtom, false);
        globalStore.set(petPeekOpenAtom, false);
        globalStore.set(briefPeekRecordAtom, "task-a");
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(briefPeekRecordAtom, null);
        globalStore.set(dagModalStateAtom, {
            kind: "live",
            channelId: "ch-1",
            runId: "run-1",
            dagOref: "dag:run-1",
            error: "",
        });
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(dagModalStateAtom, null);
        expect(b.when!(ctx("jarvis"))).toBe(true);
    });
});

describe("list-nav bindings", () => {
    const chanCtx: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };

    it("is inactive with no controller, when editable/modal, or on a mismatched surface", () => {
        globalStore.set(listNavAtom, null);
        const j = buildListNavBindings(stubModel()).find((b) => b.id === "list:next-j")!;
        expect(j.keys).toBe("j");
        expect(j.when!(chanCtx)).toBe(false); // no controller

        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        expect(j.when!(chanCtx)).toBe(true);
        expect(j.when!({ ...chanCtx, editable: true })).toBe(false);
        expect(j.when!({ ...chanCtx, modalOpen: true })).toBe(false);
        expect(j.when!({ ...chanCtx, surface: "usage" })).toBe(false); // controller is for jarvis
        globalStore.set(listNavAtom, null);
    });

    it("j/ArrowDown move forward and k/ArrowUp back via moveCursor (clamped, no wrap)", () => {
        const seen: string[] = [];
        globalStore.set(listNavAtom, {
            surface: "jarvis",
            navigableIds: ["a", "b", "c"],
            cursorId: "b",
            setCursor: (id) => seen.push(id),
        });
        const bindings = buildListNavBindings(stubModel());
        bindings.find((b) => b.id === "list:next-j")!.run(chanCtx);
        bindings.find((b) => b.id === "list:prev-k")!.run(chanCtx);
        bindings.find((b) => b.id === "list:next")!.run(chanCtx);
        bindings.find((b) => b.id === "list:prev")!.run(chanCtx);
        expect(seen).toEqual(["c", "a", "c", "a"]); // from "b": +1=c, -1=a, +1=c, -1=a
        globalStore.set(listNavAtom, null);
    });

    it("first press from an empty/absent cursor lands on the first id", () => {
        const seen: string[] = [];
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: undefined, setCursor: (id) => seen.push(id) });
        buildListNavBindings(stubModel()).find((b) => b.id === "list:next-j")!.run(chanCtx);
        expect(seen).toEqual(["a"]);
        globalStore.set(listNavAtom, null);
    });

    describe("list:peek", () => {
        const run = { kind: "run", runId: "r1" } as const;
        const publish = (peekTarget?: () => typeof run | null) =>
            globalStore.set(listNavAtom, {
                surface: "jarvis",
                navigableIds: ["a"],
                cursorId: "a",
                setCursor() {},
                peekTarget,
            });
        afterEach(() => {
            globalStore.set(listNavAtom, null);
            vi.mocked(peekTarget).mockClear();
        });

        it("is bound to Space and inactive without a peekTarget, when it returns null, in a field, or under a modal", () => {
            const model = stubModel();
            const b = buildListNavBindings(model).find((x) => x.id === "list:peek")!;
            expect(b.keys).toBe("Space");
            publish();
            expect(b.when!(chanCtx)).toBe(false);
            publish(() => null);
            expect(b.when!(chanCtx)).toBe(false);
            publish(() => run);
            expect(b.when!({ ...chanCtx, editable: true })).toBe(false);
            expect(b.when!({ ...chanCtx, modalOpen: true })).toBe(false);
            expect(b.when!(chanCtx)).toBe(true);
        });

        it("peeks the cursor row's target", () => {
            const model = stubModel();
            publish(() => run);
            const peek = buildListNavBindings(model).find((x) => x.id === "list:peek")!;
            peek.run(chanCtx);
            expect(peekTarget).toHaveBeenCalledWith(model, run);
        });
    });
});

describe("jarvis surface bindings", () => {
    const jarvisCtx: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    // the cast: without strictNullChecks, null picks atom's read-only overload
    const launcherModel = { launcherAtom: atom<LauncherKind | null>(null) as PrimitiveAtom<LauncherKind | null> };
    const byId = (id: string) => buildJarvisBindings(launcherModel).find((b) => b.id === id)!;

    // the click-through bindings (+ Channel, the record band) and composer focus act on rendered DOM, so
    // only their guards are asserted here — this suite runs in node, and the surface has no render harness
    // (see docs: surface behaviour is checked over CDP, not jsdom).

    // the app bar has one New button now, so `r` opens the launcher at the run door itself rather than pressing it
    it("r opens the New dialog on a run row", () => {
        globalStore.set(launcherModel.launcherAtom, null);
        byId("jarvis:new-run").run(jarvisCtx);
        expect(globalStore.get(launcherModel.launcherAtom)).toBe("run");
        globalStore.set(launcherModel.launcherAtom, null);
    });

    // the Brief's filter takes / the way the Diff history's does, on its own surface
    it("focuses the Brief filter with /", () => {
        const f = byId("jarvis:filter");
        expect(f.keys).toBe("/");
        expect(f.when!(jarvisCtx)).toBe(true);
    });

    it("guards every key on the surface, the typing state and modals", () => {
        for (const b of buildJarvisBindings(launcherModel)) {
            expect(b.when!({ ...jarvisCtx, surface: "cockpit" })).toBe(false);
            expect(b.when!({ ...jarvisCtx, modalOpen: true })).toBe(false);
        }
        // ...except the composer's own Escape, which exists *because* focus is in a field
        expect(byId("jarvis:blur-composer").when!({ ...jarvisCtx, editable: true })).toBe(true);
        for (const b of buildJarvisBindings(launcherModel).filter((x) => x.id !== "jarvis:blur-composer")) {
            expect(b.when!({ ...jarvisCtx, editable: true })).toBe(false);
        }
    });

    it("steps the selected channel's runs with Shift:j / Shift:k, clamped at both ends", () => {
        globalStore.set(activeSubjectAtom, { kind: "channel", id: "ch1" });
        globalStore.set(activeChannelRunsAtom, [
            { id: "r1", status: "running" },
            { id: "r2", status: "running" },
        ] as any);
        globalStore.set(activeRunIdAtom, { ch1: "r1" });
        const next = byId("jarvis:next-run");
        const prev = byId("jarvis:prev-run");
        expect(next.keys).toBe("Shift:j");
        expect(prev.keys).toBe("Shift:k");

        next.run(jarvisCtx);
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r2");
        next.run(jarvisCtx); // clamped at the end
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r2");
        prev.run(jarvisCtx);
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r1");
    });

    it("passes the run keys through when the subject is not a channel, or has nothing to switch", () => {
        globalStore.set(activeSubjectAtom, { kind: "dossier", id: "d1" });
        expect(byId("jarvis:next-run").run(jarvisCtx)).toBe(false);

        globalStore.set(activeSubjectAtom, { kind: "channel", id: "ch1" });
        globalStore.set(activeChannelRunsAtom, [{ id: "r1", status: "running" }] as any);
        expect(byId("jarvis:next-run").run(jarvisCtx)).toBe(false); // a single run is not a switch
        globalStore.set(activeChannelRunsAtom, []);
        globalStore.set(activeSubjectAtom, null);
    });
});

describe("subagent vs agent Escape", () => {
    // subagent:back reads the focused element (a region that owns its keys keeps Escape); the suite has no DOM
    beforeEach(() => vi.stubGlobal("document", { activeElement: null }));
    afterEach(() => vi.unstubAllGlobals());

    it("routes Escape to subagent-back only while a subagent is focused, else to agent-back", () => {
        const bindings = buildAgentBindings(stubModel());
        const sub = bindings.find((b) => b.id === "subagent:back")!;
        const back = bindings.find((b) => b.id === "agent:back")!;
        expect(sub.keys).toBe("Escape");
        const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };

        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        expect(sub.when!(agentCtx)).toBe(true);
        expect(back.when!(agentCtx)).toBe(false);
        sub.run(agentCtx);
        expect(globalStore.get(focusSubagentAtom)).toBeNull();

        // now that no subagent is focused, Escape falls to agent-back
        expect(sub.when!(agentCtx)).toBe(false);
        expect(back.when!(agentCtx)).toBe(true);
    });

    // subagent:back is the one Escape on this surface that fires while a field has focus, so it is the
    // one that can steal Escape from an open rename box. Escape there means cancel the edit, and the
    // dispatcher runs on window capture — if this binding claims the key the input never sees it, and
    // the box commits on the following blur instead of discarding.
    it("yields Escape to an open row rename, even with a subagent focused", () => {
        const sub = buildAgentBindings(stubModel()).find((b) => b.id === "subagent:back")!;
        const editingCtx: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);

        expect(sub.when!(editingCtx)).toBe(true); // fires while editable — that is the whole problem
        globalStore.set(renamingRowAtom, "tab-1");
        expect(sub.when!(editingCtx)).toBe(false);

        globalStore.set(renamingRowAtom, null);
        expect(sub.when!(editingCtx)).toBe(true);
        globalStore.set(focusSubagentAtom, null);
    });

    // the Agent panel's File tab closes on Escape: opened over a subagent, it must not also leave the subagent
    it("yields Escape to a region that owns its keys, even with a subagent focused", () => {
        const sub = buildAgentBindings(stubModel()).find((b) => b.id === "subagent:back")!;
        const ctx: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        const owned = { closest: (sel: string) => (sel === "[data-owns-keys]" ? {} : null) };
        vi.stubGlobal("document", { activeElement: owned });
        expect(sub.when!(ctx)).toBe(false);
        vi.stubGlobal("document", { activeElement: null });
        expect(sub.when!(ctx)).toBe(true);
        globalStore.set(focusSubagentAtom, null);
    });
});

describe("brainstorm pane Escape", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const q = { n: 5, text: "Which layout?", part: "layout" };
    const asking: BrainstormFile = {
        v: 1,
        title: "On-call",
        spec: "",
        question: q,
        working: null,
        parts: [{ id: "layout", title: "Layout", state: "asked", body: "" }],
        history: [],
        done: false,
        check: null,
        run: null,
    };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
    const back = () => all().find((b) => b.id === "agent:brainstorm-back")!;
    const claiming = (c: KeyContext = nav) =>
        all()
            .filter((b) => b.keys === "Escape" && b.when?.(c) !== false)
            .map((b) => b.id);
    const pane = () => {
        const s = getBrainstorm("a1")!;
        return { board: s.board, designOpen: s.designOpen };
    };
    const claims = (key: string, c: KeyContext = nav) =>
        all()
            .filter((b) => b.keys === key && b.when?.(c) !== false)
            .map((b) => b.id);
    const find = (id: string) => all().find((b) => b.id === id)!;
    // a board the canvas has loaded, which the rail draws widened
    const loadBoard = () => {
        attachCanvas("a1", { topic: "oncall", dir: "C:\\p\\d", projectDir: "C:\\p", board: "Split.dc.html" });
        updateCanvas("a1", (s) => ({ ...s, status: "ready" }));
    };
    const choosing: BrainstormFile = {
        ...asking,
        question: {
            ...q,
            options: [
                { label: "One", detail: "" },
                { label: "Two", detail: "" },
                { label: "Three", detail: "" },
            ],
        },
    };
    // the builder check with nothing left to ask: its review fills the main area
    const reviewing: BrainstormFile = {
        ...asking,
        question: null,
        check: { yours: [], calls: [], answered: [] },
    };

    beforeEach(() => {
        vi.stubGlobal("document", { activeElement: null });
        model = {
            ...stubModel("a1"),
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom<any[]>([{ id: "a1", name: "Agent", blockId: "b1" }]),
        };
        attachBrainstorm("a1", { topic: "oncall", cwd: "C:\\p" }, 0);
        updateBrainstorm("a1", (s) => ({ ...s, file: asking }));
        setAgentView("a1", "brainstorm", 1);
    });

    afterEach(() => {
        detachBrainstorm("a1");
        detachCanvas("a1");
        globalStore.set(focusSubagentAtom, null);
        vi.unstubAllGlobals();
    });

    it("a board widened in the rail over the question: Esc shrinks it, and is the only Escape claim", () => {
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claiming()).toEqual(["agent:brainstorm-back"]);
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: false });
        // the question is the top: nothing claims Esc there, as before
        expect(claiming()).toEqual([]);
    });

    it("Esc shrinks a board widened in the builder check too, over its question or its review", () => {
        updateBrainstorm("a1", (s) => ({ ...s, file: { ...asking, check: { yours: [], calls: [], answered: [] } } }));
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claiming()).toEqual(["agent:brainstorm-back"]);
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: false });
        updateBrainstorm("a1", (s) => ({ ...s, file: reviewing }));
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claiming()).toEqual(["agent:brainstorm-back"]);
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: false });
    });

    it("one level per press: a board opened off the design goes back to the design, and the design back to the question", () => {
        openBrainstormDesign("a1", true);
        openBrainstormBoard("a1", "Split.dc.html");
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: true });
        expect(back().when!(nav)).toBe(true);
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: false });
        expect(back().when!(nav)).toBe(false);
    });

    it("the design opened with no question under it has no step back, a pending builder check's design included", () => {
        updateBrainstorm("a1", (s) => ({ ...s, file: { ...asking, question: null }, designOpen: true }));
        expect(back().when!(nav)).toBe(false);
        globalStore.set(model.agentsAtom, [
            { id: "a1", name: "Agent", blockId: "b1", builderCheck: { state: "reading", ts: 2 } },
        ]);
        expect(back().when!(nav)).toBe(false);
    });

    it("yields to a focused field and an open modal", () => {
        openBrainstormBoard("a1", "Split.dc.html");
        // the answer box, a row's edit or rename, the builder-check answer and the mark note are all fields
        expect(back().when!({ ...nav, editable: true })).toBe(false);
        expect(back().when!({ ...nav, modalOpen: true })).toBe(false);
        expect(back().when!(nav)).toBe(true);
    });

    it("on the widened board, a drawn mark's note owns Esc (it drops the mark), even with its field unfocused", () => {
        attachCanvas("a1", { topic: "oncall", dir: "C:\\p\\d", projectDir: "C:\\p", board: "Split.dc.html" });
        openBrainstormBoard("a1", "Split.dc.html");
        setMarking("a1", true);
        expect(back().when!(nav)).toBe(true);
        updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 1, y: 1, w: 40, h: 40, note: "" }] }));
        expect(back().when!(nav)).toBe(false);
        updateCanvas("a1", (s) => ({ ...s, marks: [] }));
        expect(back().when!(nav)).toBe(true);
    });

    it("on a board widened in the rail [ ] and ← → step its boards, never the surfaces or the agents", () => {
        loadBoard();
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claims("[")).toEqual(["agent:canvas-prev"]);
        expect(claims("]")).toEqual(["agent:canvas-next"]);
        expect(claims("ArrowLeft")).toEqual(["agent:canvas-prev-arrow"]);
        expect(claims("ArrowRight")).toEqual(["agent:canvas-next-arrow"]);
        // marking holds the board: neither the board nor the surface switch takes [ ], nor the agent switch ← →
        setMarking("a1", true);
        expect(claims("]")).toEqual([]);
        expect(claims("ArrowRight")).toEqual([]);
        setMarking("a1", false);
        // back on the question there are no boards to step: [ ] switch surfaces and ← → agents again
        openBrainstormBoard("a1", null);
        expect(claims("]")).toEqual(["surface:next"]);
        expect(claims("ArrowRight")).toEqual(["agent:next"]);
    });

    it("a board cleared (the rail no longer shows Boards for it) leaves [ ], ← → and Esc to their other owners", () => {
        loadBoard();
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claims("[")).toEqual(["agent:canvas-prev"]);
        expect(claims("Escape")).toEqual(["agent:brainstorm-back"]);
        openBrainstormBoard("a1", null);
        expect(claims("[")).toEqual(["surface:prev"]);
        expect(claims("]")).toEqual(["surface:next"]);
        expect(claims("ArrowLeft")).toEqual(["agent:prev"]);
        expect(claims("ArrowRight")).toEqual(["agent:next"]);
        // Esc is the design's back when the design is open over the question, and nobody's on the question itself
        expect(claims("Escape")).toEqual([]);
        openBrainstormDesign("a1", true);
        expect(claims("Escape")).toEqual(["agent:brainstorm-back"]);
        back().run(nav);
        expect(pane()).toEqual({ board: null, designOpen: false });
    });

    it("the board keys follow the pane: a run, or the agent's exit, shows no rail, so a stale board holds no keys", () => {
        loadBoard();
        openBrainstormBoard("a1", "Split.dc.html");
        expect(claims("]")).toEqual(["agent:canvas-next"]);
        updateBrainstorm("a1", (s) => ({ ...s, file: { ...asking, run: "r1" } }));
        expect(claims("]")).toEqual(["surface:next"]);
        expect(claims("Escape")).toEqual([]);
    });

    it("a letter key picks its answer while a board is widened, and stands down while that board is marked", () => {
        loadBoard();
        updateBrainstorm("a1", (s) => ({ ...s, file: choosing }));
        const pick = (key: string) => find(`agent:brainstorm-option-${key}`);
        expect(pick("b").when!(nav)).toBe(true);
        openBrainstormBoard("a1", "Split.dc.html");
        // one, two and three offered: a, b and c pick, d has no answer to pick
        expect([pick("a"), pick("b"), pick("c"), pick("d")].map((b) => b.when!(nav))).toEqual([true, true, true, false]);
        // b picks B here, rather than leaving for the terminal
        expect(claims("b")).toEqual(["agent:brainstorm-option-b"]);
        setMarking("a1", true);
        expect([pick("a"), pick("b"), pick("c")].map((b) => b.when!(nav))).toEqual([false, false, false]);
        setMarking("a1", false);
        expect(pick("b").when!(nav)).toBe(true);
    });

    it("a marking left on with no board widened does not hold the letter keys", () => {
        loadBoard();
        updateBrainstorm("a1", (s) => ({ ...s, file: choosing }));
        openBrainstormBoard("a1", "Split.dc.html");
        setMarking("a1", true);
        openBrainstormBoard("a1", null);
        expect(find("agent:brainstorm-option-a").when!(nav)).toBe(true);
    });

    it("in the check's review j, k, y, u and Enter stay live over a widened board, and stand down while it is marked", () => {
        loadBoard();
        updateBrainstorm("a1", (s) => ({ ...s, file: reviewing }));
        const ids = [
            "agent:brainstorm-review-next",
            "agent:brainstorm-review-prev",
            "agent:brainstorm-review-open",
            "agent:brainstorm-review-keep",
            "agent:brainstorm-review-restore",
        ];
        const live = () => ids.map((id) => find(id).when!(nav));
        expect(live()).toEqual([true, true, true, true, true]);
        openBrainstormBoard("a1", "Split.dc.html");
        expect(live()).toEqual([true, true, true, true, true]);
        expect(claims("j")).toEqual(["agent:brainstorm-review-next"]);
        // marking holds them: j and k go back to moving between agents, as on any canvas in marking mode
        setMarking("a1", true);
        expect(live()).toEqual([false, false, false, false, false]);
        expect(claims("j")).toEqual(["agent:next-j"]);
        expect(claims("k")).toEqual(["agent:prev-k"]);
        setMarking("a1", false);
        expect(live()).toEqual([true, true, true, true, true]);
    });

    it("stands down in the terminal, and while a subagent holds Escape", () => {
        openBrainstormBoard("a1", "Split.dc.html");
        setAgentView("a1", "terminal", 2);
        expect(back().when!(nav)).toBe(false);
        setAgentView("a1", "brainstorm", 3);
        globalStore.set(focusSubagentAtom, { parentId: "a1", agentId: "s" } as any);
        expect(claiming()).toEqual(["subagent:back"]);
    });

    it("agent:back stands down in the brainstorm, as in the canvas, so Escape never means two things", () => {
        const backHome = all().find((b) => b.id === "agent:back")!;
        expect(backHome.when!(nav)).toBe(false);
        setAgentView("a1", "terminal", 2);
        expect(backHome.when!(nav)).toBe(true);
    });
});

describe("diff-surface history bindings", () => {
    const ctx = { surface: "files", editable: false, modalOpen: false } as KeyContext;
    const find = (id: string) => buildFilesBindings().find((b) => b.id === id)!;

    beforeEach(() => {
        globalStore.set(historyFiltersAtom, NO_FILTERS);
        globalStore.set(diffScopeAtom, null);
        globalStore.set(graphOnAtom, true);
    });

    it("toggles the graph on Shift+g — bare 'g' is the leader key", () => {
        const b = find("files:toggle-graph");
        expect(b.keys).toBe("Shift:g");
        expect(b.when?.(ctx)).toBe(true);
        b.run(ctx);
        expect(globalStore.get(graphOnAtom)).toBe(false);
    });

    it("does not claim the graph or filter keys while compare is on", () => {
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(find("files:toggle-graph").when?.(ctx)).toBe(false);
        expect(find("files:filter").when?.(ctx)).toBe(false);
    });

    it("offers clear-filters only when a filter is actually active", () => {
        expect(find("files:clear-filters").when?.(ctx)).toBe(false);
        globalStore.set(historyFiltersAtom, { author: "dana", path: "", text: "" });
        expect(find("files:clear-filters").when?.(ctx)).toBe(true);
    });

    // These two bindings reach for a real element. The suite runs in node with no DOM, so `document`
    // is stubbed per case rather than switching the whole file to jsdom for two lookups.
    afterEach(() => vi.unstubAllGlobals());

    it("passes the filter key through when the field is not on screen", () => {
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:filter").run(ctx)).toBe(false);
    });

    it("scrolls history to the top on the g g chord", () => {
        const container = { scrollTop: 800 };
        vi.stubGlobal("document", { querySelector: () => container });
        globalStore.set(historyScrollAtom, 800);
        const b = find("files:top");
        expect(b.keys).toBe("g g");
        b.run(ctx);
        expect(globalStore.get(historyScrollAtom)).toBe(0);
        expect(container.scrollTop).toBe(0);
    });

    // Unlike the history-only keys above, refresh is scoped to `on` — it must survive into compare,
    // which has no filter row or graph of its own but still shows changes that can go stale.
    it("stays live in compare — refresh is not gated by inHistory/inCompare", () => {
        const b = find("files:refresh");
        expect(b.keys).toBe("r");
        expect(b.when?.(ctx)).toBe(true);
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(b.when?.(ctx)).toBe(true);
    });

    it("c enters compare from history and changes the refs inside compare", () => {
        expect(find("files:compare").when?.(ctx)).toBe(true);
        expect(find("files:change-refs").when?.(ctx)).toBe(false);
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(find("files:compare").when?.(ctx)).toBe(false);
        expect(find("files:change-refs").when?.(ctx)).toBe(true);
        expect(find("files:change-refs").keys).toBe("c");
    });

    // Review Focus 5: with nothing open, or while typing in the history filter, v must reach the page
    it("v declines with no open file and is off while typing or under a modal", () => {
        globalStore.set(activeReviewAtom, null);
        const b = find("files:toggle-reviewed");
        expect(b.keys).toBe("v");
        expect(b.run(ctx)).toBe(false);
        expect(b.when?.(ctx)).toBe(true);
        expect(b.when?.({ ...ctx, editable: true })).toBe(false);
        expect(b.when?.({ ...ctx, modalOpen: true })).toBe(false);
    });

    it("change-refs declines the key when no ref chip is on screen", () => {
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:change-refs").run(ctx)).toBe(false);
    });

    // r's re-reads go to the backend; the mocks above tell which of them ran
    it("r re-reads the changes and history, and in compare the comparison instead of history", () => {
        globalStore.set(filesStateAtom, { cwd: "/repo" } as any);
        globalStore.set(compareRefsAtom, { base: "main", head: "feat" });
        vi.mocked(reloadChanges).mockClear();
        vi.mocked(refreshHistory).mockClear();
        vi.mocked(setCompareRefs).mockClear();
        try {
            find("files:refresh").run(ctx);
            expect(reloadChanges).toHaveBeenLastCalledWith("/repo");
            expect(refreshHistory).toHaveBeenCalledOnce();
            expect(setCompareRefs).not.toHaveBeenCalled();

            globalStore.set(diffScopeAtom, {
                repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
                range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
            });
            find("files:refresh").run(ctx);
            expect(reloadChanges).toHaveBeenCalledTimes(2);
            expect(setCompareRefs).toHaveBeenCalledExactlyOnceWith("/repo", "main", "feat");
            expect(refreshHistory).toHaveBeenCalledOnce();

            // no pair read yet: there is no comparison to re-read
            vi.mocked(setCompareRefs).mockClear();
            globalStore.set(compareRefsAtom, null);
            find("files:refresh").run(ctx);
            expect(setCompareRefs).not.toHaveBeenCalled();
        } finally {
            globalStore.set(compareRefsAtom, null);
            globalStore.set(filesStateAtom, null);
        }
    });

    describe("n / p step the file list", () => {
        // git's order differs from the tree's, so a step that follows `files` would be caught
        const files = ["README.md", "retry/policy.go", "a.go", "retry/budget.go"].map((path) => ({
            path,
            status: "M",
            adds: 1,
            dels: 0,
        }));
        const select = vi.fn();
        const review = (open: string | null, list = files) =>
            globalStore.set(activeReviewAtom, { subject: "/repo|commit:abc", files: list, open, select });

        beforeEach(() => {
            select.mockClear();
            globalStore.set(treeModeAtom, true);
        });
        afterEach(() => {
            globalStore.set(activeReviewAtom, null);
            globalStore.set(treeModeAtom, true);
        });

        it("are the Diff group's Next file / Previous file on bare n and p", () => {
            expect(find("files:next-file")).toMatchObject({ keys: "n", group: "Diff", label: "Next file" });
            expect(find("files:prev-file")).toMatchObject({ keys: "p", group: "Diff", label: "Previous file" });
            expect(find("files:next-file").when?.(ctx)).toBe(true);
            expect(find("files:prev-file").when?.(ctx)).toBe(true);
            // typing in a box, or a modal over the surface, keeps the letters
            expect(find("files:next-file").when?.({ ...ctx, editable: true })).toBe(false);
            expect(find("files:prev-file").when?.({ ...ctx, modalOpen: true })).toBe(false);
        });

        it("open the next and previous file in the order the list draws", () => {
            review("retry/policy.go");
            expect(find("files:next-file").run(ctx)).toBeUndefined();
            expect(select).toHaveBeenLastCalledWith("a.go");
            expect(find("files:prev-file").run(ctx)).toBeUndefined();
            expect(select).toHaveBeenLastCalledWith("retry/budget.go");
        });

        it("follow git's order when the list is flat", () => {
            globalStore.set(treeModeAtom, false);
            review("retry/policy.go");
            find("files:next-file").run(ctx);
            expect(select).toHaveBeenLastCalledWith("a.go");
            find("files:prev-file").run(ctx);
            expect(select).toHaveBeenLastCalledWith("README.md");
        });

        it("decline at the ends without wrapping", () => {
            review("README.md");
            expect(find("files:next-file").run(ctx)).toBe(false);
            review("retry/budget.go");
            expect(find("files:prev-file").run(ctx)).toBe(false);
            expect(select).not.toHaveBeenCalled();
        });

        it("n with nothing open opens the first file; p declines", () => {
            review(null);
            expect(find("files:prev-file").run(ctx)).toBe(false);
            expect(select).not.toHaveBeenCalled();
            expect(find("files:next-file").run(ctx)).toBeUndefined();
            expect(select).toHaveBeenCalledExactlyOnceWith("retry/budget.go");
        });

        it("decline with no file list and with no active review", () => {
            review(null, []);
            expect(find("files:next-file").run(ctx)).toBe(false);
            expect(find("files:prev-file").run(ctx)).toBe(false);
            globalStore.set(activeReviewAtom, null);
            expect(find("files:next-file").run(ctx)).toBe(false);
            expect(find("files:prev-file").run(ctx)).toBe(false);
            expect(select).not.toHaveBeenCalled();
        });

        it("do not mark the file they leave or the one they open", () => {
            review("retry/policy.go");
            const before = globalStore.get(reviewMarksAtom);
            find("files:next-file").run(ctx);
            find("files:prev-file").run(ctx);
            expect(globalStore.get(reviewMarksAtom)).toBe(before);
        });
    });

    // n and p are bare letters: the Files surface must not hand either, nor any other key, to two bindings at once.
    // Compare and a history filter each turn some of the surface's own bindings on, so the check runs in each state.
    describe("no key clash on the Files surface", () => {
        const model = { ...stubModel(), surfaceAtom: {}, paletteOpenAtom: {}, launcherAtom: {} };
        const compare = {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        } as any;
        const clashes = (): string[] => {
            const all = [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildFilesBindings()];
            const out: string[] = [];
            for (const editable of [false, true]) {
                for (const modalOpen of [false, true]) {
                    for (const leader of [null, "g"] as const) {
                        const c = { surface: "files", editable, modalOpen, leader } as KeyContext;
                        const seen = new Map<string, string>();
                        for (const b of all.filter((x) => (x.when ? x.when(c) : true))) {
                            const prev = seen.get(b.keys);
                            if (prev != null) {
                                out.push(
                                    `${b.keys}: ${prev} and ${b.id} (editable=${editable} modal=${modalOpen} leader=${leader})`
                                );
                            }
                            seen.set(b.keys, b.id);
                        }
                    }
                }
            }
            return out;
        };

        afterEach(() => {
            globalStore.set(diffScopeAtom, null);
            globalStore.set(historyFiltersAtom, NO_FILTERS);
        });

        it("gives n and p to the file keys alone", () => {
            globalStore.set(listNavAtom, null);
            expect(clashes()).toEqual([]);
            globalStore.set(diffScopeAtom, compare);
            expect(clashes()).toEqual([]);
            globalStore.set(diffScopeAtom, null);
            globalStore.set(historyFiltersAtom, { author: "dana", path: "", text: "" });
            expect(clashes()).toEqual([]);
        });
    });
});

describe("diff-surface line review send", () => {
    const nav = { surface: "files", editable: false, modalOpen: false, leader: null } as KeyContext;
    const find = (id: string) => buildFilesBindings().find((b) => b.id === id)!;
    const onKey = (keys: string, c: KeyContext = nav) =>
        buildFilesBindings()
            .filter((b) => b.keys === keys && (b.when?.(c) ?? true))
            .map((b) => b.id);
    const comment: LineComment = {
        id: "c1",
        source: "worktree",
        file: "a.ts",
        side: "new",
        startLine: 3,
        endLine: 3,
        quote: ["x"],
        note: "why",
    };
    const withReview = (state: LineReviewState, key = "C:/repo") => {
        globalStore.set(lineReviewsAtom, { [key]: state });
        globalStore.set(activeReviewKeyAtom, "C:/repo");
    };

    afterEach(() => {
        globalStore.set(lineReviewsAtom, {});
        globalStore.set(activeReviewKeyAtom, "");
        vi.unstubAllGlobals();
    });

    it("Ctrl+Enter sends with comments under the active key and no box holding text", () => {
        withReview({ comments: [comment] });
        expect(onKey("Mod:Enter")).toEqual(["files:review-send"]);
        withReview({
            comments: [comment],
            box: { file: "a.ts", side: "new", startLine: 4, endLine: 4, source: "worktree", text: "" },
        });
        expect(onKey("Mod:Enter")).toEqual(["files:review-send"]);
    });

    it("stands down in an editable target, with no comments, with a typed box, or under another key", () => {
        withReview({ comments: [comment] });
        expect(onKey("Mod:Enter", { ...nav, editable: true })).toEqual([]);
        expect(onKey("Mod:Enter", { ...nav, modalOpen: true })).toEqual([]);
        withReview({ comments: [] });
        expect(onKey("Mod:Enter")).toEqual([]);
        withReview({
            comments: [comment],
            box: { file: "a.ts", side: "new", startLine: 4, endLine: 4, source: "worktree", text: "half" },
        });
        expect(onKey("Mod:Enter")).toEqual([]);
        withReview({ comments: [comment] }, "C:/other");
        expect(onKey("Mod:Enter")).toEqual([]);
    });

    it("presses the tray's send button, and lets the key pass when it is missing or disabled", () => {
        withReview({ comments: [comment] });
        const click = vi.fn();
        vi.stubGlobal("document", {
            querySelector: (sel: string) => (sel === "[data-review-send]" ? { click, disabled: false } : null),
        });
        expect(find("files:review-send").run(nav)).not.toBe(false);
        expect(click).toHaveBeenCalledOnce();

        vi.stubGlobal("document", { querySelector: () => ({ click, disabled: true }) });
        expect(find("files:review-send").run(nav)).toBe(false);
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:review-send").run(nav)).toBe(false);
        expect(click).toHaveBeenCalledOnce();
    });
});

describe("command palette chord", () => {
    const build = () => {
        const model = {
            surfaceAtom: atom<SurfaceKey>("cockpit"),
            paletteOpenAtom: atom(false),
        } as any;
        return { model, b: buildGlobalBindings(model).find((x) => x.id === "palette")! };
    };

    it("is Mod+P with no `when`, so nothing else can claim the chord", () => {
        const { b } = build();
        expect(b.keys).toBe("Mod:p");
        // no guard at all: reachable from inside a text field, and an always-matching binding is
        // what stops WebView2's print dialog from taking the key on unhandled surfaces
        expect(b.when).toBeUndefined();
    });

    // one overlay on every surface; on Code it opens on the Files scope (palette-scope initialNav)
    it("opens the same search on Code as everywhere else", () => {
        for (const surface of ["cockpit", "code"] as const) {
            const { model, b } = build();
            b.run(ctx(surface));
            expect(globalStore.get(model.paletteOpenAtom)).toBe(true);
        }
    });

    it("toggles shut on a second press", () => {
        const { model, b } = build();
        b.run(ctx("code"));
        b.run(ctx("code"));
        expect(globalStore.get(model.paletteOpenAtom)).toBe(false);
    });
});

describe("new run chord", () => {
    const build = () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        return { model, b: buildGlobalBindings(model).find((x) => x.id === "new-run")! };
    };

    // reachable from a field and the terminal, as New agent's Mod+N is; Mod+R would take Ctrl+R from the shell
    it("is Mod+Shift+R and opens the launcher at the run door from anywhere but a modal", () => {
        const { model, b } = build();
        expect(b.keys).toBe("Mod:Shift:r");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("run");
    });
});

describe("reopen agent chord", () => {
    // Ctrl+Shift+T, as a browser reopens a closed tab: from a field and the terminal, never over another modal
    it("is Mod+Shift+T and reopens the agent closed last from anywhere but a modal", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "reopen-agent")!;
        expect(b.keys).toBe("Mod:Shift:t");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        vi.mocked(reopenClosedAgent).mockClear();
        b.run(ctx("agent"));
        expect(reopenClosedAgent).toHaveBeenCalledWith(model);
    });
});

describe("open a tool chord", () => {
    const find = (model: any) => buildGlobalBindings(model).find((x) => x.id === "open-tool")!;

    // Ctrl+Shift+O on Windows: from a field and the terminal as New run's Mod+Shift+R is, and never over another modal
    it("is Mod+Shift+O and opens the tool picker for the focused agent from anywhere but a modal", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = find(model);
        expect(b.keys).toBe("Mod:Shift:o");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        vi.mocked(openToolPicker).mockClear();
        b.run(ctx("agent"));
        expect(openToolPicker).toHaveBeenCalledWith(model);
    });

    it("leaves the palette its own Open a tool row, so the action is not listed twice", () => {
        expect(find({ surfaceAtom: atom<SurfaceKey>("agent") } as any).paletteHidden).toBe(true);
    });
});

describe("new council", () => {
    const find = (model: any) => buildGlobalBindings(model).find((x) => x.id === "new-council")!;

    // a council costs 0.5-1.5M tokens: opened by name (the palette row, `wsh ui do new-council`), never by a keystroke
    it("has no chord, so no keypress runs it, and opens the council Setup from anywhere but a modal", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = find(model);
        expect(b.keys).toBe("");
        expect(b.group).toBe("Global");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        vi.mocked(openNewCouncil).mockClear();
        b.run(ctx("agent"));
        expect(openNewCouncil).toHaveBeenCalledWith(model);
    });

    it("is the one binding the palette's Start row stands in for", () => {
        expect(START_DEFS.find((d) => d.id === "council")?.binding).toBe("new-council");
    });
});

describe("new agent chord", () => {
    it("is Mod+N and opens the launcher at the agent door", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "new-agent")!;
        expect(b.keys).toBe("Mod:n");
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("agent");
    });
});

// ⌘M on a Mac, Ctrl+M on Windows: from the cockpit or a float straight into Sprout, as the yellow button does
describe("fold chord", () => {
    it("is Mod+M, works from inside a terminal, and minimizes the way window:minimize says", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "window:fold")!;
        expect(b.keys).toBe("Mod:m");
        expect(b.when?.({ ...ctx("agent"), editable: true }) ?? true).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        vi.mocked(minimizeRequested).mockClear();
        b.run(ctx());
        expect(minimizeRequested).toHaveBeenCalledTimes(1);
    });
});

describe("usage surface bindings", () => {
    const prevTab = vi.fn();
    const nextTab = vi.fn();
    const analyze = vi.fn();
    const bindings = () => buildUsageBindings({ prevTab, nextTab, analyze });
    const find = (id: string) => {
        const b = bindings().find((x) => x.id === id);
        if (b == null) {
            throw new Error(`no binding ${id}`);
        }
        return b;
    };
    const usage = ctx("usage");

    beforeEach(() => {
        prevTab.mockClear();
        nextTab.mockClear();
        analyze.mockClear();
    });

    it("binds the arrows to the provider tabs, `a` to Analyze, and nothing else", () => {
        expect(bindings().map((b) => [b.id, b.keys])).toEqual([
            ["usage:prev-tab", "ArrowLeft"],
            ["usage:next-tab", "ArrowRight"],
            ["usage:analyze", "a"],
        ]);
    });

    // `[` / `]` are the global surface switch; a second claim on them would make assertNoConflicts throw
    it("leaves [ and ] to the global surface switch", () => {
        expect(bindings().some((b) => b.keys === "[" || b.keys === "]")).toBe(false);
    });

    it("runs the handlers", () => {
        find("usage:prev-tab").run(usage);
        find("usage:next-tab").run(usage);
        find("usage:analyze").run(usage);
        expect(prevTab).toHaveBeenCalledTimes(1);
        expect(nextTab).toHaveBeenCalledTimes(1);
        expect(analyze).toHaveBeenCalledTimes(1);
    });

    it("is live only on the Usage surface, outside a field and a modal", () => {
        for (const id of ["usage:prev-tab", "usage:next-tab", "usage:analyze"]) {
            const b = find(id);
            expect(b.when?.(usage)).toBe(true);
            expect(b.when?.(ctx("agent"))).toBe(false);
            expect(b.when?.(ctx("code"))).toBe(false);
            expect(b.when?.({ ...usage, editable: true })).toBe(false);
            expect(b.when?.({ ...usage, modalOpen: true })).toBe(false);
        }
    });
});

describe("code surface bindings", () => {
    const find = (id: string) => {
        const b = buildCodeBindings().find((x) => x.id === id);
        if (b == null) {
            throw new Error(`no binding ${id}`);
        }
        return b;
    };
    const code = ctx("code");

    beforeEach(() => {
        globalStore.set(codeSearchModeAtom, "files");
    });
    afterEach(() => vi.unstubAllGlobals());

    // Files have no chord of their own — the single global "palette" binding opens the search on its
    // Files scope here (see "command palette chord" above), so a chord here would be a second,
    // conflicting claim on the same key.
    it("owns no Mod+P of its own — the global search binding covers files", () => {
        expect(buildCodeBindings().find((b) => b.keys === "Mod:p")).toBeUndefined();
    });

    it("keeps bare-letter refresh out of the editor, while save survives it", () => {
        expect(find("code:refresh").when?.({ ...code, editable: true })).toBe(false);
        expect(find("code:save").when?.({ ...code, editable: true })).toBe(true);
    });

    // The inline name input sits inside the tree, so its focusin bubbles and leaves the tree
    // "focused". Without the !editable gate, Enter here runs tree-activate — it opens the cursor's
    // file and the create/rename never commits.
    it("stands the tree bindings down while the inline name input has focus", () => {
        globalStore.set(codeTreeFocusedAtom, true);
        const typing = { ...code, editable: true };
        for (const id of ["code:tree-activate", "code:new-file", "code:new-folder", "code:rename", "code:delete"]) {
            expect(find(id).when?.(typing), id).toBe(false);
        }
        expect(find("code:tree-activate").when?.(code)).toBe(true);
        globalStore.set(codeTreeFocusedAtom, false);
    });

    it("opens the collapsed sidebar before switching to Search", () => {
        const clicked = vi.fn();
        const focused = vi.fn();
        const opener = { classList: { contains: () => false }, click: clicked, focus: focused };
        vi.stubGlobal("document", { querySelector: vi.fn(() => opener) });
        vi.stubGlobal("window", { requestAnimationFrame: vi.fn() });

        find("code:search").run(code);

        expect(globalStore.get(codeSearchModeAtom)).toBe("search");
        expect(clicked).toHaveBeenCalledOnce();
        expect(focused).toHaveBeenCalledOnce();
    });

    // The pane focuses its input only when it mounts, and nothing remounts it when Search is already
    // the column's mode — so without this the chord from the editor leaves the caret in Monaco.
    it("puts the caret in the search input when Search is already showing", () => {
        const input = { focus: vi.fn(), select: vi.fn() };
        const querySelector = vi.fn((selector: string) => (selector.includes("data-code-search-input") ? input : null));
        vi.stubGlobal("document", { querySelector });
        vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });
        globalStore.set(codeSearchModeAtom, "search");

        find("code:search").run(code);

        expect(input.focus).toHaveBeenCalledOnce();
        expect(input.select).toHaveBeenCalledOnce();
    });

    it("focuses the reachable opener instead of the hidden tree while collapsed", () => {
        const treeFocus = vi.fn();
        const tree = { closest: vi.fn(() => null), focus: treeFocus };
        const openerFocus = vi.fn();
        const opener = { classList: { contains: () => false }, click: vi.fn(), focus: openerFocus };
        const querySelector = vi.fn((selector: string) => (selector.includes("Expand Code sidebar") ? opener : tree));
        vi.stubGlobal("document", { querySelector });
        vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });

        find("code:focus-tree").run(code);

        expect(openerFocus).toHaveBeenCalledOnce();
        expect(treeFocus).toHaveBeenCalledOnce();
    });
});

describe("leader reachability and the fullscreen chord", () => {
    const model = stubModel();
    const inTerm: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
    const inTermLeader: KeyContext = { ...inTerm, leader: "g" };

    it("registers a documentation-only leader:enter binding on the alias chord", () => {
        const b = buildGlobalBindings(model).find((x) => x.id === "leader:enter")!;
        expect(b).toBeDefined();
        expect(b.keys).toBe("Mod:g");
        // documentation only — the matcher performs leader entry, so this must never consume the key
        expect(b.run(inTerm)).toBe(false);
    });

    it("leader:enter is advertised while the terminal holds focus", () => {
        const b = buildGlobalBindings(model).find((x) => x.id === "leader:enter")!;
        expect(b.when?.(inTerm) ?? true).toBe(true);
    });

    it("surface teleports are dormant in the terminal but live under the leader", () => {
        const go = buildGlobalBindings(model).find((x) => x.id === "go:agent")!;
        expect(go.when!(inTerm)).toBe(false);
        expect(go.when!(inTermLeader)).toBe(true);
    });

    it("the details rail is dormant in the terminal but live under the leader", () => {
        const rail = buildAgentBindings(model).find((x) => x.id === "agent:toggle-rail")!;
        expect(rail.when!(inTerm)).toBe(false);
        expect(rail.when!(inTermLeader)).toBe(true);
    });

    it("Escape-keyed navigation stays dormant in BOTH postures (the matcher owns Escape)", () => {
        const back = buildAgentBindings(model).find((x) => x.id === "agent:back")!;
        expect(back.when!(inTerm)).toBe(false);
        expect(back.when!(inTermLeader)).toBe(false);
    });

    it("F11 toggles fullscreen and is live while the terminal holds focus", () => {
        const b = buildAgentBindings(model).find((x) => x.id === "agent:fullscreen-chord")!;
        expect(b.keys).toBe("F11");
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
    });

    it("Mod+Shift+Enter is fullscreen's door on both platforms, live in the terminal like F11", () => {
        const b = buildAgentBindings(model).find((x) => x.id === "agent:fullscreen-mod")!;
        expect(b.keys).toBe("Mod:Shift:Enter");
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
    });

    it("Mod+R redraws the terminal holding the keys, else the focused agent's or terminal's", () => {
        const m = {
            ...stubModel("t1"),
            agentsAtom: atom([{ id: "a1", blockId: "ba" }]),
            terminalsAtom: atom([{ id: "t1", blockId: "bt" }]),
        };
        const b = buildAgentBindings(m).find((x) => x.id === "agent:redraw")!;
        expect(b.keys).toBe("Mod:r");
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
        expect(b.when!({ ...inTerm, modalOpen: true })).toBe(false);
        vi.mocked(redrawTerminal).mockClear();
        b.run(inTerm);
        expect(vi.mocked(redrawTerminal).mock.calls).toEqual([["bt"]]);
        vi.mocked(focusedTerminalBlockId).mockReturnValueOnce("bp");
        b.run(inTerm);
        expect(vi.mocked(redrawTerminal).mock.calls).toEqual([["bt"], ["bp"]]);
        setPlatform("win32");
        try {
            expect(b.when!(inTerm)).toBe(false); // Ctrl+R in the terminal stays the shell's reverse search
            expect(b.when!({ ...inTerm, editable: false })).toBe(true); // outside one it redraws, not reloads
        } finally {
            setPlatform("darwin");
        }
    });

    it("Ctrl+Shift+R redraws from inside the terminal too, on Windows only", () => {
        const m = { ...stubModel("t1"), agentsAtom: atom([]), terminalsAtom: atom([{ id: "t1", blockId: "bt" }]) };
        const b = buildAgentBindings(m).find((x) => x.id === "agent:redraw-shift")!;
        expect(b.keys).toBe("Mod:Shift:r");
        expect(b.when!(inTerm)).toBe(false); // a Mac has ⌘R in the terminal
        setPlatform("win32");
        try {
            expect(b.when!(inTerm)).toBe(true);
            expect(b.when!({ ...inTerm, modalOpen: true })).toBe(false);
            vi.mocked(redrawTerminal).mockClear();
            b.run(inTerm);
            expect(vi.mocked(redrawTerminal).mock.calls).toEqual([["bt"]]);
        } finally {
            setPlatform("darwin");
        }
    });

    it("Mod+` folds or opens the terminal panel, live in the terminal, and only while a terminal is docked", () => {
        const b = buildAgentBindings(model).find((x) => x.id === "agent:terminal-panel")!;
        expect(b.keys).toBe("Mod:c{Backquote}");
        expect(b.label).toBe("Fold or open the terminal panel");
        globalStore.set(dockedTerminalAtom, null);
        expect(b.when!(inTerm)).toBe(false);
        globalStore.set(dockedTerminalAtom, "t1");
        try {
            expect(b.when!(inTerm)).toBe(true);
            expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
            expect(b.when!({ ...inTerm, modalOpen: true })).toBe(false);
            globalStore.set(terminalDockFoldedAtom, false);
            b.run(inTerm);
            expect(globalStore.get(terminalDockFoldedAtom)).toBe(true);
            b.run(inTerm);
            expect(globalStore.get(terminalDockFoldedAtom)).toBe(false);
        } finally {
            globalStore.set(dockedTerminalAtom, null);
        }
    });
});

describe("agent:transcript", () => {
    const inTerm: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
    const modelWith = (focus: string | undefined, agents: any[]) => ({ ...stubModel(focus), agentsAtom: atom(agents) });
    const find = (model: any) => buildAgentBindings(model).find((x) => x.id === "agent:transcript")!;
    const withTranscript = { id: "a1", transcriptPath: "C:/s/a1.jsonl" };

    beforeEach(() => {
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(railVisibleAtom, false);
        globalStore.set(railPanelsAtom, {});
        globalStore.set(railTranscriptFocusAtom, 0);
    });
    afterEach(() => {
        globalStore.set(railVisibleAtom, false);
        globalStore.set(railPanelsAtom, {});
        globalStore.set(railTranscriptFocusAtom, 0);
    });

    it("is Mod+Shift+F, Open the transcript", () => {
        const b = find(modelWith("a1", [withTranscript]));
        expect(b.keys).toBe("Mod:Shift:f");
        expect(b.group).toBe("Agent");
        expect(b.label).toBe("Open the transcript");
    });

    it("is live while the terminal holds focus, on the Agent surface only, and stands down for a modal or the centre's other modes", () => {
        const b = find(modelWith("a1", [withTranscript]));
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, editable: false })).toBe(true);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
        expect(b.when!({ ...inTerm, modalOpen: true })).toBe(false);
        globalStore.set(centerModeAtom, "history");
        expect(b.when!(inTerm)).toBe(false);
    });

    it("opens the rail on the focused agent's Transcript tab and asks the tab for focus", () => {
        const b = find(modelWith("a1", [{ id: "a0" }, withTranscript]));
        expect(b.run(inTerm)).not.toBe(false);
        expect(globalStore.get(railPanelsAtom).a1?.tab).toBe("transcript");
        expect(globalStore.get(railPanelsAtom).a0).toBeUndefined();
        expect(globalStore.get(railVisibleAtom)).toBe(true);
        expect(globalStore.get(railTranscriptFocusAtom)).toBe(1);
        // pressed again with the tab already shown: the rail stays open and the tab is asked again
        b.run(inTerm);
        expect(globalStore.get(railPanelsAtom).a1?.tab).toBe("transcript");
        expect(globalStore.get(railTranscriptFocusAtom)).toBe(2);
    });

    it("lets the key pass when the focused agent has no transcript, or the focus is on no agent", () => {
        expect(find(modelWith("a1", [{ id: "a1" }])).run(inTerm)).toBe(false);
        expect(find(modelWith("a1", [{ id: "a1", transcriptPath: "" }])).run(inTerm)).toBe(false);
        expect(find(modelWith("t1", [withTranscript])).run(inTerm)).toBe(false); // a plain terminal
        expect(find(modelWith(undefined, [withTranscript])).run(inTerm)).toBe(false);
        expect(globalStore.get(railPanelsAtom)).toEqual({});
        expect(globalStore.get(railVisibleAtom)).toBe(false);
        expect(globalStore.get(railTranscriptFocusAtom)).toBe(0);
    });
});

describe("chat mode keys", () => {
    const inTerm: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
    const claude = { id: "a1", blockId: "b1", agent: "claude", transcriptPath: "C:/s/a1.jsonl" };
    const modelWith = (focus: string | undefined, agents: any[]) => ({ ...stubModel(focus), agentsAtom: atom(agents) });
    const find = (model: any, id: string) => buildAgentBindings(model).find((x) => x.id === id)!;
    const mode = () => getChatMode(claude);
    const canvasMode = () => getCanvas("a1")?.mode;

    beforeEach(() => {
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(railVisibleAtom, false);
        globalStore.set(railPanelsAtom, {});
        setChatMode("a1", "chat");
    });
    afterEach(() => {
        detachCanvas("a1");
        syncDocReview("a1", undefined);
        setChatMode("a1", "chat");
        globalStore.set(railVisibleAtom, false);
        globalStore.set(railPanelsAtom, {});
    });

    it("agent:chat-toggle is Mod+Shift+K in the Agent group, live inside the terminal", () => {
        const b = find(modelWith("a1", [claude]), "agent:chat-toggle");
        expect(b.keys).toBe("Mod:Shift:k");
        expect(b.group).toBe("Agent");
        expect(b.label).toBe("Switch the agent between Chat and Terminal");
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, editable: false })).toBe(true);
        expect(b.when!({ ...inTerm, modalOpen: true })).toBe(false);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
        globalStore.set(centerModeAtom, "history");
        expect(b.when!(inTerm)).toBe(false);
    });

    it("agent:chat-toggle flips Chat and Terminal, and shows Chat from a canvas in the terminal's place", () => {
        const b = find(modelWith("a1", [claude]), "agent:chat-toggle");
        expect(mode()).toBe("chat");
        expect(b.run(inTerm)).not.toBe(false);
        expect(mode()).toBe("terminal");
        b.run(inTerm);
        expect(mode()).toBe("chat");
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        setAgentView("a1", "canvas", 1);
        expect(canvasMode()).toBe("canvas");
        b.run(inTerm);
        expect(canvasMode()).toBe("terminal");
        expect(mode()).toBe("chat");
    });

    it("agent:chat-toggle passes the key for an agent that cannot chat, or sleeps", () => {
        const pass = (agents: any[], focus = "a1") =>
            find(modelWith(focus, agents), "agent:chat-toggle").run(inTerm) === false;
        expect(pass([{ ...claude, agent: "codex" }])).toBe(true);
        expect(pass([{ ...claude, kind: "terminal" }])).toBe(true);
        expect(pass([{ ...claude, blockId: undefined }])).toBe(true);
        expect(pass([{ ...claude, sleeping: { since: 1, freedBytes: 0 } }])).toBe(true);
        expect(pass([claude], "t1")).toBe(true); // a plain terminal in focus
        expect(mode()).toBe("chat");
    });

    it("Alt+C walks Chat, Terminal and Canvas for a Claude agent, live with nothing but Chat and Terminal", () => {
        const cycle = find(modelWith("a1", [claude]), "agent:view-cycle");
        expect(cycle.keys).toBe("Alt:c");
        expect(cycle.when!(inTerm)).toBe(true);
        expect(cycle.when!({ ...inTerm, modalOpen: true })).toBe(false);
        cycle.run(inTerm);
        expect(mode()).toBe("terminal");
        cycle.run(inTerm);
        expect(mode()).toBe("chat");
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        cycle.run(inTerm);
        expect([mode(), canvasMode()]).toEqual(["terminal", "terminal"]);
        cycle.run(inTerm);
        expect([mode(), canvasMode()]).toEqual(["terminal", "canvas"]);
        // the canvas leaves the chat mode alone; the walk wraps to Chat
        cycle.run(inTerm);
        expect([mode(), canvasMode()]).toEqual(["chat", "terminal"]);
    });

    it("Alt+C passes the key when the focused agent has one option only", () => {
        const run = (focus: string, agent: any) => find(modelWith(focus, [agent]), "agent:view-cycle").run(inTerm);
        expect(run("a1", { ...claude, agent: "codex" })).toBe(false);
        expect(run("a1", { ...claude, sleeping: { since: 1, freedBytes: 0 } })).toBe(false);
        expect(run("t1", claude)).toBe(false);
    });

    it("Alt+C on a sleeping Claude agent walks Chat and what else its header leaves usable, never Terminal", () => {
        const asleep = { ...claude, sleeping: { since: 1, freedBytes: 0 } };
        const cycle = find(modelWith("a1", [asleep]), "agent:view-cycle");
        // Chat alone: one usable option, so the key passes
        expect(cycle.run(inTerm)).toBe(false);
        // a canvas: the key walks Chat and the canvas, the way back from it included
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        expect(cycle.run(inTerm)).not.toBe(false);
        expect([mode(), canvasMode()]).toEqual(["chat", "canvas"]);
        cycle.run(inTerm);
        expect([mode(), canvasMode()]).toEqual(["chat", "terminal"]);
        // a canvas and a review: the key walks Chat, the two, and back; the stored chat mode stays Chat, so it wakes in Chat
        syncDocReview("a1", docAsk("/r/paper/main.tex"));
        cycle.run(inTerm);
        expect([canvasMode(), getDocReview("a1")!.mode]).toEqual(["canvas", "terminal"]);
        cycle.run(inTerm);
        expect([canvasMode(), getDocReview("a1")!.mode]).toEqual(["terminal", "review"]);
        cycle.run(inTerm);
        expect([canvasMode(), getDocReview("a1")!.mode]).toEqual(["terminal", "terminal"]);
        expect(mode()).toBe("chat");
    });

    it("Mod+Shift+F passes the key while the agent shows Chat, and opens the transcript from Terminal", () => {
        const b = find(modelWith("a1", [claude]), "agent:transcript");
        expect(b.run(inTerm)).toBe(false);
        expect(globalStore.get(railPanelsAtom).a1).toBeUndefined();
        setChatMode("a1", "terminal");
        expect(b.run(inTerm)).not.toBe(false);
        expect(globalStore.get(railPanelsAtom).a1?.tab).toBe("transcript");
    });
});

describe("agent:review", () => {
    const reviewAsk = {
        askId: "a1",
        questions: [{ header: "Spec review", question: "/r/spec.md\n- one", options: [{ label: "Approve" }] }],
    };
    const plainAsk = { askId: "a2", questions: [{ header: "Flake fix", question: "Retry?", options: [] }] };
    const modelFocusing = (id: string) =>
        ({
            focusIdAtom: atom<string>(id),
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([
                { id: "lead", state: "asking", ask: reviewAsk },
                { id: "worker", state: "asking", ask: plainAsk },
                { id: "writer", state: "asking", ask: docAsk("/r/paper/main.tex") },
            ]),
        }) as any;
    const review = (model: any) => buildAgentBindings(model).find((b) => b.id === "agent:review")!;

    afterEach(() => {
        globalStore.set(docReviewAtom, null);
        syncDocReview("writer", undefined);
    });

    it("opens a Doc review as the review view, not the dialog", () => {
        expect(review(modelFocusing("writer")).run(ctx("agent"))).not.toBe(false);
        expect(getDocReview("writer")?.mode).toBe("review");
        expect(globalStore.get(docReviewAtom)).toBeNull();
    });

    it("is r on the Agent surface, off while typing", () => {
        const b = review(modelFocusing("lead"));
        expect(b.keys).toBe("r");
        expect(b.when!(ctx("agent"))).toBe(true);
        expect(b.when!({ ...ctx("agent"), editable: true })).toBe(false);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    it("opens the focused agent's doc review", () => {
        expect(review(modelFocusing("lead")).run(ctx("agent"))).not.toBe(false);
        expect(globalStore.get(docReviewAtom)).toBe("lead");
    });

    it("lets the key pass when the focused agent's ask is not a doc review", () => {
        expect(review(modelFocusing("worker")).run(ctx("agent"))).toBe(false);
        expect(globalStore.get(docReviewAtom)).toBeNull();
    });
});

// remote callers (wsh ui do) must get the user's confirmation for these; the keyboard still runs them directly
describe("destructive bindings", () => {
    it("flags the irreversible actions that do not confirm on their own", () => {
        expect(buildCodeBindings().find((b) => b.id === "code:save")?.destructive).toBe(true);
    });

    it("leaves actions that confirm themselves, or can be undone, unflagged", () => {
        expect(buildCodeBindings().find((b) => b.id === "code:delete")?.destructive).toBeUndefined();
    });
});

describe("agent canvas mode keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const inTerm: KeyContext = { ...nav, editable: true };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;
    const active = (id: string, c: KeyContext = nav) => find(id).when!(c);

    beforeEach(() => {
        model = { ...stubModel("a1"), surfaceAtom: atom<SurfaceKey>("agent") };
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\.superpowers\\design\\t", projectDir: "C:\\p" });
        updateCanvas("a1", (s) => ({
            ...s,
            status: "ready",
            boards: [
                { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 },
                { name: "States.dc.html", x: 0, y: 0, w: 1440, h: 900 },
            ],
        }));
    });

    afterEach(() => {
        detachCanvas("a1");
    });

    it("c opens the canvas from the nav, not with no canvas or from inside the terminal", () => {
        expect(active("agent:canvas-open")).toBe(true);
        expect(active("agent:canvas-open", inTerm)).toBe(false);
        detachCanvas("a1");
        expect(active("agent:canvas-open")).toBe(false);
    });

    it("running c switches the focused agent to canvas mode", () => {
        find("agent:canvas-open").run(nav);
        expect(getCanvas("a1")!.mode).toBe("canvas");
    });

    it("in canvas mode: c, [ ], ← →, m and the agent switches are live; the surface, rail, fullscreen and back keys stand down", () => {
        setCanvasMode("a1", "canvas", 1);
        for (const id of [
            "agent:canvas-close",
            "agent:canvas-prev",
            "agent:canvas-next",
            "agent:canvas-prev-arrow",
            "agent:canvas-next-arrow",
            "agent:mark-start",
            "agent:prev-up",
            "agent:next-down",
            "agent:prev-k",
            "agent:next-j",
            "switcher:next",
            "switcher:prev",
        ]) {
            expect(active(id), id).toBe(true);
        }
        expect(active("agent:canvas-open")).toBe(false);
        expect(active("agent:mark-stop")).toBe(false);
        for (const id of [
            "surface:next",
            "surface:prev",
            "agent:toggle-rail",
            "agent:fullscreen",
            "agent:fullscreen-chord",
            "agent:back",
            // ← → step the boards there, not the agents
            "agent:prev",
            "agent:next",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("← → stay the canvas's while its board is not ready: they do nothing, never move to another agent", () => {
        setCanvasMode("a1", "canvas", 1);
        for (const status of ["probing", "server-down", "removed"] as const) {
            updateCanvas("a1", (s) => ({ ...s, status }));
            expect(active("agent:canvas-next-arrow"), status).toBe(false);
            expect(active("agent:next"), status).toBe(false);
            expect(active("agent:prev"), status).toBe(false);
            expect(active("surface:next"), status).toBe(false);
            // up and down still move between agents
            expect(active("agent:next-down"), status).toBe(true);
        }
    });

    it("the surface switch still works on other surfaces while an agent is in canvas mode", () => {
        setCanvasMode("a1", "canvas", 1);
        expect(active("surface:next", { ...nav, surface: "jarvis" })).toBe(true);
    });

    it("board keys wait for the board to load", () => {
        setCanvasMode("a1", "canvas", 1);
        updateCanvas("a1", (s) => ({ ...s, status: "probing" }));
        expect(active("agent:canvas-next")).toBe(false);
        expect(active("agent:mark-start")).toBe(false);
        expect(active("agent:canvas-close")).toBe(true);
    });

    it("while marking: m stops marking, and the board keys and m-to-mark stand down", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        expect(active("agent:mark-stop")).toBe(true);
        expect(active("agent:mark-start")).toBe(false);
        expect(active("agent:canvas-prev")).toBe(false);
        expect(active("agent:canvas-next")).toBe(false);
        expect(active("agent:canvas-close")).toBe(true);
        // ← → stay off the agents too: one press mid-marking must not leave the board
        expect(active("agent:prev")).toBe(false);
        expect(active("agent:next")).toBe(false);
        expect(active("agent:next-down")).toBe(true);
        find("agent:mark-stop").run(nav);
        expect(getCanvas("a1")!.marking).toBe(false);
    });

    it("] steps to the next board", () => {
        setCanvasMode("a1", "canvas", 1);
        find("agent:canvas-next").run(nav);
        expect(getCanvas("a1")!.board).toBe("States.dc.html");
        find("agent:canvas-prev").run(nav);
        expect(getCanvas("a1")!.board).toBe("Main.dc.html");
    });

    it("c from canvas mode goes back to the terminal", () => {
        setCanvasMode("a1", "canvas", 1);
        find("agent:canvas-close").run(nav);
        expect(getCanvas("a1")!.mode).toBe("terminal");
    });

    describe("Ctrl+Enter sends the marks", () => {
        const MARK = { x: 0, y: 0, w: 20, h: 20, note: "" };
        afterEach(() => vi.unstubAllGlobals());

        it("only while marking with at least one mark", () => {
            setCanvasMode("a1", "canvas", 1);
            expect(active("agent:canvas-send")).toBe(false);
            setMarking("a1", true);
            expect(active("agent:canvas-send")).toBe(false);
            updateCanvas("a1", (s) => ({ ...s, marks: [MARK] }));
            expect(active("agent:canvas-send")).toBe(true);
        });

        it("stays live in a note input, and yields to a modal and other surfaces", () => {
            setCanvasMode("a1", "canvas", 1);
            setMarking("a1", true);
            updateCanvas("a1", (s) => ({ ...s, marks: [MARK] }));
            expect(active("agent:canvas-send", inTerm)).toBe(true);
            expect(active("agent:canvas-send", { ...nav, modalOpen: true })).toBe(false);
            expect(active("agent:canvas-send", { ...nav, surface: "jarvis" })).toBe(false);
        });

        it("clicks the tray's Send button, and lets the key pass with none on screen", () => {
            const click = vi.fn();
            const querySelector = vi.fn((sel: string) => (sel === "[data-canvas-send]" ? { click } : null));
            vi.stubGlobal("document", { querySelector });
            find("agent:canvas-send").run(nav);
            expect(click).toHaveBeenCalledOnce();
            vi.stubGlobal("document", { querySelector: () => null });
            expect(find("agent:canvas-send").run(nav)).toBe(false);
        });
    });

    it("another focused agent without canvas mode keeps its keys", () => {
        setCanvasMode("a1", "canvas", 1);
        globalStore.set(model.focusIdAtom, "a2");
        expect(active("agent:toggle-rail")).toBe(true);
        expect(active("surface:next")).toBe(true);
        expect(active("agent:canvas-close")).toBe(false);
        expect(getCanvas("a1")!.mode).toBe("canvas");
    });
});

describe("agent review mode keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...nav, editable: true };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;
    const active = (id: string, c: KeyContext = nav) => find(id).when!(c);
    const onKey = (keys: string, c: KeyContext = nav) =>
        all()
            .filter((b) => b.keys === keys && (b.when?.(c) ?? true))
            .map((b) => b.id);
    const focusWith = (ask: any) => {
        model = {
            focusIdAtom: atom<string | undefined>("a1") as PrimitiveAtom<string | undefined>,
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([{ id: "a1", name: "paper-writer", state: "asking", ask }]),
        };
        syncDocReview("a1", ask);
    };

    beforeEach(() => focusWith(docAsk("/r/paper/main.tex")));

    afterEach(() => {
        syncDocReview("a1", undefined);
        detachCanvas("a1");
        globalStore.set(docReviewAtom, null);
        vi.unstubAllGlobals();
    });

    it("r resolves to exactly one binding in each mode, and goes both ways", () => {
        expect(onKey("r")).toEqual(["agent:review"]);
        find("agent:review").run(nav);
        expect(getDocReview("a1")!.mode).toBe("review");
        expect(onKey("r")).toEqual(["agent:review-close"]);
        find("agent:review-close").run(nav);
        expect(getDocReview("a1")!.mode).toBe("terminal");
        expect(onKey("r")).toEqual(["agent:review"]);

        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        setAgentView("a1", "canvas", 1);
        expect(onKey("r")).toEqual(["agent:review"]);
        find("agent:review").run(nav);
        expect(getDocReview("a1")!.mode).toBe("review");
        expect(getCanvas("a1")!.mode).toBe("terminal");
        expect(onKey("r")).toEqual(["agent:review-close"]);
    });

    it("in review mode: [ ], c and Ctrl+Enter are the review's; the surface switch, canvas, rail, fullscreen and back keys stand down", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        setAgentView("a1", "review", 1);
        expect(onKey("[")).toEqual(["agent:review-prev"]);
        expect(onKey("]")).toEqual(["agent:review-next"]);
        expect(onKey("c")).toEqual(["agent:review-comment"]);
        expect(onKey("Mod:Enter")).toEqual(["agent:review-approve"]);
        for (const id of ["agent:prev", "agent:next", "agent:prev-k", "agent:next-j"]) {
            expect(active(id), id).toBe(true);
        }
        for (const id of [
            "surface:next",
            "surface:prev",
            "agent:canvas-open",
            "agent:toggle-rail",
            "agent:fullscreen",
            "agent:fullscreen-chord",
            "agent:back",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("[ ] step the LaTeX tabs", () => {
        setAgentView("a1", "review", 1);
        find("agent:review-next").run(nav);
        expect(getDocReview("a1")!.tab).toBe("pdf");
        find("agent:review-prev").run(nav);
        expect(getDocReview("a1")!.tab).toBe("changes");
    });

    it("a markdown note has no tabs: [ ] do nothing, and the surface switch still stands down", () => {
        focusWith(docAsk("/r/notes/next_step.md"));
        setAgentView("a1", "review", 1);
        expect(onKey("[")).toEqual([]);
        expect(onKey("]")).toEqual([]);
        expect(onKey("c")).toEqual(["agent:review-comment"]);
    });

    it("in terminal mode the review keys stand down", () => {
        for (const id of ["agent:review-close", "agent:review-prev", "agent:review-next", "agent:review-comment"]) {
            expect(active(id), id).toBe(false);
        }
        expect(active("agent:review-approve", typing)).toBe(false);
        expect(active("agent:review-request", typing)).toBe(false);
        expect(active("surface:next")).toBe(true);
    });

    it("in canvas mode the review keys stand down and the canvas keeps its own", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        expect(onKey("c")).toEqual(["agent:canvas-open"]);
        find("agent:canvas-open").run(nav);
        expect(getCanvas("a1")!.mode).toBe("canvas");
        expect(getDocReview("a1")!.mode).toBe("terminal");
        expect(onKey("c")).toEqual(["agent:canvas-close"]);
        for (const id of [
            "agent:review-close",
            "agent:review-comment",
            "agent:review-prev",
            "agent:review-approve",
            "agent:review-request",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("c clicks the Comment button, and lets the key pass with none on screen", () => {
        setAgentView("a1", "review", 1);
        const click = vi.fn();
        vi.stubGlobal("document", {
            querySelector: (sel: string) => (sel === "[data-doc-review-comment]" ? { click } : null),
        });
        find("agent:review-comment").run(nav);
        expect(click).toHaveBeenCalledOnce();
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("agent:review-comment").run(nav)).toBe(false);
    });

    it("Ctrl+Enter clicks the accent answer, live in the note input; a draft comment keeps its own Ctrl+Enter", () => {
        setAgentView("a1", "review", 1);
        expect(active("agent:review-approve", typing)).toBe(true);
        expect(active("agent:review-approve", { ...nav, modalOpen: true })).toBe(false);
        expect(active("agent:review-approve", { ...nav, surface: "cockpit" })).toBe(false);

        const click = vi.fn();
        const note = { closest: () => null };
        vi.stubGlobal("document", {
            activeElement: note,
            querySelector: (sel: string) => (sel === "[data-doc-review-send]" ? { click } : null),
        });
        find("agent:review-approve").run(typing);
        expect(click).toHaveBeenCalledOnce();

        const draft = { closest: (sel: string) => (sel === "[data-doc-review-draft]" ? {} : null) };
        vi.stubGlobal("document", { activeElement: draft, querySelector: () => ({ click }) });
        expect(find("agent:review-approve").run(typing)).toBe(false);
        expect(click).toHaveBeenCalledOnce();
    });

    it("Ctrl+Enter is Approve until there is something to send, then Request changes", () => {
        setAgentView("a1", "review", 1);
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
        expect(find("agent:review-approve").label).toBe("Approve");

        setGeneralNote("a1", "tighten §3");
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-request"]);
        expect(find("agent:review-request").label).toBe("Request changes");
        setGeneralNote("a1", "  ");
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);

        const anchor = { sectionIndex: 0, sectionLabel: "§1", paragraph: 1, sentences: [0, 0] as [number, number] };
        addComment("a1", { ...anchor, id: "d", quote: "q", selectedText: "q", note: "", draft: true });
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
        addComment("a1", { ...anchor, id: "s", quote: "q", selectedText: "q", note: "say why", draft: false });
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-request"]);
    });

    it("Ctrl+Enter stands down in History and a session, which hide the review pane without leaving review mode", () => {
        setAgentView("a1", "review", 1);
        try {
            for (const mode of ["history", "session", "canvases"] as const) {
                globalStore.set(centerModeAtom, mode);
                expect(onKey("Mod:Enter", typing)).toEqual([]);
                setGeneralNote("a1", "tighten §3");
                expect(onKey("Mod:Enter", typing)).toEqual([]);
                setGeneralNote("a1", "");
            }
        } finally {
            globalStore.set(centerModeAtom, "terminal");
        }
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
    });
});

describe("final shots viewer bindings", () => {
    afterEach(() => globalStore.set(finalShotsViewerOpenAtom, false));

    function build() {
        const calls: string[] = [];
        const bindings = buildFinalShotsBindings({
            scenario: (d) => calls.push(`scenario ${d}`),
            shot: (d) => calls.push(`shot ${d}`),
            zoom: () => calls.push("zoom"),
            steps: () => calls.push("steps"),
            close: () => calls.push("close"),
        });
        return { bindings, calls };
    }

    it("maps the arrows, z, s and Escape onto their handlers", () => {
        const { bindings, calls } = build();
        const byKey = new Map(bindings.map((b) => [b.keys, b]));
        for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "z", "s", "Escape"]) {
            byKey.get(key)!.run(ctx("jarvis"));
        }
        expect(calls).toEqual(["scenario -1", "scenario 1", "shot -1", "shot 1", "zoom", "steps", "close"]);
        expect(bindings).toHaveLength(7);
    });

    it("is active only while the viewer is open, whatever the context says", () => {
        const { bindings } = build();
        expect(bindings.some((b) => b.when!(ctx("jarvis")))).toBe(false);
        globalStore.set(finalShotsViewerOpenAtom, true);
        expect(bindings.every((b) => b.when!({ ...ctx("jarvis"), modalOpen: true }))).toBe(true);
    });
});

describe("jarvis tour bindings", () => {
    afterEach(() => globalStore.set(tourAtom, null));

    function build() {
        const calls: string[] = [];
        const bindings = buildJarvisTourBindings({
            next: () => calls.push("next"),
            back: () => calls.push("back"),
            close: () => calls.push("close"),
        });
        return { bindings, calls };
    }

    it("maps →, Enter, ← and Escape onto their handlers", () => {
        const { bindings, calls } = build();
        const byKey = new Map(bindings.map((b) => [b.keys, b]));
        for (const key of ["ArrowRight", "Enter", "ArrowLeft", "Escape"]) {
            byKey.get(key)!.run(ctx("jarvis"));
        }
        expect(calls).toEqual(["next", "next", "back", "close"]);
        expect(bindings).toHaveLength(4);
    });

    it("is active only while a tour shows, whatever the context says", () => {
        const { bindings } = build();
        expect(bindings.some((b) => b.when!(ctx("jarvis")))).toBe(false);
        globalStore.set(tourAtom, { track: "brief", index: 0 });
        expect(bindings.every((b) => b.when!({ ...ctx("jarvis"), modalOpen: true }))).toBe(true);
    });
});

describe("Agent centre modes", () => {
    const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...agentCtx, editable: true };
    const find = (id: string, model: any = stubModel()) => buildAgentBindings(model).find((b) => b.id === id)!;
    const CENTER_MODES = ["history", "session", "canvases"] as const;

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(focusSubagentAtom, null);
        detachCanvas("a1");
        syncDocReview("a1", undefined);
    });

    // a1 focused with a ready canvas, still in terminal mode
    const focusedWithCanvas = () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        updateCanvas("a1", (s) => ({
            ...s,
            status: "ready",
            boards: [{ name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 }],
        }));
        return stubModel("a1");
    };

    it("keeps the agent keys live on the terminal and stands them down while History or a session is open", () => {
        const next = find("agent:next-j");
        const rail = find("agent:toggle-rail");
        expect(next.when!(agentCtx)).toBe(true);
        expect(rail.when!(agentCtx)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(next.when!(agentCtx)).toBe(false);
            expect(rail.when!(agentCtx)).toBe(false);
        }
    });

    it("stands the F11 chord down while History or a session is open, and keeps it live in the terminal", () => {
        const f11 = find("agent:fullscreen-chord");
        expect(f11.when!(agentCtx)).toBe(true);
        expect(f11.when!(typing)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(f11.when!(agentCtx)).toBe(false);
            expect(f11.when!(typing)).toBe(false);
        }
    });

    it("stands the canvas send down while History or a session is open, and keeps it live in a note input", () => {
        const model = focusedWithCanvas();
        setAgentView("a1", "canvas", 1);
        setMarking("a1", true);
        updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
        const send = find("agent:canvas-send", model);
        expect(send.when!(typing)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(send.when!(agentCtx)).toBe(false);
            expect(send.when!(typing)).toBe(false);
        }
        globalStore.set(centerModeAtom, "terminal");
        expect(send.when!(typing)).toBe(true);
    });

    it("gives Escape to the terminal while History or a session is open, and to the Cockpit otherwise", () => {
        const back = find("agent:back");
        const leave = find("agent:leave-center");
        expect(leave.keys).toBe("Escape");
        expect(back.when!(agentCtx)).toBe(true);
        expect(leave.when!(agentCtx)).toBe(false);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(back.when!(agentCtx)).toBe(false);
            expect(leave.when!(agentCtx)).toBe(true);
        }
    });

    it("lets a focused subagent's Escape close it before leaving the centre mode", () => {
        vi.stubGlobal("document", { activeElement: null });
        globalStore.set(centerModeAtom, "session");
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        expect(find("agent:leave-center").when!(agentCtx)).toBe(false);
        expect(find("subagent:back").when!(agentCtx)).toBe(true);
    });

    it("leaves Escape inside a text field to the field, and to an open modal", () => {
        globalStore.set(centerModeAtom, "history");
        const leave = find("agent:leave-center");
        expect(leave.when!({ ...agentCtx, editable: true })).toBe(false);
        expect(leave.when!({ ...agentCtx, modalOpen: true })).toBe(false);
        expect(leave.when!(agentCtx)).toBe(true);
    });

    it("still leaves History or a session while the focused agent's canvas or review is on", () => {
        const model = focusedWithCanvas();
        const leave = find("agent:leave-center", model);
        const back = find("agent:back", model);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            setAgentView("a1", "canvas", 1);
            expect(getCanvas("a1")!.mode).toBe("canvas");
            expect(leave.when!(agentCtx)).toBe(true);
            expect(back.when!(agentCtx)).toBe(false);
            syncDocReview("a1", docAsk("/r/paper/main.tex"));
            setAgentView("a1", "review", 2);
            expect(getDocReview("a1")!.mode).toBe("review");
            expect(leave.when!(agentCtx)).toBe(true);
            expect(back.when!(agentCtx)).toBe(false);
            setAgentView("a1", "terminal", 3);
            syncDocReview("a1", undefined);
        }
    });

    it("returns to the terminal when run", () => {
        globalStore.set(centerModeAtom, "history");
        find("agent:leave-center").run(agentCtx);
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
});

describe("g s: Conversation History", () => {
    afterEach(() => globalStore.set(centerModeAtom, "terminal"));

    it("opens History in the Agent surface and leaves g a on the Agent surface itself", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const bindings = buildGlobalBindings(model);
        const history = bindings.find((b) => b.id === "go:history")!;
        expect(history.keys).toBe("g s");
        expect(bindings.find((b) => b.id === "go:agent")!.keys).toBe("g a");
        history.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
});

describe("g v: Canvas gallery", () => {
    afterEach(() => globalStore.set(centerModeAtom, "terminal"));

    it("opens the Canvas gallery in the Agent surface", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const canvases = buildGlobalBindings(model).find((b) => b.id === "go:canvases")!;
        expect(canvases.keys).toBe("g v");
        expect(canvases.label).toBe("Canvas gallery");
        canvases.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(centerModeAtom)).toBe("canvases");
    });
});

describe("Agent → Canvas gallery keys", () => {
    const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...agentCtx, editable: true };
    const find = (id: string) => buildAgentBindings(stubModel()).find((b) => b.id === id)!;
    const galleryNow = () => globalStore.get(canvasGalleryAtom);
    const gallery = (patch: Partial<ReturnType<typeof galleryNow>>) =>
        globalStore.set(canvasGalleryAtom, { ...galleryNow(), ...patch });
    const FRESH = { view: "grid", dir: null, board: 0, query: "", cursor: 0 } as const;
    const canvas = (topic: string, modts: number, boards: string[]): GalleryCanvas => ({
        topic,
        project: "/p",
        projectname: "p",
        designdir: "/p/.superpowers/design",
        dir: `/p/.superpowers/design/${topic}`,
        boards,
        modts,
        thumbts: 0,
        bytes: 1,
        createdts: modts,
    });
    const DAY = 24 * 60 * 60 * 1000;
    const GRID_KEYS = [
        "canvases:left",
        "canvases:right",
        "canvases:up",
        "canvases:down",
        "canvases:open",
        "canvases:search",
    ];
    const VIEWER_KEYS = [
        "canvases:prev-board",
        "canvases:next-board",
        "canvases:prev-board-bracket",
        "canvases:next-board-bracket",
        "canvases:back",
    ];
    const CLEANUP_KEYS = [
        "canvases:cleanup-left",
        "canvases:cleanup-right",
        "canvases:cleanup-up",
        "canvases:cleanup-down",
        "canvases:tick",
        "canvases:cleanup-cancel",
    ];
    const SCAN_KEYS = ["canvases:scan-cancel"];
    const live = (ids: string[]) => ids.map((id) => find(id).when!(agentCtx));
    // the Escape bindings of the Agent surface (and the global ones) that claim the key right now
    const escapes = () =>
        [...buildGlobalBindings(stubModel()), ...buildAgentBindings(stubModel())]
            .filter((b) => b.keys === "Escape" && b.when?.(agentCtx) === true)
            .map((b) => b.id);

    beforeEach(() => {
        globalStore.set(centerModeAtom, "canvases");
        globalStore.set(canvasGalleryAtom, FRESH);
        // two today, one long ago: the cursor walks across the group edge
        globalStore.set(canvasListAtom, [
            canvas("alpha", Date.now(), ["Main", "States"]),
            canvas("beta", Date.now(), ["Main"]),
            canvas("old", Date.now() - 40 * DAY, ["Main"]),
        ]);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(canvasGalleryAtom, FRESH);
        globalStore.set(canvasListAtom, null);
    });

    it("is live only while the centre mode is canvases, on the Agent surface, outside a field", () => {
        const right = find("canvases:right");
        expect(right.when!(agentCtx)).toBe(true);
        expect(right.when!(typing)).toBe(false);
        expect(right.when!({ ...agentCtx, modalOpen: true })).toBe(false);
        expect(right.when!({ ...agentCtx, surface: "jarvis" })).toBe(false);
        for (const mode of ["terminal", "history", "session"] as const) {
            globalStore.set(centerModeAtom, mode);
            expect(right.when!(agentCtx)).toBe(false);
        }
    });

    it("gives the grid its arrows, Enter and /, and the viewer its arrows, brackets and Escape", () => {
        expect(live(GRID_KEYS)).toEqual(GRID_KEYS.map(() => true));
        expect(live(VIEWER_KEYS)).toEqual(VIEWER_KEYS.map(() => false));
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha" });
        expect(live(GRID_KEYS)).toEqual(GRID_KEYS.map(() => false));
        expect(live(VIEWER_KEYS)).toEqual(VIEWER_KEYS.map(() => true));
        // the clean-up mode brings its own keys with it
        gallery({ view: "cleanup", dir: null });
        expect(live([...GRID_KEYS, ...VIEWER_KEYS])).toEqual([...GRID_KEYS, ...VIEWER_KEYS].map(() => false));
        expect(live(CLEANUP_KEYS)).toEqual(CLEANUP_KEYS.map(() => true));
        gallery({ view: "grid" });
        expect(live(CLEANUP_KEYS)).toEqual(CLEANUP_KEYS.map(() => false));
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha" });
        expect(live(CLEANUP_KEYS)).toEqual(CLEANUP_KEYS.map(() => false));
    });

    it("gives the version scan's review its Escape and takes every other view's keys away", () => {
        gallery({ view: "scan", dir: null });
        expect(live(SCAN_KEYS)).toEqual([true]);
        expect(live([...GRID_KEYS, ...VIEWER_KEYS, ...CLEANUP_KEYS])).toEqual(
            [...GRID_KEYS, ...VIEWER_KEYS, ...CLEANUP_KEYS].map(() => false)
        );
        for (const view of ["grid", "viewer", "cleanup"] as const) {
            gallery({ view, dir: "/p/.superpowers/design/alpha" });
            expect(live(SCAN_KEYS)).toEqual([false]);
        }
        // not while a text field has focus: the Escape there is the field's own
        gallery({ view: "scan", dir: null });
        expect(find("canvases:scan-cancel").when!(typing)).toBe(false);
    });

    it("lets exactly one Escape claim the key in the viewer and in the scan's review, never the one that leaves the centre", () => {
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha" });
        expect(escapes()).toEqual(["canvases:back"]);
        gallery({ view: "scan", dir: null });
        expect(escapes()).toEqual(["canvases:scan-cancel"]);
        gallery({ view: "grid", dir: null });
        expect(escapes()).toEqual(["agent:leave-center"]);
    });

    it("cancels the scan's review on Escape: back to the grid, nothing ticked", () => {
        gallery({ view: "scan", dir: null, cursor: 2 });
        globalStore.set(scanAtom, { pairs: [], ticked: new Set(["/p/.superpowers/design/alpha"]), linking: false });
        find("canvases:scan-cancel").run(agentCtx);
        expect(galleryNow()).toMatchObject({ view: "grid", dir: null, cursor: 0 });
        expect(globalStore.get(scanAtom).ticked).toEqual(new Set());
    });

    it("closes the link picker on the first Escape in a canvas, and leaves the canvas on the second", () => {
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha", cursor: 0 });
        openLinkPicker();
        find("canvases:back").run(agentCtx);
        expect(globalStore.get(linkPickerAtom).open).toBe(false);
        expect(galleryNow()).toMatchObject({ view: "viewer", dir: "/p/.superpowers/design/alpha" });
        find("canvases:back").run(agentCtx);
        expect(galleryNow()).toMatchObject({ view: "grid", dir: null });
    });

    describe("in clean up", () => {
        // newest first inside a group: old is the only suggested canvas, so the drawn order is old, beta, alpha
        const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
        const sel = () => globalStore.get(cleanupAtom).selected;

        beforeEach(() => {
            globalStore.set(canvasListAtom, [
                canvas("alpha", NOW - 2 * 60 * 60 * 1000, ["Main"]),
                canvas("beta", NOW - 60 * 60 * 1000, ["Main"]),
                canvas("old", NOW - 40 * DAY, ["Main"]),
            ]);
            startCleanup(NOW);
        });

        afterEach(() => {
            globalStore.set(cleanupAtom, { selected: new Set<string>(), now: 0, skipped: {}, moving: false });
        });

        it("starts on the suggested canvas, ticked", () => {
            expect(galleryNow()).toMatchObject({ view: "cleanup", cursor: 0 });
            expect(sel()).toEqual(new Set(["/p/.superpowers/design/old"]));
        });

        it("walks the suggested group and then Newer with the arrows, clamping at the ends", () => {
            const at = () => galleryNow().cursor;
            find("canvases:cleanup-right").run(agentCtx);
            expect(at()).toBe(1);
            find("canvases:cleanup-down").run(agentCtx);
            expect(at()).toBe(2);
            find("canvases:cleanup-down").run(agentCtx);
            expect(at()).toBe(2);
            find("canvases:cleanup-up").run(agentCtx);
            expect(at()).toBe(1);
            find("canvases:cleanup-left").run(agentCtx);
            expect(at()).toBe(0);
            find("canvases:cleanup-left").run(agentCtx);
            expect(at()).toBe(0);
        });

        it("ticks and unticks the card under the cursor with Space", () => {
            find("canvases:tick").run(agentCtx);
            expect(sel()).toEqual(new Set());
            find("canvases:tick").run(agentCtx);
            expect(sel()).toEqual(new Set(["/p/.superpowers/design/old"]));
            find("canvases:cleanup-right").run(agentCtx);
            find("canvases:tick").run(agentCtx);
            expect(sel()).toEqual(new Set(["/p/.superpowers/design/old", "/p/.superpowers/design/beta"]));
        });

        it("lets Space pass when there is no card, and does not tick while a move is under way", () => {
            globalStore.set(cleanupAtom, { ...globalStore.get(cleanupAtom), moving: true });
            find("canvases:tick").run(agentCtx);
            expect(sel()).toEqual(new Set(["/p/.superpowers/design/old"]));
            globalStore.set(canvasListAtom, []);
            expect(find("canvases:tick").run(agentCtx)).toBe(false);
        });

        it("cancels back to the grid on Escape and forgets the ticks", () => {
            find("canvases:cleanup-down").run(agentCtx);
            find("canvases:cleanup-cancel").run(agentCtx);
            expect(galleryNow()).toMatchObject({ view: "grid", dir: null, cursor: 0 });
            expect(sel()).toEqual(new Set());
        });
    });

    it("hides the brackets from the palette and labels the keys", () => {
        expect(find("canvases:prev-board-bracket").keys).toBe("[");
        expect(find("canvases:next-board-bracket").keys).toBe("]");
        for (const id of [...GRID_KEYS, ...VIEWER_KEYS, ...CLEANUP_KEYS]) {
            expect(find(id).paletteHidden).toBe(true);
            expect(find(id).label).not.toBe("");
        }
        expect(find("canvases:tick").keys).toBe("Space");
        expect(find("canvases:prev-board").label).toBe("Previous board");
        expect(find("canvases:right").label).toBe("Next canvas");
    });

    it("moves the card cursor over the cards in drawn order and clamps at the ends", () => {
        const at = () => galleryNow().cursor;
        find("canvases:down").run(agentCtx);
        expect(at()).toBe(1);
        find("canvases:down").run(agentCtx);
        expect(at()).toBe(2);
        find("canvases:down").run(agentCtx);
        expect(at()).toBe(2);
        find("canvases:left").run(agentCtx);
        expect(at()).toBe(1);
        find("canvases:up").run(agentCtx);
        expect(at()).toBe(0);
        find("canvases:up").run(agentCtx);
        expect(at()).toBe(0);
    });

    it("moves the cursor over what the search leaves", () => {
        gallery({ query: "old", cursor: 0 });
        find("canvases:right").run(agentCtx);
        expect(galleryNow().cursor).toBe(0);
    });

    it("opens the card under the cursor, and lets Enter pass on an empty grid", () => {
        gallery({ cursor: 1 });
        find("canvases:open").run(agentCtx);
        expect(galleryNow()).toMatchObject({ view: "viewer", dir: "/p/.superpowers/design/beta", board: 0, cursor: 1 });
        gallery({ view: "grid", dir: null, query: "no such canvas" });
        expect(find("canvases:open").run(agentCtx)).toBe(false);
        expect(galleryNow().view).toBe("grid");
    });

    it("steps the open canvas' boards round the ends and goes back to the grid", () => {
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha", board: 0, cursor: 0 });
        find("canvases:next-board").run(agentCtx);
        expect(galleryNow().board).toBe(1);
        find("canvases:next-board-bracket").run(agentCtx);
        expect(galleryNow().board).toBe(0);
        find("canvases:prev-board").run(agentCtx);
        expect(galleryNow().board).toBe(1);
        find("canvases:back").run(agentCtx);
        expect(galleryNow()).toMatchObject({ view: "grid", dir: null, cursor: 0 });
    });

    it("lets / pass when no search box is on screen, and focuses the box when there is one", () => {
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("canvases:search").run(agentCtx)).toBe(false);
        const input = { focus: vi.fn(), select: vi.fn() };
        vi.stubGlobal("document", { querySelector: vi.fn(() => input) });
        find("canvases:search").run(agentCtx);
        expect(input.focus).toHaveBeenCalled();
        expect(input.select).toHaveBeenCalled();
    });

    it("keeps the surface switch's [ ] for the grid and gives them to the viewer", () => {
        const next = buildGlobalBindings(stubModel()).find((b) => b.id === "surface:next")!;
        expect(next.when!(agentCtx)).toBe(true);
        gallery({ view: "viewer", dir: "/p/.superpowers/design/alpha" });
        expect(next.when!(agentCtx)).toBe(false);
        // another surface is unaffected
        expect(next.when!({ ...agentCtx, surface: "jarvis" })).toBe(true);
    });
});

describe("Agent → project Overview keys", () => {
    const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const find = (id: string) => buildAgentBindings(stubModel()).find((b) => b.id === id)!;

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(centerModeAtom, "terminal");
    });

    it("claims / only in the project centre mode, and not while a field has focus", () => {
        const search = find("overview:search");
        expect(search.keys).toBe("/");
        expect(search.when!(agentCtx)).toBe(false);
        globalStore.set(centerModeAtom, "project");
        expect(search.when!(agentCtx)).toBe(true);
        expect(search.when!({ ...agentCtx, editable: true })).toBe(false);
        expect(search.when!({ ...agentCtx, surface: "jarvis" })).toBe(false);
        // the gallery's / is its own: the two never share the key
        expect(find("canvases:search").when!(agentCtx)).toBe(false);
        globalStore.set(centerModeAtom, "canvases");
        expect(search.when!(agentCtx)).toBe(false);
    });

    it("lets / pass when History is not drawn, and focuses the box when it is", () => {
        const search = find("overview:search");
        vi.stubGlobal("document", { querySelector: () => null });
        expect(search.run(agentCtx)).toBe(false);
        const input = { focus: vi.fn() };
        const querySelector = vi.fn(() => input);
        vi.stubGlobal("document", { querySelector });
        search.run(agentCtx);
        expect(querySelector).toHaveBeenCalledWith("[data-history-search]");
        expect(input.focus).toHaveBeenCalled();
    });
});

describe("g w: what's waiting", () => {
    afterEach(() => globalStore.set(petPeekOpenAtom, false));

    // the creature's peek is otherwise reached only by a click or by tabbing to the sprite
    it("opens the creature's peek from any surface, and from inside the terminal through the leader", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:waiting")!;
        expect(b.keys).toBe("g w");
        expect(b.when?.(ctx("agent"))).toBe(true);
        expect(b.when?.({ ...ctx("agent"), editable: true, leader: "g" })).toBe(true);
        b.run(ctx("agent"));
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("stays out of the way of an open modal, the peek included", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:waiting")!;
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
    });
});

// ⌘J: the same peek in one chord
describe("jarvis:peek", () => {
    afterEach(() => {
        globalStore.set(petPeekOpenAtom, false);
        setPlatform("darwin");
    });
    const find = () =>
        buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("agent") } as any).find((x) => x.id === "jarvis:peek")!;

    it("is Mod+J and opens the creature's peek, from inside the terminal too", () => {
        const b = find();
        expect(b.keys).toBe("Mod:j");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        b.run(ctx("agent"));
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    // Ctrl+J is the terminal's newline, but Shift+Enter sends the same one, so on Windows the peek takes it there too
    it("is Ctrl+J on Windows, live in a terminal, with no second key", () => {
        setPlatform("win32");
        const all = buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("agent") } as any);
        expect(all.find((x) => x.id === "jarvis:peek")!.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(all.find((x) => x.id === "jarvis:peek:ctrl")).toBeUndefined();
    });
});

describe("agent:done-close", () => {
    const doneModel = (agent: Record<string, unknown>): any => ({
        focusIdAtom: atom<string | undefined>("a1") as PrimitiveAtom<string | undefined>,
        agentsAtom: atom([{ id: "a1", name: "worker", ...agent }]),
        lineageAtom: atom({ runs: {}, roles: {} }),
    });
    const press = (model: any) =>
        buildAgentBindings(model)
            .find((b) => b.id === "agent:done-close")!
            .run(ctx("agent"));

    beforeEach(() => {
        globalStore.set(centerModeAtom, "terminal");
        vi.mocked(confirmCloseSession).mockClear();
    });

    it("is Alt+W on the Agent surface, live inside the terminal", () => {
        const b = buildAgentBindings(doneModel({})).find((x) => x.id === "agent:done-close")!;
        expect(b.keys).toBe("Alt:w");
        expect(b.when!({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    it("closes the focused agent when its header offers Done", () => {
        const model = doneModel({ state: "idle", committed: true });
        expect(press(model)).not.toBe(false);
        expect(confirmCloseSession).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), model, "Alt+W");
    });

    it("passes the key to the terminal when nothing is offered", () => {
        expect(press(doneModel({ state: "working", committed: true }))).toBe(false);
        expect(press(doneModel({ state: "idle" }))).toBe(false);
        expect(confirmCloseSession).not.toHaveBeenCalled();
    });
});

// The avatar popup handles its own keys on the panel, but the dispatcher runs on window capture and stops any
// key it claims, so a surface binding live under the popup would take the key from it.
describe("the open avatar popup keeps its keys on every surface", () => {
    const POPUP_KEYS = ["j", "k", "ArrowDown", "ArrowUp", "Enter", " ", "/", "Escape", "Backspace"];
    const key = (k: string) =>
        ({ key: k, code: "", control: false, shift: false, cmd: false, option: false, meta: false, alt: false }) as any;

    afterEach(() => globalStore.set(petPeekOpenAtom, false));

    it("lists only keys the popup acts on", () => {
        for (const k of POPUP_KEYS) {
            expect(peekKeyCommand(k) ?? itemKeyCommand(k), k).not.toBeNull();
        }
    });

    it("leaves every popup key unclaimed, from the panel and from its composer", () => {
        const model = stubModel("agent-tab");
        const all = [
            ...buildGlobalBindings(model),
            ...buildListNavBindings(model),
            ...buildCockpitBindings(),
            ...buildAgentBindings(model),
            ...buildFilesBindings(),
            ...buildCodeBindings(),
            ...buildJarvisBindings(model),
            ...buildChannelsAskBindings(model, { current: { id: "agent-tab" } as any }),
        ];
        globalStore.set(petPeekOpenAtom, true);
        const claimed: string[] = [];
        for (const surface of SURFACE_ORDER) {
            for (const editable of [false, true]) {
                for (const k of POPUP_KEYS) {
                    const result = matchBinding(key(k), { surface, editable, modalOpen: true, leader: null }, all);
                    if (result.kind === "run") {
                        claimed.push(
                            `${surface} ${editable ? "composer" : "panel"} ${JSON.stringify(k)}: ${result.binding.id}`
                        );
                    }
                }
            }
        }
        expect(claimed).toEqual([]);
    });
});

describe("agent:initiative", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const key = (k: string) =>
        ({ key: k, code: "", control: false, shift: false, cmd: false, option: false, meta: false, alt: false }) as any;
    const agent = (id: string, effortId?: string) => ({ id, kind: "agent", state: "idle", effortId });
    const modelWith = (focus: string, agents: any[]) =>
        ({
            focusIdAtom: atom<string | undefined>(focus),
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom(agents),
        }) as any;
    const bindings = (model: any) => [...buildGlobalBindings(model), ...buildAgentBindings(model)];
    const find = (model: any, id: string) => bindings(model).find((b) => b.id === id)!;

    beforeEach(() => vi.stubGlobal("document", { activeElement: null, querySelector: () => null }));
    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(initiativePopoverAtom, null);
        globalStore.set(bandOpenAtom, []);
    });

    it("is i on the Agent surface, in navigate posture", () => {
        const b = find(modelWith("a1", [agent("a1", "e1")]), "agent:initiative");
        expect(b.keys).toBe("i");
        expect(b.when!(nav)).toBe(true);
        expect(b.when!({ ...nav, editable: true })).toBe(false); // typing in the terminal or a field
        expect(b.when!({ ...nav, modalOpen: true })).toBe(false);
        expect(b.when!({ ...nav, surface: "cockpit" })).toBe(false);
    });

    it("opens the popover for the focused agent that has an initiative", () => {
        const model = modelWith("a2", [agent("a1", "e1"), agent("a2", "e2")]);
        expect(find(model, "agent:initiative").run(nav)).not.toBe(false);
        expect(globalStore.get(initiativePopoverAtom)).toBe("a2");
    });

    it("toggles the band, not the popover, when the focused agent's band is on screen (Chat)", () => {
        const model = modelWith("a2", [agent("a1", "e1"), agent("a2", "e2")]);
        const seen: string[] = [];
        vi.stubGlobal("document", {
            activeElement: null,
            querySelector: (sel: string) => {
                seen.push(sel);
                return sel === '[data-initiative-band="a2"]' ? {} : null;
            },
        });
        const b = find(model, "agent:initiative");
        expect(b.run(nav)).not.toBe(false);
        expect(seen).toContain('[data-initiative-band="a2"]');
        expect(globalStore.get(bandOpenAtom)).toEqual(["a2"]);
        expect(globalStore.get(initiativePopoverAtom)).toBeNull();
        // i again collapses it
        expect(b.run(nav)).not.toBe(false);
        expect(globalStore.get(bandOpenAtom)).toEqual([]);
        expect(globalStore.get(initiativePopoverAtom)).toBeNull();
    });

    it("opens the popover when only another agent's band is on screen (a linked agent in Terminal)", () => {
        const model = modelWith("a1", [agent("a1", "e1"), agent("a2", "e2")]);
        vi.stubGlobal("document", {
            activeElement: null,
            querySelector: (sel: string) => (sel === '[data-initiative-band="a2"]' ? {} : null),
        });
        expect(find(model, "agent:initiative").run(nav)).not.toBe(false);
        expect(globalStore.get(bandOpenAtom)).toEqual([]);
        expect(globalStore.get(initiativePopoverAtom)).toBe("a1");
    });

    it("opens the Link to initiative picker for an agent with none, else lets the key pass", () => {
        const model = modelWith("a1", [agent("a1")]);
        expect(find(model, "agent:initiative").run(nav)).toBe(false); // no chip on screen
        expect(globalStore.get(initiativeLinkPickerAtom)).toBeNull();
        // the header's chip (Chat's lean header and Terminal's both carry it) opens the one picker
        const seen: string[] = [];
        vi.stubGlobal("document", {
            activeElement: null,
            querySelector: (sel: string) => {
                seen.push(sel);
                return {};
            },
        });
        expect(find(model, "agent:initiative").run(nav)).not.toBe(false);
        expect(seen).toEqual(["[data-initiative-link]"]);
        expect(globalStore.get(initiativeLinkPickerAtom)).toBe("a1");
        expect(globalStore.get(initiativePopoverAtom)).toBeNull();
        expect(globalStore.get(bandOpenAtom)).toEqual([]);
        globalStore.set(initiativeLinkPickerAtom, null);
    });

    it("lets the key pass when the focus is on no agent (a plain terminal)", () => {
        expect(find(modelWith("t1", [agent("a1", "e1")]), "agent:initiative").run(nav)).toBe(false);
        expect(globalStore.get(initiativePopoverAtom)).toBeNull();
    });

    it("yields while the popover is open, and so does every other single-key Agent binding", () => {
        const model = modelWith("a1", [agent("a1", "e1")]);
        const ids = [
            "agent:initiative",
            "agent:prev-up",
            "agent:next-down",
            "agent:prev-k",
            "agent:next-j",
            "agent:toggle-rail",
            "agent:fullscreen",
            "agent:back",
        ];
        for (const id of ids) {
            expect(find(model, id).when!(nav), `${id} before`).toBe(true);
        }
        globalStore.set(initiativePopoverAtom, "a1");
        for (const id of ids) {
            expect(find(model, id).when!(nav), `${id} while open`).toBe(false);
        }
    });

    it("leaves the popover's keys unclaimed while it is open: m, n, i, the arrows, Enter, Escape", () => {
        const model = modelWith("a1", [agent("a1", "e1")]);
        globalStore.set(initiativePopoverAtom, "a1");
        const claimed: string[] = [];
        for (const k of ["m", "n", "i", "ArrowUp", "ArrowDown", "Enter", "Escape"]) {
            const result = matchBinding(key(k), nav, bindings(model));
            if (result.kind === "run") {
                claimed.push(`${k}: ${result.binding.id}`);
            }
        }
        expect(claimed).toEqual([]);
    });
});

describe("review mode on the Jarvis surface", () => {
    const nav: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    const key = (k: string) =>
        ({ key: k, code: "", control: false, shift: false, cmd: false, option: false, meta: false, alt: false }) as any;
    const model = stubModel("a1");
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildJarvisBindings(model)];
    const claim = (k: string, on: KeyContext = nav) => {
        const r = matchBinding(key(k), on, all());
        return r.kind === "run" ? r.binding.id : null;
    };
    const controller = (surface: SurfaceKey) =>
        globalStore.set(listNavAtom, { surface, navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });

    beforeEach(() => {
        controller("jarvis");
        // the Diff surface's compare posture, which an earlier suite can leave on, also holds Escape back
        globalStore.set(diffScopeAtom, null);
        globalStore.set(reviewedAtom, {});
        globalStore.set(reviewQueueAtom, []);
    });
    afterEach(() => {
        exitReview();
        globalStore.set(listNavAtom, null);
    });

    it("hands j, k and Enter to the list while no review is on", () => {
        expect(claim("j")).toBe("list:next-j");
        expect(claim("k")).toBe("list:prev-k");
        expect(claim("Enter")).toBe("list:activate");
        expect(claim("ArrowRight")).toBeNull();
        expect(claim("Escape")).toBe("surface:back-home");
    });

    it("hands them to the review while one is on, and Escape leaves it before it goes home", () => {
        enterReview(["a", "b"], 100);
        expect(claim("j")).toBe("jarvis:review-next-j");
        expect(claim("k")).toBe("jarvis:review-prev-k");
        expect(claim("Enter")).toBe("jarvis:review-mark");
        expect(claim("ArrowRight")).toBe("jarvis:review-next");
        expect(claim("ArrowLeft")).toBe("jarvis:review-prev");
        expect(claim("Escape")).toBe("jarvis:review-exit");
        // the list's own arrows and Space are not the review's to hold: only j, k and Enter change hands
        expect(claim("ArrowDown")).toBeNull();
    });

    it("leaves the review's keys alone on every other surface and in a field", () => {
        enterReview(["a", "b"], 100);
        controller("usage");
        expect(claim("j", { ...nav, surface: "usage" })).toBe("list:next-j");
        expect(claim("Enter", { ...nav, surface: "usage" })).toBe("list:activate");
        expect(claim("Escape", { ...nav, surface: "usage" })).toBe("surface:back-home");
        expect(claim("j", { ...nav, editable: true })).toBeNull();
        expect(claim("Enter", { ...nav, editable: true })).toBeNull();
    });

    it("steps with the arrows and j/k around the pass, and Enter marks the one it is on and moves on", () => {
        enterReview(["a", "b", "c"], 100);
        const run = (id: string) => buildJarvisBindings(model).find((b) => b.id === id)!.run(nav);
        const cursor = () => globalStore.get(reviewModeAtom)?.cursor;
        run("jarvis:review-next");
        expect(cursor()).toBe("b");
        run("jarvis:review-prev-k");
        run("jarvis:review-prev");
        expect(cursor()).toBe("c");
        run("jarvis:review-next-j");
        expect(cursor()).toBe("a");
        vi.spyOn(Date, "now").mockReturnValue(150);
        run("jarvis:review-mark");
        expect(globalStore.get(reviewedAtom)).toEqual({ a: 150 });
        expect(cursor()).toBe("b");
        vi.restoreAllMocks();
    });

    it("v begins a pass over the queue the Brief published, and passes when there is none", () => {
        const v = () => buildJarvisBindings(model).find((b) => b.id === "jarvis:review")!;
        expect(v().keys).toBe("v");
        expect(v().when!(nav)).toBe(true);
        expect(v().run(nav)).toBe(false);
        expect(globalStore.get(reviewModeAtom)).toBeNull();
        globalStore.set(reviewQueueAtom, ["x", "y"]);
        expect(v().run(nav)).not.toBe(false);
        expect(globalStore.get(reviewModeAtom)).toMatchObject({ cursor: "x", orefs: ["x", "y"] });
        // under a pass it is not the key to begin another
        expect(v().when!(nav)).toBe(false);
    });
});

describe("brainstorm check review keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...nav, editable: true };
    const REVIEW_KEYS = [
        "agent:brainstorm-review-next",
        "agent:brainstorm-review-prev",
        "agent:brainstorm-review-open",
        "agent:brainstorm-review-keep",
        "agent:brainstorm-review-restore",
    ];
    // one change waiting on keep or put back, one new guess, one decision left as it was
    const checked: BrainstormFile = {
        v: 1,
        title: "Forecast",
        spec: "docs/spec.md",
        question: null,
        working: null,
        parts: [
            {
                id: "grain",
                title: "Forecast grain",
                state: "guess",
                was: "Daily, for every field.",
                body: "Daily event_count.",
                why: "builder question 1",
            },
            { id: "torch", title: "The move to PyTorch", state: "guess", body: "A shared torch base." },
            { id: "intent", title: "Intent and why", state: "yours", body: "Why it exists." },
        ],
        history: [],
        done: true,
        check: {
            yours: [{ q: "What should the forecast act on?", a: "event_count", into: ["grain"] }],
            calls: [],
            answered: [],
            touched: ["grain"],
        },
        run: null,
    };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;
    const active = (id: string, c: KeyContext = nav) => find(id).when!(c);
    const claiming = (key: string, c: KeyContext = nav) =>
        all()
            .filter((b) => b.keys === key && b.when?.(c) !== false)
            .map((b) => b.id);
    const withFile = (file: BrainstormFile) => updateBrainstorm("a1", (s) => ({ ...s, file }));

    beforeEach(() => {
        vi.mocked(sendBrainstorm).mockClear();
        vi.stubGlobal("document", { activeElement: null });
        model = {
            ...stubModel("a1"),
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([{ id: "a1", name: "Agent", blockId: "b1" }]),
        };
        attachBrainstorm("a1", { topic: "forecast", cwd: "C:\\p" }, 0);
        withFile(checked);
        setAgentView("a1", "brainstorm", 1);
    });

    afterEach(() => {
        detachBrainstorm("a1");
        globalStore.set(getProcExitAtom("b1"), undefined);
        vi.unstubAllGlobals();
    });

    it("an exited agent's card is not the review: j/k stay on the agents and nothing claims y or u", () => {
        globalStore.set(getProcExitAtom("b1"), { code: 0, at: 1 });
        for (const id of REVIEW_KEYS) {
            expect(active(id), id).toBe(false);
        }
        expect(active("agent:next-j")).toBe(true);
        expect(claiming("y")).toEqual([]);
        updateBrainstorm("a1", (s) => ({ ...s, showDesign: true, designOpen: true }));
        expect(active("agent:brainstorm-review-next")).toBe(true);
    });

    it("in the review, j k Enter y u are the review's and the agent j/k stand down; the arrows still move agents", () => {
        for (const id of REVIEW_KEYS) {
            expect(active(id), id).toBe(true);
        }
        expect(active("agent:next-j")).toBe(false);
        expect(active("agent:prev-k")).toBe(false);
        expect(active("agent:next")).toBe(true);
        expect(active("agent:prev")).toBe(true);
        for (const key of ["j", "k", "Enter", "y", "u"]) {
            expect(claiming(key), key).toHaveLength(1);
        }
    });

    it("typing in the answer box or an edit box types: no review key is live", () => {
        for (const id of REVIEW_KEYS) {
            expect(active(id, typing), id).toBe(false);
        }
    });

    it("the talk view and the terminal keep j/k on the agents, and nothing claims y or u", () => {
        withFile({ ...checked, check: null });
        for (const id of REVIEW_KEYS) {
            expect(active(id), id).toBe(false);
        }
        expect(active("agent:next-j")).toBe(true);
        expect(active("agent:prev-k")).toBe(true);
        expect(claiming("y")).toEqual([]);
        expect(claiming("u")).toEqual([]);
        withFile(checked);
        setAgentView("a1", "terminal", 2);
        expect(active("agent:brainstorm-review-next")).toBe(false);
        expect(active("agent:next-j")).toBe(true);
    });

    it("a builder question in the main area is not the review; the review opened over it is", () => {
        withFile({
            ...checked,
            check: { ...checked.check!, yours: [...checked.check!.yours, { q: "A day with no row?" }] },
        });
        expect(active("agent:brainstorm-review-next")).toBe(false);
        expect(active("agent:next-j")).toBe(true);
        openBrainstormDesign("a1", true);
        expect(active("agent:brainstorm-review-next")).toBe(true);
        expect(active("agent:next-j")).toBe(false);
    });

    it("another focused agent keeps its j/k", () => {
        globalStore.set(model.focusIdAtom, "a2");
        expect(active("agent:brainstorm-review-next")).toBe(false);
        expect(active("agent:next-j")).toBe(true);
    });

    it("j and k move the cursor over the changed rows then the new ones, stopping at both ends", () => {
        find("agent:brainstorm-review-next").run(nav);
        expect(getBrainstorm("a1")!.review.cursor).toBe("grain");
        find("agent:brainstorm-review-next").run(nav);
        expect(getBrainstorm("a1")!.review.cursor).toBe("torch");
        find("agent:brainstorm-review-next").run(nav);
        expect(getBrainstorm("a1")!.review.cursor).toBe("torch");
        find("agent:brainstorm-review-prev").run(nav);
        expect(getBrainstorm("a1")!.review.cursor).toBe("grain");
    });

    it("y keeps a change and u puts mine back, each for the cursor row", () => {
        setReviewCursor("a1", "grain");
        find("agent:brainstorm-review-keep").run(nav);
        find("agent:brainstorm-review-restore").run(nav);
        expect(vi.mocked(sendBrainstorm).mock.calls.map((c) => c[1])).toEqual([
            { kind: "keep", part: "grain" },
            { kind: "restore", part: "grain" },
        ]);
        expect(vi.mocked(sendBrainstorm).mock.calls[0][0]).toMatchObject({ id: "a1", blockId: "b1" });
    });

    it("on a guess y confirms it and u passes the key on, sending nothing", () => {
        setReviewCursor("a1", "torch");
        find("agent:brainstorm-review-keep").run(nav);
        expect(vi.mocked(sendBrainstorm).mock.calls.map((c) => c[1])).toEqual([{ kind: "confirm", part: "torch" }]);
        expect(find("agent:brainstorm-review-restore").run(nav)).toBe(false);
        expect(sendBrainstorm).toHaveBeenCalledTimes(1);
    });

    it("while the agent writes y and u pass the key on, as the row's buttons are locked", () => {
        setReviewCursor("a1", "grain");
        withFile({ ...checked, working: "Rewriting the forecast grain" });
        expect(find("agent:brainstorm-review-keep").run(nav)).toBe(false);
        expect(find("agent:brainstorm-review-restore").run(nav)).toBe(false);
        expect(sendBrainstorm).not.toHaveBeenCalled();
    });

    it("with no cursor row y, u and Enter pass the key on", () => {
        expect(find("agent:brainstorm-review-keep").run(nav)).toBe(false);
        expect(find("agent:brainstorm-review-restore").run(nav)).toBe(false);
        expect(find("agent:brainstorm-review-open").run(nav)).toBe(false);
        expect(sendBrainstorm).not.toHaveBeenCalled();
    });

    it("Enter opens and closes the cursor row, and leaves a focused button its own press", () => {
        setReviewCursor("a1", "grain");
        find("agent:brainstorm-review-open").run(nav);
        expect(getBrainstorm("a1")!.review.open).toEqual({ grain: true });
        find("agent:brainstorm-review-open").run(nav);
        expect(getBrainstorm("a1")!.review.open).toEqual({ grain: false });
        vi.stubGlobal("document", { activeElement: { tagName: "BUTTON" } });
        expect(find("agent:brainstorm-review-open").run(nav)).toBe(false);
        expect(getBrainstorm("a1")!.review.open).toEqual({ grain: false });
    });
});

describe("brainstorm pane view keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;

    beforeEach(() => {
        vi.stubGlobal("document", { activeElement: null });
        model = { ...stubModel("a1"), surfaceAtom: atom<SurfaceKey>("agent") };
        attachBrainstorm("a1", { topic: "forecast", cwd: "C:\\p" }, 0);
    });

    afterEach(() => {
        detachBrainstorm("a1");
        detachCanvas("a1");
        syncDocReview("a1", undefined);
        globalStore.set(centerModeAtom, "terminal");
        vi.unstubAllGlobals();
    });

    it("b shows the brainstorm from the terminal and goes back from it; the chord does both, typing included", () => {
        find("agent:brainstorm-open").run(nav);
        expect(getBrainstorm("a1")!.mode).toBe("brainstorm");
        find("agent:brainstorm-close").run(nav);
        expect(getBrainstorm("a1")!.mode).toBe("terminal");
        const chord = find("agent:view-chord");
        expect(chord.keys).toBe("Ctrl:Shift:b");
        expect(chord.when!({ ...nav, editable: true })).toBe(true);
        chord.run({ ...nav, editable: true });
        expect(getBrainstorm("a1")!.mode).toBe("brainstorm");
        chord.run({ ...nav, editable: true });
        expect(getBrainstorm("a1")!.mode).toBe("terminal");
    });

    it("the chord stands down over a modal, off the Agent surface, with nothing to switch to, and while History covers the terminal", () => {
        const chord = find("agent:view-chord");
        expect(chord.when!({ ...nav, modalOpen: true })).toBe(false);
        expect(chord.when!({ ...nav, surface: "cockpit" })).toBe(false);
        globalStore.set(centerModeAtom, "history");
        expect(chord.when!(nav)).toBe(false);
        globalStore.set(centerModeAtom, "terminal");
        detachBrainstorm("a1");
        expect(chord.when!(nav)).toBe(false);
    });

    it("Alt+C walks Terminal, Brainstorm and Review in the header's order, the brainstorm in the canvas's slot", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        const cycle = find("agent:view-cycle");
        const mode = () => ({
            brainstorm: getBrainstorm("a1")!.mode,
            canvas: getCanvas("a1")!.mode,
            review: getDocReview("a1")?.mode,
        });
        syncDocReview("a1", docAsk("/r/notes/n.md"));
        cycle.run(nav);
        expect(mode()).toEqual({ brainstorm: "brainstorm", canvas: "terminal", review: "terminal" });
        cycle.run(nav);
        expect(mode()).toEqual({ brainstorm: "terminal", canvas: "terminal", review: "review" });
        cycle.run(nav);
        expect(mode()).toEqual({ brainstorm: "terminal", canvas: "terminal", review: "terminal" });
    });

    it("an agent with a brainstorm never shows its canvas, however the canvas is asked for", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" });
        setAgentView("a1", "canvas", 1);
        expect(getCanvas("a1")!.mode).toBe("terminal");
        expect(find("agent:canvas-open").when!(nav)).toBe(false);
    });

    it("the close-agent chord is live with the pane showing and focus off the terminal, so the pane needs no key of its own", () => {
        setAgentView("a1", "brainstorm", 1);
        const close = find("close-agent");
        expect(close.when!(nav)).toBe(true);
        expect(close.when!({ ...nav, editable: true })).toBe(true);
        expect(close.when!({ ...nav, modalOpen: true })).toBe(false);
    });
});

describe("council chat keys", () => {
    const council: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const find = (id: string) => buildCouncilBindings().find((b) => b.id === id)!;
    const nav = (extra: Partial<CouncilChatNav> = {}): CouncilChatNav => ({
        order: ["P1", "P2", "P3"],
        focusedId: null,
        openId: null,
        sourcesOpen: false,
        focus: vi.fn(),
        open: vi.fn(),
        close: vi.fn(),
        chot: vi.fn(() => true),
        ...extra,
    });
    // where focus is: inside the channel or the thread (or not), on a control of the given tag
    const focusIn = (inside: boolean, tag = "DIV") =>
        vi.stubGlobal("document", { activeElement: { tagName: tag, closest: () => (inside ? {} : null) } });
    const show = (published: CouncilChatNav | null = nav()) => {
        globalStore.set(centerModeAtom, "council");
        globalStore.set(councilChatNavAtom, published);
        return published;
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(councilChatNavAtom, null);
    });

    it("is live only with the chat published on the council centre, on the Agent surface, with focus inside it", () => {
        const keys = ["council:next-idea", "council:prev-idea"].map(find);
        focusIn(true);
        // nothing published, or the centre elsewhere
        for (const b of keys) expect(b.when!(council)).toBe(false);
        show();
        for (const b of keys) expect(b.when!(council)).toBe(true);
        globalStore.set(centerModeAtom, "terminal");
        for (const b of keys) expect(b.when!(council)).toBe(false);
        show();
        // another surface, a field with focus, an open modal
        for (const b of keys) {
            expect(b.when!({ ...council, surface: "jarvis" })).toBe(false);
            expect(b.when!({ ...council, editable: true })).toBe(false);
            expect(b.when!({ ...council, modalOpen: true })).toBe(false);
        }
        // focus outside the channel and the thread: the keys are not the chat's
        focusIn(false);
        for (const b of keys) expect(b.when!(council)).toBe(false);
    });

    it("moves the cursor over the ideas with j and k, and stops at either end", () => {
        focusIn(true);
        const chat = show(nav({ focusedId: "P2" }))!;
        find("council:next-idea").run(council);
        expect(chat.focus).toHaveBeenLastCalledWith("P3");
        find("council:prev-idea").run(council);
        expect(chat.focus).toHaveBeenLastCalledWith("P1");
        const first = show(nav())!;
        find("council:next-idea").run(council);
        expect(first.focus).toHaveBeenLastCalledWith("P1");
        const last = show(nav({ focusedId: "P3" }))!;
        find("council:next-idea").run(council);
        expect(last.focus).toHaveBeenLastCalledWith("P3");
        const none = show(nav({ order: [] }))!;
        find("council:next-idea").run(council);
        expect(none.focus).not.toHaveBeenCalled();
    });

    it("opens the focused idea's thread with Enter, unless none is focused or a button has focus", () => {
        const open = find("council:open-thread");
        focusIn(true);
        show(nav());
        expect(open.when!(council)).toBe(false);
        const chat = show(nav({ focusedId: "P2" }))!;
        expect(open.when!(council)).toBe(true);
        open.run(council);
        expect(chat.open).toHaveBeenCalledWith("P2");
        focusIn(true, "BUTTON");
        expect(open.when!(council)).toBe(false);
    });

    it("Chốts the idea under the cursor with p, and lets the key pass when there is none", () => {
        const chot = find("council:chot");
        expect(chot.keys).toBe("p");
        focusIn(true);
        // no idea under the cursor: not live
        show(nav());
        expect(chot.when!(council)).toBe(false);
        const chat = show(nav({ focusedId: "P2" }))!;
        expect(chot.when!(council)).toBe(true);
        expect(chot.run(council)).toBe(true);
        expect(chat.chot).toHaveBeenCalledWith("P2");
        // the cursor on something the channel draws no idea for (the Chat's thread): the view answers false, the key passes
        const none = show(nav({ focusedId: "chat", chot: vi.fn(() => false) }))!;
        expect(chot.run(council)).toBe(false);
        expect(none.chot).toHaveBeenCalledWith("chat");
        // typing in a field, another surface, focus outside the chat: not the chat's key
        show(nav({ focusedId: "P2" }));
        expect(chot.when!({ ...council, editable: true })).toBe(false);
        expect(chot.when!({ ...council, surface: "jarvis" })).toBe(false);
        focusIn(false);
        expect(chot.when!(council)).toBe(false);
    });

    it("closes an open thread with Escape, and the Agent surface's Escape stands down meanwhile", () => {
        const close = find("council:close-thread");
        const leave = buildAgentBindings(stubModel()).find((b) => b.id === "agent:leave-center")!;
        focusIn(true);
        const chat = show(nav({ focusedId: "P2", openId: "P2" }))!;
        expect(close.when!(council)).toBe(true);
        expect(leave.when!(council)).toBe(false);
        close.run(council);
        expect(chat.close).toHaveBeenCalled();
        // no thread open: Escape leaves the council as it did
        show(nav({ focusedId: "P2" }));
        expect(close.when!(council)).toBe(false);
        expect(leave.when!(council)).toBe(true);
        // a thread open with focus elsewhere: Escape leaves the council too
        show(nav({ openId: "P2" }));
        focusIn(false);
        expect(close.when!(council)).toBe(false);
        expect(leave.when!(council)).toBe(true);
    });

    it("closes the Sources panel with Escape, as it does a thread", () => {
        const close = find("council:close-thread");
        const leave = buildAgentBindings(stubModel()).find((b) => b.id === "agent:leave-center")!;
        focusIn(true);
        const chat = show(nav({ sourcesOpen: true }))!;
        expect(close.when!(council)).toBe(true);
        expect(leave.when!(council)).toBe(false);
        close.run(council);
        expect(chat.close).toHaveBeenCalled();
    });

    it("shares no key with the Agent surface's while the council is on screen", () => {
        focusIn(true);
        show(nav({ focusedId: "P2", openId: "P2" }));
        const all = [...buildAgentBindings(stubModel()), ...buildCouncilBindings()];
        for (const typing of [false, true]) {
            const active = all.filter((b) => b.when!({ ...council, editable: typing }));
            const keys = active.map((b) => b.keys);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});

// the initiative in the Brief's sheet (spec decisions 7 and 9): its keys, and what yields to them
describe("the initiative sheet's keys", () => {
    const nav: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    const key = (k: string, alt = false) =>
        ({ key: k, code: "", control: false, shift: false, cmd: false, option: alt, meta: false, alt }) as any;
    const model = stubModel("a1");
    const step = vi.fn();
    const open = vi.fn();
    const back = vi.fn();
    const setStatus = vi.fn();
    const statusMenu = vi.fn();
    // the plan view's handlers, and the chunk view's; the global and list keys are registered first, as the root does
    const planKeys = buildInitiativeSheetBindings({ step, open });
    const chunkKeys = buildInitiativeSheetBindings({ step, back, setStatus, statusMenu });
    const all = (sheet = planKeys) => [
        ...buildGlobalBindings(model),
        ...buildListNavBindings(model),
        ...buildJarvisBindings(model),
        ...sheet,
    ];
    const claim = (k: string, sheet = planKeys, alt = false) => {
        const r = matchBinding(key(k, alt), nav, all(sheet));
        return r.kind === "run" ? r.binding : null;
    };
    // the sheet is a ModalShell (variant sheet): registered, it holds Escape away from back-home
    let unregister = () => {};
    const openSheet = (chunk: string | null = null) => {
        unregister();
        unregister = registerModal("brief-sheet", "sheet");
        globalStore.set(activeSubjectAtom, { kind: "effort", id: "e1" });
        globalStore.set(briefSheetOpenAtom, true);
        globalStore.set(initiativeSheetAtom, { view: "plan", chunk });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        globalStore.set(diffScopeAtom, null);
    });
    afterEach(() => {
        unregister();
        unregister = () => {};
        globalStore.set(listNavAtom, null);
        globalStore.set(briefSheetOpenAtom, false);
        globalStore.set(activeSubjectAtom, null);
        globalStore.set(initiativeSheetAtom, { view: "plan", chunk: null });
        globalStore.set(sheetChunkMoveAtom, null);
        globalStore.set(chunkMoveAtom, null);
    });

    it("leaves j, k and Enter to the page while no initiative is in the sheet", () => {
        expect(claim("j")?.id).toBe("list:next-j");
        expect(claim("Enter")?.id).toBe("list:activate");
        // a run in the sheet keeps the page's j/k: they step the runs (briefsurface.tsx runNav)
        globalStore.set(activeSubjectAtom, { kind: "channel", id: "ch1" });
        globalStore.set(briefSheetOpenAtom, true);
        expect(claim("j")?.id).toBe("list:next-j");
    });

    it("steps the plan's chunk cursor with j/k and opens the chunk under it with Enter", () => {
        openSheet();
        claim("j")!.run(nav);
        expect(step).toHaveBeenLastCalledWith(1);
        claim("k")!.run(nav);
        expect(step).toHaveBeenLastCalledWith(-1);
        claim("Enter")!.run(nav);
        expect(open).toHaveBeenCalled();
        // the plan view has no status keys: s and the digits pass
        expect(claim("s")).toBeNull();
        expect(claim("1")).toBeNull();
    });

    it("gives a chunk view s, 1–6 in status order and Escape back", () => {
        openSheet("Spec");
        claim("s", chunkKeys)!.run(nav);
        expect(statusMenu).toHaveBeenCalled();
        const order = ["1", "2", "3", "4", "5", "6"].map((d) => {
            claim(d, chunkKeys)!.run(nav);
            return setStatus.mock.lastCall?.[0];
        });
        expect(order).toEqual(["pending", "active", "blocked", "deferred", "skipped", "done"]);
        claim("Escape", chunkKeys)!.run(nav);
        expect(back).toHaveBeenCalled();
    });

    it("lets a key whose handler the view left out pass", () => {
        openSheet("Spec");
        // the plan view's set, with a chunk open (Task 7 swaps the body): Escape matches, runs nothing and passes
        expect(claim("Escape", planKeys)?.run(nav)).toBe(false);
        expect(back).not.toHaveBeenCalled();
    });

    it("moves the sheet's chunk with Alt+arrows while the sheet is open, the page's otherwise", () => {
        const sheetMove = vi.fn();
        const pageMove = vi.fn();
        globalStore.set(sheetChunkMoveAtom, () => sheetMove);
        globalStore.set(chunkMoveAtom, () => pageMove);
        claim("ArrowDown", planKeys, true)!.run(nav);
        expect(pageMove).toHaveBeenCalledWith("down");
        openSheet();
        claim("ArrowUp", planKeys, true)!.run(nav);
        expect(sheetMove).toHaveBeenCalledWith("up");
        // the sheet open with no chunk under its cursor: the key passes, the page's chunk stays put
        globalStore.set(sheetChunkMoveAtom, null);
        expect(claim("ArrowUp", planKeys, true)).toBeNull();
        expect(pageMove).toHaveBeenCalledTimes(1);
    });

    it("stands down in a field and on every other surface", () => {
        openSheet("Spec");
        for (const b of chunkKeys) {
            expect(b.when!({ ...nav, editable: true })).toBe(false);
            expect(b.when!({ ...nav, surface: "cockpit" })).toBe(false);
        }
    });
});

// the Brief's own initiative keys (spec 2026-11-05-jarvis-revamp-design.md, Keyboard): p pins, w works on, and the
// council sheet holds the page's j/k as the initiative sheet does
describe("the Brief's initiative keys", () => {
    const nav: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    const key = (k: string) =>
        ({ key: k, code: "", control: false, shift: false, cmd: false, option: false, meta: false, alt: false }) as any;
    const model = stubModel("a1");
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildJarvisBindings(model)];
    const claim = (k: string, on: KeyContext = nav) => {
        const r = matchBinding(key(k), on, all());
        return r.kind === "run" ? r.binding : null;
    };
    const workOn = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        globalStore.set(diffScopeAtom, null);
    });
    afterEach(() => {
        exitReview();
        globalStore.set(listNavAtom, null);
        globalStore.set(briefCursorInitiativeAtom, null);
        globalStore.set(councilSheetAtom, null);
        globalStore.set(briefSheetOpenAtom, false);
        globalStore.set(activeSubjectAtom, null);
    });

    it("pins the initiative under the page cursor with p", () => {
        globalStore.set(briefCursorInitiativeAtom, { oref: "effort:e1", workOn });
        claim("p")!.run(nav);
        expect(togglePin).toHaveBeenCalledWith("effort:e1");
    });

    it("pins the initiative open in the sheet with p, whatever the page cursor is on", () => {
        globalStore.set(briefCursorInitiativeAtom, { oref: "effort:e1", workOn });
        globalStore.set(activeSubjectAtom, { kind: "effort", id: "e2" });
        globalStore.set(briefSheetOpenAtom, true);
        claim("p")!.run(nav);
        expect(togglePin).toHaveBeenCalledWith("effort:e2");
    });

    it("lets p pass with no initiative under the cursor, in a review pass, in a field and off the Brief", () => {
        expect(claim("p")).toBeNull();
        globalStore.set(briefCursorInitiativeAtom, { oref: "effort:e1", workOn });
        expect(claim("p", { ...nav, editable: true })).toBeNull();
        expect(claim("p", { ...nav, surface: "cockpit" })?.id).not.toBe("jarvis:pin-initiative");
        enterReview(["effort:e1"], 100);
        expect(claim("p")).toBeNull();
    });

    it("works on the initiative under the page cursor with w, though a list row draws no button", () => {
        globalStore.set(briefCursorInitiativeAtom, { oref: "effort:e1", workOn });
        claim("w")!.run(nav);
        expect(workOn).toHaveBeenCalled();
    });

    it("holds the page's j/k while a council's report is in the sheet", () => {
        expect(claim("j")?.id).toBe("list:next-j");
        globalStore.set(councilSheetAtom, "c1");
        globalStore.set(briefSheetOpenAtom, true);
        expect(claim("j")).toBeNull();
        expect(claim("k")).toBeNull();
        expect(claim("Enter")).toBeNull();
    });
});

// ---- Kael sync (2026-11-12): the keys of the Code review and symbols, the Diff comments and Usage's By work ----

describe("Kael sync: Code keys", () => {
    const code = ctx("code");
    const model = () =>
        ({
            ...stubModel(),
            paletteOpenAtom: atom(false),
            paletteSeedAtom: atom<string | null>(null) as PrimitiveAtom<string | null>,
        }) as any;
    const find = (id: string, m: any = model()) => {
        const b = buildCodeBindings(m).find((x) => x.id === id);
        if (b == null) {
            throw new Error(`no binding ${id}`);
        }
        return b;
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(caretWord).mockReset();
        vi.mocked(goToDefinition).mockReset();
        vi.mocked(findReferences).mockReset();
        vi.mocked(startComment).mockReset();
        globalStore.set(codeProjectAtom, null);
        globalStore.set(codeReviewsAtom, new Map());
        globalStore.set(codeReviewSendOpenAtom, false);
        globalStore.set(codeIndexAtom, null);
    });

    it.each([
        ["code:definition", "F12"],
        ["code:references", "Shift:F12"],
        ["code:symbols", "Alt:o"],
        ["code:comment", "Alt:m"],
        ["code:send-review", "Alt:Shift:m"],
    ])("%s is %s, live on Code from the editor too, and not under a modal or on another surface", (id, keys) => {
        const b = find(id);
        expect(b.keys).toBe(keys);
        expect(b.group).toBe("Code");
        expect(b.when!(code)).toBe(true);
        expect(b.when!({ ...code, editable: true })).toBe(true);
        expect(b.when!({ ...code, modalOpen: true })).toBe(false);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    it("uses no [ or ] as a key of its own (Telex turns them into ơ and ư)", () => {
        for (const b of buildCodeBindings(model())) {
            expect(b.keys, b.id).not.toMatch(/[[\]]/);
        }
    });

    it("F12 and Shift+F12 let the key pass with no word at the caret", () => {
        vi.mocked(caretWord).mockReturnValue(null);
        expect(find("code:definition").run(code)).toBe(false);
        expect(find("code:references").run(code)).toBe(false);
        expect(goToDefinition).not.toHaveBeenCalled();
        expect(findReferences).not.toHaveBeenCalled();
    });

    it("F12 looks up the caret word's definition, and Shift+F12 its references", () => {
        vi.mocked(caretWord).mockReturnValue({ word: "openPath", lang: "ts" });
        vi.mocked(goToDefinition).mockResolvedValue(false);
        vi.mocked(findReferences).mockResolvedValue(undefined);
        // the sidebar opener is looked up in the DOM; there is none here
        vi.stubGlobal("document", { querySelector: () => null });
        const m = model();
        expect(find("code:definition", m).run(code)).toBeUndefined();
        expect(goToDefinition).toHaveBeenLastCalledWith(m, "openPath", "ts");
        expect(find("code:references", m).run(code)).toBeUndefined();
        expect(findReferences).toHaveBeenLastCalledWith("openPath");
    });

    it("F12 opens a collapsed sidebar once the candidates are listed, and not for a jump", async () => {
        vi.mocked(caretWord).mockReturnValue({ word: "openPath", lang: "ts" });
        const click = vi.fn();
        const opener = { classList: { contains: () => false }, click, focus: vi.fn() };
        vi.stubGlobal("document", { querySelector: () => opener });
        vi.mocked(goToDefinition).mockResolvedValueOnce(false);
        find("code:definition").run(code);
        await Promise.resolve();
        await Promise.resolve();
        expect(click).not.toHaveBeenCalled();
        vi.mocked(goToDefinition).mockResolvedValueOnce(true);
        find("code:definition").run(code);
        await Promise.resolve();
        await Promise.resolve();
        expect(click).toHaveBeenCalledOnce();
    });

    it("Alt+O opens the search palette seeded with @", () => {
        const m = model();
        find("code:symbols", m).run(code);
        expect(globalStore.get(m.paletteSeedAtom)).toBe("@");
        expect(globalStore.get(m.paletteOpenAtom)).toBe(true);
    });

    it("builds with no model for the tests that only read the guards, and then lets the model keys pass", () => {
        const bare = buildCodeBindings();
        vi.mocked(caretWord).mockReturnValue({ word: "openPath", lang: "ts" });
        expect(bare.find((b) => b.id === "code:symbols")!.run(code)).toBe(false);
        expect(bare.find((b) => b.id === "code:definition")!.run(code)).toBe(false);
        expect(goToDefinition).not.toHaveBeenCalled();
    });

    it("leaves Mod+Shift+O to the global Open a tool, the VS Code symbol chord this key does not take", () => {
        const global = buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("code") } as any);
        expect(global.find((b) => b.id === "open-tool")!.keys).toBe("Mod:Shift:o");
        expect(buildCodeBindings(model()).some((b) => b.keys === "Mod:Shift:o" || b.keys === "Ctrl:Shift:o")).toBe(
            false
        );
    });

    it("Alt+M starts a comment, from the editor and with nothing to comment on alike", () => {
        vi.mocked(startComment).mockImplementation(() => {});
        const b = find("code:comment");
        expect(b.run(code)).toBeUndefined();
        expect(startComment).toHaveBeenCalledOnce();
    });

    it("Alt+Shift+M opens the send bar only with a review to send, else lets the key pass", () => {
        const b = find("code:send-review");
        expect(b.run(code)).toBe(false); // no project
        globalStore.set(codeProjectAtom, { name: "arc", path: "/work/arc" });
        expect(b.run(code)).toBe(false); // a project, no comments
        expect(globalStore.get(codeReviewSendOpenAtom)).toBe(false);
        globalStore.set(
            codeReviewsAtom,
            new Map([["/other", [{ id: "c0", path: "a.go", startLine: 1, endLine: 1, anchor: "x", note: "n" }]]])
        );
        expect(b.run(code)).toBe(false); // another project's comments are not this one's
        globalStore.set(
            codeReviewsAtom,
            new Map([["/work/arc", [{ id: "c1", path: "a.go", startLine: 1, endLine: 2, anchor: "x", note: "n" }]]])
        );
        expect(b.run(code)).toBeUndefined();
        expect(globalStore.get(codeReviewSendOpenAtom)).toBe(true);
    });

    // 4c026402d: Alt+arrows are not editing keys, and the editor is where a jump starts. code:back / code:forward keep
    // their bare-surface guard (an existing case pins it); a twin takes the same keys from a field.
    it("Alt+←/→ are live from the editor too on Windows, as two bindings that are never live together", () => {
        const typing = { ...code, editable: true };
        for (const [id, twin, keys] of [
            ["code:back", "code:back-from-field", "Alt:ArrowLeft"],
            ["code:forward", "code:forward-from-field", "Alt:ArrowRight"],
        ] as const) {
            expect(find(id).keys).toBe(keys);
            expect(find(twin).keys).toBe(keys);
            expect(find(id).when!(code)).toBe(true);
            expect(find(twin).when!(code)).toBe(false);
            expect(find(id).when!(typing)).toBe(false);
            // a Mac's Option+←/→ moves the caret a word in the editor and in every input: the twin leaves it there
            expect(find(twin).when!(typing)).toBe(false);
            setPlatform("win32");
            try {
                expect(find(twin).when!(typing)).toBe(true);
                expect(find(twin).when!(code)).toBe(false);
                expect(find(twin).when!({ ...typing, modalOpen: true })).toBe(false);
                expect(find(twin).when!({ ...typing, surface: "cockpit" })).toBe(false);
            } finally {
                setPlatform("darwin");
            }
            expect(find(twin).paletteHidden).toBe(true);
        }
    });

    it("d lets the key pass in a plain folder, which has no history to diff against", () => {
        globalStore.set(codeIndexAtom, { paths: [], ignored: [], isRepo: false, truncated: false } as any);
        expect(find("code:diff").run(code)).toBe(false);
    });

    it("the Code keys share no key with the global set or each other, in any posture", () => {
        const global = buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("code") } as any);
        const all = [...global, ...buildCodeBindings(model())];
        for (const editable of [false, true]) {
            for (const modalOpen of [false, true]) {
                for (const leader of [null, "g"] as const) {
                    const c = { surface: "code", editable, modalOpen, leader } as KeyContext;
                    const seen = new Map<string, string>();
                    for (const b of all.filter((x) => (x.when ? x.when(c) : true))) {
                        expect(seen.get(b.keys), `${b.keys}: ${seen.get(b.keys)} and ${b.id}`).toBeUndefined();
                        seen.set(b.keys, b.id);
                    }
                }
            }
        }
    });
});

describe("Kael sync: Diff keys", () => {
    const on = { surface: "files", editable: false, modalOpen: false, leader: null } as KeyContext;
    const find = (id: string) => buildFilesBindings().find((b) => b.id === id)!;

    afterEach(() => {
        globalStore.set(splitAvailableAtom, false);
        globalStore.set(splitViewAtom, false);
    });

    it("m declines with no editor mounted, and comments through the mounted layer", () => {
        vi.mocked(commentOnSelection).mockClear();
        const b = find("files:comment");
        expect(b.keys).toBe("m");
        expect(b.group).toBe("Diff");
        expect(b.when?.(on)).toBe(true);
        expect(b.when?.({ ...on, editable: true })).toBe(false);
        expect(b.when?.({ ...on, modalOpen: true })).toBe(false);
        expect(b.run(on)).toBe(false);
        vi.mocked(commentOnSelection).mockReturnValueOnce(true);
        expect(b.run(on)).toBe(true);
        expect(commentOnSelection).toHaveBeenCalledTimes(2);
    });

    it("Shift+Enter declines with no send bar or nothing to send, and sends through the registered bar", () => {
        const b = find("files:send-comments");
        expect(b.keys).toBe("Shift:Enter");
        expect(b.when?.(on)).toBe(true);
        expect(b.when?.({ ...on, editable: true })).toBe(false);
        expect(b.when?.({ ...on, modalOpen: true })).toBe(false);
        expect(b.run(on)).toBe(false);
        const send = vi.fn(() => false);
        const unregister = registerCommentSend(send);
        expect(b.run(on)).toBe(false);
        send.mockReturnValue(true);
        expect(b.run(on)).toBe(true);
        expect(send).toHaveBeenCalledTimes(2);
        unregister();
        expect(b.run(on)).toBe(false);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("an old send bar's teardown leaves the bar that replaced it registered", () => {
        const first = vi.fn(() => true);
        const second = vi.fn(() => true);
        const dropFirst = registerCommentSend(first);
        const dropSecond = registerCommentSend(second);
        dropFirst();
        expect(find("files:send-comments").run(on)).toBe(true);
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
        dropSecond();
    });

    it("Shift+D flips split and unified while the pane is wide enough to split", () => {
        globalStore.set(splitAvailableAtom, true);
        globalStore.set(splitViewAtom, false);
        expect(find("files:toggle-split").run(on)).toBeUndefined();
        expect(globalStore.get(splitViewAtom)).toBe(true);
        find("files:toggle-split").run(on);
        expect(globalStore.get(splitViewAtom)).toBe(false);
    });

    it("Shift+D declines and leaves the view unified while the pane is too narrow for split", () => {
        globalStore.set(splitAvailableAtom, false);
        globalStore.set(splitViewAtom, false);
        expect(find("files:toggle-split").run(on)).toBe(false);
        expect(globalStore.get(splitViewAtom)).toBe(false);
    });

    it("m and Shift+Enter take no key of another Files binding in any posture", () => {
        const model = { ...stubModel(), surfaceAtom: {}, paletteOpenAtom: {}, launcherAtom: {} };
        globalStore.set(listNavAtom, null);
        const all = [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildFilesBindings()];
        for (const editable of [false, true]) {
            for (const modalOpen of [false, true]) {
                for (const leader of [null, "g"] as const) {
                    const c = { surface: "files", editable, modalOpen, leader } as KeyContext;
                    const seen = new Map<string, string>();
                    for (const b of all.filter((x) => (x.when ? x.when(c) : true))) {
                        expect(seen.get(b.keys), `${b.keys}: ${seen.get(b.keys)} and ${b.id}`).toBeUndefined();
                        seen.set(b.keys, b.id);
                    }
                }
            }
        }
    });
});

describe("Kael sync: Escape on Usage's By work goes Back before it leaves", () => {
    const model = { surfaceAtom: atom<SurfaceKey>("usage") } as any;
    const find = (id: string) => buildGlobalBindings(model).find((b) => b.id === id)!;
    const usage = ctx("usage");
    const drill = (scope: string, item: { key: string; back: string } | null) => {
        globalStore.set(usageLensAtom, "work");
        globalStore.set(usageWorkScopeAtom, scope);
        globalStore.set(usageWorkItemAtom, item as any);
    };
    // the Escapes the global set holds live in a context; a conflict is two of them at once
    const liveEscapes = (c: KeyContext) =>
        buildGlobalBindings(model)
            .filter((b) => b.keys === "Escape" && (b.when ? b.when(c) : true))
            .map((b) => b.id);

    beforeEach(() => {
        globalStore.set(autonomyPanelOpenAtom, false);
        globalStore.set(petPeekOpenAtom, false);
    });
    afterEach(() => {
        globalStore.set(usageLensAtom, "provider");
        globalStore.set(usageWorkScopeAtom, "all");
        globalStore.set(usageWorkItemAtom, null);
        globalStore.set(usageListShownAtom, LIST_COLLAPSED_ROWS);
        globalStore.set(escapeMenusOpenAtom, 0);
    });

    it("is labelled for the cheat sheet under Navigation", () => {
        const b = find("usage:back");
        expect(b.keys).toBe("Escape");
        expect(b.group).toBe("Navigation");
        expect(b.label).toBe("Back to the scope, else All usage");
    });

    it("takes Escape from an item, and back-home stands down", () => {
        drill("C:/work/arc", { key: "run:r1", back: "all" });
        expect(liveEscapes(usage)).toEqual(["usage:back"]);
    });

    it("takes Escape from a project or initiative scope", () => {
        drill("C:/work/arc", null);
        expect(liveEscapes(usage)).toEqual(["usage:back"]);
        drill("effort:e1", null);
        expect(liveEscapes(usage)).toEqual(["usage:back"]);
    });

    it("leaves Escape to back-home on All usage, on another lens, and on another surface", () => {
        drill("all", null);
        expect(liveEscapes(usage)).toEqual(["surface:back-home"]);
        drill("C:/work/arc", { key: "run:r1", back: "all" });
        globalStore.set(usageLensAtom, "provider");
        expect(liveEscapes(usage)).toEqual(["surface:back-home"]);
        globalStore.set(usageLensAtom, "work");
        expect(liveEscapes(ctx("files"))).toEqual(["surface:back-home"]);
    });

    it("stands down under the same guards as back-home", () => {
        drill("C:/work/arc", null);
        globalStore.set(escapeMenusOpenAtom, 1);
        expect(liveEscapes(usage)).toEqual([]);
        globalStore.set(escapeMenusOpenAtom, 0);
        expect(liveEscapes({ ...usage, editable: true })).toEqual([]);
        globalStore.set(petPeekOpenAtom, true);
        expect(liveEscapes(usage)).toEqual([]);
    });

    it("goes from an item Back to the scope it was opened from, with the list collapsed", () => {
        drill("C:/work/arc", { key: "session:claude:s1", back: "all" });
        globalStore.set(usageListShownAtom, 33);
        find("usage:back").run(usage);
        expect(globalStore.get(usageWorkScopeAtom)).toBe("all");
        expect(globalStore.get(usageWorkItemAtom)).toBeNull();
        expect(globalStore.get(usageListShownAtom)).toBe(LIST_COLLAPSED_ROWS);
    });

    it("goes from a project to All usage, then hands the next Escape to back-home", () => {
        drill("C:/work/arc", null);
        find("usage:back").run(usage);
        expect(globalStore.get(usageWorkScopeAtom)).toBe("all");
        expect(liveEscapes(usage)).toEqual(["surface:back-home"]);
    });

    it("lets the key pass when there is no step Back to", () => {
        drill("all", null);
        expect(find("usage:back").run(usage)).toBe(false);
    });
});

describe("Kael sync: an open dropdown owns Escape on Code", () => {
    const backHome = () =>
        buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("code") } as any).find(
            (b) => b.id === "surface:back-home"
        )!;

    afterEach(() => {
        globalStore.set(escapeMenusOpenAtom, 0);
    });

    it("surface:back-home stands down while a useEscapeClose menu is open, and takes Escape again once it shuts", () => {
        const b = backHome();
        globalStore.set(autonomyPanelOpenAtom, false);
        globalStore.set(petPeekOpenAtom, false);
        expect(b.when!(ctx("code"))).toBe(true);
        globalStore.set(escapeMenusOpenAtom, 1);
        expect(b.when!(ctx("code"))).toBe(false);
        globalStore.set(escapeMenusOpenAtom, 2);
        expect(b.when!(ctx("code"))).toBe(false);
        globalStore.set(escapeMenusOpenAtom, 0);
        expect(b.when!(ctx("code"))).toBe(true);
    });
});
