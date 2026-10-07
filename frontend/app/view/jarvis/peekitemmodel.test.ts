// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { goneLine, itemHints, itemKeyCommand, openButton, openLabel } from "./peekitemmodel";

describe("openButton", () => {
    it("is disabled while the body has not reported (loading)", () => {
        expect(openButton("run", null)).toBe("disabled");
    });

    it("is disabled when the target is gone", () => {
        expect(openButton("run", { gone: true })).toBe("disabled");
    });

    it("is enabled for a present target", () => {
        expect(openButton("run", { gone: false })).toBe("enabled");
    });

    it("is absent for a note, whatever its body reported", () => {
        for (const facts of [null, { gone: false }, { gone: true }]) {
            expect(openButton("note", facts)).toBe("absent");
        }
    });
});

describe("openLabel", () => {
    it("names each kind the way the item view does", () => {
        expect(openLabel("run")).toBe("Open run");
        expect(openLabel("agent")).toBe("Open agent");
        expect(openLabel("record")).toBe("Open record");
        expect(openLabel("effort")).toBe("Open initiative");
        expect(openLabel("radar")).toBe("Open finding");
    });

    it("the gone line uses the same word", () => {
        expect(goneLine("effort")).toBe("That initiative no longer exists");
    });
});

describe("itemHints", () => {
    const labels = (kind: Parameters<typeof itemHints>[0]) =>
        itemHints(kind).map((h) => `${h.keys.join("")} ${h.label}`);

    it("offers open, back and close", () => {
        expect(labels("run")).toEqual(["↵ open run", "⌫ back", "esc close"]);
    });

    it("offers a note only back and close", () => {
        expect(labels("note")).toEqual(["⌫ back", "esc close"]);
    });
});

describe("itemKeyCommand", () => {
    it("maps Enter, Backspace and Escape", () => {
        expect(itemKeyCommand("Enter")).toBe("open");
        expect(itemKeyCommand("Backspace")).toBe("back");
        expect(itemKeyCommand("Escape")).toBe("close");
    });

    it("maps nothing else", () => {
        for (const key of ["f", "F", " ", "j", "k", "/", "Delete", "ArrowLeft", "o"]) {
            expect(itemKeyCommand(key)).toBeNull();
        }
    });
});
