import { describe, expect, it } from "vitest";
import {
    SUGGEST_AFTER_DAYS,
    boardCountLabel,
    cardMeta,
    cleanupGroups,
    cleanupMeta,
    cleanupOrder,
    declineWrite,
    groupByDay,
    initialSelection,
    isSuggested,
    linkCandidates,
    linkWrite,
    moveCursor,
    previewStale,
    scanLinkLabel,
    scanWrites,
    searchCanvases,
    selectionAfterClean,
    selectionLabel,
    selectionTotal,
    stepIndex,
    suggestVersions,
    toggled,
    trashMessage,
    unlinkWrite,
    versionInfo,
    type GalleryCanvas,
} from "./canvasgallery";

const DAY = 24 * 60 * 60 * 1000;
// a local time, so the day boundaries below are local midnights whatever zone the test runs in
const NOW = new Date(2026, 9, 14, 13, 37, 0).getTime();
const MIDNIGHT = new Date(2026, 9, 14, 0, 0, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 13, 0, 0, 0, 0).getTime();

function canvas(over: Partial<GalleryCanvas> = {}): GalleryCanvas {
    return {
        topic: "gallery",
        project: "D:/work/arcterm",
        projectname: "arcterm",
        designdir: "D:/work/arcterm/.superpowers/design",
        dir: "D:/work/arcterm/.superpowers/design/gallery",
        boards: ["Main"],
        modts: NOW,
        thumbts: NOW,
        bytes: 1000,
        createdts: NOW,
        ...over,
    };
}

describe("groupByDay", () => {
    it("splits at local midnight, newest first inside a group", () => {
        const older = canvas({ topic: "older", modts: MIDNIGHT + 1000 });
        const newer = canvas({ topic: "newer", modts: NOW });
        const lastNight = canvas({ topic: "last-night", modts: MIDNIGHT - 1 });
        const yesterdayStart = canvas({ topic: "yesterday-start", modts: YESTERDAY });
        const dayBefore = canvas({ topic: "day-before", modts: YESTERDAY - 1 });
        const groups = groupByDay([older, dayBefore, lastNight, newer, yesterdayStart], NOW);
        expect(groups.map((g) => [g.key, g.label, g.items.map((c) => c.topic)])).toEqual([
            ["today", "Today", ["newer", "older"]],
            ["yesterday", "Yesterday", ["last-night", "yesterday-start"]],
            ["earlier", "Earlier", ["day-before"]],
        ]);
    });

    it("drops a group with no items", () => {
        const groups = groupByDay([canvas({ modts: YESTERDAY - 5 * DAY })], NOW);
        expect(groups.map((g) => g.key)).toEqual(["earlier"]);
        expect(groupByDay([], NOW)).toEqual([]);
    });

    it("counts a board dated after now (clock skew) as today", () => {
        const groups = groupByDay([canvas({ modts: NOW + 3 * DAY })], NOW);
        expect(groups.map((g) => g.key)).toEqual(["today"]);
    });
});

describe("searchCanvases", () => {
    const items = [
        canvas({ topic: "canvas-gallery", boards: ["Main", "Viewer"], projectname: "arcterm" }),
        canvas({ topic: "settings-sync", boards: ["Overview"], projectname: "notes" }),
    ];

    it("returns everything for a blank query", () => {
        expect(searchCanvases(items, "")).toEqual(items);
        expect(searchCanvases(items, "   ")).toEqual(items);
    });

    it("matches the topic, a board name and the project name, ignoring case", () => {
        expect(searchCanvases(items, "GALLERY").map((c) => c.topic)).toEqual(["canvas-gallery"]);
        expect(searchCanvases(items, "viewer").map((c) => c.topic)).toEqual(["canvas-gallery"]);
        expect(searchCanvases(items, "Notes").map((c) => c.topic)).toEqual(["settings-sync"]);
    });

    it("matches nothing for text in none of them", () => {
        expect(searchCanvases(items, "settings sync")).toEqual([]);
    });

    it("does not read the folder path or the board file extension", () => {
        expect(searchCanvases(items, "superpowers")).toEqual([]);
        expect(searchCanvases(items, "dc.html")).toEqual([]);
    });
});

