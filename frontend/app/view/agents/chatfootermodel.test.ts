// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    contextLabel,
    contextWarn,
    currentModelAlias,
    EFFORT_CHOICES,
    effortChoice,
    effortCommand,
    footerParts,
    MODE_CHOICES,
    MODEL_CHOICES,
    modeLabel,
    modelCommand,
    modeStep,
    ringDash,
} from "./chatfootermodel";

describe("modeLabel", () => {
    it("names every mode the footer can read", () => {
        expect(modeLabel("default")).toBe("Default");
        expect(modeLabel("acceptEdits")).toBe("Accept edits");
        expect(modeLabel("plan")).toBe("Plan");
        expect(modeLabel("bypassPermissions")).toBe("Bypass permissions");
        expect(modeLabel("auto")).toBe("Auto");
    });
});

describe("contextLabel", () => {
    it("rounds the percentage", () => {
        expect(contextLabel(42.6)).toBe("ctx 43%");
        expect(contextLabel(0)).toBe("ctx 0%");
    });
    it("is null when no usage is known", () => {
        expect(contextLabel(undefined)).toBeNull();
        expect(contextLabel(Number.NaN)).toBeNull();
    });
});

describe("contextWarn", () => {
    it("warns from 80%", () => {
        expect(contextWarn(80)).toBe(true);
        expect(contextWarn(95)).toBe(true);
        expect(contextWarn(79.4)).toBe(false);
        expect(contextWarn(undefined)).toBe(false);
    });
});

describe("footerParts", () => {
    it("keeps the parts that exist, in order", () => {
        expect(footerParts("opus 5.5", 42.6)).toEqual([
            { text: "opus 5.5", warn: false },
            { text: "ctx 43%", warn: false },
        ]);
        expect(footerParts(undefined, 42.6)).toEqual([{ text: "ctx 43%", warn: false }]);
        expect(footerParts("opus 5.5", undefined)).toEqual([{ text: "opus 5.5", warn: false }]);
        expect(footerParts("", undefined)).toEqual([]);
    });
    it("marks a full context", () => {
        expect(footerParts("opus 5.5", 85)[1]).toEqual({ text: "ctx 85%", warn: true });
    });
});

describe("model choices", () => {
    it("finds the current alias in the model name", () => {
        expect(currentModelAlias("Opus 5.5")).toBe("opus");
        expect(currentModelAlias("claude-sonnet-5-5")).toBe("sonnet");
        expect(currentModelAlias("Haiku 5.5")).toBe("haiku");
        expect(currentModelAlias("claude-fable-5-2")).toBe("fable");
        expect(currentModelAlias(undefined)).toBeNull();
        expect(currentModelAlias("gpt-6")).toBeNull();
    });
    it("lists the four families, newest first, each with a full model id", () => {
        expect(MODEL_CHOICES.map((c) => c.alias)).toEqual(["fable", "opus", "sonnet", "haiku"]);
        for (const c of MODEL_CHOICES) {
            expect(c.id.startsWith(`claude-${c.alias}-`)).toBe(true);
        }
    });
    it("types /model with the model id", () => {
        expect(modelCommand("claude-sonnet-5-5")).toBe("/model claude-sonnet-5-5");
    });
});

describe("effort choices", () => {
    it("lists Claude Code's five levels in order", () => {
        expect(EFFORT_CHOICES.map((c) => c.level)).toEqual(["low", "medium", "high", "xhigh", "max"]);
        expect(effortChoice("xhigh").glyph).toBe("◉");
    });
    it("types /effort with the level", () => {
        expect(effortCommand("high")).toBe("/effort high");
        expect(effortCommand("auto")).toBe("/effort auto");
    });
});

describe("modeStep", () => {
    it("stops when the screen shows the target", () => {
        expect(modeStep(["default", "acceptEdits"], "acceptEdits", 1, 2)).toBe("done");
    });
    it("presses again while the target is not reached", () => {
        expect(modeStep(["default"], "plan", 0, 1)).toBe("press");
        expect(modeStep(["default", "acceptEdits"], "plan", 1, 2)).toBe("press");
    });
    it("reads again without pressing while the screen still shows the mode before the press", () => {
        expect(modeStep(["default", "default"], "plan", 1, 2)).toBe("wait");
    });
    it("gives up when an earlier mode comes back before the target", () => {
        expect(modeStep(["default", "acceptEdits", "plan", "default"], "bypassPermissions", 3, 4)).toBe("give-up");
    });
    it("never presses blind: a read that finds no footer stops the loop", () => {
        expect(modeStep([null], "plan", 0, 1)).toBe("no-footer");
        expect(modeStep(["default", null], "plan", 1, 2)).toBe("no-footer");
        // before the caps and the repeat check, too
        expect(modeStep(["default", null], "plan", 6, 12)).toBe("no-footer");
        expect(modeStep([], "plan", 0, 0)).toBe("no-footer");
    });
    it("caps the presses", () => {
        expect(modeStep(["default", "acceptEdits"], "plan", 5, 6)).toBe("press");
        expect(modeStep(["default", "acceptEdits"], "plan", 6, 7)).toBe("give-up");
    });
    it("caps the reads when the screen never redraws", () => {
        expect(modeStep(["default", "default"], "plan", 1, 12)).toBe("give-up");
    });
    it("lists the four modes the menu offers, each with a line", () => {
        expect(MODE_CHOICES.map((m) => m.mode)).toEqual(["default", "acceptEdits", "plan", "auto"]);
        expect(MODE_CHOICES.every((m) => m.note !== "")).toBe(true);
    });
});

describe("ringDash", () => {
    it("is the share of the circle the percent fills", () => {
        expect(ringDash(0, 88)).toBe(0);
        expect(ringDash(50, 88)).toBe(44);
        expect(ringDash(120, 88)).toBe(88);
        expect(ringDash(undefined, 88)).toBeNull();
    });
});
