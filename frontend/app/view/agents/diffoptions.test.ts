// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    LABELLED_MIN_PX,
    optionItems,
    paneHeaderLayout,
    paneOptions,
    SPLIT_MIN_PX,
    type OptionsState,
} from "./diffoptions";

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

describe("the ⋯ menu's items", () => {
    const base: OptionsState = {
        split: false,
        splitAllowed: true,
        ignoreWs: false,
        wrap: false,
        wrapAllowed: true,
        editorAllowed: true,
        codeAllowed: true,
    };
    const byId = (s: OptionsState, id: string) => optionItems(s).find((i) => i.id === id)!;

    it("always lists the same five items in the same order", () => {
        expect(optionItems(base).map((i) => i.id)).toEqual(["split", "whitespace", "wrap", "editor", "code"]);
        expect(
            optionItems({ ...base, splitAllowed: false, wrapAllowed: false, editorAllowed: false }).map((i) => i.id)
        ).toEqual(["split", "whitespace", "wrap", "editor", "code"]);
    });

    it("reads each switch's state as checked", () => {
        expect(byId(base, "whitespace").checked).toBe(false);
        expect(byId({ ...base, ignoreWs: true }, "whitespace").checked).toBe(true);
        expect(byId({ ...base, wrap: true }, "wrap").checked).toBe(true);
        expect(byId({ ...base, split: true }, "split").checked).toBe(true);
    });

    it("keeps the actions free of a checked state", () => {
        expect(byId(base, "editor").checked).toBeUndefined();
        expect(byId(base, "code").checked).toBeUndefined();
    });

    it("disables split on a pane too narrow for two editors, and never reads it as on", () => {
        const narrow = byId({ ...base, split: true, splitAllowed: false }, "split");
        expect(narrow.disabled).toBe(true);
        expect(narrow.checked).toBe(false);
        expect(narrow.reason).toBeTruthy();
    });

    it("disables wrap without a file, Open in editor off the working tree, and Open in Code without a repository", () => {
        expect(byId({ ...base, wrapAllowed: false }, "wrap")).toMatchObject({ disabled: true });
        expect(byId({ ...base, editorAllowed: false }, "editor")).toMatchObject({ disabled: true });
        expect(byId({ ...base, codeAllowed: false }, "code")).toMatchObject({ disabled: true });
        expect(byId(base, "wrap").disabled).toBeFalsy();
        expect(byId(base, "editor").disabled).toBeFalsy();
    });

    it("gives every disabled item a reason", () => {
        const off = optionItems({
            ...base,
            splitAllowed: false,
            wrapAllowed: false,
            editorAllowed: false,
            codeAllowed: false,
        });
        for (const i of off.filter((x) => x.disabled)) {
            expect(i.reason).toBeTruthy();
        }
    });
});
