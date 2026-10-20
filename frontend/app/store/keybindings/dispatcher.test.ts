// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { servicesOpenAtom } from "@/app/cockpit/servicespopoverstore";
import { registerModal } from "@/app/modals/modalstack";
import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel, SurfaceKey } from "@/app/view/agents/agents";
import { consumersOpenAtom } from "@/app/view/agents/consumersstore";
import { docReviewAtom } from "@/app/view/agents/docreview";
import type { LauncherKind } from "@/app/view/agents/launcher";
import { machineServersOpenAtom } from "@/app/view/agents/machineserversstore";
import { uploadsLightboxOpenAtom } from "@/app/view/agents/uploadslightboxatom";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
import { tourAtom, tourMenuOpenAtom } from "@/app/view/jarvis/jarvistourstore";
import { floatMiniAtom } from "@/app/view/agents/floatstore";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { dagModalStateAtom } from "@/app/view/orchestrate/dagmodalstate";
import { setPlatform } from "@/util/platformutil";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    buildAgentBindings,
    buildFinalShotsBindings,
    buildGlobalBindings,
    buildJarvisBindings,
    buildJarvisTourBindings,
    buildListNavBindings,
} from "./bindings";
import {
    controlOwnsKey,
    deriveKeyContext,
    focusClaimed,
    initKeybindingDispatcher,
    isEditableTarget,
    ownsKeys,
} from "./dispatcher";
import { listNavAtom } from "./listnav";
import { matchBinding } from "./matcher";
import { bindingsAtom } from "./store";

// Element stubs rather than jsdom: the suite runs in vitest's node environment, and the three fields
// this predicate reads are the whole contract.
function el(tagName: string, opts?: { contentEditable?: boolean; inMonaco?: boolean }): Element {
    return {
        tagName,
        isContentEditable: opts?.contentEditable ?? false,
        closest: (sel: string) => (opts?.inMonaco && sel === ".monaco-editor" ? ({} as Element) : null),
    } as unknown as Element;
}

function ev(key: string): WaveKeyboardEvent {
    return {
        key,
        code: "",
        type: "keydown",
        control: false,
        shift: false,
        cmd: false,
        option: false,
        meta: false,
        alt: false,
        location: 0,
        repeat: false,
    } as WaveKeyboardEvent;
}

describe("isEditableTarget", () => {
    it("reports the form elements and contenteditable hosts", () => {
        expect(isEditableTarget(el("INPUT"))).toBe(true);
        expect(isEditableTarget(el("TEXTAREA"))).toBe(true);
        expect(isEditableTarget(el("SELECT"))).toBe(true);
        expect(isEditableTarget(el("DIV", { contentEditable: true }))).toBe(true);
    });

    it("reports nothing else, including no focus at all", () => {
        expect(isEditableTarget(null)).toBe(false);
        expect(isEditableTarget(el("DIV"))).toBe(false);
        expect(isEditableTarget(el("BUTTON"))).toBe(false);
    });

    // The regression: Monaco 0.52+ focuses a plain <div class="native-edit-context"> (EditContext API),
    // so the tag test alone said "not editable" while the caret was in the Code editor — and bare `r`
    // refreshed the file index out of the middle of a word.
    it("reports Monaco's EditContext host as editable", () => {
        expect(isEditableTarget(el("DIV", { inMonaco: true }))).toBe(true);
    });
});

describe("ownsKeys", () => {
    const at = (owned: boolean) =>
        ({ closest: (sel: string) => (owned && sel === "[data-owns-keys]" ? ({} as Element) : null) }) as unknown as Element;

    it("is true inside a region marked data-owns-keys, false elsewhere and for no element", () => {
        expect(ownsKeys(at(true))).toBe(true);
        expect(ownsKeys(at(false))).toBe(false);
        expect(ownsKeys(null)).toBe(false);
    });
});

