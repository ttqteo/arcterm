# Chat: a pair's relayed reply drawn as the other agent's turn — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** In Chat, a prompt arcterm's pair relays (a judge's or the working agent's reply, the person's words, the
brief, the end notice) draws as the sender's turn, whole, with its `arc-judge` / `arc-pair` fence as Chat's card,
instead of a six-line mono "message · from arcterm pair" card.

**Architecture:** Go writes the five pair texts as fixtures from the real functions. A pure parser
(`pairrelay.ts`) reads the envelope's text into a relay (brief + messages), a judge's brief, or the end notice.
`chatmodel.ts` hangs that on the `sent` item as `relay`, `placePairLists` reads the working agent's relayed lists, and a
thin `chatpairrelay.tsx` draws it.

**Tech Stack:** Go (fixtures), TypeScript + vitest (parser, model), React 19 + motion/react + Tailwind 4 (view), CDP
scenario (`scripts/cdp`).

**Spec:** `docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md`
**Prototype:** D:/work/arcterm/.superpowers/design/chat-pair-relay/project
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/agentpair`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-pair-relay`

Notes for every task:

- Windows: run Go tests with `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` in front, through Bash.
- Lint and format only the files you touched: `npx eslint <paths>`, `npx prettier --check <paths>` (never on
  `scripts/*.mjs`, which are hand-formatted 4-space files).
- Commits carry no attribution trailer. Commit with a pathspec: `git commit -m "<msg>" -- <paths>`.

---

### Task 1: Go writes the pair's texts as fixtures

**Depends on:** none
**Files:** `pkg/agentpair/hold.go`, `pkg/orchestrate/viewmod_fixtures_test.go`, `claude/arc-view-mod/testdata/pair-relay-first.txt`, `claude/arc-view-mod/testdata/pair-relay-batch.txt`, `claude/arc-view-mod/testdata/pair-relay-worker.txt`, `claude/arc-view-mod/testdata/pair-judge-brief.txt`, `claude/arc-view-mod/testdata/pair-ended.txt`, `claude/arc-view-mod/hooks/prompt-core.test.ts`

**Step 1: Move the end notice into an exported function, word for word**

In `pkg/agentpair/hold.go`, add above `Unpair`:

```go
// EndedNotice is what the working agent is told when its pair ends: which held commands it may run now. Chat reads it
// back (frontend/app/view/agents/pairrelay.ts), so its wording is a fixture (pkg/orchestrate/viewmod_fixtures_test.go).
func EndedNotice(mayRun []string) string {
	var b strings.Builder
	b.WriteString("The pair has ended: no judge holds your heavy commands any more.\n")
	for _, cmd := range mayRun {
		fmt.Fprintf(&b, "- `%s` was held: you may run it now.\n", cmd)
	}
	return strings.TrimRight(b.String(), "\n")
}
```

and in `Unpair` replace the builder and its loop with:

```go
	if err := m.Link.Send(ctx, worker, agentmsg.PairEnvelope(EndedNotice(mayRun))); err != nil {
```

**Step 2: Add the fixtures**

In `pkg/orchestrate/viewmod_fixtures_test.go`, add `"time"` and `"github.com/wavetermdev/waveterm/pkg/agentpair"` to the
imports, and after the `pair-message` line add:

```go
	// a pair's texts (pkg/agentpair): Chat reads them back as the sender's turn (frontend/app/view/agents/pairrelay.ts).
	// relayHead formats a time in the local zone, so the times are made in it and read back the same anywhere
	at := func(h, m int) int64 { return time.Date(2026, 11, 26, h, m, 0, 0, time.Local).UnixMilli() }
	judgeReply := "> then I lock the 0.8 threshold and run the full set\n" +
		"The pilot measures before the threshold is locked: swap the two steps.\n\n" +
		"```arc-judge\nreopen D2: the threshold is picked after the pilot measures, so it is tuned to the pilot\n" +
		"new: the pilot cases overlap the test split\n```"
	workerReply := "> reopen D2: the threshold is picked after the pilot measures, so it is tuned to the pilot\n" +
		"Swapped: O2 now locks the threshold from the labelled set before the pilot runs.\n\n" +
		"```arc-pair\nD1 Pilot on 40 transcripts\nO2 Lock the threshold from the labelled set — before the pilot runs\n" +
		"A3 Keep the 0.8 threshold? [Yes | No, change it]\n```"
	checkViewModFixture(t, "pair-relay-first", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromJudge, Name: "mit-thesis", Tab: "tab-judge", Ts: at(14, 2), Text: judgeReply},
	}, agentpair.WorkerBrief([]string{"mit-thesis"}))))
	checkViewModFixture(t, "pair-relay-batch", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromJudge, Name: "mit-thesis", Tab: "tab-judge", Ts: at(14, 9), Text: "> O2 now locks the threshold from the earlier labelled set\n" +
			"Agreed on the order. Two things before D2 can close:\n\n" +
			"- the labelled set in `data/labels-v2.csv` has 212 rows, 31 of them from the pilot's own sources\n" +
			"- section 4.2 still reads \"tuned on the pilot\"\n\n" +
			"O4 can close once the 31 rows are out."},
		{From: agentpair.FromPerson, Ts: at(14, 10), Text: "Answer to A3: Keep 0.8."},
	}, "")))
	checkViewModFixture(t, "pair-relay-worker", agentmsg.PairEnvelope(agentpair.RelayPrompt([]agentpair.RelayItem{
		{From: agentpair.FromWorker, Name: "thesis-draft", Tab: "tab-worker", Ts: at(14, 5), Text: workerReply},
	}, "")))
	checkViewModFixture(t, "pair-judge-brief", agentmsg.PairEnvelope(agentpair.JudgeBrief(agentpair.JudgeBriefInput{
		WorkerName: "thesis-draft", WorkerTab: "tab-worker", Reply: workerReply,
		Docs: []string{"docs/superpowers/plans/2026-11-26-pilot.md"},
	})))
	checkViewModFixture(t, "pair-ended", agentmsg.PairEnvelope(agentpair.EndedNotice([]string{"task build:backend", "npm test"})))
