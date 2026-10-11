// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    OFFERED_KEY,
    markOffered,
    mergeBoxes,
    reconcile,
    shouldOffer,
    spotRect,
    stepView,
    textOf,
    tourBack,
    tourNext,
    tourStart,
    type TourPrepare,
    type TourStep,
} from "./jarvistour";
import { TOUR_TRACKS, TOUR_UI } from "./jarvistourcontent";

const VIEW = { width: 1600, height: 950 };
const TEXT = { title: "t", body: "b" };
const LIT: TourStep = { id: "x:lit", target: ["[data-x]"], vi: TEXT, en: TEXT };
const CARD_ONLY: TourStep = { id: "x:card", vi: TEXT, en: TEXT };

describe("the reducer", () => {
    it("starts a track on its first step", () => {
        expect(tourStart("profile")).toEqual({ track: "profile", index: 0 });
    });
    it("steps on, and past the last step ends", () => {
        expect(tourNext({ track: "brief", index: 0 }, 3)).toEqual({ track: "brief", index: 1 });
        expect(tourNext({ track: "brief", index: 2 }, 3)).toBeNull();
    });
    it("steps back, never before the first step", () => {
        expect(tourBack({ track: "brief", index: 2 })).toEqual({ track: "brief", index: 1 });
        expect(tourBack({ track: "brief", index: 0 })).toEqual({ track: "brief", index: 0 });
    });
});

describe("reconcile", () => {
    const cases: {
        name: string;
        opened: TourPrepare[];
        want?: TourPrepare;
        close: TourPrepare[];
        open: TourPrepare | null;
    }[] = [
        { name: "opens what the step needs", opened: [], want: "profile", close: [], open: "profile" },
        { name: "keeps what is already open", opened: ["profile"], want: "profile", close: [], open: null },
        { name: "closes what the step no longer needs", opened: ["profile"], close: ["profile"], open: null },
        {
            name: "swaps one for another",
            opened: ["newestRun"],
            want: "profile",
            close: ["newestRun"],
            open: "profile",
        },
        {
            name: "the end closes everything, newest first",
            opened: ["firstInitiative", "profile"],
            close: ["profile", "firstInitiative"],
            open: null,
        },
    ];
    for (const c of cases) {
        it(c.name, () => {
            expect(reconcile(c.opened, c.want)).toEqual({ close: c.close, open: c.open });
        });
    }
});

describe("the spotlight", () => {
    it("pads a rect and keeps it on screen", () => {
        expect(spotRect({ left: 2, top: 100, width: 50, height: 20 }, VIEW)).toEqual({
            left: 0,
            top: 94,
            width: 58,
            height: 32,
        });
    });
    it("lights each element found in a box of its own", () => {
        const v = stepView(
            LIT,
            [
                { left: 100, top: 100, width: 50, height: 20 },
                { left: 100, top: 300, width: 80, height: 30 },
            ],
            VIEW
        );
        expect(v).toEqual({
            kind: "spot",
            boxes: [
                { left: 94, top: 94, width: 62, height: 32 },
                { left: 94, top: 294, width: 92, height: 42 },
            ],
        });
    });
    it("makes one box of elements that sit together", () => {
        const v = stepView(
            LIT,
            [
                { left: 100, top: 100, width: 50, height: 20 },
                { left: 100, top: 124, width: 80, height: 30 },
            ],
            VIEW
        );
        expect(v).toEqual({ kind: "spot", boxes: [{ left: 94, top: 94, width: 92, height: 66 }] });
    });
    it("merges again when a grown box reaches one already passed", () => {
        // a touches neither c nor b, but the box b and c make together covers it
        const a = { left: 0, top: 0, width: 10, height: 10 };
        const c = { left: 20, top: 0, width: 10, height: 40 };
        const b = { left: 0, top: 35, width: 25, height: 10 };
        expect(mergeBoxes([a, c, b])).toEqual([{ left: 0, top: 0, width: 30, height: 45 }]);
    });
    it("centers the card when nothing was found, what was found has no size, or the step names nothing", () => {
        expect(stepView(LIT, [], VIEW)).toEqual({ kind: "center" });
        expect(stepView(LIT, [{ left: 10, top: 10, width: 0, height: 0 }], VIEW)).toEqual({ kind: "center" });
        expect(stepView(CARD_ONLY, [{ left: 10, top: 10, width: 50, height: 20 }], VIEW)).toEqual({ kind: "center" });
    });
});

describe("the first-visit offer", () => {
    const store = (v: string | null) => {
        const m = new Map<string, string>(v == null ? [] : [[OFFERED_KEY, v]]);
        return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => void m.set(k, x), m };
    };
    it("shows until it has been answered", () => {
        expect(shouldOffer(store(null))).toBe(true);
        expect(shouldOffer(store("true"))).toBe(false);
    });
    it("answering it marks it for good", () => {
        const s = store(null);
        markOffered(s);
        expect(s.m.get(OFFERED_KEY)).toBe("true");
    });
    it("a storage that throws neither offers nor fails", () => {
        const broken = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        };
        expect(shouldOffer(broken)).toBe(false);
        expect(() => markOffered(broken)).not.toThrow();
    });
});

describe("the content", () => {
    it("has the four tracks in order", () => {
        expect(TOUR_TRACKS.map((t) => t.id)).toEqual(["brief", "initiatives", "runsheet", "profile"]);
    });
    it("gives every step a title and a body in both languages, and a unique id", () => {
        const ids = new Set<string>();
        for (const track of TOUR_TRACKS) {
            expect(track.vi.title && track.en.title).toBeTruthy();
            for (const step of track.steps) {
                expect(ids.has(step.id)).toBe(false);
                ids.add(step.id);
                for (const lang of ["vi", "en"] as const) {
                    expect(textOf(step, lang).title.trim()).not.toBe("");
                    expect(textOf(step, lang).body.trim()).not.toBe("");
                }
                // vitest runs in node here, with no document to parse a selector; the CDP scenario is what proves
                // each one matches
                for (const sel of [...(step.target ?? []), ...(step.also ?? [])]) {
                    expect(sel.trim()).not.toBe("");
                }
            }
        }
    });
    it("opens what each track needs", () => {
        const prep = (id: string) => TOUR_TRACKS.find((t) => t.id === id)!.steps.map((s) => s.prepare ?? null);
        expect(prep("runsheet").every((p) => p === "newestRun")).toBe(true);
        expect(prep("profile")[0]).toBeNull();
        expect(
            prep("profile")
                .slice(1)
                .every((p) => p === "profile")
        ).toBe(true);
        expect(prep("initiatives")).toEqual([null, null, null, "firstInitiative", null, null]);
        expect(prep("brief").every((p) => p === null)).toBe(true);
    });
    it("ends the Brief track on a card with no spotlight", () => {
        const brief = TOUR_TRACKS.find((t) => t.id === "brief")!.steps;
        const last = brief[brief.length - 1];
        expect(last.id).toBe("brief:keys");
        expect(last.target ?? last.also).toBeUndefined();
    });
    it("has every UI string in both languages", () => {
        expect(Object.keys(TOUR_UI.vi).sort()).toEqual(Object.keys(TOUR_UI.en).sort());
        for (const v of [...Object.values(TOUR_UI.vi), ...Object.values(TOUR_UI.en)]) {
            expect(v.trim()).not.toBe("");
        }
    });
});
