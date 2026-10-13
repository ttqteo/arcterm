// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import type { SurfaceKey } from "../agents/agents";
import { backToOrigin, forgetOrigin, landOn, passReturn, returnToOrigin, returnWhenClosed } from "./returnsurface";

const surfaceAtom = atom<SurfaceKey>("agent");
const surface = () => globalStore.get(surfaceAtom);

beforeEach(() => {
    forgetOrigin();
    globalStore.set(surfaceAtom, "agent");
});

describe("return to the surface a jump left", () => {
    it("goes back when the thing the jump opened closes", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        expect(surface()).toBe("jarvis");
        returnToOrigin("sheet");
        expect(surface()).toBe("agent");
    });

    it("returns once: a second close stays put", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        returnToOrigin("sheet");
        globalStore.set(surfaceAtom, "jarvis");
        returnToOrigin("sheet");
        expect(surface()).toBe("jarvis");
    });

    it("ignores the close of something else", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        returnToOrigin("dag");
        expect(surface()).toBe("jarvis");
        returnToOrigin("sheet");
        expect(surface()).toBe("agent");
    });

    it("hands the return to what the jump opened on top", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        returnWhenClosed("dag");
        returnToOrigin("sheet");
        expect(surface()).toBe("jarvis");
        returnToOrigin("dag");
        expect(surface()).toBe("agent");
    });

    it("passes the return on when what the jump opened hands the user to something else", () => {
        landOn(surfaceAtom, "jarvis", "record");
        passReturn("record", "sheet");
        returnToOrigin("record");
        expect(surface()).toBe("jarvis");
        returnToOrigin("sheet");
        expect(surface()).toBe("agent");
    });

    it("passes on only a return the closer holds", () => {
        let sheetOpen = true;
        landOn(surfaceAtom, "jarvis", "sheet");
        returnWhenClosed("dag", () => (sheetOpen = false));
        passReturn("record", "sheet");
        returnToOrigin("sheet");
        expect(surface()).toBe("jarvis");
        returnToOrigin("dag");
        expect(surface()).toBe("agent");
        expect(sheetOpen).toBe(false);
    });

    it("puts away what the jump left open underneath, only when it goes back", () => {
        let sheetOpen = true;
        landOn(surfaceAtom, "jarvis", "sheet");
        returnWhenClosed("dag", () => (sheetOpen = false));
        returnToOrigin("sheet");
        expect(sheetOpen).toBe(true);
        returnToOrigin("dag");
        expect(sheetOpen).toBe(false);
    });

    it("adds nothing for a jump made from the destination", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        landOn(surfaceAtom, "jarvis", "record");
        returnToOrigin("sheet");
        expect(surface()).toBe("agent");
    });

    it("forgets the trail once the user moves by hand", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        globalStore.set(surfaceAtom, "radar");
        globalStore.set(surfaceAtom, "jarvis");
        returnToOrigin("sheet");
        expect(backToOrigin()).toBe(false);
        expect(surface()).toBe("jarvis");
    });
});

describe("back over a jump", () => {
    it("has nowhere to go with no jump made", () => {
        expect(backToOrigin()).toBe(false);
        expect(surface()).toBe("agent");
    });

    it("goes back over a jump that has nothing to close", () => {
        landOn(surfaceAtom, "code");
        expect(backToOrigin()).toBe(true);
        expect(surface()).toBe("agent");
        expect(backToOrigin()).toBe(false);
    });

    it("walks back through a chain of jumps, one at a time", () => {
        landOn(surfaceAtom, "jarvis", "sheet");
        landOn(surfaceAtom, "code");
        expect(backToOrigin()).toBe(true);
        expect(surface()).toBe("jarvis");
        // the sheet the first jump opened still returns to where that jump began
        returnToOrigin("sheet");
        expect(surface()).toBe("agent");
    });
});
