import { describe, expect, it } from "vitest";
import {
    buildDetailText,
    buildProjectRows,
    cleanableTotal,
    cleanAllIds,
    cleanToast,
    confirmFor,
    dayKey,
    formatSize,
    isWalking,
    lastUsedText,
    sessionRows,
    shouldNudge,
    sizeAllLabel,
    sizedAgoText,
    sizeText,
    skippedOf,
    storageCards,
    usedTotal,
    withoutCleaned,
} from "./storagemodel";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 12);
const MB = 1000 * 1000;
const GB = 1000 * MB;

const item = (id: string, over: Partial<StorageItem> = {}): StorageItem => ({
    id,
    kind: "worktree",
    label: id,
    bytes: 10 * MB,
    cleanable: true,
    ...over,
});

const report: StorageReport = {
    scannedts: NOW,
    scanning: false,
    storebytes: 43 * MB,
    categories: [
        {
            category: "buildoutput",
            bytes: 3 * GB,
            cleanablebytes: 3 * GB,
            items: [item("/p/target", { kind: "build", label: "target", detail: "/p", bytes: 3 * GB })],
        },
        {
            category: "runworktrees",
            bytes: 30 * MB,
            cleanablebytes: 10 * MB,
            items: [
                item("a"),
                item("b", { cleanable: false, guarded: true, reason: "has uncommitted changes" }),
                item("c", { cleanable: false, reason: "run still running" }),
            ],
        },
        {
            category: "sessions",
            bytes: 30 * MB,
            cleanablebytes: 30 * MB,
            items: [
                item("s40", { kind: "session", modts: NOW - 40 * DAY }),
                item("s10", { kind: "session", modts: NOW - 10 * DAY }),
                item("s95", { kind: "session", modts: NOW - 95 * DAY }),
            ],
        },
        { category: "housekeeping", bytes: 0, cleanablebytes: 0, items: [], error: "couldn't read the trash" },
    ],
};

// pkg/storage reports every canvas topic as a guarded item, so no bulk clean ever takes one
const canvas = (id: string, bytes: number): StorageItem =>
    item(id, { kind: "canvas", label: id, detail: "arcterm · 2 boards", bytes, guarded: true });

const withCanvases: StorageReport = {
    ...report,
    categories: [
        ...(report.categories ?? []),
        {
            category: "canvases",
            bytes: 5 * MB,
            cleanablebytes: 0,
            items: [canvas("/p/.superpowers/design/a", 2 * MB), canvas("/p/.superpowers/design/b", 3 * MB)],
        },
    ],
};

describe("storageCards", () => {
    it("orders the cards worktrees, sessions, housekeeping, build output", () => {
        expect(storageCards(report, "30", NOW, {}).map((c) => c.category)).toEqual([
            "runworktrees",
            "sessions",
            "housekeeping",
            "buildoutput",
        ]);
    });
    it("keeps the sessions older than the chosen age", () => {
        const sessions = (days: "7" | "30" | "90") =>
            storageCards(report, days, NOW, {}).find((c) => c.category === "sessions")!;
        expect(sessions("7").rows.map((r) => r.id)).toEqual(["s40", "s10", "s95"]);
        expect(sessions("30").rows.map((r) => r.id)).toEqual(["s40", "s95"]);
        expect(sessions("90").rows.map((r) => r.id)).toEqual(["s95"]);
        expect(sessions("30").bytes).toBe(20 * MB);
    });
    it("joins a clean's skipped reasons onto their rows and keeps a card's error", () => {
        const cards = storageCards(report, "30", NOW, { a: "run still running" });
        expect(cards[0].rows.find((r) => r.id === "a")!.skipped).toBe("run still running");
        expect(cards.find((c) => c.category === "housekeeping")!.error).toBe("couldn't read the trash");
    });
    it("shows the scan's own reason over a clean's older skip reason", () => {
        const cards = storageCards(report, "30", NOW, { b: "couldn't remove: x" });
        const b = cards[0].rows.find((r) => r.id === "b")!;
        expect(b.reason).toBe("has uncommitted changes");
        expect(b.skipped).toBeUndefined();
    });
    it("is empty before the first report", () => {
        expect(storageCards(null, "30", NOW, {})).toEqual([]);
    });
    it("puts Design canvases last, as a card with a size, rows and no button of its own", () => {
        const cards = storageCards(withCanvases, "30", NOW, {});
        expect(cards.map((c) => c.category)).toEqual([
            "runworktrees",
            "sessions",
            "housekeeping",
            "buildoutput",
            "canvases",
        ]);
        const canvases = cards[4];
        expect(canvases.title).toBe("Design canvases");
        expect(canvases.action).toBeNull();
        expect(canvases.rows).toHaveLength(2);
        expect(canvases.bytes).toBe(5 * MB);
        expect(canvases.cleanableBytes).toBe(0);
    });
});

