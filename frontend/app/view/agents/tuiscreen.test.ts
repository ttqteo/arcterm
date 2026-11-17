import { describe, expect, it } from "vitest";
import {
    splitRules,
    tuiDialog,
    tuiEffort,
    tuiMode,
    tuiPermissionOptions,
    tuiPromptUp,
    tuiScreenTail,
    tuiSelectYes,
} from "./tuiscreen";
import fixtures from "./tuiscreen.fixtures.json";

// The screen as readTermLines gives it on a live terminal: each full-width rule, solid or dashed, joined to the row after
// it, which xterm marked a wrap (read off Claude Code 2.1.3xx on 2026-11-17: "────…────❯ ", "────…──── ⏵⏵ auto mode on").
function joinRules(lines: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(─{8,}|╌{8,})\s*$/.test(lines[i]) && i + 1 < lines.length && lines[i + 1].trim() !== "") {
            out.push(lines[i] + lines[i + 1]);
            i++;
        } else {
            out.push(lines[i]);
        }
    }
    return out;
}

describe("a screen whose rules came back joined to the row after them", () => {
    const screens = Object.entries(fixtures) as [string, string[]][];
    it("joins something in the captured screens, so the cases below test the join", () => {
        expect(screens.filter(([, l]) => joinRules(l).length < l.length).length).toBeGreaterThan(5);
    });
    it.each(screens)("%s reads the same as drawn", (_, lines) => {
        const joined = joinRules(lines);
        expect(tuiMode(joined)).toBe(tuiMode(lines));
        expect(tuiDialog(joined)).toEqual(tuiDialog(lines));
        expect(tuiScreenTail(joined)).toEqual(tuiScreenTail(lines));
    });
    it("keeps a rule with nothing after it as it is", () => {
        expect(splitRules(["─".repeat(20), "╌".repeat(20) + "  "])).toEqual(["─".repeat(20), "╌".repeat(20) + "  "]);
    });
    it("splits a dashed rule off the command it framed", () => {
        expect(splitRules(["╌".repeat(12) + "  echo hi"])).toEqual(["╌".repeat(12), "  echo hi"]);
    });
});

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
    it("reads a footer joined to the box's bottom rule, which xterm marked a wrap", () => {
        const rule = "─".repeat(60);
        const lines = [rule, "❯", rule + "  ⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents"];
        expect(tuiMode(lines)).toBe("auto");
    });
    it("matches case-insensitively", () => {
        expect(tuiMode(["❯", "  ⏸ PLAN MODE ON (shift+tab to cycle)"])).toBe("plan");
    });
});

