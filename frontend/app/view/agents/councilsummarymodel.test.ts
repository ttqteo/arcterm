import { describe, expect, it } from "vitest";
import {
    answerLine,
    answerParts,
    askedLine,
    brainstormPrompt,
    canRunSummary,
    defaultCouncilView,
    directionRows,
    directionsHeading,
    directionTag,
    docAction,
    docPathLabel,
    droppedLine,
    evidenceLabel,
    initiativeSeed,
    keptRows,
    outcomeLabel,
    outdatedLabel,
    positionsOf,
    projectNameOf,
    savedLine,
    writtenLine,
} from "./councilsummarymodel";

const experts: CouncilExpert[] = [
    { id: "ux", name: "UX", brief: "", model: "sonnet" },
    { id: "ram", name: "RAM", brief: "", model: "sonnet" },
    { id: "nu", name: "New user", brief: "", model: "sonnet" },
    { id: "sk", name: "Skeptic", brief: "", model: "sonnet" },
    { id: "coordinator", name: "Coordinator", brief: "", model: "opus", coordinator: true },
];

const prop = (id: string, author: string, extra: Partial<CouncilProposal> = {}): CouncilProposal => ({
    id,
    author,
    title: `title ${id}`,
    argument: `argument ${id}.`,
    ts: 1,
    ...extra,
});

const reply = (id: string, proposalid: string, author: string, extra: Partial<CouncilReply> = {}): CouncilReply => ({
    id,
    proposalid,
    author,
    text: `text ${id}`,
    round: 2,
    ts: 10,
    ...extra,
});

const direction = (rank: number, from: string[], extra: Partial<CouncilDirection> = {}): CouncilDirection => ({
    rank,
    title: `direction ${rank}`,
    reasoning: `reasoning ${rank}`,
    from,
    stances: {},
    agreed: true,
    ...extra,
});

const council = (extra: Partial<Council> = {}): Council => ({
    id: "c1",
    project: "D:\\code\\arc",
    feature: "Rail apps",
    experts,
    state: "done",
    round: 3,
    proposals: [
        prop("P1", "ux"),
        prop("P2", "ux", {
            evidence: [
                { ref: "pkg/services/model.go:38" },
                { ref: "", weak: true, note: '"about 3 s" has no measurement' },
            ],
        }),
        prop("P3", "ram", { evidence: [{ ref: "pkg/services/model.go:36" }] }),
        prop("P5", "sk", { evidence: [{ ref: "railappsstore.ts:12" }] }),
    ],
    replies: [
        reply("r1", "P2", "ram", {
            stance: "oppose",
            text: "holds a whole dev server",
            ts: 5,
            evidence: [{ ref: "pkg/services/model.go:36" }],
        }),
        reply("r2", "P2", "sk", { stance: "challenge", text: "the 3 s figure is a guess", ts: 6 }),
        reply("r3", "P2", "nu", { stance: "accept", text: "a blank frame reads as broken", ts: 7 }),
        reply("r4", "P2", "nu", { stance: "accept", text: "still true on a second look", ts: 9 }),
        reply("r5", "P2", "you", { text: "does this change on a Mac?", ts: 20, to: ["ux", "ram"] }),
    ],
    summary: {
        text: "",
        directions: [
            direction(2, ["P5"], { stances: { ux: "accept", ram: "accept", nu: "accept" }, ideaid: "i7" }),
            direction(1, ["P2", "P3"], { agreed: false, stances: { nu: "accept", sk: "challenge", ram: "oppose" } }),
        ],
        outcomes: {},
        at: 15,
    },
    tokens: 0,
    calls: 0,
    created: 0,
    updated: 0,
    ...extra,
});

