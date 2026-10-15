// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { reopenClosedAgent } from "@/app/cockpit/cockpit-actions";
import { peekClickLabel } from "@/app/cockpit/ctrlheld";
import { cheatsheetOpenAtom } from "@/app/cockpit/shortcuts-cheatsheet";
import { anyModalOpen } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { activeNavOrder } from "@/app/view/agents/activenav";
import { closeAgentChord, confirmCloseSession } from "@/app/view/agents/agentactions";
import { centerModeAtom, showCanvases, showHistory, showTerminal } from "@/app/view/agents/agentcenter";
import { AgentsViewModel, SURFACE_ORDER, type SurfaceKey } from "@/app/view/agents/agents";
import { AGENT_DIGITS } from "@/app/view/agents/agentsidebarmodel";
import { answerDigitTarget, canSubmitAsk, moveCursor, type AgentVM } from "@/app/view/agents/agentsviewmodel";
import { nextAgentView, setAgentView } from "@/app/view/agents/agentview";
import {
    cancelCleanup,
    canvasGalleryAtom,
    closeCanvas,
    moveCleanupCards,
    moveGalleryCards,
    openCursorCanvas,
    stepViewerBoard,
    toggleCleanupCursor,
} from "@/app/view/agents/canvasgallerystore";
import { paneState } from "@/app/view/agents/canvasmodel";
import { focusedCanvas, focusedCanvasMode, setMarking, stepCanvasBoard } from "@/app/view/agents/canvasstore";
import { activeChannelRunsAtom } from "@/app/view/agents/channelsstore";
import { sideJumpTarget, type CompareRow } from "@/app/view/agents/comparerows";
import { compareOnAtom, compareSelectionAtom, leaveCompare, swapCompareRefs } from "@/app/view/agents/comparestore";
import { panelFoldedAtom, panelTabAtom } from "@/app/view/agents/difflayout";
import { gotoChange } from "@/app/view/agents/diffnav";
import { diffWrapPathAtom, ignoreWsAtom, splitViewAtom } from "@/app/view/agents/diffoptions";
import { parseDocReview } from "@/app/view/agents/docreview";
import { focusedDocReview, openReview, stepDocReviewTab } from "@/app/view/agents/docreviewstore";
import { doneSuggestion } from "@/app/view/agents/donesuggest";
import { filesStateAtom, reloadChanges } from "@/app/view/agents/filesstore";
import { minimizeRequested, toggleFloat } from "@/app/view/agents/floatstore";
import {
    clearHistoryFilters,
    graphOnAtom,
    historyFiltersAtom,
    historyScrollAtom,
    refreshHistory,
} from "@/app/view/agents/githistorystore";
import { anyFilterActive } from "@/app/view/agents/historyquery";
import { sessionIdFromTranscript } from "@/app/view/agents/ideasmodel";
import { runIdeaCapture } from "@/app/view/agents/ideasstore";
import { initiativePopoverAtom } from "@/app/view/agents/initiativepopover";
import { openLauncher, type LauncherModel } from "@/app/view/agents/launcherstore";
import { activeReviewKeyAtom, canSendKey, lineReviewsAtom } from "@/app/view/agents/linecommentstore";
import { canRequest } from "@/app/view/agents/proseanchor";
import {
    dockedTerminalAtom,
    railVisibleAtom,
    terminalDockFoldedAtom,
    terminalFullscreenAtom,
} from "@/app/view/agents/railstore";
import { toggleOpenFile } from "@/app/view/agents/reviewmarks";
import { renamingRowAtom } from "@/app/view/agents/rowrenameatom";
import { resolveActiveRunId } from "@/app/view/agents/runmodel";
import { runQueueAtom } from "@/app/view/agents/runqueuestore";
import { backgroundTasksByIdAtom, focusSubagentAtom } from "@/app/view/agents/subagentsstore";
import { closeSwitcher, switcherKey, tabSwitcherAtom } from "@/app/view/agents/tabswitcherstore";
import { openToolPicker } from "@/app/view/agents/toolsstore";
import { runningBackgroundTasks } from "@/app/view/agents/transcriptprojection";
import { unreadAgentsAtom } from "@/app/view/agents/unreadagentsstore";
import { panelShownFoldedAtom, refreshSidebar } from "@/app/view/agents/worktreesidebarstore";
import { codeSearchModeAtom } from "@/app/view/code/codesearchstore";
import {
    codeCursorAtom,
    codeRowsAtom,
    codeTreeFocusedAtom,
    codeViewModeAtom,
    confirmDelete,
    goBack,
    goForward,
    openPath,
    refreshIndex,
    saveCurrent,
    startCreate,
    startRename,
    toggleDir,
} from "@/app/view/code/codestore";
import { toggleSide } from "@/app/view/code/codeside";
import { treeKeyAction, type TreeKey } from "@/app/view/code/codetreekeys";
import { toggleCodeWrap, toggleWrap } from "@/app/view/code/codewrap";
import { autonomyPanelOpenAtom } from "@/app/view/jarvis/autonomyladder";
import { COMPOSER_FIELDS, COMPOSER_SELECTOR } from "@/app/view/jarvis/composerkey";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
import {
    briefPeekRecordAtom,
    chunkMoveAtom,
    noteChunkAtom,
    readingNoteAtom,
    trackerMenuAtom,
} from "@/app/view/jarvis/jarvisstore";
import { activeRunIdAtom, activeSubjectAtom, setActiveRunId } from "@/app/view/jarvis/jarvissubjectstore";
import { tourAtom } from "@/app/view/jarvis/jarvistourstore";
import { peekTarget } from "@/app/view/jarvis/openref";
import { openPetPeek, peekChordActive } from "@/app/view/jarvis/peekstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { backToOrigin } from "@/app/view/jarvis/returnsurface";
import {
    enterReview,
    exitReview,
    markReviewedAndAdvance,
    moveReview,
    reviewModeAtom,
    reviewQueueAtom,
} from "@/app/view/jarvis/reviewstore";
import { dagModalStateAtom } from "@/app/view/orchestrate/dagmodalstate";
import { focusedTerminalBlockId, redrawTerminal } from "@/app/view/term/termwrap";
import { isMacOS } from "@/util/platformutil";
import type { MutableRefObject } from "react";
import { ownsKeys } from "./dispatcher";
import { listNavAtom } from "./listnav";
import type { Binding, KeyContext } from "./types";

function focusCodeSidebarOpener(): boolean {
    const opener = document.querySelector<HTMLButtonElement>('button[aria-label^="Expand Code sidebar"]');
    if (opener == null || opener.classList.contains("hidden")) {
        return false;
    }
    opener.focus();
    opener.click();
    return true;
}

function focusCodeTree(): void {
    const tree = document.querySelector<HTMLElement>("[data-code-tree]");
    if (tree != null && tree.closest(".hidden") == null) {
        tree.focus();
    }
}

// the file tree on the Files tab, opening a collapsed sidebar first
function focusCodeTreeFromAnywhere(): void {
    globalStore.set(codeSearchModeAtom, "files");
    // a DOM read in `run` is the established convention here (see files:compare)
    if (focusCodeSidebarOpener()) {
        window.requestAnimationFrame(focusCodeTree);
        return;
    }
    focusCodeTree();
}

function focusCodeSearchInput(): void {
    const input = document.querySelector<HTMLInputElement>("[data-code-search-input]");
    if (input != null) {
        input.focus();
        input.select(); // typing replaces the last query, as in every editor's search box
    }
}

// g-leader surface teleports (collision-free letters; see design spec). Conversation History and the Canvas gallery are modes of
// the Agent surface, not surfaces, so each target carries its own id and the opener that shows its mode.
const GO_TARGETS: {
    letter: string;
    surface: SurfaceKey;
    label: string;
    id?: string;
    open?: (model: AgentsViewModel) => void;
}[] = [
    { letter: "c", surface: "cockpit", label: "Cockpit (home)" },
    { letter: "a", surface: "agent", label: "Agent" },
    { letter: "j", surface: "jarvis", label: "Jarvis (projects, records, recall)" },
    { letter: "r", surface: "radar", label: "Radar" },
    { letter: "s", surface: "agent", label: "Conversation History", id: "go:history", open: showHistory },
    { letter: "v", surface: "agent", label: "Canvas gallery", id: "go:canvases", open: showCanvases },
    { letter: "f", surface: "files", label: "Diff" },
    { letter: "u", surface: "usage", label: "Usage" },
    { letter: "b", surface: "code", label: "Code (browse source)" },
    { letter: ".", surface: "setup", label: "Setup (instructions and skills)" },
    { letter: ",", surface: "settings", label: "Settings" },
];

// Posture guard for keys that reach the cockpit rather than the focused agent. Leader-aware: once a
// leader is active the dispatcher consumes the keystroke and it never reaches the agent, so "focus is
// in a text field" has already been overridden by a deliberate chord. In the TUI with no leader,
// editable is true and leader is null — behavior is bit-for-bit what it was before.
const navigate = (ctx: KeyContext) => (!ctx.editable || ctx.leader != null) && !ctx.modalOpen;

// For Escape-keyed bindings only. Escape must never activate while a text field or the terminal holds
// focus: jarvis:blur-composer claims Escape in exactly that posture, and two active claims on one key
// is what assertNoConflicts exists to catch. During leader mode the matcher intercepts Escape ahead of
// any binding (matcher.ts), so nothing is lost by keeping these strict.
const navigateStrict = (ctx: KeyContext) => !ctx.editable && !ctx.modalOpen;

// Deep (non-home) surfaces whose Escape returns to the Cockpit. Excludes cockpit (already home), agent
// (owns Escape via buildAgentBindings: exit fullscreen / back), and settings.
const ESC_HOME_SURFACES = new Set<SurfaceKey>(["jarvis", "radar", "files", "usage", "code"]);

// A key that clicks a control the surface already draws, rather than duplicating what the control knows.
// No control on screen lets the key pass.
const clickThrough = (selector: string): boolean | void => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el == null) {
        return false;
    }
    el.click();
};

// The focused agent shows its canvas or its Doc review in place of the terminal.
const terminalSwapped = (model: AgentsViewModel) =>
    focusedCanvasMode(model) != null || focusedDocReview(model)?.mode === "review";

// A canvas open in Agent → Canvas gallery pages through its boards with `[` `]` as the agent's canvas does.
const galleryViewerOpen = () =>
    globalStore.get(centerModeAtom) === "canvases" && globalStore.get(canvasGalleryAtom).view === "viewer";

// `[` `]` belong to the boards in canvas mode (and in the gallery's viewer) and to the tabs in review mode, so the
// surface switch stands down while the focused agent shows either. The agent switches stay live: the tree stays on
// screen beside them.
const inAgentSwap = (model: AgentsViewModel, ctx: KeyContext) =>
    ctx.surface === "agent" && (terminalSwapped(model) || galleryViewerOpen());

