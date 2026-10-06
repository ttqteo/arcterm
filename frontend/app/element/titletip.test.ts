// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { keyDismissesTip, splitTitle } from "./titletip";

describe("splitTitle", () => {
    it("splits a trailing shortcut off the label", () => {
        expect(splitTitle("Hide the review (Esc)")).toEqual({ label: "Hide the review", keys: "Esc" });
        expect(splitTitle("Show the review (R)")).toEqual({ label: "Show the review", keys: "R" });
        expect(splitTitle("Send the marks to the agent (^⏎)")).toEqual({
            label: "Send the marks to the agent",
            keys: "^⏎",
        });
        expect(splitTitle("New conversation (Ctrl+Shift+O)")).toEqual({
            label: "New conversation",
            keys: "Ctrl+Shift+O",
        });
    });

    it("keeps connectors between keys", () => {
        expect(splitTitle("Previous and next board ([ and ])")).toEqual({
            label: "Previous and next board",
            keys: "[ and ]",
        });
        expect(splitTitle("Close terminal — ends the agent (^C twice)")).toEqual({
            label: "Close terminal — ends the agent",
            keys: "^C twice",
        });
    });

    it("leaves a parenthesis of words in the label", () => {
        expect(splitTitle("Remove (keeps files)")).toEqual({ label: "Remove (keeps files)" });
        expect(splitTitle("Dismiss a background agent (transcript kept)")).toEqual({
            label: "Dismiss a background agent (transcript kept)",
        });
    });

    it("keeps a multi-line title whole, splitting only a shortcut at its very end", () => {
        expect(splitTitle("5h 27%\nwk 4%\nOpen Usage")).toEqual({ label: "5h 27%\nwk 4%\nOpen Usage" });
    });

    it("trims", () => {
        expect(splitTitle("  Copy path  ")).toEqual({ label: "Copy path" });
    });
});

describe("keyDismissesTip", () => {
    it("keeps the tip for a modifier pressed alone, so a screenshot chord (⌘⇧4) can capture it", () => {
        for (const key of ["Meta", "Shift", "Control", "Alt", "CapsLock", "Fn", "OS"]) {
            expect(keyDismissesTip(key)).toBe(false);
        }
    });

    it("dismisses for a real key", () => {
        for (const key of ["Escape", "a", "Enter", "Tab", " ", "ArrowDown", "4"]) {
            expect(keyDismissesTip(key)).toBe(true);
        }
    });
});