```

**Step 3: Run the fixture test to see it fail**

On Windows every `go test` below takes the prefix `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu"` (AGENTS.md),
run through Bash.

Run: `go test ./pkg/orchestrate -run '^TestViewModFixtures$'`
Expected: FAIL, the five new `.txt` files missing.

**Step 4: Write the files and run again**

Run: `ARC_UPDATE_VIEWMOD_FIXTURES=1 go test ./pkg/orchestrate -run '^TestViewModFixtures$'`, then
`go test ./pkg/orchestrate -run '^TestViewModFixtures$'` and `go test ./pkg/agentpair -run 'Unpair'`.
Expected: PASS. Open `claude/arc-view-mod/testdata/pair-relay-first.txt` and check it reads: the envelope line, the
brief, a blank line, `From the judge "mit-thesis", 14:02:`, the judge's reply. `git status` must show only the five new
files under `testdata/` (no other fixture changed).

**Step 5: The view mod's fixture list reads the new files**

`claude/arc-view-mod/hooks/prompt-core.test.ts` asserts that every `.txt` in `testdata/` is read by one reader ("nothing
in testdata is left unread"), so the five new files fail it until they are listed. All five are pair envelopes, which
`parseStreamPrompt` reads through `PAIR_MESSAGE` as it reads `pair-message`. Add them to `STREAM_FIXTURES` after
`"pair-message"`:

```ts
    "pair-relay-first",
    "pair-relay-batch",
    "pair-relay-worker",
    "pair-judge-brief",
    "pair-ended",
```

Run: `npx vitest run claude/arc-view-mod/hooks/prompt-core.test.ts`
Expected: PASS. If one of the five comes back `null` from `parseStreamPrompt`, stop and report it: the envelope Go
writes no longer matches `PAIR_MESSAGE`, and that is not this task's to change.

**Step 6: Commit**

```bash
git add claude/arc-view-mod/testdata/pair-relay-first.txt claude/arc-view-mod/testdata/pair-relay-batch.txt claude/arc-view-mod/testdata/pair-relay-worker.txt claude/arc-view-mod/testdata/pair-judge-brief.txt claude/arc-view-mod/testdata/pair-ended.txt
git commit -m "test(pair): write the pair's relay, briefs and end notice as view fixtures" -- pkg/agentpair/hold.go pkg/orchestrate/viewmod_fixtures_test.go claude/arc-view-mod/testdata/pair-relay-first.txt claude/arc-view-mod/testdata/pair-relay-batch.txt claude/arc-view-mod/testdata/pair-relay-worker.txt claude/arc-view-mod/testdata/pair-judge-brief.txt claude/arc-view-mod/testdata/pair-ended.txt claude/arc-view-mod/hooks/prompt-core.test.ts
```

---

### Task 2: The pure parser for what a pair relays

**Depends on:** Task 1 (its tests read the fixtures Task 1 writes)
**Files:** `frontend/app/view/agents/pairrelay.ts`, `frontend/app/view/agents/pairrelay.test.ts`

**Step 1: Write the failing tests**

`frontend/app/view/agents/pairrelay.test.ts`:

```ts
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
        expect(briefJudges('arcterm has paired you with judges, "a", "b" and "c". Every reply "x"')).toEqual(["a", "b", "c"]);
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
```

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/pairrelay.test.ts`
Expected: FAIL, `./pairrelay` not found.

**Step 3: Write the parser**

`frontend/app/view/agents/pairrelay.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What arcterm's pair relays between a working agent and its judge, read back for Chat
// (docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md). The texts are pkg/agentpair's, each inside
// agentmsg.PairEnvelope: RelayPrompt's parts under relayHead lines and WorkerBrief's opening (brief.go), JudgeBrief, and
// EndedNotice (hold.go). Go writes them as fixtures (pkg/orchestrate/viewmod_fixtures_test.go) and pairrelay.test.ts
// parses those, so a wording change there fails here.

export type RelayFrom = "judge" | "worker" | "person" | "arcterm";

/** One relayed message: who sent it (`name` is "" for the person and arcterm), its `15:04` time, the line it answers
 *  (`> line`, lifted out), the A item a person's answer names, its text without those, and the part as relayed. */
export interface RelayMessage {
    from: RelayFrom;
    name: string;
    time: string | null;
    quote: string | null;
    answers: number | null;
    text: string;
    raw: string;
}

export type PairRelay =
    | { kind: "relay"; brief: string | null; messages: RelayMessage[] }
    | { kind: "judgeBrief"; workerName: string; workerTab: string; brief: string; reply: RelayMessage | null }
    | { kind: "ended"; commands: string[] };

const ENVELOPE = /^\[Message from agent "arcterm pair" \(relayed by arcterm's pair[^\n]*\]\n([\s\S]*)$/;
// relayHead's four shapes; a name is Go's %q, so a quote in it is escaped
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
const HEAD = new RegExp(
    String.raw`^From (?:the judge ${QUOTED}|the working agent ${QUOTED}|(the person) \(typed in arcterm, not an agent\)|(arcterm))(?:, (\d{2}:\d{2}))?:$`
);
const WORKER_BRIEF = "arcterm has paired you with ";
const JUDGE_BRIEF = new RegExp(
    String.raw`^You are the judge of another agent's work\. arcterm pairs the two of you: the agent is ${QUOTED} \(tab (\S+)\)\.`
);
const REPLY = /\n?--- the agent's latest reply ---\n([\s\S]*?)\n--- end of the reply ---\n?/;
const ENDED = "The pair has ended:";
const HELD = /^- `(.+)` was held: you may run it now\.$/;
const ANSWER = /^Answer to A(\d+): /;

function unquote(s: string): string {
    return s.replace(/\\(["\\])/g, "$1");
}

/** The text under a pair's envelope line, or null for any other prompt. */
export function pairEnvelopeText(prompt: string): string | null {
    const m = ENVELOPE.exec(prompt.trim());
    return m ? (m[1] ?? "") : null;
}

/** Pure: what a pair's prompt holds, or null when it is none of its three texts (the caller shows it whole). */
export function parsePairRelay(text: string): PairRelay | null {
    const t = text.trim();
    const judge = JUDGE_BRIEF.exec(t);
    if (judge != null) {
        const workerName = unquote(judge[1] ?? "");
        const reply = REPLY.exec(t);
        const said = reply != null ? (reply[1] ?? "").trim() : "";
        return {
            kind: "judgeBrief",
            workerName,
            workerTab: judge[2] ?? "",
            brief: (reply != null ? t.replace(reply[0], "\n") : t).trim(),
            reply: said !== "" ? { from: "worker", name: workerName, time: null, raw: said, ...bodyOf("worker", said) } : null,
        };
    }
    if (t.startsWith(ENDED)) {
        return { kind: "ended", commands: t.split("\n").flatMap((l) => HELD.exec(l.trim())?.slice(1, 2) ?? []) };
    }
    return relayOf(t);
}

// RelayPrompt joins its parts with a blank line, so a head opens the text or follows a blank line; a line shaped like a
// head anywhere else is a message's own text
function relayOf(t: string): PairRelay | null {
    const lines = t.split("\n");
    const heads = lines.flatMap((line, i) => ((i === 0 || lines[i - 1]?.trim() === "") && HEAD.test(line) ? [i] : []));
    if (heads.length === 0) {
        return null;
    }
    const before = lines.slice(0, heads[0]).join("\n").trim();
    if (before !== "" && !before.startsWith(WORKER_BRIEF)) {
        return null;
    }
    const messages = heads.map((at, n) => {
        const head = lines[at] ?? "";
        const body = lines.slice(at + 1, heads[n + 1] ?? lines.length).join("\n").trim();
        return messageOf(head, body);
    });
    return { kind: "relay", brief: before === "" ? null : before, messages };
}

function messageOf(head: string, body: string): RelayMessage {
    const m = HEAD.exec(head);
    const from: RelayFrom = m?.[1] != null ? "judge" : m?.[2] != null ? "worker" : m?.[3] != null ? "person" : "arcterm";
    const name = unquote(m?.[1] ?? m?.[2] ?? "");
    return { from, name, time: m?.[5] ?? null, raw: `${head}\n${body}`, ...bodyOf(from, body) };
}

// a message's leading `> line` (the line it answers) and a person's `Answer to A<n>: `, lifted out of its text
function bodyOf(from: RelayFrom, body: string): Pick<RelayMessage, "quote" | "answers" | "text"> {
    let rest = body;
    let quote: string | null = null;
    if (rest.startsWith("> ")) {
        const nl = rest.indexOf("\n");
        quote = (nl < 0 ? rest : rest.slice(0, nl)).slice(2).trim();
        rest = nl < 0 ? "" : rest.slice(nl + 1);
    }
    const a = from === "person" ? ANSWER.exec(rest) : null;
    if (a != null) {
        rest = rest.slice(a[0].length);
    }
    return { quote, answers: a != null ? Number(a[1]) : null, text: rest.trim() };
}

/** The judges a working agent's brief pairs it with: the quoted names of its first sentence. */
export function briefJudges(brief: string): string[] {
    const end = brief.indexOf(". ");
    const first = end < 0 ? brief : brief.slice(0, end);
    return [...first.matchAll(new RegExp(QUOTED, "g"))].map((m) => unquote(m[1] ?? ""));
}

interface PairSides {
    worker: { name: string; tab: string };
    judges?: { name: string; tab: string }[] | null;
}

/** The tab a relayed message's sender has in the live pair, or null: no pair, the person or arcterm, or a judge's name
 *  that two judges share. */
export function relaySenderTab(pair: PairSides | null, msg: Pick<RelayMessage, "from" | "name">): string | null {
    if (pair == null) {
        return null;
    }
    if (msg.from === "worker") {
        return pair.worker.name === msg.name ? pair.worker.tab : null;
    }
    if (msg.from !== "judge") {
        return null;
    }
    const named = (pair.judges ?? []).filter((j) => j.name === msg.name);
    return named.length === 1 ? (named[0]?.tab ?? null) : null;
}

/** The key the n-th message of a relay item is drawn under, as an agent's prose part is (stepsPartKey): Chat's pair
 *  cards find their place by it. */
export function relayPartKey(itemKey: string, n: number): string {
    return `${itemKey}#relay${n}`;
}

/** The working agent's texts a relay item holds, keyed as its card draws them: in the judge's Chat, the only way the
 *  working agent's arc-pair lists arrive. */
export function relayWorkerTexts(itemKey: string, relay: PairRelay): { key: string; text: string }[] {
    if (relay.kind === "judgeBrief") {
        return relay.reply != null ? [{ key: relayPartKey(itemKey, 0), text: relay.reply.text }] : [];
    }
    if (relay.kind !== "relay") {
        return [];
    }
    return relay.messages.flatMap((m, n) => (m.from === "worker" ? [{ key: relayPartKey(itemKey, n), text: m.text }] : []));
}
```

**Step 4: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/pairrelay.test.ts`
Expected: PASS (all). If a fixture test fails on wording, read the fixture: the Go text is the source of truth.

**Step 5: Lint and commit**

```bash
npx eslint frontend/app/view/agents/pairrelay.ts frontend/app/view/agents/pairrelay.test.ts
npx prettier --check frontend/app/view/agents/pairrelay.ts frontend/app/view/agents/pairrelay.test.ts
git add frontend/app/view/agents/pairrelay.ts frontend/app/view/agents/pairrelay.test.ts
git commit -m "feat(chat): read what a pair relays: its messages, the briefs and the end notice" -- frontend/app/view/agents/pairrelay.ts frontend/app/view/agents/pairrelay.test.ts
```

---

### Task 3: Chat's model carries the relay, and the judge's Chat places the relayed lists

**Files:** `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`, `frontend/app/view/agents/chatitemeq.ts`, `frontend/app/view/agents/pairblocks.ts`, `frontend/app/view/agents/pairblocks.test.ts`

**Step 1: Write the failing tests**

In `frontend/app/view/agents/chatmodel.test.ts`, replace the test
`"reads a message the pair relays as a sent card from the cockpit, not as the person's own text"` with:

```ts
    it("reads a message the pair relays as a sent item carrying the relay, not as the person's own text", () => {
        const [item] = chatItems([you(fixture("pair-message"))]);
        expect(item).toMatchObject({ kind: "sent", from: "cockpit" });
        const relay = (item as Extract<ChatItem, { kind: "sent" }>).relay;
        expect(relay).toMatchObject({ kind: "relay", messages: [{ from: "judge", name: "review", time: "14:02" }] });
        // it comes from the pair, not from an agent's tab: no tab on the item, the card finds the sender in the pair
        expect(item).not.toHaveProperty("tabId");
    });

    it("keeps the whole relay, past the six lines a sent card is cut to", () => {
        const [item] = chatItems([you(fixture("pair-relay-first"))]);
        const relay = (item as Extract<ChatItem, { kind: "sent" }>).relay;
        expect(relay?.kind === "relay" && relay.messages[0]?.text).toContain("```arc-judge");
    });

    it("reads the judge's brief and the end notice as relays too", () => {
        const kinds = ["pair-judge-brief", "pair-ended"].map(
            (name) => (chatItems([you(fixture(name))])[0] as Extract<ChatItem, { kind: "sent" }>).relay?.kind
        );
        expect(kinds).toEqual(["judgeBrief", "ended"]);
    });

    it("shows a pair text it cannot read whole, as Markdown", () => {
        const text = `[Message from agent "arcterm pair" (relayed by arcterm's pair of a working agent and its judge). Not typed by the user.]\nsomething new\n\nwith ${"a line ".repeat(3)}`;
        const [item] = chatItems([you(text)]);
        expect(item).toMatchObject({ kind: "sent", markdown: "something new\n\nwith a line a line a line" });
        expect(item).not.toHaveProperty("relay");
    });
```

In `frontend/app/view/agents/pairblocks.test.ts`, add to `describe("placePairLists")`:

```ts
    it("places the working agent's list a pair relayed into the judge's Chat, as the newest after the agent's own", () => {
        const relayed = pairBlock("D1 a", "A2 b [Yes | No]");
        const sent: ChatItem = {
            kind: "sent",
            key: "sent:3",
            from: "cockpit",
            header: "pair",
            lines: [],
            relay: {
                kind: "relay",
                brief: null,
                messages: [
                    { from: "worker", name: "w", time: "14:05", quote: null, answers: null, text: `Swapped.\n\n${relayed}`, raw: "" },
                ],
            },
        };
        const out = placePairLists([agent(0, pairBlock("D1 a")), sent]);
        const key = pairBlockKey(relayPartKey("sent:3", 0), parsePairItems("D1 a\nA2 b [Yes | No]"));
        expect(out.get(key)).toEqual({ latest: true, previous: parsePairItems("D1 a") });
    });
```

and add `import { relayPartKey } from "./pairrelay";` to its imports.

**Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/pairblocks.test.ts`
Expected: FAIL (no `relay` on the item; the relayed list not placed; a type error on `relay` in the literal).

**Step 3: Carry the relay on the sent item**

In `frontend/app/view/agents/chatmodel.ts`:

- import: `import { pairEnvelopeText, parsePairRelay, type PairRelay } from "./pairrelay";`
- the `sent` member of `ChatItem` (line ~123) gains `relay?: PairRelay`, and its comment one line:
  `// a pair's prompt (pairrelay.ts) carries \`relay\`, what it holds, which the card draws in place of \`lines\``
- `type Sent` (line ~153) gains `relay?: PairRelay`.
- add under `POINTER_HEADER`:

```ts
/** Header of the card for a pair's prompt, kept for one the pair's parser cannot read. */
const PAIR_HEADER = "message · from arcterm pair";
```

- in `readSent`, before `const sent = parseStreamPrompt(t);`:

```ts
    // what arcterm's pair relays: the sender's turn whole (pairrelay.ts), or, for a text it cannot read, the text whole
    const pair = pairEnvelopeText(t);
    if (pair != null) {
        const relay = parsePairRelay(pair);
        return relay != null
            ? { from: "cockpit", header: PAIR_HEADER, lines: [], relay }
            : { from: "cockpit", header: PAIR_HEADER, lines: [], markdown: pair.trim() };
    }
```

In `frontend/app/view/agents/chatitemeq.ts`, the `case "sent"` comparison gains
`&& JSON.stringify(a.relay) === JSON.stringify(other.relay)`.

**Step 4: Place the relayed lists**

In `frontend/app/view/agents/pairblocks.ts`, import `relayWorkerTexts` from `./pairrelay`, add above
`placePairLists`:

```ts
// the prose a conversation item holds, keyed as Chat draws it: an agent's prose parts, and the working agent's replies a
// pair relayed into this conversation (the judge's Chat gets the lists only that way)
function proseOf(item: ChatItem): { key: string; text: string; live: boolean }[] {
    if (item.kind === "agent") {
        return item.parts.flatMap((part, p) =>
            part.kind === "prose" ? [{ key: stepsPartKey(item.key, p), text: part.text, live: part.live === true }] : []
        );
    }
    if (item.kind === "sent" && item.relay != null) {
        return relayWorkerTexts(item.key, item.relay).map((t) => ({ ...t, live: false }));
    }
    return [];
}
```

and make `placePairLists`'s loop read it:

```ts
    for (const item of items) {
        for (const { key, text, live } of proseOf(item)) {
            if (!text.includes(PAIR_LANG)) {
                continue;
            }
            for (const fence of topFencesOf(text)) {
                if (fence.lang !== PAIR_LANG || (live && !fence.closed)) {
                    continue;
                }
                const listed = parsePairItems(fence.body);
                if (listed.length === 0) {
                    continue;
                }
                last = { latest: false, previous };
                out.set(pairBlockKey(key, listed), last);
                previous = listed;
            }
        }
    }
```

Update its doc comment's first sentence to "every arc-pair list of a conversation, in an agent's reply or a working
agent's reply a pair relayed, that lists an item …".

**Step 5: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/pairblocks.test.ts frontend/app/view/agents/pairrelay.test.ts frontend/app/view/agents/chatitemeq.test.ts`
Expected: PASS.

**Step 6: Lint and commit**

```bash
npx eslint frontend/app/view/agents/chatmodel.ts frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.ts frontend/app/view/agents/pairblocks.ts frontend/app/view/agents/pairblocks.test.ts
npx prettier --check frontend/app/view/agents/chatmodel.ts frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.ts frontend/app/view/agents/pairblocks.ts frontend/app/view/agents/pairblocks.test.ts
git commit -m "feat(chat): a pair's prompt carries what it relays; the judge's Chat places the relayed lists" -- frontend/app/view/agents/chatmodel.ts frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatitemeq.ts frontend/app/view/agents/pairblocks.ts frontend/app/view/agents/pairblocks.test.ts
```

---

### Task 4: The relayed reply as the sender's turn, and its scenario

**Files:** `frontend/app/view/agents/chatpairrelay.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `scripts/cdp/scenarios-chat-pair-relay.mjs`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Read first: the spec's Design section, boards `F-reply-worker-side.dc.html` and `G-reply-judge-side.dc.html` in the
Prototype folder, `DESIGN.md` "Components" (motion, tokens), and `scripts/cdp/scenarios-chat-pair-blocks.mjs` (the
scenario this one is modelled on).

**Step 1: The view**

`frontend/app/view/agents/chatpairrelay.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pair's relayed prompt in Chat (docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md; boards F and G of
// .superpowers/design/chat-pair-relay): each message the pair relayed is its sender's turn, a card on the right naming
// the sender (a press opens its conversation), its time, the line it answers and its text whole, its arc-judge or
// arc-pair fence drawn as Chat's card; your own words relayed are your bubble; arcterm's brief is one folded line and the
// end notice one line. What the prompt holds is the pure parser's (pairrelay.ts).

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { ArrowLeftRight, ArrowUpRight, ChevronRight, CornerDownRight, Hammer, Scale } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { FOCUS_RING } from "./chatbrainstormparts";
import { StepsPart } from "./chatsteplistview";
import { CodeBlock } from "./codeblock";
import { CouncilText } from "./councilchat";
import { MarkdownMessage } from "./markdownmessage";
import { briefJudges, relayPartKey, relaySenderTab, type PairRelay, type RelayMessage } from "./pairrelay";
import { usePairOf } from "./pairstore";

export function PairRelayView({
    relay,
    itemKey,
    model,
    agentTabId,
    proseClass,
}: {
    relay: PairRelay;
    itemKey: string;
    model?: AgentsViewModel;
    agentTabId: string | null;
    proseClass: string;
}) {
    const pair = usePairOf(agentTabId)?.pair ?? null;
    if (relay.kind === "ended") {
        return <EndedLine commands={relay.commands} />;
    }
    if (relay.kind === "judgeBrief") {
        return (
            <div data-chat-relay="judgeBrief" className="flex w-full flex-col items-end gap-[14px]">
                <BriefLine text={relay.brief} what={`arcterm made this agent the judge of ${relay.workerName}`} />
                {relay.reply != null ? (
                    <ReplyCard
                        msg={relay.reply}
                        partKey={relayPartKey(itemKey, 0)}
                        tabId={relay.workerTab}
                        model={model}
                        proseClass={proseClass}
                    />
                ) : null}
            </div>
        );
    }
    const first = relay.messages[0]?.time;
    return (
        <div data-chat-relay="relay" className="flex w-full flex-col items-end gap-[14px]">
            {relay.brief != null ? (
                <BriefLine
                    text={relay.brief}
                    what={`arcterm paired this agent with ${briefJudges(relay.brief).join(", ")}${first != null ? ` · ${first}` : ""}`}
                />
            ) : null}
            {relay.messages.map((msg, n) =>
                msg.from === "person" ? (
                    <YouRow key={n} msg={msg} />
                ) : msg.from === "arcterm" ? (
                    <ArctermRow key={n} msg={msg} proseClass={proseClass} />
                ) : (
                    <ReplyCard
                        key={n}
                        msg={msg}
                        partKey={relayPartKey(itemKey, n)}
                        tabId={relaySenderTab(pair, msg)}
                        model={model}
                        proseClass={proseClass}
                    />
                )
            )}
        </div>
    );
}

function useFold(): [boolean, () => void] {
    const [open, setOpen] = useState(false);
    return [open, () => setOpen((o) => !o)];
}

// opens and folds on the no-bounce spring, as every Chat part that changes shape
function Reveal({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
    const reveal = usePartMotion(springReveal);
    return (
        <AnimatePresence initial={false}>
            {open ? (
                <motion.div key="open" {...reveal} className={cn("overflow-hidden", className)}>
                    {children}
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}

function Chevron({ open }: { open: boolean }) {
    return (
        <ChevronRight
            size={12}
            strokeWidth={2}
            aria-hidden
            className={cn("flex-none transition-transform", open && "rotate-90")}
        />
    );
}

function QuoteRow({ text }: { text: string }) {
    return (
        <div data-chat-relay-quote className="flex min-w-0 items-start gap-[6px] text-[12.5px] leading-[1.45] text-muted">
            <CornerDownRight size={12} strokeWidth={2} aria-hidden className="mt-[3px] flex-none" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
        </div>
    );
}

// a judge's or the working agent's reply: its turn, on the right since it comes in, wide enough for its fence card
function ReplyCard({
    msg,
    partKey,
    tabId,
    model,
    proseClass,
}: {
    msg: RelayMessage;
    partKey: string;
    tabId: string | null;
    model?: AgentsViewModel;
    proseClass: string;
}) {
    const [raw, toggleRaw] = useFold();
    const role = msg.from === "judge" ? "judge" : "working agent";
    const Icon = msg.from === "judge" ? Scale : Hammer;
    const name = (
        <span data-chat-relay-name className="min-w-0 truncate font-medium text-primary">
            {msg.name}
        </span>
    );
    return (
        <section
            data-chat-relay-msg={msg.from}
            aria-label={`Reply from the ${role} ${msg.name}`}
            className="flex w-[88%] min-w-0 flex-col gap-[10px] rounded-[12px] border border-edge-mid px-[14px] pb-[14px] pt-[10px]"
        >
            <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
                <span
                    aria-hidden
                    className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[6px] bg-surface-raised text-secondary"
                >
                    <Icon size={13} strokeWidth={1.8} />
                </span>
                {tabId != null && model != null ? (
                    <button
                        type="button"
                        data-chat-relay-open
                        title={`Open ${msg.name}'s conversation`}
                        onClick={(e) => fireAndForget(() => openOrPeek(model, { kind: "agent", tabId }, e))}
                        className={cn(
                            FOCUS_RING,
                            "group flex min-w-0 cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-left"
                        )}
                    >
                        {name}
                        <ArrowUpRight
                            size={12}
                            strokeWidth={2}
                            aria-hidden
                            className="flex-none text-muted group-hover:text-primary"
                        />
                    </button>
                ) : (
                    name
                )}
                <span className="flex-none text-[11.5px] text-muted">{role} · replied</span>
                {msg.time != null ? (
                    <span className="ml-auto flex-none text-[11.5px] tabular-nums text-muted">{msg.time}</span>
                ) : null}
            </div>
            {msg.quote != null ? <QuoteRow text={msg.quote} /> : null}
            {msg.text !== "" ? (
                // the prose part a fence card in it finds its place by (placePairLists keys it the same)
                <StepsPart partKey={partKey}>
                    <CouncilText text={msg.text} className={proseClass} refs commands />
                </StepsPart>
            ) : null}
            <div className="flex flex-col">
                <button
                    type="button"
                    data-chat-relay-raw-toggle
                    aria-expanded={raw}
                    onClick={toggleRaw}
                    className="flex cursor-pointer items-center gap-[4px] self-start rounded-[4px] border-0 bg-transparent p-0 text-[11.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <Chevron open={raw} />
                    <span>Text as relayed</span>
                </button>
                <Reveal open={raw}>
                    <div data-chat-relay-raw className="pt-[8px]">
                        <CodeBlock code={msg.raw} lang="text" />
                    </div>
                </Reveal>
            </div>
        </section>
    );
}

