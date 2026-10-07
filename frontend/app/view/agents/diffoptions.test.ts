// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { LABELLED_MIN_PX, paneHeaderLayout, paneOptions, SPLIT_MIN_PX } from "./diffoptions";

describe("the diff pane's view switches", () => {
    it("asks for two editors only when split is on", () => {
        expect(paneOptions(true, false, false).renderSideBySide).toBe(true);
        expect(paneOptions(false, false, false).renderSideBySide).toBe(false);
    });

    // Monaco's own default is to ignore it, which renders a whitespace-only change as no change at
    // all while the counts in the same header read +2 -2. The pane has to say what git said.
    it("shows whitespace-only changes unless asked not to", () => {
        expect(paneOptions(false, false, false).ignoreTrimWhitespace).toBe(false);
        expect(paneOptions(false, true, false).ignoreTrimWhitespace).toBe(true);
    });

    it("wraps long lines only when asked", () => {
        expect(paneOptions(false, false, false).wordWrap).toBe("off");
        expect(paneOptions(false, false, true).wordWrap).toBe("on");
    });

    it("never lets either side be typed into", () => {
        const o = paneOptions(true, true, false);
        expect(o.readOnly).toBe(true);
        expect(o.originalEditable).toBe(false);
    });
});

describe("the pane header's layout at a measured width", () => {
    it("drops split and labels on a narrow pane", () => {
        expect(paneHeaderLayout(760)).toEqual({ split: false, labelled: false });
    });
    it("offers split before it can afford labels", () => {
        expect(paneHeaderLayout(SPLIT_MIN_PX)).toEqual({ split: true, labelled: false });
        expect(paneHeaderLayout(LABELLED_MIN_PX - 1)).toEqual({ split: true, labelled: false });
    });
    it("labels the buttons once the pane is wide enough", () => {
        expect(paneHeaderLayout(LABELLED_MIN_PX)).toEqual({ split: true, labelled: true });
    });
    it("treats an unmeasured pane as narrow", () => {
        expect(paneHeaderLayout(0)).toEqual({ split: false, labelled: false });
    });
});

describe("folding", () => {
    it("folds unchanged regions with three lines of context", () => {
        expect(paneOptions(false, false, false).hideUnchangedRegions).toEqual({
            enabled: true,
            contextLineCount: 3,
            minimumLineCount: 3,
            revealLineCount: 20,
        });
    });
});
