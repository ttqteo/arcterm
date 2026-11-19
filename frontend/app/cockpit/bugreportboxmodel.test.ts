// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentInFocus,
    anchorRight,
    buildSavePayload,
    canSend,
    sentTitle,
    waitingLabel,
    type BugReportOpen,
} from "./bugreportboxmodel";

function open(over: Partial<BugReportOpen> = {}): BugReportOpen {
    return {
        kind: "open",
        capture: null,
        surface: "cockpit",
        agent: null,
        ts: 1_700_000_000_000,
        waiting: 0,
        text: "chip gợi ý không hiện",
        sending: false,
        ...over,
    };
}

describe("canSend", () => {
    it("needs a non-space character", () => {
        expect(canSend("", false)).toBe(false);
        expect(canSend("   \n\t ", false)).toBe(false);
        expect(canSend("a", false)).toBe(true);
        expect(canSend("  chip không hiện  ", false)).toBe(true);
    });

    it("is off while a save is in flight, so Ctrl+Enter twice sends once", () => {
        expect(canSend("a", true)).toBe(false);
    });
});

describe("waitingLabel", () => {
    it("reads 'N đang chờ Jarvis' and says nothing at 0", () => {
        expect(waitingLabel(3)).toBe("3 đang chờ Jarvis");
        expect(waitingLabel(1)).toBe("1 đang chờ Jarvis");
        expect(waitingLabel(0)).toBe("");
    });

    it("says nothing for a count that is not a positive whole number", () => {
        expect(waitingLabel(-1)).toBe("");
        expect(waitingLabel(Number.NaN)).toBe("");
    });
});

describe("sentTitle", () => {
    it("names the count the save left waiting", () => {
        expect(sentTitle(4)).toBe("Đã gửi báo lỗi · 4 đang chờ Jarvis");
    });

    it("drops the count when the server reported none", () => {
        expect(sentTitle(0)).toBe("Đã gửi báo lỗi");
    });
});

describe("buildSavePayload", () => {
    it("carries the text trimmed, the press time, the version and commit, the surface and the agent", () => {
        const p = buildSavePayload(
            open({ text: "  chip không hiện\nsau lượt  ", agent: { id: "tab-1", name: "ghi-chu" }, surface: "agent" }),
            "AAAA",
            "0.15.11",
            "6000e1e37"
        );
        expect(p).toEqual({
            text: "chip không hiện\nsau lượt",
            ts: 1_700_000_000_000,
            version: "0.15.11",
            commit: "6000e1e37",
            surface: "agent",
            agent: { id: "tab-1", name: "ghi-chu" },
            screen64: "AAAA",
        });
    });

    it("leaves out what there is none of: no picture, no agent, no commit", () => {
        const p = buildSavePayload(open(), undefined, "0.15.11", "");
        expect(p).toEqual({
            text: "chip gợi ý không hiện",
            ts: 1_700_000_000_000,
            version: "0.15.11",
            surface: "cockpit",
        });
        expect("screen64" in p).toBe(false);
        expect("agent" in p).toBe(false);
        expect("commit" in p).toBe(false);
    });

    it("does not send the box's own bookkeeping", () => {
        const p = buildSavePayload(open({ waiting: 5, error: "x", sending: true }), undefined, "v", "");
        expect(Object.keys(p).sort()).toEqual(["surface", "text", "ts", "version"]);
    });
});

describe("agentInFocus", () => {
    const items = [
        { id: "a1", name: "ghi-chu" },
        { id: "t9", name: "zsh" },
    ];

    it("finds the agent or terminal the focus id names", () => {
        expect(agentInFocus(items, "a1")).toEqual({ id: "a1", name: "ghi-chu" });
        expect(agentInFocus(items, "t9")).toEqual({ id: "t9", name: "zsh" });
    });

    it("is null with no focus or an id that no longer exists", () => {
        expect(agentInFocus(items, undefined)).toBeNull();
        expect(agentInFocus(items, "gone")).toBeNull();
    });
});

describe("anchorRight", () => {
    it("lines the box's right edge up with the button's", () => {
        expect(anchorRight(1200, 1280)).toBe(80);
    });

    it("keeps the box on a narrow window", () => {
        // a button 40px from the left: the box (380px) cannot hang left of it, so it stops 8px from the right edge's far side
        expect(anchorRight(40, 800)).toBe(800 - 380 - 8);
    });

    it("keeps an 8px margin from the right edge", () => {
        expect(anchorRight(1280, 1280)).toBe(8);
    });

    it("falls back when there is no button on screen", () => {
        expect(anchorRight(null, 1280)).toBe(88);
    });
});
