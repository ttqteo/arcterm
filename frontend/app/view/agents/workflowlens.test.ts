import { describe, expect, it } from "vitest";
import {
    copyText,
    newestScanRun,
    scanButton,
    scanHead,
    scanHomeChannel,
    workflowView,
    type WorkflowView,
} from "./workflowlens";

const DAY_MS = 24 * 60 * 60 * 1000;
const OCT_26 = new Date(2026, 9, 26, 12).getTime();

function quote(n: number): WorkflowScanQuote {
    return { runid: `run${n}-0000-0000`, project: "waveterm", date: "2026-10-2" + (n % 10), text: `quote number ${n}` };
}

function pattern(id: string, runs: number, quotes = 3): WorkflowScanPattern {
    return {
        id,
        title: `pattern ${id}`,
        fixtarget: "AGENTS.md · Plans",
        runs,
        days: 2,
        projects: [{ name: "waveterm", runs }],
        quotes: Array.from({ length: quotes }, (_, i) => quote(i + 1)),
    };
}

function suggest(id: string, extra: Partial<WorkflowScanVerdict> = {}): WorkflowScanVerdict {
    return {
        id,
        verdict: "suggest",
        file: "AGENTS.md",
        where: "Plans the engine runs",
        fixproject: "waveterm",
        edit: "+ add this line",
        ...extra,
    };
}

function scan(extra: Partial<WorkflowScan> = {}): WorkflowScan {
    return {
        state: "picking",
        stage: "checking",
        project: "waveterm",
        windowdays: 14,
        fromts: OCT_26 - 14 * DAY_MS,
        tots: OCT_26,
        runs: 47,
        projects: 4,
        candidates: 7,
        kept: 3,
        dropped: 0,
        survivors: [pattern("p1", 11), pattern("p2", 4), pattern("p3", 4)],
        underfloor: [pattern("u1", 2)],
        verdicts: [suggest("p1"), { id: "p2", verdict: "covered", note: "8bc284e7" }, suggest("p3")],
        ...extra,
    };
}

function run(ws: WorkflowScan | undefined, status = "executing", extra: Partial<Run> = {}): Run {
    return {
        otype: "run",
        oid: "scan-run",
        version: 1,
        meta: {},
        id: "scan-run",
        goal: "Workflow scan",
        workspaceid: "ws",
        projectpath: "C:/repo",
        status,
        phases: [],
        createdts: OCT_26,
        channeloid: "chan-1",
        workflowscan: ws,
        ...extra,
    };
}

function home(name = "waveterm"): Channel {
    return { otype: "channel", oid: "chan-1", version: 1, meta: {}, name, createdts: 0 };
}

function picking(v: WorkflowView): Extract<WorkflowView, { kind: "picking" }> {
    if (v.kind !== "picking") {
        throw new Error(`expected picking, got ${v.kind}`);
    }
    return v;
}