// The close-agent chord closes the tab the keys were typed in: the pane that took them (paneId), which is not the selected
// agent when they went to the terminal docked under it (terminaldock.ts); the selected agent when the pane names none. A
// plain terminal closes too, as a terminal app's tab does. Returns null when there is nothing to close.
export function closeTarget(items: AgentVM[], focusId: string | undefined, paneId?: string): AgentVM | null {
    const id = paneId || focusId;
    if (!id) {
        return null;
    }
    return items.find((x) => x.id === id) ?? null;
}

// Ctrl+Tab / Ctrl+Shift+Tab (or Option+Tab on a Mac): the tab switcher. Under another modal it stands down, but not
// under its own (the open switcher counts as one, for Escape).
function switcherBindings(model: AgentsViewModel, mod: "ctrl" | "alt"): Binding[] {
    const key = mod === "ctrl" ? "Ctrl" : "Alt";
    const suffix = mod === "ctrl" ? "" : "-alt";
    const when = (ctx: KeyContext) =>
        ctx.surface === "agent" && (!ctx.modalOpen || globalStore.get(tabSwitcherAtom) != null);
    return [
        {
            id: `switcher:next${suffix}`,
            keys: `${key}:Tab`,
            group: "Agent",
            label: "Switch tab",
            when,
            run: () => switcherKey(model, 1, mod),
        },
        {
            id: `switcher:prev${suffix}`,
            keys: `${key}:Shift:Tab`,
            group: "Agent",
            label: "Switch tab, backwards",
            when,
            run: () => switcherKey(model, -1, mod),
        },
    ];
}

// Escape on a surface: back over the jump that brought the user here, and home when there was none
function backOrHome(model: AgentsViewModel): void {
    if (!backToOrigin()) {
        globalStore.set(model.surfaceAtom, "cockpit");
    }
}

// the agent session in focus (its transcript's name): the Ideas the capture chord opens when nothing is selected; null for
// a terminal, or an agent that has not reported in
function focusedSession(model: AgentsViewModel): string | null {
    const id = globalStore.get(model.focusIdAtom);
    return sessionIdFromTranscript(globalStore.get(model.agentsAtom).find((a) => a.id === id)?.transcriptPath);
}

export function buildGlobalBindings(model: AgentsViewModel): Binding[] {
    // `[`/`]` cycle the rail order (SURFACE_ORDER). A surface outside the cycle (settings) enters at an end.
    const cycleSurface = (delta: number) => {
        const cur = globalStore.get(model.surfaceAtom);
        const idx = SURFACE_ORDER.indexOf(cur);
        const next =
            idx === -1
                ? SURFACE_ORDER[delta > 0 ? 0 : SURFACE_ORDER.length - 1]
                : SURFACE_ORDER[(idx + delta + SURFACE_ORDER.length) % SURFACE_ORDER.length];
        globalStore.set(model.surfaceAtom, next);
    };

    const surfaceChords: Binding[] = SURFACE_ORDER.slice(0, 9).map((surface, i) => ({
        id: `surface:${surface}`,
        keys: `Mod:${i + 1}`,
        group: "Global",
        label: `Jump to ${surface}`,
        paletteHidden: true, // duplicates the go-target for the same surface, with a worse label
        run: () => globalStore.set(model.surfaceAtom, surface),
    }));

    // Alt+1..9 jump to the nth agent of the Active list, numbered as its rows are while Alt is held. Like Ctrl+Tab they
    // work from inside a terminal, and typing follows; Ctrl+1..9 stay the surfaces.
    const agentDigitChords: Binding[] = Array.from({ length: AGENT_DIGITS }, (_, i) => i + 1).map((n) => ({
        id: `agent:jump-${n}`,
        keys: `Alt:${n}`,
        group: "Agent",
        label: `Jump to agent ${n}`,
        paletteHidden: true, // a key by its position in the list, which a palette row cannot show
        when: (ctx) => ctx.surface === "agent" && !ctx.modalOpen,
        run: () => model.focusAgentAt(n),
    }));

    const goBindings: Binding[] = GO_TARGETS.map((t) => ({
        id: t.id ?? `go:${t.surface}`,
        keys: `g ${t.letter}`,
        group: "Go to",
        label: t.label,
        when: navigate,
        run: () => (t.open ? t.open(model) : globalStore.set(model.surfaceAtom, t.surface)),
    }));

    return [
        ...surfaceChords,
        ...agentDigitChords,
        ...goBindings,
        {
            id: "surface:next",
            keys: "]",
            group: "Navigation",
            label: "Next surface",
            when: (ctx) => navigate(ctx) && !inAgentSwap(model, ctx),
            run: () => cycleSurface(1),
        },
        {
            id: "surface:prev",
            keys: "[",
            group: "Navigation",
            label: "Previous surface",
            when: (ctx) => navigate(ctx) && !inAgentSwap(model, ctx),
            run: () => cycleSurface(-1),
        },
        {
            // The one search overlay. On Code it opens on the Files scope (VS Code's Ctrl+P), which is
            // where Code's own file finder folded in. Deliberately unguarded — search has to be
            // reachable from inside a text field, and a binding that always matches is also what keeps
            // WebView2's print dialog off this key. `g p` opens it too.
            id: "palette",
            keys: "Mod:p",
            group: "Global",
            label: "Search (files on Code)",
            paletteHidden: true, // a palette row that opens the palette
            run: () => globalStore.set(model.paletteOpenAtom, (v) => !v),
        },
        {
            // Documentation only: matcher.ts LEADER_ALIASES performs the leader entry, because the
            // dispatcher owns leader state and a binding cannot set it. This exists so the footer
            // (footer-visible.ts renders a chip only for an ACTIVE binding id) and the Shift+? cheat
            // sheet can advertise the chord. Same shape as the cockpit-grid documentation bindings.
            // The matcher checks LEADER_ALIASES ahead of the singles pass, so this never wins the key.
            id: "leader:enter",
            keys: "Mod:g",
            group: "Navigation",
            label: "Go to… (works inside the agent terminal too)",
            paletteHidden: true, // a palette row for a key the palette itself would swallow
            // The only way into the go-to leader: a bare `g` opens nothing (matcher.ts), so the footer
            // advertises this chord in every posture. The `when` is presentation only; the matcher opens
            // the leader from this chord regardless.
            when: (ctx) => !ctx.modalOpen,
            run: () => false, // never consume — the matcher already handled it
        },
        {
            // The creature's peek: what is waiting on you, with what settles it. Otherwise only a click or a Tab
            // onto the sprite reaches it. Inactive while it is open, which counts as a modal (dispatcher.ts).
            id: "go:waiting",
            keys: "g w",
            group: "Go to",
            label: "What's waiting (Jarvis peek)",
            when: navigate,
            run: () => openPetPeek(),
        },
        {
            // The same peek in one chord (J for Jarvis), from inside the terminal too; the creature shows a J while
            // Mod is held. The palette keeps showing g w, its label twin (palette-commands.ts chordRank).
            id: "jarvis:peek",
            keys: "Mod:j",
            group: "Global",
            label: "What's waiting (Jarvis peek)",
            when: peekChordActive,
            run: () => openPetPeek(),
        },
        {
            id: "go:palette",
            keys: "g p",
            group: "Go to",
            label: "Search",
            paletteHidden: true, // a palette row that opens the palette
            when: navigate,
            run: () => globalStore.set(model.paletteOpenAtom, true),
        },
        {
            id: "new-agent",
            keys: "Mod:n",
            group: "Global",
            label: "New agent",
            // yields to an open modal: unguarded it stacked New Agent on top of whatever was already
            // open (the search palette) and pulled focus out of it
            when: (ctx) => !ctx.modalOpen,
            run: () => openLauncher(model, "agent"),
        },
        {
            // ⌘M on a Mac, Ctrl+M on Windows: from the cockpit or a float straight into Sprout, or to the Dock when
            // window:minimize says so, and folded, back out (floatstore.ts). Works from a focused terminal, like the
            // yellow button.
            id: "window:fold",
            keys: "Mod:m",
            group: "Global",
            label: "Fold the window into Sprout, or back",
            when: (ctx) => !ctx.modalOpen,
            run: () => minimizeRequested(),
        },
        {
            // Not Mod+R: on Windows that is Ctrl+R, the shell's reverse search in a focused terminal.
            id: "new-run",
            keys: "Mod:Shift:r",
            group: "Global",
            label: "New run",
            when: (ctx) => !ctx.modalOpen,
            run: () => openLauncher(model, "run"),
        },
        {
            // Open a tool (lazygit, yazi, btop…) in the focused agent's folder, from a focused terminal too. Not bare
            // Mod+O: on Windows that is Ctrl+O, which a TUI (nano's write-out, the shell's operate-and-get-next) may take.
            id: "open-tool",
            keys: "Mod:Shift:o",
            group: "Global",
            label: "Open a tool",
            paletteHidden: true, // the palette's own "Open a tool…" row (palette-commands.ts) is the same action
            when: (ctx) => !ctx.modalOpen,
            run: () => openToolPicker(model),
        },
        {
            // Keep what is selected in an agent's terminal as an idea in its Ideas (the "Add as idea" chip beside the
            // selection is the same action); with nothing selected, open the focused agent's Ideas and focus its input.
            // A chord, so it works from a focused terminal, where the chip never takes focus. Consumed even where there is
            // nothing to add (a plain terminal): left to the terminal it would type a Tab. Live on every surface, as a
            // What's new "Try it" must be (whatsnew.test.ts): from another surface it brings the Agent surface up first, where
            // the terminals and the Ideas box are.
            id: "idea-capture",
            keys: "Mod:Shift:i",
            group: "Global",
            label: "Add the selection as an idea",
            paletteHidden: true, // a palette row has no selection to add; the key and the chip are the way
            when: (ctx) => !ctx.modalOpen,
            run: (ctx) => {
                if (ctx.surface !== "agent") {
                    globalStore.set(model.surfaceAtom, "agent");
                }
                void runIdeaCapture(focusedSession(model));
            },
        },
        {
            // Reopen the agent closed last, as a browser reopens a closed tab: asleep, its conversation back on the roster
            // (recentlyclosed.ts). A chord, so it works from inside a terminal.
            id: "reopen-agent",
            keys: "Mod:Shift:t",
            group: "Global",
            label: "Reopen the agent closed last",
            when: (ctx) => !ctx.modalOpen,
            run: () => {
                void reopenClosedAgent(model);
            },
        },
        {
            // ⌘, / Ctrl+, as in VS Code and every Mac app. A comma is no terminal key, so it is the same chord in a terminal.
            id: "settings",
            keys: "Mod:,",
            group: "Global",
            label: "Settings",
            paletteHidden: true, // duplicates the go-target for Settings
            when: (ctx) => !ctx.modalOpen,
            run: () => globalStore.set(model.surfaceAtom, "settings"),
        },
        // Ctrl+Tab opens the switcher over the terminal (tabswitcher.ts): recent first, the plain terminals among its
        // tabs, from inside a terminal too, and the same in a float, in fullscreen and in the plain surface. Like every
        // keyboard way between agents (the arrows and j/k in buildAgentBindings) it only writes focusIdAtom, which
        // AgentSurface turns into the grid rule (agentgrid.ts focusAgent): the agent's cell takes focus if it has one,
        // otherwise the agent replaces the focused cell. Nothing here knows about the grid.
        ...switcherBindings(model, "ctrl"),
        // Option+Tab too on a Mac, where nothing else takes it. Not on Windows: Alt+Tab is the system's app switcher
        // there and never reaches the window, so Ctrl+Tab alone switches.
        ...(isMacOS() ? switcherBindings(model, "alt") : []),
        {
            // the switcher's Escape keeps the tab in view; consumed, so neither the terminal nor agent:back gets it
            id: "switcher:cancel",
            keys: "Escape",
            group: "Agent",
            label: "Close the tab switcher",
            when: () => globalStore.get(tabSwitcherAtom) != null,
            run: () => closeSwitcher(),
        },
        {
            id: "close-agent",
            keys: closeAgentChord(),
            group: "Agent",
            label: "Close the agent or terminal in focus",
            // a chord, so it works from inside the terminal; the close still asks first
            when: (ctx) => ctx.surface === "agent" && !ctx.modalOpen,
            run: () => {
                const active = document.activeElement as HTMLElement | null;
                const paneId = active?.closest<HTMLElement>("[data-agent-terminal]")?.dataset.agentTerminal;
                const items = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
                const target = closeTarget(items, globalStore.get(model.focusIdAtom), paneId);
                if (target != null) {
                    confirmCloseSession(target, model);
                }
            },
        },
        {
            id: "help",
            keys: "Shift:?",
            group: "Help",
            label: "Keyboard shortcuts",
            when: navigate,
            run: () => globalStore.set(cheatsheetOpenAtom, true),
        },
        {
            id: "surface:back-home",
            keys: "Escape",
            group: "Navigation",
            label: "Back, else to Cockpit",
            // the autonomy panel owns Escape while it is open: closing an overlay is what the user means by
            // Escape there, and navigating home instead would leave the panel open behind the Cockpit. It
            // cannot claim the key itself, since this dispatcher runs on window capture, ahead of any handler
            // the panel could register.
            when: (ctx) =>
                navigateStrict(ctx) &&
                ESC_HOME_SURFACES.has(ctx.surface) &&
                // any open ModalShell (the Brief's Profile window, its sheet) closes on Escape itself; going
                // home instead unmounts it with its state still set, so it reopens on the way back
                !anyModalOpen() &&
                !globalStore.get(autonomyPanelOpenAtom) &&
                // and the pet's peek, for the same reason again — it is global chrome, so it can be open
                // on ANY of these surfaces, not just Jarvis
                !globalStore.get(petPeekOpenAtom) &&
                // the Diff surface's compare state owns Escape while it is on: leaving compare is what
                // Escape means there, and going home instead would strand a two-ref read behind the Cockpit
                !globalStore.get(compareOnAtom) &&
                // and with filters active, Escape clears them — the history header says so ("Clear filters", esc)
                !(ctx.surface === "files" && anyFilterActive(globalStore.get(historyFiltersAtom))) &&
                // the Brief's record peek is a ModalShell and the Brief is where every record destination
                // now lands: without this, one press closed the peek AND left the surface — and the peek's
                // own state was never cleared, so coming back showed it open again
                globalStore.get(briefPeekRecordAtom) == null &&
                // the DAG modal takes Escape itself too, and the Brief mounts it as well as Channels
                globalStore.get(dagModalStateAtom) == null &&
                // and the Brief's Chunk sidebar: while a note is open, Escape means "back out of the
                // note", and going home too would do both at once
                globalStore.get(noteChunkAtom) == null &&
                // and the plan-editing menu above it, the innermost rung of all
                globalStore.get(trackerMenuAtom) == null &&
                // and a review pass on the Brief: Escape leaves the pass, and going home too would do both
                !(ctx.surface === "jarvis" && globalStore.get(reviewModeAtom) != null),
            run: () => backOrHome(model),
        },
    ];
}

