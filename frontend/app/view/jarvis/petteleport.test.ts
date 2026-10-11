// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PET_GRID } from "./petsprite";
import {
    BEAM_CELLS,
    DISC_CELLS,
    ringCells,
    TELEPORT_MS,
    TELEPORT_TAIL_MS,
    teleportFrame,
    type TeleportCell,
    type TeleportKind,
} from "./petteleport";

const KINDS: TeleportKind[] = ["depart", "arrive"];

// every 10ms of a teleport, to its last spark
function frames(kind: TeleportKind) {
    const out = [];
    for (let t = 0; t <= TELEPORT_TAIL_MS[kind] + 20; t += 10) {
        out.push({ t, f: teleportFrame(kind, t) });
    }
    return out;
}

describe("teleportFrame", () => {
    it("starts a departure from the plain pet", () => {
        const { pet, ring, beam, sparks } = teleportFrame("depart", 0);
        expect(pet).toEqual({ scaleX: 1, scaleY: 1, opacity: 1, light: 0 });
        expect(ring.opacity).toBe(0);
        expect(beam.opacity).toBe(0);
        expect(sparks).toEqual([]);
    });
    it("leaves nothing of the pet, the ring or the beam once it has departed", () => {
        const { pet, ring, beam } = teleportFrame("depart", TELEPORT_MS.depart);
        expect(pet.opacity).toBe(0);
        expect(ring.opacity).toBe(0);
        expect(beam.opacity).toBe(0);
    });
    it("turns the pet to light and pulls it up into the beam as it departs", () => {
        const mid = teleportFrame("depart", 240);
        expect(mid.pet.light).toBe(1);
        expect(mid.pet.scaleX).toBeLessThan(1);
        expect(mid.pet.scaleY).toBeGreaterThan(1);
        expect(mid.beam.from).toBe("ground");
        expect(mid.beam.opacity).toBe(1);
    });
    it("starts an arrival with no pet, the beam dropping from above", () => {
        const { pet, beam } = teleportFrame("arrive", 0);
        expect(pet.opacity).toBe(0);
        expect(beam.from).toBe("sky");
    });
    // the plain pet takes over at the end: any scale, light or ring left would jump
    it("ends an arrival on the plain pet", () => {
        const { pet, ring, beam } = teleportFrame("arrive", TELEPORT_MS.arrive);
        expect(pet).toEqual({ scaleX: 1, scaleY: 1, opacity: 1, light: 0 });
        expect(ring.opacity).toBe(0);
        expect(beam.opacity).toBe(0);
    });
    it("lands the pet stretched, then squashes it before it settles", () => {
        expect(teleportFrame("arrive", 150).pet.scaleY).toBeGreaterThan(1);
        expect(teleportFrame("arrive", 250).pet.scaleY).toBeLessThan(1);
        expect(teleportFrame("arrive", 250).pet.scaleX).toBeGreaterThan(1);
    });
    it.each(KINDS)("%s: the sparks are gone by its tail", (kind) => {
        expect(teleportFrame(kind, TELEPORT_TAIL_MS[kind]).sparks).toEqual([]);
        expect(TELEPORT_TAIL_MS[kind]).toBeGreaterThan(TELEPORT_MS[kind]);
    });
    it.each(KINDS)("%s: a time before its start is its start", (kind) => {
        expect(teleportFrame(kind, -50)).toEqual(teleportFrame(kind, 0));
    });
    // the folded pet sits 8px (under three cells) inside its box at the window's edge: a cell further out is cut off
    it.each(KINDS)("%s: draws no more than 2 cells past the pet's grid on any side", (kind) => {
        const cells: TeleportCell[] = [...BEAM_CELLS, ...DISC_CELLS];
        for (const { t, f } of frames(kind)) {
            cells.push(...f.sparks, ...ringCells(t).back, ...ringCells(t).front);
        }
        expect(Math.min(...cells.map((c) => c.x))).toBeGreaterThanOrEqual(-2);
        expect(Math.min(...cells.map((c) => c.y))).toBeGreaterThanOrEqual(-2);
        expect(Math.max(...cells.map((c) => c.x))).toBeLessThanOrEqual(PET_GRID + 1);
        expect(Math.max(...cells.map((c) => c.y))).toBeLessThanOrEqual(PET_GRID + 1);
    });
    it.each(KINDS)("%s: sparks sit on whole cells", (kind) => {
        for (const { f } of frames(kind)) {
            for (const s of f.sparks) {
                expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
            }
        }
    });
});

describe("ringCells", () => {
    it("draws a closed 14x3 ellipse around the feet, its front arc below them", () => {
        const { back, front } = ringCells(0);
        const all = [...back, ...front];
        expect(all).toHaveLength(24);
        expect(new Set(all.map((c) => `${c.x},${c.y}`)).size).toBe(24);
        expect(Math.min(...all.map((c) => c.x))).toBe(1);
        expect(Math.max(...all.map((c) => c.x))).toBe(14);
        expect(front.every((c) => c.y === 16)).toBe(true);
    });
    it("runs one bright head with a short tail round the ring", () => {
        const all = (t: number) => [...ringCells(t).back, ...ringCells(t).front];
        const count = (t: number, token: string) => all(t).filter((c) => c.token === token).length;
        expect(count(0, "--color-teleport-soft")).toBe(1);
        expect(count(0, "--color-teleport")).toBe(3);
        const head = (t: number) => all(t).find((c) => c.token === "--color-teleport-soft");
        expect(head(0)).not.toEqual(head(100));
    });
});

describe("tokens", () => {
    const THEME = readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
    it.each(["--color-teleport-deep", "--color-teleport", "--color-teleport-soft"])("%s is declared", (token) =>
        expect(THEME).toMatch(new RegExp(`^\\s*${token}:`, "m"))
    );
});
