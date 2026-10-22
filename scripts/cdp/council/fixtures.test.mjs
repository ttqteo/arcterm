// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council scenarios' fixtures (fixtures.mjs, rail-apps-*.json). The scenarios run against a live dev app that this
// task's checks do not start, so what can be checked here is: each JSON council fits the model the views read
// (councilmodel.ts), the helpers write and clean up what they should, and the page-side RpcApi stand-ins behave, run
// against a fake page the way setup-fixtures.test.mjs does.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    answerers,
    callSegments,
    canSummarize,
    costLine,
    expertStat,
    flattenThread,
    headerChip,
    matrixRows,
    outdatedCount,
    panel,
    rankedProposals,
    replyLabel,
    summarizeHold,
    summaryChip,
    threadTree,
    treeMeta,
} from "../../../frontend/app/view/agents/councilmodel";
import {
    COUNCIL_FIXTURES,
    COUNCIL_PROJECT,
    announceCouncil,
    arrangeCouncilProject,
    councilFixtureId,
    loadCouncilFixture,
    placeCouncil,
    rejectStub,
    resolveStub,
    rpcCalls,
    seedCouncil,
    stubRpc,
    teardownCouncilProject,
    unstubRpc,
    writeCouncil,
} from "./fixtures.mjs";

const roots = [];
function tempRoot() {
    const r = mkdtempSync(join(tmpdir(), "council-fixtures-test-"));
    roots.push(r);
    return r;
}
afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const placed = (name, now = NOW) => placeCouncil(loadCouncilFixture(name), name, "/work/fixture", now);