describe("isSuggested", () => {
    it("leaves a canvas exactly 30 days old and suggests one 1 ms older", () => {
        expect(SUGGEST_AFTER_DAYS).toBe(30);
        expect(isSuggested(canvas({ modts: NOW - 30 * DAY }), NOW)).toBe(false);
        expect(isSuggested(canvas({ modts: NOW - 30 * DAY - 1 }), NOW)).toBe(true);
        expect(isSuggested(canvas({ modts: NOW }), NOW)).toBe(false);
    });
});

describe("cleanup helpers", () => {
    const fresh = canvas({ topic: "fresh", dir: "d/fresh", modts: NOW - DAY, bytes: 300 });
    const stale = canvas({ topic: "stale", dir: "d/stale", modts: NOW - 40 * DAY, bytes: 5000 });
    const staler = canvas({ topic: "staler", dir: "d/staler", modts: NOW - 90 * DAY, bytes: 7000 });

    it("splits the suggested canvases from the newer ones, each newest first", () => {
        const { suggested, newer } = cleanupGroups([staler, fresh, stale], NOW);
        expect(suggested.map((c) => c.topic)).toEqual(["stale", "staler"]);
        expect(newer.map((c) => c.topic)).toEqual(["fresh"]);
    });

    it("starts with the suggested dirs selected", () => {
        expect(initialSelection([fresh, stale, staler], NOW)).toEqual(new Set(["d/stale", "d/staler"]));
        expect(initialSelection([fresh], NOW)).toEqual(new Set());
    });

    it("totals the selected canvases and ignores a dir that is no longer listed", () => {
        const sel = new Set(["d/stale", "d/staler", "d/gone"]);
        expect(selectionTotal([fresh, stale, staler], sel)).toEqual({ count: 2, bytes: 12000 });
        expect(selectionTotal([fresh, stale, staler], new Set())).toEqual({ count: 0, bytes: 0 });
    });

    it("lists the clean-up cards suggested group first, then Newer, each newest first", () => {
        expect(cleanupOrder([fresh, staler, stale], NOW).map((c) => c.topic)).toEqual(["stale", "staler", "fresh"]);
        expect(cleanupOrder([], NOW)).toEqual([]);
    });

    it("toggles a dir in a copy and leaves the set it was given alone", () => {
        const sel = new Set(["d/stale"]);
        expect(toggled(sel, "d/fresh")).toEqual(new Set(["d/stale", "d/fresh"]));
        expect(toggled(sel, "d/stale")).toEqual(new Set());
        expect(sel).toEqual(new Set(["d/stale"]));
    });

    it("keeps a skipped canvas ticked after a clean, and drops the moved and the vanished", () => {
        const sel = new Set(["d/stale", "d/staler", "d/gone", "d/fresh"]);
        // d/staler moved, d/gone is no longer listed (already gone), d/stale was skipped and is still there
        expect(selectionAfterClean(sel, [fresh, stale], ["d/staler"])).toEqual(new Set(["d/stale", "d/fresh"]));
        // a clean whose re-read failed still lists the moved dir: the moved list wins
        expect(selectionAfterClean(sel, [fresh, stale, staler], ["d/staler"])).toEqual(new Set(["d/stale", "d/fresh"]));
    });

    it("words the bar's summary and the toast", () => {
        expect(selectionLabel({ count: 0, bytes: 0 })).toBe("Nothing selected");
        expect(selectionLabel({ count: 2, bytes: 12000 })).toBe("2 selected · 12 KB");
        expect(selectionLabel({ count: 1, bytes: 3 * 1000 * 1000 })).toBe("1 selected · 3 MB");
        expect(trashMessage(1, 0)).toBe("Moved 1 canvas to the trash");
        expect(trashMessage(3, 0)).toBe("Moved 3 canvases to the trash");
        expect(trashMessage(2, 1)).toBe("Moved 2 canvases to the trash, 1 skipped");
        expect(trashMessage(0, 2)).toBe("Moved 0 canvases to the trash, 2 skipped");
    });
});