describe("positionsOf", () => {
    it("shows an author's own argument as proposed, and a stance with the expert's last reply of it", () => {
        const c = council();
        const d = c.summary!.directions.find((x) => x.rank === 1)!;
        expect(positionsOf(c, d).map((p) => [p.expert.id, p.stance, p.text])).toEqual([
            ["ux", "proposed", "argument P2."],
            ["ram", "oppose", "holds a whole dev server"],
            ["nu", "accept", "still true on a second look"],
            ["sk", "challenge", "the 3 s figure is a guess"],
        ]);
    });

    it("lets a stance win over authoring, and orders the proposers first", () => {
        const c = council();
        const d = direction(1, ["P2", "P3"], { stances: { ram: "oppose", sk: "challenge" } });
        // ram proposed P3 but took a stance on the merged direction; ux proposed P2 and took none
        expect(positionsOf(c, d).map((p) => p.expert.id)).toEqual(["ux", "ram", "sk"]);
    });

    it("carries the evidence of the proposal or the reply", () => {
        const c = council();
        const d = c.summary!.directions.find((x) => x.rank === 1)!;
        const byId = Object.fromEntries(positionsOf(c, d).map((p) => [p.expert.id, p.evidence]));
        expect(byId.ux).toEqual(c.proposals![1].evidence);
        expect(byId.ram).toEqual([{ ref: "pkg/services/model.go:36" }]);
        expect(byId.sk).toEqual([]);
    });

    it("falls back to the expert's last reply of any stance, then to no text", () => {
        const c = council();
        const d = direction(1, ["P2"], { stances: { sk: "oppose", ram: "accept", nu: "accept" } });
        const byId = Object.fromEntries(positionsOf(c, d).map((p) => [p.expert.id, p]));
        expect(byId.sk.text).toBe("the 3 s figure is a guess");
        expect(byId.ram.text).toBe("holds a whole dev server");
        const bare = direction(1, ["P5"], { stances: { ux: "accept" } });
        expect(positionsOf(c, bare).find((p) => p.expert.id === "ux")!.text).toBe("");
    });

    it("ignores a stance word it does not know, and the person's replies", () => {
        const c = council();
        const d = direction(1, ["P2"], { stances: { ram: "maybe" as string, nu: "accept" } });
        expect(positionsOf(c, d).map((p) => p.expert.id)).toEqual(["ux", "nu"]);
        expect(positionsOf(c, d).some((p) => p.text.includes("Mac"))).toBe(false);
    });
});

describe("directionRows", () => {
    it("lists the directions by rank with a plain tag", () => {
        const rows = directionRows(council());
        expect(rows.map((r) => [r.direction.rank, r.tag])).toEqual([
            [1, "RAM is against it"],
            [2, "Everyone agrees"],
        ]);
    });

    it("draws one chip per expert that proposed or took a stance, in panel order", () => {
        const rows = directionRows(council());
        expect(rows[0].chips.map((x) => [x.expert.id, x.stance])).toEqual([
            ["ux", "proposed"],
            ["ram", "oppose"],
            ["nu", "accept"],
            ["sk", "challenge"],
        ]);
        expect(rows[1].chips.map((x) => [x.expert.id, x.stance])).toEqual([
            ["ux", "accept"],
            ["ram", "accept"],
            ["nu", "accept"],
            ["sk", "proposed"],
        ]);
    });

    it("says where a direction came from, how many files and weak claims it cites, and that it is in Ideas", () => {
        const rows = directionRows(council());
        expect(rows[0].meta).toBe("from UX and RAM · 1 file · 1 weak claim");
        expect(rows[1].meta).toBe("from Skeptic · 1 file · in Ideas");
    });

    it("names no proposal id and no Merged in a line of facts", () => {
        const c = council({
            summary: {
                text: "",
                directions: [direction(1, ["P2", "P3"], { ideaid: "i1" })],
                outcomes: {},
                at: 15,
            },
        });
        const [row] = directionRows(c);
        expect(row.meta).toBe("from UX and RAM · 1 file · 1 weak claim · in Ideas");
        expect(row.meta).not.toMatch(/\bP\d+\b|Merged/);
    });

    it("names one author once when two of its proposals meet in a direction", () => {
        const c = council({
            summary: { text: "", directions: [direction(1, ["P1", "P2"])], outcomes: {}, at: 15 },
        });
        expect(directionRows(c)[0].meta.startsWith("from UX · ")).toBe(true);
    });

    it("leaves out what it cannot say", () => {
        const c = council({
            summary: { text: "", directions: [direction(1, ["P404"])], outcomes: {}, at: 15 },
        });
        const [row] = directionRows(c);
        expect(row.meta).toBe("");
        expect(row.chips).toEqual([]);
        expect(row.firstProposal).toBe("");
    });

    it("opens the first of its proposals that is on the council", () => {
        const rows = directionRows(council());
        expect(rows[0].firstProposal).toBe("P2");
        expect(rows[1].firstProposal).toBe("P5");
        const c = council({ summary: { text: "", directions: [direction(1, ["P404", "P3"])], outcomes: {}, at: 15 } });
        expect(directionRows(c)[0].firstProposal).toBe("P3");
    });

    it("is empty before a summary", () => {
        expect(directionRows(council({ summary: undefined }))).toEqual([]);
    });
});