// One shared set of list-cursor bindings for the plain master-detail surfaces. Active only when the
// mounted surface has published a controller (listnav.ts) for itself and focus is not in a field.
export function buildListNavBindings(model: AgentsViewModel): Binding[] {
    const active = (ctx: KeyContext): boolean => {
        if (ctx.editable || ctx.modalOpen) {
            return false;
        }
        // a review pass on the Brief takes j, k and Enter (buildJarvisBindings) until it ends; on any other
        // surface the pass, left open behind it, owns nothing
        if (ctx.surface === "jarvis" && globalStore.get(reviewModeAtom) != null) {
            return false;
        }
        const c = globalStore.get(listNavAtom);
        return c != null && c.surface === ctx.surface;
    };
    // ↑/↓ with focus in the Diff surface's changed-file list step through its files (changedfilelist.tsx), or in the
    // Commit tab's tick list (committab.tsx), not the history rows; j/k stay the history cursor
    const inFileList = () =>
        typeof document !== "undefined" &&
        document.activeElement?.closest?.("[data-file-list], [data-commit-list]") != null;
    const rowPeek = () => globalStore.get(listNavAtom)?.peekTarget?.() ?? null;
    const move = (delta: number) => {
        const c = globalStore.get(listNavAtom);
        if (c == null) {
            return;
        }
        const next = moveCursor(c.navigableIds, c.cursorId, delta);
        if (next != null) {
            c.setCursor(next);
        }
    };
    const activate = (): void | boolean => {
        const c = globalStore.get(listNavAtom);
        if (c?.activate == null) {
            return false; // no primary action for this surface — let Enter pass through
        }
        c.activate();
    };
    return [
        {
            id: "list:next-j",
            keys: "j",
            group: "Navigation",
            label: "Next item",
            when: active,
            paletteHidden: true,
            run: () => move(1),
        },
        {
            id: "list:prev-k",
            keys: "k",
            group: "Navigation",
            label: "Previous item",
            when: active,
            paletteHidden: true,
            run: () => move(-1),
        },
        {
            id: "list:next",
            keys: "ArrowDown",
            group: "Navigation",
            label: "Next item",
            when: (ctx) => active(ctx) && !inFileList(),
            paletteHidden: true,
            run: () => move(1),
        },
        {
            id: "list:prev",
            keys: "ArrowUp",
            group: "Navigation",
            label: "Previous item",
            when: (ctx) => active(ctx) && !inFileList(),
            paletteHidden: true,
            run: () => move(-1),
        },
        {
            id: "list:activate",
            keys: "Enter",
            group: "Navigation",
            label: "Open / activate item",
            when: active,
            paletteHidden: true,
            run: activate,
        },
        {
            id: "list:peek",
            keys: "Space",
            group: "Navigation",
            label: "Peek the item in the avatar popup",
            when: (ctx) => active(ctx) && rowPeek() != null,
            paletteHidden: true,
            run: () => {
                const target = rowPeek();
                if (target == null) {
                    return false;
                }
                void peekTarget(model, target);
            },
        },
    ];
}

// Run-body ask keys: the ask card renders numbered (1-9) answer badges (channelsprimitives AskRow), but
// the digit handler used to be cockpit-only. These bindings make the badges functional wherever the run
// body lives — now the merged Jarvis Stage — targeting the selected run's asking worker (published live
// via askAgentRef). Reuses answerDigitTarget + model.toggleAnswer/submitAnswer — no duplicated logic.
export function buildChannelsAskBindings(
    model: AgentsViewModel,
    askAgentRef: MutableRefObject<AgentVM | undefined>
): Binding[] {
    const ready = (ctx: KeyContext): boolean =>
        ctx.surface === "jarvis" && !ctx.editable && !ctx.modalOpen && askAgentRef.current != null;
    const toggleDigit = (n: number): boolean | void => {
        const agent = askAgentRef.current;
        if (agent == null) {
            return false;
        }
        const tab = globalStore.get(model.answerTabAtom)[agent.id] ?? 0;
        const target = answerDigitTarget(agent, tab, n);
        if (target == null) {
            return false; // no such option — let the key pass
        }
        model.toggleAnswer(agent.id, target.qi, target.oi);
    };
    const submit = (): boolean | void => {
        const agent = askAgentRef.current;
        if (agent == null) {
            return false;
        }
        const sel = globalStore.get(model.answerSelAtom)[agent.id] ?? {};
        const txt = globalStore.get(model.answerTextAtom)[agent.id] ?? {};
        if (!canSubmitAsk(agent.ask?.questions ?? [], sel, txt)) {
            return false; // not yet answerable — let Enter pass
        }
        model.submitAnswer(agent.id);
    };
    const digits: Binding[] = Array.from({ length: 9 }, (_, i) => i + 1).map((n) => ({
        id: `channels:answer-${n}`,
        keys: String(n),
        group: "Jarvis",
        label: `Answer option ${n}`,
        paletteHidden: true,
        when: ready,
        run: () => toggleDigit(n),
    }));
    return [
        ...digits,
        {
            id: "channels:submit",
            keys: "Enter",
            group: "Jarvis",
            label: "Submit answer",
            paletteHidden: true,
            when: ready,
            run: submit,
        },
    ];
}

// Jarvis surface keys — the surface's own controls, reachable without the mouse. Two shapes:
//   * state the registry owns outright (the run switcher)
//   * a click on a control the surface already draws (New initiative, Work on, the record band's expand)
// The second shape is deliberate. Whether a band is *expandable* is the band's own derivation from the
// run's attribution (recordbandview) and re-deriving it here would be a second source of truth that
// drifts; the button only exists when the band can open, so clicking it is exactly the mouse's contract.
// Every DOM-reaching run() returns false when its control is absent, so the key passes through rather
// than pretending to have acted.
// The jarvis surface's guard.
const onJarvis = (ctx: KeyContext) => ctx.surface === "jarvis" && !ctx.editable && !ctx.modalOpen;