describe("workflowView: the state mapping", () => {
    it("is idle with no last line when there is no scan run", () => {
        expect(workflowView(null)).toEqual({ kind: "idle" });
        expect(workflowView(run(undefined))).toEqual({ kind: "idle" });
    });

    it("maps each record state of a live run", () => {
        expect(workflowView(run(scan({ state: "scanning", stage: "read" }))).kind).toBe("scanning");
        expect(workflowView(run(scan({ state: "picking" }))).kind).toBe("picking");
    });

    it("reads a state it does not know as idle, never as a scan in progress", () => {
        expect(workflowView(run(scan({ state: "applying" })))).toEqual({ kind: "idle" });
    });

    it("shows a failed scan as idle with its last line and error", () => {
        const v = workflowView(run(scan({ state: "failed", error: "no json block" }), "done"));
        expect(v).toEqual({ kind: "idle", last: { date: "10-26", outcome: "failed", error: "no json block" } });
    });

    it("shows a cancelled run as idle whatever its record state", () => {
        for (const state of ["scanning", "picking"]) {
            const v = workflowView(run(scan({ state }), "cancelled"));
            expect(v).toEqual({ kind: "idle", last: { date: "10-26", outcome: "cancelled" } });
        }
    });

    it("shows a run that died mid-scan as failed, not scanning", () => {
        const v = workflowView(run(scan({ state: "scanning", stage: "patterns" }), "failed"));
        expect(v).toEqual({ kind: "idle", last: { date: "10-26", outcome: "failed" } });
    });

    it("dates the last line from the run's completion when it has one", () => {
        const v = workflowView(run(scan(), "cancelled", { completedts: OCT_26 + DAY_MS }));
        expect(v).toEqual({ kind: "idle", last: { date: "10-27", outcome: "cancelled" } });
    });

    it("is done with one row per suggested fix and the run's commit", () => {
        const v = workflowView(run(scan(), "done", { endcommit: "abc123def456" }));
        expect(v).toEqual({
            kind: "done",
            commit: "abc123def456",
            rows: [
                { tag: "suggested", title: "pattern p1", file: "AGENTS.md" },
                { tag: "suggested", title: "pattern p3", file: "AGENTS.md" },
            ],
            stages: [
                { label: "Read runs", phase: "done", fact: "47 runs · 4 projects" },
                { label: "Sonnet patterns", phase: "done", fact: "7 named" },
                { label: "Recount", phase: "done", fact: "3 kept · 1 under 3 runs" },
                { label: "Opus checks files", phase: "done", fact: "2 suggested · 1 covered" },
            ],
        });
    });

    it("leaves the commit out of a done scan whose run made none", () => {
        const v = workflowView(run(scan(), "done"));
        expect(v.kind === "done" && v.commit).toBeUndefined();
    });

    it("is nothing-to-suggest when a done run has no suggest verdict", () => {
        const ws = scan({
            verdicts: [
                { id: "p1", verdict: "covered", note: "f93850e9" },
                { id: "p2", verdict: "declined", declinedat: 4 },
                { id: "p3", verdict: "covered", note: "AGENTS.md" },
            ],
        });
        const v = workflowView(run(ws, "done"));
        expect(v).toEqual({
            kind: "nothing",
            covered: [
                { tag: "covered", title: "pattern p1", fact: "11 runs · f93850e9" },
                { tag: "covered", title: "pattern p3", fact: "4 runs · AGENTS.md" },
            ],
            declined: [{ tag: "declined", title: "pattern p2", fact: "4 runs · not past 4" }],
            underFloor: [{ tag: "under", title: "pattern u1", fact: "2 runs · 2 days" }],
            stages: [
                { label: "Read runs", phase: "done", fact: "47 runs · 4 projects" },
                { label: "Sonnet patterns", phase: "done", fact: "7 named" },
                { label: "Recount", phase: "done", fact: "3 kept · 1 under 3 runs" },
                { label: "Opus checks files", phase: "done", fact: "2 covered · 1 declined" },
            ],
        });
    });

    it("gives picking the covered, declined and under-floor rows beside the cards", () => {
        const v = picking(workflowView(run(scan())));
        expect(v.cards.map((c) => c.id)).toEqual(["p1", "p3"]);
        expect(v.covered).toEqual([{ tag: "covered", title: "pattern p2", fact: "4 runs · 8bc284e7" }]);
        expect(v.declined).toEqual([]);
        expect(v.underFloor).toHaveLength(1);
    });
});

describe("workflowView: stage phases", () => {
    const phases = (stage: string) => {
        const v = workflowView(run(scan({ state: "scanning", stage })));
        return v.kind === "scanning" ? v.stages : [];
    };

    it("has the four rows of the scan", () => {
        expect(phases("read").map((s) => s.label)).toEqual([
            "Read runs",
            "Sonnet patterns",
            "Recount",
            "Opus checks files",
        ]);
    });

    it("marks every row before the stage done, the stage now, and the rest todo", () => {
        expect(phases("read").map((s) => s.phase)).toEqual(["now", "todo", "todo", "todo"]);
        expect(phases("patterns").map((s) => s.phase)).toEqual(["done", "now", "todo", "todo"]);
        expect(phases("recount").map((s) => s.phase)).toEqual(["done", "done", "now", "todo"]);
        expect(phases("checking").map((s) => s.phase)).toEqual(["done", "done", "done", "now"]);
    });

    it("shows a row's count once it is done", () => {
        expect(phases("checking").map((s) => s.fact)).toEqual([
            "47 runs · 4 projects",
            "7 named",
            "3 kept · 1 under 3 runs",
            "",
        ]);
        expect(phases("patterns")[1].fact).toBe("");
    });

    it("reads a stage the record has not set as the first", () => {
        expect(phases("").map((s) => s.phase)).toEqual(["now", "todo", "todo", "todo"]);
    });

    it("names the blocks cut for size on the read row", () => {
        const v = workflowView(run(scan({ state: "scanning", stage: "patterns", dropped: 5 })));
        expect(v.kind === "scanning" && v.stages[0].fact).toBe("47 runs · 4 projects · 5 cut for size");
    });
});

