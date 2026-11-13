// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The reviewer's verdict in Chat, the pure model (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md,
// sections 1, 2, 5 and 6, and the plan's decisions 3 to 7): the ```arc-review block an agent writes after a reviewer
// subagent, and the `ReportFindings` call `/code-review` makes, both read into one `Verdict`; which reviewer call a block
// judges; which findings start ticked; what the card is doing (`verdictMode`); the lines the Fix and Skip buttons send and
// the ✓ row the card folds into; and the send record that pairs those lines with their messages. No React, no jotai, no
// RPC: the conversation draws, chatmodel.ts finds the moments.

import { plural } from "./brainstormmodel";
import type { PairedAnswer, SentAnswer } from "./chatbrainstorm";

export const REVIEW_LANG = "arc-review";

/** The topic every verdict send record is kept under (they share the brainstorm send record, `chat.brainstorm.sent`):
 *  the conversation pairs them with their own `pairAnswers` call. */
export const VERDICT_TOPIC = "arc:verdict";

export type Severity = "Critical" | "Important" | "Minor";

export type VerdictFinding = { severity: Severity; file: string; line?: number; summary: string };

/** A reviewer's verdict as the card draws it. `reviewer` is "" when the block names none; `subagent` is the
 *  `description` of the `Agent` call the block judges, when the block says. */
export type Verdict = {
    kind: "code" | "plan";
    reviewer: string;
    pass: boolean;
    note: string;
    findings: VerdictFinding[];
    subagent?: string;
};

/** A reviewer-shaped `Agent` / `Task` call of one agent item: its `description`, its `subagent_type`, the tool call it is,
 *  and the index of its entry in the transcript (a block's own index is compared with it). */
export type ReviewerCall = { description: string; subagentType?: string; toolUseId?: string; index: number };

/** What became of a verdict card, as its ✓ row says: you sent Fix (how many were ticked) or Skip, you answered in your own
 *  words (`replied`), or the agent wrote on without waiting (`moved-on`). */
export type VerdictOutcome =
    | { kind: "fix"; fixed: number }
    | { kind: "skip" }
    | { kind: "replied" }
    | { kind: "moved-on" };

export type VerdictMode =
    | { mode: "waiting" | "working" | "static" }
    | { mode: "folded"; outcome: VerdictOutcome | null };

const SEVERITIES: readonly Severity[] = ["Critical", "Important", "Minor"];

// a trimmed string, or undefined for anything else (a non-string, a blank)
function str(v: unknown): string | undefined {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

// a line as a link needs: a positive whole number; anything else (0, a string, a fraction) is no line
const lineOf = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;

// the severity as written, in any case; Important for one the block does not name or does not know
function severityOf(v: unknown): Severity {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    return SEVERITIES.find((x) => x.toLowerCase() === s) ?? "Important";
}

function findingOf(f: unknown): VerdictFinding | null {
    if (!isObject(f)) {
        return null;
    }
    const summary = str(f.summary);
    if (summary == null) {
        return null;
    }
    const finding: VerdictFinding = { severity: severityOf(f.severity), file: str(f.file) ?? "", summary };
    const line = lineOf(f.line);
    if (line !== undefined) {
        finding.line = line;
    }
    return finding;
}

/** Pure: the one JSON object of an ```arc-review block. Null for broken JSON, a non-object, a `pass` that is not a boolean,
 *  a `kind` other than code or plan, `findings` that are not a list or hold a finding with no summary (the block then
 *  stays a code block, where the broken part shows); a field it does not know is dropped. A finding's severity is read in
 *  any case and is Important when missing or unknown, its file "" when missing, its line left out unless a positive whole
 *  number. */
export function parseReviewBlock(raw: string): Verdict | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isObject(parsed)) {
        return null;
    }
    const kind = parsed.kind;
    if ((kind !== "code" && kind !== "plan") || typeof parsed.pass !== "boolean") {
        return null;
    }
    let findings: VerdictFinding[] = [];
    if (parsed.findings !== undefined) {
        if (!Array.isArray(parsed.findings)) {
            return null;
        }
        const read = parsed.findings.map(findingOf);
        if (read.some((f) => f == null)) {
            return null;
        }
        findings = read as VerdictFinding[];
    }
    const v: Verdict = {
        kind,
        reviewer: str(parsed.reviewer) ?? "",
        pass: parsed.pass,
        note: str(parsed.note) ?? "",
        findings,
    };
    const subagent = str(parsed.subagent);
    if (subagent !== undefined) {
        v.subagent = subagent;
    }
    return v;
}

