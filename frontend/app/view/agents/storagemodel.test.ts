import { describe, expect, it } from "vitest";
import {
    buildProjectRows,
    cleanableTotal,
    cleanAllIds,
    cleanToast,
    confirmFor,
    dayKey,
    formatSize,
    sessionRows,
    shouldNudge,
    skippedOf,
    storageCards,
    usedTotal,
} from "./storagemodel";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 12);
const MB = 1024 * 1024;
const GB = 1024 * MB;

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
});

describe("cleanAllIds", () => {
    it("takes only cleanable, unguarded rows", () => {
        expect(cleanAllIds(storageCards(report, "30", NOW, {})[0])).toEqual(["a"]);
    });
});

describe("totals", () => {
    it("counts what can be cleaned at the chosen age, build output included", () => {
        expect(cleanableTotal(report, "30", NOW)).toBe(10 * MB + 20 * MB + 3 * GB);
    });
    it("counts everything arcterm uses, the store included", () => {
        expect(usedTotal(report)).toBe(3 * GB + 30 * MB + 30 * MB + 43 * MB);
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
        expect(formatSize(512 * 1024)).toBe("512 KB");
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
        const wt = confirmFor(cards[0], [cards[0].rows[0]], "30", false);
        expect(wt.message).toContain("1 run worktree");
        expect(wt.message).toContain("branches stay");
        const guarded = confirmFor(cards[0], [cards[0].rows[1]], "30", true);
        expect(guarded.message).toContain("uncommitted changes");
        const sessions = cards[1];
        expect(confirmFor(sessions, sessions.rows, "30", false).message).toContain("older than 30 days");
        const build = confirmFor(cards[3], cards[3].rows, "30", false).message;
        expect(build).toContain("build output of p");
        expect(build).toContain("target");
        expect(build).toContain("recreates it");
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
    it("names a Windows project by its last segment", () => {
        const rows = buildProjectRows(
            build([item("C:\\work\\app\\dist", { kind: "build", label: "dist", detail: "C:\\work\\app\\" })])
        );
        expect(rows[0].name).toBe("app");
    });
});

describe("sessionRows", () => {
    it("treats a missing time as old", () => {
        expect(sessionRows([item("x", { kind: "session" })], "90", NOW).map((r) => r.id)).toEqual(["x"]);
    });
});
