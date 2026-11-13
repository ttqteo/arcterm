import { describe, expect, it } from "vitest";
import {
    cardFace,
    countLive,
    countPinned,
    LIST_CAP,
    listAfterCards,
    listRowFace,
    listWindow,
    pinnedCards,
    pinnedHeading,
    showPinSlot,
} from "./briefcards";
import { nestInitiatives } from "./briefrows";
import { buildEffortCard, type EffortCardModel } from "./effortmodel";

const NOW = new Date(2026, 10, 5, 12, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// a tracker with two chunks (one done) unless chunks say otherwise; pinned when pinnedts is given
function card(id: string, over: Partial<EffortSummary> = {}, chunks?: { label: string; status: string }[]) {
    const list = chunks ?? [
        { label: "One", status: "done" },
        { label: "Two", status: "pending" },
    ];
    return buildEffortCard({
        oref: "effort:" + id,
        title: "T " + id,
        status: "active",
        project: "arcterm",
        done: list.filter((c) => c.status === "done").length,
        total: list.length,
        activechunk: list.find((c) => c.status !== "done" && c.status !== "skipped")?.label,
        updatedts: NOW - HOUR,
        chunks: list,
        ...over,
    } as EffortSummary);
}

const idea = (id: string, over: Partial<EffortSummary> = {}) => card(id, over, []);
const orefs = (cs: { oref: string }[]) => cs.map((c) => c.oref.replace(/^effort:/, ""));

describe("pinnedCards", () => {
    const all = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => card(id));

    it("with no pins, is the first six of the ordered list", () => {
        const ordered = [...all].reverse();
        expect(orefs(pinnedCards(all, ordered))).toEqual(["h", "g", "f", "e", "d", "c"]);
    });

    it("with pins, is the pins only, oldest pin first, whatever the list's order", () => {
        const cards = [card("a"), card("b", { pinnedts: 300 }), card("c"), card("d", { pinnedts: 100 })];
        expect(orefs(pinnedCards(cards, cards))).toEqual(["d", "b"]);
    });

    it("drops an archived pin, and falls back to the ordered six once no live pin is left", () => {
        const cards = [card("a", { pinnedts: 100, status: "archived" }), card("b", { pinnedts: 200 }), card("c")];
        expect(orefs(pinnedCards(cards, cards))).toEqual(["b"]);
        const onlyArchived = [card("a", { pinnedts: 100, status: "archived" }), card("b"), card("c")];
        expect(orefs(pinnedCards(onlyArchived, onlyArchived))).toEqual(["b", "c"]);
    });

    it("never makes an idea a card, pinned or not", () => {
        const cards = [idea("i", { pinnedts: 50 }), card("a"), idea("j")];
        expect(orefs(pinnedCards(cards, cards))).toEqual(["a"]);
    });

    it("leaves a topic out of the fallback cards, so it stays in the list over its sub-initiatives", () => {
        const cards = [{ ...idea("top"), topic: true }, card("a")];
        expect(orefs(pinnedCards(cards, cards))).toEqual(["a"]);
        const [item] = listAfterCards(nestInitiatives([cards[0]]), []);
        expect(listRowFace(item, { now: NOW }).hasProgress).toBe(false);
        expect(listRowFace(listAfterCards(nestInitiatives([cards[1]]), [])[0], { now: NOW }).hasProgress).toBe(true);
    });

    it("draws six pins at most, the oldest six, when another machine's merge left more", () => {
        const cards = [1, 2, 3, 4, 5, 6, 7].map((n) => card("p" + n, { pinnedts: n * 10 }));
        expect(orefs(pinnedCards(cards, cards))).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    });
});

describe("listAfterCards", () => {
    it("never repeats a card in the list, fallback cards included", () => {
        const cards = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => card(id));
        const shown = pinnedCards(cards, cards);
        const list = listAfterCards(nestInitiatives(cards), shown);
        expect(orefs(list)).toEqual(["g", "h"]);
    });

    it("draws a card's sub-initiative at depth 0 and names the parent; its own child stays under it", () => {
        const parent = card("p", { pinnedts: 10 });
        const child = card("c", { parentoid: "p", title: "Child" });
        const grandchild = card("g", { parentoid: "c" });
        const other = card("o");
        const nested = nestInitiatives([parent, child, grandchild, other]);
        const list = listAfterCards(nested, [parent]);
        expect(list.map((l) => [l.oref, l.depth, l.parentCard, l.subCount])).toEqual([
            ["effort:c", 0, "T p", 1],
            ["effort:g", 1, undefined, 0],
            ["effort:o", 0, undefined, 0],
        ]);
    });

    it("names a card parent even when the project filter left it out of the nested list", () => {
        const parent = card("p", { pinnedts: 10, project: "other" });
        const child = card("c", { parentoid: "p" });
        const list = listAfterCards(nestInitiatives([child]), [parent]);
        expect(list.map((l) => [l.depth, l.parentCard])).toEqual([[0, "T p"]]);
        expect(listRowFace(list[0], { now: NOW }).meta).toBe("↳ T p");
    });

    it("keeps a sub-initiative indented under a parent that is in the list", () => {
        const parent = card("p");
        const child = card("c", { parentoid: "p" });
        const list = listAfterCards(nestInitiatives([parent, child]), []);
        expect(list.map((l) => l.depth)).toEqual([0, 1]);
        expect(listRowFace(list[1], { now: NOW }).meta).toBe("arcterm");
    });
});

