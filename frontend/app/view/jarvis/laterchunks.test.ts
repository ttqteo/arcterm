import { describe, expect, it, vi } from "vitest";
import { laterCount, laterDueChip, laterGroups, tickLater, type LaterRowModel } from "./laterchunks";

const item = (label: string, over: Partial<EffortLaterItem> = {}): EffortLaterItem => ({
    label,
    status: "pending",
    since: 1000,
    ...over,
});

const summary = (oid: string, title: string, later: EffortLaterItem[] | undefined): EffortSummary =>
    ({
        oref: `effort:${oid}`,
        title,
        status: "active",
        done: 0,
        total: 0,
        updatedts: 1,
        later,
    }) as EffortSummary;

const labels = (groups: ReturnType<typeof laterGroups>) => groups.map((g) => g.items.map((i) => i.label));

describe("laterGroups", () => {
    it("is empty with no summaries, and leaves out an initiative with nothing saved for later", () => {
        expect(laterGroups([], "")).toEqual([]);
        expect(laterGroups([summary("a", "Alpha", undefined), summary("b", "Beta", [])], "")).toEqual([]);
    });

    it("groups the items by initiative and carries what Ask agent and the tick need", () => {
        const groups = laterGroups(
            [
                summary("a", "Alpha", [
                    item("Decide the parser", {
                        status: "blocked",
                        due: "2026-12-01",
                        since: 5000,
                        note: "> passage\n\nfrom agent",
                        session: "agent:t1",
                        conversation: "conv-1",
                    }),
                ]),
            ],
            ""
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].oref).toBe("effort:a");
        expect(groups[0].title).toBe("Alpha");
        expect(groups[0].items).toEqual([
            {
                key: "effort:a\u0000Decide the parser",
                oref: "effort:a",
                label: "Decide the parser",
                status: "blocked",
                due: "2026-12-01",
                since: 5000,
                note: "> passage\n\nfrom agent",
                session: "agent:t1",
                conversation: "conv-1",
            } satisfies LaterRowModel,
        ]);
    });

    it("gives the same label in two initiatives two keys", () => {
        const groups = laterGroups([summary("a", "Alpha", [item("Same")]), summary("b", "Beta", [item("Same")])], "");
        const keys = groups.flatMap((g) => g.items.map((i) => i.key));
        expect(new Set(keys).size).toBe(2);
    });

    it("puts the initiative with the newest item first", () => {
        const groups = laterGroups(
            [
                summary("old", "Old", [item("a", { since: 100 }), item("b", { since: 200 })]),
                summary("new", "New", [item("c", { since: 50 }), item("d", { since: 900 })]),
                summary("mid", "Mid", [item("e", { since: 500 })]),
            ],
            ""
        );
        expect(groups.map((g) => g.title)).toEqual(["New", "Mid", "Old"]);
    });

    it("breaks a tie between groups by the initiative's ref, so the order is total", () => {
        const groups = laterGroups(
            [summary("b", "B", [item("x", { since: 7 })]), summary("a", "A", [item("y", { since: 7 })])],
            ""
        );
        expect(groups.map((g) => g.oref)).toEqual(["effort:a", "effort:b"]);
    });

    it("orders a group's items with a due first (earliest first), then the rest oldest first", () => {
        const groups = laterGroups(
            [
                summary("a", "Alpha", [
                    item("no due, newer", { since: 400 }),
                    item("due later", { due: "2026-12-10", since: 100 }),
                    item("no due, older", { since: 300 }),
                    item("due first", { due: "2026-11-27", since: 200 }),
                ]),
            ],
            ""
        );
        expect(labels(groups)).toEqual([["due first", "due later", "no due, older", "no due, newer"]]);
    });

    it("puts the older of two items with the same due first", () => {
        const groups = laterGroups(
            [
                summary("a", "Alpha", [
                    item("newer", { due: "2026-12-01", since: 300 }),
                    item("older", { due: "2026-12-01", since: 100 }),
                ]),
            ],
            ""
        );
        expect(labels(groups)).toEqual([["older", "newer"]]);
    });

    it("keeps the order of equal items as the summary lists them", () => {
        const groups = laterGroups([summary("a", "Alpha", [item("first"), item("second"), item("third")])], "");
        expect(labels(groups)).toEqual([["first", "second", "third"]]);
    });

    describe("the Brief's filter", () => {
        const all = [
            summary("a", "SIEM parsers", [item("Push DEV"), item("Decide 9306 or 1050")]),
            summary("b", "Job queue", [item("Ask the cap again"), item("Push the heavy job")]),
        ];

        it("keeps every item with a blank filter", () => {
            expect(laterCount(laterGroups(all, ""))).toBe(4);
            expect(laterCount(laterGroups(all, "   "))).toBe(4);
        });

        it("keeps the items whose label matches, ignoring case, and drops a group left empty", () => {
            const groups = laterGroups(all, "push");
            expect(labels(groups)).toEqual([["Push DEV"], ["Push the heavy job"]]);
        });

        it("keeps all of an initiative's items when its title matches", () => {
            const groups = laterGroups(all, "siem");
            expect(groups.map((g) => g.title)).toEqual(["SIEM parsers"]);
            expect(labels(groups)).toEqual([["Push DEV", "Decide 9306 or 1050"]]);
        });

        it("trims the filter", () => {
            expect(laterCount(laterGroups(all, "  queue  "))).toBe(2);
        });

        it("is empty when nothing matches", () => {
            expect(laterGroups(all, "zzz")).toEqual([]);
        });
    });
});