export function buildJarvisBindings(model: LauncherModel): Binding[] {

    // One rung per press: an expanded note card folds, then the sidebar closes. Only then does Escape
    // fall through to esc-home, which is guarded on the same atom — otherwise a single press would close
    // the note AND leave the surface.
    const noteSidebarEscape: Binding = {
        id: "jarvis:close-notes",
        keys: "Escape",
        group: "Jarvis",
        label: "Back out of the Chunk sidebar",
        when: (ctx) =>
            onJarvis(ctx) && globalStore.get(noteChunkAtom) != null && globalStore.get(trackerMenuAtom) == null,
        run: () => {
            if (globalStore.get(readingNoteAtom).size > 0) {
                globalStore.set(readingNoteAtom, new Set());
                return;
            }
            globalStore.set(noteChunkAtom, null);
        },
    };

    const reviewing = (ctx: KeyContext) => onJarvis(ctx) && globalStore.get(reviewModeAtom) != null;
    const reviewKey = (id: string, keys: string, label: string, run: () => void, when = reviewing): Binding => ({
        id,
        keys,
        group: "Jarvis",
        label,
        when,
        paletteHidden: true,
        run,
    });
    const reviewKeys: Binding[] = [
        reviewKey("jarvis:review-mark", "Enter", "Mark reviewed, then the next", () =>
            markReviewedAndAdvance(Date.now())
        ),
        reviewKey("jarvis:review-next-j", "j", "Next initiative in the review", () => moveReview(1)),
        reviewKey("jarvis:review-prev-k", "k", "Previous initiative in the review", () => moveReview(-1)),
        reviewKey("jarvis:review-next", "ArrowRight", "Next initiative in the review", () => moveReview(1)),
        reviewKey("jarvis:review-prev", "ArrowLeft", "Previous initiative in the review", () => moveReview(-1)),
        reviewKey(
            "jarvis:review-exit",
            "Escape",
            "Leave the review",
            exitReview,
            (ctx) =>
                reviewing(ctx) && globalStore.get(noteChunkAtom) == null && globalStore.get(trackerMenuAtom) == null
        ),
    ];

    // an open status or stage menu sits above the sidebar: Escape closes the menu and nothing else
    const trackerMenuEscape: Binding = {
        id: "jarvis:close-tracker-menu",
        keys: "Escape",
        group: "Jarvis",
        label: "Close the plan menu",
        when: (ctx) => onJarvis(ctx) && globalStore.get(trackerMenuAtom) != null,
        run: () => globalStore.set(trackerMenuAtom, null),
    };

    // the run switcher, keyboard-side: the same list the Subjects column expands under the selected
    // channel, in the same order, moved with the same clamped cursor the lists use.
    const stepRun = (delta: number): boolean | void => {
        const subject = globalStore.get(activeSubjectAtom);
        if (subject?.kind !== "channel") {
            return false; // only a channel has runs to switch between
        }
        const runs = globalStore.get(activeChannelRunsAtom);
        if (runs.length < 2) {
            return false;
        }
        const cur = resolveActiveRunId(runs, globalStore.get(activeRunIdAtom)[subject.id]);
        const next = moveCursor(
            runs.map((r) => r.id),
            cur,
            delta
        );
        if (next == null || next === cur) {
            return false;
        }
        setActiveRunId(subject.id, next);
    };

    return [
        trackerMenuEscape,
        noteSidebarEscape,
        {
            id: "jarvis:new-run",
            keys: "r",
            group: "Jarvis",
            label: "New run",
            when: onJarvis,
            run: () => openLauncher(model, "run"),
        },
        {
            id: "jarvis:new-initiative",
            keys: "Shift:n",
            group: "Jarvis",
            label: "New initiative",
            when: onJarvis,
            run: () => clickThrough("[data-jarvis-new-initiative]"),
        },
        {
            id: "jarvis:work-on",
            keys: "w",
            group: "Jarvis",
            label: "Work on the initiative under the cursor, or go to its open agent",
            when: onJarvis,
            run: () => clickThrough('[data-jarvis-brief-cursor="true"] [data-jarvis-work-on]'),
        },
        {
            id: "jarvis:record-band",
            keys: "e",
            group: "Jarvis",
            label: "Expand / collapse the record band",
            when: onJarvis,
            run: () => clickThrough("[data-jarvis-band-toggle]"),
        },
        {
            id: "jarvis:next-run",
            keys: "Shift:j",
            group: "Jarvis",
            label: "Next run in this project",
            when: onJarvis,
            run: () => stepRun(1),
        },
        {
            id: "jarvis:prev-run",
            keys: "Shift:k",
            group: "Jarvis",
            label: "Previous run in this project",
            when: onJarvis,
            run: () => stepRun(-1),
        },
        {
            id: "jarvis:chunk-up",
            keys: "Alt:ArrowUp",
            group: "Jarvis",
            label: "Move the chunk up within its stage",
            when: (ctx) => onJarvis(ctx) && globalStore.get(chunkMoveAtom) != null,
            run: () => globalStore.get(chunkMoveAtom)?.("up"),
        },
        {
            id: "jarvis:chunk-down",
            keys: "Alt:ArrowDown",
            group: "Jarvis",
            label: "Move the chunk down within its stage",
            when: (ctx) => onJarvis(ctx) && globalStore.get(chunkMoveAtom) != null,
            run: () => globalStore.get(chunkMoveAtom)?.("down"),
        },
        {
            id: "jarvis:review",
            keys: "v",
            group: "Jarvis",
            label: "Review what changed and what sat idle",
            when: (ctx) => onJarvis(ctx) && globalStore.get(reviewModeAtom) == null,
            // the Brief publishes the queue it draws; nothing to review lets the key pass
            run: () => (enterReview(globalStore.get(reviewQueueAtom), Date.now()) ? undefined : false),
        },
        // while a pass is on, it owns j, k, Enter, the horizontal arrows and Escape (list nav and esc-home stand
        // down), and Escape leaves the pass only once the Chunk sidebar and the plan menu above it are closed
        ...reviewKeys,
        {
            id: "jarvis:focus-composer",
            keys: "i",
            group: "Jarvis",
            label: "Focus the composer",
            when: onJarvis,
            run: () => {
                const el = document.querySelector<HTMLElement>(COMPOSER_FIELDS);
                if (el == null) {
                    return false;
                }
                el.focus();
            },
        },
        {
            id: "jarvis:filter",
            keys: "/",
            group: "Jarvis",
            label: "Filter the Brief",
            when: onJarvis,
            run: () => {
                const el = document.querySelector<HTMLInputElement>("[data-jarvis-brief-filter]");
                if (el == null) {
                    return false;
                }
                el.focus();
            },
        },
        {
            id: "jarvis:blur-composer",
            keys: "Escape",
            group: "Jarvis",
            label: "Leave the composer",
            paletteHidden: true,
            // the counterpart to `i`. Guarded on editable only, so `when` stays pure; run() checks *which*
            // field has focus, because the rename box and the subject filter own their own Escape — and
            // blurring the rename box would commit the rename instead of cancelling it.
            when: (ctx) => ctx.surface === "jarvis" && ctx.editable && !ctx.modalOpen,
            run: () => {
                const el = document.activeElement as HTMLElement | null;
                if (el?.closest?.(COMPOSER_SELECTOR) == null) {
                    return false;
                }
                el.blur();
            },
        },
    ];
}

// Cockpit-grid triage keys. The rich cockpit surface handles these itself (usecockpitkeyboard.ts) —
// they need live cursor + DOM state (scroll-to, focus a row's composer) that the registry has no clean
// hold on. Registered here purely so the ONE cheat sheet (Shift+?) documents them: `run` returns false
// so the dispatcher never consumes the key — it passes through to the surface's own onKeyDown. This is
// the single source of truth for these keys' documentation (the old hand-written help overlay is gone).
export function buildCockpitBindings(): Binding[] {
    const on = (ctx: KeyContext) => ctx.surface === "cockpit" && !ctx.editable && !ctx.modalOpen;
    const doc = (id: string, keys: string, label: string): Binding => ({
        id,
        keys,
        group: "Cockpit",
        label,
        when: on,
        // documentation-only, so a palette row would be a dead button: run() deliberately performs
        // nothing, and the surface's own onKeyDown never sees a click. The cheat sheet still lists them.
        paletteHidden: true,
        run: () => false, // never consume — usecockpitkeyboard.ts performs the action
    });
    return [
        doc("cockpit:next", "j", "Next card or task row (↓ / j)"),
        doc("cockpit:prev", "k", "Previous card or task row (↑ / k)"),
        doc("cockpit:next-ask", "n", "Jump to next ask"),
        doc("cockpit:column", "h", "Other column (← → / h l); on a multi-question ask, switch question"),
        doc("cockpit:answer", "1", "Select an answer option (1–9); on a task row with no question, run its action"),
        doc("cockpit:open", "Enter", "Confirm answer, else open focus; on a task row, open its worker"),
        doc("cockpit:peek", "Space", `Peek the agent in the avatar popup (${peekClickLabel()} a link peeks it too)`),
        doc("cockpit:reply", "r", "Reply inline to the agent"),
        doc("cockpit:terminal", "t", "Open the agent's terminal"),
        doc("cockpit:background", "b", "Background the agent (keeps running)"),
        doc("cockpit:office", "o", "Switch the Cockpit between Cards and Office"),
        doc("cockpit:office-walk", "ArrowRight", "Office: walk the boss (← ↑ ↓ →); j / k go desk by desk"),
    ];
}

// Usage surface: the arrows switch provider tabs and `a` runs Analyze on the Claude tab. `[` `]` stay the global
// surface switch, and the arrows are bound elsewhere only on the agent and code surfaces, so they are free here. j / k /
// Enter on the By session table come from the list nav (UsageSurface publishes its cursor). The strip, the selection
// and the Insights state live in UsageSurface, so these only call back into it; `analyze` decides for itself whether
// it applies (the Claude tab, sessions to read, not already running or held).
export function buildUsageBindings(handlers: {
    prevTab: () => void;
    nextTab: () => void;
    analyze: () => void;
}): Binding[] {
    const on = (ctx: KeyContext) => ctx.surface === "usage" && !ctx.editable && !ctx.modalOpen;
    return [
        {
            id: "usage:prev-tab",
            keys: "ArrowLeft",
            group: "Usage",
            label: "Previous provider tab",
            when: on,
            paletteHidden: true,
            run: handlers.prevTab,
        },
        {
            id: "usage:next-tab",
            keys: "ArrowRight",
            group: "Usage",
            label: "Next provider tab",
            when: on,
            paletteHidden: true,
            run: handlers.nextTab,
        },
        {
            id: "usage:analyze",
            keys: "a",
            group: "Usage",
            label: "Analyze Claude usage (Claude tab)",
            when: on,
            paletteHidden: true,
            run: handlers.analyze,
        },
    ];
}

// History and a session's transcript cover the terminal, so the keys that act on the focused agent (j/k, the arrows, d, f,
// r, c) stand down there: History publishes its own list cursor on this surface, and j/k must belong to it alone
const centerAtRest = () => globalStore.get(centerModeAtom) === "terminal";
// The initiative popover on the agent header owns its keys (m, n, the arrows, Enter, Escape) while it is open, so every
// single-key Agent binding stands down: this dispatcher runs on window capture, ahead of the popover's own handler.
const initiativePopoverClosed = () => globalStore.get(initiativePopoverAtom) == null;
const agentNav = (ctx: KeyContext) =>
    navigate(ctx) && ctx.surface === "agent" && centerAtRest() && initiativePopoverClosed();
