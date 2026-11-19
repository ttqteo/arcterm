// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    argumentGraph,
    benchPoints,
    glancePoints,
    MAX_TIMELINE_STEPS,
    seatLanes,
    seatSpend,
    stanceGrid,
} from "./councilfiguresmodel";
import { hasGlanceFigures, hasSpendFigures } from "./councilsummarymodel";

// The one fixture the vitest, the Go golden (pkg/council/charts_golden_test.go) and the CDP scenarios all read: a done
// Review council in the cockpit's `Council` shape, and what Go's chart formulas give for it.
const raw = JSON.parse(
    readFileSync(new URL("../../../../scripts/cdp/council/rail-apps-figures.json", import.meta.url), "utf8")
) as Council;
const golden = JSON.parse(
    readFileSync(new URL("../../../../pkg/council/testdata/glance-golden.json", import.meta.url), "utf8")
) as {
    maxTimelineSteps: number;
    directions: { rank: number; evidence: number; agreement: number; x: number; y: number }[];
    spans: Record<string, { start: number; end: number; steps: number }[]>;
};

/** A copy of the fixture, edited by `edit`. */
function fx(edit?: (c: Council) => void): Council {
    const c = structuredClone(raw);
    edit?.(c);
    return c;
}

const T0 = 1792573200000;

describe("the fixture", () => {
    it("is the council the figures are written against", () => {
        expect(raw.mode).toBe("review");
        expect(raw.experts.at(-1)?.id).toBe("coordinator");
        expect(raw.proposals).toHaveLength(9);
        expect(raw.summary?.directions).toHaveLength(3);
        expect(raw.summary?.kept).toHaveLength(2);
        expect(raw.tokens).toBeGreaterThan(Object.values(raw.stats ?? {}).reduce((n, s) => n + s.tokens, 0));
        expect(raw.calls).toBeGreaterThan(Object.values(raw.stats ?? {}).reduce((n, s) => n + s.calls, 0));
        expect(Math.max(...Object.values(raw.timeline ?? {}).map((s) => s.length))).toBe(200);
    });
});

describe("MAX_TIMELINE_STEPS", () => {
    it("is Go's", () => {
        expect(MAX_TIMELINE_STEPS).toBe(golden.maxTimelineSteps);
    });
});

describe("glancePoints (figure A)", () => {
    it("places every direction where Go's chart does", () => {
        const g = glancePoints(fx());
        expect(g).not.toBeNull();
        const points = g!.points;
        expect(points).toHaveLength(golden.directions.length);
        points.forEach((p, i) => {
            const want = golden.directions[i];
            expect(p.rank).toBe(want.rank);
            // held/evidence is directionPoint's x (0 of 0 has no ratio), backers/sides its y, before any clamping
            if (p.evidence > 0) {
                expect(p.held / p.evidence).toBeCloseTo(want.evidence, 9);
            } else {
                expect(want.evidence).toBe(0);
            }
            expect(p.backers / p.sides).toBeCloseTo(want.agreement, 9);
            expect(p.x).toBeCloseTo(want.x, 9);
            expect(p.y).toBeCloseTo(want.y, 9);
        });
    });

    it("counts the evidence held and the seats that back each direction", () => {
        const points = glancePoints(fx())!.points;
        expect(points.map((p) => [p.title, p.held, p.evidence, p.backers, p.sides])).toEqual([
            ["Move the rail pins from localStorage to settings", 3, 3, 4, 4],
            ["Show asleep and waking on the rail icon", 2, 2, 3, 3],
            ["Name the pinned app in its tooltip", 0, 0, 1, 4],
        ]);
    });

    it("draws a direction whose proposals cite nothing hollow, and no other", () => {
        expect(glancePoints(fx())!.points.map((p) => p.hollow)).toEqual([false, false, true]);
    });

    it("nudges the pair that coincide after the clamp apart, inward", () => {
        const [d1, d2] = glancePoints(fx())!.points;
        // both are 1 and 1: ChartUnit puts each at 0.9, and the second moves 0.05 inward on both axes
        expect([d1.x, d1.y]).toEqual([0.9, 0.9]);
        expect(d2.x).toBeCloseTo(0.85, 9);
        expect(d2.y).toBeCloseTo(0.85, 9);
    });

    it("keeps a point with no evidence off the edge", () => {
        const d3 = glancePoints(fx())!.points[2];
        expect(d3.x).toBeCloseTo(0.08, 9);
        expect(d3.y).toBeCloseTo(0.25, 9);
    });

    it("words the takeaway: who stands, then who is a guess", () => {
        expect(glancePoints(fx())!.takeaway).toBe(
            "D1 and D2 stand on checked evidence and the panel's backing; D3 is a guess."
        );
    });

    it("words it for every direction standing: the thinnest backing is named", () => {
        const c = fx((c) => {
            const p4 = c.proposals!.find((p) => p.id === "P4")!;
            p4.evidence = [{ ref: "railapps.ts:12", cite: "ok" }];
            c.summary!.directions[2].stances = { ux: "challenge", ram: "accept", skeptic: "accept" };
        });
        expect(glancePoints(c)!.takeaway).toBe(
            "All three directions stand on checked evidence; D3 has the thinnest backing (3 of 4 seats)."
        );
    });

    it("words it for every direction standing with equal backing: no thinnest is named", () => {
        const c = fx((c) => {
            const p4 = c.proposals!.find((p) => p.id === "P4")!;
            p4.evidence = [{ ref: "railapps.ts:12", cite: "ok" }];
            c.summary!.directions[2].stances = { ux: "accept", ram: "accept", skeptic: "accept" };
        });
        expect(glancePoints(c)!.takeaway).toBe(
            "All three directions stand on checked evidence and the panel's backing."
        );
    });

    it("words it for no direction standing", () => {
        const c = fx((c) => {
            for (const p of c.proposals!) {
                for (const e of p.evidence ?? []) {
                    e.cite = "wrong";
                }
            }
        });
        expect(glancePoints(c)!.takeaway).toBe(
            "No direction stands on both checked evidence and the panel's backing; D3 is a guess."
        );
    });

    it("counts a weak claim and a claim nothing checked against the evidence held", () => {
        const c = fx((c) => {
            const p1 = c.proposals!.find((p) => p.id === "P1")!;
            p1.evidence = [
                { ref: "a.ts:1", cite: "ok" },
                { ref: "b.ts:2", cite: "ok", weak: true },
                { ref: "c.ts:3" },
                { ref: "d.ts:4", cite: "wrong" },
            ];
        });
        const d2 = glancePoints(c)!.points[1];
        expect([d2.held, d2.evidence]).toEqual([1, 4]);
        expect(d2.x).toBeCloseTo(0.25, 9);
    });

    it("names the guesses plural, and a lone standing direction singular", () => {
        const c = fx((c) => {
            c.summary!.directions = [
                { ...c.summary!.directions[0] },
                { ...c.summary!.directions[2], rank: 2 },
                { ...c.summary!.directions[2], rank: 3, title: "Another guess" },
            ];
        });
        expect(glancePoints(c)!.takeaway).toBe(
            "D1 stands on checked evidence and the panel's backing; D2 and D3 are guesses."
        );
    });

    it("draws nothing for a Brainstorm, a council with no summary, or one with no direction", () => {
        expect(glancePoints(fx((c) => (c.mode = "brainstorm")))).toBeNull();
        expect(glancePoints(fx((c) => (c.summary = undefined)))).toBeNull();
        expect(glancePoints(fx((c) => (c.summary!.directions = [])))).toBeNull();
    });
});

