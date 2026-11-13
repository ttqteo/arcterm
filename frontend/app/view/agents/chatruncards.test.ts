// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    conversationRuns,
    pairRunEnded,
    parseRunEnded,
    placeRunCards,
    queuedLabel,
    queuedView,
    runCardFolded,
    runEndedLine,
    runStartAnchor,
    type RunAnchor,
} from "./chatruncards";

const RUN = "3fa21b0c-9d4e-4f6a-8b1c-0123456789ab";
const OTHER = "77c0de11-1111-4222-8333-444455556666";
const ENTRY = "q4k9x2mz";

describe("runStartAnchor", () => {
    const cmd = "wsh runs start --plan docs/superpowers/plans/2026-11-13-x.md";

    it("reads the started line of a run that began at once", () => {
        const out = `started run ${RUN} (orchestrator, planning) in arcterm\nfollow it with: wsh runs show ${RUN}\n`;
        expect(runStartAnchor(cmd, out)).toEqual({ kind: "started", runId: RUN });
    });

    it("reads a queued line in each of its shapes", () => {
        const anchor: RunAnchor = { kind: "queued", entryId: ENTRY };
        const queuedCmd = `${cmd} --queue`;
        expect(runStartAnchor(queuedCmd, `queued ${ENTRY}\n`)).toEqual(anchor);
        expect(
            runStartAnchor(queuedCmd, `queued ${ENTRY} (#2 in line) — starts when fewer than 3 runs are active\n`)
        ).toEqual(anchor);
        expect(
            runStartAnchor(queuedCmd, `queued ${ENTRY} (#1 in line) — starts after Chat verdict handoff lands\n`)
        ).toEqual(anchor);
        expect(runStartAnchor(queuedCmd, `queued ${ENTRY} — blocked: the project has no git repo\n`)).toEqual(anchor);
    });

    it("reads the queued entry that started already as a queued anchor", () => {
        const out = `queued ${ENTRY} — and started already: there was room. Follow it with: wsh runs list\n`;
        expect(runStartAnchor(`${cmd} --queue`, out)).toEqual({ kind: "queued", entryId: ENTRY });
    });

    it("finds wsh through a path, an .exe, quotes, a prefix command and a chain", () => {
        const out = `started run ${RUN} (quick, executing) in arcterm\n`;
        const anchor = { kind: "started", runId: RUN };
        expect(runStartAnchor("~/.arc/bin/wsh runs start --goal 'x'", out)).toEqual(anchor);
        expect(runStartAnchor('"$HOME/.arc/bin/wsh" runs start --goal x', out)).toEqual(anchor);
        expect(runStartAnchor("C:\\Users\\me\\.arc\\bin\\wsh.exe runs start --plan p.md", out)).toEqual(anchor);
        expect(runStartAnchor("cd repo && wsh runs start --plan p.md", out)).toEqual(anchor);
        expect(runStartAnchor("  wsh   runs   start --plan p.md", out)).toEqual(anchor);
    });

    it("takes the first run when the output names several", () => {
        const out = `started run ${RUN} (quick, executing) in a\nstarted run ${OTHER} (quick, executing) in a\n`;
        expect(runStartAnchor("wsh runs start --goal a; wsh runs start --goal b", out)).toEqual({
            kind: "started",
            runId: RUN,
        });
    });

    it("is null for a command that is not wsh runs start", () => {
        const out = `started run ${RUN} (quick, executing) in arcterm\n`;
        expect(runStartAnchor("wsh runs list", out)).toBeNull();
        expect(runStartAnchor("wsh runs show " + RUN, out)).toBeNull();
        expect(runStartAnchor("wsh runs start-now " + ENTRY, out)).toBeNull();
        expect(runStartAnchor("wsh runs queue start-now " + ENTRY, `started queued ${ENTRY} now\n`)).toBeNull();
        expect(runStartAnchor("git status", out)).toBeNull();
        expect(runStartAnchor("echo runs start", out)).toBeNull();
        expect(runStartAnchor("wsh agents start", out)).toBeNull();
    });

    it("is null when the output names no run", () => {
        expect(runStartAnchor("wsh runs start --plan p.md", "")).toBeNull();
        expect(runStartAnchor("wsh runs start --plan p.md", "error: no plan at p.md\n")).toBeNull();
        expect(runStartAnchor("wsh runs start --help", "Usage:\n  wsh runs start [flags]\n")).toBeNull();
    });

    it("is null when the output only quotes an id", () => {
        const cmdLine = "wsh runs start --plan p.md";
        expect(runStartAnchor(cmdLine, `error: the plan was already started run ${RUN}, cancel it first\n`)).toBeNull();
        expect(runStartAnchor(cmdLine, `error: an earlier plan is queued ${ENTRY} behind this one\n`)).toBeNull();
        expect(runStartAnchor(cmdLine, `see: wsh runs show ${RUN}\n`)).toBeNull();
        // the run list prints ids, but its lines do not begin with a start word
        expect(runStartAnchor(cmdLine, `${ENTRY}  queued #1  2m ago\n${RUN}  executing\n`)).toBeNull();
    });

    it("keeps the started line when other output comes first or follows", () => {
        const out = `preparing worktree…\nstarted run ${RUN} (orchestrator, planning) in arcterm\nfollow it with: wsh runs show ${RUN}\n`;
        expect(runStartAnchor("wsh runs start --plan p.md 2>&1", out)).toEqual({ kind: "started", runId: RUN });
    });
});

