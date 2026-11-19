import { describe, expect, it } from "vitest";
import { RAIL_ORDER, SURFACE_ORDER } from "./agents";
import { CORE_ITEMS, ITEMS, TOOL_ITEMS } from "./navrail";
import { surfaceChordDigit } from "./surfaceorder";

describe("SURFACE_ORDER", () => {
    it("has exactly 7 entries so Ctrl+1..7 covers every one — no surface is unreachable by chord", () => {
        expect(SURFACE_ORDER).toHaveLength(7);
    });

    it("has no Sessions surface: past conversations are Library's Conversations tab", () => {
        expect(SURFACE_ORDER).not.toContain("sessions");
    });

    it("keeps Usage on Ctrl+4, the tools Code, Diff on Ctrl+5..6, and appends Library as Ctrl+7", () => {
        expect(SURFACE_ORDER.indexOf("usage") + 1).toBe(4);
        expect(SURFACE_ORDER.slice(4)).toEqual(["code", "files", "library"]);
        expect(SURFACE_ORDER.indexOf("library") + 1).toBe(7);
    });

    it("has no Radar surface: it is off the rail and the chords", () => {
        expect(SURFACE_ORDER).not.toContain("radar");
        expect(ITEMS.map((i) => i.key)).not.toContain("radar");
    });

    it("no longer carries the merged-away or removed surfaces", () => {
        expect(SURFACE_ORDER).not.toContain("channels");
        expect(SURFACE_ORDER).not.toContain("graph");
        expect(SURFACE_ORDER).not.toContain("tasks");
        expect(SURFACE_ORDER).not.toContain("vault");
    });

    it("keeps setup and settings off the chords, like the rail's bottom group", () => {
        expect(SURFACE_ORDER).not.toContain("setup");
        expect(SURFACE_ORDER).not.toContain("settings");
    });

    it("keeps Jarvis second — Ctrl+2 is the merged surface", () => {
        expect(SURFACE_ORDER[1]).toBe("jarvis");
    });
});

describe("RAIL_ORDER", () => {
    it("is the rail's visual order, with Library fifth, between Usage and the tools", () => {
        expect(RAIL_ORDER).toEqual(["cockpit", "jarvis", "agent", "usage", "library", "code", "files"]);
    });

    it("matches the nav rail's items exactly, so [ and ] and the start-surface options follow what the person sees", () => {
        expect(ITEMS.map((i) => i.key)).toEqual([...RAIL_ORDER]);
    });

    it("holds the same surfaces as SURFACE_ORDER, in another order: the chord digit is not the rail position", () => {
        expect([...RAIL_ORDER].sort()).toEqual([...SURFACE_ORDER].sort());
        expect(RAIL_ORDER).not.toEqual(SURFACE_ORDER);
    });

    it("groups the rail: the surfaces used all day with Library after Usage, then the tools", () => {
        expect(CORE_ITEMS.map((i) => i.key)).toEqual(["cockpit", "jarvis", "agent", "usage", "library"]);
        expect(TOOL_ITEMS.map((i) => i.key)).toEqual(["code", "files"]);
        expect(ITEMS).toEqual([...CORE_ITEMS, ...TOOL_ITEMS]);
    });

    it("shows the chord digit that works on each rail item while Ctrl is held: Library 7, Code 5, Diff 6", () => {
        expect(surfaceChordDigit("library")).toBe(7);
        expect(surfaceChordDigit("code")).toBe(5);
        expect(surfaceChordDigit("files")).toBe(6);
        expect(RAIL_ORDER.map((k) => surfaceChordDigit(k))).toEqual([1, 2, 3, 4, 7, 5, 6]);
    });

    it("shows no digit on a surface with no chord", () => {
        expect(surfaceChordDigit("setup")).toBeUndefined();
        expect(surfaceChordDigit("settings")).toBeUndefined();
        expect(surfaceChordDigit("app")).toBeUndefined();
    });

    it("names Library on the rail", () => {
        expect(CORE_ITEMS.find((i) => i.key === "library")).toEqual({ key: "library", label: "Library" });
    });
});