describe("previewStale", () => {
    it("is stale with no preview, an older one, and fresh only when the preview is not older than the board", () => {
        expect(previewStale({ modts: 1000, thumbts: 0 })).toBe(true);
        expect(previewStale({ modts: 1000, thumbts: 999 })).toBe(true);
        expect(previewStale({ modts: 1000, thumbts: 1000 })).toBe(false);
        expect(previewStale({ modts: 1000, thumbts: 2000 })).toBe(false);
    });
});

describe("cardMeta", () => {
    it("shows the time for today and the date before", () => {
        expect(cardMeta(canvas({ modts: NOW }), NOW)).toBe("arcterm · 13:37");
        expect(cardMeta(canvas({ modts: new Date(2026, 9, 14, 9, 5).getTime() }), NOW)).toBe("arcterm · 09:05");
        expect(cardMeta(canvas({ modts: new Date(2026, 9, 13, 23, 59).getTime() }), NOW)).toBe("arcterm · 13 Oct");
        expect(cardMeta(canvas({ modts: new Date(2026, 7, 2, 10, 0).getTime() }), NOW)).toBe("arcterm · 2 Aug");
    });
});

describe("cleanupMeta", () => {
    it("reads boards, date and size, the date as cardMeta gives it", () => {
        const old = canvas({
            boards: ["Main", "States"],
            modts: new Date(2026, 8, 5, 10, 0).getTime(),
            bytes: 200 * 1000,
        });
        expect(cleanupMeta(old, NOW)).toBe("2 boards · 5 Sep · 200 KB");
        expect(cleanupMeta(canvas({ boards: ["Main"], modts: NOW, bytes: 1751 * 1000 }), NOW)).toBe(
            "1 board · 13:37 · 2 MB"
        );
    });
});

describe("boardCountLabel", () => {
    it("is singular for one board only", () => {
        expect(boardCountLabel(0)).toBe("0 boards");
        expect(boardCountLabel(1)).toBe("1 board");
        expect(boardCountLabel(6)).toBe("6 boards");
    });
});

describe("stepIndex", () => {
    it("wraps both ways", () => {
        expect(stepIndex(3, 0, 1)).toBe(1);
        expect(stepIndex(3, 2, 1)).toBe(0);
        expect(stepIndex(3, 0, -1)).toBe(2);
        expect(stepIndex(3, 1, -1)).toBe(0);
    });

    it("stays on 0 when there is nothing to step through", () => {
        expect(stepIndex(0, 0, 1)).toBe(0);
        expect(stepIndex(1, 0, 1)).toBe(0);
    });
});

describe("moveCursor", () => {
    // seven cards in rows of three: 0 1 2 / 3 4 5 / 6
    it("moves by one sideways and by a row up and down", () => {
        expect(moveCursor(7, 3, 4, "ArrowLeft")).toBe(3);
        expect(moveCursor(7, 3, 4, "ArrowRight")).toBe(5);
        expect(moveCursor(7, 3, 4, "ArrowUp")).toBe(1);
        expect(moveCursor(7, 3, 1, "ArrowDown")).toBe(4);
    });

    it("clamps at the edges instead of wrapping", () => {
        expect(moveCursor(7, 3, 0, "ArrowLeft")).toBe(0);
        expect(moveCursor(7, 3, 6, "ArrowRight")).toBe(6);
        expect(moveCursor(7, 3, 1, "ArrowUp")).toBe(1);
        expect(moveCursor(7, 3, 6, "ArrowDown")).toBe(6);
    });

    it("goes down onto a short last row's last card, and stays once on the last row", () => {
        expect(moveCursor(7, 3, 4, "ArrowDown")).toBe(6);
        expect(moveCursor(7, 3, 5, "ArrowDown")).toBe(6);
        expect(moveCursor(6, 3, 4, "ArrowDown")).toBe(4);
    });

    it("stays on 0 with no cards, and pulls a stale index into range", () => {
        expect(moveCursor(0, 3, 0, "ArrowRight")).toBe(0);
        expect(moveCursor(0, 3, 5, "ArrowDown")).toBe(0);
        expect(moveCursor(4, 3, 9, "ArrowLeft")).toBe(2);
    });
});