describe("a Brainstorm report", () => {
    // P2 (UX) and P3 (RAM) meet in direction 1, built on by New user and Skeptic; P5 (Skeptic) is direction 2 with no
    // builder; P1 (UX) is a wild idea kept aside; P4 (New user) is in neither
    const brainstorm = (extra: Partial<Council> = {}): Council => {
        const base = council();
        return council({
            mode: "brainstorm",
            proposals: [...base.proposals!, prop("P7", "nu", { wild: true })],
            replies: [
                reply("b1", "P2", "nu", { builds: true, text: "and a hint on the empty slot", ts: 11 }),
                reply("b2", "P3", "sk", { builds: true, text: "measure it first", ts: 12 }),
                reply("b3", "P5", "ux", { text: "no build", ts: 13 }),
                reply("b4", "P2", "you", { builds: true, text: "me too", ts: 14 }),
            ],
            summary: {
                text: "",
                directions: [
                    direction(1, ["P2", "P3"], { firststep: "Try it on one screen" }),
                    direction(2, ["P5"], { firststep: "  " }),
                ],
                kept: [direction(1, ["P7"], { reasoning: "too big for now" })],
                outcomes: {},
                at: 15,
            },
            ...extra,
        });
    };

    it("heads the directions Ideas worth trying, best first; a Review report has no heading", () => {
        expect(directionsHeading(brainstorm())).toBe("Ideas worth trying, best first");
        expect(directionsHeading(council())).toBe("");
        expect(directionsHeading(council({ mode: "review" }))).toBe("");
    });

    it("gives each row its first step, and none for a row without one", () => {
        const [first, second] = directionRows(brainstorm());
        expect(first.firstStep).toBe("First step: Try it on one screen");
        expect(second.firstStep).toBe("");
        expect(directionRows(council())[0].firstStep).toBe("");
    });

    it("says who had the idea and who built on it, in panel order and once each, leaving the person out", () => {
        const [first, second] = directionRows(brainstorm());
        expect(first.meta).toBe("Had it: UX and RAM · built on by New user and Skeptic · 1 file · 1 weak claim");
        expect(second.meta).toBe("Had it: Skeptic · 1 file");
        expect(first.meta).not.toContain("You");
    });

    it("says nothing about builders when no reply builds on it", () => {
        const c = brainstorm({ replies: [] });
        expect(directionRows(c)[1].meta).toBe("Had it: Skeptic · 1 file");
    });

    it("keeps the from line, not Had it, in a Review report", () => {
        expect(directionRows(council())[1].meta).toBe("from Skeptic · 1 file · in Ideas");
    });

    it("lists the wild ideas kept aside with who had them and why", () => {
        const rows = keptRows(brainstorm());
        expect(rows).toHaveLength(1);
        expect(rows[0].direction.reasoning).toBe("too big for now");
        expect(rows[0].had).toBe("Had it: New user");
    });

    it("shows no kept section when nothing was kept, or the council is not a Brainstorm", () => {
        expect(keptRows(brainstorm({ summary: { ...brainstorm().summary!, kept: [] } }))).toEqual([]);
        expect(keptRows(brainstorm({ summary: { ...brainstorm().summary!, kept: undefined } }))).toEqual([]);
        expect(keptRows(council())).toEqual([]);
        expect(keptRows(council({ summary: undefined }))).toEqual([]);
    });

    it("counts the ideas in no direction and not kept", () => {
        // P1 is in neither; P2, P3 and P5 are in directions and P7 is kept
        expect(droppedLine(brainstorm())).toBe("1 more idea merged or dropped");
        const two = brainstorm({ proposals: [...brainstorm().proposals!, prop("P8", "ux")] });
        expect(droppedLine(two)).toBe("2 more ideas merged or dropped");
    });

    it("has no count line at 0, in a Review report, or before a summary", () => {
        const none = brainstorm({
            proposals: [prop("P2", "ux"), prop("P3", "ram"), prop("P5", "sk"), prop("P7", "nu")],
        });
        expect(droppedLine(none)).toBe("");
        expect(droppedLine(council())).toBe("");
        expect(droppedLine(brainstorm({ summary: undefined }))).toBe("");
    });
});