describe("focusClaimed", () => {
    const withVisibility = (e: Element, visible: boolean) => Object.assign(e, { checkVisibility: () => visible });
    afterEach(() => vi.unstubAllGlobals());

    it("is claimed by a visible field, so an arriving surface leaves it alone", () => {
        vi.stubGlobal("document", { activeElement: withVisibility(el("INPUT"), true) });
        expect(focusClaimed()).toBe(true);
    });

    // the regression: the Agent surface's xterm textarea, display:none after a switch away, is still
    // activeElement when the next surface mounts, and counting it kept the Cockpit from taking focus
    it("is not claimed by a field on a surface that was just hidden", () => {
        vi.stubGlobal("document", { activeElement: withVisibility(el("TEXTAREA"), false) });
        expect(focusClaimed()).toBe(false);
    });

    it("is not claimed by <body> or a non-field", () => {
        vi.stubGlobal("document", { activeElement: el("BODY") });
        expect(focusClaimed()).toBe(false);
    });

    it("is claimed while a modal is open", () => {
        vi.stubGlobal("document", { activeElement: el("BODY") });
        const unregister = registerModal("focus-claimed-test");
        try {
            expect(focusClaimed()).toBe(true);
        } finally {
            unregister();
        }
    });
});

describe("deriveKeyContext", () => {
    afterEach(() => {
        globalStore.set(dagModalStateAtom, null);
        globalStore.set(docReviewAtom, null);
        globalStore.set(petPeekOpenAtom, false);
        globalStore.set(uploadsLightboxOpenAtom, false);
        globalStore.set(floatMiniAtom, false);
        globalStore.set(contextMenuAtom, null);
        vi.unstubAllGlobals();
    });

    // folded into Sprout, the hidden Agent surface's keys (f, Escape, Shift+F, j/k) ended float behind it
    it("counts the float folded into Sprout as a modal", () => {
        const unbind = bindModel("agent");
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(floatMiniAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    function stubModel(surface: SurfaceKey): AgentsViewModel {
        vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
        vi.stubGlobal("document", { activeElement: null });
        return {
            surfaceAtom: atom<SurfaceKey>(surface),
            paletteOpenAtom: atom(false),
            launcherAtom: atom<LauncherKind | null>(null),
            newInitiativeOpenAtom: atom(false),
            newProjectOpenAtom: atom(false),
        } as unknown as AgentsViewModel;
    }

    function bindModel(surface: SurfaceKey): () => void {
        return initKeybindingDispatcher(stubModel(surface));
    }

    function openDag(): void {
        globalStore.set(dagModalStateAtom, {
            kind: "live",
            channelId: "ch-1",
            runId: "run-1",
            dagOref: "dag:run-1",
            error: "",
        });
    }

    // the Brief's own bindings (Enter submitting an ask, digits, n/r/e/i) took the graph's keys first
    it("counts the DAG modal as a modal on the surface that shows it", () => {
        const unbind = bindModel("jarvis");
        expect(deriveKeyContext().modalOpen).toBe(false);
        openDag();
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // opening a worker from the graph leaves the modal's state set while the Agent surface is up
    it("does not count it on another surface, where it is not mounted", () => {
        const unbind = bindModel("agent");
        openDag();
        expect(deriveKeyContext().modalOpen).toBe(false);
        unbind();
    });

    // the launcher opens from the app bar over any surface; uncounted, the Brief's bare-letter keys stayed live
    // behind it
    it("counts the launcher as a modal", () => {
        const model = stubModel("jarvis");
        const unbind = initKeybindingDispatcher(model);
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(model.launcherAtom, "run");
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // the palette opens New initiative over any surface, not only the Brief
    it("counts the New initiative form as a modal", () => {
        const model = stubModel("agent");
        const unbind = initKeybindingDispatcher(model);
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(model.newInitiativeOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // the Brief's filter menu and row menus: their arrows and Escape belong to the menu, not the list
    it("counts an open context menu as a modal", () => {
        const unbind = bindModel("jarvis");
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(contextMenuAtom, { items: [], x: 0, y: 0 });
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // the avatar popup's item view takes f, Enter and Backspace, which the Agent surface binds too
    it("counts the avatar popup as a modal on every surface", () => {
        const unbind = bindModel("agent");
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(petPeekOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // the review dialog opens over any surface, the Agent surface's terminal included
    it("counts the doc-review dialog as a modal on every surface", () => {
        const unbind = bindModel("agent");
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(docReviewAtom, "agent-1");
        expect(deriveKeyContext().modalOpen).toBe(true);
        unbind();
    });

    // the Uploads lightbox is a ModalShell driven by component state, so only this atom tells the dispatcher
    it("counts the Uploads lightbox as a modal on every surface", () => {
        const unbind = bindModel("agent");
        expect(deriveKeyContext().modalOpen).toBe(false);
        globalStore.set(uploadsLightboxOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        globalStore.set(uploadsLightboxOpenAtom, false);
        expect(deriveKeyContext().modalOpen).toBe(false);
        unbind();
    });

    // a ModalShell dialog with no atom in the list above (the shortcuts cheat sheet, a confirm, the tool detail) let
    // Escape and j/k/d/f act on the surface behind it
    it("counts any open ModalShell dialog as a modal", () => {
        const unbind = bindModel("agent");
        const unregister = registerModal("dispatcher-dialog-test");
        try {
            expect(deriveKeyContext().modalOpen).toBe(true);
        } finally {
            unregister();
        }
        expect(deriveKeyContext().modalOpen).toBe(false);
        unbind();
    });

    // a sheet is scoped to its surface and leaves it switchable, so its surface's keys stay live
    it("does not count an open ModalShell sheet", () => {
        const unbind = bindModel("jarvis");
        const unregister = registerModal("dispatcher-sheet-test", "sheet");
        try {
            expect(deriveKeyContext().modalOpen).toBe(false);
        } finally {
            unregister();
        }
        unbind();
    });

    // the footer's popovers close on their own Escape listener, which runs after this dispatcher's capture handler;
    // uncounted, agent:back took Escape and the popover stayed open
    it("counts the Consumers and Servers popovers as modals", () => {
        const unbind = bindModel("agent");
        globalStore.set(consumersOpenAtom, "ram");
        expect(deriveKeyContext().modalOpen).toBe(true);
        globalStore.set(consumersOpenAtom, null);
        globalStore.set(machineServersOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        globalStore.set(machineServersOpenAtom, false);
        globalStore.set(servicesOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        globalStore.set(servicesOpenAtom, false);
        expect(deriveKeyContext().modalOpen).toBe(false);
        unbind();
    });
});

describe("the Uploads lightbox over the Agent surface", () => {
    afterEach(() => {
        globalStore.set(uploadsLightboxOpenAtom, false);
        vi.unstubAllGlobals();
    });

    // The dispatcher runs on window capture, ahead of ModalShell's own Escape listener, and focus sits on the dialog panel
    // (not a field), so with the lightbox uncounted agent:back took Escape and left for the Cockpit with the lightbox
    // still up, and j/k, the arrows, d and f acted on the agent behind it.
    function setup() {
        vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
        vi.stubGlobal("document", { activeElement: null });
        const model = {
            surfaceAtom: atom<SurfaceKey>("agent"),
            paletteOpenAtom: atom(false),
            launcherAtom: atom<LauncherKind | null>(null),
            newInitiativeOpenAtom: atom(false),
            newProjectOpenAtom: atom(false),
            focusIdAtom: atom<string | undefined>(undefined),
        } as unknown as AgentsViewModel;
        const bindings = [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
        const unbind = initKeybindingDispatcher(model);
        const picked = (key: string) => {
            const r = matchBinding(ev(key), deriveKeyContext(), bindings);
            return r.kind === "run" ? r.binding.id : r.kind;
        };
        return { picked, unbind };
    }

    const AGENT_KEYS: Record<string, string> = {
        Escape: "agent:back",
        ArrowLeft: "agent:prev",
        ArrowRight: "agent:next",
        ArrowUp: "agent:prev-up",
        ArrowDown: "agent:next-down",
        k: "agent:prev-k",
        j: "agent:next-j",
        d: "agent:toggle-rail",
        f: "agent:fullscreen",
        r: "agent:review",
        F11: "agent:fullscreen-chord",
    };

    it("leaves Escape and the agent keys to the dialog while it is open", () => {
        const { picked, unbind } = setup();
        globalStore.set(uploadsLightboxOpenAtom, true);
        for (const key of Object.keys(AGENT_KEYS)) {
            expect(picked(key), key).toBe("none");
        }
        unbind();
    });

    it("gives the keys back to the agent once it is closed", () => {
        const { picked, unbind } = setup();
        for (const [key, id] of Object.entries(AGENT_KEYS)) {
            expect(picked(key), key).toBe(id);
        }
        globalStore.set(uploadsLightboxOpenAtom, true);
        globalStore.set(uploadsLightboxOpenAtom, false);
        for (const [key, id] of Object.entries(AGENT_KEYS)) {
            expect(picked(key), key).toBe(id);
        }
        unbind();
    });
});

describe("the Final check viewer over the Jarvis surface", () => {
    afterEach(() => {
        globalStore.set(finalShotsViewerOpenAtom, false);
        globalStore.set(listNavAtom, null);
        vi.unstubAllGlobals();
    });

    // the Jarvis list's cursor and the Brief's Escape-home, registered first as the surface mounts before the
    // viewer; matchBinding runs the first active binding for a key, so without the viewer counting as a modal
    // the arrows would move the row selection under it and Escape would leave the surface
    function setup() {
        vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
        vi.stubGlobal("document", { activeElement: null });
        const model = {
            surfaceAtom: atom<SurfaceKey>("jarvis"),
            paletteOpenAtom: atom(false),
            launcherAtom: atom<LauncherKind | null>(null),
            newInitiativeOpenAtom: atom(false),
            newProjectOpenAtom: atom(false),
            focusIdAtom: atom<string | undefined>(undefined),
        } as unknown as AgentsViewModel;
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        const finalShots = buildFinalShotsBindings({ scenario() {}, shot() {}, zoom() {}, steps() {}, close() {} });
        const bindings = [
            ...buildGlobalBindings(model),
            ...buildListNavBindings(model),
            ...buildJarvisBindings(model),
            ...finalShots,
        ];
        const unbind = initKeybindingDispatcher(model);
        const picked = (key: string) => {
            const r = matchBinding(ev(key), deriveKeyContext(), bindings);
            return r.kind === "run" ? r.binding.id : r.kind;
        };
        return { picked, unbind };
    }

    it("takes the arrows and Escape while it is open", () => {
        const { picked, unbind } = setup();
        globalStore.set(finalShotsViewerOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        expect(picked("ArrowUp")).toBe("final-shots:prev-scenario");
        expect(picked("ArrowDown")).toBe("final-shots:next-scenario");
        expect(picked("Escape")).toBe("final-shots:close");
        unbind();
    });

    it("leaves them to the surface once it is closed", () => {
        const { picked, unbind } = setup();
        expect(picked("ArrowUp")).toBe("list:prev");
        expect(picked("ArrowDown")).toBe("list:next");
        expect(picked("Escape")).toBe("surface:back-home");
        expect(picked("z")).not.toBe("final-shots:zoom");
        unbind();
    });
});

describe("the Jarvis tour over the Jarvis surface", () => {
    afterEach(() => {
        globalStore.set(tourAtom, null);
        globalStore.set(tourMenuOpenAtom, false);
        globalStore.set(listNavAtom, null);
        vi.unstubAllGlobals();
    });

    // the Jarvis list's cursor and the Brief's Escape-home are registered before the tour's keys; matchBinding runs
    // the first active binding for a key, so without the tour counting as a modal Enter would open the row under the
    // cursor and Escape would leave the surface
    function setup() {
        vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
        vi.stubGlobal("document", { activeElement: null });
        const model = {
            surfaceAtom: atom<SurfaceKey>("jarvis"),
            paletteOpenAtom: atom(false),
            launcherAtom: atom<LauncherKind | null>(null),
            newInitiativeOpenAtom: atom(false),
            newProjectOpenAtom: atom(false),
            focusIdAtom: atom<string | undefined>(undefined),
        } as unknown as AgentsViewModel;
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        const tour = buildJarvisTourBindings({ next() {}, back() {}, close() {} });
        const bindings = [
            ...buildGlobalBindings(model),
            ...buildListNavBindings(model),
            ...buildJarvisBindings(model),
            ...tour,
        ];
        const unbind = initKeybindingDispatcher(model);
        const picked = (key: string) => {
            const r = matchBinding(ev(key), deriveKeyContext(), bindings);
            return r.kind === "run" ? r.binding.id : r.kind;
        };
        return { picked, unbind };
    }

    it("takes →, Enter, ← and Escape while it shows", () => {
        const { picked, unbind } = setup();
        globalStore.set(tourAtom, { track: "brief", index: 0 });
        expect(deriveKeyContext().modalOpen).toBe(true);
        expect(picked("ArrowRight")).toBe("jarvis-tour:next");
        expect(picked("Enter")).toBe("jarvis-tour:next-enter");
        expect(picked("ArrowLeft")).toBe("jarvis-tour:back");
        expect(picked("Escape")).toBe("jarvis-tour:close");
        unbind();
    });

    it("leaves them to the surface once it ends", () => {
        const { picked, unbind } = setup();
        expect(picked("Enter")).toBe("list:activate");
        expect(picked("Escape")).toBe("surface:back-home");
        expect(picked("ArrowRight")).not.toBe("jarvis-tour:next");
        unbind();
    });

    it("leaves Escape to the ? menu while it is open, and keeps the list behind it still", () => {
        const { picked, unbind } = setup();
        globalStore.set(tourMenuOpenAtom, true);
        expect(deriveKeyContext().modalOpen).toBe(true);
        expect(picked("Escape")).not.toBe("surface:back-home");
        expect(picked("Enter")).not.toBe("list:activate");
        unbind();
    });
});

describe("a Vietnamese input method rewriting keys outside a field", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => {
        setPlatform("darwin");
        globalStore.set(bindingsAtom, []);
        vi.unstubAllGlobals();
    });

    // EVKey or Unikey with Telex on: the second d of `dd` arrives as Backspace then "đ", wherever focus is
    function setup(activeElement: Element | null = null) {
        const listeners: Record<string, (e: KeyboardEvent) => void> = {};
        vi.stubGlobal("window", {
            addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => (listeners[type] = fn),
            removeEventListener: () => {},
        });
        vi.stubGlobal("document", { activeElement });
        const ran: string[] = [];
        const bind = (id: string, keys: string) => ({
            id,
            keys,
            group: "Test",
            label: id,
            run: () => void ran.push(id),
        });
        globalStore.set(bindingsAtom, [bind("rail", "d"), bind("jarvis", "g j")]);
        const model = {
            surfaceAtom: atom<SurfaceKey>("agent"),
            paletteOpenAtom: atom(false),
            launcherAtom: atom<LauncherKind | null>(null),
            newInitiativeOpenAtom: atom(false),
            newProjectOpenAtom: atom(false),
        } as unknown as AgentsViewModel;
        const unbind = initKeybindingDispatcher(model);
        // ctrl: Ctrl+G, the go-to leader's chord on Windows (setPlatform below)
        const send = (type: "keydown" | "keypress", key: string, ctrl = false) =>
            listeners[type]({
                type,
                key,
                code: "",
                ctrlKey: ctrl,
                shiftKey: false,
                altKey: false,
                metaKey: false,
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as unknown as KeyboardEvent);
        return { ran, send, unbind };
    }

    it("reads the rewritten letter as the key that made it", () => {
        const { ran, send, unbind } = setup();
        send("keydown", "Backspace");
        send("keydown", "đ");
        expect(ran).toEqual(["rail"]);
        unbind();
    });

    it("reads it off the keypress when its keydown carried no character, once", () => {
        const { ran, send, unbind } = setup();
        send("keydown", "Unidentified");
        send("keypress", "đ");
        send("keydown", "d");
        send("keypress", "d");
        expect(ran).toEqual(["rail", "rail"]);
        unbind();
    });

    it("keeps a pending leader through the Backspace the input method sends", () => {
        const { ran, send, unbind } = setup();
        send("keydown", "g", true);
        send("keydown", "Backspace");
        send("keydown", "j");
        expect(ran).toEqual(["jarvis"]);
        unbind();
    });

    it("leaves the letter alone in a field, where it is text", () => {
        const { ran, send, unbind } = setup(el("TEXTAREA"));
        send("keydown", "đ");
        expect(ran).toEqual([]);
        unbind();
    });
});

describe("a control reached with Tab keeps Enter and Space", () => {
    const button = () => Object.assign(el("BUTTON"), { disabled: false, hasAttribute: () => false });
    const key = (k: string, mods: Partial<WaveKeyboardEvent> = {}) =>
        ({ key: k, code: "", type: "keydown", ...mods }) as WaveKeyboardEvent;

    it("is the tabbed-to button's own Enter and Space", () => {
        const b = button();
        expect(controlOwnsKey(key("Enter"), b, b)).toBe(true);
        expect(controlOwnsKey(key(" "), b, b)).toBe(true);
    });

    it("is not when focus came by a click, with a modifier, for another key, or on a non-control", () => {
        const b = button();
        expect(controlOwnsKey(key("Enter"), b, null)).toBe(false);
        expect(controlOwnsKey(key("Enter", { shift: true }), b, b)).toBe(false);
        expect(controlOwnsKey(key("j"), b, b)).toBe(false);
        const div = el("DIV");
        expect(controlOwnsKey(key("Enter"), div, div)).toBe(false);
        const off = Object.assign(el("BUTTON"), { disabled: true });
        expect(controlOwnsKey(key("Enter"), off, off)).toBe(false);
    });

    // the regression: Tab to a Brief button, press Enter, and list:activate opened the cursor row instead
    describe("through the dispatcher", () => {
        afterEach(() => {
            globalStore.set(listNavAtom, null);
            globalStore.set(bindingsAtom, []);
            vi.unstubAllGlobals();
        });

        function setup() {
            const listeners = new Map<string, (e: unknown) => void>();
            vi.stubGlobal("window", {
                addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
                removeEventListener: () => {},
            });
            const doc = { activeElement: null as Element | null };
            vi.stubGlobal("document", doc);
            const model = {
                surfaceAtom: atom<SurfaceKey>("jarvis"),
                paletteOpenAtom: atom(false),
                newAgentOpenAtom: atom(false),
                newRunOpenAtom: atom(false),
                newInitiativeOpenAtom: atom(false),
                newProjectOpenAtom: atom(false),
                launcherAtom: atom<LauncherKind | null>(null),
                focusIdAtom: atom<string | undefined>(undefined),
            } as unknown as AgentsViewModel;
            const activate = vi.fn();
            globalStore.set(listNavAtom, {
                surface: "jarvis",
                navigableIds: ["a"],
                cursorId: "a",
                setCursor() {},
                activate,
            });
            globalStore.set(bindingsAtom, buildListNavBindings(model));
            const unbind = initKeybindingDispatcher(model);
            const press = (k: string) => {
                const e = { key: k, code: "", type: "keydown", preventDefault: vi.fn(), stopImmediatePropagation() {} };
                listeners.get("keydown")!(e);
                return e.preventDefault.mock.calls.length > 0;
            };
            const focus = (target: Element) => {
                doc.activeElement = target;
                listeners.get("focusin")!({ target });
            };
            const pointer = () => listeners.get("pointerdown")!({});
            return { press, focus, pointer, activate, unbind };
        }

        it("leaves Enter to a button focused with Tab", () => {
            const { press, focus, activate, unbind } = setup();
            const b = button();
            press("Tab");
            focus(b);
            expect(press("Enter")).toBe(false);
            expect(activate).not.toHaveBeenCalled();
            unbind();
        });

        it("still opens the cursor row when the button was focused by a click", () => {
            const { press, focus, pointer, activate, unbind } = setup();
            pointer();
            focus(button());
            expect(press("Enter")).toBe(true);
            expect(activate).toHaveBeenCalledOnce();
            unbind();
        });

        it("hands Enter back to the list once the tabbed-to button is clicked", () => {
            const { press, focus, pointer, activate, unbind } = setup();
            press("Tab");
            focus(button());
            pointer();
            expect(press("Enter")).toBe(true);
            expect(activate).toHaveBeenCalledOnce();
            unbind();
        });

        it("still opens the cursor row once a key other than Tab moved focus", () => {
            const { press, focus, activate, unbind } = setup();
            press("Tab");
            press("j");
            focus(button());
            expect(press("Enter")).toBe(true);
            expect(activate).toHaveBeenCalledOnce();
            unbind();
        });
    });
});