// canvases of one project, created at the given minute; the title defaults to none
const PROJECT = "D:/work/arcterm";
function ver(topic: string, minute: number, over: Partial<GalleryCanvas> = {}): GalleryCanvas {
    const at = minute * 60 * 1000;
    return canvas({
        topic,
        dir: `${PROJECT}/.superpowers/design/${topic}`,
        createdts: at,
        modts: at,
        thumbts: at,
        ...over,
    });
}
const topics = (list: GalleryCanvas[]) => list.map((c) => c.topic);
const pairsOf = (list: { newer: GalleryCanvas; older: GalleryCanvas }[]) =>
    list.map((s) => `${s.newer.topic} replaces ${s.older.topic}`);

describe("versionInfo", () => {
    it("marks the replaced canvas outdated, pointing at its replacer, and leaves the rest alone", () => {
        const a = ver("mxc-home", 1);
        const b = ver("mxc-home-fresh", 2, { replaces: "mxc-home" });
        const c = ver("other", 3);
        const info = versionInfo([a, b, c]);
        expect(info.size).toBe(3);
        expect(info.get(a.dir)).toEqual({ replaces: null, newest: b });
        expect(info.get(b.dir)).toEqual({ replaces: a, newest: null });
        expect(info.get(c.dir)).toEqual({ replaces: null, newest: null });
    });

    it("points every outdated canvas of a chain at the newest one", () => {
        const v1 = ver("x", 1);
        const v2 = ver("x-v2", 2, { replaces: "x" });
        const v3 = ver("x-v3", 3, { replaces: "x-v2" });
        const info = versionInfo([v3, v1, v2]);
        expect(info.get(v1.dir)).toEqual({ replaces: null, newest: v3 });
        expect(info.get(v2.dir)).toEqual({ replaces: v1, newest: v3 });
        expect(info.get(v3.dir)).toEqual({ replaces: v2, newest: null });
    });

    it("ignores a replaces naming a canvas that is gone, itself, or only in another project", () => {
        const lost = ver("lost", 2, { replaces: "gone" });
        const self = ver("self", 3, { replaces: "self" });
        const elsewhere = ver("elsewhere", 1, {
            project: "D:/work/other",
            dir: "D:/work/other/.superpowers/design/elsewhere",
        });
        const wrong = ver("wrong", 4, { replaces: "elsewhere" });
        const info = versionInfo([lost, self, elsewhere, wrong]);
        for (const c of [lost, self, elsewhere, wrong]) {
            expect(info.get(c.dir)).toEqual({ replaces: null, newest: null });
        }
    });

    it("breaks a cycle at the canvas created last, which is never outdated", () => {
        const a = ver("a", 1, { replaces: "b" });
        const b = ver("b", 2, { replaces: "a" });
        const info = versionInfo([a, b]);
        expect(info.get(a.dir)).toEqual({ replaces: null, newest: b });
        expect(info.get(b.dir)).toEqual({ replaces: a, newest: null });
    });

    it("breaks a longer cycle the same way, and keeps the chain that is left", () => {
        // a replaces c, b replaces a, c replaces b; c is last, so "a replaces c" goes and c → b → a stays
        const a = ver("a", 1, { replaces: "c" });
        const b = ver("b", 2, { replaces: "a" });
        const c = ver("c", 3, { replaces: "b" });
        const info = versionInfo([a, b, c]);
        expect(info.get(a.dir)).toEqual({ replaces: null, newest: c });
        expect(info.get(b.dir)).toEqual({ replaces: a, newest: c });
        expect(info.get(c.dir)).toEqual({ replaces: b, newest: null });
    });

    it("lets the last-created of two canvases naming the same one keep the link", () => {
        const a = ver("a", 1);
        const b = ver("b", 2, { replaces: "a" });
        const c = ver("c", 3, { replaces: "a" });
        for (const order of [
            [a, b, c],
            [c, b, a],
        ]) {
            const info = versionInfo(order);
            expect(info.get(a.dir)).toEqual({ replaces: null, newest: c });
            expect(info.get(b.dir)).toEqual({ replaces: null, newest: null });
            expect(info.get(c.dir)).toEqual({ replaces: a, newest: null });
        }
    });

    it("orders canvases created at the same time by topic, the topic that sorts first being older", () => {
        const a = ver("a", 5);
        const b = ver("b", 5, { replaces: "a" });
        const c = ver("c", 5, { replaces: "a" });
        // a fork between b and c: c sorts last, so c keeps the link
        expect(versionInfo([a, b, c]).get(a.dir)?.newest).toBe(c);
        // a cycle between x and y: y sorts last, so y is the one never outdated
        const x = ver("x", 5, { replaces: "y" });
        const y = ver("y", 5, { replaces: "x" });
        const info = versionInfo([x, y]);
        expect(info.get(x.dir)).toEqual({ replaces: null, newest: y });
        expect(info.get(y.dir)).toEqual({ replaces: x, newest: null });
    });

    it("has nothing to say about no canvases", () => {
        expect(versionInfo([]).size).toBe(0);
    });
});