describe("stanceGrid (figure B)", () => {
    it("has the panel's seats in panel order, the coordinator left out", () => {
        const g = stanceGrid(fx())!;
        expect(g.seats.map((s) => s.id)).toEqual(["ux", "ram", "newuser", "skeptic"]);
    });

    it("gives one cell per direction and seat: Proposed for an author, else the stance, else none", () => {
        const g = stanceGrid(fx())!;
        expect(g.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
        const kinds = (rank: number) => g.rows.find((r) => r.rank === rank)!.cells.map((c) => [c.seat, c.kind]);
        expect(kinds(1)).toEqual([
            ["ux", "proposed"], // P9
            ["ram", "accept"],
            ["newuser", "accept"],
            ["skeptic", "proposed"], // P6
        ]);
        expect(kinds(2)).toEqual([
            ["ux", "proposed"],
            ["ram", "accept"],
            ["newuser", "accept"],
            ["skeptic", "none"],
        ]);
        expect(kinds(3)).toEqual([
            ["ux", "challenge"],
            ["ram", "oppose"],
            ["newuser", "proposed"],
            ["skeptic", "challenge"],
        ]);
    });

    it("carries the agreement the glance quadrant uses, and the coordinator's agreed flag", () => {
        const g = stanceGrid(fx())!;
        expect(g.rows.map((r) => [r.backers, r.sides, r.agreed])).toEqual([
            [4, 4, true],
            [3, 3, true],
            [1, 4, false],
        ]);
        expect(g.rows.map((r) => r.title)[1]).toBe("Show asleep and waking on the rail icon");
    });

    it("lists directions in rank order whatever order the summary holds them", () => {
        const c = fx((c) => c.summary!.directions.reverse());
        expect(stanceGrid(c)!.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    });

    it("words the takeaway: where the panel split, and who opposed most", () => {
        expect(stanceGrid(fx())!.takeaway).toBe("The panel split on D3; Đo RAM opposed most (1).");
    });

    it("words it with no oppose: the seat that challenged most, and that no seat opposed", () => {
        const c = fx((c) => {
            const [, d2, d3] = c.summary!.directions;
            d2.stances = { ram: "accept", newuser: "accept", skeptic: "challenge" };
            d3.stances = { ux: "challenge", ram: "accept", skeptic: "challenge" };
            d3.agreed = true;
        });
        expect(stanceGrid(c)!.takeaway).toBe(
            "Every direction kept the panel's backing; Skeptic challenged most (2). No seat opposed a direction."
        );
    });

    it("words it with no stance but accept", () => {
        const c = fx((c) => {
            c.summary!.directions[2].stances = { ux: "accept", ram: "accept", skeptic: "accept" };
            c.summary!.directions[2].agreed = true;
        });
        expect(stanceGrid(c)!.takeaway).toBe("Every direction kept the panel's backing. No seat opposed a direction.");
    });

    it("names a split by agreed alone, and several rows with a list", () => {
        const c = fx((c) => {
            c.summary!.directions[0].agreed = false;
        });
        expect(stanceGrid(c)!.takeaway).toBe("The panel split on D1 and D3; Đo RAM opposed most (1).");
    });

    it("breaks a tie for most opposed in panel order", () => {
        const c = fx((c) => {
            c.summary!.directions[1].stances = { ram: "accept", newuser: "accept", skeptic: "oppose" };
        });
        // ram opposes D3 once and skeptic D2 once: ram comes first on the panel
        expect(stanceGrid(c)!.takeaway).toBe("The panel split on D2 and D3; Đo RAM opposed most (1).");
    });

    it("reads builds only from a reply's builds flag, and only in a Brainstorm", () => {
        const build = (c: Council) => {
            c.replies!.push({
                id: "rb",
                proposalid: "P1",
                author: "skeptic",
                builds: true,
                text: "I would add a waking state too.",
                round: 2,
                ts: T0 + 600_000,
            });
        };
        const brainstorm = stanceGrid(
            fx((c) => {
                c.mode = "brainstorm";
                build(c);
            })
        )!;
        expect(brainstorm.rows[1].cells.find((x) => x.seat === "skeptic")!.kind).toBe("builds");
        // a seat that has a stance on the direction keeps it
        const staying = stanceGrid(
            fx((c) => {
                c.mode = "brainstorm";
                build(c);
                c.summary!.directions[1].stances.skeptic = "challenge";
            })
        )!;
        expect(staying.rows[1].cells.find((x) => x.seat === "skeptic")!.kind).toBe("challenge");
        // a Review has no builds
        const review = stanceGrid(fx(build))!;
        expect(review.rows[1].cells.find((x) => x.seat === "skeptic")!.kind).toBe("none");
        // a reply that builds on another direction's idea gives no cell on this one
        const elsewhere = stanceGrid(
            fx((c) => {
                c.mode = "brainstorm";
                build(c);
                c.replies![c.replies!.length - 1].proposalid = "P6";
            })
        )!;
        expect(elsewhere.rows[1].cells.find((x) => x.seat === "skeptic")!.kind).toBe("none");
    });

    it("returns null exactly when the glance section is not drawn", () => {
        for (const c of [
            fx(),
            fx((c) => (c.summary = undefined)),
            fx((c) => (c.summary!.directions = [])),
            fx((c) => (c.mode = "brainstorm")),
        ]) {
            expect(stanceGrid(c) === null).toBe(!hasGlanceFigures(c));
        }
    });
});

describe("seatSpend (figure C)", () => {
    it("has one row per seat in panel order, the coordinator last, then the memory check", () => {
        const s = seatSpend(fx())!;
        expect(s.rows.map((r) => r.id)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator", null]);
        expect(s.rows.map((r) => r.coordinator)).toEqual([false, false, false, false, true, false]);
        expect(s.rows.slice(0, 5).map((r) => r.name)).toEqual(["UX", "Đo RAM", "New user", "Skeptic", "Coordinator"]);
        expect(s.rows.slice(0, 5).map((r) => r.model)).toEqual(["sonnet", "sonnet", "haiku", "sonnet", "opus"]);
    });

    it("keeps panel order even when the coordinator is not the last expert", () => {
        const c = fx((c) => c.experts.unshift(c.experts.pop()!));
        expect(seatSpend(c)!.rows.map((r) => r.id)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator", null]);
    });

    it("gives tokens a call and the time each seat spent", () => {
        const s = seatSpend(fx())!;
        expect(s.rows.map((r) => [r.tokens, r.calls, r.perCall, r.ms])).toEqual([
            [1_500_000, 3, 500_000, 118_000],
            [3_000_000, 2, 1_500_000, 150_000],
            [1_200_000, 3, 400_000, 96_000],
            [1_500_000, 3, 500_000, 84_000],
            [1_400_000, 2, 700_000, 50_000],
            [400_000, 2, 200_000, 0],
        ]);
    });

    it("adds the memory check row so the rows sum to the header", () => {
        const s = seatSpend(fx())!;
        expect(s.total).toBe(9_000_000);
        expect(s.calls).toBe(15);
        expect(s.ms).toBe(498_000);
        const memory = s.rows.at(-1)!;
        expect(memory.name).toBe("Memory check · outside the seats");
        expect(s.rows.reduce((n, r) => n + r.tokens, 0)).toBe(s.total);
        expect(s.rows.reduce((n, r) => n + r.calls, 0)).toBe(s.calls);
    });

    it("has no memory row when the seats account for the header", () => {
        const c = fx((c) => {
            c.tokens = 8_600_000;
            c.calls = 13;
        });
        const s = seatSpend(c)!;
        expect(s.rows.map((r) => r.id)).toEqual(["ux", "ram", "newuser", "skeptic", "coordinator"]);
        expect(s.rows.reduce((n, r) => n + r.tokens, 0)).toBe(s.total);
    });

    it("takes the seats' sum as the header when the council recorded less", () => {
        const c = fx((c) => {
            c.tokens = 0;
            c.calls = 0;
        });
        const s = seatSpend(c)!;
        expect([s.total, s.calls]).toEqual([8_600_000, 13]);
        expect(s.rows.at(-1)!.id).toBe("coordinator");
    });

    it("words the takeaway: the biggest spender, its share in words, its price a call", () => {
        expect(seatSpend(fx())!.takeaway).toBe(
            "Đo RAM spent a third of the tokens (3.0M of 9.0M), at 1.5M a call: over twice any other seat."
        );
    });

    it("words the share as half, a quarter, or a percentage", () => {
        const share = (ram: number, rest: number[]) =>
            seatSpend(
                fx((c) => {
                    const others = ["ux", "newuser", "skeptic", "coordinator"];
                    c.stats!.ram.tokens = ram;
                    others.forEach((id, i) => (c.stats![id].tokens = rest[i]));
                    c.tokens = ram + rest.reduce((a, b) => a + b, 0);
                    c.calls = Object.values(c.stats!).reduce((n, s) => n + s.calls, 0);
                })
            )!.takeaway;
        expect(share(4_500_000, [1_000_000, 1_000_000, 1_000_000, 1_500_000])).toBe(
            "Đo RAM spent half of the tokens (4.5M of 9.0M), at 2.3M a call: over twice any other seat."
        );
        expect(share(2_250_000, [1_500_000, 1_500_000, 1_500_000, 2_250_000])).toMatch(
            /^Đo RAM spent a quarter of the tokens \(2\.3M of 9\.0M\)/
        );
        expect(share(3_600_000, [1_500_000, 1_200_000, 1_500_000, 1_200_000])).toMatch(
            /^Đo RAM spent 40% of the tokens \(3\.6M of 9\.0M\)/
        );
    });

    it("leaves the price out when no other seat costs less than half a call of the biggest", () => {
        const c = fx((c) => {
            c.stats!.ram.calls = 3;
            c.calls = 16;
        });
        // 1.0M a call against the coordinator's 0.7M
        expect(seatSpend(c)!.takeaway).toBe("Đo RAM spent a third of the tokens (3.0M of 9.0M).");
    });

    it("says the seats spent alike when none holds a quarter", () => {
        const c = fx((c) => {
            for (const s of Object.values(c.stats!)) {
                s.tokens = 1_000_000;
            }
            c.tokens = 5_000_000;
            c.calls = Object.values(c.stats!).reduce((n, s) => n + s.calls, 0);
        });
        expect(seatSpend(c)!.takeaway).toBe("The seats spent alike.");
    });

    it("draws nothing when no seat has tokens", () => {
        expect(seatSpend(fx((c) => (c.stats = undefined)))).toBeNull();
        expect(
            seatSpend(
                fx((c) => {
                    for (const s of Object.values(c.stats!)) {
                        s.tokens = 0;
                    }
                })
            )
        ).toBeNull();
    });
});

describe("the spend section's predicate", () => {
    it("is true exactly when the spend or the lanes draw", () => {
        const noTimes = (c: Council) => {
            for (const steps of Object.values(c.timeline ?? {})) {
                for (const s of steps) {
                    s.ts = 0;
                }
            }
        };
        const noTokens = (c: Council) => {
            for (const s of Object.values(c.stats ?? {})) {
                s.tokens = 0;
            }
        };
        const cases = [
            fx(),
            fx(noTimes), // the spend alone
            fx(noTokens), // the lanes alone
            fx((c) => {
                noTimes(c);
                noTokens(c);
            }), // neither
            fx((c) => {
                c.stats = undefined;
                c.timeline = undefined;
            }),
        ];
        for (const c of cases) {
            expect(hasSpendFigures(c)).toBe(seatSpend(c) !== null || seatLanes(c) !== null);
        }
        expect(hasSpendFigures(cases[1])).toBe(true);
        expect(seatLanes(cases[1])).toBeNull();
        expect(seatSpend(cases[2])).toBeNull();
        expect(hasSpendFigures(cases[3])).toBe(false);
    });
});

describe("seatLanes (figure D)", () => {
    it("has a lane for each seat that took a step, in panel order; the coordinator has none", () => {
        const d = seatLanes(fx())!;
        expect(d.lanes.map((l) => l.seat.id)).toEqual(["ux", "ram", "newuser", "skeptic"]);
    });

    it("cuts each lane into the stretches Go's chart does", () => {
        const d = seatLanes(fx())!;
        for (const lane of d.lanes) {
            expect(lane.spans.map((s) => ({ start: s.start, end: s.end, steps: s.steps }))).toEqual(
                golden.spans[lane.seat.id]
            );
        }
    });

    it("sets the time axis from the first step to the end of the last stretch", () => {
        const d = seatLanes(fx())!;
        const all = Object.values(golden.spans).flat();
        expect(d.t0).toBe(Math.min(...all.map((s) => s.start)));
        expect(d.t1).toBe(Math.max(...all.map((s) => s.end)));
        expect(d.t0).toBe(T0 + 3000);
    });

    it("draws a read as a tick, a search as a dot, a command as a square, a post as a flag", () => {
        const d = seatLanes(fx())!;
        const count = (id: string, shape: string) =>
            d.lanes.find((l) => l.seat.id === id)!.steps.filter((s) => s.shape === shape).length;
        // ux: 3 ideas and 5 replies are posts
        expect(count("ux", "flag")).toBe(8);
        expect(count("ram", "flag")).toBe(9);
        expect(count("newuser", "flag")).toBe(9);
        expect(count("skeptic", "flag")).toBe(8);
        for (const lane of d.lanes) {
            const timeline = raw.timeline![lane.seat.id];
            expect(lane.steps).toHaveLength(timeline.length);
            expect(lane.steps.filter((s) => s.shape === "tick")).toHaveLength(
                timeline.filter((s) => s.kind === "read").length
            );
            expect(lane.steps.filter((s) => s.shape === "dot")).toHaveLength(
                timeline.filter((s) => s.kind === "search").length
            );
            expect(lane.steps.filter((s) => s.shape === "square")).toHaveLength(
                timeline.filter((s) => s.kind === "run").length
            );
        }
    });

    it("marks a read of a file another seat read, comparing slash paths with the case folded", () => {
        const d = seatLanes(fx())!;
        const read = (id: string, target: string) =>
            d.lanes.find((l) => l.seat.id === id)!.steps.filter((s) => s.shape === "tick" && s.target === target);
        // skeptic's upper-case spelling of railapps.ts is the file the others read
        expect(read("skeptic", "FRONTEND/APP/VIEW/AGENTS/RAILAPPS.TS").every((s) => s.shared)).toBe(true);
        expect(read("skeptic", "FRONTEND/APP/VIEW/AGENTS/RAILAPPS.TS").length).toBeGreaterThan(0);
        // ram's backslash spelling of model.go is the file ux and newuser read
        expect(read("ram", "pkg\\services\\model.go").every((s) => s.shared)).toBe(true);
        expect(read("ram", "pkg\\services\\model.go").length).toBeGreaterThan(0);
        // a file only one seat read is not shared
        expect(read("ux", "frontend/app/element/motiontokens.ts").length).toBeGreaterThan(0);
        expect(read("ux", "frontend/app/element/motiontokens.ts").some((s) => s.shared)).toBe(false);
        // and only a read can be
        expect(d.lanes.flatMap((l) => l.steps).filter((s) => s.shared && s.shape !== "tick")).toEqual([]);
    });

    it("notes the seat whose timeline holds the cap", () => {
        const d = seatLanes(fx())!;
        expect(d.lanes.map((l) => [l.seat.id, l.capped])).toEqual([
            ["ux", false],
            ["ram", false],
            ["newuser", false],
            ["skeptic", true],
        ]);
    });

    it("marks the round each post opens: the first idea, then the first reply of each later round", () => {
        const d = seatLanes(fx())!;
        expect(d.rounds).toEqual([
            { round: 1, ts: raw.proposals![0].ts },
            { round: 2, ts: raw.replies!.find((r) => r.id === "r1")!.ts },
            { round: 3, ts: raw.replies!.find((r) => r.id === "r23")!.ts },
        ]);
    });

    it("leaves the person's reply out of the round marks", () => {
        const c = fx((c) => {
            c.replies!.push({
                id: "ry",
                proposalid: "P1",
                author: "you",
                text: "Early.",
                round: 2,
                ts: raw.proposals![0].ts + 1,
            });
        });
        expect(seatLanes(c)!.rounds[1].ts).toBe(raw.replies!.find((r) => r.id === "r1")!.ts);
    });

    it("lists the files read by more than one seat: most seats first, then most reads, capped at 8", () => {
        const d = seatLanes(fx())!;
        expect(d.shared).toHaveLength(8);
        expect(d.shared.map((r) => [r.path, r.seats, r.reads])).toEqual([
            ["frontend/app/view/agents/railapps.ts", ["ux", "ram", "newuser", "skeptic"], 29],
            ["frontend/app/view/agents/railappsstore.ts", ["ux", "ram", "skeptic"], 24],
            ["pkg/services/model.go", ["ux", "ram", "newuser"], 14],
            ["frontend/app/view/agents/servicesmodel.ts", ["ram", "skeptic"], 19],
            ["frontend/tailwindsetup.css", ["ux", "skeptic"], 19],
            ["pkg/services/idle.go", ["ram", "skeptic"], 19],
            ["pkg/services/manager.go", ["ram", "skeptic"], 19],
            ["DESIGN.md", ["ux", "newuser"], 9],
        ]);
    });

    it("folds the rest into one more row: the next file and how many are left", () => {
        const d = seatLanes(fx())!;
        expect(d.moreCount).toBe(3);
        expect(d.more).toEqual({
            path: "frontend/app/view/agents/navrail.tsx",
            seats: ["ux", "newuser"],
            reads: 9,
        });
    });

    it("has no more row when eight or fewer files are shared", () => {
        const c = fx((c) => {
            const keep = ["railapps.ts", "railappsstore.ts"];
            for (const [seat, steps] of Object.entries(c.timeline!)) {
                for (const s of steps) {
                    if (s.kind === "read" && !keep.some((k) => s.target.toLowerCase().endsWith(k))) {
                        s.target = `${seat}/${s.target}`;
                    }
                }
            }
        });
        const d = seatLanes(c)!;
        expect(d.shared.map((r) => r.reads)).toEqual([29, 24]);
        expect(d.more).toBeNull();
        expect(d.moreCount).toBe(0);
    });

    it("words the takeaway: the shared reads, the file read by most seats, and the first stretch it kept", () => {
        // the fixture's skeptic holds the cap, so its oldest steps are gone and its first stretch is the first one kept
        expect(seatLanes(fx())!.takeaway).toBe(
            "11 files were read by two or more seats (178 reads); railapps.ts by four. " +
                "117 of 356 steps came in each seat's first kept stretch, before it posted."
        );
    });

    it("says first stretch, not first kept stretch, when no seat holds the cap", () => {
        const c = fx((c) => {
            c.timeline!.skeptic = c.timeline!.skeptic.slice(1);
        });
        const d = seatLanes(c)!;
        expect(d.lanes.some((l) => l.capped)).toBe(false);
        // the skeptic's first step, a read of railapps.ts, is gone: one read and one step fewer
        expect(d.takeaway).toBe(
            "11 files were read by two or more seats (177 reads); railapps.ts by four. " +
                "116 of 355 steps came in each seat's first stretch, before it posted."
        );
    });

    it("words it with no shared read", () => {
        const c = fx((c) => {
            for (const [seat, steps] of Object.entries(c.timeline!)) {
                for (const s of steps) {
                    if (s.kind === "read") {
                        s.target = `${seat}/${s.target}`;
                    }
                }
            }
        });
        const d = seatLanes(c)!;
        expect(d.shared).toEqual([]);
        expect(d.takeaway).toBe(
            "No seat read a file another one read. 117 of 356 steps came in each seat's first kept stretch, before it posted."
        );
    });

    it("names the most-shared file only when three seats or more read it", () => {
        const c = fx((c) => {
            for (const [seat, steps] of Object.entries(c.timeline!)) {
                for (const s of steps) {
                    if (s.kind === "read" && !s.target.toLowerCase().includes("design.md")) {
                        s.target = `${seat}/${s.target}`;
                    }
                }
            }
        });
        expect(seatLanes(c)!.takeaway.startsWith("1 file was read by two or more seats (9 reads). 117 of")).toBe(true);
    });

    it("names the three most-read targets of a stretch", () => {
        const c: Council = {
            ...fx(),
            experts: [raw.experts[0], raw.experts[4]],
            timeline: {
                ux: [
                    { ts: T0, kind: "read", target: "a.ts" },
                    { ts: T0 + 1000, kind: "read", target: "b.ts" },
                    { ts: T0 + 2000, kind: "read", target: "a.ts" },
                    { ts: T0 + 3000, kind: "search", target: "x" },
                    { ts: T0 + 4000, kind: "read", target: "c.ts" },
                    { ts: T0 + 5000, kind: "read", target: "d.ts" },
                    { ts: T0 + 6000, kind: "read", target: "b.ts" },
                    // a pause of more than 60 s starts a second stretch
                    { ts: T0 + 200_000, kind: "read", target: "z.ts" },
                ],
            },
        };
        const spans = seatLanes(c)!.lanes[0].spans;
        expect(spans).toHaveLength(2);
        expect(spans[0].steps).toBe(7);
        expect(spans[0].top).toEqual(["a.ts", "b.ts", "c.ts"]);
        expect(spans[1].top).toEqual(["z.ts"]);
        // a stretch of one step is drawn 5 s wide
        expect(spans[1].end - spans[1].start).toBe(5000);
    });

    it("ignores a step with no time", () => {
        const c = fx((c) => {
            c.timeline!.ux.unshift({ ts: 0, kind: "read", target: "old.ts" });
        });
        const lane = seatLanes(c)!.lanes[0];
        expect(lane.steps).toHaveLength(raw.timeline!.ux.length);
        expect(lane.spans.map((s) => s.steps)).toEqual(golden.spans.ux.map((s) => s.steps));
    });

    it("draws nothing when no step has a time", () => {
        expect(seatLanes(fx((c) => (c.timeline = undefined)))).toBeNull();
        expect(
            seatLanes(
                fx((c) => {
                    for (const steps of Object.values(c.timeline!)) {
                        for (const s of steps) {
                            s.ts = 0;
                        }
                    }
                })
            )
        ).toBeNull();
    });
});

describe("argumentGraph (figure E)", () => {
    it("has the seats in panel order with how many replies each sent, and You when the person replied", () => {
        const g = argumentGraph(fx())!;
        expect(g.seats.map((s) => [s.id, s.name, s.replies, s.you])).toEqual([
            ["ux", "UX", 5, false],
            ["ram", "Đo RAM", 7, false],
            ["newuser", "New user", 6, false],
            ["skeptic", "Skeptic", 5, false],
            ["you", "You", 1, true],
        ]);
    });

    it("has no You row when the person replied to no idea", () => {
        const c = fx((c) => (c.replies = c.replies!.filter((r) => r.author !== "you")));
        expect(argumentGraph(c)!.seats.map((s) => s.id)).toEqual(["ux", "ram", "newuser", "skeptic"]);
    });

    it("groups the ideas by outcome: a group for each direction, Also raised, Withdrawn, Cut", () => {
        const g = argumentGraph(fx())!;
        expect(g.groups.map((x) => [x.key, x.heading, x.ideas.map((i) => i.id)])).toEqual([
            ["direction:1", "D1 · Move the rail pins from localStorage to settings", ["P6", "P9"]],
            ["direction:2", "D2 · Show asleep and waking on the rail icon", ["P1"]],
            ["direction:3", "D3 · Name the pinned app in its tooltip", ["P4"]],
            ["also-raised", "Also raised", ["P2", "P3", "P5", "P8"]],
            ["withdrawn", "Withdrawn", ["P7"]],
        ]);
    });

    it("puts a cut idea last, under Cut, and dims it with the withdrawn one", () => {
        const c = fx((c) => {
            c.proposals!.find((p) => p.id === "P8")!.cut = true;
        });
        const g = argumentGraph(c)!;
        expect(g.groups.map((x) => x.key)).toEqual([
            "direction:1",
            "direction:2",
            "direction:3",
            "also-raised",
            "withdrawn",
            "cut",
        ]);
        expect(g.groups.at(-1)!.ideas.map((i) => [i.id, i.dim])).toEqual([["P8", true]]);
        expect(g.groups.find((x) => x.key === "also-raised")!.ideas.map((i) => i.id)).toEqual(["P2", "P3", "P5"]);
        expect(
            g.groups
                .flatMap((x) => x.ideas)
                .filter((i) => i.dim)
                .map((i) => i.id)
        ).toEqual(["P7", "P8"]);
    });

    it("leads a merged idea's title with 'merged ·' and cuts a long title with an ellipsis", () => {
        const g = argumentGraph(fx())!;
        const [p6, p9] = g.groups[0].ideas;
        expect(p6.merged).toBe(false);
        expect(p6.title).toBe("Move the rail pins from localStorage to settings");
        expect(p9.merged).toBe(true);
        expect(p9.title.startsWith("merged · Keep the pins when the WebView2")).toBe(true);
        expect(p9.title.endsWith("…")).toBe(true);
        expect(p9.title.length).toBeLessThanOrEqual(48);
    });

    it("gives each idea its check label key, which the view words in the council's language", () => {
        const labels = Object.fromEntries(
            argumentGraph(fx())!.groups.flatMap((x) => x.ideas.map((i) => [i.id, i.label]))
        );
        expect(labels).toEqual({
            P6: "ran",
            P9: "read",
            P1: "read",
            P4: "guess",
            P2: "read",
            P3: "disproved",
            P5: "read",
            P8: "read",
            P7: "read",
        });
        // an idea no label was given (a Brainstorm's) has none
        const bare = argumentGraph(
            fx((c) => {
                for (const p of c.proposals!) {
                    delete p.label;
                }
            })
        )!;
        expect(bare.groups.flatMap((x) => x.ideas).map((i) => i.label)).toEqual(Array(9).fill(""));
    });

    it("sets each idea's row top from the 28px rows, a heading row above each group", () => {
        const g = argumentGraph(fx())!;
        expect(g.groups.flatMap((x) => x.ideas.map((i) => i.y))).toEqual([28, 56, 112, 168, 224, 252, 280, 308, 364]);
    });

    it("draws the author's edge as proposed", () => {
        const g = argumentGraph(fx())!;
        for (const p of raw.proposals!) {
            expect(g.edges.filter((e) => e.idea === p.id && e.stance === "proposed" && e.seat === p.author)).toEqual([
                { seat: p.author, idea: p.id, stance: "proposed", count: 1 },
            ]);
        }
    });

    it("draws a reply's edge with its stance, several replies as one edge with a count", () => {
        const g = argumentGraph(fx())!;
        const edge = (seat: string, idea: string) => g.edges.filter((e) => e.seat === seat && e.idea === idea);
        expect(edge("ram", "P3")).toEqual([{ seat: "ram", idea: "P3", stance: "oppose", count: 1 }]);
        expect(edge("ram", "P1")).toEqual([{ seat: "ram", idea: "P1", stance: "accept", count: 1 }]);
        // skeptic challenged P3 twice, the second a reply to a reply
        expect(edge("skeptic", "P3")).toEqual([{ seat: "skeptic", idea: "P3", stance: "challenge", count: 2 }]);
    });

    it("counts a reply to a reply toward its proposal", () => {
        const g = argumentGraph(fx())!;
        // r24, newuser's reply to ram's r9 on P3, adds to newuser's r11: one edge to P3 with a count of 2
        expect(g.edges.filter((e) => e.seat === "newuser" && e.idea === "P3")).toEqual([
            { seat: "newuser", idea: "P3", stance: "accept", count: 2 },
        ]);
        // r25, the person's reply to ram's r13 on P4, is the person's edge to P4
        expect(g.edges.filter((e) => e.seat === "you").map((e) => e.idea)).toEqual(["P4"]);
    });

    it("takes a seat's latest stance on an idea", () => {
        const c = fx((c) => {
            c.replies!.push({
                id: "rl",
                proposalid: "P3",
                author: "ram",
                stance: "accept",
                text: "Measured it.",
                round: 3,
                ts: T0 + 710_000,
            });
        });
        const g = argumentGraph(c)!;
        expect(g.edges.filter((e) => e.seat === "ram" && e.idea === "P3")).toEqual([
            { seat: "ram", idea: "P3", stance: "accept", count: 2 },
        ]);
    });

    it("draws no edge for an author's own replies, and none for a reply with no stance", () => {
        const g = argumentGraph(fx())!;
        // r20 is skeptic withdrawing P7, r26 newuser revising P4
        expect(g.edges.filter((e) => e.seat === "skeptic" && e.idea === "P7")).toEqual([
            { seat: "skeptic", idea: "P7", stance: "proposed", count: 1 },
        ]);
        expect(g.edges.filter((e) => e.seat === "newuser" && e.idea === "P4")).toEqual([
            { seat: "newuser", idea: "P4", stance: "proposed", count: 1 },
        ]);
    });

    it("draws the person's reply as a neutral edge from You, counted on the idea its parent is on", () => {
        const g = argumentGraph(fx())!;
        expect(g.edges.filter((e) => e.seat === "you")).toEqual([
            { seat: "you", idea: "P4", stance: "proposed", count: 1 },
        ]);
    });

    it("lists the edges seat by seat, in the order the ideas are drawn", () => {
        const g = argumentGraph(fx())!;
        // 9 authors' edges, 21 stances (a seat's latest on an idea it did not write) and the person's one
        expect(g.edges).toHaveLength(31);
        const seatOrder = g.seats.map((s) => s.id);
        const seatIndex = g.edges.map((e) => seatOrder.indexOf(e.seat));
        expect(seatIndex).toEqual([...seatIndex].sort((a, b) => a - b));
        const ideaOrder = g.groups.flatMap((x) => x.ideas.map((i) => i.id));
        expect(g.edges.filter((e) => e.seat === "ram").map((e) => e.idea)).toEqual(
            [...ideaOrder].filter((id) => g.edges.some((e) => e.seat === "ram" && e.idea === id))
        );
    });

    it("words the takeaway: the tally when one stance is most, the most contested idea, the untouched", () => {
        expect(argumentGraph(fx())!.takeaway).toBe(
            "13 of 21 stances were accepts. Most contested: P4 (1 oppose, 2 challenges); untouched: P8."
        );
    });

    it("words it when every idea drew a reply and the stances were mostly challenges", () => {
        const c = fx((c) => {
            for (const r of c.replies!) {
                if (r.stance === "accept" && r.author !== "ux") {
                    r.stance = "challenge";
                }
            }
            c.replies!.push({
                id: "r8x",
                proposalid: "P8",
                author: "skeptic",
                stance: "challenge",
                text: "Why now?",
                round: 2,
                ts: T0 + 540_000,
            });
        });
        // ux's three accepts are what is left of the 13: 16 of the 22 stances are challenges, and 3 are opposes
        expect(argumentGraph(c)!.takeaway).toBe(
            "Every idea drew a reply, but 16 of 22 stances were challenges. Most contested: P3 (1 oppose, 2 challenges)."
        );
    });

    it("keeps the 'and' for a majority of accepts, and adds that no seat opposed only after challenges", () => {
        const reply = (c: Council) =>
            c.replies!.push({
                id: "r8x",
                proposalid: "P8",
                author: "skeptic",
                stance: "challenge",
                text: "Why now?",
                round: 2,
                ts: T0 + 540_000,
            });
        const accepted = fx((c) => {
            for (const r of c.replies!) {
                if (r.stance === "oppose") {
                    r.stance = "challenge";
                }
            }
            reply(c);
        });
        expect(
            argumentGraph(accepted)!.takeaway.startsWith(
                "Every idea drew a reply, and 13 of 22 stances were accepts. Most contested: "
            )
        ).toBe(true);
        expect(argumentGraph(accepted)!.takeaway).not.toContain("no seat opposed");
        const challenged = fx((c) => {
            for (const r of c.replies!) {
                if (r.stance === "oppose" || r.stance === "accept") {
                    r.stance = "challenge";
                }
            }
            reply(c);
        });
        expect(argumentGraph(challenged)!.takeaway).toBe(
            "Every idea drew a reply, but all 22 stances were challenges and no seat opposed. Most contested: P2 (3 challenges)."
        );
    });

    it("names the first three untouched ideas and counts the rest", () => {
        const c = fx((c) => {
            c.replies = c.replies!.filter((r) => !["P1", "P2", "P5", "P6", "P9"].includes(r.proposalid));
        });
        expect(argumentGraph(c)!.takeaway).toMatch(/; untouched: P1, P2, P5 and 3 more\.$/);
    });

    it("counts only sent ideas and replies", () => {
        const c = fx((c) => {
            c.proposals!.find((p) => p.id === "P8")!.draft = "held";
            c.replies!.find((r) => r.id === "r8")!.draft = "held";
        });
        const g = argumentGraph(c)!;
        expect(g.groups.flatMap((x) => x.ideas.map((i) => i.id))).not.toContain("P8");
        expect(g.edges.some((e) => e.idea === "P8")).toBe(false);
        expect(g.edges.some((e) => e.seat === "skeptic" && e.idea === "P2")).toBe(false);
        expect(g.takeaway).not.toContain("P8");
    });

    it("works for a Brainstorm", () => {
        const g = argumentGraph(fx((c) => (c.mode = "brainstorm")))!;
        expect(g.groups).toHaveLength(5);
    });

    it("draws nothing when there is no sent idea", () => {
        expect(argumentGraph(fx((c) => (c.proposals = [])))).toBeNull();
        expect(argumentGraph(fx((c) => c.proposals!.forEach((p) => (p.draft = "held"))))).toBeNull();
    });
});

describe("benchPoints (figure F)", () => {
    const NEW = "2026-11-12.1";
    const OLD = "2026-11-05.1";
    const row = (r: Partial<CouncilBenchRow>): CouncilBenchRow => ({
        harness: NEW,
        mode: "review",
        variant: "council",
        runs: 4,
        scored: 4,
        recall: 0,
        keys: 40,
        wrong: 0,
        tokens: 4_000_000,
        recallperm: 0,
        recall3: 0,
        judged: 0,
        ...r,
    });
    const rows: CouncilBenchRow[] = [
        // newest harness, Review: the council's runs were not all judged whole, so its score is recall@5
        row({
            variant: "council",
            runs: 6,
            scored: 6,
            recall: 15,
            recall5: 12,
            keys: 57,
            tokens: 9_000_000,
            allscored: 4,
        }),
        row({ variant: "team", runs: 3, scored: 3, recall: 9, recall5: 7, keys: 30, tokens: 30_000_000, allscored: 3 }),
        // older harness, Review
        row({
            harness: OLD,
            variant: "solo",
            runs: 5,
            scored: 5,
            recall: 20,
            recall5: 18,
            keys: 50,
            tokens: 1_500_000,
            allscored: 5,
        }),
        row({
            harness: OLD,
            variant: "council",
            runs: 4,
            scored: 4,
            recall: 8,
            recall5: 8,
            keys: 40,
            tokens: 24_000_000,
            allscored: 4,
        }),
        // newest harness, Brainstorm
        row({
            mode: "brainstorm",
            variant: "brainstorm",
            skill: "x",
            runs: 4,
            scored: 4,
            recall: 15,
            keys: 48,
            tokens: 22_800_000,
        }),
        row({ mode: "brainstorm", variant: "council", runs: 4, scored: 4, recall: 10, keys: 48, tokens: 6_000_000 }),
    ];

    it("plots a Review row at its recall@all when every scored run was judged whole", () => {
        const review = benchPoints(rows).review!;
        const team = review.points.find((p) => p.variant === "team" && p.harness === NEW)!;
        expect(team.y).toBeCloseTo(9 / 30, 9);
        expect(team.hollow).toBe(false);
    });

    it("plots it at recall@5, hollow, when some scored run was not", () => {
        const review = benchPoints(rows).review!;
        const council = review.points.find((p) => p.variant === "council" && p.harness === NEW)!;
        expect(council.y).toBeCloseTo(12 / 57, 9);
        expect(council.hollow).toBe(true);
    });

    it("plots a Brainstorm row at its recall@all", () => {
        const brainstorm = benchPoints(rows).brainstorm!;
        const skill = brainstorm.points.find((p) => p.variant === "brainstorm")!;
        expect(skill.y).toBeCloseTo(15 / 48, 9);
        expect(skill.hollow).toBe(false);
    });

    it("places a row across at the log of its tokens a run", () => {
        const review = benchPoints(rows).review!;
        const council = review.points.find((p) => p.variant === "council" && p.harness === NEW)!;
        expect(council.x).toBeCloseTo(Math.log10(1_500_000), 9);
        const team = review.points.find((p) => p.variant === "team")!;
        expect(team.x).toBeCloseTo(Math.log10(10_000_000), 9);
    });

    it("keeps each point's row, a direct label and whether it is on the newest harness", () => {
        const review = benchPoints(rows).review!;
        expect(review.points.map((p) => [p.harness, p.variant, p.label, p.newest, p.mode])).toEqual([
            [NEW, "council", "council · 11-12", true, "review"],
            [NEW, "team", "team · 11-12", true, "review"],
            [OLD, "solo", "solo · 11-05", false, "review"],
            [OLD, "council", "council · 11-05", false, "review"],
        ]);
        expect(review.points[0].row).toBe(rows[0]);
    });

    it("draws the frontier through the newest harness's points that no cheaper one beats", () => {
        const review = benchPoints(rows).review!;
        // council: 1.5M at 21%; team: 10M at 30%; both are on the frontier. The older harness is never on it
        expect(review.frontier.map((p) => p.variant)).toEqual(["council", "team"]);
        expect(review.frontier.every((p) => p.newest)).toBe(true);
        const dominated = benchPoints([
            ...rows,
            row({
                variant: "solo",
                runs: 4,
                scored: 4,
                recall: 3,
                recall5: 3,
                keys: 40,
                tokens: 80_000_000,
                allscored: 4,
            }),
        ]).review!;
        // a dearer point that finds less than the team is not on it
        expect(dominated.frontier.map((p) => p.variant)).toEqual(["council", "team"]);
    });

    it("words each panel's takeaway: the newest harness compared, a variant not rerun, a score cut at 5", () => {
        const b = benchPoints(rows);
        expect(b.review!.takeaway).toBe(
            "Newest harness: the team finds 30% at 10M a run, the council 21% at 1.5M. " +
                "Solo last ran on 11-05: 40% at 0.3M; the council's 11-12 score counts its first 5 items only."
        );
        expect(b.brainstorm!.takeaway).toBe(
            "Newest harness: the brainstorm skill finds 31% at 5.7M a run, the council 21% at 1.5M."
        );
    });

    it("names a variant that was not rerun even when it found little, if nothing cheaper beats it", () => {
        const b = benchPoints(rows.map((r) => (r.variant === "solo" ? { ...r, recall: 4, recall5: 4 } : r)));
        // 8% at 0.3M: no point of the newest harness costs as little
        expect(b.review!.takeaway).toContain("Solo last ran on 11-05: 8% at 0.3M");
    });

    it("leaves out a variant that was not rerun when the newest harness beats it", () => {
        // 10% at 2M a run: the newest council finds 21% at 1.5M
        const b = benchPoints(
            rows.map((r) => (r.variant === "solo" ? { ...r, recall: 5, recall5: 5, tokens: 10_000_000 } : r))
        );
        expect(b.review!.takeaway).toBe(
            "Newest harness: the team finds 30% at 10M a run, the council 21% at 1.5M; " +
                "the council's 11-12 score counts its first 5 items only."
        );
    });

    it("does not name a variant that has a row on the newest harness", () => {
        const b = benchPoints([
            ...rows,
            row({
                harness: OLD,
                variant: "team",
                runs: 3,
                scored: 3,
                recall: 3,
                recall5: 3,
                keys: 30,
                tokens: 3_000_000,
                allscored: 3,
            }),
        ]);
        expect(b.review!.takeaway).not.toContain("team last ran");
    });

    it("counts the runs and the modes", () => {
        const b = benchPoints(rows);
        expect(b.runs).toBe(6 + 3 + 5 + 4 + 4 + 4);
        expect(b.modes).toBe(2);
    });

    it("words the section's takeaway: the variant with the best recall per million tokens, and its harness", () => {
        expect(benchPoints(rows).takeaway).toBe(
            "Solo found the most key lines per token when it last ran (11-05); run it on the newest harness."
        );
        const onNewest = benchPoints(rows.filter((r) => r.harness === NEW));
        expect(onNewest.takeaway).toBe("The council finds the most key lines per token.");
    });

    it("leaves a mode with no scored row out", () => {
        const b = benchPoints(rows.filter((r) => r.mode === "review"));
        expect(b.brainstorm).toBeNull();
        expect(b.review).not.toBeNull();
        const unscored = benchPoints([row({ scored: 0, runs: 3 })]);
        expect(unscored.review).toBeNull();
        expect(unscored.brainstorm).toBeNull();
        expect(unscored.runs).toBe(3);
        expect(unscored.takeaway).toBe("");
    });

    it("draws nothing for no rows", () => {
        expect(benchPoints([])).toEqual({ review: null, brainstorm: null, runs: 0, modes: 0, takeaway: "" });
    });

    it("compares harness versions by date and then by the counter as a number", () => {
        const b = benchPoints([
            row({ harness: "2026-11-12.9", variant: "solo", recall: 4, recall5: 4, allscored: 4 }),
            row({ harness: "2026-11-12.10", variant: "council", recall: 4, recall5: 4, allscored: 4 }),
        ]);
        expect(b.review!.points.map((p) => [p.variant, p.newest])).toEqual([
            ["solo", false],
            ["council", true],
        ]);
    });

    it("labels a row from before harness versions as unknown", () => {
        const b = benchPoints([row({ harness: "", recall: 4, recall5: 4, allscored: 4 })]);
        expect(b.review!.points[0].label).toBe("council · unknown");
    });
});

describe("the sections that never draw", () => {
    it("draw nothing for a council with no record of the run", () => {
        const bare: Council = {
            id: "x",
            project: "",
            feature: "",
            experts: raw.experts,
            state: "done",
            round: 3,
            tokens: 0,
            calls: 0,
            created: 1,
            updated: 2,
        };
        expect(glancePoints(bare)).toBeNull();
        expect(stanceGrid(bare)).toBeNull();
        expect(seatSpend(bare)).toBeNull();
        expect(seatLanes(bare)).toBeNull();
        expect(argumentGraph(bare)).toBeNull();
    });
});
