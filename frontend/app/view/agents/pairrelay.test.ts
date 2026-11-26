// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    briefJudges,
    pairEnvelopeText,
    parsePairRelay,
    relayPartKey,
    relaySenderTab,
    relayWorkerTexts,
    type PairRelay,
} from "./pairrelay";

// the texts pkg/agentpair writes, through agentmsg.PairEnvelope (pkg/orchestrate/viewmod_fixtures_test.go)
const TESTDATA = fileURLToPath(new URL("../../../../claude/arc-view-mod/testdata/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${TESTDATA}${name}.txt`, "utf8");
const read = (name: string): PairRelay | null => parsePairRelay(pairEnvelopeText(fixture(name)) ?? "");

describe("pairEnvelopeText", () => {
    it("is the text under the pair's envelope line, null for any other prompt", () => {
        expect(pairEnvelopeText(fixture("pair-message"))).toMatch(/^From the judge "review", 14:02:/);
        expect(pairEnvelopeText(fixture("agent-message"))).toBeNull();
        expect(pairEnvelopeText("hello")).toBeNull();
    });
});

describe("parsePairRelay", () => {
    it("reads the working agent's first relay: the brief, then the judge's reply with its quote and fence", () => {
        const r = read("pair-relay-first");
        expect(r?.kind).toBe("relay");
        if (r?.kind !== "relay") return;
        expect(r.brief).toMatch(/^arcterm has paired you with a judge, "mit-thesis"\./);
        expect(r.brief).toContain("```arc-pair");
        expect(r.messages).toHaveLength(1);
        const m = r.messages[0]!;
        expect(m).toMatchObject({ from: "judge", name: "mit-thesis", time: "14:02", answers: null });
        expect(m.quote).toBe("then I lock the 0.8 threshold and run the full set");
        expect(m.text).toMatch(/^The pilot measures before the threshold is locked/);
        expect(m.text).toContain("```arc-judge\nreopen D2:");
        expect(m.raw).toMatch(/^From the judge "mit-thesis", 14:02:\n> then I lock/);
    });

    it("splits a batch: the judge's message, then the person's answer to A3", () => {
        const r = read("pair-relay-batch");
        if (r?.kind !== "relay") throw new Error(`not a relay: ${JSON.stringify(r)}`);
        expect(r.brief).toBeNull();
        expect(r.messages.map((m) => [m.from, m.name, m.time])).toEqual([
            ["judge", "mit-thesis", "14:09"],
            ["person", "", "14:10"],
        ]);
        expect(r.messages[0]!.text).toContain("- the labelled set in `data/labels-v2.csv`");
        expect(r.messages[0]!.text).toMatch(/O4 can close once the 31 rows are out\.$/);
        expect(r.messages[1]).toMatchObject({ answers: 3, text: "Keep 0.8.", quote: null });
    });

    it("reads the working agent's reply relayed to its judge", () => {
        const r = read("pair-relay-worker");
        if (r?.kind !== "relay") throw new Error("not a relay");
        expect(r.messages[0]).toMatchObject({ from: "worker", name: "thesis-draft", time: "14:05" });
        expect(r.messages[0]!.text).toContain("```arc-pair\nD1 Pilot on 40 transcripts");
    });

    it("folds the first relay of a pair that started from an older reply into one brief, which holds the note", () => {
        const r = read("pair-relay-first-older");
        if (r?.kind !== "relay") throw new Error(`not a relay: ${JSON.stringify(r)}`);
        expect(r.brief).toMatch(/^arcterm has paired you with a judge, "mit-thesis"\./);
        expect(r.brief).toContain("```arc-pair");
        expect(r.brief).toMatch(
            /\n\nThe judge is judging your reply from 13:40; weigh its judgement against what you have done since\.$/
        );
        expect(briefJudges(r.brief ?? "")).toEqual(["mit-thesis"]);
        // the note is not a message: the judge's reply is still the one card after it
        expect(r.messages).toHaveLength(1);
        expect(r.messages[0]).toMatchObject({ from: "judge", name: "mit-thesis", time: "14:02" });
    });

    it("reads a judge's brief: the working agent, its tab, and the reply it holds as that agent's message", () => {
        const r = read("pair-judge-brief");
        if (r?.kind !== "judgeBrief") throw new Error("not a judge brief");
        expect(r.workerName).toBe("thesis-draft");
        expect(r.workerTab).toBe("tab-worker");
        expect(r.brief).toMatch(/^You are the judge of another agent's work\./);
        expect(r.brief).not.toContain("--- the agent's latest reply ---");
        expect(r.reply).toMatchObject({ from: "worker", name: "thesis-draft", time: null });
        expect(r.reply?.quote).toMatch(/^reopen D2:/);
        expect(r.reply?.text).toContain("```arc-pair");
    });

    it("reads the brief of an older reply: the paragraph stays in the brief, the pasted reply is the working agent's message", () => {
        const r = read("pair-judge-brief-older");
        if (r?.kind !== "judgeBrief") throw new Error("not a judge brief");
        expect(r.workerName).toBe("thesis-draft");
        expect(r.workerTab).toBe("tab-worker");
        expect(r.brief).toMatch(/^You are the judge of another agent's work\./);
        expect(r.brief).toContain(
            "The agent has gone on since this reply. Its transcript is C:/Users/me/.claude/projects/"
        );
        expect(r.brief).toContain("9c1d7e52-4b0a-4f6e-8a31-2d5c7e90b4a1");
        expect(r.brief).not.toContain("--- the agent's reply ---");
        expect(r.brief).not.toContain("--- end of the reply ---");
        expect(r.reply).toMatchObject({ from: "worker", name: "thesis-draft", time: null });
        expect(r.reply?.quote).toMatch(/^reopen D2:/);
        expect(r.reply?.text).toContain("```arc-pair");
        // the same reply as the latest one's brief holds: only the delimiters and the paragraph differ
        const latest = read("pair-judge-brief");
        expect(latest?.kind === "judgeBrief" ? latest.reply?.text : null).toBe(r.reply?.text);
    });

    it("reads the end notice's commands", () => {
        expect(read("pair-ended")).toEqual({ kind: "ended", commands: ["task build:backend", "npm test"] });
    });

    it("keeps a line that looks like a head but follows no blank line in the message's text", () => {
        const text = 'From the judge "a", 10:00:\nfirst line\nFrom the judge "b", 10:01:\nstill a\'s';
        const r = parsePairRelay(text);
        if (r?.kind !== "relay") throw new Error("not a relay");
        expect(r.messages).toHaveLength(1);
        expect(r.messages[0]!.text).toContain('From the judge "b", 10:01:');
    });

    it("reads a head with no time, and is null for text it does not know", () => {
        const r = parsePairRelay('From the working agent "w":\nhi');
        expect(r).toMatchObject({ kind: "relay", messages: [{ from: "worker", name: "w", time: null, text: "hi" }] });
        expect(parsePairRelay("something else entirely")).toBeNull();
        expect(parsePairRelay('an opening that is no brief\n\nFrom the judge "a", 10:00:\nx')).toBeNull();
    });
});

describe("briefJudges", () => {
    it("names the judges of the brief's first sentence", () => {
        const r = read("pair-relay-first");
        expect(r?.kind === "relay" ? briefJudges(r.brief ?? "") : null).toEqual(["mit-thesis"]);
        expect(briefJudges('arcterm has paired you with judges, "a", "b" and "c". Every reply "x"')).toEqual([
            "a",
            "b",
            "c",
        ]);
    });
});

describe("relaySenderTab", () => {
    const pair = {
        worker: { name: "thesis-draft", tab: "tab-w" },
        judges: [
            { name: "mit-thesis", tab: "tab-j" },
            { name: "twin", tab: "tab-1" },
            { name: "twin", tab: "tab-2" },
        ],
    };
    it("finds the sender's tab in the live pair by name, none for the person or a name two judges share", () => {
        expect(relaySenderTab(pair, { from: "judge", name: "mit-thesis" })).toBe("tab-j");
        expect(relaySenderTab(pair, { from: "worker", name: "thesis-draft" })).toBe("tab-w");
        expect(relaySenderTab(pair, { from: "judge", name: "twin" })).toBeNull();
        expect(relaySenderTab(pair, { from: "person", name: "" })).toBeNull();
        expect(relaySenderTab(null, { from: "judge", name: "mit-thesis" })).toBeNull();
    });
});

describe("relayWorkerTexts", () => {
    it("is the working agent's texts a relay or a judge's brief holds, keyed as the card draws them", () => {
        const worker = read("pair-relay-worker")!;
        expect(relayWorkerTexts("sent:4", worker).map((t) => t.key)).toEqual([relayPartKey("sent:4", 0)]);
        expect(relayWorkerTexts("sent:0", read("pair-judge-brief")!)).toHaveLength(1);
        expect(relayWorkerTexts("sent:2", read("pair-relay-first")!)).toEqual([]);
    });
});
