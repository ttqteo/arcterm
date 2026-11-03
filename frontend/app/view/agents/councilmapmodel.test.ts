import { describe, expect, it } from "vitest";
import { expertCards, mapWords, timelineRows } from "./councilmapmodel";

const experts: CouncilExpert[] = [
    { id: "ux", name: "Ease of use", brief: "", model: "sonnet" },
    { id: "sk", name: "Bug hunter", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Summarizer", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}`,
    ts: 1,
    ...extra,
});

const reply = (id: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid: "P1",
    author,
    text: `text ${id}`,
    round: 2,
    ts: 10,
    ...extra,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Services stop after a minute",
    experts,
    state: "running",
    round: 2,
    proposals: [],
    replies: [],
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

describe("expertCards", () => {
    it("makes one card per panel seat, the coordinator left out, with the seat's name, initials and tone", () => {
        const cards = expertCards(council());
        expect(cards.map((c) => [c.id, c.name, c.initials, c.tone, c.agent])).toEqual([
            ["ux", "Ease of use", "EO", "conn-1", false],
            ["sk", "Bug hunter", "BH", "conn-2", false],
        ]);
    });

    it("marks a live agent's seat", () => {
        const seat: CouncilExpert = { id: "agent-t1", name: "Witness", brief: "", model: "", agent: "t1" };
        const cards = expertCards(council({ experts: [...experts, seat] }));
        expect(cards.map((c) => c.agent)).toEqual([false, false, true]);
    });

    it("reads tokens, time and calls off the seat's stats, in words", () => {
        const [ux, sk] = expertCards(
            council({
                stats: {
                    ux: { ms: 125_000, tokens: 96_000, calls: 3 },
                    sk: { ms: 288_000, tokens: 214_000, calls: 1 },
                },
            })
        );
        expect([ux.tokens, ux.time, ux.calls]).toEqual(["96k tokens", "2 min 5 s", "3 calls"]);
        // from 100k up the cost line's own figure: hundredths of a million
        expect([sk.tokens, sk.time, sk.calls]).toEqual(["0.21M tokens", "4 min 48 s", "1 call"]);
        expect([ux.tokenCount, ux.ms, ux.callCount]).toEqual([96_000, 125_000, 3]);
    });

    it("reads a seat with no stats yet as nothing spent", () => {
        const [ux] = expertCards(council());
        expect([ux.tokens, ux.time, ux.calls]).toEqual(["0 tokens", "0 s", "0 calls"]);
    });

    describe("evidence counts", () => {
        const checked = council({
            proposals: [
                prop("P1", "ux", { label: "ran" }),
                prop("P2", "ux", { label: "read" }),
                prop("P3", "ux", {
                    label: "guess",
                    evidence: [{ ref: "a.go:9", cite: "wrong", citenote: "past the end" }],
                }),
                prop("P4", "sk", { label: "disproved" }),
                prop("P5", "ux", { label: "guess", draft: "held" }),
            ],
            replies: [
                reply("r1", "ux", {
                    label: "read",
                    evidence: [
                        { ref: "x.go:1", cite: "wrong" },
                        { ref: "y.go:2", cite: "ok" },
                    ],
                }),
                reply("r2", "ux"),
                reply("r3", "sk", { label: "ran" }),
                reply("r4", "you", { label: "ran" }),
            ],
        });

        it("counts each seat's sent labelled ideas and replies in four parts, held drafts and plain replies left out", () => {
            const [ux, sk] = expertCards(checked);
            expect(ux.counts).toEqual({ ran: 1, disproved: 0, read: 2, guess: 1 });
            expect(ux.claims).toBe(4);
            expect(sk.counts).toEqual({ ran: 1, disproved: 1, read: 0, guess: 0 });
            expect(sk.claims).toBe(2);
        });

        it("words the four counts, the claims and the wrong cites", () => {
            const [ux, sk] = expertCards(checked);
            expect(ux.evidence.map((e) => [e.label, e.n, e.text])).toEqual([
                ["ran", 1, "1 ran"],
                ["disproved", 0, "0 disproved"],
                ["read", 2, "2 read"],
                ["guess", 1, "1 guess"],
            ]);
            expect([ux.claimsText, ux.wrongCites, ux.wrongCitesText]).toEqual(["4 claims", 2, "2 wrong cites"]);
            expect([sk.claimsText, sk.wrongCites, sk.wrongCitesText]).toEqual(["2 claims", 0, ""]);
            expect(expertCards(council({ proposals: [prop("P1", "ux", { label: "ran" })] }))[0].claimsText).toBe(
                "1 claim"
            );
        });

        it("words the guesses in the plural", () => {
            const many = council({
                proposals: [prop("P1", "ux", { label: "guess" }), prop("P2", "ux", { label: "guess" })],
            });
            expect(expertCards(many)[0].evidence[3].text).toBe("2 guesses");
        });

        it("words them in Vietnamese for a Vietnamese council", () => {
            const [ux] = expertCards({
                ...checked,
                lang: "vi",
                stats: { ux: { ms: 125_000, tokens: 96_000, calls: 3 } },
            });
            expect(ux.evidence.map((e) => e.text)).toEqual(["1 đã chạy", "0 bị bác", "2 đã đọc", "1 đoán"]);
            expect([ux.claimsText, ux.wrongCitesText]).toEqual(["4 nhận định", "2 trích sai"]);
            expect([ux.tokens, ux.time, ux.calls]).toEqual(["96k token", "2 phút 5 giây", "3 lượt gọi"]);
        });

        it("has no counts in a Brainstorm, which asks for no evidence, and keeps tokens, time and calls", () => {
            const [ux] = expertCards({
                ...checked,
                mode: "brainstorm",
                stats: { ux: { ms: 60_000, tokens: 5_000, calls: 2 } },
            });
            expect(ux.counts).toBeNull();
            expect(ux.evidence).toEqual([]);
            expect([ux.claims, ux.claimsText, ux.wrongCites, ux.wrongCitesText]).toEqual([0, "", 0, ""]);
            expect([ux.tokens, ux.time, ux.calls]).toEqual(["5k tokens", "1 min", "2 calls"]);
        });
    });

    describe("what a seat is doing now", () => {
        const step = (kind: string, target: string, result?: string): CouncilStep => ({ ts: 1, kind, target, result });

        it("shows the seat's activity with the working dot while it works", () => {
            const [ux, sk] = expertCards(council({ activity: { ux: { text: "Reading pkg/x.go" } } }));
            expect([ux.doing, ux.working, ux.command]).toEqual(["Reading pkg/x.go", true, false]);
            expect(sk.working).toBe(false);
        });

        it("marks a running command when the seat's last step is a run with no result yet", () => {
            const running = council({
                activity: { ux: { text: "go test ./pkg/x -run TestY" } },
                timeline: { ux: [step("read", "pkg/x.go"), step("run", "go test ./pkg/x -run TestY")] },
            });
            const [ux] = expertCards(running);
            expect([ux.doing, ux.working, ux.command]).toEqual(["go test ./pkg/x -run TestY", true, true]);
        });

        it("names the command from the step when the activity has not caught up", () => {
            const [ux] = expertCards(council({ timeline: { ux: [step("run", "npx vitest run a.test.ts")] } }));
            expect([ux.doing, ux.working, ux.command]).toEqual(["npx vitest run a.test.ts", true, true]);
        });

        it("is no running command once the run has its result, or the last step is something else", () => {
            const done = council({
                activity: { ux: { text: "Reading pkg/x.go" } },
                timeline: { ux: [step("run", "go test ./pkg/x", "fail"), step("read", "pkg/x.go")] },
            });
            expect(expertCards(done)[0].command).toBe(false);
            const finished = council({
                activity: { ux: { text: "Reading" } },
                timeline: { ux: [step("run", "go test ./pkg/x", "pass")] },
            });
            expect(expertCards(finished)[0].command).toBe(false);
        });

        it("is no running command in a council that is not running, whatever its last step", () => {
            const stopped = council({ state: "stopped", timeline: { ux: [step("run", "go test ./pkg/x")] } });
            const [ux] = expertCards(stopped);
            expect([ux.command, ux.working]).toEqual([false, false]);
        });

        it("says where an idle seat stands", () => {
            const idle = (extra: Partial<Council>) => expertCards(council(extra)).map((c) => c.doing);
            const stats = { ux: { ms: 1, tokens: 1, calls: 1 } };
            expect(idle({ stats })).toEqual(["Done round 2", "Waiting"]);
            expect(idle({ stats, state: "awaiting-you", round: 1 })).toEqual(["Done round 1", "Waiting"]);
            expect(idle({ stats, state: "done", round: 4 })).toEqual(["Done", "Done"]);
            expect(idle({ stats, state: "running", round: 3 })).toEqual(["Done", "Waiting"]);
            expect(idle({ stats, state: "stopped" })).toEqual(["Stopped", "Stopped"]);
            expect(idle({ state: "not-run", round: 0 })).toEqual(["Not started", "Not started"]);
            expect(idle({ stats, failed: { ux: { round: 2, error: "boom" } } })).toEqual(["Failed", "Waiting"]);
        });

        it("says it in Vietnamese for a Vietnamese council", () => {
            const stats = { ux: { ms: 1, tokens: 1, calls: 1 } };
            expect(expertCards(council({ lang: "vi", stats })).map((c) => c.doing)).toEqual([
                "Xong vòng 2",
                "Đang chờ",
            ]);
            expect(expertCards(council({ lang: "vi", state: "done", round: 4 })).map((c) => c.doing)).toEqual([
                "Xong",
                "Xong",
            ]);
            expect(expertCards(council({ lang: "vi", state: "stopped" })).map((c) => c.doing)).toEqual([
                "Đã dừng",
                "Đã dừng",
            ]);
            expect(expertCards(council({ lang: "vi", state: "not-run" })).map((c) => c.doing)).toEqual([
                "Chưa bắt đầu",
                "Chưa bắt đầu",
            ]);
            expect(
                expertCards(council({ lang: "vi", stats, failed: { ux: { round: 1, error: "x" } } })).map(
                    (c) => c.doing
                )[0]
            ).toBe("Bị lỗi");
        });
    });
});

describe("timelineRows", () => {
    // local times, so the test reads the same in every time zone
    const at = (h: number, m: number, s: number) => new Date(2026, 10, 3, h, m, s).getTime();
    const timeline = {
        ux: [
            { ts: at(14, 32, 5), kind: "read", target: "pkg/x.go" },
            { ts: at(14, 32, 9), kind: "search", target: "TODO", result: "3 matches" },
            { ts: at(14, 33, 0), kind: "run", target: "go test ./pkg/x -run TestY", result: "fail" },
            { ts: at(14, 33, 40), kind: "run", target: "npx vitest run a.test.ts", result: "pass" },
            { ts: at(14, 33, 50), kind: "run", target: "cargo test x", result: "not run: not on the list" },
            { ts: at(14, 34, 0), kind: "propose", target: "Stop only when idle" },
            { ts: at(14, 35, 0), kind: "reply", target: "Agree with P2" },
            { ts: at(14, 35, 1), kind: "WebFetch", target: "https://x.test" },
        ],
    };

    it("turns the steps into rows: time, kind word, target and result, oldest first as kept", () => {
        const rows = timelineRows(council({ timeline }), "ux");
        expect(rows.map((r) => [r.time, r.kind, r.kindWord, r.target, r.result])).toEqual([
            ["14:32:05", "read", "Read", "pkg/x.go", ""],
            ["14:32:09", "search", "Search", "TODO", "3 matches"],
            ["14:33:00", "run", "Ran command", "go test ./pkg/x -run TestY", "Failed"],
            ["14:33:40", "run", "Ran command", "npx vitest run a.test.ts", "Passed"],
            ["14:33:50", "run", "Ran command", "cargo test x", "not run: not on the list"],
            ["14:34:00", "propose", "Proposed", "Stop only when idle", ""],
            ["14:35:00", "reply", "Replied", "Agree with P2", ""],
            ["14:35:01", "WebFetch", "WebFetch", "https://x.test", ""],
        ]);
        expect(rows.map((r) => r.ts)).toEqual(timeline.ux.map((s) => s.ts));
    });

    it("sets a command in mono, and only a command", () => {
        const rows = timelineRows(council({ timeline }), "ux");
        expect(rows.map((r) => r.mono)).toEqual([false, false, true, true, true, false, false, false]);
    });

    it("says whether a command passed or failed beside its result word", () => {
        const rows = timelineRows(council({ timeline }), "ux");
        expect(rows.map((r) => r.outcome)).toEqual(["", "", "fail", "pass", "", "", "", ""]);
    });

    it("marks the command Go runs now: the newest step is a run with no result, in a council that runs", () => {
        const steps = [
            ...timeline.ux.slice(0, 3),
            { ts: at(14, 36, 0), kind: "run", target: "go test ./pkg/y -run TestZ" },
        ];
        const running = timelineRows(council({ state: "running", timeline: { ux: steps } }), "ux");
        expect(running.map((r) => r.running)).toEqual([false, false, false, true]);
        // the same rows in a council that ended, was stopped or waits on the person: a command left without a result, not running
        for (const state of ["done", "stopped", "failed", "awaiting-you"]) {
            expect(timelineRows(council({ state, timeline: { ux: steps } }), "ux").some((r) => r.running)).toBe(false);
        }
        // a run that has its result, or an older run without one that a later step followed, is not running
        expect(timelineRows(council({ state: "running", timeline }), "ux").some((r) => r.running)).toBe(false);
        const later = [
            { ts: at(14, 36, 0), kind: "run", target: "cargo test x" },
            { ts: at(14, 36, 5), kind: "reply", target: "r" },
        ];
        expect(
            timelineRows(council({ state: "running", timeline: { ux: later } }), "ux").map((r) => r.running)
        ).toEqual([false, false]);
    });

    it("words the kinds and results in Vietnamese for a Vietnamese council", () => {
        const rows = timelineRows(council({ lang: "vi", timeline }), "ux");
        expect(rows.map((r) => r.kindWord)).toEqual([
            "Đọc",
            "Tìm",
            "Chạy lệnh",
            "Chạy lệnh",
            "Chạy lệnh",
            "Đưa ra ý",
            "Trả lời",
            "WebFetch",
        ]);
        expect(rows.slice(2, 4).map((r) => r.result)).toEqual(["Thất bại", "Đạt"]);
    });

    it("has no rows for a seat with no timeline, or a council with none", () => {
        expect(timelineRows(council({ timeline }), "sk")).toEqual([]);
        expect(timelineRows(council(), "ux")).toEqual([]);
    });
});

describe("mapWords", () => {
    it("gives English words for an English council and for one that names no language", () => {
        expect(mapWords(council()).tab).toBe("Map");
        expect(mapWords(council({ lang: "en" })).tab).toBe("Map");
        expect(mapWords(council({ lang: "fr" })).tab).toBe("Map");
    });

    it("gives Vietnamese words for a Vietnamese council", () => {
        const w = mapWords(council({ lang: "vi" }));
        expect(w.tab).toBe("Bản đồ");
        expect(w.noIdeas).toBe("Chưa có ý nào");
        expect(w.openTimeline("Người soi lỗi")).toBe("Mở dòng thời gian của Người soi lỗi");
    });

    it("has a legend line for each of the four labels, and the wrong cite", () => {
        const en = mapWords(council());
        expect(en.legend.map((l) => [l.label, l.word])).toEqual([
            ["ran", "Ran"],
            ["disproved", "Disproved"],
            ["read", "Read code"],
            ["guess", "Guess"],
        ]);
        expect(en.wrongCite.word).toBe("Wrong cite");
        const vi = mapWords(council({ lang: "vi" }));
        expect(vi.legend.map((l) => l.word)).toEqual(["Đã chạy", "Bị bác", "Đã đọc code", "Chỉ đoán"]);
        expect(vi.wrongCite.word).toBe("Trích sai");
        for (const l of [...en.legend, ...vi.legend]) {
            expect(l.meaning).not.toBe("");
        }
    });

    it("has the words the Report's link and the timeline need", () => {
        const en = mapWords(council());
        expect(en.reportLink).toBe("See who agrees with which idea in Map");
        expect([en.timeline, en.back, en.noSteps]).toEqual(["Timeline", "Back to the list", "No steps yet"]);
        expect(en.timelineOf("Bug hunter")).toBe("Timeline of Bug hunter");
        expect(en.noIdeas).toBe("No ideas yet");
    });
});