describe("suggestVersions", () => {
    it("matches a topic that continues another at a dash", () => {
        const home = ver("mxc-home", 1);
        const fresh = ver("mxc-home-fresh", 2);
        expect(suggestVersions([home, fresh])).toEqual([{ newer: fresh, older: home }]);
        const overview = ver("project-overview", 3);
        const history = ver("project-overview-history", 4);
        expect(pairsOf(suggestVersions([overview, history]))).toEqual([
            "project-overview-history replaces project-overview",
        ]);
    });

    it("needs the dash: a longer word is not a version", () => {
        expect(suggestVersions([ver("app", 1), ver("apple", 2)])).toEqual([]);
        expect(suggestVersions([ver("mxc-home", 1), ver("mxc-homepage", 2)])).toEqual([]);
    });

    it("lets only the older topic be the prefix", () => {
        expect(suggestVersions([ver("mxc-home-fresh", 1), ver("mxc-home", 2)])).toEqual([]);
    });

    it("does not match council-ux with council-stronger on the shared first word", () => {
        const ux = ver("council-ux", 1, { title: "Council UX" });
        const stronger = ver("council-stronger", 2, { title: "Council, stronger" });
        expect(suggestVersions([ux, stronger])).toEqual([]);
    });

    it("matches titles whose words overlap enough, and not ones that share too few", () => {
        const base = ver("sidebar-tree", 1, { title: "Agent sidebar tree" });
        const redo = ver("nav-rework", 2, { title: "Agent sidebar tree, redrawn" });
        expect(pairsOf(suggestVersions([base, redo]))).toEqual(["nav-rework replaces sidebar-tree"]);
        // one shared word
        expect(suggestVersions([base, ver("agent-dock", 3, { title: "Agent cockpit" })])).toEqual([]);
        // two shared words, but a small part of the longer title
        const wide = ver("big", 4, { title: "Agent sidebar tree dock rooms floors" });
        expect(suggestVersions([ver("small", 3, { title: "Agent sidebar" }), wide])).toEqual([]);
    });

    it("drops stopwords and words under three letters before it compares titles", () => {
        // kept, these would share home / and / the / ui / of / it (6 of 8 words); dropped, only "home" is shared
        const a = ver("one", 1, { title: "Home, and the UI of it one" });
        const b = ver("two", 2, { title: "Home, and the UI of it two" });
        expect(suggestVersions([a, b])).toEqual([]);
    });

    it("keeps one project from matching another", () => {
        const home = ver("mxc-home", 1);
        const fresh = ver("mxc-home-fresh", 2, {
            project: "D:/work/other",
            dir: "D:/work/other/.superpowers/design/mxc-home-fresh",
        });
        expect(suggestVersions([home, fresh])).toEqual([]);
    });

    it("is suppressed by a notreplaces naming the older topic, and by an existing link", () => {
        const home = ver("mxc-home", 1);
        expect(suggestVersions([home, ver("mxc-home-fresh", 2, { notreplaces: ["mxc-home"] })])).toEqual([]);
        expect(suggestVersions([home, ver("mxc-home-fresh", 2, { notreplaces: ["unrelated"] })])).toHaveLength(1);
        expect(suggestVersions([home, ver("mxc-home-fresh", 2, { replaces: "mxc-home" })])).toEqual([]);
    });

    it("offers a canvas that is already replaced to nobody", () => {
        // fresh replaces home, so home is no chain head: v3 is suggested onto fresh, never onto home as well
        const home = ver("mxc-home", 1);
        const fresh = ver("mxc-home-fresh", 2, { replaces: "mxc-home" });
        const v3 = ver("mxc-home-fresh-v3", 3);
        expect(suggestVersions([home, fresh, v3])).toEqual([{ newer: v3, older: fresh }]);
    });

    it("treats a replaces naming a missing canvas as no link, so the canvas can still be suggested", () => {
        const home = ver("mxc-home", 1);
        const fresh = ver("mxc-home-fresh", 2, { replaces: "gone" });
        expect(suggestVersions([home, fresh])).toEqual([{ newer: fresh, older: home }]);
    });

    it("gives each newer canvas its best match, the longest prefix", () => {
        const app = ver("app", 1);
        const appHome = ver("app-home", 2);
        const fresh = ver("app-home-fresh", 3);
        // fresh could replace either; app-home is the closer one. app-home is left to replace app.
        expect(pairsOf(suggestVersions([app, appHome, fresh]))).toEqual([
            "app-home-fresh replaces app-home",
            "app-home replaces app",
        ]);
    });

    it("gives each older canvas one replacer, the one created last", () => {
        const app = ver("app", 1);
        const a = ver("app-a", 2);
        const b = ver("app-b", 3);
        expect(pairsOf(suggestVersions([app, a, b]))).toEqual(["app-b replaces app"]);
    });

    it("orders the suggestions newest first, whatever order the list came in", () => {
        const list = [ver("a", 1), ver("a-two", 5), ver("b", 2), ver("b-two", 9)];
        expect(pairsOf(suggestVersions(list))).toEqual(["b-two replaces b", "a-two replaces a"]);
        expect(pairsOf(suggestVersions([...list].reverse()))).toEqual(["b-two replaces b", "a-two replaces a"]);
    });

    it("orders a pair created at the same time by topic", () => {
        const home = ver("mxc-home", 4);
        const fresh = ver("mxc-home-fresh", 4);
        expect(suggestVersions([fresh, home])).toEqual([{ newer: fresh, older: home }]);
    });

    it("has nothing to suggest for fewer than two canvases", () => {
        expect(suggestVersions([])).toEqual([]);
        expect(suggestVersions([ver("only", 1)])).toEqual([]);
    });
});

