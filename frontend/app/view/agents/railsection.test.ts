import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it } from "vitest";
import { clearRailSectionRequest, openRailSection, railSectionRequestAtom } from "./railsection";

afterEach(() => globalStore.set(railSectionRequestAtom, {}));

describe("openRailSection", () => {
    it("asks for one section of one agent's rail, and does not touch another agent's request", () => {
        openRailSection("a-1", "verify");
        openRailSection("a-2", "files");
        expect(globalStore.get(railSectionRequestAtom)).toEqual({ "a-1": "verify", "a-2": "files" });
    });
    it("a later request for the same agent replaces the earlier one", () => {
        openRailSection("a-1", "files");
        openRailSection("a-1", "verify");
        expect(globalStore.get(railSectionRequestAtom)).toEqual({ "a-1": "verify" });
    });
});

describe("clearRailSectionRequest", () => {
    it("clears only the agent's own request, so the same section can be asked for again", () => {
        openRailSection("a-1", "verify");
        openRailSection("a-2", "verify");
        clearRailSectionRequest("a-1");
        expect(globalStore.get(railSectionRequestAtom)).toEqual({ "a-2": "verify" });
        openRailSection("a-1", "verify");
        expect(globalStore.get(railSectionRequestAtom)).toEqual({ "a-1": "verify", "a-2": "verify" });
    });
    it("leaves the state alone when there is nothing to clear", () => {
        const before = globalStore.get(railSectionRequestAtom);
        clearRailSectionRequest("a-9");
        expect(globalStore.get(railSectionRequestAtom)).toBe(before);
    });
});
