// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { typedIntoChat, type TypedKey } from "./chattypeinto";

const key = (k: string, over: Partial<TypedKey> = {}): TypedKey => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...over,
});

describe("typedIntoChat", () => {
    it("takes a plain character, letters, digits, punctuation and a Vietnamese letter alike", () => {
        expect(typedIntoChat(key("j"))).toBe("j");
        expect(typedIntoChat(key("K"))).toBe("K");
        expect(typedIntoChat(key("7"))).toBe("7");
        expect(typedIntoChat(key("/"))).toBe("/");
        expect(typedIntoChat(key("ư"))).toBe("ư");
        expect(typedIntoChat(key("😀"))).toBe("😀");
    });

    it("leaves named keys, Space and a composing input method alone", () => {
        for (const k of ["Enter", "ArrowDown", "Tab", "Escape", "Backspace", "Process", "Unidentified", " "]) {
            expect(typedIntoChat(key(k))).toBeNull();
        }
        expect(typedIntoChat(key("a", { isComposing: true }))).toBeNull();
    });

    it("leaves a chord and a key something already took", () => {
        expect(typedIntoChat(key("a", { ctrlKey: true }))).toBeNull();
        expect(typedIntoChat(key("a", { metaKey: true }))).toBeNull();
        expect(typedIntoChat(key("a", { altKey: true }))).toBeNull();
        expect(typedIntoChat(key("d", { defaultPrevented: true }))).toBeNull();
    });
});