// your own words the pair relayed: your bubble, saying where they went
function YouRow({ msg }: { msg: RelayMessage }) {
    const where = msg.answers != null ? `answered A${msg.answers} in the pair` : "in the pair";
    return (
        <div data-chat-relay-msg="person" className="flex max-w-[75%] flex-col items-end gap-[4px]">
            {msg.quote != null ? <QuoteRow text={msg.quote} /> : null}
            <div className="rounded-[16px] bg-surface-raised px-[14px] py-[9px] text-[13.5px] leading-[1.55] text-primary [overflow-wrap:anywhere]">
                {msg.text}
            </div>
            <div className="text-[11.5px] tabular-nums text-muted">
                You, {where}
                {msg.time != null ? ` · ${msg.time}` : ""}
            </div>
        </div>
    );
}

// a part arcterm itself relayed: its text whole, as a sent card draws one
function ArctermRow({ msg, proseClass }: { msg: RelayMessage; proseClass: string }) {
    return (
        <div
            data-chat-relay-msg="arcterm"
            className="flex max-w-[75%] flex-col gap-[6px] rounded-[12px] border border-edge-mid px-[14px] py-[9px]"
        >
            <span className="text-[12.5px] font-medium text-primary">arcterm</span>
            <CouncilText text={msg.text} className={proseClass} />
        </div>
    );
}