const agentNavStrict = (ctx: KeyContext) =>
    navigateStrict(ctx) && ctx.surface === "agent" && centerAtRest() && initiativePopoverClosed();
// The Canvas gallery covers the terminal as History does, with keys of its own: the arrows, Enter and `/` on its grid,
// the arrows, `[` `]` and Escape on an open canvas, the arrows, Space and Escape in clean up. Each takes its view from
// canvasGalleryAtom, so they never share a key.
const onGallery = (ctx: KeyContext) =>
    ctx.surface === "agent" && globalStore.get(centerModeAtom) === "canvases" && initiativePopoverClosed();
const galleryNav = (ctx: KeyContext) => navigate(ctx) && onGallery(ctx);
const galleryView = () => globalStore.get(canvasGalleryAtom).view;
const inGalleryGrid = (ctx: KeyContext) => galleryNav(ctx) && galleryView() === "grid";
const inGalleryViewer = (ctx: KeyContext) => galleryNav(ctx) && galleryView() === "viewer";
const inGalleryCleanup = (ctx: KeyContext) => galleryNav(ctx) && galleryView() === "cleanup";
// An open canvas and the clean-up mode go back to the grid on Escape, so the Escape that leaves the centre stands down;
// the grid has nothing to back out of, and leaves. Escape inside the search box is the box's own.
const galleryHoldsEscape = () =>
    globalStore.get(centerModeAtom) === "canvases" && globalStore.get(canvasGalleryAtom).view !== "grid";

