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
import { setAgentView } from "@/app/view/agents/agentview";
import { attachBrainstorm, detachBrainstorm, openBrainstormBoard } from "@/app/view/agents/brainstormstore";
import { attachCanvas, detachCanvas, setCanvasMode, setMarking, updateCanvas } from "@/app/view/agents/canvasstore";
import type { OpenTarget } from "@/app/view/jarvis/address";
import { setPlatform } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heldHints, visibleHints } from "./footer-visible";
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
    const chips = (ctx: KeyContext = rest) =>
        visibleHints(ctx, real, SURFACE_HINTS.agent!, GLOBAL_HINTS).map((c) => `${c.glyph ?? c.keys} ${c.label}`);
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
            "Mod:Shift:Enter full",
            "c canvas",
            "Alt:c switch view",
            "esc back",
            "Ctrl:Tab switch",
            ...globals(),
        ]);
    });

    it("canvas mode shows the agent switches, then terminal, board and mark before the globals", () => {
        setCanvasMode("a1", "canvas", 1);
        expect(chips()).toEqual([
            "↑↓ move",
            "Alt:c switch view",
            "Ctrl:Tab switch",
            "c terminal",
            "[ ] board",
            "m mark",
            ...globals(),
        ]);
    });

    it("marking shows stop marking, then terminal", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        expect(chips()).toEqual([
            "↑↓ move",
            "Alt:c switch view",
            "Ctrl:Tab switch",
            "m stop marking",
            "c terminal",
            ...globals(),
        ]);
    });

    it("marking with a mark puts send first", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
        expect(chips()).toEqual([
            "↑↓ move",
            "Alt:c switch view",
            "Ctrl:Tab switch",
            "Mod:Enter send",
            "m stop marking",
            "c terminal",
            ...globals(),
        ]);
    });

    it("typing in the terminal drops c canvas and keeps Alt+C, which is typed nowhere", () => {
        const chipsInTerm = chips({ ...rest, editable: true });
        expect(chipsInTerm).toContain("Alt:c switch view");
        expect(chipsInTerm).not.toContain("c canvas");
    });

    it("History, the canvases and a session offer only esc terminal and switch: F11 and send stand down, even mid-marking", () => {
        for (const mode of ["history", "session", "canvases"] as const) {
            globalStore.set(centerModeAtom, mode);
            expect(chips()).toEqual(["esc terminal", "Ctrl:Tab switch", ...globals()]);
            setCanvasMode("a1", "canvas", 1);
            setMarking("a1", true);
            updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
            expect(chips()).toEqual(["esc terminal", "Ctrl:Tab switch", ...globals()]);
            setMarking("a1", false);
            setCanvasMode("a1", "terminal", 2);
        }
    });
});