describe("the saved document", () => {
    it("says where the whole discussion was saved, relative to the project", () => {
        const c = council({ docpath: "D:\\code\\arc\\docs\\council\\2026-10-22-rail-apps.md" });
        expect(savedLine(c)).toBe("Saved to docs/council/2026-10-22-rail-apps.md with the whole discussion");
    });

    it("gives the whole path for a document outside the project", () => {
        const c = council({ docpath: "D:\\notes\\rail-apps.md" });
        expect(savedLine(c)).toBe("Saved to D:\\notes\\rail-apps.md with the whole discussion");
    });

    it("says nothing before the council saved itself", () => {
        expect(savedLine(council())).toBe("");
        expect(savedLine(council({ docpath: "" }))).toBe("");
    });

    it("offers Open the document once it is saved, else Save as doc", () => {
        expect(docAction(council())).toEqual({ id: "save-doc", label: "Save as doc" });
        expect(docAction(council({ docpath: "D:\\code\\arc\\docs\\council\\x.md" }))).toEqual({
            id: "open-doc",
            label: "Open the document",
        });
    });
});

describe("directionTag", () => {
    const tagOf = (stances: Record<string, string>) => directionTag(council(), direction(1, ["P2"], { stances }));

    it("says everyone agrees when no one has doubts or is against it", () => {
        expect(tagOf({})).toBe("Everyone agrees");
        expect(tagOf({ ux: "accept", ram: "accept" })).toBe("Everyone agrees");
    });

    it("names who has doubts, in the panel's order", () => {
        expect(tagOf({ sk: "challenge" })).toBe("Skeptic has doubts");
        expect(tagOf({ sk: "challenge", ux: "challenge" })).toBe("UX and Skeptic have doubts");
        expect(tagOf({ sk: "challenge", ux: "challenge", ram: "challenge" })).toBe("UX, RAM and Skeptic have doubts");
    });

    it("lets against win over doubts", () => {
        expect(tagOf({ ram: "oppose", sk: "challenge" })).toBe("RAM is against it");
        expect(tagOf({ ram: "oppose", ux: "oppose", sk: "challenge" })).toBe("UX and RAM are against it");
    });

    it("ignores a stance word it does not know", () => {
        expect(tagOf({ ram: "maybe" as string })).toBe("Everyone agrees");
    });

    it("does not say everyone agrees of a direction the coordinator marked split with no one named", () => {
        const c = council();
        expect(directionTag(c, direction(1, ["P2"], { agreed: false, stances: {} }))).toBe("Not everyone agrees");
    });
});

describe("defaultCouncilView", () => {
    const withSummary = council().summary;

    it("opens a finished council with a summary on its report", () => {
        for (const state of ["done", "stopped", "failed"]) {
            expect(defaultCouncilView(council({ state, summary: withSummary }))).toBe("summary");
        }
    });

    it("opens a running council, one waiting on you and one without a summary on the discussion", () => {
        expect(defaultCouncilView(council({ state: "running" }))).toBe("discussion");
        expect(defaultCouncilView(council({ state: "awaiting-you" }))).toBe("discussion");
        expect(defaultCouncilView(council({ state: "done", summary: undefined }))).toBe("discussion");
        expect(defaultCouncilView(council({ state: "stopped", summary: undefined }))).toBe("discussion");
    });

    it("opens a council that is not known on the discussion", () => {
        expect(defaultCouncilView(null)).toBe("discussion");
        expect(defaultCouncilView(undefined)).toBe("discussion");
    });
});

describe("answerLine and askedLine", () => {
    const text = "Move the pins first: both are cheap. Keeping an app awake waits on a measurement.";
    const summary = (extra: Partial<CouncilSummary> = {}): CouncilSummary => ({
        text,
        directions: [],
        outcomes: {},
        at: 1,
        ...extra,
    });

    it("is the answer when the coordinator wrote one", () => {
        const c = council({ summary: summary({ answer: "Yes: do the pins first." }) });
        expect(answerLine(c)).toBe("Yes: do the pins first.");
        expect(answerParts(c)).toEqual({ answer: "Yes: do the pins first.", rest: text });
    });

    it("falls back to the first sentence of the summary text, and leaves the rest of it under", () => {
        const c = council({ summary: summary() });
        expect(answerLine(c)).toBe("Move the pins first: both are cheap.");
        expect(answerParts(c).rest).toBe("Keeping an app awake waits on a measurement.");
    });

    it("takes a text with one sentence, or none ended, whole", () => {
        expect(answerLine(council({ summary: summary({ text: "Only this" }) }))).toBe("Only this");
        expect(answerParts(council({ summary: summary({ text: "Only this" }) })).rest).toBe("");
        expect(answerLine(council({ summary: summary({ text: "Costs 0.5 s. Then more." }) }))).toBe("Costs 0.5 s.");
    });

    it("is empty without a summary or with an empty one", () => {
        expect(answerLine(council({ summary: undefined }))).toBe("");
        expect(answerLine(council({ summary: summary({ text: "" }) }))).toBe("");
        expect(answerParts(council({ summary: undefined }))).toEqual({ answer: "", rest: "" });
    });

    it("asks what the person asked, and says nothing without a question", () => {
        expect(askedLine(council({ question: "What first?" }))).toBe("You asked: What first?");
        expect(askedLine(council({ question: "  " }))).toBe("");
        expect(askedLine(council({ question: undefined }))).toBe("");
    });
});