describe("laterCount", () => {
    it("adds the items of every group", () => {
        const groups = laterGroups([summary("a", "A", [item("x"), item("y")]), summary("b", "B", [item("z")])], "");
        expect(laterCount(groups)).toBe(3);
        expect(laterCount([])).toBe(0);
    });
});

describe("laterDueChip", () => {
    it("shows nothing before the due day has come, and with no due", () => {
        expect(laterDueChip(undefined, "pending", "2026-11-27")).toBeNull();
        expect(laterDueChip("2026-11-28", "pending", "2026-11-27")).toBeNull();
    });
    it("shows the date once the day has come, today included", () => {
        expect(laterDueChip("2026-11-27", "pending", "2026-11-27")).toBe("due 11-27");
        expect(laterDueChip("2026-11-20", "active", "2026-11-27")).toBe("due 11-20");
    });
    it("spells out the year when the due is in another year", () => {
        expect(laterDueChip("2025-12-31", "blocked", "2026-01-02")).toBe("due 2025-12-31");
    });
});

describe("tickLater", () => {
    const row = (over: Partial<LaterRowModel> = {}): LaterRowModel => ({
        key: "effort:a\u0000Push DEV",
        oref: "effort:a",
        label: "Push DEV",
        status: "pending",
        since: 1,
        note: "",
        ...over,
    });
    const deps = () => {
        const calls: { oref: string; chunk: string; status: string }[] = [];
        const setChunkStatus = vi.fn(async (oref: string, chunk: string, status: string) => {
            calls.push({ oref, chunk, status });
        });
        const undo = {
            notify: vi.fn<(text: string, undo?: () => void) => void>(),
            error: vi.fn<(text: string) => void>(),
        };
        return { calls, setChunkStatus, undo };
    };

    it("sets the chunk done and says so, naming the item", async () => {
        const d = deps();
        expect(await tickLater(d, row())).toBe(true);
        expect(d.calls).toEqual([{ oref: "effort:a", chunk: "Push DEV", status: "done" }]);
        expect(d.undo.notify).toHaveBeenCalledOnce();
        expect(d.undo.notify.mock.calls[0][0]).toBe("Done · Push DEV");
        expect(d.undo.error).not.toHaveBeenCalled();
    });

    it("gives the toast an Undo that puts the previous status back", async () => {
        for (const status of ["pending", "active", "blocked"]) {
            const d = deps();
            await tickLater(d, row({ status }));
            d.undo.notify.mock.calls[0][1]?.();
            await Promise.resolve();
            expect(d.calls.at(-1)).toEqual({ oref: "effort:a", chunk: "Push DEV", status });
        }
    });

    it("shows the server's own words and no success toast when the write is refused", async () => {
        const d = deps();
        d.setChunkStatus.mockRejectedValueOnce(new Error("chunk not found"));
        expect(await tickLater(d, row())).toBe(false);
        expect(d.undo.error).toHaveBeenCalledWith("chunk not found");
        expect(d.undo.notify).not.toHaveBeenCalled();
    });

    it("tells a refused Undo in an error toast", async () => {
        const d = deps();
        await tickLater(d, row());
        d.setChunkStatus.mockRejectedValueOnce(new Error("gone"));
        d.undo.notify.mock.calls[0][1]?.();
        await new Promise((r) => setTimeout(r, 0));
        expect(d.undo.error).toHaveBeenCalledWith("gone");
    });
});
