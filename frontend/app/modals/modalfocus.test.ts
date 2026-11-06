// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    focusTrapTarget,
    restoringModalFocus,
    setModalFocusFallback,
    shellOwnsEscape,
    takeModalFocus,
} from "./modalfocus";

function fakePanel(contains: boolean) {
    return { focus: vi.fn(), contains: vi.fn(() => contains) } as unknown as HTMLElement;
}

// focus() moves document.activeElement, as a focusable element's does
function fakeNode(isConnected: boolean, visible = true) {
    const node = { blur: vi.fn(), isConnected, checkVisibility: () => visible } as unknown as HTMLElement;
    node.focus = vi.fn(() => {
        (document as { activeElement: Element | null }).activeElement = node;
    });
    return node;
}

// <body>, which a modal opened over nothing records as the element to hand focus back to: it passes the connected and
// visible checks, but focus() on it does nothing
function fakeBody() {
    return { isConnected: true, checkVisibility: () => true, focus: vi.fn(), blur: vi.fn() } as unknown as HTMLElement;
}

const documentBody = fakeBody();

// the document a close reads: what has focus, its <body>, and the [data-focus-home] elements in it
function stubDocument(activeElement: unknown = null, homes: HTMLElement[] = []) {
    vi.stubGlobal("document", { activeElement, body: documentBody, querySelectorAll: () => homes });
}

describe("focusTrapTarget", () => {
    const first = fakeNode(true);
    const second = fakeNode(true);
    const third = fakeNode(true);

    it("wraps forward and reverse through the focusable list", () => {
        expect(focusTrapTarget([first, second, third], third, false)).toBe(first);
        expect(focusTrapTarget([first, second, third], first, true)).toBe(third);
    });

    it("steps to the neighbour of the focused target", () => {
        expect(focusTrapTarget([first, second, third], first, false)).toBe(second);
        expect(focusTrapTarget([first, second, third], second, false)).toBe(third);
        expect(focusTrapTarget([first, second, third], second, true)).toBe(first);
        expect(focusTrapTarget([first, second, third], third, true)).toBe(second);
    });

    it("chooses the first or last target when focus is outside the list", () => {
        const outside = fakeNode(true);
        expect(focusTrapTarget([first, second], outside, false)).toBe(first);
        expect(focusTrapTarget([first, second], outside, true)).toBe(second);
        expect(focusTrapTarget([], outside, false)).toBeNull();
    });

    it("carries on from a focused element that is no stop, by its place in the page", () => {
        // page order: a, skipped, b, c; focus sits on `skipped` (a column Tab passes over, focused by a click)
        const order: unknown[] = [];
        const at = () => {
            const node = {
                focus: vi.fn(),
                compareDocumentPosition: (other: unknown) =>
                    // Node.DOCUMENT_POSITION_FOLLOWING (4) or _PRECEDING (2); no DOM here
                    order.indexOf(other) > order.indexOf(node) ? 4 : 2,
            };
            order.push(node);
            return node as unknown as HTMLElement;
        };
        const a = at();
        const skipped = at();
        const b = at();
        const c = at();
        expect(focusTrapTarget([a, b, c], skipped, false)).toBe(b);
        expect(focusTrapTarget([a, b, c], skipped, true)).toBe(a);
        // past the last stop it wraps, as from a stop
        expect(focusTrapTarget([a, b], c, false)).toBe(a);
        expect(focusTrapTarget([b, c], a, true)).toBe(c);
    });
});

