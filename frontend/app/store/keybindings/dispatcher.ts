// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { anyModalOpen } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { docReviewAtom } from "@/app/view/agents/docreview";
import { uploadsLightboxOpenAtom } from "@/app/view/agents/uploadslightboxatom";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
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
        globalStore.get(model.newAgentOpenAtom) ||
        globalStore.get(model.newRunOpenAtom) ||
        globalStore.get(model.newInitiativeOpenAtom) ||
        globalStore.get(model.newProjectOpenAtom) ||
        // the DAG modal too: left out, the Brief's bindings underneath took the graph's own keys first
        // (Enter submitted an ask, Escape closed the Chunk sidebar). Only the Brief mounts it, and its state
        // outlives a switch away, since opening a worker from the graph lands on the Agent surface.
        (surface === "jarvis" && globalStore.get(dagModalStateAtom) != null) ||
        globalStore.get(docReviewAtom) != null ||
        // the avatar popup is window chrome over any surface, and its own keys (Enter, f, Space, Escape) are
        // surface keys too; uncounted, the Agent surface's f toggled fullscreen under an open item
        globalStore.get(petPeekOpenAtom) ||
        // the Final check viewer over the run sheet: its arrows and Escape are its own, not the Brief's list
        globalStore.get(finalShotsViewerOpenAtom) ||
        // the Agent rail's Uploads lightbox is a ModalShell too, but one the dispatcher cannot see (component state);
        // uncounted, Escape left the surface with the lightbox still up, and j/k, the arrows, d and f acted behind it
        globalStore.get(uploadsLightboxOpenAtom) ||
        globalStore.get(modalsModel.modalsAtom).length > 0;
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
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e);
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
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keypress", onKeyPress, true);
    return () => {
        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keypress", onKeyPress, true);
        boundModel = null;
    };
}