describe("listWindow", () => {
    it("shows six rows then the count left over, or all of them opened", () => {
        const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => n);
        expect(LIST_CAP).toBe(6);
        expect(listWindow(rows, false)).toEqual({ rows: [1, 2, 3, 4, 5, 6], more: 1 });
        expect(listWindow(rows, true)).toEqual({ rows, more: 0 });
    });
});

describe("the heading", () => {
    it("counts live initiatives as M, ideas and archived ones left out", () => {
        const cards: EffortCardModel[] = [
            card("a", { pinnedts: 5 }),
            card("b"),
            card("c", { status: "archived", pinnedts: 9 }),
            idea("i"),
            card("d", { status: "paused" }),
        ];
        expect([countPinned(cards), countLive(cards)]).toEqual([1, 3]);
        expect(pinnedHeading(countPinned(cards), countLive(cards))).toBe("Pinned 1 of 3");
    });

    it("offers the Pin an initiative slot only while one to five are pinned", () => {
        expect([0, 1, 5, 6].map(showPinSlot)).toEqual([false, true, true, false]);
    });
});

describe("cardFace", () => {
    const go = { kind: "go", agentId: "t1", status: "open · working" } as const;

    it("reads the count, percent, project and age, and names the next chunk", () => {
        const f = cardFace(card("a"), { now: NOW });
        expect([f.done, f.total, f.pct, f.meta]).toEqual([1, 2, "50%", "arcterm · updated 1h"]);
        expect([f.noteLabel, f.note]).toEqual(["Next", "Two"]);
        expect(f.segments).toEqual(["done", "pending"]);
        expect(f.pinned).toBe(false);
    });

    it("says no project when there is none, and is pinned when the effort says so", () => {
        const f = cardFace(card("a", { project: "", pinnedts: 4 }), { now: NOW });
        expect([f.meta, f.pinned]).toEqual(["no project · updated 1h", true]);
    });

    it("blocked: an amber cell and the blocked chunk named", () => {
        const c = card("a", {}, [
            { label: "One", status: "done" },
            { label: "Stuck", status: "blocked" },
        ]);
        const f = cardFace(c, { now: NOW, resume: go });
        expect(f.status).toEqual({ text: "● blocked", tone: "asking" });
        expect([f.noteLabel, f.note]).toEqual(["Blocked on", "Stuck"]);
    });

    it("an agent open on it: a green cell, and the button goes to the agent", () => {
        const f = cardFace(card("a"), { now: NOW, resume: go });
        expect([f.status, f.action]).toEqual([{ text: "● agent open", tone: "ok" }, "go"]);
        const work = { kind: "work", status: "no notes yet", when: "", note: "" } as const;
        expect(cardFace(card("a"), { now: NOW, resume: work }).action).toBe("work");
        expect(cardFace(card("a"), { now: NOW }).action).toBeUndefined();
    });

    it("idle for weeks: the faint idle word", () => {
        expect(cardFace(card("a"), { now: NOW, idle: "idle 2w" }).status).toEqual({ text: "idle 2w", tone: "faint" });
    });

    it("paused says so", () => {
        expect(cardFace(card("a", { status: "paused" }), { now: NOW }).status).toEqual({
            text: "paused",
            tone: "muted",
        });
    });

    it("else the date: the newest note's day, or the day it was last updated", () => {
        const noted = card("a", { lastnote: { ts: new Date(2026, 10, 3, 9, 0).getTime(), text: "left here" } });
        expect(cardFace(noted, { now: NOW }).status).toEqual({ text: "Nov 3", tone: "muted" });
        const bare = card("b", { updatedts: NOW - 3 * DAY });
        expect(cardFace(bare, { now: NOW }).status).toEqual({ text: "Nov 2", tone: "muted" });
    });

    it("all done: Done with the count of chunks", () => {
        const c = card("a", {}, [
            { label: "One", status: "done" },
            { label: "Two", status: "done" },
        ]);
        const f = cardFace(c, { now: NOW });
        expect([f.pct, f.noteLabel, f.note]).toEqual(["100%", "Done", "all 2 chunks done"]);
    });
});

describe("listRowFace", () => {
    it("carries the row's date in its own column, apart from the status cell", () => {
        const noted = card("a", { lastnote: { ts: new Date(2026, 10, 4, 9, 0).getTime(), text: "x" } });
        const [item] = listAfterCards(nestInitiatives([noted]), []);
        const f = listRowFace(item, { now: NOW });
        expect([f.meta, f.when, f.done, f.total, f.noteLabel, f.note, f.depth]).toEqual([
            "arcterm",
            "Nov 4",
            1,
            2,
            "Next",
            "Two",
            0,
        ]);
    });
});
