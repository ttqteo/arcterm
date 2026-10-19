// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { anyDialogOpen, anyModalOpen } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { consumersOpenAtom } from "@/app/view/agents/consumersstore";
import { docReviewAtom } from "@/app/view/agents/docreview";
import { floatMiniAtom } from "@/app/view/agents/floatstore";
import { heldAskOpenAtom } from "@/app/view/agents/heldaskpopup";
import { machineServersOpenAtom } from "@/app/view/agents/machineserversstore";
import { tabSwitcherAtom } from "@/app/view/agents/tabswitcherstore";
import { uploadsLightboxOpenAtom } from "@/app/view/agents/uploadslightboxatom";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
import { tourAtom, tourMenuOpenAtom } from "@/app/view/jarvis/jarvistourstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { dagModalStateAtom } from "@/app/view/orchestrate/dagmodalstate";
import * as keyutil from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { telexBaseKey } from "@/util/telexkey";
import { activeLeaderAtom } from "./leaderatom";
import { matchBinding } from "./matcher";
import { bindingsAtom } from "./store";
import type { Binding, KeyContext } from "./types";

let boundModel: AgentsViewModel | null = null;
let leader: string | null = null;
let leaderTimeout: ReturnType<typeof setTimeout> | null = null;
let lastHandledEvent: KeyboardEvent | null = null;
// when the user last pressed any key: the cockpit UI API waits for a quiet moment before it moves the view
// (cockpit/uiclient.ts)
let lastKeyTs = 0;

export function lastKeyActivityTs(): number {
    return lastKeyTs;
}

// A control reached with Tab owns Enter and Space, as it does anywhere on the web: without this the Brief's
// list:activate took Enter from a tabbed-to button and opened the cursor row instead. One focused by a click
// does not, or the chip just pressed with the mouse would take the Enter meant for the list cursor.
let tabbing = false;
let tabbedTo: Element | null = null;

function isPressable(el: Element): boolean {
    const tag = el.tagName;
    return (
        (tag === "BUTTON" && !(el as HTMLButtonElement).disabled) ||
        (tag === "A" && el.hasAttribute("href")) ||
        tag === "SUMMARY"
    );
}

// Exported for its unit test.
export function controlOwnsKey(e: WaveKeyboardEvent, active: Element | null, tabbed: Element | null): boolean {
    if (active == null || active !== tabbed || e.shift || e.control || e.alt || e.meta) {
        return false;
    }
    return (e.key === "Enter" || e.key === " ") && isPressable(active);
}

function setLeader(next: string | null): void {
    leader = next;
    globalStore.set(activeLeaderAtom, next);
    if (leaderTimeout) {
        clearTimeout(leaderTimeout);
        leaderTimeout = null;
    }
    if (next != null) {
        leaderTimeout = setTimeout(() => setLeader(null), CHORD_TIMEOUT);
    }
}

// Exported for its unit test. Getting this wrong is not cosmetic: every bare-letter binding is gated
// on it, so a false negative fires cockpit actions out of the middle of a word.
export function isEditableTarget(el: Element | null): boolean {
    if (el == null) {
        return false;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable) {
        return true;
    }
    // Monaco 0.52+ types into a <div class="native-edit-context"> (the EditContext API) rather than a
    // hidden textarea, and that div is neither a form element nor contenteditable — so the tag test
    // alone called the Code editor "not editable" and bare `r` refreshed the index mid-word, bare `g`
    // opened the leader, and Escape left the surface. Matching the container covers both edit-context
    // implementations and any future swap of the focus target.
    return el.closest?.(".monaco-editor") != null;
}

// A region that handles its own keys (the Agent panel's tab strip, File tab and resize grip) is marked data-owns-keys.
// Focus inside one counts as editable, so the surface's navigation bindings stand down there as they do in a field.
export function ownsKeys(el: Element | null): boolean {
    return el?.closest?.("[data-owns-keys]") != null;
}

// Whether a surface just switched to should leave focus where it is: a visible field or an open modal
// already took it. Visibility matters because a field on the surface just hidden is still activeElement
// until Chromium's next rendering update.
export function focusClaimed(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return (isEditableTarget(active) && active.checkVisibility()) || anyModalOpen();
}