describe("cleanAllIds", () => {
    it("takes only cleanable, unguarded rows", () => {
        expect(cleanAllIds(storageCards(report, "30", NOW, {})[0])).toEqual(["a"]);
    });
    it("takes no canvas, which only the gallery's Clean up moves", () => {
        expect(cleanAllIds(storageCards(withCanvases, "30", NOW, {})[4])).toEqual([]);
    });
});

describe("totals", () => {
    it("counts what can be cleaned at the chosen age, build output included", () => {
        expect(cleanableTotal(report, "30", NOW)).toBe(10 * MB + 20 * MB + 3 * GB);
    });
    it("leaves the canvases out of what can be cleaned and counts them in what arcterm uses", () => {
        expect(cleanableTotal(withCanvases, "30", NOW)).toBe(cleanableTotal(report, "30", NOW));
        expect(usedTotal(withCanvases)).toBe(usedTotal(report) + 5 * MB);
    });
    it("counts everything arcterm uses, the store included", () => {
        expect(usedTotal(report)).toBe(3 * GB + 30 * MB + 30 * MB + 43 * MB);
    });
    it("leaves the package caches the whole machine shares out of both, and shows their card after build output", () => {
        const caches: StorageReport = {
            ...report,
            categories: [
                ...(report.categories ?? []),
                {
                    category: "packagecaches",
                    bytes: 4 * GB,
                    cleanablebytes: 4 * GB,
                    items: [item("go-build", { kind: "cache", label: "Go build cache", bytes: 4 * GB })],
                },
            ],
        };
        expect(usedTotal(caches)).toBe(usedTotal(report));
        expect(cleanableTotal(caches, "30", NOW)).toBe(cleanableTotal(report, "30", NOW));
        expect(storageCards(caches, "30", NOW, {}).map((c) => c.category)).toEqual([
            "runworktrees",
            "sessions",
            "housekeeping",
            "buildoutput",
            "packagecaches",
        ]);
    });
});

describe("shouldNudge", () => {
    it("nudges past the threshold once a day", () => {
        expect(shouldNudge(3 * GB, 2, null, "2026-10-08")).toBe(true);
        expect(shouldNudge(3 * GB, 2, "2026-10-08", "2026-10-08")).toBe(false);
        expect(shouldNudge(3 * GB, 2, "2026-10-07", "2026-10-08")).toBe(true);
        expect(shouldNudge(1 * GB, 2, null, "2026-10-08")).toBe(false);
        expect(shouldNudge(3 * GB, 0, null, "2026-10-08")).toBe(false);
    });
    it("keys a day by the local date", () => {
        expect(dayKey(new Date(2026, 9, 8, 23, 59).getTime())).toBe("2026-10-08");
    });
});

describe("formatSize", () => {
    it("reads at a glance", () => {
        expect(formatSize(0)).toBe("0 KB");
        expect(formatSize(512 * 1000)).toBe("512 KB");
        expect(formatSize(152 * MB)).toBe("152 MB");
        expect(formatSize(3.44 * GB)).toBe("3.4 GB");
        expect(formatSize(2 * GB)).toBe("2 GB");
    });
});