describe("outcomeLabel", () => {
    it("drops the round from a withdrawn proposal and leaves the rest", () => {
        expect(outcomeLabel("Withdrawn in round 2")).toBe("Withdrawn");
        expect(outcomeLabel("Withdrawn")).toBe("Withdrawn");
        expect(outcomeLabel("Direction 1")).toBe("Direction 1");
        expect(outcomeLabel("Merged into direction 3")).toBe("Merged into direction 3");
        expect(outcomeLabel("")).toBe("");
    });
});

describe("evidenceLabel", () => {
    it("is the ref, and for a weak one the reason", () => {
        expect(evidenceLabel({ ref: "railapps.ts:72" })).toBe("railapps.ts:72");
        expect(evidenceLabel({ ref: "", weak: true, note: '"about 3 s" has no measurement' })).toBe(
            'Weak · "about 3 s" has no measurement'
        );
        expect(evidenceLabel({ ref: "", weak: true })).toBe("Weak · cites no evidence");
    });

    it("names a screenshot region", () => {
        expect(evidenceLabel({ ref: "screenshot:rail.png#top-left" })).toBe("Screenshot rail.png#top-left");
    });
});

describe("canRunSummary", () => {
    it("is on for a council the runner summarizes, whatever round it stopped at", () => {
        for (const state of ["done", "stopped", "failed", "awaiting-you"]) {
            expect(canRunSummary(council({ state, round: 1 }))).toBe(true);
        }
    });

    it("is off while the council runs, before it ran, and with nothing to summarize", () => {
        expect(canRunSummary(council({ state: "running" }))).toBe(false);
        expect(canRunSummary(council({ state: "not-run" }))).toBe(false);
        expect(canRunSummary(council({ proposals: [] }))).toBe(false);
        expect(canRunSummary(council({ proposals: undefined }))).toBe(false);
    });
});

describe("writtenLine", () => {
    it("counts the replies the summary read and gives its time", () => {
        const at = new Date(2026, 9, 21, 11, 2).getTime();
        const c = council({
            replies: [
                reply("r1", "P2", "ram", { ts: at - 5000 }),
                reply("r2", "P2", "sk", { ts: at }),
                reply("r3", "P2", "you", { ts: at + 1 }),
            ],
            summary: { text: "", directions: [], outcomes: {}, at },
        });
        expect(writtenLine(c)).toBe("Written by the coordinator at 11:02 from 2 replies");
    });

    it("is singular for one reply and empty before a summary", () => {
        const at = new Date(2026, 9, 21, 9, 5).getTime();
        const c = council({
            replies: [reply("r1", "P2", "ram", { ts: at })],
            summary: { text: "", directions: [], outcomes: {}, at },
        });
        expect(writtenLine(c)).toBe("Written by the coordinator at 09:05 from 1 reply");
        expect(writtenLine(council({ summary: undefined }))).toBe("");
    });
});

describe("outdatedLabel", () => {
    it("is singular for one reply", () => {
        expect(outdatedLabel(1)).toBe("Outdated · 1 reply since");
        expect(outdatedLabel(3)).toBe("Outdated · 3 replies since");
    });
});

describe("docPathLabel", () => {
    it("is relative inside the project, whatever the separators and the drive's case", () => {
        expect(docPathLabel("D:\\code\\arc", "D:\\code\\arc\\docs\\council\\2026-10-21-rail-apps.md")).toBe(
            "docs/council/2026-10-21-rail-apps.md"
        );
        expect(docPathLabel("d:/code/arc/", "D:/code/arc/docs/x.md")).toBe("docs/x.md");
        expect(docPathLabel("/home/me/arc", "/home/me/arc/docs/x.md")).toBe("docs/x.md");
    });

    it("is the whole path outside it", () => {
        expect(docPathLabel("/home/me/arc", "/home/me/other/x.md")).toBe("/home/me/other/x.md");
        expect(docPathLabel("/home/me/arc", "/home/me/arcade/x.md")).toBe("/home/me/arcade/x.md");
    });
});