// a brief arcterm wrote for the agent, not a message: one line, the brief behind it. Drawn without the fence cards, so
// its arc-pair or arc-judge example stays an example
function BriefLine({ text, what }: { text: string; what: string }) {
    const [open, toggle] = useFold();
    return (
        <div data-chat-relay-brief data-chat-relay-brief-open={open ? "" : undefined} className="flex w-full flex-col items-end">
            <button
                type="button"
                data-chat-relay-brief-toggle
                aria-expanded={open}
                onClick={toggle}
                className="flex cursor-pointer items-center gap-[6px] rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ArrowLeftRight size={12} strokeWidth={2} aria-hidden className="flex-none" />
                <span>{what} ·</span>
                <span className="text-secondary">{open ? "Hide the brief" : "Brief"}</span>
                <Chevron open={open} />
            </button>
            <Reveal open={open} className="w-full">
                <div data-chat-relay-brief-text className="ml-auto mt-[8px] max-w-[88%] rounded-[10px] bg-surface px-[14px] py-[12px]">
                    <MarkdownMessage text={text} className="min-w-0 break-words text-[13px] leading-[1.6] text-ink-mid" />
                </div>
            </Reveal>
        </div>
    );
}

function EndedLine({ commands }: { commands: string[] }) {
    return (
        <div data-chat-relay="ended" className="flex flex-col items-end gap-[4px] text-[12px] text-muted">
            <span className="flex items-center gap-[6px]">
                <ArrowLeftRight size={12} strokeWidth={2} aria-hidden className="flex-none" />
                The pair ended
            </span>
            {commands.map((c) => (
                <span key={c} className="[overflow-wrap:anywhere]">
                    <code className="font-mono text-[11.5px] text-code-inline">{c}</code> may run now
                </span>
            ))}
        </div>
    );
}
```

Check `MarkdownMessage`'s props (`markdownmessage.tsx:388`) and `CodeBlock`'s (`codeblock.tsx`) before relying on
`className` and `lang="text"`; adjust to what they take.

**Step 2: Route a relay to it**

In `frontend/app/view/agents/chatconversation.tsx`, import `PairRelayView` from `./chatpairrelay`, and change the
`case "sent":` (line ~1740) to:

```tsx
            case "sent":
                return item.relay != null ? (
                    <PairRelayView
                        relay={item.relay}
                        itemKey={item.key}
                        model={model}
                        agentTabId={agent?.id ?? null}
                        proseClass={PROSE}
                    />
                ) : (
                    <SentCard item={item} model={model} />
                );