export function deriveKeyContext(): KeyContext {
    const model = boundModel;
    if (model == null) {
        return { surface: "cockpit", editable: false, modalOpen: false, leader };
    }
    const surface = globalStore.get(model.surfaceAtom);
    const modalOpen =
        globalStore.get(model.paletteOpenAtom) ||
        globalStore.get(model.launcherAtom) != null ||
        globalStore.get(model.newInitiativeOpenAtom) ||
        globalStore.get(model.newProjectOpenAtom) ||
        // the DAG modal too: left out, the Brief's bindings underneath took the graph's own keys first
        // (Enter submitted an ask, Escape closed the Chunk sidebar). Only the Brief mounts it, and its state
        // outlives a switch away, since opening a worker from the graph lands on the Agent surface.
        (surface === "jarvis" && globalStore.get(dagModalStateAtom) != null) ||
        globalStore.get(docReviewAtom) != null ||
        // a held card over any surface: its digits answer it, not the surface underneath
        globalStore.get(heldAskOpenAtom) != null ||
        // the avatar popup is window chrome over any surface, and its own keys (Enter, f, Space, Escape) are
        // surface keys too; uncounted, the Agent surface's f toggled fullscreen under an open item
        globalStore.get(petPeekOpenAtom) ||
        // the Final check viewer over the run sheet: its arrows and Escape are its own, not the Brief's list
        globalStore.get(finalShotsViewerOpenAtom) ||
        // the Jarvis tour over the Brief: its arrows, Enter and Escape step the tour, not the list underneath
        globalStore.get(tourAtom) != null ||
        // and its ? menu in the header: Escape closes the menu (useDismiss runs after this capture handler) and Enter
        // and j/k must not act on the list behind it
        globalStore.get(tourMenuOpenAtom) ||
        // the Agent rail's Uploads lightbox is a ModalShell too, but one the dispatcher cannot see (component state);
        // uncounted, Escape left the surface with the lightbox still up, and j/k, the arrows, d and f acted behind it
        globalStore.get(uploadsLightboxOpenAtom) ||
        // and the footer's Consumers and Servers popovers, whose Escape listeners run after this capture handler
        globalStore.get(consumersOpenAtom) != null ||
        globalStore.get(machineServersOpenAtom) ||
        // the float folded into Sprout: the shell is hidden, and its keys (f, Escape, Shift+F, j/k) ended float or
        // changed the agent behind Sprout's back
        globalStore.get(floatMiniAtom) ||
        // the Ctrl+Tab switcher over the terminal: its Escape closes it (switcher:cancel), not the surface underneath
        globalStore.get(tabSwitcherAtom) != null ||
        globalStore.get(modalsModel.modalsAtom).length > 0 ||
        // and every other ModalShell dialog (the cheat sheet, a confirm, the tool detail): without an atom above, Escape
        // and j/k/d/f acted on the surface behind it. A sheet does not count: its surface's keys stay live.
        anyDialogOpen();
    return {
        surface,
        editable: isEditableTarget(document.activeElement) || ownsKeys(document.activeElement),
        modalOpen,
        leader,
    };
}

// Runs a binding; returns whether the key should be consumed (false only when run() returns false).
function runBinding(binding: Binding, ctx: KeyContext): boolean {
    return binding.run(ctx) !== false;
}

// The single entry point. Returns true if the app claimed the key (caller should preventDefault).
export function handleWaveEvent(waveEvent: WaveKeyboardEvent): boolean {
    const nativeEvent = (waveEvent as any).nativeEvent as KeyboardEvent | undefined;
    if (nativeEvent != null && lastHandledEvent === nativeEvent) {
        return false; // already processed (e.g. window-capture then a component-level reinjection)
    }
    if (nativeEvent != null) {
        lastHandledEvent = nativeEvent;
    }
    const ctx = deriveKeyContext();
    const bindings = globalStore.get(bindingsAtom);
    let result = matchBinding(waveEvent, ctx, bindings);
    if (result.kind === "resetAndProcess") {
        setLeader(null);
        result = result.result;
    }
    switch (result.kind) {
        case "enterLeader":
            setLeader(result.leader);
            return true;
        case "reset":
            setLeader(null);
            return true;
        case "run": {
            if (leader != null) {
                setLeader(null);
            }
            return runBinding(result.binding, ctx);
        }
        default:
            return false;
    }
}

// Focus where a letter is a shortcut, not text: outside every field, the terminal and a region that handles its own keys.
function shortcutFocus(): boolean {
    const active = document.activeElement;
    return !isEditableTarget(active) && !ownsKeys(active);
}

export function initKeybindingDispatcher(model: AgentsViewModel): () => void {
    boundModel = model;
    // the key the last keydown carried, so a keypress knows whether that keydown already had the character
    let lastKeydownKey = "";
    const dispatch = (e: KeyboardEvent, waveEvent: WaveKeyboardEvent) => {
        if (handleWaveEvent(waveEvent)) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    };
    const onKeyDown = (e: KeyboardEvent) => {
        lastKeyTs = Date.now();
        lastKeydownKey = e.key;
        tabbing = e.key === "Tab";
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e);
        if (controlOwnsKey(waveEvent, document.activeElement, tabbedTo)) {
            return;
        }
        if (shortcutFocus()) {
            // a Vietnamese input method's hook (EVKey, Unikey) sends a Backspace before each letter it rewrites; no
            // shortcut uses Backspace out here, and passing it on would cancel a pending `g` before its next key
            if (e.key === "Backspace") {
                return;
            }
            // and the rewritten letter ("đ" for the second d) reads as the key that made it (telexkey.ts)
            waveEvent.key = telexBaseKey(e.key) ?? waveEvent.key;
        }
        dispatch(e, waveEvent);
    };
    // A rewritten letter can reach a keydown with no character (key "Unidentified" or "Process") and arrive only as the
    // keypress after it; read it there. A keydown that had a character already ran, or chose not to.
    const onKeyPress = (e: KeyboardEvent) => {
        const base = shortcutFocus() && lastKeydownKey.length !== 1 ? telexBaseKey(e.key) : null;
        if (base == null) {
            return;
        }
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e);
        waveEvent.key = base;
        dispatch(e, waveEvent);
    };
    const onFocusIn = (e: FocusEvent) => {
        tabbedTo = tabbing ? (e.target as Element) : null;
        tabbing = false;
    };
    // a click on the control Tab already focused moves no focus, so it clears the mark itself
    const onPointerDown = () => {
        tabbing = false;
        tabbedTo = null;
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keypress", onKeyPress, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keypress", onKeyPress, true);
        window.removeEventListener("focusin", onFocusIn, true);
        window.removeEventListener("pointerdown", onPointerDown, true);
        boundModel = null;
    };
}
