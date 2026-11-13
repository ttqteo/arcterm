import { describe, expect, it } from "vitest";
import { tuiEffort, tuiMode, tuiPermissionOptions } from "./tuiscreen";
import fixtures from "./tuiscreen.fixtures.json";

// every screen here was captured off Claude Code 2.1.319 (tuiscreen.fixtures.json), not written by hand
describe("tuiMode", () => {
    it("reads the footer Claude Code starts in as auto", () => {
        expect(tuiMode(fixtures.idle)).toBe("auto");
    });
    it("reads each mode Shift+Tab cycles through", () => {
        expect(tuiMode(fixtures.mode1)).toBe("default"); // "manual mode on"
        expect(tuiMode(fixtures.mode2)).toBe("acceptEdits");
        expect(tuiMode(fixtures.mode3)).toBe("plan");
    });
    it("reads bypass permissions", () => {
        expect(tuiMode(fixtures.bypass)).toBe("bypassPermissions");
    });
    it("keeps the mode while a turn runs and the footer adds esc to interrupt", () => {
        expect(tuiMode(fixtures.working)).toBe("auto");
    });
    it("is null while a dialog covers the footer", () => {
        expect(tuiMode(fixtures.bashDialog)).toBeNull();
        expect(tuiMode(fixtures.editDialog)).toBeNull();
    });
    it("is null for an empty screen", () => {
        expect(tuiMode([])).toBeNull();
    });
    it("is null when the box shows no known footer marker, so the chip keeps its last mode", () => {
        expect(tuiMode(["", "─".repeat(40), "❯ /mo", "─".repeat(40), "  /model  Set the AI model"])).toBeNull();
    });
    it("ignores a marker quoted in the conversation above the box", () => {
        const lines = ["the footer says ⏸ plan mode on today", ...fixtures.idle];
        expect(tuiMode(lines)).toBe("auto");
    });
    it("matches case-insensitively", () => {
        expect(tuiMode(["❯", "  ⏸ PLAN MODE ON (shift+tab to cycle)"])).toBe("plan");
    });
});

describe("tuiEffort", () => {
    it("reads the effort line over the input box", () => {
        expect(tuiEffort(fixtures.bypass)).toBe("medium");
    });
    it("is null when the line does not show", () => {
        expect(tuiEffort(fixtures.idle)).toBeNull();
        expect(tuiEffort([])).toBeNull();
    });
    it("reads every level by its glyph's line", () => {
        for (const [glyph, level] of [
            ["○", "low"],
            ["●", "high"],
            ["◉", "xhigh"],
            ["◈", "max"],
        ]) {
            expect(tuiEffort([`        ${glyph} ${level} · /effort`, "─".repeat(40), "❯", "─".repeat(40)])).toBe(level);
        }
    });
    it("ignores an effort line quoted mid-row in the conversation", () => {
        expect(tuiEffort(["it showed ◐ medium · /effort then", "❯"])).toBeNull();
    });
});

describe("tuiPermissionOptions", () => {
    it("lists the Bash dialog's options in screen order, numbered from 1, cursor mark stripped", () => {
        expect(tuiPermissionOptions(fixtures.bashDialog)).toEqual([
            { n: 1, label: "Yes" },
            {
                n: 2,
                label: "Yes, and always allow access to /private/tmp/arcterm-capture/a-longer-directory-name-so-the-option-wraps/project from this project",
            },
            { n: 3, label: "Yes, and switch to auto mode · auto mode handles these prompts for you" },
            { n: 4, label: "No" },
        ]);
    });
    it("lists the edit dialog's options", () => {
        expect(tuiPermissionOptions(fixtures.editDialog)).toEqual([
            { n: 1, label: "Yes" },
            {
                n: 2,
                label: "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)",
            },
            { n: 3, label: "No" },
        ]);
    });
    it("is empty on the idle screen and on []", () => {
        expect(tuiPermissionOptions(fixtures.idle)).toEqual([]);
        expect(tuiPermissionOptions([])).toEqual([]);
    });
    it("joins a label that wraps onto the next row into one", () => {
        const wrapped = tuiPermissionOptions(fixtures.bashDialog)[1].label;
        expect(wrapped.endsWith("project from this project")).toBe(true);
    });
    it("takes the option under the cursor wherever the cursor sits", () => {
        const lines = [" Do you want to proceed?", "   1. Yes", " ❯ 2. Yes, always", "   3. No", "", " Esc to cancel"];
        expect(tuiPermissionOptions(lines)).toEqual([
            { n: 1, label: "Yes" },
            { n: 2, label: "Yes, always" },
            { n: 3, label: "No" },
        ]);
    });
    it("does not read a numbered list in Claude's reply as a dialog", () => {
        const lines = ["⏺ Steps:", "  1. Install it", "  2. Run it", "", ...fixtures.idle];
        expect(tuiPermissionOptions(lines)).toEqual([]);
    });
});