```

Run: `task check:ts` (2 to 3 minutes; give it a 6-minute timeout). Expected: no errors.

**Step 3: The scenario**

`scripts/cdp/scenarios-chat-pair-relay.mjs`, modelled on `scenarios-chat-pair-blocks.mjs` (copy its imports, the
`seen`/`until`/`run`/`click`/`scrollTo` helpers and its teardown). Like that file it has `const NAME = "chat-pair-relay"`,
and its default export `(kit) => [...]` returns one scenario `{ name: NAME, surface: "agent", arrange, assert }`:
`final-verify.mjs` finds a scenario by that `name` and aborts "no scenario is named chat-pair-relay" without it. Shots
are named from it (`cdp-shots/${NAME}-<n>-<what>.png`). It makes **two** fixture tabs with `makeTab`:

- the working agent `thesis-draft`, whose transcript is
  `userText("Plan the pilot with the judge.")`, `assistantText` ending with a ```` ```arc-pair ```` (`D1 Pilot on 40
  transcripts`, `O2 Lock the 0.8 threshold`), `userText(<pair-relay-first.txt>)`, `assistantText("Swapped the steps.")`,
  `userText(<pair-relay-batch.txt>)`;
- the judge `mit-thesis`, whose transcript is `userText(<pair-judge-brief.txt>)`,
  `assistantText("> Swapped …\nNo new points.")`, `userText(<pair-relay-worker.txt>)`.

