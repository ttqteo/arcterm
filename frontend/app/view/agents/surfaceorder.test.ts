import { describe, expect, it } from "vitest";
import { SURFACE_ORDER } from "./agents";
import { CORE_ITEMS, ITEMS, TOOL_ITEMS } from "./navrail";

describe("SURFACE_ORDER", () => {
    it("has exactly 7 entries so Ctrl+1..7 covers every one — no surface is unreachable by chord", () => {
        expect(SURFACE_ORDER).toHaveLength(7);
    });

    it("has no Sessions surface: past conversations are a centre mode of Agent", () => {
        expect(SURFACE_ORDER).not.toContain("sessions");
    });

    it("puts Usage on Ctrl+4 and the tools Code, Diff, Radar on Ctrl+5..7", () => {
        expect(SURFACE_ORDER.indexOf("usage") + 1).toBe(4);
        expect(SURFACE_ORDER.slice(4)).toEqual(["code", "files", "radar"]);
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

    it("matches the nav rail's order exactly, so the chord numbers line up with what the user sees", () => {
        expect(ITEMS.map((i) => i.key)).toEqual([...SURFACE_ORDER]);
    });

    it("groups the rail: the surfaces used all day, then the tools", () => {
        expect(CORE_ITEMS.map((i) => i.key)).toEqual(["cockpit", "jarvis", "agent", "usage"]);
        expect(TOOL_ITEMS.map((i) => i.key)).toEqual(["code", "files", "radar"]);
        expect(ITEMS).toEqual([...CORE_ITEMS, ...TOOL_ITEMS]);
    });

    it("keeps Jarvis second — Ctrl+2 is the merged surface", () => {
        expect(SURFACE_ORDER[1]).toBe("jarvis");
    });
});