describe("agent brainstorm mode chips", () => {
    const model = {
        focusIdAtom: atom<string | undefined>("a1") as PrimitiveAtom<string | undefined>,
        surfaceAtom: atom<SurfaceKey>("agent"),
        agentsAtom: atom([]),
    } as any;
    const real = [...buildGlobalBindings(model), ...buildAgentBindings(model)];
    const chips = (ctx: KeyContext = rest) =>
        visibleHints(ctx, real, SURFACE_HINTS.agent!, GLOBAL_HINTS).map((c) => `${c.glyph ?? c.keys} ${c.label}`);
    const globals = () => visibleHints(rest, real, [], GLOBAL_HINTS).map((c) => `${c.glyph ?? c.keys} ${c.label}`);
    // the pane's answer box, which holds focus while the question is up
    const inPane = () =>
        vi.stubGlobal("document", {
            activeElement: { closest: (sel: string) => (sel === "[data-brainstorm-pane]" ? {} : null) },
        });

    beforeEach(() => {
        attachBrainstorm("a1", { topic: "t", cwd: "/p" }, 0);
    });

    afterEach(() => {
        detachBrainstorm("a1");
        vi.unstubAllGlobals();
    });

    it("terminal mode with a brainstorm offers b brainstorm, and the chord that works inside the terminal", () => {
        expect(chips()).toContain("b brainstorm");
        expect(chips()).toContain("Alt:c switch view");
        expect(chips({ ...rest, editable: true })).toContain("Ctrl:Shift:b brainstorm");
        expect(chips({ ...rest, editable: true })).not.toContain("b brainstorm");
    });

    it("brainstorm mode lists the pane's keys: the way back to the terminal, then the globals", () => {
        setAgentView("a1", "brainstorm", 1);
        expect(chips()).toEqual([
            "↑↓ move",
            "Alt:c switch view",
            "Ctrl:Shift:b brainstorm",
            "Ctrl:Tab switch",
            "b terminal",
            ...globals(),
        ]);
    });

    it("with a board or the design open over the question, esc back joins the list", () => {
        setAgentView("a1", "brainstorm", 1);
        openBrainstormBoard("a1", "Split.dc.html");
        expect(chips()).toContain("esc back");
        openBrainstormBoard("a1", null);
        expect(chips()).not.toContain("esc back");
    });

    it("typing in the pane's answer box shows Enter send, and the chord that still leaves", () => {
        setAgentView("a1", "brainstorm", 1);
        inPane();
        const typing = chips({ ...rest, editable: true });
        expect(typing).toContain("⏎ send");
        expect(typing).toContain("Ctrl:Shift:b brainstorm");
        expect(typing).not.toContain("b terminal"); // b types a letter there
    });

    it("Enter send is the pane's alone: not in the terminal, not on another field of the surface", () => {
        expect(chips({ ...rest, editable: true })).not.toContain("⏎ send"); // terminal mode
        setAgentView("a1", "brainstorm", 1);
        vi.stubGlobal("document", { activeElement: { closest: () => null } });
        expect(chips({ ...rest, editable: true })).not.toContain("⏎ send");
        inPane();
        expect(chips(rest)).not.toContain("⏎ send"); // a focused button, not a field
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

    it("shows on a list whose cursor row has a target, lit while the peek key is held", () => {
        publish(() => ({ kind: "run", runId: "r1" }));
        setPlatform("win32");
        expect(peekChip(jarvis)).toEqual({ glyph: "space · ctrl+click", label: "peek", ctrlLit: true });
        // a Mac peeks on Command: its Ctrl+click is the right click
        setPlatform("darwin");
        expect(peekChip(jarvis)).toEqual({ glyph: "space · ⌘-click", label: "peek", ctrlLit: true });
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

describe("heldHints", () => {
    const run = () => {};
    const agentOnly = (c: KeyContext) => c.surface === "agent" && !c.modalOpen;
    const reg: Binding[] = [
        { id: "s1", keys: "Mod:1", group: "Global", label: "Jump to agent", run },
        { id: "s2", keys: "Mod:2", group: "Global", label: "Jump to code", run },
        { id: "s7", keys: "Mod:7", group: "Global", label: "Jump to usage", run },
        { id: "palette", keys: "Mod:p", group: "Global", label: "Search", run },
        { id: "run", keys: "Mod:Shift:r", group: "Global", label: "New run", run },
        { id: "next", keys: "Ctrl:Tab", group: "Agent", label: "Next agent", when: agentOnly, run },
        { id: "a1", keys: "Alt:1", group: "Agent", label: "Jump to agent 1", when: agentOnly, run },
        { id: "a3", keys: "Alt:3", group: "Agent", label: "Jump to agent 3", when: agentOnly, run },
        { id: "cycle", keys: "Alt:c", group: "Agent", label: "Switch view", when: agentOnly, run },
        { id: "go", keys: "g w", group: "Go to", label: "What's waiting", run },
        { id: "move", keys: "j", group: "Agent", label: "Next", run },
    ];

    it("Ctrl lists every chord on it that would fire, the digits as one run", () => {
        expect(heldHints(term, reg, "ctrl", false)).toEqual([
            { keys: "Mod:1", label: "Jump to surface", rangeTo: 7 },
            { keys: "Mod:p", label: "Search" },
            { keys: "Mod:Shift:r", label: "New run" },
            { keys: "Ctrl:Tab", label: "Next agent" },
        ]);
    });

    it("Alt lists only Alt chords, and a chord whose when fails is left out", () => {
        expect(heldHints(term, reg, "alt", false)).toEqual([
            { keys: "Alt:1", label: "Jump to agent", rangeTo: 3 },
            { keys: "Alt:c", label: "Switch view" },
        ]);
        expect(heldHints({ ...term, surface: "code" }, reg, "alt", false)).toEqual([]);
    });

    it("lists a chord two live bindings share once, as the one that fires", () => {
        const shared: Binding[] = [
            { id: "redraw", keys: "Mod:Shift:r", group: "Agent", label: "Redraw the terminal", when: agentOnly, run },
            ...reg,
        ];
        const chips = heldHints(term, shared, "ctrl", false).filter((c) => c.keys === "Mod:Shift:r");
        expect(chips).toEqual([{ keys: "Mod:Shift:r", label: "Redraw the terminal" }]);
    });

    it("on a Mac the held key is Command, so a Control chord is not its own", () => {
        expect(heldHints(term, reg, "ctrl", true).map((c) => c.keys)).not.toContain("Ctrl:Tab");
    });
});