The fixture texts are read from `claude/arc-view-mod/testdata/` with `readFileSync(new URL("../../claude/arc-view-mod/testdata/<name>.txt", import.meta.url), "utf8")`,
so the scenario shows exactly what Go writes. `seedPair` seeds one live pair (`worker: {tab: <worker tab>, name:
"thesis-draft"}`, `judges: [{tab: <judge tab>, name: "mit-thesis"}]`, `decided` with A3 `Keep the 0.8 threshold?`
chips `Yes`/`No, change it`, D1 agreed, O2 open), so the names resolve to tabs. Both tabs go into the roster and into
chat mode. Steps (each a `rec` with a screenshot `cdp-shots/chat-pair-relay-<n>-<what>.png`):

1. **worker: judge's reply** — focus the worker. In its layer, the first `[data-chat-relay="relay"]` has a
   `[data-chat-relay-brief]` (not open) whose text includes `arcterm paired this agent with mit-thesis · 14:02`, and a
   `[data-chat-relay-msg="judge"]` whose `[data-chat-relay-name]` is `mit-thesis`, with `[data-chat-relay-open]`
   present, `[data-chat-relay-quote]` `then I lock the 0.8 threshold and run the full set`, its text including `The
   pilot measures before`, and a `[data-chat-judge="marks"]` inside it; no `[data-code-head]` in the layer reads
   `arc-judge`; no element's text is `message · from arcterm pair`. (Board F.)