describe("takeModalFocus", () => {
    beforeEach(() => stubDocument());
    afterEach(() => vi.unstubAllGlobals());

    it("focuses the panel when focus is outside it", () => {
        const panel = fakePanel(false);
        takeModalFocus(panel, fakeNode(true));
        expect(panel.focus).toHaveBeenCalledOnce();
    });

    it("leaves focus alone when a child already has it", () => {
        const panel = fakePanel(true);
        takeModalFocus(panel, fakeNode(true));
        expect(panel.focus).not.toHaveBeenCalled();
    });

    it("restores focus to the still-connected element it took it from", () => {
        const previous = fakeNode(true);
        takeModalFocus(fakePanel(false), previous)();
        expect(previous.focus).toHaveBeenCalledOnce();
    });

    it("does not refocus an element that left the DOM", () => {
        const previous = fakeNode(false);
        takeModalFocus(fakePanel(false), previous)();
        expect(previous.focus).not.toHaveBeenCalled();
    });

    it("does not refocus an element hidden since the modal opened", () => {
        const previous = fakeNode(true, false);
        takeModalFocus(fakePanel(false), previous)();
        expect(previous.focus).not.toHaveBeenCalled();
    });

    // the palette stays in the DOM through its exit animation; focus left in it blocked the surface the
    // pick navigated to from claiming focus, and then fell to <body>
    it("drops focus from the closing panel when there is nowhere to restore it", () => {
        const input = fakeNode(true);
        stubDocument(input);
        takeModalFocus(fakePanel(true), fakeNode(true, false))();
        expect(input.blur).toHaveBeenCalledOnce();
    });

    it("leaves focus that already moved outside the panel alone", () => {
        const elsewhere = fakeNode(true);
        stubDocument(elsewhere);
        takeModalFocus(fakePanel(false), fakeNode(false))();
        expect(elsewhere.blur).not.toHaveBeenCalled();
    });

    // a palette pick from the Agent surface to the Cockpit hid the xterm the palette opened over: focus fell to <body>
    // and the Cockpit's j/k/Enter, which are its container's own onKeyDown, were dead until a click
    describe("with a focus home", () => {
        it("hands focus to the visible [data-focus-home] element when the previous element is hidden", () => {
            const previous = fakeNode(true, false);
            const home = fakeNode(true);
            stubDocument(null, [home]);
            takeModalFocus(fakePanel(false), previous)();
            expect(home.focus).toHaveBeenCalledOnce();
            expect(previous.focus).not.toHaveBeenCalled();
        });

        it("hands focus to it when there was no previous element", () => {
            const home = fakeNode(true);
            stubDocument(null, [home]);
            takeModalFocus(fakePanel(false), null)();
            expect(home.focus).toHaveBeenCalledOnce();
        });

        it("skips a focus home that is not showing, for the visible one", () => {
            const hidden = fakeNode(true, false);
            const shown = fakeNode(true);
            stubDocument(null, [hidden, shown]);
            takeModalFocus(fakePanel(false), fakeNode(false))();
            expect(hidden.focus).not.toHaveBeenCalled();
            expect(shown.focus).toHaveBeenCalledOnce();
        });

        it("does nothing when no focus home is showing", () => {
            const hidden = fakeNode(true, false);
            stubDocument(null, [hidden]);
            expect(() => takeModalFocus(fakePanel(false), fakeNode(false))()).not.toThrow();
            expect(hidden.focus).not.toHaveBeenCalled();
        });

        // the palette opened over nothing focused: previous is <body>, which ignores focus(), so focus stayed in the
        // palette's input until the panel unmounted and dropped it to <body>
        it("hands focus to it when the previous element is <body>, which ignores focus()", () => {
            const input = fakeNode(true);
            const home = fakeNode(true);
            stubDocument(input, [home]);
            takeModalFocus(fakePanel(true), documentBody)();
            expect(documentBody.focus).toHaveBeenCalledOnce();
            expect(input.blur).toHaveBeenCalledOnce();
            expect(home.focus).toHaveBeenCalledOnce();
        });

        it("returns focus to a visible previous element, not the home", () => {
            const previous = fakeNode(true);
            const home = fakeNode(true);
            stubDocument(null, [home]);
            takeModalFocus(fakePanel(false), previous)();
            expect(previous.focus).toHaveBeenCalledOnce();
            expect(home.focus).not.toHaveBeenCalled();
        });

        it("leaves focus that moved elsewhere during the hand-back alone", () => {
            // a focus handler on the previous element sent focus on to another element, as the Agent surface's cells do
            const elsewhere = fakeNode(true);
            const previous = fakeNode(true);
            previous.focus = vi.fn(() => {
                (document as { activeElement: unknown }).activeElement = elsewhere;
            }) as unknown as HTMLElement["focus"];
            const home = fakeNode(true);
            stubDocument(null, [home]);
            takeModalFocus(fakePanel(false), previous)();
            expect(previous.focus).toHaveBeenCalledOnce();
            expect(home.focus).not.toHaveBeenCalled();
        });
    });

    it("is a no-op when the panel ref is not attached yet", () => {
        expect(() => takeModalFocus(null, fakeNode(true))()).not.toThrow();
    });

    // a focus handler tells the hand-back from a pick by this flag, not by the dialog still being in the DOM through
    // its exit animation, which a shell that unmounts at once does not have
    it("marks the hand-back while it focuses", () => {
        let during: boolean | null = null;
        const previous = { ...fakeNode(true), focus: () => (during = restoringModalFocus()) } as unknown as HTMLElement;
        takeModalFocus(fakePanel(false), previous)();
        expect(during).toBe(true);
        expect(restoringModalFocus()).toBe(false);
    });

    describe("with a fallback", () => {
        let unset: () => void = () => {};
        afterEach(() => unset());

        // a palette pick hid the cell whose terminal had focus: focus fell to <body>
        it("hands focus to the fallback's choice when it cannot hand it back", () => {
            const previous = fakeNode(true, false);
            const target = fakeNode(true);
            const fallback = vi.fn(() => target);
            unset = setModalFocusFallback(fallback);
            let during: boolean | null = null;
            target.focus = vi.fn(() => (during = restoringModalFocus())) as unknown as HTMLElement["focus"];
            takeModalFocus(fakePanel(false), previous)();
            expect(fallback).toHaveBeenCalledWith(previous);
            expect(target.focus).toHaveBeenCalledOnce();
            expect(during).toBe(true);
        });

        it("asks it after dropping focus from the closing panel", () => {
            const input = fakeNode(true);
            stubDocument(input);
            const target = fakeNode(true);
            unset = setModalFocusFallback(() => target);
            takeModalFocus(fakePanel(true), fakeNode(true, false))();
            expect(input.blur).toHaveBeenCalledOnce();
            expect(target.focus).toHaveBeenCalledOnce();
        });

        it("does not ask it when focus was handed back", () => {
            const fallback = vi.fn(() => fakeNode(true));
            unset = setModalFocusFallback(fallback);
            takeModalFocus(fakePanel(false), fakeNode(true))();
            expect(fallback).not.toHaveBeenCalled();
        });

        it("does not ask it when focus already moved outside the panel", () => {
            stubDocument(fakeNode(true));
            const fallback = vi.fn(() => fakeNode(true));
            unset = setModalFocusFallback(fallback);
            takeModalFocus(fakePanel(false), fakeNode(false))();
            expect(fallback).not.toHaveBeenCalled();
        });

        // the close tries the previous element, then the fallback, then the focus home
        it("takes the fallback's choice over the focus home", () => {
            const target = fakeNode(true);
            const home = fakeNode(true);
            stubDocument(null, [home]);
            unset = setModalFocusFallback(() => target);
            takeModalFocus(fakePanel(false), fakeNode(true, false))();
            expect(target.focus).toHaveBeenCalledOnce();
            expect(home.focus).not.toHaveBeenCalled();
        });

        it("goes on to the focus home when the fallback has nowhere to put focus", () => {
            const home = fakeNode(true);
            stubDocument(null, [home]);
            const fallback = vi.fn(() => null);
            unset = setModalFocusFallback(fallback);
            takeModalFocus(fakePanel(false), fakeNode(true, false))();
            expect(fallback).toHaveBeenCalledOnce();
            expect(home.focus).toHaveBeenCalledOnce();
        });

        it("asks the fallback before the focus home when the previous element is <body>", () => {
            const input = fakeNode(true);
            const target = fakeNode(true);
            const home = fakeNode(true);
            stubDocument(input, [home]);
            unset = setModalFocusFallback(() => target);
            takeModalFocus(fakePanel(true), documentBody)();
            expect(target.focus).toHaveBeenCalledOnce();
            expect(home.focus).not.toHaveBeenCalled();
        });
    });
});

describe("shellOwnsEscape", () => {
    // elements are nodeType 1; document is 9, and window has no nodeType
    const inside = { nodeType: 1 } as Node;
    const portaled = { nodeType: 1 } as Node;
    const body = { nodeType: 1 } as Node;
    const panel = { contains: (n: Node | null) => n === inside };
    it("owns an Escape from inside the panel", () => {
        expect(shellOwnsEscape(panel, inside, body)).toBe(true);
    });
    it("leaves an Escape from a popover portaled out of the panel to that popover", () => {
        expect(shellOwnsEscape(panel, portaled, body)).toBe(false);
    });
    it("owns an Escape with nothing focused", () => {
        expect(shellOwnsEscape(panel, body, body)).toBe(true);
        expect(shellOwnsEscape(panel, null, body)).toBe(true);
    });
    it("owns an Escape dispatched on document or window, which no popover can claim", () => {
        expect(shellOwnsEscape(panel, { nodeType: 9 } as unknown as EventTarget, body)).toBe(true);
        expect(shellOwnsEscape(panel, {} as EventTarget, body)).toBe(true);
    });
    it("owns every Escape before the panel exists", () => {
        expect(shellOwnsEscape(null, portaled, body)).toBe(true);
    });
});