// Agent (Focus) surface bindings. Moved out of agentsurface.tsx so the registry has one home
// and the array is stable: run() reads live atoms instead of closing over per-render focus/order.
// focusIdAtom is kept synced to the resolved focused agent (agentsurface.tsx), so reading it live
// is equivalent to the old closure over `agent.id`.
export function buildAgentBindings(model: AgentsViewModel): Binding[] {
    const step = (delta: number) => {
        const order = activeNavOrder(model);
        const fid = globalStore.get(model.focusIdAtom);
        globalStore.set(model.focusIdAtom, moveCursor(order, fid, delta) ?? fid);
        globalStore.set(model.focusReplyAtom, false);
    };
    const reviewableId = (): string | null => {
        const id = globalStore.get(model.focusIdAtom);
        const agent = globalStore.get(model.agentsAtom).find((a) => a.id === id);
        return agent != null && parseDocReview(agent.ask) != null ? agent.id : null;
    };
    // canvas and review mode hide the rail and the terminal, so their keys stand down there
    const noCanvas = () => !terminalSwapped(model);
    const nav = (ctx: KeyContext) => agentNav(ctx) && noCanvas();
    const canvas = () => focusedCanvas(model);
    const inCanvas = (ctx: KeyContext) => agentNav(ctx) && canvas()?.mode === "canvas";
    // fullscreen's chords (F11, Mod+Shift+Enter) stay live in the terminal, unlike its bare `f`
    const fullscreenChordActive = (ctx: KeyContext) =>
        ctx.surface === "agent" && !ctx.modalOpen && centerAtRest() && noCanvas();
    const toggleTerminalFullscreen = () =>
        globalStore.set(terminalFullscreenAtom, !globalStore.get(terminalFullscreenAtom));
    const boardReady = (ctx: KeyContext) => inCanvas(ctx) && !canvas()!.marking && paneState(canvas()!) === "board";
    const docReview = () => focusedDocReview(model);
    // the focused agent when the header offers its ✓ Close (donesuggest.ts), else undefined
    const doneAgent = (): AgentVM | undefined => {
        const id = globalStore.get(model.focusIdAtom);
        const agent = globalStore.get(model.agentsAtom).find((a) => a.id === id);
        const unread = agent != null ? (globalStore.get(unreadAgentsAtom).get(agent.id) ?? 0) : 0;
        const bgRunning =
            agent != null ? runningBackgroundTasks(globalStore.get(backgroundTasksByIdAtom)[agent.id]).length : 0;
        return agent != null &&
            doneSuggestion(
                agent,
                unread,
                globalStore.get(model.lineageAtom).runs,
                bgRunning,
                globalStore.get(runQueueAtom)
            )
            ? agent
            : undefined;
    };
    const inReview = (ctx: KeyContext) => agentNav(ctx) && docReview()?.mode === "review";
    // live inside the general note on purpose, as canvas-send is in a mark's note; it stands down in History and a
    // session, which cover the review pane without leaving review mode
    const reviewSend = (ctx: KeyContext) =>
        ctx.surface === "agent" && !ctx.modalOpen && centerAtRest() && docReview()?.mode === "review";
    const reviewCanRequest = () => canRequest(docReview()!.comments, docReview()!.generalNote);
    // a draft comment's own Ctrl+Enter adds that comment, so the key passes to it
    const sendReview = () => {
        if ((document.activeElement as HTMLElement | null)?.closest?.("[data-doc-review-draft]") != null) {
            return false;
        }
        return clickThrough("[data-doc-review-send]");
    };
    const focusId = () => globalStore.get(model.focusIdAtom);
    return [
        {
            id: "subagent:back",
            keys: "Escape",
            group: "Agent",
            label: "Back to parent agent",
            // fires regardless of editable to preserve the old always-on Escape; mutually exclusive
            // with agent:back below (both guarded on focusSubagentAtom), so no key conflict. Still
            // yields to an open modal — the dialog owns Escape, and this dispatcher runs on window
            // capture, so without the guard it would consume the key and the dialog would never close.
            // A row's rename box owns it for the same reason, and needs saying separately: every
            // other Escape here is gated on !editable, which would exclude a focused input on its own,
            // but this one cannot use that gate (the terminal textarea holds focus for most of this
            // surface's life). Unguarded, Escape would exit the subagent while the box stayed open —
            // and the box would then commit on blur the name the user was trying to discard.
            when: (ctx) =>
                ctx.surface === "agent" &&
                !ctx.modalOpen &&
                globalStore.get(renamingRowAtom) == null &&
                globalStore.get(focusSubagentAtom) != null &&
                // a File tab opened over the subagent owns Escape: it closes the file, not the subagent
                !ownsKeys(document.activeElement),
            run: () => globalStore.set(focusSubagentAtom, null),
        },
        {
            id: "agent:back",
            keys: "Escape",
            group: "Agent",
            label: "Back, else to Cockpit (or exit fullscreen)",
            when: (ctx) => agentNavStrict(ctx) && globalStore.get(focusSubagentAtom) == null && noCanvas(),
            run: () => {
                if (globalStore.get(terminalFullscreenAtom)) {
                    globalStore.set(terminalFullscreenAtom, false);
                } else {
                    backOrHome(model);
                }
            },
        },
        {
            id: "agent:leave-center",
            keys: "Escape",
            group: "Agent",
            label: "Back to the terminal (from History, a session or the canvases)",
            // exclusive with agent:back (which needs the centre at rest) and with subagent:back (which needs a focused
            // subagent), so Escape never means two things. Deliberately not gated on noCanvas(): the focused agent's
            // canvas or review can still be on while History covers the terminal, and Escape must leave History then
            // too. The palette lists it only while it applies (buildCommandItems filters on when()).
            when: (ctx) =>
                navigateStrict(ctx) &&
                ctx.surface === "agent" &&
                !centerAtRest() &&
                globalStore.get(focusSubagentAtom) == null &&
                !galleryHoldsEscape(),
            run: () => showTerminal(),
        },
        // Agent → Canvas gallery. Moving over cards and paging through boards are postures, not actions to search for.
        ...(
            [
                ["ArrowLeft", "canvases:left", "Previous canvas"],
                ["ArrowRight", "canvases:right", "Next canvas"],
                ["ArrowUp", "canvases:up", "Canvas above"],
                ["ArrowDown", "canvases:down", "Canvas below"],
            ] as const
        ).map(
            ([key, id, label]): Binding => ({
                id,
                keys: key,
                group: "Agent",
                label,
                paletteHidden: true,
                when: inGalleryGrid,
                run: () => moveGalleryCards(key, Date.now()),
            })
        ),
        {
            id: "canvases:open",
            keys: "Enter",
            group: "Agent",
            label: "Open the canvas",
            paletteHidden: true,
            when: inGalleryGrid,
            // an empty grid has no card under the cursor, so the key passes
            run: () => openCursorCanvas(Date.now()),
        },
        {
            id: "canvases:search",
            keys: "/",
            group: "Agent",
            label: "Search canvases",
            paletteHidden: true,
            when: inGalleryGrid,
            run: () => {
                const el = document.querySelector<HTMLInputElement>("[data-canvas-gallery-search]");
                if (el == null) {
                    return false; // no canvas anywhere draws no search box
                }
                el.focus();
                el.select(); // typing replaces the last query, as in every editor's search box
            },
        },
        {
            id: "canvases:prev-board",
            keys: "ArrowLeft",
            group: "Agent",
            label: "Previous board",
            paletteHidden: true,
            when: inGalleryViewer,
            run: () => stepViewerBoard(-1),
        },
        {
            id: "canvases:next-board",
            keys: "ArrowRight",
            group: "Agent",
            label: "Next board",
            paletteHidden: true,
            when: inGalleryViewer,
            run: () => stepViewerBoard(1),
        },
        // [ and ] page through the boards as they do on an agent's canvas, but the viewer's hints name only the arrows: a
        // Vietnamese Telex IME turns them into ơ and ư
        {
            id: "canvases:prev-board-bracket",
            keys: "[",
            group: "Agent",
            label: "Previous board",
            paletteHidden: true,
            when: inGalleryViewer,
            run: () => stepViewerBoard(-1),
        },
        {
            id: "canvases:next-board-bracket",
            keys: "]",
            group: "Agent",
            label: "Next board",
            paletteHidden: true,
            when: inGalleryViewer,
            run: () => stepViewerBoard(1),
        },
        {
            id: "canvases:back",
            keys: "Escape",
            group: "Agent",
            label: "Back to the canvases",
            paletteHidden: true,
            // strict like every Escape here; agent:leave-center stands down while a canvas is open (galleryHoldsEscape)
            when: (ctx) => navigateStrict(ctx) && onGallery(ctx) && galleryView() === "viewer",
            run: () => closeCanvas(),
        },
        // Clean up walks the same cards in its own order (the suggested group, then Newer)
        ...(
            [
                ["ArrowLeft", "canvases:cleanup-left", "Previous canvas"],
                ["ArrowRight", "canvases:cleanup-right", "Next canvas"],
                ["ArrowUp", "canvases:cleanup-up", "Canvas above"],
                ["ArrowDown", "canvases:cleanup-down", "Canvas below"],
            ] as const
        ).map(
            ([key, id, label]): Binding => ({
                id,
                keys: key,
                group: "Agent",
                label,
                paletteHidden: true,
                when: inGalleryCleanup,
                run: () => moveCleanupCards(key),
            })
        ),
        {
            id: "canvases:tick",
            keys: "Space",
            group: "Agent",
            label: "Tick or untick the canvas",
            paletteHidden: true,
            when: inGalleryCleanup,
            // an empty list has no card under the cursor, so the key passes
            run: () => toggleCleanupCursor(),
        },
        {
            id: "canvases:cleanup-cancel",
            keys: "Escape",
            group: "Agent",
            label: "Cancel clean up",
            paletteHidden: true,
            // strict like every Escape here; agent:leave-center stands down in clean up (galleryHoldsEscape)
            when: (ctx) => navigateStrict(ctx) && onGallery(ctx) && galleryView() === "cleanup",
            run: () => cancelCleanup(),
        },
        {
            id: "agent:prev",
            keys: "ArrowLeft",
            group: "Agent",
            label: "Previous agent",
            // on a canvas board left and right step the boards; up, down, j and k still move between agents
            when: (ctx) => agentNav(ctx) && !boardReady(ctx),
            run: () => step(-1),
        },
        {
            id: "agent:next",
            keys: "ArrowRight",
            group: "Agent",
            label: "Next agent",
            when: (ctx) => agentNav(ctx) && !boardReady(ctx),
            run: () => step(1),
        },
        // the tree lists agents top to bottom, so up and down move through it; left and right are the older keys
        {
            id: "agent:prev-up",
            keys: "ArrowUp",
            group: "Agent",
            label: "Previous agent",
            when: agentNav,
            run: () => step(-1),
        },
        {
            id: "agent:next-down",
            keys: "ArrowDown",
            group: "Agent",
            label: "Next agent",
            when: agentNav,
            run: () => step(1),
        },
        { id: "agent:prev-k", keys: "k", group: "Agent", label: "Previous agent", when: agentNav, run: () => step(-1) },
        { id: "agent:next-j", keys: "j", group: "Agent", label: "Next agent", when: agentNav, run: () => step(1) },
        {
            id: "agent:toggle-rail",
            keys: "d",
            group: "Agent",
            label: "Toggle agent rail",
            when: nav,
            run: () => globalStore.set(railVisibleAtom, !globalStore.get(railVisibleAtom)),
        },
        {
            id: "agent:initiative",
            keys: "i",
            group: "Agent",
            label: "The agent's initiative",
            // Opens the popover on the focused agent's initiative, or the Link to initiative picker when it has none.
            // The focused agent is in the model's atoms, which a when() cannot read (whenstate.ts), so run() looks
            // it up and lets the key pass when there is nothing to open. Open, the popover's own keys take over
            // (agentNav yields), and `i` there closes it.
            when: nav,
            run: () => {
                const agent = globalStore.get(model.agentsAtom).find((a) => a.id === focusId());
                if (agent == null) {
                    return false;
                }
                if (agent.effortId == null) {
                    return clickThrough("[data-initiative-link]");
                }
                globalStore.set(initiativePopoverAtom, agent.id);
            },
        },
        {
            id: "agent:fullscreen",
            keys: "f",
            group: "Agent",
            label: "Toggle terminal fullscreen",
            when: nav,
            run: () => globalStore.set(terminalFullscreenAtom, !globalStore.get(terminalFullscreenAtom)),
        },
        {
            id: "agent:float",
            keys: "Shift:f",
            group: "Agent",
            label: "Toggle float window",
            when: nav,
            run: () => void toggleFloat(model),
        },
        {
            id: "agent:review",
            keys: "r",
            group: "Agent",
            label: "Review",
            // the focused agent's ask lives in model atoms, which a when() cannot read (whenstate.ts watches
            // module atoms and the focused agent's canvas and review only), so run() checks it and lets the key
            // pass when there is nothing to review. Hidden from the palette for the same reason: its row would be
            // dead on most agents. In review mode r goes back to the terminal (agent:review-close).
            paletteHidden: true,
            when: (ctx) => agentNav(ctx) && docReview()?.mode !== "review",
            run: () => {
                const id = reviewableId();
                if (id == null) {
                    return false;
                }
                openReview(model, id);
            },
        },
        {
            // The leader letter `f` is taken by the Diff surface (GO_TARGETS), so fullscreen needs a
            // chord to stay reachable from inside the TUI. F11 is the universal convention, carries no
            // editor muscle memory, and is not a key a TUI's text input consumes. Deliberately NOT
            // gated on !editable — same shape as close-agent's chord, which stays live in the terminal.
            id: "agent:fullscreen-chord",
            keys: "F11",
            group: "Agent",
            // named apart from agent:fullscreen's "Toggle terminal fullscreen" so the cheat sheet does
            // not show two rows with one label; the parenthetical is what distinguishes this door
            label: "Toggle terminal fullscreen (works inside the terminal)",
            paletteHidden: true, // duplicates agent:fullscreen, which already has a palette row
            when: fullscreenChordActive,
            run: toggleTerminalFullscreen,
        },
        {
            // The same door on both platforms (⌘⇧Enter, iTerm's maximize pane; Ctrl+Shift+Enter on Windows): a Mac
            // keyboard has no F11 of its own, and the system takes Fn+F11 for Show Desktop.
            id: "agent:fullscreen-mod",
            keys: "Mod:Shift:Enter",
            group: "Agent",
            label: "Toggle terminal fullscreen (works inside the terminal)",
            paletteHidden: true, // duplicates agent:fullscreen, which already has a palette row
            when: fullscreenChordActive,
            run: toggleTerminalFullscreen,
        },
        {
            // The terminal panel under the agent folds to a strip and opens again, from inside the terminal too like the
            // other Mod chords. By code, so it is the same key on every layout (the backtick sits elsewhere on some).
            // Active only while a terminal is docked: with none, the key is the terminal's own.
            id: "agent:terminal-panel",
            keys: "Mod:c{Backquote}",
            group: "Agent",
            label: "Fold or open the terminal panel",
            when: (ctx) => ctx.surface === "agent" && !ctx.modalOpen && globalStore.get(dockedTerminalAtom) != null,
            run: () => globalStore.set(terminalDockFoldedAtom, !globalStore.get(terminalDockFoldedAtom)),
        },
        {
            // The header menu's Redraw on a key, from inside the terminal too: the terminal holding the keys (the
            // panel's, or the agent's), else the focused agent's. ⌘R on a Mac only: on Windows Mod+R is Ctrl+R, the
            // shell's reverse search.
            id: "agent:redraw",
            keys: "Mod:r",
            group: "Agent",
            label: "Redraw the terminal",
            when: (ctx) => isMacOS() && ctx.surface === "agent" && !ctx.modalOpen && centerAtRest(),
            run: () => {
                const id = focusId();
                const items = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
                const blockId = focusedTerminalBlockId() ?? items.find((a) => a.id === id)?.blockId;
                if (blockId != null) {
                    redrawTerminal(blockId);
                }
            },
        },
        {
            id: "agent:return-nav",
            keys: "Shift:Escape",
            group: "Agent",
            label: "Return focus to nav",
            when: (ctx) => ctx.surface === "agent" && ctx.editable, // only while the TUI owns focus
            run: () => {
                (document.activeElement as HTMLElement | null)?.blur?.();
                // refocus the surface wrapper (tabIndex=0) so ↑↓/j/k/d/f resume
                document.querySelector<HTMLElement>("[data-cockpit-surface-wrap]")?.focus();
            },
        },
        // c and m change meaning with the canvas's state, so each is two bindings with exclusive when()s
        // and every footer chip keeps a static label; in review mode c is the review's
        {
            id: "agent:canvas-open",
            keys: "c",
            group: "Agent",
            label: "Show the agent's canvas",
            when: (ctx) => agentNav(ctx) && canvas()?.mode === "terminal" && docReview()?.mode !== "review",
            run: () => setAgentView(focusId(), "canvas", Date.now()),
        },
        {
            id: "agent:canvas-close",
            keys: "c",
            group: "Agent",
            label: "Back to the terminal",
            when: inCanvas,
            run: () => setAgentView(focusId(), "terminal", Date.now()),
        },
        {
            // the header's ✓ Close, from inside the terminal too. Whether it is offered is read in run(), not
            // when(): the offer follows the roster, unread counts and runs, none of them a predicate atom
            // (whenstate.ts), so the key is live on the surface and passes to the TUI when nothing is offered
            id: "agent:done-close",
            keys: "Alt:w",
            group: "Agent",
            label: "Close the agent if its header shows Done (works inside the terminal)",
            when: (ctx) => ctx.surface === "agent" && !ctx.modalOpen && centerAtRest(),
            run: () => {
                const agent = doneAgent();
                if (agent == null) {
                    return false;
                }
                confirmCloseSession(agent, model);
            },
        },
        {
            // The bare c and r are typed into the TUI while it holds focus, so the header's Terminal | Canvas | Review
            // control also has a chord that works from inside the terminal, as Alt+1..9 does for the agents
            id: "agent:view-cycle",
            keys: "Alt:c",
            group: "Agent",
            label: "Switch terminal, canvas and review (works inside the terminal)",
            when: (ctx) =>
                ctx.surface === "agent" &&
                !ctx.modalOpen &&
                centerAtRest() &&
                (canvas() != null || docReview() != null),
            run: () => {
                const view =
                    docReview()?.mode === "review" ? "review" : canvas()?.mode === "canvas" ? "canvas" : "terminal";
                const next = nextAgentView(view, canvas() != null, docReview() != null);
                if (next == null) {
                    return false;
                }
                setAgentView(focusId(), next, Date.now());
            },
        },
        {
            id: "agent:canvas-prev",
            keys: "[",
            group: "Agent",
            label: "Previous board",
            when: boardReady,
            run: () => stepCanvasBoard(focusId(), -1),
        },
        {
            id: "agent:canvas-next",
            keys: "]",
            group: "Agent",
            label: "Next board",
            when: boardReady,
            run: () => stepCanvasBoard(focusId(), 1),
        },
        {
            id: "agent:canvas-prev-arrow",
            keys: "ArrowLeft",
            group: "Agent",
            label: "Previous board",
            when: boardReady,
            run: () => stepCanvasBoard(focusId(), -1),
        },
        {
            id: "agent:canvas-next-arrow",
            keys: "ArrowRight",
            group: "Agent",
            label: "Next board",
            when: boardReady,
            run: () => stepCanvasBoard(focusId(), 1),
        },
        {
            id: "agent:mark-start",
            keys: "m",
            group: "Agent",
            label: "Mark parts of the board",
            when: boardReady,
            run: () => setMarking(focusId(), true),
        },
        {
            id: "agent:mark-stop",
            keys: "m",
            group: "Agent",
            label: "Stop marking",
            when: (ctx) => inCanvas(ctx) && canvas()!.marking,
            run: () => setMarking(focusId(), false),
        },
        {
            id: "agent:canvas-send",
            keys: "Mod:Enter",
            group: "Agent",
            label: "Send the marks to the agent",
            // live inside a note input on purpose: the last note is where the user finishes; it stands down in
            // History and a session, which cover the canvas without leaving canvas mode
            when: (ctx) => {
                const s = focusedCanvasMode(model);
                return (
                    ctx.surface === "agent" &&
                    !ctx.modalOpen &&
                    centerAtRest() &&
                    s?.marking === true &&
                    s.marks.length > 0
                );
            },
            run: () => clickThrough("[data-canvas-send]"),
        },
        // a Doc review shown in the terminal's place; each key is live only in review mode, so it never shares a
        // key with the canvas's or the terminal's own
        {
            id: "agent:review-close",
            keys: "r",
            group: "Agent",
            label: "Back to the terminal",
            when: inReview,
            run: () => setAgentView(focusId(), "terminal", Date.now()),
        },
        {
            id: "agent:review-prev",
            keys: "[",
            group: "Agent",
            label: "Previous tab",
            when: (ctx) => inReview(ctx) && docReview()!.doc === "latex",
            run: () => stepDocReviewTab(focusId(), -1),
        },
        {
            id: "agent:review-next",
            keys: "]",
            group: "Agent",
            label: "Next tab",
            when: (ctx) => inReview(ctx) && docReview()!.doc === "latex",
            run: () => stepDocReviewTab(focusId(), 1),
        },
        {
            id: "agent:review-comment",
            keys: "c",
            group: "Agent",
            label: "Comment on the selection",
            when: inReview,
            run: () => clickThrough("[data-doc-review-comment]"),
        },
        {
            id: "agent:review-edit",
            keys: "e",
            group: "Agent",
            label: "Suggest an edit to the selection's paragraph",
            when: inReview,
            run: () => clickThrough("[data-doc-review-edit-sel]"),
        },
        // Ctrl+Enter sends whichever answer is the tray's accent button: Request changes once there is something
        // to send, else Approve. Two bindings with exclusive when()s so the footer chip names the answer
        {
            id: "agent:review-approve",
            keys: "Mod:Enter",
            group: "Agent",
            label: "Approve",
            when: (ctx) => reviewSend(ctx) && !reviewCanRequest(),
            run: sendReview,
        },
        {
            id: "agent:review-request",
            keys: "Mod:Enter",
            group: "Agent",
            label: "Request changes",
            when: (ctx) => reviewSend(ctx) && reviewCanRequest(),
            run: sendReview,
        },
    ];
}

