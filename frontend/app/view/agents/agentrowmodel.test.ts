// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentRowMenuItems,
    clampQuestionIndex,
    entriesToShow,
    isFinishTransition,
    mentionToken,
    muteMode,
    subagentsLabel,
    tasksLabel,
} from "./agentrowmodel";

describe("entriesToShow", () => {
    it("prefers live entries when present", () => {
        expect(entriesToShow([1, 2], [9])).toEqual([1, 2]);
    });
    it("falls back to previousInfo when live is empty", () => {
        expect(entriesToShow([], [9])).toEqual([9]);
    });
    it("falls back to [] when live is empty and previousInfo is absent", () => {
        expect(entriesToShow([], undefined)).toEqual([]);
    });
});

describe("clampQuestionIndex", () => {
    it("defaults an absent index to 0", () => {
        expect(clampQuestionIndex(undefined, 3)).toBe(0);
    });
    it("clamps to the last question", () => {
        expect(clampQuestionIndex(5, 3)).toBe(2);
    });
    it("stays at 0 when there are no questions", () => {
        expect(clampQuestionIndex(2, 0)).toBe(0);
    });
    it("keeps an in-range index", () => {
        expect(clampQuestionIndex(1, 3)).toBe(1);
    });
});

describe("muteMode", () => {
    it("dismisses an idle agent and backgrounds an active one", () => {
        expect(muteMode("idle")).toBe("dismiss");
        expect(muteMode("working")).toBe("background");
        expect(muteMode("asking")).toBe("background");
    });
});

describe("isFinishTransition", () => {
    it("is true only on working -> idle", () => {
        expect(isFinishTransition("working", "idle")).toBe(true);
        expect(isFinishTransition("asking", "idle")).toBe(false);
        expect(isFinishTransition("working", "asking")).toBe(false);
        expect(isFinishTransition("idle", "idle")).toBe(false);
    });
});

describe("agentRowMenuItems", () => {
    it("always includes open, terminal, the two copies, a separator, and a danger close", () => {
        const items = agentRowMenuItems({ hasDiff: false, hasMute: false });
        expect(items).toEqual([
            { key: "open", label: "Open" },
            { key: "terminal", label: "Open terminal" },
            { key: "copy", label: "Copy name" },
            { key: "mention", label: "Copy @mention" },
            { separator: true },
            { key: "close", label: "Close agent", danger: true },
        ]);
    });
    it("adds Review changes when there is a diff", () => {
        const items = agentRowMenuItems({ hasDiff: true, hasMute: false });
        expect(items.some((i) => "key" in i && i.key === "diff" && i.label === "Review changes")).toBe(true);
    });
    it("adds Move to background when a mute action exists", () => {
        const items = agentRowMenuItems({ hasDiff: false, hasMute: true });
        expect(items.some((i) => "key" in i && i.key === "mute" && i.label === "Move to background")).toBe(true);
    });
    it("orders optional items diff -> mute between terminal and copy", () => {
        const items = agentRowMenuItems({ hasDiff: true, hasMute: true });
        const keys = items.map((i) => ("key" in i ? i.key : "sep"));
        expect(keys).toEqual(["open", "terminal", "diff", "mute", "copy", "mention", "sep", "close"]);
    });
});

describe("mentionToken", () => {
    it("is @ and the 8 characters of the tab id wsh agents list prints", () => {
        expect(mentionToken("3f2a91bc-1234-5678-9abc-def012345678")).toBe("@3f2a91bc");
    });
});

describe("chip labels", () => {
    it("names what it counts", () => {
        expect(subagentsLabel(3)).toBe("3 subagents");
        expect(subagentsLabel(1)).toBe("1 subagent");
        expect(tasksLabel(3, 5)).toBe("3/5 tasks");
    });
});