describe("conversationRuns", () => {
    const run = (oid: string, origintranscript?: string, createdts = 1) => ({ oid, origintranscript, createdts });

    it("is the runs started from this transcript", () => {
        const runs = [run("r1", "/t/now.jsonl"), run("r2", "/t/old.jsonl"), run("r3", "/t/now.jsonl"), run("r4")];
        expect(conversationRuns("/t/now.jsonl", runs)).toEqual(["r1", "r3"]);
    });

    it("matches the transcript across slash and case spellings", () => {
        const runs = [run("r1", "c:/users/me/s1.jsonl")];
        expect(conversationRuns("C:\\Users\\Me\\s1.jsonl", runs)).toEqual(["r1"]);
    });

    it("adds the brainstorm's run, once", () => {
        const runs = [run("r1", "/t/now.jsonl"), run("b1")];
        expect(conversationRuns("/t/now.jsonl", runs, "b1")).toEqual(["r1", "b1"]);
        // the brainstorm's run is also one of this transcript's
        expect(conversationRuns("/t/now.jsonl", [run("b1", "/t/now.jsonl"), run("r1", "/t/now.jsonl")], "b1")).toEqual([
            "b1",
            "r1",
        ]);
    });

    it("adds the brainstorm's run even when the store does not list it", () => {
        expect(conversationRuns("/t/now.jsonl", [], "b1")).toEqual(["b1"]);
    });

    it("leaves out another transcript's runs, and every run when the transcript is unknown", () => {
        const runs = [run("r1", "/t/old.jsonl"), run("r2")];
        expect(conversationRuns("/t/now.jsonl", runs)).toEqual([]);
        expect(conversationRuns(undefined, runs)).toEqual([]);
        expect(conversationRuns("", runs)).toEqual([]);
        expect(conversationRuns(undefined, runs, "b1")).toEqual(["b1"]);
    });

    it("lists the runs oldest first", () => {
        const runs = [
            run("late", "/t/now.jsonl", 300),
            run("early", "/t/now.jsonl", 100),
            run("mid", "/t/now.jsonl", 200),
        ];
        expect(conversationRuns("/t/now.jsonl", runs)).toEqual(["early", "mid", "late"]);
    });
});