// Diff-surface keys. `c` is the entry gesture the mockup names; Escape is the single exit; Tab jumps
// between the two compare sides. Entering compare needs a cwd and a branch, which only the surface
// knows, so `c` clicks the control the surface already draws (the same clickThrough shape
// buildJarvisBindings uses) rather than duplicating scope resolution here.
export function buildFilesBindings(): Binding[] {
    const on = (ctx: KeyContext) => ctx.surface === "files" && !ctx.editable && !ctx.modalOpen;
    const inCompare = (ctx: KeyContext) => on(ctx) && globalStore.get(compareOnAtom);
    // History keys are off while compare is on: compare has no filter row and draws no graph.
    const inHistory = (ctx: KeyContext) => on(ctx) && !globalStore.get(compareOnAtom);
    const filtering = (ctx: KeyContext) => inHistory(ctx) && anyFilterActive(globalStore.get(historyFiltersAtom));
    return [
        {
            id: "files:filter",
            keys: "/",
            group: "Diff",
            label: "Filter history",
            when: inHistory,
            run: () => {
                const el = document.querySelector<HTMLInputElement>("[data-history-filter]");
                if (el == null) {
                    return false; // no filter row on screen (a failure panel, say) — let the key pass
                }
                el.focus();
            },
        },
        {
            // Shift:g, not bare "g": g is the leader key for the surface chords, and a bare letter
            // that shadows a leader can never fire. The footer shows it as "⇧G".
            id: "files:toggle-graph",
            keys: "Shift:g",
            group: "Diff",
            label: "Toggle graph",
            when: inHistory,
            run: () => globalStore.set(graphOnAtom, !globalStore.get(graphOnAtom)),
        },
        {
            // Shift:d, not bare "d" — bare letters on this surface sit next to the g leader and "/"
            // and would shadow future chords.
            id: "files:toggle-split",
            keys: "Shift:d",
            group: "Diff",
            label: "Split / unified",
            when: on,
            run: () => globalStore.set(splitViewAtom, !globalStore.get(splitViewAtom)),
        },
        {
            id: "files:toggle-whitespace",
            keys: "Shift:w",
            group: "Diff",
            label: "Ignore whitespace",
            when: on,
            run: () => globalStore.set(ignoreWsAtom, !globalStore.get(ignoreWsAtom)),
        },
        {
            // Alt:z as on Code (code:wrap); the choice is per file and shared with Code and the File tab
            id: "files:wrap",
            keys: "Alt:z",
            group: "Diff",
            label: "Toggle word wrap",
            when: on,
            run: () => {
                const abs = globalStore.get(diffWrapPathAtom);
                if (abs === "") {
                    return false; // Review mode or no file open — let the key pass
                }
                toggleWrap(abs);
            },
        },
        {
            id: "files:swap-refs",
            keys: "Shift:s",
            group: "Diff",
            label: "Swap compare refs",
            when: inCompare,
            run: () => {
                const cwd = globalStore.get(filesStateAtom)?.cwd;
                if (!cwd) {
                    return false; // no repository resolved yet — nothing to re-read
                }
                void swapCompareRefs(cwd);
            },
        },
        {
            // Shift+N/Shift+P, not vim's ]c/[c: "[" and "]" already cycle surfaces globally, and
            // claiming either as a leader here would cost that on this surface. Monaco is asked where
            // the next hunk is rather than told — it computed the diff that is on screen.
            id: "files:next-change",
            keys: "Shift:n",
            group: "Diff",
            label: "Next change",
            when: on,
            // no editor mounted (nothing selected, a binary file, still loading) — decline the key
            run: () => gotoChange("next"),
        },
        {
            id: "files:prev-change",
            keys: "Shift:p",
            group: "Diff",
            label: "Previous change",
            when: on,
            run: () => gotoChange("previous"),
        },
        {
            id: "files:toggle-reviewed",
            keys: "v",
            group: "Diff",
            label: "Mark file reviewed",
            when: on,
            // no open file in a listed subject — let the key pass
            run: () => (toggleOpenFile() ? undefined : false),
        },
        {
            id: "files:toggle-history",
            keys: "Shift:h",
            group: "Diff",
            label: "Log tab",
            when: on,
            run: () => {
                globalStore.set(panelTabAtom, "log");
                globalStore.set(panelFoldedAtom, false);
            },
        },
        {
            id: "files:commit-tab",
            keys: "Shift:c",
            group: "Diff",
            label: "Commit tab",
            when: on,
            run: () => {
                globalStore.set(panelTabAtom, "commit");
                globalStore.set(panelFoldedAtom, false);
                // the box is mounted by the render this just asked for, hence the frame
                requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-commit-message]")?.focus());
            },
        },
        {
            id: "files:toggle-sidebar",
            keys: "Shift:b",
            group: "Diff",
            label: "Show / hide the panel",
            when: on,
            // the fold that shows, flipped and kept as the person's own choice
            run: () => globalStore.set(panelFoldedAtom, !globalStore.get(panelShownFoldedAtom)),
        },
        {
            // Escape's order on this surface: clear filters, else leave compare, else go home. The
            // three guards are mutually exclusive by construction (this one requires filters active
            // and compare off), which is what keeps assertNoConflicts passing.
            id: "files:clear-filters",
            keys: "Escape",
            group: "Diff",
            label: "Clear filters",
            when: filtering,
            run: () => clearHistoryFilters(),
        },
        {
            // The mockup's footer says "g h" for top-of-history; g g is the vim idiom for "top".
            id: "files:top",
            keys: "g g",
            group: "Diff",
            label: "Top of history",
            when: inHistory,
            run: () => {
                globalStore.set(historyScrollAtom, 0);
                const el = document.querySelector<HTMLElement>("[data-history-scroll]");
                if (el != null) {
                    el.scrollTop = 0;
                }
            },
        },
        {
            id: "files:compare",
            keys: "c",
            group: "Diff",
            label: "Compare refs",
            when: inHistory,
            run: () => {
                // Compare lives in the Log tab: show it (and the panel) first, then press its button. When the tab is
                // already on screen the button is there to press at once.
                const shown = document.querySelector<HTMLElement>("[data-compare-button]");
                globalStore.set(panelTabAtom, "log");
                globalStore.set(panelFoldedAtom, false);
                if (shown != null) {
                    shown.click();
                    return;
                }
                // the button is mounted by the render this just asked for, hence the frame
                requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-compare-button]")?.click());
            },
        },
        {
            // same key, second meaning: inside compare, c reopens the ref pair rather than re-entering
            id: "files:change-refs",
            keys: "c",
            group: "Diff",
            label: "Change compare refs",
            when: inCompare,
            run: () => {
                const el = document.querySelector<HTMLElement>("[data-ref-pair]");
                if (el == null) {
                    return false;
                }
                el.click();
            },
        },
        {
            id: "files:refresh",
            keys: "r",
            group: "Diff",
            // Both columns, which is why this is no longer "Refresh changes": the change list polls
            // itself, so the reason to press r is usually the half that does not — the commit column.
            label: "Refresh",
            when: on,
            run: () => {
                void reloadChanges(globalStore.get(filesStateAtom)?.cwd ?? null);
                refreshHistory();
                void refreshSidebar();
            },
        },
        {
            // Presses the line review tray's send button rather than sending from here: the tray owns the target, the
            // ask block and the menu of agents. A box holding text, or a button that is disabled or absent, lets the
            // key pass; in a box (editable) the box's own Ctrl+Enter adds the comment.
            id: "files:review-send",
            keys: "Mod:Enter",
            group: "Diff",
            label: "Send line comments",
            when: (ctx) => {
                const reviews = globalStore.get(lineReviewsAtom);
                return on(ctx) && canSendKey(reviews[globalStore.get(activeReviewKeyAtom)]);
            },
            run: () => {
                const el = document.querySelector<HTMLButtonElement>("[data-review-send]");
                if (el == null || el.disabled) {
                    return false;
                }
                el.click();
            },
        },
        {
            id: "files:exit-compare",
            keys: "Escape",
            group: "Diff",
            label: "Back to history",
            when: inCompare,
            run: () => leaveCompare(),
        },
        {
            id: "files:switch-side",
            keys: "Tab",
            group: "Diff",
            label: "Switch compare side",
            when: inCompare,
            run: () => {
                const c = globalStore.get(listNavAtom);
                if (c == null || c.surface !== "files") {
                    return false;
                }
                // the surface publishes its compare rows on the controller; the cast is the seam that
                // keeps listnav.ts free of this surface's row types
                const target = sideJumpTarget((c.rows ?? []) as CompareRow[], globalStore.get(compareSelectionAtom));
                if (target == null) {
                    return false; // the other side has no commits — let Tab do its normal thing
                }
                c.setCursor(target);
            },
        },
    ];
}