2. **worker: brief opened** — click `[data-chat-relay-brief-toggle]`; wait for `[data-chat-relay-brief-open]`; its
   `[data-chat-relay-brief-text]` includes `End every reply with an` and holds a `[data-code-head]` reading `arc-pair`
   (the example stays code); no `[data-chat-pair]` inside it.
3. **worker: text as relayed** — click the judge card's `[data-chat-relay-raw-toggle]`; `[data-chat-relay-raw]` text
   includes `From the judge "mit-thesis", 14:02:` and `` ```arc-judge ``.
4. **worker: batch** — the second relay holds a judge card (time `14:09`, its list item `data/labels-v2.csv`) and a
   `[data-chat-relay-msg="person"]` whose text includes `Keep 0.8.` and `You, answered A3 in the pair · 14:10`.
5. **judge: the working agent's reply** — focus the judge. Its `[data-chat-relay="judgeBrief"]` line includes
   `arcterm made this agent the judge of thesis-draft`; the last `[data-chat-relay-msg="worker"]` in the layer has
   `[data-chat-relay-name]` `thesis-draft`, a `[data-chat-relay-open]`, and a `[data-chat-pair="latest"]` inside it
   (the newest list, drawn in full); the earlier worker card (the brief's reply) holds a `[data-chat-pair="older"]`.
   (Board G.)
6. **motion** — step 5 left the judge focused: focus the worker again (`AC.focusAgent(h, workerTab)`) and wait for its
   layer; if `[data-chat-relay-brief-open]` is gone (the layer remounted the relay), click
   `[data-chat-relay-brief-toggle]` and wait for it. With the brief open, click the toggle, sample
   `[data-chat-relay-brief] .overflow-hidden` height at 0, 60, 120, 240 and 400 ms: it falls through intermediate
   values to gone (it folds on the spring, not at once).

Register it in `scripts/cdp/scenarios.mjs` beside `chatPairBlocksScenarios`:
`import chatPairRelayScenarios from "./scenarios-chat-pair-relay.mjs";` and `...chatPairRelayScenarios(RT_KIT),`.

Acceptance: steps 1 and 4 show board F's view, step 5 board G's; step 2 the opened brief, step 3 the raw text, step 6
the fold's motion.

**Step 4: The changelog**

In `CHANGELOG.md`, under `## Unreleased` → `### Changed`, add one line:

```markdown
- A judge's reply in a pair now reads in Chat as the judge's own turn, whole: its name opens its conversation, the line
  it answers shows above it, and its marks or the working agent's list draw as cards; the pair brief folds to one line.
```

**Step 5: Lint, check and commit**

```bash
npx eslint frontend/app/view/agents/chatpairrelay.tsx frontend/app/view/agents/chatconversation.tsx
npx prettier --check frontend/app/view/agents/chatpairrelay.tsx frontend/app/view/agents/chatconversation.tsx
task check:ts
git add frontend/app/view/agents/chatpairrelay.tsx scripts/cdp/scenarios-chat-pair-relay.mjs
git commit -m "feat(chat): a pair's relayed reply reads as the sender's turn, whole, its fence a card" -- frontend/app/view/agents/chatpairrelay.tsx frontend/app/view/agents/chatconversation.tsx scripts/cdp/scenarios-chat-pair-relay.mjs scripts/cdp/scenarios.mjs CHANGELOG.md
```

The run's Final (`node scripts/cdp/final-verify.mjs chat-pair-relay`) runs the scenario on the merged result. An agent
not in an Arc run then does the `arc:ux-check` pass on the dev app.