describe("clean results", () => {
    it("says what was reclaimed, trashed, deferred and skipped", () => {
        expect(cleanToast({ reclaimed: 152 * MB, cleaned: ["a"], skipped: [] })).toBe("Reclaimed 152 MB");
        expect(
            cleanToast({
                reclaimed: 0,
                trashed: 20 * MB,
                cleaned: ["s"],
                skipped: [{ id: "x", reason: "open in a tab" }],
            })
        ).toBe("Moved 20 MB to the trash; 1 skipped");
        expect(cleanToast({ reclaimed: 0, deferred: true, cleaned: ["webviewcache"], skipped: [] })).toBe(
            "The interface cache clears when arcterm next opens"
        );
        expect(cleanToast({ reclaimed: 0, cleaned: [], skipped: [] })).toBe("Nothing was cleaned");
        expect(skippedOf({ reclaimed: 0, cleaned: [], skipped: [{ id: "x", reason: "why" }] })).toEqual({ x: "why" });
    });
});

describe("confirmFor", () => {
    it("names what goes and what it costs", () => {
        const cards = storageCards(report, "30", NOW, {});
        const wt = confirmFor(cards[0], [cards[0].rows[0]], "30", false, false);
        expect(wt.message).toContain("1 run worktree");
        expect(wt.message).toContain("branches stay");
        const guarded = confirmFor(cards[0], [cards[0].rows[1]], "30", true, false);
        expect(guarded.message).toContain("uncommitted changes");
        const sessions = cards[1];
        expect(confirmFor(sessions, sessions.rows, "30", false, false).message).toContain("older than 30 days");
        const build = confirmFor(cards[3], cards[3].rows, "30", false, false).message;
        expect(build).toContain("build output of p");
        expect(build).toContain("target");
        expect(build).toContain("recreates it");
        const cache = { ...cards[0], category: "packagecaches" };
        const goBuild = item("go-build", { kind: "cache", label: "Go build cache", bytes: 4 * GB });
        expect(confirmFor(cache, [goBuild], "30", false, false).message).toContain("Remove the Go build cache (4 GB)?");
        expect(confirmFor(cache, [goBuild], "30", false, false).message).toContain("fetches or rebuilds");
    });

    describe("sessions never scanned for ideas", () => {
        const session = (id: string, unscanned: boolean) =>
            item(id, { kind: "session", modts: NOW - 40 * DAY, unscanned: unscanned || undefined });
        const card = (rows: StorageItem[]) => ({
            ...storageCards(report, "30", NOW, {})[1],
            rows,
        });

        it("says how many of them were never scanned, and offers nothing before the first scan", () => {
            const rows = [session("a", true), session("b", false), session("c", true)];
            const c = confirmFor(card(rows), rows, "30", false, false);
            expect(c.message).toContain("2 of them were never scanned for ideas");
            expect(c.altLabel).toBeUndefined();
            expect(c.scanFirstIds).toBeUndefined();
        });

        it("after the first scan offers to scan exactly those, which moves nothing", () => {
            const rows = [session("a", true), session("b", false), session("c", true)];
            const c = confirmFor(card(rows), rows, "30", false, true);
            expect(c.message).toContain("2 of them were never scanned for ideas");
            expect(c.altLabel).toBe("Scan them first");
            expect(c.scanFirstIds).toEqual(["a", "c"]);
            expect(c.confirmLabel).toBe("Move to trash");
        });

        it("says was for one, and says nothing when every session was scanned", () => {
            const one = [session("a", true), session("b", false)];
            expect(confirmFor(card(one), one, "30", false, true).message).toContain(
                "1 of them was never scanned for ideas"
            );
            const none = [session("a", false), session("b", false)];
            const c = confirmFor(card(none), none, "30", false, true);
            expect(c.message).not.toContain("never scanned");
            expect(c.altLabel).toBeUndefined();
            expect(c.scanFirstIds).toBeUndefined();
        });

        it("counts only the sessions the clean would move", () => {
            const all = [session("a", true), session("b", true), session("c", true)];
            const c = confirmFor(card(all), [all[0]], "30", false, true);
            expect(c.message).toContain("1 of them was never scanned for ideas");
            expect(c.scanFirstIds).toEqual(["a"]);
        });

        it("is the sessions card's alone", () => {
            const cards = storageCards(report, "30", NOW, {});
            const wt = confirmFor(cards[0], [{ ...cards[0].rows[0], unscanned: true }], "30", false, true);
            expect(wt.message).not.toContain("never scanned");
            expect(wt.altLabel).toBeUndefined();
        });
    });
});

