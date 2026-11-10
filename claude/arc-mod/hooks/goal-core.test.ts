import { describe, expect, it } from "vitest";
import { goalBandLine, goalChecks, goalFromLines, goalState, type GoalEntry } from "./goal-core";

const COND = "a file named done.txt containing the word ok exists in the current directory";
const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 16, 24, s)).toISOString();

// the records a real `/goal` session (claude 2.1.322, -p) wrote: the set, then the evaluator's verdict
const set = (ts = at(50), condition = COND): GoalEntry => ({
    type: "attachment",
    timestamp: ts,
    attachment: { type: "goal_status", met: false, sentinel: true, condition },
});
const verdict = (met: boolean, reason: string, ts: string, extra: Record<string, unknown> = {}): GoalEntry => ({
    type: "attachment",
    timestamp: ts,
    attachment: { type: "goal_status", met, condition: COND, reason, ...extra },
});
const cleared = (ts: string): GoalEntry => ({
    type: "attachment",
    timestamp: ts,
    attachment: { type: "goal_status", met: true, sentinel: true, condition: COND },
});
const prompt = (text: string, ts: string): GoalEntry => ({ type: "user", timestamp: ts, message: { content: text } });
const propose = (id: string, condition: string, ts: string): GoalEntry => ({
    type: "assistant",
    timestamp: ts,
    message: { content: [{ type: "tool_use", id, name: "ProposeGoal", input: { condition } }] },
});
const answer = (id: string, ts: string): GoalEntry => ({
    type: "user",
    timestamp: ts,
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
});

describe("goalState", () => {
    it("is null with no goal in the lines", () => {
        expect(goalState([prompt("hi", at(1))])).toBeNull();
    });

    it("reads a goal set and not checked yet as active", () => {
        expect(goalState([set()])).toEqual({
            phase: "active",
            condition: COND,
            setAt: Date.parse(at(50)),
            checks: [],
            settledBeforePrompt: false,
        });
    });

    it("counts each verdict not met, and keeps the newest reason", () => {
        const s = goalState([
            set(),
            verdict(false, "done.txt does not exist yet", at(55)),
            verdict(false, "done.txt holds 'okay', not 'ok'", at(58)),
        ]);
        expect(s?.phase).toBe("active");
        expect(s?.checks.map((c) => c.met)).toEqual([false, false]);
        expect(s?.reason).toBe("done.txt holds 'okay', not 'ok'");
    });

    it("reads the met verdict with its counts, as the real session wrote it", () => {
        const s = goalState([
            set(),
            verdict(true, "The Bash tool call ran printf", at(59), { iterations: 1, durationMs: 8430, tokens: 1024 }),
        ]);
        expect(s).toMatchObject({
            phase: "met",
            iterations: 1,
            durationMs: 8430,
            tokens: 1024,
            reason: "The Bash tool call ran printf",
        });
        expect(s?.checks).toHaveLength(1);
    });

    it("reads a failed verdict as stopped", () => {
        const s = goalState([
            set(),
            verdict(false, "gave up", at(59), { failed: true, iterations: 20, durationMs: 3_840_000, tokens: 9 }),
        ]);
        expect(s).toMatchObject({ phase: "stopped", reason: "gave up", iterations: 20 });
    });

    it("forgets a goal cleared (/goal clear, or cleared after an error)", () => {
        expect(goalState([set(), verdict(false, "not yet", at(55)), cleared(at(57))])).toBeNull();
    });

    it("keeps the checks when a compaction re-states the same goal, and starts over on a new one", () => {
        const same = goalState([set(), verdict(false, "not yet", at(55)), set(at(56))]);
        expect(same?.checks).toHaveLength(1);
        expect(same?.setAt).toBe(Date.parse(at(50)));
        const other = goalState([set(), verdict(false, "not yet", at(55)), set(at(56), "tests pass")]);
        expect(other).toMatchObject({ condition: "tests pass", checks: [] });
    });

    it("marks a settled goal once you sent a prompt after it, so a view can fold it away", () => {
        const met = verdict(true, "done", at(56), { iterations: 1 });
        expect(goalState([set(), met])?.settledBeforePrompt).toBe(false);
        expect(goalState([set(), met, prompt("next thing", at(57))])?.settledBeforePrompt).toBe(true);
    });

    it("reads a verdict whose set is before the lines read", () => {
        expect(goalState([verdict(false, "not yet", at(55))])).toMatchObject({
            phase: "active",
            condition: COND,
            checks: [{ met: false }],
        });
    });

    it("reads a ProposeGoal call with no answer yet as proposed, and drops it once answered", () => {
        expect(goalState([propose("t1", "tests pass", at(1))])).toEqual({
            phase: "proposed",
            condition: "tests pass",
            setAt: Date.parse(at(1)),
            checks: [],
            settledBeforePrompt: false,
        });
        expect(goalState([propose("t1", "tests pass", at(1)), answer("t1", at(2))])).toBeNull();
        // approved: the set follows the answer
        expect(
            goalState([propose("t1", "tests pass", at(1)), answer("t1", at(2)), set(at(3), "tests pass")])?.phase
        ).toBe("active");
    });
});

