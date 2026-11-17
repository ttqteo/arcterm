import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    dialogPickKeys,
    editsPrompt,
    lastPromptText,
    sameCard,
    sameDialog,
    screenCardOf,
    screenWatched,
    type ScreenCard,
} from "./screendialog";
import type { TuiDialog } from "./tuiscreen";
import fixtures from "./tuiscreen.fixtures.json";

const dialog = (title: string, labels: string[], cursor = 1): TuiDialog => ({
    title,
    body: [],
    options: labels.map((label, i) => ({ n: i + 1, label })),
    cursor,
});

const RULE = "─".repeat(80);
const paused = [RULE + " Session paused", "", " Text.", "", " ❯ 1. Switch to Opus 4.8", "   2. Edit prompt and retry"];
// a form no reader knows, covering the mode line
const form = ["reply", RULE + " Enter your API key", "", "   > ____", " Enter to submit · Esc to cancel"];

describe("screenWatched", () => {
    it("reads the screen in any state while no other card answers", () => {
        expect(screenWatched({}, false, false)).toBe(true);
    });
    it("leaves a permission request to its card and an ask to its choices", () => {
        expect(screenWatched({}, true, false)).toBe(false);
        expect(screenWatched({}, false, true)).toBe(false);
    });
    it("never reads a sleeping agent's screen", () => {
        expect(screenWatched({ sleeping: {} }, false, false)).toBe(false);
    });
});

describe("screenCardOf (footer joined to its rule)", () => {
    it("draws no terminal card while the mode line shows, even joined to the box's rule", () => {
        const rule = "─".repeat(60);
        const lines = [rule, "❯", rule + "  ⏵⏵ auto mode on (shift+tab to cycle) · ← 3 agents"];
        expect(screenCardOf(lines, "waiting")).toBeNull();
    });
    it("draws no terminal card for a mode line whose words no reader knows", () => {
        const rule = "─".repeat(60);
        const lines = [rule, "❯", rule, "  ⏵⏵ careful mode on (shift+tab to cycle)"];
        expect(screenCardOf(lines, "asking")).toBeNull();
    });
});

describe("screenCardOf", () => {
    it("draws a dialog in any state, idle and working included", () => {
        for (const state of ["asking", "waiting", "idle", "working", undefined]) {
            expect(screenCardOf(paused, state)?.kind).toBe("dialog");
        }
    });
    it("draws the foot of the screen while the agent waits on the person", () => {
        expect(screenCardOf(form, "asking")).toEqual({
            kind: "terminal",
            rows: [" Enter your API key", "   > ____", " Enter to submit · Esc to cancel"],
        });
        expect(screenCardOf(form, "waiting")?.kind).toBe("terminal");
    });
    it("draws nothing else when the agent does not wait on the person", () => {
        expect(screenCardOf(form, "idle")).toBeNull();
        expect(screenCardOf(form, "working")).toBeNull();
    });
    it("draws nothing while the mode line shows: the prompt is up", () => {
        expect(screenCardOf(fixtures.idle, "asking")).toBeNull();
    });
    it("draws the captured safeguards pause as its dialog, not as the foot of the screen", () => {
        const card = screenCardOf(fixtures.pausedDialog, "asking");
        expect(card?.kind).toBe("dialog");
        expect(card?.kind === "dialog" && card.dialog.title).toBe("Session paused");
    });
    it("draws nothing with no screen to read", () => {
        expect(screenCardOf(null, "asking")).toBeNull();
    });
});

describe("sameCard", () => {
    const d = (title: string): ScreenCard => ({ kind: "dialog", dialog: dialog(title, ["a", "b"]) });
    it("matches the same dialog, and the foot of the screen whatever it shows", () => {
        expect(sameCard(d("x"), d("x"))).toBe(true);
        expect(sameCard({ kind: "terminal", rows: ["a"] }, { kind: "terminal", rows: ["b"] })).toBe(true);
    });
    it("tells different cards apart", () => {
        expect(sameCard(d("x"), d("y"))).toBe(false);
        expect(sameCard(d("x"), { kind: "terminal", rows: ["a"] })).toBe(false);
        expect(sameCard(null, d("x"))).toBe(false);
    });
});

describe("sameDialog", () => {
    it("matches the same title and options, wherever the cursor is", () => {
        expect(sameDialog(dialog("Session paused", ["a", "b"]), dialog("Session paused", ["a", "b"], 2))).toBe(true);
    });
    it("tells different dialogs apart", () => {
        expect(sameDialog(dialog("Session paused", ["a", "b"]), dialog("Bash command", ["a", "b"]))).toBe(false);
        expect(sameDialog(dialog("x", ["a", "b"]), dialog("x", ["a", "c"]))).toBe(false);
        expect(sameDialog(null, dialog("x", ["a", "b"]))).toBe(false);
    });
});

describe("dialogPickKeys", () => {
    it("types the option's digit", () => {
        expect(dialogPickKeys({ cursor: 1 }, 2)).toBe("2");
    });
    it("walks the arrows past 9", () => {
        expect(dialogPickKeys({ cursor: 8 }, 10)).toBe("\x1b[B\x1b[B\r");
    });
    it("walks the arrows in a plain list, which takes no digit", () => {
        expect(dialogPickKeys({ cursor: 2, plain: true }, 1)).toBe("\x1b[A\r");
        expect(dialogPickKeys({ cursor: 2, plain: true }, 2)).toBe("\r");
    });
});

describe("editsPrompt", () => {
    it("knows the option that puts the prompt back to edit", () => {
        expect(editsPrompt("Edit prompt and retry with Opus 5.5")).toBe(true);
        expect(editsPrompt("Edit your prompt")).toBe(true);
    });
    it("leaves every other option alone", () => {
        expect(editsPrompt("Switch to Opus 4.8")).toBe(false);
        expect(editsPrompt("Yes, allow edits")).toBe(false);
    });
});

describe("lastPromptText", () => {
    it("gives the person's last message", () => {
        const entries: AgentEntry[] = [
            { kind: "user", text: "first" },
            { kind: "message", text: "reply" } as AgentEntry,
            { kind: "user", text: "newkey from amd" },
        ];
        expect(lastPromptText(entries)).toBe("newkey from amd");
    });
    it("is null with no message", () => {
        expect(lastPromptText([])).toBeNull();
    });
});
