import { describe, expect, it } from "vitest";
import { dialogPickKeys, sameDialog, screenDialogWanted } from "./screendialog";
import type { TuiDialog } from "./tuiscreen";

const dialog = (title: string, labels: string[], cursor = 1): TuiDialog => ({
    title,
    body: [],
    options: labels.map((label, i) => ({ n: i + 1, label })),
    cursor,
});

describe("screenDialogWanted", () => {
    it("looks while the agent waits on the person and no other card answers", () => {
        expect(screenDialogWanted({ state: "asking" }, false, false)).toBe(true);
        expect(screenDialogWanted({ state: "waiting" }, false, false)).toBe(true);
    });
    it("leaves a permission request to its card and an ask to its choices", () => {
        expect(screenDialogWanted({ state: "waiting" }, true, false)).toBe(false);
        expect(screenDialogWanted({ state: "asking" }, false, true)).toBe(false);
    });
    it("never looks while the agent works, sits idle or sleeps", () => {
        expect(screenDialogWanted({ state: "working" }, false, false)).toBe(false);
        expect(screenDialogWanted({ state: "idle" }, false, false)).toBe(false);
        expect(screenDialogWanted({ state: "asking", sleeping: {} }, false, false)).toBe(false);
    });
});

describe("dialogPickKeys", () => {
    it("types the option's digit", () => {
        expect(dialogPickKeys({ cursor: 1 }, 2)).toBe("2");
    });
    it("walks the arrows past 9", () => {
        expect(dialogPickKeys({ cursor: 8 }, 10)).toBe("\x1b[B\x1b[B\r");
    });
});

describe("sameDialog", () => {
    it("matches the same title and options", () => {
        expect(sameDialog(dialog("Session paused", ["a", "b"]), dialog("Session paused", ["a", "b"], 2))).toBe(true);
    });
    it("tells different dialogs apart", () => {
        expect(sameDialog(dialog("Session paused", ["a", "b"]), dialog("Bash command", ["a", "b"]))).toBe(false);
        expect(sameDialog(dialog("x", ["a", "b"]), dialog("x", ["a", "c"]))).toBe(false);
        expect(sameDialog(null, dialog("x", ["a", "b"]))).toBe(false);
    });
});
