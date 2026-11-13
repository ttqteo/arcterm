// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { councilStartAnchor } from "./chatcouncil";

const ID = "9f3a1c04d27b58e6";
const RUNNING = "0a1b2c3d4e5f6071";

// the lines cmd/wsh/cmd/wshcmd-council.go prints (councilStartedLine, councilQueuedLine, councilNotRunText)
const STARTED = `council ${ID} started: Scheduled tasks in one place · review · UI feature panel · 4 experts · ≈ 14 calls · ~0.9M tokens\n`;
const QUEUED = `Queued after ${RUNNING} (Paper §5 draft) · council ${ID} starts by itself when it ends\n`;
const REASON =
    "Not run: the person chose not to start a council now (token budget, about 0.9M tokens). Do not retry a spawn this turn; do the work in this session or ask the person, and say in your report that the spawn was refused.";
const NOT_RUN = `${REASON}\ncouncil ${ID} saved as not run; Start council in the app runs it\n`;

describe("councilStartAnchor", () => {
    const cmd = 'wsh council start --feature "Scheduled tasks" --mode review --files a.ts';

    it("reads the started line of a council that began, and keeps its estimate as text", () => {
        expect(councilStartAnchor(cmd, STARTED)).toEqual({
            kind: "started",
            councilId: ID,
            estimate: "≈ 14 calls · ~0.9M tokens",
        });
    });

    it("keeps the estimate in each shape the token count takes", () => {
        const line = (tokens: string, seats = "4 experts") =>
            `council ${ID} started: Idea · brainstorm · product-ideas · ${seats} · ≈ 9 calls · ~${tokens} tokens\n`;
        expect(councilStartAnchor(cmd, line("850"))).toMatchObject({ estimate: "≈ 9 calls · ~850 tokens" });
        expect(councilStartAnchor(cmd, line("42k"))).toMatchObject({ estimate: "≈ 9 calls · ~42k tokens" });
        expect(councilStartAnchor(cmd, line("13.2M", "2 chats + Bug hunter"))).toMatchObject({
            estimate: "≈ 9 calls · ~13.2M tokens",
        });
    });

    it("reads the estimate at the end of the line, not one the feature quotes", () => {
        const out = `council ${ID} started: Is ≈ 3 calls · ~1M tokens enough? · review · ui-feature · 4 experts · ≈ 14 calls · ~0.9M tokens\n`;
        expect(councilStartAnchor(cmd, out)).toEqual({
            kind: "started",
            councilId: ID,
            estimate: "≈ 14 calls · ~0.9M tokens",
        });
    });

    it("names a started council even when its line holds no estimate", () => {
        const anchor = councilStartAnchor(
            cmd,
            `council ${ID} started: Idea · brainstorm · product-ideas · 4 experts\n`
        );
        expect(anchor).toEqual({ kind: "started", councilId: ID });
        expect(anchor).not.toHaveProperty("estimate");
    });

    it("reads a queued line, with the council it waits for named or not", () => {
        expect(councilStartAnchor(cmd, QUEUED)).toEqual({ kind: "queued", councilId: ID });
        expect(
            councilStartAnchor(cmd, `Queued after ${RUNNING} · council ${ID} starts by itself when it ends\n`)
        ).toEqual({ kind: "queued", councilId: ID });
    });

    it("takes the new council's own id from a queued line, not the running one's", () => {
        const anchor = councilStartAnchor(cmd, QUEUED);
        expect(anchor?.councilId).toBe(ID);
        expect(anchor?.councilId).not.toBe(RUNNING);
    });

    it("reads a refusal: the council saved as not run, with the Not run line kept as its reason", () => {
        expect(councilStartAnchor(cmd, NOT_RUN)).toEqual({ kind: "notrun", councilId: ID, reason: REASON });
    });

    it("keeps the reason when the Token burn hold line is printed before it", () => {
        const hold = "Token burn: waiting for your answer on arcterm's card before the agent may start a council.\n";
        expect(councilStartAnchor(cmd, hold + NOT_RUN)).toEqual({ kind: "notrun", councilId: ID, reason: REASON });
    });

    it("names a council saved as not run even when the reason line is missing", () => {
        expect(councilStartAnchor(cmd, `council ${ID} saved as not run; Start council in the app runs it\n`)).toEqual({
            kind: "notrun",
            councilId: ID,
            reason: "Not run",
        });
    });

    it("reads CRLF output", () => {
        expect(councilStartAnchor(cmd, STARTED.replace(/\n/g, "\r\n"))).toMatchObject({
            kind: "started",
            councilId: ID,
        });
        expect(councilStartAnchor(cmd, QUEUED.replace(/\n/g, "\r\n"))).toEqual({ kind: "queued", councilId: ID });
        expect(councilStartAnchor(cmd, NOT_RUN.replace(/\n/g, "\r\n"))).toEqual({
            kind: "notrun",
            councilId: ID,
            reason: REASON,
        });
    });

    it("finds wsh through a path, an .exe, quotes, a prefix command, a chain and a substitution", () => {
        const anchor = { kind: "started", councilId: ID, estimate: "≈ 14 calls · ~0.9M tokens" };
        expect(councilStartAnchor("~/.arc/bin/wsh council start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor('"$HOME/.arc/bin/wsh" council start --feature x', STARTED)).toEqual(anchor);
        expect(councilStartAnchor("C:\\Users\\me\\.arc\\bin\\wsh.exe council start --feature x", STARTED)).toEqual(
            anchor
        );
        expect(councilStartAnchor('"C:/Program Files/arc/wsh.exe" council start --feature x', STARTED)).toEqual(anchor);
        expect(councilStartAnchor("cd repo && wsh council start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("  wsh   council   start --feature x", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("out=$(wsh council start --feature x)", STARTED)).toEqual(anchor);
        expect(councilStartAnchor("wsh council start", STARTED)).toEqual(anchor);
    });

    it("takes the first council when the output names several", () => {
        const other = "1111222233334444";
        const out = `${STARTED}council ${other} started: Other · review · ui-feature · 4 experts · ≈ 5 calls · ~0.3M tokens\n`;
        expect(councilStartAnchor("wsh council start --feature a; wsh council start --feature b", out)).toMatchObject({
            kind: "started",
            councilId: ID,
        });
        // the earlier line wins whichever kind it is
        expect(councilStartAnchor(cmd, `${QUEUED}${STARTED}`)).toEqual({ kind: "queued", councilId: ID });
        expect(councilStartAnchor(cmd, `${NOT_RUN}${QUEUED}`)).toMatchObject({ kind: "notrun" });
    });

    it("keeps the line when other output comes first or follows", () => {
        const out = `reading the council roles…\n${STARTED}read it back with: wsh council wait ${ID}\n`;
        expect(councilStartAnchor(cmd, out)).toMatchObject({ kind: "started", councilId: ID });
    });

    it("is null for a command that is not wsh council start", () => {
        expect(councilStartAnchor("wsh council wait " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council estimate --files a.ts", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council show " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council start-now " + ID, STARTED)).toBeNull();
        expect(councilStartAnchor("wsh council startx", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh runs start --plan p.md", STARTED)).toBeNull();
        expect(councilStartAnchor("wsh agents start", STARTED)).toBeNull();
        expect(councilStartAnchor("git status", STARTED)).toBeNull();
        expect(councilStartAnchor("echo council start", STARTED)).toBeNull();
        expect(councilStartAnchor("", STARTED)).toBeNull();
    });

    it("is null when the output carries none of the three lines", () => {
        expect(councilStartAnchor(cmd, "")).toBeNull();
        expect(councilStartAnchor(cmd, "error: --feature is required: name what the council looks at\n")).toBeNull();
        expect(councilStartAnchor("wsh council start --help", "Usage:\n  wsh council start [flags]\n")).toBeNull();
        expect(councilStartAnchor(cmd, `council ${ID} is waiting on you: it paused after round 1.\n`)).toBeNull();
    });

    it("is null when the output only quotes an id or half a line", () => {
        expect(councilStartAnchor(cmd, `see: wsh council wait ${ID}\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `Queued after ${RUNNING} (Paper §5 draft)\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `error: the earlier council ${ID} started: yesterday\n`)).toBeNull();
        expect(councilStartAnchor(cmd, `the earlier council ${ID} saved as not run\n`)).toBeNull();
    });
});
