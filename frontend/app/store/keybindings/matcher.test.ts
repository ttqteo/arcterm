// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { displayKeys, LEADER_ALIASES, leaderChord, matchBinding } from "./matcher";
import type { Binding, KeyContext } from "./types";

// Build a minimal WaveKeyboardEvent literal (keyutil reads these fields directly).
function ev(key: string, mods: Partial<WaveKeyboardEvent> = {}): WaveKeyboardEvent {
    return {
        control: false,
        shift: false,
        cmd: false,
        option: false,
        meta: false,
        alt: false,
        key,
        code: "",
        location: 0,
        repeat: false,
        type: "keydown",
        ...mods,
    } as WaveKeyboardEvent;
}

const navCtx: KeyContext = { surface: "cockpit", editable: false, modalOpen: false, leader: null };
const editCtx: KeyContext = { surface: "cockpit", editable: true, modalOpen: false, leader: null };

function bind(over: Partial<Binding>): Binding {
    return { id: "x", keys: "j", group: "g", label: "l", run: () => {}, ...over };
}

describe("matchBinding", () => {
    it("matches a global chord even when editable", () => {
        const b = bind({ id: "palette", keys: "Ctrl:p", when: () => true });
        const r = matchBinding(ev("p", { control: true }), editCtx, [b]);
        expect(r).toEqual({ kind: "run", binding: b });
    });

    it("does not match a navigate single-key when editable", () => {
        const b = bind({ id: "nav", keys: "j", when: (c) => !c.editable });
        expect(matchBinding(ev("j"), editCtx, [b])).toEqual({ kind: "none" });
    });

    it("matches a navigate single-key when not editable", () => {
        const b = bind({ id: "nav", keys: "j", when: (c) => !c.editable });
        expect(matchBinding(ev("j"), navCtx, [b])).toEqual({ kind: "run", binding: b });
    });

    it("a bare leader letter never enters leader mode, at rest or while editable", () => {
        const b = bind({ id: "go-agent", keys: "g a", when: (c) => !c.editable && !c.modalOpen });
        expect(matchBinding(ev("g"), navCtx, [b])).toEqual({ kind: "none" });
        expect(matchBinding(ev("g"), editCtx, [b])).toEqual({ kind: "none" });
    });

    it("runs the continuation binding when leader is active", () => {
        const b = bind({ id: "go-agent", keys: "g a", when: (c) => !c.editable && !c.modalOpen });
        const ctx: KeyContext = { ...navCtx, leader: "g" };
        expect(matchBinding(ev("a"), ctx, [b])).toEqual({ kind: "run", binding: b });
    });

    it("resets and consumes on an invalid continuation letter", () => {
        const b = bind({ id: "go-agent", keys: "g a", when: (c) => !c.editable && !c.modalOpen });
        const ctx: KeyContext = { ...navCtx, leader: "g" };
        expect(matchBinding(ev("z"), ctx, [b])).toEqual({ kind: "reset" });
    });

    it("resets and re-processes a modifier chord pressed during leader mode", () => {
        const seq = bind({ id: "go-agent", keys: "g a", when: (c) => !c.editable && !c.modalOpen });
        const chord = bind({ id: "s1", keys: "Ctrl:1", when: () => true });
        const ctx: KeyContext = { ...navCtx, leader: "g" };
        expect(matchBinding(ev("1", { control: true }), ctx, [seq, chord])).toEqual({
            kind: "resetAndProcess",
            result: { kind: "run", binding: chord },
        });
    });

    it("returns none when nothing matches", () => {
        expect(matchBinding(ev("q"), navCtx, [bind({ keys: "j" })])).toEqual({ kind: "none" });
    });
});

// The leader-aware guard Task 7 installs on bindings.ts. Reproduced here so these tests exercise the
// real posture rule rather than a simplification of it.
const leaderAware = (c: KeyContext) => (!c.editable || c.leader != null) && !c.modalOpen;