describe("buildProjectRows", () => {
    const build = (items: StorageItem[], skipped: Record<string, string> = {}) =>
        storageCards(
            { ...report, categories: [{ category: "buildoutput", bytes: 0, cleanablebytes: 0, items }] },
            "30",
            NOW,
            skipped
        )[0];
    it("folds a project's folders into one row with one button", () => {
        const rows = buildProjectRows(
            build(
                [
                    item("/p/node_modules", { kind: "build", label: "node_modules", detail: "/p", bytes: 2 * MB }),
                    item("/p/src-tauri/target", {
                        kind: "build",
                        label: "src-tauri/target",
                        detail: "/p",
                        bytes: 3 * MB,
                    }),
                    item("/q/dist", {
                        kind: "build",
                        label: "dist",
                        detail: "/q",
                        bytes: MB,
                        cleanable: false,
                        reason: "agent working in this project",
                    }),
                ],
                { "/p/node_modules": "couldn't remove: in use" }
            )
        );
        expect(rows.map((r) => r.name)).toEqual(["p", "q"]);
        expect(rows[0]).toMatchObject({
            project: "/p",
            dirs: ["node_modules", "src-tauri/target"],
            bytes: 5 * MB,
            ids: ["/p/node_modules", "/p/src-tauri/target"],
            skipped: "couldn't remove: in use",
        });
        expect(rows[1]).toMatchObject({ ids: [], reason: "agent working in this project" });
    });
    it("puts the longest unused project first, its folders largest first", () => {
        const b = (id: string, project: string, bytes: number, modts?: number) =>
            item(id, { kind: "build", label: id.slice(project.length + 1), detail: project, bytes, modts });
        const rows = buildProjectRows(
            build([
                b("/new/node_modules", "/new", 9 * MB, NOW - DAY),
                b("/old/dist", "/old", MB, NOW - 180 * DAY),
                b("/old/node_modules", "/old", 2 * MB, NOW - 180 * DAY),
                b("/none/target", "/none", MB),
            ])
        );
        expect(rows.map((r) => r.name)).toEqual(["none", "old", "new"]);
        expect(rows[1].lastUsed).toBe(NOW - 180 * DAY);
        expect(rows[1].folders.map((f) => f.label)).toEqual(["node_modules", "dist"]);
    });
    it("names a Windows project by its last segment", () => {
        const rows = buildProjectRows(
            build([item("C:\\work\\app\\dist", { kind: "build", label: "dist", detail: "C:\\work\\app\\" })])
        );
        expect(rows[0].name).toBe("app");
    });
});