describe("workflowView: stage facts", () => {
    const facts = (extra: Partial<WorkflowScan>) => {
        const v = workflowView(run(scan({ state: "scanning", stage: "checking", ...extra })));
        return v.kind === "scanning" ? v.stages.map((s) => s.fact) : [];
    };

    it("names the patterns and the kept count once their rows are done", () => {
        expect(facts({ underfloor: [] })).toEqual(["47 runs · 4 projects", "7 named", "3 kept", ""]);
    });

    it("adds the patterns under the floor to the recount fact", () => {
        expect(facts({ underfloor: [pattern("u1", 2), pattern("u2", 1)] })[2]).toBe("3 kept · 2 under 3 runs");
    });

    it("counts the verdicts on the Opus row of a finished scan, leaving stray ids out", () => {
        const ws = scan({
            survivors: ["p1", "p2", "p3", "p4", "p5"].map((id) => pattern(id, 4)),
            verdicts: [
                suggest("p1"),
                suggest("p2"),
                suggest("p3"),
                { id: "p4", verdict: "covered" },
                { id: "p5", verdict: "covered" },
                { id: "gone", verdict: "declined", declinedat: 3 },
                suggest("gone2"),
            ],
        });
        const v = workflowView(run(ws, "done"));
        expect(v.kind === "done" && v.stages[3].fact).toBe("3 suggested · 2 covered");
    });
});

describe("workflowView: done and nothing stages", () => {
    it("has every row done when the scan finished with fixes", () => {
        const v = workflowView(run(scan(), "done"));
        expect(v.kind === "done" && v.stages.map((s) => s.phase)).toEqual(["done", "done", "done", "done"]);
    });

    it("has every row done when nothing was suggested", () => {
        const ws = scan({ verdicts: [{ id: "p1", verdict: "covered" }] });
        const v = workflowView(run(ws, "done"));
        expect(v.kind === "nothing" && v.stages.map((s) => s.phase)).toEqual(["done", "done", "done", "done"]);
        expect(v.kind === "nothing" && v.stages[3].fact).toBe("1 covered");
    });
});

describe("workflowView: scanning detail", () => {
    const scanning = (extra: Partial<WorkflowScan>) => {
        const v = workflowView(run(scan({ state: "scanning", ...extra })));
        if (v.kind !== "scanning") {
            throw new Error(`expected scanning, got ${v.kind}`);
        }
        return v;
    };

    it("gives each stage its own detail", () => {
        expect(scanning({ stage: "read", runs: 0, projects: 0 }).detail).toEqual({
            stage: "read",
            from: "10-12",
            to: "10-26",
        });
        expect(scanning({ stage: "patterns" }).detail).toEqual({ stage: "patterns", runs: 47, projects: 4 });
        expect(scanning({ stage: "recount" }).detail).toEqual({ stage: "recount", candidates: 7 });
    });

    it("lists the kept patterns while Opus checks them", () => {
        const three = { ...pattern("p2", 5), projects: ["a", "b", "c"].map((name) => ({ name, runs: 1 })) };
        const none = { ...pattern("p3", 3), projects: [] };
        const v = scanning({ stage: "checking", survivors: [pattern("p1", 9), three, none] });
        expect(v.detail).toEqual({
            stage: "checking",
            kept: [
                { id: "p1", title: "pattern p1", runs: 9, days: 2, where: "#waveterm" },
                { id: "p2", title: "pattern p2", runs: 5, days: 2, where: "3 projects" },
                { id: "p3", title: "pattern p3", runs: 3, days: 2, where: "" },
            ],
            underFloor: 1,
        });
    });

    it("starts the clock at the run's creation", () => {
        expect(scanning({ stage: "read" }).startedTs).toBe(OCT_26);
    });
});