// The alias chord is Mod+G: Ctrl+G on Windows (these tests), Cmd+G on a Mac.
describe("matchBinding — leader reachable from a focused text field", () => {
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("LEADER_ALIASES maps Mod+G to the g leader", () => {
        expect(LEADER_ALIASES["Mod:g"]).toBe("g");
    });

    it("on a Mac the alias is Cmd+G, so Ctrl+G reaches the terminal", () => {
        setPlatform("darwin");
        const b = bind({ id: "go-agent", keys: "g a", when: leaderAware });
        expect(matchBinding(ev("g", { meta: true, cmd: true }), editCtx, [b])).toEqual({
            kind: "enterLeader",
            leader: "g",
        });
        expect(matchBinding(ev("g", { control: true }), editCtx, [b])).toEqual({ kind: "none" });
    });

    it("the alias chord enters leader mode while editable — impossible with a bare prefix", () => {
        const b = bind({ id: "go-agent", keys: "g a", when: leaderAware });
        expect(matchBinding(ev("g", { control: true }), editCtx, [b])).toEqual({
            kind: "enterLeader",
            leader: "g",
        });
    });

    it("the alias works even when NO sequence binding is currently active", () => {
        // The door must not be derived from the when-filtered sequence set: inside the TUI that set is
        // empty, so deriving from it would make the door depend on the thing it exists to open.
        const off = bind({ id: "go-agent", keys: "g a", when: () => false });
        expect(matchBinding(ev("g", { control: true }), editCtx, [off])).toEqual({
            kind: "enterLeader",
            leader: "g",
        });
    });

    // The live registry carries a documentation-only binding on the alias chord (bindings.ts
    // "leader:enter") so the footer and cheat sheet can advertise it. Singles are matched before
    // leader entry, so without the alias pass running FIRST that binding would win the key, its
    // run() would return false, and the dispatcher would neither open the leader nor consume the
    // keystroke — ^G would reach the PTY instead. Every other test here passes either way; only this
    // one distinguishes the two orderings.
    it("a same-chord documentation binding does not swallow the alias door", () => {
        const seq = bind({ id: "go-agent", keys: "g a", when: leaderAware });
        const doc = bind({ id: "leader:enter", keys: "Mod:g", when: (c) => !c.modalOpen, run: () => false });
        expect(matchBinding(ev("g", { control: true }), editCtx, [doc, seq])).toEqual({
            kind: "enterLeader",
            leader: "g",
        });
        expect(matchBinding(ev("g", { control: true }), navCtx, [doc, seq])).toEqual({
            kind: "enterLeader",
            leader: "g",
        });
    });

    it("a bare g does not enter leader mode — Mod+G is the one door", () => {
        const b = bind({ id: "go-agent", keys: "g a", when: leaderAware });
        expect(matchBinding(ev("g"), navCtx, [b])).toEqual({ kind: "none" });
        expect(matchBinding(ev("g"), editCtx, [b])).toEqual({ kind: "none" });
    });

    it("a bare g reaches a single bound to it", () => {
        const seq = bind({ id: "go-agent", keys: "g a", when: leaderAware });
        const single = bind({ id: "grid", keys: "g", when: leaderAware });
        expect(matchBinding(ev("g"), navCtx, [seq, single])).toEqual({ kind: "run", binding: single });
    });

    it("displays a leader sequence as the chord that opens it", () => {
        expect(displayKeys("g c")).toBe("Mod:g c");
        expect(displayKeys("Ctrl:Tab")).toBe("Ctrl:Tab");
        expect(leaderChord("g")).toBe("Mod:g");
    });
});

describe("matchBinding — leader continuations", () => {
    const seqFiles = bind({ id: "go-files", keys: "g f", when: leaderAware });
    const singleRail = bind({ id: "agent:toggle-rail", keys: "d", when: leaderAware });
    const singleFull = bind({ id: "agent:fullscreen", keys: "f", when: leaderAware });
    const leaderEdit: KeyContext = { ...editCtx, leader: "g" };

    it("runs a sequence continuation while editable", () => {
        expect(matchBinding(ev("f"), leaderEdit, [seqFiles])).toEqual({ kind: "run", binding: seqFiles });
    });

    it("falls back to a single when no sequence claims the key", () => {
        expect(matchBinding(ev("d"), leaderEdit, [seqFiles, singleRail])).toEqual({
            kind: "run",
            binding: singleRail,
        });
    });

    // spec decision 9: g f is Files everywhere. Asserted so a future reordering cannot silently flip it.
    it("a sequence beats a single on the same letter — f is Files, not fullscreen", () => {
        expect(matchBinding(ev("f"), leaderEdit, [seqFiles, singleFull])).toEqual({
            kind: "run",
            binding: seqFiles,
        });
    });

    it("resets when neither a sequence nor a single matches", () => {
        expect(matchBinding(ev("z"), leaderEdit, [seqFiles, singleRail])).toEqual({ kind: "reset" });
    });

    // spec decision 8: the case where the singles fallback and the cancel gesture compete.
    it("Escape cancels the leader and does NOT run a registered Escape single", () => {
        const back = bind({ id: "agent:back", keys: "Escape", when: leaderAware });
        expect(matchBinding(ev("Escape"), leaderEdit, [seqFiles, back])).toEqual({ kind: "reset" });
    });

    it("a modifier chord during leader mode still cancels and reprocesses", () => {
        const chord = bind({ id: "s1", keys: "Ctrl:1", when: () => true });
        expect(matchBinding(ev("1", { control: true }), leaderEdit, [seqFiles, chord])).toEqual({
            kind: "resetAndProcess",
            result: { kind: "run", binding: chord },
        });
    });
});
