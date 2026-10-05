// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import {
    buildAgentBindings,
    buildCockpitBindings,
    buildGlobalBindings,
    buildListNavBindings,
} from "@/app/store/keybindings/bindings";
import { listNavAtom } from "@/app/store/keybindings/listnav";
import type { Binding, KeyContext, SurfaceKey } from "@/app/store/keybindings/types";
import { centerModeAtom } from "@/app/view/agents/agentcenter";
import { attachCanvas, detachCanvas, setCanvasMode, setMarking, updateCanvas } from "@/app/view/agents/canvasstore";
import type { OpenTarget } from "@/app/view/jarvis/address";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visibleHints } from "./footer-visible";
import { GLOBAL_HINTS, SURFACE_HINTS, type FooterHint } from "./footerhints";

const nav = (c: KeyContext) => !c.editable && !c.modalOpen && c.surface === "agent";
const bindings: Binding[] = [
    { id: "agent:move", keys: "j", group: "Agent", label: "", when: nav, run: () => {} },
    { id: "palette", keys: "Ctrl:p", group: "Global", label: "", run: () => {} },
    { id: "agent:leave", keys: "Shift:Escape", group: "Agent", label: "", when: (c) => c.surface === "agent" && c.editable, run: () => {} },
];
const surfaceHints: FooterHint[] = [
    { ids: ["agent:move"], glyph: "↑↓", label: "move" },
    { ids: ["agent:leave"], glyph: "⇧Esc", label: "leave" },
    { ids: ["nonexistent"], glyph: "x", label: "ghost" },
];
const globalHints: FooterHint[] = [{ ids: ["palette"], glyph: "⌃P", label: "palette" }];

const rest: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
const term: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };

describe("visibleHints", () => {
    it("at rest shows nav + always-on hints, hides editable-only and dangling ones", () => {
        expect(visibleHints(rest, bindings, surfaceHints, globalHints).map((c) => c.label)).toEqual(["move", "palette"]);
    });

    it("in the terminal drops nav hints and shows editable-surviving ones", () => {
        expect(visibleHints(term, bindings, surfaceHints, globalHints).map((c) => c.label)).toEqual(["leave", "palette"]);
    });

    it("never shows a hint whose binding id does not exist", () => {
        const labels = visibleHints(rest, bindings, surfaceHints, globalHints).map((c) => c.label);
        expect(labels).not.toContain("ghost");
    });

    it("de-dupes a hint referenced by both surface and global tables", () => {
        const s: FooterHint[] = [{ ids: ["palette"], glyph: "⌃P", label: "palette" }];
        const g: FooterHint[] = [{ ids: ["palette"], glyph: "⌃P", label: "palette" }];
        expect(visibleHints(rest, bindings, s, g).filter((c) => c.label === "palette").length).toBe(1);
    });
});

describe("agent canvas mode chips", () => {
    const model = {
        focusIdAtom: atom<string | undefined>("a1") as PrimitiveAtom<string | undefined>,
        surfaceAtom: atom<SurfaceKey>("agent"),
    } as any;
    const real = [...buildGlobalBindings(model), ...buildAgentBindings(model)];
    const chips = () =>
        visibleHints(rest, real, SURFACE_HINTS.agent!, GLOBAL_HINTS).map((c) => `${c.glyph ?? c.keys} ${c.label}`);
    const globals = () => visibleHints(rest, real, [], GLOBAL_HINTS).map((c) => `${c.glyph ?? c.keys} ${c.label}`);

    beforeEach(() => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        updateCanvas("a1", (s) => ({ ...s, status: "ready", boards: [{ name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 }] }));
    });

    afterEach(() => {
        detachCanvas("a1");
        globalStore.set(centerModeAtom, "terminal");
    });

    it("terminal mode with a canvas offers c canvas between full and back", () => {
        expect(chips()).toEqual([
            "↑↓ move",
            "d rail",
            "f full",
            "F11 full",
            "c canvas",
            "esc back",
            "Ctrl:Tab cycle",
            ...globals(),
        ]);
    });

    it("canvas mode shows the agent switches, then terminal, board and mark before the globals", () => {
        setCanvasMode("a1", "canvas", 1);
        expect(chips()).toEqual(["↑↓ move", "Ctrl:Tab cycle", "c terminal", "[ ] board", "m mark", ...globals()]);
    });

    it("marking shows stop marking, then terminal", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        expect(chips()).toEqual(["↑↓ move", "Ctrl:Tab cycle", "m stop marking", "c terminal", ...globals()]);
    });

    it("marking with a mark puts send first", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
        expect(chips()).toEqual(["↑↓ move", "Ctrl:Tab cycle", "Ctrl:Enter send", "m stop marking", "c terminal", ...globals()]);
    });

    it("History and a session offer only esc terminal and cycle: F11 and send stand down, even mid-marking", () => {
        for (const mode of ["history", "session"] as const) {
            globalStore.set(centerModeAtom, mode);
            expect(chips()).toEqual(["esc terminal", "Ctrl:Tab cycle", ...globals()]);
            setCanvasMode("a1", "canvas", 1);
            setMarking("a1", true);
            updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
            expect(chips()).toEqual(["esc terminal", "Ctrl:Tab cycle", ...globals()]);
            setMarking("a1", false);
            setCanvasMode("a1", "terminal", 2);
        }
    });
});

describe("peek chip", () => {
    const model = { surfaceAtom: atom<SurfaceKey>("jarvis") } as any;
    const real = [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildCockpitBindings()];
    const peekChip = (ctx: KeyContext) => visibleHints(ctx, real, [], GLOBAL_HINTS).find((c) => c.label === "peek");
    const jarvis: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    const publish = (peekTarget?: () => OpenTarget | null) =>
        globalStore.set(listNavAtom, {
            surface: "jarvis",
            navigableIds: ["a"],
            cursorId: "a",
            setCursor() {},
            peekTarget,
        });

    afterEach(() => {
        globalStore.set(listNavAtom, null);
    });

    it("shows on a list whose cursor row has a target, lit while ctrl is held", () => {
        publish(() => ({ kind: "run", runId: "r1" }));
        expect(peekChip(jarvis)).toEqual({ glyph: "space · ctrl+click", label: "peek", ctrlLit: true });
    });

    it("hides when the list has nothing to peek, and in a field", () => {
        publish();
        expect(peekChip(jarvis)).toBeUndefined();
        publish(() => null);
        expect(peekChip(jarvis)).toBeUndefined();
        publish(() => ({ kind: "run", runId: "r1" }));
        expect(peekChip({ ...jarvis, editable: true })).toBeUndefined();
    });

    it("shows on the cockpit through its documented Space, which the surface handles itself", () => {
        expect(peekChip({ ...jarvis, surface: "cockpit" })?.label).toBe("peek");
    });
});
