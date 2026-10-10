// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentFocusFallback } from "./modalfocusfallback";

// Element stubs rather than jsdom: the suite runs in vitest's node environment
function node(opts: { connected?: boolean; inCell?: boolean; visible?: boolean } = {}): HTMLElement {
    const { connected = true, inCell = false, visible = true } = opts;
    return {
        isConnected: connected,
        checkVisibility: () => visible,
        closest: (sel: string) => (inCell && sel === "[data-agent-terminal]" ? ({} as Element) : null),
    } as unknown as HTMLElement;
}

describe("agentFocusFallback", () => {
    const wrap = node();

    // a palette pick replaced the cell whose terminal had focus: typing follows the pick
    it("hands focus to the picked agent's terminal when the old one was hidden in its cell", () => {
        const picked = node();
        expect(agentFocusFallback(node({ inCell: true, visible: false }), picked, wrap)).toBe(picked);
    });

    it("takes the surface when the picked agent's terminal is not showing yet", () => {
        expect(agentFocusFallback(node({ inCell: true, visible: false }), node({ visible: false }), wrap)).toBe(wrap);
        expect(agentFocusFallback(node({ inCell: true, visible: false }), null, wrap)).toBe(wrap);
    });

    // a confirmed close removed the terminal: keys work on the surface, and nothing types into another agent
    it("takes the surface when the old terminal left the document", () => {
        expect(agentFocusFallback(node({ connected: false, inCell: true }), node(), wrap)).toBe(wrap);
    });

    it("takes the surface when focus did not come from a cell", () => {
        expect(agentFocusFallback(node({ visible: false }), node(), wrap)).toBe(wrap);
        expect(agentFocusFallback(null, node(), wrap)).toBe(wrap);
    });
});