// Build output's kept sizes: pkg/storage lists every folder and fills Bytes / SizedTs from what was last sized
// (0 and no sizedts for a folder never sized), so the card says `not sized` from sizedts, never from bytes.
describe("kept build sizes", () => {
    const folder = (project: string, dir: string, bytes: number, sizedts?: number, modts?: number) =>
        item(`${project}/${dir}`, { kind: "build", label: dir, detail: project, bytes, sizedts, modts });
    const cardOf = (items: StorageItem[]) =>
        storageCards(
            { ...report, categories: [{ category: "buildoutput", bytes: 0, cleanablebytes: 0, items }] },
            "30",
            NOW,
            {}
        )[0];
    const rowsOf = (items: StorageItem[]) => buildProjectRows(cardOf(items));

    describe("sizeText", () => {
        it("says not sized until the folder was sized, whatever its bytes", () => {
            expect(sizeText(0, undefined)).toBe("not sized");
            expect(sizeText(0, 0)).toBe("not sized");
            expect(sizeText(5 * MB, 0)).toBe("not sized");
        });
        it("shows a size once there is one, 0 included: an empty folder was sized", () => {
            expect(sizeText(152 * MB, NOW - DAY)).toBe("152 MB");
            expect(sizeText(0, NOW)).toBe("0 KB");
        });
    });

    describe("a project's sized state", () => {
        it("is not sized when none of its folders has a size", () => {
            const [p] = rowsOf([folder("/p", "node_modules", 0), folder("/p", "target", 0, 0)]);
            expect(p.sizedTs).toBe(0);
            expect(p.bytes).toBe(0);
            expect(sizeText(p.bytes, p.sizedTs)).toBe("not sized");
        });
        it("shows the sum of the kept sizes when only some folders were sized (call 11)", () => {
            const [p] = rowsOf([
                folder("/p", "node_modules", 7 * MB, NOW - 3 * DAY),
                folder("/p", "target", 0),
                folder("/p", "dist", 2 * MB, NOW - DAY),
            ]);
            expect(p.bytes).toBe(9 * MB);
            expect(sizeText(p.bytes, p.sizedTs)).toBe("9 MB");
            // the folder never sized says so itself, and the ones sized show their own kept size
            expect(p.folders.map((f) => sizeText(f.bytes, f.sizedts))).toEqual(["7 MB", "2 MB", "not sized"]);
        });
        it("dates the project by the oldest kept size among the folders that have one", () => {
            const [p] = rowsOf([
                folder("/p", "node_modules", 7 * MB, NOW - 3 * DAY),
                folder("/p", "target", 0), // never sized: no ts to count
                folder("/p", "dist", 2 * MB, NOW - DAY),
            ]);
            expect(p.sizedTs).toBe(NOW - 3 * DAY);
        });
        it("keeps the project order: last used first, then size, an unsized project counting 0 bytes", () => {
            const rows = rowsOf([
                folder("/sized", "dist", 5 * MB, NOW - DAY, NOW - 30 * DAY),
                folder("/unsized", "dist", 0, undefined, NOW - 30 * DAY),
                folder("/old", "dist", 0, undefined, NOW - 90 * DAY),
                folder("/new", "dist", 9 * MB, NOW - DAY, NOW - DAY),
            ]);
            expect(rows.map((r) => r.name)).toEqual(["old", "sized", "unsized", "new"]);
        });
    });

    describe("sizedAgoText", () => {
        it("says how long ago, from a day on", () => {
            expect(sizedAgoText(NOW - DAY, NOW)).toBe("sized 1 day ago");
            expect(sizedAgoText(NOW - 2 * DAY, NOW)).toBe("sized 2 days ago");
            expect(sizedAgoText(NOW - 2 * DAY - 5 * 60 * 60 * 1000, NOW)).toBe("sized 2 days ago");
            expect(sizedAgoText(NOW - 40 * DAY, NOW)).toBe("sized 40 days ago");
        });
        it("says nothing for a size from the last day, a project never sized or a clock ahead", () => {
            expect(sizedAgoText(NOW, NOW)).toBe("");
            expect(sizedAgoText(NOW - DAY + 1, NOW)).toBe("");
            expect(sizedAgoText(0, NOW)).toBe("");
            expect(sizedAgoText(NOW + DAY, NOW)).toBe("");
        });
    });

    describe("buildDetailText", () => {
        it("adds the sized text after the last-used text, and only when there is one", () => {
            expect(buildDetailText(NOW - 19 * DAY, NOW - 2 * DAY, NOW)).toBe("used 19 days ago · sized 2 days ago");
            expect(buildDetailText(0, NOW - 3 * DAY, NOW)).toBe("no agent session · sized 3 days ago");
            expect(buildDetailText(NOW - 19 * DAY, NOW - 60 * 60 * 1000, NOW)).toBe("used 19 days ago");
            expect(buildDetailText(NOW - 19 * DAY, 0, NOW)).toBe("used 19 days ago");
        });
    });

    describe("sizeAllLabel", () => {
        it("is Size all when nothing is queued or walking", () => {
            expect(sizeAllLabel(undefined)).toBe("Size all");
            expect(sizeAllLabel(null)).toBe("Size all");
        });
        it("counts the project in hand: Done + 1 of Total", () => {
            expect(sizeAllLabel({ queued: ["/a"], walking: "/b", done: 2, total: 12 })).toBe("Stop sizing (3 of 12)");
            expect(sizeAllLabel({ queued: [], walking: "/b", done: 0, total: 1 })).toBe("Stop sizing (1 of 1)");
        });
        it("never reads past the total: between two projects of a queue nothing is walking", () => {
            expect(sizeAllLabel({ queued: ["/c"], done: 12, total: 12 })).toBe("Stop sizing (12 of 12)");
            expect(sizeAllLabel({ queued: [], done: 5, total: 4 })).toBe("Stop sizing (4 of 4)");
        });
    });

    describe("isWalking", () => {
        it("is true only for the project being walked, not for the ones queued", () => {
            const sizing = { queued: ["/b", "/c"], walking: "/a", done: 0, total: 3 };
            expect(isWalking(sizing, "/a")).toBe(true);
            expect(isWalking(sizing, "/b")).toBe(false);
            expect(isWalking({ queued: ["/a"], done: 1, total: 2 }, "/a")).toBe(false);
            expect(isWalking(undefined, "/a")).toBe(false);
        });
    });

    describe("totals", () => {
        it("add the kept sizes, a folder never sized counting 0", () => {
            const items = [
                folder("/p", "node_modules", 7 * MB, NOW - 3 * DAY),
                folder("/p", "target", 0),
                folder("/q", "dist", 0),
            ];
            const rep: StorageReport = {
                ...report,
                categories: [{ category: "buildoutput", bytes: 7 * MB, cleanablebytes: 7 * MB, items }],
            };
            expect(cleanableTotal(rep, "30", NOW)).toBe(7 * MB);
            expect(usedTotal(rep)).toBe(7 * MB + 43 * MB);
        });
    });

    describe("confirmFor build output", () => {
        const confirm = (items: StorageItem[]) => {
            const card = cardOf(items);
            return confirmFor(card, card.rows, "30", false, false);
        };
        it("leaves the size out for a project none of whose folders was sized, rather than say 0 KB", () => {
            const c = confirm([folder("/p", "node_modules", 0), folder("/p", "target", 0)]);
            expect(c.message).toBe(
                "Remove the build output of p: node_modules, target? The next build or install recreates it."
            );
            expect(c.title).toBe("Remove build output");
            expect(c.confirmLabel).toBe("Remove");
        });
        it("shows the kept sum otherwise, as the row does", () => {
            const c = confirm([folder("/p", "node_modules", 7 * MB, NOW - 3 * DAY), folder("/p", "target", 0)]);
            expect(c.message).toBe(
                "Remove the build output of p (7 MB): node_modules, target? The next build or install recreates it."
            );
        });
        it("counts a size of 0 as a size: an empty folder was sized", () => {
            const c = confirm([folder("/p", "target", 0, NOW)]);
            expect(c.message).toContain("build output of p (0 KB)");
        });
    });
});