describe("linkCandidates", () => {
    const a = ver("a", 1);
    const b = ver("b", 2, { replaces: "a", title: "Overview" });
    const c = ver("c", 3);
    const other = ver("z", 1, { project: "D:/work/other", dir: "D:/work/other/.superpowers/design/z" });
    const me = ver("me", 5, { replaces: "c" });
    const newer = ver("n", 6);
    const all = [a, b, c, other, me, newer];

    it("lists the older canvases of the project that nothing else replaces, the current one marked, newest first", () => {
        const got = linkCandidates(all, me, "");
        expect(got.map((r) => [r.canvas.topic, r.current])).toEqual([
            ["c", true],
            ["b", false],
        ]);
    });

    it("filters by topic and title", () => {
        expect(topics(linkCandidates(all, me, "B").map((r) => r.canvas))).toEqual(["b"]);
        expect(topics(linkCandidates(all, me, " overview ").map((r) => r.canvas))).toEqual(["b"]);
        expect(linkCandidates(all, me, "nothing like it")).toEqual([]);
    });

    it("lists a canvas replaced only by this one, and drops one another canvas already replaces", () => {
        const got = topics(linkCandidates(all, me, "").map((r) => r.canvas));
        expect(got).toContain("c");
        expect(got).not.toContain("a");
    });

    it("marks nothing current for a canvas that replaces nothing", () => {
        expect(linkCandidates(all, c, "").map((r) => [r.canvas.topic, r.current])).toEqual([["b", false]]);
    });

    it("is empty when no canvas of the project is older", () => {
        expect(linkCandidates(all, a, "")).toEqual([]);
        expect(linkCandidates([me], me, "")).toEqual([]);
    });

    it("keeps the canvases created at the same time apart by topic", () => {
        const x = ver("x", 7);
        const y = ver("y", 7);
        expect(topics(linkCandidates([x, y], y, "").map((r) => r.canvas))).toEqual(["x"]);
        expect(linkCandidates([x, y], x, "")).toEqual([]);
    });
});