describe("the fixtures as records", () => {
    it("has the six the plan names, each under its own id", () => {
        expect(COUNCIL_FIXTURES).toEqual(["round1", "round2", "awaiting", "done", "failed", "notrun"]);
        for (const name of COUNCIL_FIXTURES) {
            expect(loadCouncilFixture(name).id).toBe(councilFixtureId(name));
        }
        expect(() => loadCouncilFixture("round9")).toThrow(/no council fixture/);
    });

    it.each(COUNCIL_FIXTURES)("%s is a record the store accepts and the model can read", (name) => {
        const c = loadCouncilFixture(name);
        expect(c.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
        // the coordinator is the one expert flagged, and last
        expect(c.experts.filter((e) => e.coordinator).map((e) => e.id)).toEqual(["coordinator"]);
        expect(c.experts.at(-1).id).toBe("coordinator");
        expect(new Set(c.experts.map((e) => e.id)).size).toBe(c.experts.length);
        const ids = new Set(panel(c).map((e) => e.id));
        const proposals = new Map((c.proposals ?? []).map((p) => [p.id, p]));
        expect(proposals.size).toBe((c.proposals ?? []).length);
        for (const p of proposals.values()) expect(ids.has(p.author)).toBe(true);
        // replies: unique ids, on a proposal of the council, a parent that came earlier on the same proposal
        const seen = new Map();
        for (const r of c.replies ?? []) {
            expect(seen.has(r.id)).toBe(false);
            expect(proposals.has(r.proposalid)).toBe(true);
            expect(ids.has(r.author) || r.author === "you").toBe(true);
            if (r.parentid) {
                const parent = seen.get(r.parentid);
                expect(parent?.proposalid).toBe(r.proposalid);
                expect(parent.ts).toBeLessThanOrEqual(r.ts);
            }
            if (r.stance) expect(["accept", "challenge", "oppose"]).toContain(r.stance);
            seen.set(r.id, r);
        }
        // every time on it is epoch milliseconds, from the first call on
        for (const ts of [...(c.proposals ?? []).map((p) => p.ts), ...(c.replies ?? []).map((r) => r.ts)]) {
            expect(ts).toBeGreaterThan(c.created);
            expect(ts).toBeLessThanOrEqual(c.updated);
        }
        for (const id of Object.keys(c.activity ?? {})) expect(ids.has(id)).toBe(true);
        for (const id of Object.keys(c.failed ?? {})) expect(c.experts.some((e) => e.id === id)).toBe(true);
        for (const id of Object.keys(c.stats ?? {})) expect(c.experts.some((e) => e.id === id)).toBe(true);
        expect(c.tokens).toBeGreaterThanOrEqual(0);
    });

    it("round1 is Running.dc.html: UX and New user done, RAM and Skeptic reading", () => {
        const c = placed("round1");
        expect(headerChip(c)).toBe("Step 1 of 3 · 2 of 4 experts done");
        expect(callSegments(c)).toEqual(["done", "done", "running", "running", ...Array(5).fill("pending")]);
        expect(expertStat(c, "ux")).toBe("1 min 52 s · 84k tokens");
        expect(expertStat(c, "ram")).toBe("3 min 10 s · 71k tokens");
        expect(expertStat(c, "newuser")).toBe("2 min 30 s · 66k tokens");
        expect(expertStat(c, "skeptic")).toBe("3 min 48 s · 92k tokens");
        expect(c.proposals.map((p) => p.id)).toEqual(["P1", "P2", "P4"]);
        expect(c.activity.ram.text).toBe("Grep \"IdleSleep\" in pkg/services");
        expect(treeMeta(c)).toEqual({ text: "Running", tone: "working" });
        expect(costLine(c, c.updated)).toBe("3:48 · 0 replies · 0.31M tokens");
        // the runner refuses a running council
        expect(canSummarize(c)).toBe(false);
        expect(summarizeHold(c)).toBe("Summarize unlocks after the experts' first ideas");
    });

    it("round2 is Main.dc.html: the P2 thread, Skeptic typing under UX's revision, the person's reply queued", () => {
        const c = placed("round2");
        expect(headerChip(c)).toBe("Step 2 of 3 · 2 replying");
        expect(costLine(c, c.updated)).toBe("7:20 · 19 replies · 0.55M tokens");
        expect(callSegments(c)).toEqual([...Array(6).fill("done"), "running", "running", "pending"]);
        expect(treeMeta(c)).toEqual({ text: "Running", tone: "working" });
        const counts = Object.fromEntries(c.proposals.map((p) => [p.id, c.replies.filter((r) => r.proposalid === p.id).length]));
        expect(counts).toEqual({ P1: 4, P2: 5, P3: 2, P4: 3, P5: 3, P6: 2 });
        // the ranking puts the withdrawn P6 last
        expect(rankedProposals(c).map((r) => r.proposal.id)).toEqual(["P5", "P1", "P3", "P2", "P4", "P6"]);
        expect(rankedProposals(c).find((r) => r.proposal.id === "P4").replying).toBe(1);
        expect(rankedProposals(c).find((r) => r.proposal.id === "P2").replying).toBe(1);
        // Skeptic's typing row hangs under UX's revision, two deep
        const flat = flattenThread(threadTree(c, "P2"));
        expect(flat.map((n) => `${n.depth}:${n.author}:${n.kind}`)).toEqual([
            "0:skeptic:reply",
            "1:ux:reply",
            "2:skeptic:typing",
            "0:ram:reply",
            "1:newuser:reply",
            "1:you:reply",
        ]);
        expect(flat.find((n) => n.kind === "typing").text).toBe("Skeptic is writing a reply…");
        const revision = c.replies.find((r) => r.revised);
        expect(revision.author).toBe("ux");
        // P4's typing row (RAM) is a root under the post
        expect(flattenThread(threadTree(c, "P4")).at(-1)).toMatchObject({ kind: "typing", author: "ram", depth: 0 });
        // the person's reply waits, and the experts it reaches are the ones the model works out
        const you = c.replies.find((r) => r.author === "you");
        expect(replyLabel(c, you)).not.toBe("");
        expect(answerers(c, you.proposalid, you.parentid, you.text).map((e) => e.id)).toEqual(you.to);
        // the weak chip on P2
        expect(c.proposals.find((p) => p.id === "P2").evidence.some((e) => e.weak)).toBe(true);
        // the runner refuses a running council: the synthesis comes by itself when round 2 ends
        expect(canSummarize(c)).toBe(false);
        expect(summarizeHold(c)).toBe("The summary comes by itself when the experts finish replying");
    });

    it("awaiting is Paused.dc.html: six proposals, four calls done, waiting on the person", () => {
        const c = placed("awaiting");
        expect(headerChip(c)).toBe("Waiting on you");
        expect(treeMeta(c)).toEqual({ text: "Waiting on you", tone: "asking" });
        expect(c.proposals.map((p) => p.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
        expect(c.pauseafterround1).toBe(true);
        expect(callSegments(c)).toEqual([...Array(4).fill("done"), ...Array(5).fill("pending")]);
        expect(canSummarize(c)).toBe(true);
        expect(c.summary).toBeUndefined();
    });

    it("awaiting stopped (the discussion scenario's variant) is a council at rest at round 1 that Summarize takes", () => {
        const c = placeCouncil(loadCouncilFixture("awaiting"), "awaiting", "/work/fixture", NOW);
        c.state = "stopped";
        expect(c.round).toBe(1);
        expect(headerChip(c)).toBe("Stopped");
        expect(c.summary).toBeUndefined();
        expect(canSummarize(c)).toBe(true);
    });

    it("done is Summary.dc.html: four directions, the matrix, a reply after the summary", () => {
        const c = placed("done");
        expect(headerChip(c)).toBe("Done");
        expect(summaryChip(c, NOW)).toBe("Done · 4 experts · 11 min · 0.86M tokens");
        expect(treeMeta(c)).toEqual({ text: "Done", tone: "muted" });
        expect(c.sessionid).toBeTruthy();
        expect(c.summary.directions.map((d) => d.rank)).toEqual([1, 2, 3, 4]);
        expect(c.summary.directions.every((d) => d.ideaid)).toBe(true);
        expect(c.summary.directions.map((d) => d.agreed)).toEqual([true, true, false, false]);
        expect(c.summary.directions[2].from).toEqual(["P2", "P3"]);
        const proposalIds = c.proposals.map((p) => p.id);
        for (const d of c.summary.directions) for (const id of d.from) expect(proposalIds).toContain(id);
        expect(outdatedCount(c)).toBe(1);
        expect(replyLabel(c, c.replies.find((r) => r.author === "you"))).toBe("Answered after the summary");
        expect(callSegments(c)).toEqual(Array(9).fill("done"));
        const rows = matrixRows(c);
        expect(rows.map((r) => r.proposal.id)).toEqual(["P5", "P1", "P2", "P3", "P4", "P6"]);
        expect(rows.map((r) => r.outcome)).toEqual([
            "Direction 1",
            "Direction 2",
            "Merged into direction 3",
            "Merged into direction 3",
            "Direction 4",
            "Withdrawn in round 2",
        ]);
        // the four experts of the panel, each with a stance on every proposal; its author's is `proposed`
        for (const row of rows) {
            expect(row.cells.map((cell) => cell.expert.id)).toEqual(["ux", "ram", "newuser", "skeptic"]);
            expect(row.cells.every((cell) => cell.stance !== "")).toBe(true);
            expect(row.cells.filter((cell) => cell.stance === "proposed").map((cell) => cell.expert.id)).toEqual([
                row.proposal.author,
            ]);
        }
        expect(rows[0].cells.map((cell) => cell.stance)).toEqual(["accept", "accept", "accept", "proposed"]);
        expect(rows[0].cells[3].reason).toBe("A cleared WebView2 profile loses them.");
        expect(c.proposals.find((p) => p.id === "P6").withdrawn).toBe(true);
        expect(canSummarize(c)).toBe(true);
    });

    it("failed has Skeptic failed in round 1 and the coordinator in round 3", () => {
        const c = placed("failed");
        expect(headerChip(c)).toBe("Failed");
        expect(treeMeta(c)).toEqual({ text: "Failed", tone: "error" });
        expect(c.error).toBeTruthy();
        expect(c.failed.skeptic.round).toBe(1);
        expect(c.failed.coordinator.round).toBe(3);
        expect(callSegments(c)).toEqual([...Array(6).fill("done"), "failed", "failed", "pending"]);
        // Skeptic sat out round 2: it has no reply
        expect(c.replies.some((r) => r.author === "skeptic")).toBe(false);
        expect(c.summary).toBeUndefined();
        // the synthesis failed, so Summarize (the coordinator's retry too) is the way on
        expect(canSummarize(c)).toBe(true);
    });

    it("notrun was saved without starting", () => {
        const c = placed("notrun");
        expect(headerChip(c)).toBe("Not run");
        expect(treeMeta(c)).toEqual({ text: "Not run", tone: "muted" });
        expect(c.proposals ?? []).toEqual([]);
        expect(c.started ?? 0).toBe(0);
        expect(canSummarize(c)).toBe(false);
        expect(summarizeHold(c)).toBe("This council has not run");
        expect(callSegments(c)).toEqual(Array(9).fill("pending"));
    });
});

describe("placeCouncil", () => {
    it("ends a running council at now, so its clock reads as authored whenever it is looked at", () => {
        expect(placed("round1").updated).toBe(NOW);
        expect(placed("round2").updated).toBe(NOW);
        expect(costLine(placed("round2"), NOW)).toBe("7:20 · 19 replies · 0.55M tokens");
    });

    it("moves every time by the same amount and leaves the fixture alone", () => {
        const raw = loadCouncilFixture("done");
        const before = JSON.stringify(raw);
        const c = placeCouncil(raw, "done", "/work/fixture", NOW);
        expect(JSON.stringify(raw)).toBe(before);
        expect(c.project).toBe("/work/fixture");
        const delta = c.created - raw.created;
        expect(delta).not.toBe(0);
        expect(c.updated - raw.updated).toBe(delta);
        expect(c.started - raw.started).toBe(delta);
        expect(c.summary.at - raw.summary.at).toBe(delta);
        expect(c.proposals.map((p, i) => p.ts - raw.proposals[i].ts)).toEqual(raw.proposals.map(() => delta));
        expect(c.replies.map((r, i) => r.ts - raw.replies[i].ts)).toEqual(raw.replies.map(() => delta));
        // a council that was never started stays unstarted
        expect(placed("notrun").started).toBeUndefined();
    });

    it("sorts the tree newest created first: round1, round2, awaiting, failed, done, notrun", () => {
        const order = [...COUNCIL_FIXTURES].sort((a, b) => placed(b).created - placed(a).created);
        expect(order).toEqual(["round1", "round2", "awaiting", "failed", "done", "notrun"]);
        // the four Task 13 lists keep the plan's order: Running, Waiting on you, Done, Not run
        const four = ["notrun", "done", "awaiting", "round2"].sort((a, b) => placed(b).created - placed(a).created);
        expect(four.map((n) => treeMeta(placed(n)).text)).toEqual(["Running", "Waiting on you", "Done", "Not run"]);
    });
});

// a fake dev app, as setup-fixtures.test.mjs has one: the scripts the helpers send are evaluated against a fake window,
// performance and RpcApi, with the dynamic import swapped for the fake module
function fakePage() {
    class Api {
        CouncilStartCommand() {
            return Promise.resolve("real start");
        }
        CouncilSummarizeCommand() {
            return Promise.resolve("real summarize");
        }
        CouncilSuggestCommand() {
            return Promise.resolve("real suggest");
        }
    }
    const api = new Api();
    const win = {};
    const resources = [{ name: "http://localhost:5174/@fs/repo/frontend/app/store/wshclientapi.ts?t=1" }];
    const h = {
        async ev(expr) {
            const fn = new Function("window", "performance", "__imp", `return ${expr.replace(/\bimport\(/g, "__imp(")}`);
            return fn(win, { getEntriesByType: () => resources }, async () => ({ RpcApi: api }));
        },
    };
    return { h, api, win, resources };
}

describe("stubRpc", () => {
    it("resolves with a copy of the canned value and records each call", async () => {
        const { h, api } = fakePage();
        await stubRpc(h, ["CouncilStartCommand"], { CouncilStartCommand: { value: { id: "c1", experts: [] } } });
        const first = await api.CouncilStartCommand(null, { feature: "Rail apps", files: ["a.ts"] });
        first.experts.push("changed");
        expect(await api.CouncilStartCommand(null, { feature: "second" })).toEqual({ id: "c1", experts: [] });
        expect(await rpcCalls(h)).toEqual([
            { name: "CouncilStartCommand", data: { feature: "Rail apps", files: ["a.ts"] } },
            { name: "CouncilStartCommand", data: { feature: "second" } },
        ]);
        expect(await rpcCalls(h, "CouncilSuggestCommand")).toEqual([]);
        // no canned value: null; a command with no data records null
        await stubRpc(h, ["CouncilSummarizeCommand"]);
        expect(await api.CouncilSummarizeCommand(null)).toBeNull();
        expect((await rpcCalls(h, "CouncilSummarizeCommand"))[0].data).toBeNull();
    });

    it("holds a pending call open until resolveStub or rejectStub settles it", async () => {
        const { h, api } = fakePage();
        await stubRpc(h, ["CouncilSuggestCommand", "CouncilSummarizeCommand"], {
            CouncilSuggestCommand: { pending: true },
            CouncilSummarizeCommand: { pending: true },
        });
        let settled = "no";
        const suggest = api.CouncilSuggestCommand(null, { question: "q" }).then(
            (v) => (settled = v),
            (e) => (settled = e.message)
        );
        const summarize = api.CouncilSummarizeCommand(null, { id: "c1" });
        await Promise.resolve();
        expect(settled).toBe("no");
        expect(await resolveStub(h, "CouncilSuggestCommand", { files: ["a.ts"], roles: [] })).toBe(1);
        await suggest;
        expect(settled).toEqual({ files: ["a.ts"], roles: [] });
        // nothing is waiting on it any more; the other command still is
        expect(await resolveStub(h, "CouncilSuggestCommand", {})).toBe(0);
        expect(await rejectStub(h, "CouncilSummarizeCommand", "Not run: skipped")).toBe(1);
        await expect(summarize).rejects.toThrow("Not run: skipped");
    });

    it("rejects with the message when asked to", async () => {
        const { h, api } = fakePage();
        await stubRpc(h, ["CouncilSuggestCommand"], { CouncilSuggestCommand: { reject: "no model reply" } });
        await expect(api.CouncilSuggestCommand(null, { question: "q" })).rejects.toThrow("no model reply");
        expect((await rpcCalls(h)).length).toBe(1);
    });

    it("refuses a name that is not an RpcApi command, and replaces none of the others", async () => {
        const { h, api } = fakePage();
        await expect(stubRpc(h, ["CouncilStartCommand", "CouncilNopeCommand"])).rejects.toThrow(/RpcApi\.CouncilNopeCommand/);
        expect(Object.prototype.hasOwnProperty.call(api, "CouncilStartCommand")).toBe(false);
        expect(await api.CouncilStartCommand()).toBe("real start");
    });

    it("refuses when the page has not loaded the api module", async () => {
        const { h, resources } = fakePage();
        resources.length = 0;
        await expect(stubRpc(h, ["CouncilStartCommand"])).rejects.toThrow(/wshclientapi/);
    });

    it("puts the original back, however many times a name was stubbed, and is safe to call twice", async () => {
        const { h, api, win } = fakePage();
        await stubRpc(h, ["CouncilStartCommand"], { CouncilStartCommand: { value: 1 } });
        await stubRpc(h, ["CouncilStartCommand", "CouncilSummarizeCommand"], { CouncilStartCommand: { value: 2 } });
        expect(await api.CouncilStartCommand()).toBe(2);
        expect(await unstubRpc(h)).toBe("restored");
        expect(Object.prototype.hasOwnProperty.call(api, "CouncilStartCommand")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(api, "CouncilSummarizeCommand")).toBe(false);
        expect(await api.CouncilStartCommand()).toBe("real start");
        expect(await api.CouncilSummarizeCommand()).toBe("real summarize");
        expect(win.__arcCouncilStub).toBeUndefined();
        expect(await unstubRpc(h)).toBe("absent");
        expect(await rpcCalls(h)).toEqual([]);
    });

    it("puts back an own-property original rather than deleting it", async () => {
        const { h, api } = fakePage();
        const own = () => Promise.resolve("own");
        api.CouncilStartCommand = own;
        await stubRpc(h, ["CouncilStartCommand"], { CouncilStartCommand: { value: 1 } });
        await unstubRpc(h);
        expect(api.CouncilStartCommand).toBe(own);
    });
});

// a fake harness and the scenarios.mjs helpers, to follow the arrange and the teardown without a dev app
function fakeApp(dataDir) {
    const calls = [];
    const events = [];
    const projects = []; // what createproject registered: the channels getchannels answers with
    const h = {
        async rpc(command, data) {
            calls.push([command, data]);
            if (command === "createproject") projects.push(data);
            if (command === "waveinfo") return { datadir: dataDir };
            if (command === "workspacelist") return [{ workspacedata: { oid: "ws1", tabids: ["boot"] } }];
            if (command === "getchannels") {
                return { channels: projects.map((d) => ({ oid: `ch-${d.name}`, projectpath: d.path.toUpperCase() })) };
            }
            return null;
        },
        async ev(expr) {
            if (expr.includes("routeId")) return "tab:boot";
            if (expr.includes("__arcCouncilStub")) return "absent";
            throw new Error(`unexpected evaluate: ${expr}`);
        },
    };
    const fx = {
        waitForProjectInConfig: async (_h, name) => void events.push(["config", name]),
        openRailTerminal: async (_h, ctx, project) => {
            events.push(["terminal", project]);
            ctx.terminals.push({ tabId: `tab-${project}`, blockId: `block-${project}`, project });
        },
        polishReload: async () => void events.push(["reload"]),
        waveService: async (_h, service, method, args) => void events.push([service, method, args]),
    };
    return { h, fx, calls, events };
}

describe("arrangeCouncilProject and teardownCouncilProject", () => {
    it("registers a temp git repo with a terminal in it, reloads, and removes it all again", async () => {
        const dataDir = tempRoot();
        mkdirSync(join(dataDir, "councils"));
        writeFileSync(join(dataDir, "councils", "fx-council-old.json"), "{}");
        writeFileSync(join(dataDir, "councils", "mine.json"), "{}");
        const { h, fx, calls, events } = fakeApp(dataDir);
        const ctx = await arrangeCouncilProject(h, fx, { extraProjects: ["council-fixture-empty"] });

        expect(ctx.project).toBe(COUNCIL_PROJECT);
        expect(ctx.dataDir).toBe(dataDir);
        expect(ctx.workspaceId).toBe("ws1");
        expect(ctx.projects.map((p) => p.name)).toEqual([COUNCIL_PROJECT, "council-fixture-empty"]);
        expect(existsSync(join(ctx.repo, ".git"))).toBe(true);
        expect(readFileSync(join(ctx.repo, "README.md"), "utf8")).toContain("council fixture");
        const created = calls.filter(([c]) => c === "createproject").map(([, d]) => d);
        expect(created).toEqual(ctx.projects.map((p) => ({ name: p.name, path: p.repo })));
        expect(ctx.terminals.map((t) => t.project)).toEqual([COUNCIL_PROJECT, "council-fixture-empty"]);
        expect(events.at(-1)).toEqual(["reload"]);
        // a fixture council an earlier run left is gone, the person's own is not
        expect(readdirSync(join(dataDir, "councils"))).toEqual(["mine.json"]);

        const id = writeCouncil(ctx, "round2", { now: NOW });
        const idTwo = writeCouncil(ctx, "done", { now: NOW, id: "fx-council-done-two", edit: (c) => void (c.feature = "Second") });
        expect(id).toBe("fx-council-round2");
        expect(idTwo).toBe("fx-council-done-two");
        const names = readdirSync(join(dataDir, "councils")).sort();
        expect(names).toEqual(["fx-council-done-two.json", "fx-council-round2.json", "mine.json"]);
        const written = JSON.parse(readFileSync(join(dataDir, "councils", `${id}.json`), "utf8"));
        expect(written.project).toBe(ctx.repo);
        expect(written.updated).toBe(NOW);
        expect(JSON.parse(readFileSync(join(dataDir, "councils", `${idTwo}.json`), "utf8")).feature).toBe("Second");
        await announceCouncil(h, ctx, id);
        expect(calls.at(-1)).toEqual(["eventpublish", { event: "council:changed", data: { id, project: ctx.repo } }]);
        await seedCouncil(h, ctx, "notrun", { now: NOW });
        expect(calls.at(-1)[1].data).toEqual({ id: "fx-council-notrun", project: ctx.repo });

        events.length = 0;
        calls.length = 0;
        await teardownCouncilProject(h, ctx);
        expect(readdirSync(join(dataDir, "councils"))).toEqual(["mine.json"]);
        expect(events.filter(([s, m]) => s === "workspace" && m === "CloseTab").map(([, , a]) => a)).toEqual([
            ["ws1", `tab-${COUNCIL_PROJECT}`, false],
            ["ws1", "tab-council-fixture-empty", false],
        ]);
        expect(calls.filter(([c]) => c === "deleteproject").map(([, d]) => d.name)).toEqual([
            COUNCIL_PROJECT,
            "council-fixture-empty",
        ]);
        // the channel createproject made goes with each project, however the path is cased
        expect(calls.filter(([c]) => c === "deletechannel").map(([, d]) => d.channelid)).toEqual([
            `ch-${COUNCIL_PROJECT}`,
            "ch-council-fixture-empty",
        ]);
        expect(existsSync(ctx.base)).toBe(false);
        expect(events.at(-1)).toEqual(["reload"]);
    });

    it("tears down what it made when a step of the arrange throws", async () => {
        const dataDir = tempRoot();
        const { h, fx, calls, events } = fakeApp(dataDir);
        const rpc = h.rpc;
        h.rpc = async (command, data) => {
            if (command === "createproject") {
                calls.push([command, data]);
                throw new Error("createproject refused");
            }
            return rpc(command, data);
        };
        await expect(arrangeCouncilProject(h, fx)).rejects.toThrow("createproject refused");
        expect(events.at(-1)).toEqual(["reload"]);
    });

    it("keeps going when one teardown step fails", async () => {
        const dataDir = tempRoot();
        const { h, fx, calls } = fakeApp(dataDir);
        const ctx = await arrangeCouncilProject(h, fx);
        fx.waveService = async () => {
            throw new Error("tab already closed");
        };
        const quiet = console.error;
        console.error = () => {};
        try {
            await teardownCouncilProject(h, ctx);
        } finally {
            console.error = quiet;
        }
        expect(calls.some(([c]) => c === "deleteproject")).toBe(true);
        expect(existsSync(ctx.base)).toBe(false);
    });
});