describe("placeRunCards", () => {
    const started = (runId: string): RunAnchor => ({ kind: "started", runId });
    const queued = (entryId: string): RunAnchor => ({ kind: "queued", entryId });
    const none = { queued: [], started: {} };

    it("puts a run's card at the call whose output named it", () => {
        const placed = placeRunCards({
            anchors: [{ key: "runstart:4", anchor: started("r1"), order: 1000 }],
            runs: [{ runId: "r1", createdTs: 1001 }],
            ...none,
        });
        expect(placed.byAnchor.get("runstart:4")).toEqual({ runId: "r1" });
        expect(placed.trailing).toEqual([]);
    });

    it("draws the card of a started anchor whose run the store has not listed yet", () => {
        const placed = placeRunCards({
            anchors: [{ key: "runstart:4", anchor: started("r1"), order: 1000 }],
            runs: [],
            ...none,
        });
        expect(placed.byAnchor.get("runstart:4")).toEqual({ runId: "r1" });
        expect(placed.trailing).toEqual([]);
    });

    it("keeps a queued entry as its own card while it waits", () => {
        const placed = placeRunCards({
            anchors: [{ key: "runstart:9", anchor: queued("e1"), order: 1000 }],
            runs: [{ runId: "r1", createdTs: 500 }],
            queued: [{ id: "e1" }],
            started: {},
        });
        expect(placed.byAnchor.get("runstart:9")).toEqual({ entryId: "e1" });
        // the run created before the call is nobody's anchor
        expect(placed.trailing).toEqual(["r1"]);
    });

    it("moves a queued entry to the run the queue started, by the started record", () => {
        const placed = placeRunCards({
            anchors: [{ key: "runstart:9", anchor: queued("e1"), order: 1000 }],
            runs: [
                { runId: "older", createdTs: 1500 },
                { runId: "r2", createdTs: 3000 },
            ],
            queued: [],
            started: { e1: "r2" },
        });
        expect(placed.byAnchor.get("runstart:9")).toEqual({ entryId: "e1", runId: "r2" });
        expect(placed.trailing).toEqual(["older"]);
    });

    it("follows a queued entry that left the queue to the oldest later run no anchor claims", () => {
        const placed = placeRunCards({
            anchors: [
                { key: "runstart:3", anchor: started("direct"), order: 500 },
                { key: "runstart:9", anchor: queued("e1"), order: 1000 },
            ],
            runs: [
                { runId: "before", createdTs: 900 },
                { runId: "direct", createdTs: 510 },
                { runId: "first", createdTs: 1200 },
                { runId: "second", createdTs: 1300 },
            ],
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.get("runstart:3")).toEqual({ runId: "direct" });
        expect(placed.byAnchor.get("runstart:9")).toEqual({ entryId: "e1", runId: "first" });
        expect(placed.trailing).toEqual(["before", "second"]);
    });

    it("gives two queued entries the runs in order, each run once", () => {
        const placed = placeRunCards({
            anchors: [
                { key: "b", anchor: queued("e2"), order: 2000 },
                { key: "a", anchor: queued("e1"), order: 1000 },
            ],
            runs: [
                { runId: "r2", createdTs: 2500 },
                { runId: "r1", createdTs: 1500 },
            ],
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.get("a")).toEqual({ entryId: "e1", runId: "r1" });
        expect(placed.byAnchor.get("b")).toEqual({ entryId: "e2", runId: "r2" });
        expect(placed.trailing).toEqual([]);
    });

    it("lets a started record claim its run before another entry's fallback picks it", () => {
        const placed = placeRunCards({
            anchors: [
                { key: "a", anchor: queued("e1"), order: 1000 },
                { key: "b", anchor: queued("e2"), order: 2000 },
            ],
            runs: [
                { runId: "r1", createdTs: 1500 },
                { runId: "r2", createdTs: 2500 },
            ],
            queued: [],
            started: { e2: "r1" },
        });
        expect(placed.byAnchor.get("b")).toEqual({ entryId: "e2", runId: "r1" });
        expect(placed.byAnchor.get("a")).toEqual({ entryId: "e1", runId: "r2" });
    });

    it("leaves a gone entry with no run when none of the conversation's runs is later", () => {
        const placed = placeRunCards({
            anchors: [{ key: "a", anchor: queued("e1"), order: 1000 }],
            runs: [{ runId: "old", createdTs: 400 }],
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.get("a")).toEqual({ entryId: "e1" });
        expect(placed.trailing).toEqual(["old"]);
    });

    it("counts a run with no time as later than every call", () => {
        const placed = placeRunCards({
            anchors: [{ key: "a", anchor: queued("e1"), order: 1000 }],
            runs: [{ runId: "r1" }],
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.get("a")).toEqual({ entryId: "e1", runId: "r1" });
    });

    it("works when order is only a place in the conversation: no run is then ruled out", () => {
        const placed = placeRunCards({
            anchors: [{ key: "a", anchor: queued("e1"), order: 7 }],
            runs: [{ runId: "r1", createdTs: 1_700_000_000_000 }],
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.get("a")).toEqual({ entryId: "e1", runId: "r1" });
    });

    it("sends a run no call names to the end, oldest first", () => {
        const placed = placeRunCards({
            anchors: [{ key: "a", anchor: started("r1"), order: 1000 }],
            runs: [
                { runId: "r1", createdTs: 1100 },
                { runId: "late", createdTs: 9000 },
                { runId: "early", createdTs: 2000 },
                { runId: "untimed" },
            ],
            ...none,
        });
        expect(placed.trailing).toEqual(["early", "late", "untimed"]);
    });

    it("leaves the brainstorm's run to its own place", () => {
        const placed = placeRunCards({
            anchors: [
                { key: "a", anchor: started("b1"), order: 1000 },
                { key: "b", anchor: queued("e1"), order: 2000 },
            ],
            runs: [
                { runId: "b1", createdTs: 1100 },
                { runId: "r1", createdTs: 2500 },
            ],
            brainstormRun: "b1",
            queued: [],
            started: {},
        });
        expect(placed.byAnchor.has("a")).toBe(false);
        // the brainstorm's run is not a candidate for a queued entry either
        expect(placed.byAnchor.get("b")).toEqual({ entryId: "e1", runId: "r1" });
        expect(placed.trailing).toEqual([]);

        const alone = placeRunCards({
            anchors: [],
            runs: [{ runId: "b1", createdTs: 1 }],
            brainstormRun: "b1",
            ...none,
        });
        expect(alone.trailing).toEqual([]);
    });

    it("draws a run once when two calls name it", () => {
        const placed = placeRunCards({
            anchors: [
                { key: "second", anchor: started("r1"), order: 2000 },
                { key: "first", anchor: started("r1"), order: 1000 },
            ],
            runs: [{ runId: "r1", createdTs: 1100 }],
            ...none,
        });
        expect(placed.byAnchor.get("first")).toEqual({ runId: "r1" });
        expect(placed.byAnchor.has("second")).toBe(false);
    });

    it("is empty for a conversation that started nothing", () => {
        const placed = placeRunCards({ anchors: [], runs: [], ...none });
        expect(placed.byAnchor.size).toBe(0);
        expect(placed.trailing).toEqual([]);
    });
});

describe("queuedView and queuedLabel", () => {
    const entry = (over: Partial<RunQueueEntry> = {}): RunQueueEntry =>
        ({
            id: ENTRY,
            data: {},
            title: "Add a thing",
            projectpath: "/p",
            queuedts: 1,
            state: "waiting",
            ...over,
        }) as RunQueueEntry;
    const titles = (m: Record<string, string>) => (id: string) => m[id];

    it("waits for room", () => {
        const v = queuedView(ENTRY, [entry()], {}, titles({}));
        expect(v).toEqual({ state: "waiting" });
        expect(queuedLabel(v)).toBe("Queued");
    });

    it("waits after a run, named by its title", () => {
        const v = queuedView(ENTRY, [entry({ after: RUN })], {}, titles({ [RUN]: "Chat verdict handoff" }));
        expect(v).toEqual({ state: "waiting", after: "Chat verdict handoff" });
        expect(queuedLabel(v)).toBe("Queued · after Chat verdict handoff");
    });

    it("names the run it waits after by its short id when its title is not known", () => {
        const v = queuedView(ENTRY, [entry({ after: RUN })], {}, titles({}));
        expect(v).toEqual({ state: "waiting", after: "3fa21b0c" });
        expect(queuedLabel(v)).toBe("Queued · after 3fa21b0c");
        expect(queuedView(ENTRY, [entry({ after: RUN })], {}, () => "")).toEqual({
            state: "waiting",
            after: "3fa21b0c",
        });
    });

    it("is blocked with its reason", () => {
        const v = queuedView(ENTRY, [entry({ state: "blocked", reason: "the base moved on" })], {}, titles({}));
        expect(v).toEqual({ state: "blocked", reason: "the base moved on" });
        expect(queuedLabel(v)).toBe("Queued · blocked: the base moved on");
    });

    it("says only blocked when the entry gave no reason", () => {
        const v = queuedView(ENTRY, [entry({ state: "blocked" })], {}, titles({}));
        expect(queuedLabel(v)).toBe("Queued · blocked");
    });

    it("reads its own entry among others", () => {
        const others = [entry({ id: "zzzz", state: "blocked", reason: "no" }), entry({ id: "yyyy", after: OTHER })];
        expect(queuedView(ENTRY, [...others, entry()], {}, titles({}))).toEqual({ state: "waiting" });
    });

    it("has started once the queue let it go, and names the run", () => {
        const v = queuedView(ENTRY, [], { [ENTRY]: RUN }, titles({}));
        expect(v).toEqual({ state: "started", runId: RUN });
        expect(queuedLabel(v)).toBe("");
    });

    it("is gone when it left the queue and no run is known", () => {
        const v = queuedView(ENTRY, [entry({ id: "other" })], {}, titles({}));
        expect(v).toEqual({ state: "gone" });
        expect(queuedLabel(v)).toBe("");
    });

    it("prefers the queue over a started record", () => {
        expect(queuedView(ENTRY, [entry()], { [ENTRY]: RUN }, titles({}))).toEqual({ state: "waiting" });
    });
});

describe("parseRunEnded", () => {
    it("reads a landed message and keeps the text as written", () => {
        const text =
            "[arc] Run 3fa21b0c landed: merged into main (5/5 tasks, Final passed, 2 files +812/-140).\nPlan: docs/superpowers/plans/x.md\nReview it as the session that wrote the plan.";
        expect(parseRunEnded(text)).toEqual({
            id8: "3fa21b0c",
            landed: true,
            detail: "merged into main (5/5 tasks, Final passed, 2 files +812/-140)",
            text,
        });
    });

    it("reads a held message with its reason", () => {
        const text =
            "[arc] Run 3fa21b0c held: merge conflict in pkg/a.go.\nDiagnose with wsh runs show 3fa21b0c. Do not force the land; propose the fix to the user.";
        expect(parseRunEnded(text)).toEqual({
            id8: "3fa21b0c",
            landed: false,
            detail: "merge conflict in pkg/a.go",
            text,
        });
    });

    it("reads a bare held message", () => {
        const text = "[arc] Run 3fa21b0c held.\nDiagnose with wsh runs show 3fa21b0c.";
        expect(parseRunEnded(text)).toEqual({ id8: "3fa21b0c", landed: false, detail: "", text });
    });

    it("reads a message that carries the run's goal", () => {
        const landed =
            '[arc] Run 3fa21b0c "Brainstorm ideas" landed: merged into the checkout (5/5 tasks).\nPlan: p.md';
        expect(parseRunEnded(landed)).toMatchObject({
            id8: "3fa21b0c",
            landed: true,
            detail: "merged into the checkout (5/5 tasks)",
        });
        const held = '[arc] Run 3fa21b0c "Brainstorm ideas" held: Final failed. see the report.';
        expect(parseRunEnded(held)).toMatchObject({ landed: false, detail: "Final failed. see the report" });
        const bare = '[arc] Run 3fa21b0c "Brainstorm ideas" held.';
        expect(parseRunEnded(bare)).toMatchObject({ landed: false, detail: "" });
    });

    it("reads a goal that holds quotes, escapes and a cut-off ellipsis", () => {
        const text = '[arc] Run 3fa21b0c "Fix the \\"held:\\" copy in the sheet…" landed: merged into main.';
        expect(parseRunEnded(text)).toMatchObject({ id8: "3fa21b0c", landed: true, detail: "merged into main" });
    });

    it("reads a message with Windows line ends", () => {
        const text = "[arc] Run 3fa21b0c landed: merged into main (1 file +3/-1).\r\nPlan: p.md";
        expect(parseRunEnded(text)).toMatchObject({ landed: true, detail: "merged into main (1 file +3/-1)" });
    });

    it("is null for a message that is not the run-ended message", () => {
        expect(parseRunEnded("")).toBeNull();
        expect(parseRunEnded("Run 3fa21b0c landed: merged into main.")).toBeNull();
        expect(parseRunEnded("[arc] Run 3fa21b0 landed: merged into main.")).toBeNull();
        expect(parseRunEnded("[arc] Run 3fa21b0cd landed: merged into main.")).toBeNull();
        expect(parseRunEnded("[arc] Run 3fa21b0c started: merged into main.")).toBeNull();
        expect(parseRunEnded("[arc] Run 3fa21b0c held up the build")).toBeNull();
        expect(parseRunEnded("[arc] Run 3fa21b0c")).toBeNull();
        expect(parseRunEnded("[arc] Run ZZZZZZZZ landed: merged into main.")).toBeNull();
    });

    it("is null when the prefix is only quoted later in a message you typed", () => {
        expect(parseRunEnded('what does "[arc] Run 3fa21b0c landed: merged into main." mean?')).toBeNull();
        expect(parseRunEnded("see this:\n[arc] Run 3fa21b0c landed: merged into main.")).toBeNull();
        expect(parseRunEnded("   [arc] Run 3fa21b0c landed: merged into main.")).toBeNull();
    });
});

describe("pairRunEnded", () => {
    const landedText = "[arc] Run 3fa21b0c landed: merged into main (2/2 tasks).\nPlan: p.md";
    const heldText = "[arc] Run 3fa21b0c held: merge conflict.\nDiagnose with wsh runs show 3fa21b0c.";

    it("pairs a message with the run its id starts", () => {
        const paired = pairRunEnded(
            [
                { key: "you:1", text: "go on" },
                { key: "you:5", text: landedText },
            ],
            [OTHER, RUN]
        );
        expect([...paired.keys()]).toEqual(["you:5"]);
        const hit = paired.get("you:5");
        expect(hit?.runId).toBe(RUN);
        expect(hit?.ended).toMatchObject({ id8: "3fa21b0c", landed: true, detail: "merged into main (2/2 tasks)" });
    });

    it("leaves a message for a run of another conversation a bubble", () => {
        const paired = pairRunEnded([{ key: "you:5", text: landedText }], [OTHER]);
        expect(paired.size).toBe(0);
        expect(pairRunEnded([{ key: "you:5", text: landedText }], []).size).toBe(0);
    });

    it("leaves a message you typed that quotes the prefix mid-text a bubble", () => {
        const typed = `why did this say\n${landedText}`;
        expect(pairRunEnded([{ key: "you:5", text: typed }], [RUN]).size).toBe(0);
    });

    it("pairs every message of a run, in conversation order", () => {
        const paired = pairRunEnded(
            [
                { key: "you:3", text: heldText },
                { key: "sent:8", text: landedText },
            ],
            [RUN]
        );
        expect([...paired.entries()].map(([k, v]) => [k, v.runId, v.ended.landed])).toEqual([
            ["you:3", RUN, false],
            ["sent:8", RUN, true],
        ]);
    });

    it("pairs the messages of two runs", () => {
        const other = "[arc] Run 77c0de11 held.\nDiagnose with wsh runs show 77c0de11.";
        const paired = pairRunEnded(
            [
                { key: "a", text: landedText },
                { key: "b", text: other },
            ],
            [RUN, OTHER]
        );
        expect(paired.get("a")?.runId).toBe(RUN);
        expect(paired.get("b")?.runId).toBe(OTHER);
    });
});

describe("runEndedLine", () => {
    it("reads a landed run", () => {
        const ended = parseRunEnded("[arc] Run 3fa21b0c landed: merged into main (2/2 tasks).")!;
        expect(runEndedLine(RUN, ended)).toBe("Run 3fa21b0c landed · merged into main (2/2 tasks)");
    });

    it("reads a held run with its reason", () => {
        const ended = parseRunEnded("[arc] Run 3fa21b0c held: merge conflict in pkg/a.go.")!;
        expect(runEndedLine(RUN, ended)).toBe("Run 3fa21b0c held: merge conflict in pkg/a.go");
    });

    it("leaves out a part the message did not have", () => {
        expect(runEndedLine(RUN, parseRunEnded("[arc] Run 3fa21b0c held.")!)).toBe("Run 3fa21b0c held");
        expect(runEndedLine(RUN, parseRunEnded("[arc] Run 3fa21b0c landed: .")!)).toBe("Run 3fa21b0c landed");
    });
});

describe("runCardFolded", () => {
    const ended = parseRunEnded("[arc] Run 3fa21b0c held: merge conflict.")!;

    it("folds once the run is done", () => {
        expect(runCardFolded({ done: true })).toBe(true);
        expect(runCardFolded({ done: true }, null)).toBe(true);
    });

    it("folds when a run-ended message is paired, though a held run never reaches a done stage", () => {
        expect(runCardFolded({ done: false }, ended)).toBe(true);
    });

    it("stays open while the run goes on and no message came", () => {
        expect(runCardFolded({ done: false })).toBe(false);
        expect(runCardFolded({ done: false }, null)).toBe(false);
        expect(runCardFolded({ done: false }, undefined)).toBe(false);
    });
});