describe("link writes", () => {
    const c = ver("mxc-home-fresh", 2, { notreplaces: ["zeta", "old", "alpha"] });

    it("links by setting replaces and dropping that topic from notreplaces", () => {
        expect(linkWrite(c, "old")).toEqual({ dir: c.dir, replaces: "old", notreplaces: ["alpha", "zeta"] });
        expect(linkWrite(ver("n", 1), "old")).toEqual({ dir: ver("n", 1).dir, replaces: "old", notreplaces: [] });
    });

    it("unlinks by clearing replaces and remembering the old topic in notreplaces", () => {
        const linked = ver("n", 2, { replaces: "old", notreplaces: ["b", "a"] });
        expect(unlinkWrite(linked)).toEqual({ dir: linked.dir, replaces: "", notreplaces: ["a", "b", "old"] });
        // not twice
        expect(unlinkWrite(ver("n", 2, { replaces: "old", notreplaces: ["old"] })).notreplaces).toEqual(["old"]);
        // nothing to remember when it replaced nothing
        expect(unlinkWrite(ver("n", 2, { notreplaces: ["b"] }))).toEqual({
            dir: ver("n", 2).dir,
            replaces: "",
            notreplaces: ["b"],
        });
    });

    it("declines by adding to notreplaces and keeping replaces", () => {
        expect(declineWrite(c, "mxc-home")).toEqual({
            dir: c.dir,
            replaces: "",
            notreplaces: ["alpha", "mxc-home", "old", "zeta"],
        });
        const linked = ver("n", 2, { replaces: "kept" });
        expect(declineWrite(linked, "other")).toEqual({ dir: linked.dir, replaces: "kept", notreplaces: ["other"] });
        expect(declineWrite(c, "old").notreplaces).toEqual(["alpha", "old", "zeta"]);
    });

    it("does not change the canvas it was given", () => {
        const before = [...(c.notreplaces ?? [])];
        linkWrite(c, "old");
        unlinkWrite(c);
        declineWrite(c, "new");
        expect(c.notreplaces).toEqual(before);
    });

    it("writes a link for each ticked suggestion and a decline for each unticked one", () => {
        const home = ver("mxc-home", 1);
        const fresh = ver("mxc-home-fresh", 2);
        const ov = ver("project-overview", 3);
        const hist = ver("project-overview-history", 4);
        const suggestions = [
            { newer: hist, older: ov },
            { newer: fresh, older: home },
        ];
        expect(scanWrites(suggestions, new Set([hist.dir]))).toEqual([
            { dir: hist.dir, replaces: "project-overview", notreplaces: [] },
            { dir: fresh.dir, replaces: "", notreplaces: ["mxc-home"] },
        ]);
        expect(scanWrites(suggestions, new Set())).toEqual([
            { dir: hist.dir, replaces: "", notreplaces: ["project-overview"] },
            { dir: fresh.dir, replaces: "", notreplaces: ["mxc-home"] },
        ]);
        expect(scanWrites([], new Set())).toEqual([]);
    });

    it("words the review's Link button", () => {
        expect(scanLinkLabel(1)).toBe("Link 1 pair");
        expect(scanLinkLabel(0)).toBe("Link 0 pairs");
        expect(scanLinkLabel(7)).toBe("Link 7 pairs");
    });
});