export function buildCodeBindings(): Binding[] {
    const on = (ctx: KeyContext) => ctx.surface === "code" && !ctx.editable && !ctx.modalOpen;
    // Live whenever the tree pane holds focus. Focus is read from an atom, not the DOM:
    // store.test.ts evaluates every `when` in vitest's node environment, where document is
    // undefined. !editable matters because the inline name input lives INSIDE the tree — its
    // focusin bubbles, so the atom stays true while you type a filename, and without this gate
    // Enter reaches code:tree-activate first and opens the cursor's file instead of committing
    // the name (n, F2 and Delete are stolen the same way).
    const inTree = (ctx: KeyContext) =>
        ctx.surface === "code" && !ctx.editable && !ctx.modalOpen && globalStore.get(codeTreeFocusedAtom);
    const treeKey = (key: TreeKey) => (): void | boolean => {
        const action = treeKeyAction(globalStore.get(codeRowsAtom), globalStore.get(codeCursorAtom), key);
        switch (action.kind) {
            case "move":
                globalStore.set(codeCursorAtom, action.path);
                return;
            case "toggle":
                toggleDir(action.path);
                return;
            case "open":
                void openPath(action.path);
                return;
            case "none":
                return false; // nothing to do here — let the key pass
        }
    };
    return [
        // Files have no chord of their own: the global "palette" binding owns Ctrl+P and opens the
        // search on its Files scope whenever this surface is active.
        {
            id: "code:back",
            keys: "Alt:ArrowLeft",
            group: "Code",
            label: "Back",
            when: on,
            run: () => {
                void goBack();
            },
        },
        {
            id: "code:forward",
            keys: "Alt:ArrowRight",
            group: "Code",
            label: "Forward",
            when: on,
            run: () => {
                void goForward();
            },
        },
        {
            id: "code:refresh",
            keys: "r",
            group: "Code",
            label: "Refresh the file index",
            when: on,
            run: () => {
                void refreshIndex();
            },
        },
        {
            id: "code:diff",
            keys: "d",
            group: "Code",
            label: "Toggle the diff against HEAD",
            when: on,
            run: () => {
                const mode = globalStore.get(codeViewModeAtom);
                globalStore.set(codeViewModeAtom, mode === "diff" ? "source" : "diff");
            },
        },
        {
            id: "code:wrap",
            keys: "Alt:z",
            group: "Code",
            label: "Toggle word wrap",
            // live while typing in Monaco, as VS Code's Alt+Z is; code:save's comment says why editable is not gated
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: () => (toggleCodeWrap() ? undefined : false),
        },
        {
            id: "code:side",
            // by code, not key, so the chord is the same key on every keyboard layout
            keys: "Mod:c{Backslash}",
            group: "Code",
            label: "Open the file to the side, or close the side column",
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: () => (toggleSide() ? undefined : false),
        },
        {
            id: "code:save",
            keys: "Mod:s",
            group: "Code",
            label: "Save the open file",
            // overwrites the file on disk with the buffer; nothing asks first
            destructive: true,
            // deliberately NOT gated on !ctx.editable: you are typing in Monaco when you press this, so
            // the editable exclusion the bare-letter bindings use would make it unreachable. Same shape
            // as close-agent's chord, which stays live while the terminal has focus.
            when: (ctx) => ctx.surface === "code",
            run: () => {
                void saveCurrent();
            },
        },
        {
            id: "code:tree-next",
            keys: "j",
            group: "Code",
            label: "Next file or folder",
            when: inTree,
            run: treeKey("next"),
        },
        {
            id: "code:tree-prev",
            keys: "k",
            group: "Code",
            label: "Previous file or folder",
            when: inTree,
            run: treeKey("prev"),
        },
        {
            id: "code:tree-next-arrow",
            keys: "ArrowDown",
            group: "Code",
            label: "Next file or folder",
            when: inTree,
            run: treeKey("next"),
        },
        {
            id: "code:tree-prev-arrow",
            keys: "ArrowUp",
            group: "Code",
            label: "Previous file or folder",
            when: inTree,
            run: treeKey("prev"),
        },
        {
            id: "code:tree-collapse",
            keys: "ArrowLeft",
            group: "Code",
            label: "Collapse folder",
            when: inTree,
            run: treeKey("collapse"),
        },
        {
            id: "code:tree-expand",
            keys: "ArrowRight",
            group: "Code",
            label: "Expand folder",
            when: inTree,
            run: treeKey("expand"),
        },
        {
            id: "code:tree-activate",
            keys: "Enter",
            group: "Code",
            label: "Open file / toggle folder",
            when: inTree,
            run: treeKey("activate"),
        },
        {
            id: "code:new-file",
            keys: "n",
            group: "Code",
            label: "New file in the cursor's directory",
            when: inTree,
            run: () => startCreate(false),
        },
        {
            id: "code:new-folder",
            keys: "Shift:n",
            group: "Code",
            label: "New folder in the cursor's directory",
            when: inTree,
            run: () => startCreate(true),
        },
        {
            id: "code:rename",
            keys: "F2",
            group: "Code",
            label: "Rename the cursor row",
            when: inTree,
            run: () => {
                const cursor = globalStore.get(codeCursorAtom);
                if (cursor == null) {
                    return false; // nothing named, so let the key pass
                }
                startRename(cursor);
            },
        },
        {
            id: "code:delete",
            keys: "Delete",
            group: "Code",
            label: "Delete the cursor row",
            when: inTree,
            run: () => {
                const cursor = globalStore.get(codeCursorAtom);
                const row = globalStore.get(codeRowsAtom).find((r) => r.path === cursor);
                if (row == null) {
                    return false;
                }
                confirmDelete(row.path, row.kind === "dir");
            },
        },
        {
            id: "code:search",
            keys: "Mod:Shift:f",
            group: "Code",
            label: "Search file contents",
            // like Ctrl+P and save's Ctrl+S, deliberately NOT gated on !editable:
            // the caret is in Monaco when you want this, so a bare letter would be unreachable
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: () => {
                globalStore.set(codeSearchModeAtom, "search");
                focusCodeSidebarOpener();
                // the pane focuses its input only on mount: nothing remounts it when Search is already
                // showing, and a collapsed sidebar mounts it hidden, where focus() does nothing
                window.requestAnimationFrame(focusCodeSearchInput);
            },
        },
        {
            id: "code:focus-tree",
            keys: "Alt:t",
            group: "Code",
            label: "Focus the file tree",
            // reaching the tree from a writable editor needs a modified key; a bare letter is
            // swallowed by Monaco, which is why the finder moved to Ctrl+P
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: focusCodeTreeFromAnywhere,
        },
        {
            // VS Code's Explorer key, for the same move
            id: "code:focus-tree-explorer",
            keys: "Mod:Shift:e",
            group: "Code",
            label: "Focus the file tree (VS Code's Explorer key)",
            paletteHidden: true, // duplicates code:focus-tree
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: focusCodeTreeFromAnywhere,
        },
        {
            id: "code:focus-editor",
            keys: "Alt:e",
            group: "Code",
            label: "Focus the editor",
            when: (ctx) => ctx.surface === "code" && !ctx.modalOpen,
            run: () => {
                // Both edit-context hosts: the EditContext div Monaco uses by default since 0.52, and
                // the legacy textarea. `.monaco-editor textarea` alone matches the readonly aria-hidden
                // IME textarea first, so focus landed somewhere that swallows every keystroke.
                const host = document.querySelector<HTMLElement>(
                    ".monaco-editor .native-edit-context, .monaco-editor textarea.inputarea"
                );
                if (host == null) {
                    return false; // no editor open — let the key pass
                }
                host.focus();
            },
        },
    ];
}

// The Final check viewer's keys, registered by the viewer itself while it is mounted. Gated on the viewer's own
// atom rather than on !modalOpen: that atom is what makes modalOpen true, which is how these win over the Jarvis
// list's arrows registered before them, and over Escape on the run sheet underneath.
export function buildFinalShotsBindings(handlers: {
    scenario(d: 1 | -1): void;
    shot(d: 1 | -1): void;
    zoom(): void;
    steps(): void;
    close(): void;
}): Binding[] {
    const open = () => globalStore.get(finalShotsViewerOpenAtom);
    const bind = (id: string, keys: string, label: string, run: () => void): Binding => ({
        id: `final-shots:${id}`,
        keys,
        group: "Final check viewer",
        label,
        when: open,
        paletteHidden: true,
        run,
    });
    return [
        bind("prev-scenario", "ArrowUp", "Previous scenario", () => handlers.scenario(-1)),
        bind("next-scenario", "ArrowDown", "Next scenario", () => handlers.scenario(1)),
        bind("prev-shot", "ArrowLeft", "Previous screenshot", () => handlers.shot(-1)),
        bind("next-shot", "ArrowRight", "Next screenshot", () => handlers.shot(1)),
        bind("zoom", "z", "Fit / actual size", handlers.zoom),
        bind("steps", "s", "Show or hide the steps", handlers.steps),
        bind("close", "Escape", "Close the viewer", handlers.close),
    ];
}

// The Jarvis tour's keys, registered by the tour while it shows. Gated on its own atom, which the dispatcher counts
// as modalOpen, so the Brief's list keys and the run sheet's Escape stand down under it.
export function buildJarvisTourBindings(handlers: { next(): void; back(): void; close(): void }): Binding[] {
    const open = () => globalStore.get(tourAtom) != null;
    const bind = (id: string, keys: string, label: string, run: () => void): Binding => ({
        id: `jarvis-tour:${id}`,
        keys,
        group: "Jarvis tour",
        label,
        when: open,
        paletteHidden: true,
        run,
    });
    return [
        bind("next", "ArrowRight", "Next step", handlers.next),
        bind("next-enter", "Enter", "Next step", handlers.next),
        bind("back", "ArrowLeft", "Previous step", handlers.back),
        bind("close", "Escape", "End the tour", handlers.close),
    ];
}