describe("workflowView: cards", () => {
    it("shows the first 2 quotes and keeps the rest behind more", () => {
        const v = picking(workflowView(run(scan({ survivors: [pattern("p1", 5, 5), pattern("p3", 3, 2)] }))));
        expect(v.cards[0].quotes.map((q) => q.text)).toEqual(["quote number 1", "quote number 2"]);
        expect(v.cards[0].more.map((q) => q.text)).toEqual(["quote number 3", "quote number 4", "quote number 5"]);
        expect(v.cards[1].quotes).toHaveLength(2);
        expect(v.cards[1].more).toEqual([]);
    });

    it("sets elsewhere only when the fix project is not the scan's", () => {
        const ws = scan({ verdicts: [suggest("p1"), suggest("p3", { fixproject: "cyber_assistant" })] });
        const v = picking(workflowView(run(ws)));
        expect(v.cards[0].elsewhere).toBeUndefined();
        expect(v.cards[1].elsewhere).toBe("cyber_assistant");
    });

    it("leaves elsewhere unset when the verdict names no fix project", () => {
        const ws = scan({ verdicts: [suggest("p1", { fixproject: undefined }), suggest("p3")] });
        expect(picking(workflowView(run(ws))).cards[0].elsewhere).toBeUndefined();
    });

    it("compares projects as the server does, ignoring case and outer spaces", () => {
        const ws = scan({ verdicts: [suggest("p1", { fixproject: " WaveTerm " }), suggest("p3")] });
        expect(picking(workflowView(run(ws))).cards[0].elsewhere).toBeUndefined();
    });

    it("tags a declined pattern raised again with its old and new counts", () => {
        const ws = scan({ verdicts: [suggest("p1", { declinedat: 4 }), suggest("p3")] });
        const v = picking(workflowView(run(ws)));
        expect(v.cards[0].raisedAgain).toEqual({ declinedAt: 4, now: 11 });
        expect(v.cards[1].raisedAgain).toBeUndefined();
    });

    it("splits the drafted edit into signed lines", () => {
        const ws = scan({ verdicts: [suggest("p1", { edit: "- old line\n+ new line\n+second\n" }), suggest("p3")] });
        const v = picking(workflowView(run(ws)));
        expect(v.cards[0].edit).toEqual([
            { sign: "-", text: "old line" },
            { sign: "+", text: "new line" },
            { sign: "+", text: "second" },
        ]);
    });
});

describe("scanHead", () => {
    it("names the scan's day, window, runs and projects", () => {
        expect(scanHead(run(scan()))).toEqual({ title: "Scan of 10-26", span: "10-12 → 10-26 · 47 runs · 4 projects" });
    });

    it("leaves the counts out while the scan reads the runs", () => {
        expect(scanHead(run(scan({ state: "scanning", stage: "read", runs: 0, projects: 0 })))?.span).toBe(
            "10-12 → 10-26"
        );
        expect(scanHead(run(scan({ state: "scanning", stage: "patterns" })))?.span).toBe(
            "10-12 → 10-26 · 47 runs · 4 projects"
        );
    });

    it("is null for a run that is not a scan", () => {
        expect(scanHead(run(undefined))).toBeNull();
    });
});

describe("copyText", () => {
    it("holds the file, where, and the edit lines", () => {
        const ws = scan({ verdicts: [suggest("p1", { edit: "- old\n+ new line" }), suggest("p3")] });
        const card = picking(workflowView(run(ws))).cards[0];
        expect(copyText(card)).toBe("AGENTS.md · Plans the engine runs\n- old\n+ new line");
    });

    it("leaves where out when the verdict has none", () => {
        const ws = scan({ verdicts: [suggest("p1", { where: "" }), suggest("p3")] });
        expect(copyText(picking(workflowView(run(ws))).cards[0])).toBe("AGENTS.md\n+ add this line");
    });
});