describe("projectNameOf", () => {
    const projects = [
        { name: "arc", path: "D:\\code\\arc" },
        { name: "paper", path: "/home/me/paper" },
    ];

    it("finds the project whose folder it is, by either spelling of the path", () => {
        expect(projectNameOf(projects, "d:/code/arc/")).toBe("arc");
        expect(projectNameOf(projects, "/home/me/paper")).toBe("paper");
    });

    it("is undefined for a folder that is none of them", () => {
        expect(projectNameOf(projects, "D:\\code\\arc\\sub")).toBeUndefined();
    });
});

describe("initiativeSeed", () => {
    it("is named after the feature with a chunk per direction in rank order", () => {
        expect(initiativeSeed(council())).toEqual({
            title: "Rail apps",
            chunks: [{ label: "direction 1" }, { label: "direction 2" }],
        });
    });

    it("makes labels fit what wavesrv accepts: not repeated, not empty, not long", () => {
        const long = "x".repeat(250);
        const c = council({
            feature: "  ",
            summary: {
                text: "",
                directions: [
                    direction(1, [], { title: "Same" }),
                    direction(2, [], { title: "Same" }),
                    direction(3, [], { title: "  " }),
                    direction(4, [], { title: long }),
                ],
                outcomes: {},
                at: 1,
            },
        });
        const seed = initiativeSeed(c);
        expect(seed.title).toBe("Council");
        expect(seed.chunks.map((x) => x.label).slice(0, 3)).toEqual(["Same", "Same (2)", "Direction 3"]);
        expect(seed.chunks[3].label.length).toBeLessThanOrEqual(200);
        expect(new Set(seed.chunks.map((x) => x.label)).size).toBe(4);
    });

    it("has no chunks before a summary", () => {
        expect(initiativeSeed(council({ summary: undefined })).chunks).toEqual([]);
    });
});

describe("brainstormPrompt", () => {
    it("holds the direction, its reasoning, its proposals and its thread, and asks to record it first", () => {
        const c = council({ question: "What first?" });
        const row = directionRows(c)[0];
        const prompt = brainstormPrompt(c, row);
        expect(prompt).toContain('"Rail apps"');
        expect(prompt).toContain("(What first?)");
        expect(prompt).toContain("ranked this direction 1 (RAM is against it)");
        expect(prompt).toContain("Direction: direction 1");
        expect(prompt).toContain("Why: reasoning 1");
        expect(prompt).toContain('- "title P2" by UX: argument P2.');
        expect(prompt).toContain('- RAM on "title P2" (Is against it): holds a whole dev server');
        expect(prompt).toContain('- You on "title P2": does this change on a Mac?');
        expect(prompt).toContain("wsh idea add");
        expect(prompt.indexOf("wsh idea add")).toBeGreaterThan(prompt.indexOf("The thread:"));
    });

    it("names proposals by title and author, never by id", () => {
        const base = council({ question: "What first?" });
        const c = {
            ...base,
            proposals: base.proposals!.map((p) => ({ ...p, title: `idea about ${p.author}`, argument: "a reason." })),
            replies: base.replies!.map((r) => ({ ...r, text: "a reply" })),
        };
        const prompt = brainstormPrompt(c, directionRows(c)[0]);
        expect(prompt).toContain('- "idea about ux" by UX: a reason.');
        expect(prompt).toContain('- RAM on "idea about ux" (Is against it): a reply');
        expect(prompt).not.toMatch(/\bP\d+\b/);
    });

    it("leaves out the thread of other directions", () => {
        const c = council();
        const prompt = brainstormPrompt(c, directionRows(c)[1]);
        expect(prompt).not.toContain("holds a whole dev server");
        expect(prompt).not.toContain("The thread:");
    });

    it("cuts the thread from its oldest end when it would be too long for a launch argument", () => {
        const replies = Array.from({ length: 30 }, (_, i) =>
            reply(`r${i}`, "P2", "ram", { text: `reply ${i} ${"y".repeat(450)}`, ts: i + 1 })
        );
        const c = council({ replies });
        const prompt = brainstormPrompt(c, directionRows(c)[0]);
        expect(prompt.length).toBeLessThanOrEqual(8000);
        expect(prompt).toContain("reply 29 ");
        expect(prompt).not.toContain("reply 0 ");
    });
});