// an opening fence line (three or more backticks, then an info string with no backtick in it), and the closing one
const FENCE_OPEN = /^\s*(`{3,})([^`]*)$/;
const FENCE_CLOSE = /^\s*(`{3,})\s*$/;

// a prose part without the blank lines that were the fence's margin; nothing else is touched
const tidyProse = (text: string): string => text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");

/** Pure: a reply as its prose and its verdicts, in order. An ```arc-review fence that parses is cut out of the text, the
 *  prose before it and after it kept as parts of their own (blank ones dropped); a fence that does not parse, one still
 *  being written (no closing fence yet), another language's, and anything inside another code block stay in the prose,
 *  where the markdown draws them as code. */
export function splitReviewBlocks(
    text: string
): ({ kind: "prose"; text: string } | { kind: "verdict"; verdict: Verdict })[] {
    const out: ({ kind: "prose"; text: string } | { kind: "verdict"; verdict: Verdict })[] = [];
    const lines = text.split("\n");
    let prose: string[] = [];
    const flush = (): void => {
        const t = tidyProse(prose.join("\n"));
        if (t !== "") {
            out.push({ kind: "prose", text: t });
        }
        prose = [];
    };
    let i = 0;
    while (i < lines.length) {
        const open = FENCE_OPEN.exec(lines[i]);
        if (open == null) {
            prose.push(lines[i++]);
            continue;
        }
        const ticks = open[1].length;
        let close = i + 1;
        while (close < lines.length) {
            const m = FENCE_CLOSE.exec(lines[close]);
            if (m != null && m[1].length >= ticks) {
                break;
            }
            close++;
        }
        if (close >= lines.length) {
            // never closed: the fence runs to the end of the text, as the markdown reads it
            prose.push(...lines.slice(i));
            break;
        }
        const lang = open[2].trim().split(/\s+/)[0];
        const verdict = lang === REVIEW_LANG ? parseReviewBlock(lines.slice(i + 1, close).join("\n")) : null;
        if (verdict != null) {
            flush();
            out.push({ kind: "verdict", verdict });
        } else {
            prose.push(...lines.slice(i, close + 1));
        }
        i = close + 1;
    }
    flush();
    return out;
}

/** Pure: the verdict a `ReportFindings` call (`/code-review`) makes of its input. Reviewer `code-review`, a pass when it has
 *  no findings, the note `3 findings, 2 confirmed` (or `No findings`); CONFIRMED reads as Important, PLAUSIBLE as Minor and
 *  a finding with no verdict as Important. Null for an input with no `findings` list or a finding with no summary (the call
 *  then stays a tool line, as today). */
export function verdictFromFindings(input: unknown): Verdict | null {
    if (!isObject(input) || !Array.isArray(input.findings)) {
        return null;
    }
    const findings: VerdictFinding[] = [];
    let confirmed = 0;
    for (const f of input.findings) {
        const read = findingOf(f);
        if (read == null) {
            return null;
        }
        // the finding's own `verdict` (CONFIRMED / PLAUSIBLE) sets its severity, not a `severity` field
        const verdict = isObject(f) ? f.verdict : undefined;
        if (verdict === "CONFIRMED") {
            confirmed++;
        }
        findings.push({ ...read, severity: verdict === "PLAUSIBLE" ? "Minor" : "Important" });
    }
    return {
        kind: "code",
        reviewer: "code-review",
        pass: findings.length === 0,
        note:
            findings.length === 0
                ? "No findings"
                : `${plural(findings.length, "finding", "findings")}, ${confirmed} confirmed`,
        findings,
    };
}

const isReviewerCall = (c: ReviewerCall): boolean =>
    /review/i.test(c.subagentType ?? "") || /review/i.test(c.description);

/** Pure: the reviewer call a block judges. `calls` are the reviewer-shaped calls of the block's own agent item, `blockIndex`
 *  the entry index of the message that holds the block. With a `subagent`, the call whose description it names (compared
 *  trimmed and in any case): the nearest one before the block, else the first one after it; none named like that, none.
 *  Without one, the nearest call before the block whose `subagent_type` or description holds "review". */
export function pairReviewer(v: Verdict, calls: readonly ReviewerCall[], blockIndex: number): ReviewerCall | null {
    const subagent = v.subagent?.trim().toLowerCase();
    const named = subagent != null && subagent !== "";
    const pool = named
        ? calls.filter((c) => c.description.trim().toLowerCase() === subagent)
        : calls.filter(isReviewerCall);
    let before: ReviewerCall | null = null;
    let after: ReviewerCall | null = null;
    for (const c of pool) {
        if (c.index < blockIndex) {
            if (before == null || c.index > before.index) {
                before = c;
            }
        } else if (after == null || c.index < after.index) {
            after = c;
        }
    }
    return before ?? (named ? after : null);
}

/** Pure: the findings that start ticked: the Critical and Important ones, by their place in the list. */
export function initialTicks(v: Verdict): Set<number> {
    const ticks = new Set<number>();
    v.findings.forEach((f, i) => {
        if (f.severity !== "Minor") {
            ticks.add(i);
        }
    });
    return ticks;
}

/** Pure: what the card does now. `last` is whether it is the last part of the conversation, `live` that the agent is
 *  running (not exited, not an ended session), `working` that it is mid-turn, `nextIsYou` that your message follows the card;
 *  `record` is the verdict's send record, when you sent Fix or Skip.
 *
 *  - a record: folded with what you sent;
 *  - an approval with no findings: folded from the start, nothing is left to pick;
 *  - not the last part: folded, `replied` when your message follows, `moved-on` when the agent wrote on;
 *  - the last part of an agent that exited or of an ended session: static (no ticks, no buttons);
 *  - the last part while the agent works: `working` (no ticks, no buttons);
 *  - otherwise `waiting`: ticks and both buttons. */
export function verdictMode(i: {
    last: boolean;
    live: boolean;
    working: boolean;
    nextIsYou: boolean;
    record: Pick<PairedAnswer, "verdictOutcome" | "fixed"> | null;
    v: Verdict;
}): VerdictMode {
    if (i.record != null) {
        const o = i.record.verdictOutcome;
        const outcome: VerdictOutcome | null =
            o === "fix" ? { kind: "fix", fixed: i.record.fixed ?? 0 } : o === "skip" ? { kind: "skip" } : null;
        return { mode: "folded", outcome };
    }
    if (i.v.pass && i.v.findings.length === 0) {
        return { mode: "folded", outcome: null };
    }
    if (!i.last) {
        return { mode: "folded", outcome: { kind: i.nextIsYou ? "replied" : "moved-on" } };
    }
    if (!i.live) {
        return { mode: "static" };
    }
    return { mode: i.working ? "working" : "waiting" };
}

const reviewName = (v: Verdict): string => `${v.kind === "plan" ? "Plan" : "Code"} review`;

/** The card's header: "Code review · code-reviewer", or "Plan review" alone when the block names no reviewer. */
export function verdictHead(v: Verdict): string {
    return v.reviewer !== "" ? `${reviewName(v)} · ${v.reviewer}` : reviewName(v);
}

export function verdictChip(v: Verdict): "Changes requested" | "Approved" {
    return v.pass ? "Approved" : "Changes requested";
}

/** The Fix button's label: "Fix 2 selected", or "Fix none" (disabled) at zero. */
export function fixLabel(n: number): string {
    return n > 0 ? `Fix ${n} selected` : "Fix none";
}

// a finding on one line: the whitespace of a multi-line summary folded to single spaces
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The line Fix sends: "Fix these review findings:" and one `- <file>:<line> — <summary>` line per ticked finding, in the
 *  findings' order (a finding with no line is `- <file> — <summary>`, one with no file `- <summary>`). A tick that names no
 *  finding is skipped. */
export function fixLine(v: Verdict, ticked: readonly number[]): string {
    const picked = new Set(ticked);
    const lines = v.findings.flatMap((f, i) => {
        if (!picked.has(i)) {
            return [];
        }
        const where = f.file === "" ? "" : f.line !== undefined ? `${f.file}:${f.line}` : f.file;
        return [where === "" ? `- ${flat(f.summary)}` : `- ${where} — ${flat(f.summary)}`];
    });
    return ["Fix these review findings:", ...lines].join("\n");
}

/** The line Skip sends. */
export function skipLine(): string {
    return "Skip the review: go on without these changes.";
}

/** The ✓ row the card folds into (the ✓ is the view's): "Code review · Changes requested · 3 findings — Fix 2", or
 *  "Code review · Approved". The count is left out with no findings; the tail is `— Fix N`, `— Skipped` or `— You replied`,
 *  and nothing for an agent that went on or a card that was never waited on (`null`). */
export function verdictDoneLine(v: Verdict, outcome: VerdictOutcome | null): string {
    const parts = [reviewName(v), verdictChip(v)];
    if (v.findings.length > 0) {
        parts.push(plural(v.findings.length, "finding", "findings"));
    }
    const tail =
        outcome == null
            ? ""
            : outcome.kind === "fix"
              ? ` — Fix ${outcome.fixed}`
              : outcome.kind === "skip"
                ? " — Skipped"
                : outcome.kind === "replied"
                  ? " — You replied"
                  : "";
    return parts.join(" · ") + tail;
}

/** The record to keep once a Fix or Skip line was sent: it shares the brainstorm send record, under VERDICT_TOPIC, with the
 *  card's `key` (the part's), what was done and how many findings were ticked. `seen` is how many of the agent's user
 *  messages already held exactly `line` before the send (userTextCount). */
export function verdictRecord(
    key: string,
    outcome: "fix" | "skip",
    fixed: number,
    line: string,
    seen: number,
    now: number
): SentAnswer {
    return {
        topic: VERDICT_TOPIC,
        n: 0,
        part: "",
        text: line,
        sentAt: now,
        seen,
        kind: "verdict",
        verdictKey: key,
        verdictOutcome: outcome,
        fixed,
    };
}
