// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { goneLine, itemButtons, itemHints, itemKeyCommand, openLabel } from "./peekitemmodel";
import type { PeekFacts } from "./peekstore";

describe("itemButtons", () => {
    it("disables Open while the body has not reported (loading)", () => {
        expect(itemButtons("run", null)).toEqual({ open: "disabled" });
    });

    it("disables Open when the target is gone", () => {
        expect(itemButtons("run", { gone: true })).toEqual({ open: "disabled" });
        expect(itemButtons("agent", { gone: true })).toEqual({ open: "disabled" });
    });

    it("enables Open for a present target", () => {
        expect(itemButtons("effort", { gone: false })).toEqual({ open: "enabled" });
    });

    it("gives a note no Open, whatever its body reported", () => {
        for (const facts of [null, { gone: false }, { gone: true }]) {
            expect(itemButtons("note", facts)).toEqual({ open: "absent" });
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
    const labels = (facts: PeekFacts | null) => itemHints("run", facts).map((h) => `${h.keys.join("")} ${h.label}`);

    it("offers open, back and close", () => {
        expect(labels({ gone: false })).toEqual(["↵ open run", "⌫ back", "esc close"]);
        expect(labels(null)).toEqual(["↵ open run", "⌫ back", "esc close"]);
    });

    it("offers a note only back and close", () => {
        const hints = itemHints("note", { gone: false }).map((h) => `${h.keys.join("")} ${h.label}`);
        expect(hints).toEqual(["⌫ back", "esc close"]);
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
