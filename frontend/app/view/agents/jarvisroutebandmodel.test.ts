// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { NO_FOLDER_PROJECT } from "../jarvis/jarvisroute";
import { routeBandLine, typedIntoAgent } from "./jarvisroutebandmodel";
import { NO_FOLDER_LABEL } from "./launcher";

const band = (over: Partial<Parameters<typeof routeBandLine>[0]> = {}) => ({
    project: "api",
    reason: "it names the billing endpoint",
    task: "fix the billing endpoint",
    fresh: false,
    ...over,
});

describe("routeBandLine", () => {
    it("names the project and the reason", () => {
        expect(routeBandLine(band())).toBe("Jarvis chose api because it names the billing endpoint");
    });

    it("drops the because clause when the reason is empty or only spaces", () => {
        expect(routeBandLine(band({ reason: "" }))).toBe("Jarvis chose api");
        expect(routeBandLine(band({ reason: "   " }))).toBe("Jarvis chose api");
    });

    it("shows No folder by its label, not by the key", () => {
        expect(routeBandLine(band({ project: NO_FOLDER_PROJECT, reason: "" }))).toBe(`Jarvis chose ${NO_FOLDER_LABEL}`);
    });

    it("reads a pick the person made", () => {
        expect(routeBandLine(band({ reason: "you picked it" }))).toBe("Jarvis chose api because you picked it");
    });

    it("keeps a multi-line reason on one line", () => {
        expect(routeBandLine(band({ reason: "it names\n  the endpoint " }))).toBe(
            "Jarvis chose api because it names the endpoint"
        );
    });
});

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
});

describe("typedIntoAgent", () => {
    it("counts a character, Enter, Backspace and an arrow", () => {
        for (const k of ["a", "Z", "1", " ", "Enter", "Backspace", "Tab", "ArrowUp", "Delete"]) {
            expect(typedIntoAgent(key(k)), k).toBe(true);
        }
    });

    it("does not count a modifier pressed alone", () => {
        for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock"]) {
            expect(typedIntoAgent(key(k)), k).toBe(false);
        }
        // a modifier pressed alone still reports its own flag on the event
        expect(typedIntoAgent(key("Control", { ctrlKey: true }))).toBe(false);
        expect(typedIntoAgent(key("Alt", { altKey: true }))).toBe(false);
        expect(typedIntoAgent(key("Meta", { metaKey: true }))).toBe(false);
    });

    it("does not count Escape", () => {
        expect(typedIntoAgent(key("Escape"))).toBe(false);
    });

    it("counts a chord, which a terminal receives as input", () => {
        expect(typedIntoAgent(key("c", { ctrlKey: true }))).toBe(true);
        expect(typedIntoAgent(key("b", { altKey: true }))).toBe(true);
        expect(typedIntoAgent(key("v", { metaKey: true }))).toBe(true);
    });
});