describe("newestScanRun", () => {
    const plain = run(undefined, "done", { id: "plain", createdts: OCT_26 + 5 * DAY_MS });
    const older = run(scan(), "done", { id: "older", createdts: OCT_26 });
    const newer = run(scan(), "executing", { id: "newer", createdts: OCT_26 + DAY_MS });

    it("is the scan run created last, whatever order the runs came in", () => {
        expect(newestScanRun([older, newer, plain].map((r) => ({ run: r })))?.id).toBe("newer");
        expect(newestScanRun([newer, plain, older].map((r) => ({ run: r })))?.id).toBe("newer");
    });

    it("passes over runs that are not scans, however new", () => {
        expect(newestScanRun([{ run: plain }, { run: older }])?.id).toBe("older");
    });

    it("is null when no run is a scan", () => {
        expect(newestScanRun([{ run: plain }])).toBeNull();
        expect(newestScanRun([])).toBeNull();
    });
});

describe("scanHomeChannel", () => {
    const channel = (oid: string, name: string): Channel => ({ ...home(name), oid });
    const alpha = channel("c-alpha", "alpha");
    const beta = channel("c-beta", "beta");
    const gamma = channel("c-gamma", "gamma");
    const channels = [alpha, beta, gamma];
    const rows = [
        { name: "alpha", path: "C:/alpha", channel: alpha },
        { name: "beta", path: "C:/beta", channel: beta },
        { name: "gamma", path: "C:/gamma", channel: gamma },
        { name: "fresh", path: "C:/fresh" },
    ];

    it("is the picked project's channel over everything else", () => {
        expect(scanHomeChannel("beta", "c-gamma", channels, alpha, rows, ["gamma"])).toBe(beta);
    });

    it("is the newest scan's channel when nothing is picked", () => {
        expect(scanHomeChannel(null, "c-gamma", channels, alpha, rows, ["beta"])).toBe(gamma);
    });

    it("falls back to the palette's rule with no pick and no scan", () => {
        expect(scanHomeChannel(null, undefined, channels, alpha, rows, ["beta"])).toBe(alpha);
        expect(scanHomeChannel(null, undefined, channels, null, rows, ["beta"])).toBe(beta);
        expect(scanHomeChannel(null, undefined, channels, null, [rows[0]], [])).toBe(alpha);
        expect(scanHomeChannel(null, undefined, channels, null, rows, [])).toBeNull();
    });

    it("skips a scan channel that is no longer in the list", () => {
        expect(scanHomeChannel(null, "c-gone", channels, alpha, rows, [])).toBe(alpha);
        expect(scanHomeChannel(null, "c-gone", null, null, rows, ["beta"])).toBe(beta);
    });

    it("skips a pick that has no channel or is no longer registered", () => {
        expect(scanHomeChannel("fresh", "c-gamma", channels, alpha, rows, [])).toBe(gamma);
        expect(scanHomeChannel("removed", undefined, channels, alpha, rows, [])).toBe(alpha);
    });
});

describe("scanButton", () => {
    const view = (r: Run | null) => workflowView(r);

    it("is enabled on idle, done, nothing and failed", () => {
        const done = run(scan(), "done");
        const nothing = run(scan({ verdicts: [] }), "done");
        const failed = run(scan({ state: "failed", error: "x" }));
        for (const r of [null, done, nothing, failed]) {
            expect(scanButton(view(r), home())).toMatchObject({ enabled: true, channelId: "chan-1" });
        }
        expect(view(done).kind).toBe("done");
        expect(view(nothing).kind).toBe("nothing");
    });

    it("is enabled when a cancelled run was left scanning", () => {
        expect(scanButton(view(run(scan({ state: "scanning" }), "cancelled")), home()).enabled).toBe(true);
    });

    it("is disabled on scanning and picking, saying why", () => {
        for (const state of ["scanning", "picking"]) {
            const b = scanButton(view(run(scan({ state }))), home());
            expect(b.enabled).toBe(false);
            expect(b.channelId).toBeUndefined();
            expect(b.title).not.toBe("");
        }
    });

    it("is disabled with no home project", () => {
        const b = scanButton(view(null), null);
        expect(b.enabled).toBe(false);
        expect(b.title).toMatch(/project/);
    });
});