describe("tuiPromptUp", () => {
    it("sees the footer in every captured screen tuiMode reads, and in none it does not", () => {
        for (const lines of Object.values(fixtures) as string[][]) {
            expect(tuiPromptUp(lines)).toBe(tuiMode(lines) != null);
            expect(tuiPromptUp(joinRules(lines))).toBe(tuiMode(lines) != null);
        }
    });
    it("sees a footer whose mode words no reader knows", () => {
        expect(tuiPromptUp(["❯", "  ⏵⏵ careful mode on (shift+tab to cycle)"])).toBe(true);
        expect(tuiMode(["❯", "  ⏵⏵ careful mode on (shift+tab to cycle)"])).toBeNull();
    });
    it("ignores a glyph quoted mid-row in the conversation", () => {
        expect(tuiPromptUp(["the footer says ⏵⏵ auto mode on", "", "  > ____"])).toBe(false);
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

describe("tuiSelectYes", () => {
    // the Artifact tool's delete consent, laid out as Claude Code 2.1.325 drew it (written from a screenshot, not a capture)
    const artifactDelete = [
        " Artifact(delete · https://claude.ai/artifact/AEM9Fe36i45qw9ra56kSCn)",
        "   ⎿  Waiting…",
        "─────────────────────────────────────────────",
        ' Permanently delete "Oracle Audit Worksheet"?',
        "",
        " ❯ No",
        "   Yes",
        "",
        " Esc to cancel · Tab to amend",
        "",
    ];
    it("moves one row down from No to Yes on the Artifact delete list", () => {
        expect(tuiSelectYes(artifactDelete)).toEqual({ moves: 1, label: "Yes" });
    });
    it("counts from wherever the cursor sits", () => {
        const lines = [" Allow Claude to change it?", "", "   No", " ❯ Yes", "", " Esc to cancel"];
        expect(tuiSelectYes(lines)).toEqual({ moves: 0, label: "Yes" });
        const up = [" Allow?", "   Yes", "   Maybe", " ❯ No", "", " Esc to cancel"];
        expect(tuiSelectYes(up)).toEqual({ moves: -2, label: "Yes" });
    });
    it("reads a numbered dialog by its numbers", () => {
        expect(tuiSelectYes(fixtures.bashDialog)).toEqual({ moves: 0, label: "Yes" });
        const lines = [" Do you want to proceed?", "   1. No", " ❯ 2. Maybe", "   3. Yes, once", "", " Esc to cancel"];
        expect(tuiSelectYes(lines)).toEqual({ moves: 1, label: "Yes, once" });
    });
    it("is null with no list, no Yes, or only the input prompt on screen", () => {
        expect(tuiSelectYes([])).toBeNull();
        expect(tuiSelectYes(fixtures.idle)).toBeNull();
        expect(tuiSelectYes([" Pick one", "", " ❯ No", "   Cancel", ""])).toBeNull();
        expect(tuiSelectYes(["❯ yes please", ""])).toBeNull();
    });
    it("does not take a line of the question for an option", () => {
        // the question sits at the cursor's own indent but past a blank row
        const lines = ["   Yes or no?", "", " ❯ No", "   Yes", ""];
        expect(tuiSelectYes(lines)).toEqual({ moves: 1, label: "Yes" });
    });
});

// the safeguards' pause menu, transcribed row by row from a screenshot of Claude Code 2.1.325 (an 80-column screen)
const RULE = "─".repeat(80);
const pausedDialog = [
    "> tl-861a8776f1b3b7cbd683d93a7b8aea1a77da7dddc73c8cb3",
    "",
    "● Opus 5.5's safeguards stopped the response above · continuing once with that noted",
    "",
    RULE,
    " Session paused",
    "",
    " Opus 5.5's safeguards flagged this session. You may be seeing this for the first",
    " time: Opus 5.5 is more capable and has stronger safeguards as a result, which",
    " can sometimes flag non-cybersecurity work. We're improving these safeguards.",
    "",
    " Details: `[cyber]`",
    "",
    " ❯ 1. Switch to Opus 4.8",
    "   2. Edit prompt and retry with Opus 5.5",
    "",
];

describe("tuiDialog", () => {
    // fixtures.pausedDialog is the real screen: Claude Code 2.1.325's PTY output replayed through xterm (130x52,
    // alternate buffer), the prompt's words swapped out
    it("reads the captured safeguards pause off the whole screen", () => {
        const dialog = tuiDialog(fixtures.pausedDialog);
        expect(dialog?.title).toBe("Session paused");
        expect(dialog?.body).toHaveLength(2);
        // four rows wrapped at the screen's edge, one paragraph
        expect(dialog?.body[0]).toMatch(
            /^Opus 5\.5's safeguards flagged this session\. .* and has stronger safeguards .* learn more: https:\/\/support\.claude\.com\/en\/articles\/8106465$/
        );
        expect(dialog?.body[1]).toBe("Details: `[cyber]`");
        expect(dialog?.options).toEqual([
            { n: 1, label: "Switch to Opus 4.8" },
            { n: 2, label: "Edit prompt and retry with Opus 5.5" },
        ]);
        expect(dialog?.cursor).toBe(1);
    });
    it("misses it on the bottom 40 rows: the dialog sits at the top of a tall screen", () => {
        // why the card reads the whole screen (2026-11-16: the card saw no rule and fell back to the screen's foot)
        expect(tuiDialog(fixtures.pausedDialog.slice(-40))).toBeNull();
    });
    it("reads a dialog no hook reports: its title, its text as paragraphs and its options", () => {
        expect(tuiDialog(pausedDialog)).toEqual({
            title: "Session paused",
            body: [
                "Opus 5.5's safeguards flagged this session. You may be seeing this for the first time: Opus 5.5 is " +
                    "more capable and has stronger safeguards as a result, which can sometimes flag non-cybersecurity " +
                    "work. We're improving these safeguards.",
                "Details: `[cyber]`",
            ],
            options: [
                { n: 1, label: "Switch to Opus 4.8" },
                { n: 2, label: "Edit prompt and retry with Opus 5.5" },
            ],
            cursor: 1,
        });
    });
    it("reads a permission dialog the same way, its dashed rules dropped", () => {
        const dialog = tuiDialog(fixtures.bashDialog);
        expect(dialog?.title).toBe("Bash command");
        expect(dialog?.body).toContain("echo hi > x.txt");
        expect(dialog?.body.at(-1)).toBe("Do you want to proceed?");
        expect(dialog?.options).toHaveLength(4);
    });
    it("keeps the cursor's option", () => {
        const moved = pausedDialog.map((row) =>
            row.startsWith(" ❯ 1.")
                ? "   1. Switch to Opus 4.8"
                : row.startsWith("   2.")
                  ? " ❯ 2. Edit prompt and retry with Opus 5.5"
                  : row
        );
        expect(tuiDialog(moved)?.cursor).toBe(2);
    });
    it("is null on a screen with no dialog", () => {
        expect(tuiDialog(fixtures.idle)).toBeNull();
        expect(tuiDialog(fixtures.working)).toBeNull();
    });
    it("is null for options with no rule over them", () => {
        expect(tuiDialog(pausedDialog.filter((row) => row !== RULE))).toBeNull();
    });
    it("reads the title readTermLines joins onto the full-width rule", () => {
        // xterm marks the row after a full-width rule as its wrap, and the screen reader joins the two
        const joined = pausedDialog.flatMap((row, i) =>
            row === RULE ? [RULE + pausedDialog[i + 1]] : pausedDialog[i - 1] === RULE ? [] : [row]
        );
        expect(joined).toContain(RULE + " Session paused");
        expect(tuiDialog(joined)).toEqual(tuiDialog(pausedDialog));
    });
});

describe("tuiScreenTail", () => {
    it("gives the rows under the last rule, the one it swallowed too", () => {
        const form = ["older reply", RULE + " Enter your API key", "", "   > ____", " Enter to submit · Esc to cancel"];
        expect(tuiScreenTail(form)).toEqual([" Enter your API key", "   > ____", " Enter to submit · Esc to cancel"]);
    });
    it("gives the last rows with no rule on screen", () => {
        expect(tuiScreenTail(["a", "", "b", "Press Enter to continue…", ""])).toEqual([
            "a",
            "b",
            "Press Enter to continue…",
        ]);
    });
});