describe("goalFromLines", () => {
    const L = (e: GoalEntry) => JSON.stringify(e);

    it("reads the goal from raw transcript lines as goalState does, skipping a line it cannot parse", () => {
        const lines = [L(prompt("hi", at(1))), "{ not json", L(set()), L(verdict(false, "not yet", at(55)))];
        expect(goalFromLines(lines)).toEqual(
            goalState([prompt("hi", at(1)), set(), verdict(false, "not yet", at(55))])
        );
    });

    it("is null at once for lines with no goal in them", () => {
        expect(goalFromLines([L(prompt("hi", at(1))), L(prompt("again", at(2)))])).toBeNull();
    });

    it("still sees a prompt sent after the goal settled", () => {
        const lines = [L(set()), L(verdict(true, "ok", at(56), { iterations: 1 })), L(prompt("next", at(57)))];
        expect(goalFromLines(lines)?.settledBeforePrompt).toBe(true);
    });
});

describe("goalChecks", () => {
    it("draws each check as a mark, met or not, and at least the next one to come while active", () => {
        const active = goalState([set(), verdict(false, "a", at(55)), verdict(false, "b", at(56))])!;
        expect(goalChecks(active)).toEqual(["miss", "miss", "next"]);
        const met = goalState([set(), verdict(false, "a", at(55)), verdict(true, "b", at(56))])!;
        expect(goalChecks(met)).toEqual(["miss", "hit"]);
    });

    it("keeps the last eight marks of a long run", () => {
        const many = [set(), ...Array.from({ length: 12 }, (_, i) => verdict(false, `r${i}`, at(i + 1)))];
        expect(goalChecks(goalState(many)!)).toHaveLength(9);
    });
});

describe("goalBandLine", () => {
    const now = Date.parse(at(50)) + 252_000;

    it("an active goal: its condition, the check count, how long it has run", () => {
        const s = goalState([
            set(),
            verdict(false, "not yet", at(55)),
            verdict(false, "x", at(56)),
            verdict(false, "y", at(57)),
        ])!;
        expect(goalBandLine(s, now)).toEqual({
            label: "goal",
            tone: "active",
            condition: COND,
            meta: "check 3 · 4m 12s",
        });
    });

    it("met and stopped: the evaluator's own counts", () => {
        const met = goalState([
            set(),
            verdict(true, "ok", at(56), { iterations: 4, durationMs: 720_000, tokens: 48_200 }),
        ])!;
        expect(goalBandLine(met, now)).toMatchObject({
            label: "goal met",
            tone: "met",
            meta: "4 checks · 12m 0s · ↓48k",
        });
        const stopped = goalState([
            set(),
            verdict(false, "gave up", at(56), { failed: true, iterations: 20, durationMs: 3_840_000 }),
        ])!;
        expect(goalBandLine(stopped, now)).toMatchObject({
            label: "goal stopped",
            tone: "stopped",
            meta: "20 checks · 1h 4m",
        });
    });

    it("a proposal waits on the person", () => {
        const s = goalState([propose("t1", "tests pass", at(1))])!;
        expect(goalBandLine(s, now)).toMatchObject({
            label: "goal proposed",
            tone: "proposed",
            condition: "tests pass",
            meta: "",
        });
    });
});