describe("lastUsedText", () => {
    it("says when an agent last worked in the project", () => {
        expect(lastUsedText(0, NOW)).toBe("no agent session");
        expect(lastUsedText(NOW - 3 * 60 * 60 * 1000, NOW)).toBe("used today");
        expect(lastUsedText(NOW - DAY, NOW)).toBe("used 1 day ago");
        expect(lastUsedText(NOW - 19 * DAY, NOW)).toBe("used 19 days ago");
        expect(lastUsedText(NOW - 180 * DAY, NOW)).toBe("used 6 months ago");
    });
});

describe("sessionRows", () => {
    it("treats a missing time as old", () => {
        expect(sessionRows([item("x", { kind: "session" })], "90", NOW).map((r) => r.id)).toEqual(["x"]);
    });
});

describe("withoutCleaned", () => {
    it("drops what a clean took, takes its bytes off its category and says a scan is under way", () => {
        const after = withoutCleaned(report, ["a", "/p/target"]);
        expect(after.scanning).toBe(true);
        const build = after.categories.find((c) => c.category === "buildoutput");
        expect(build?.items).toEqual([]);
        expect(build?.bytes).toBe(0);
        expect(build?.cleanablebytes).toBe(0);
        const trees = after.categories.find((c) => c.category === "runworktrees");
        expect(trees?.items.map((i) => i.id)).toEqual(["b", "c"]);
        expect(trees?.bytes).toBe(20 * MB);
        expect(trees?.cleanablebytes).toBe(0);
        expect(usedTotal(after)).toBe(usedTotal(report) - 3 * GB - 10 * MB);
    });
    it("leaves a category the clean did not touch as it was", () => {
        const after = withoutCleaned(report, ["a"]);
        expect(after.categories.find((c) => c.category === "sessions")).toBe(
            report.categories.find((c) => c.category === "sessions")
        );
    });
});
