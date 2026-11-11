// A session's /goal as its transcript holds it, for the band above the prompt (register.ts) and for arcterm's Chat
// (frontend/app/view/agents/chatgoal.tsx reads this file too). Pure: no engine, no DOM.
//
// Claude Code (2.1.322) writes a goal as `goal_status` attachment records:
//   set:      { met: false, sentinel: true, condition }   (a compaction writes it again for the goal still active)
//   cleared:  { met: true,  sentinel: true, condition }   (/goal clear, or cleared after an unrecoverable error)
//   a check:  { met: false, condition, reason }           (the evaluator says not yet; Claude works on)
//   met:      { met: true,  condition, reason, iterations, durationMs, tokens }
//   stopped:  { met: false, failed: true, condition, reason, iterations, durationMs, tokens }
// and a goal the model proposes as a ProposeGoal tool call, answered (approved or declined) by its tool result.

export type GoalEntry = {
    type?: string;
    timestamp?: string;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    isSidechain?: boolean;
    attachment?: {
        type?: string;
        met?: boolean;
        sentinel?: boolean;
        failed?: boolean;
        condition?: string;
        reason?: string;
        iterations?: number;
        durationMs?: number;
        tokens?: number;
    };
    message?: {
        content?:
            | string
            | readonly { type?: string; id?: string; name?: string; tool_use_id?: string; input?: unknown }[];
    };
};

export type GoalPhase = "proposed" | "active" | "met" | "stopped";

export interface GoalCheck {
    met: boolean;
    reason: string;
    at: number; // ms; NaN when the record had no time
}

export interface GoalState {
    phase: GoalPhase;
    condition: string;
    setAt: number; // when it was set (or proposed); NaN when the lines read do not reach it
    checks: GoalCheck[]; // the evaluator's verdicts since it was set, oldest first
    reason?: string; // the newest verdict's
    iterations?: number; // the evaluator's own counts, on a met or stopped goal
    durationMs?: number;
    tokens?: number;
    // a met or stopped goal you have sent a prompt after: a view folds it away
    settledBeforePrompt: boolean;
}

function ms(ts: string | undefined): number {
    return typeof ts === "string" ? Date.parse(ts) : NaN;
}

// a prompt you sent: your text, not a tool's result, a meta record or a summary
function isPrompt(e: GoalEntry): boolean {
    if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.isSidechain) {
        return false;
    }
    const content = e.message?.content;
    if (typeof content === "string") {
        return content.trim() !== "";
    }
    return Array.isArray(content) && content.some((b) => b?.type === "text");
}

function blocks(
    e: GoalEntry
): readonly { type?: string; id?: string; name?: string; tool_use_id?: string; input?: unknown }[] {
    const content = e.message?.content;
    return Array.isArray(content) ? content : [];
}

/** Pure: the session's goal at the end of `entries` (its transcript records, oldest first), or null when it has none:
 *  never set, cleared, or a proposal answered with no set after it. */
export function goalState(entries: readonly GoalEntry[]): GoalState | null {
    let goal: GoalState | null = null;
    let proposal: { id: string; condition: string; at: number } | null = null;
    for (const e of entries) {
        if (e.isSidechain) {
            continue;
        }
        const a = e.attachment;
        if (e.type === "attachment" && a?.type === "goal_status" && typeof a.condition === "string") {
            const at = ms(e.timestamp);
            if (a.sentinel) {
                if (a.met) {
                    goal = null;
                } else if (goal == null || goal.condition !== a.condition || goal.phase !== "active") {
                    goal = {
                        phase: "active",
                        condition: a.condition,
                        setAt: at,
                        checks: [],
                        settledBeforePrompt: false,
                    };
                }
                proposal = null;
                continue;
            }
            if (goal == null || goal.condition !== a.condition) {
                goal = { phase: "active", condition: a.condition, setAt: NaN, checks: [], settledBeforePrompt: false };
            }
            const reason = typeof a.reason === "string" ? a.reason : "";
            goal.checks.push({ met: a.met === true, reason, at });
            goal.reason = reason;
            if (a.met || a.failed) {
                goal.phase = a.met ? "met" : "stopped";
                goal.iterations = a.iterations;
                goal.durationMs = a.durationMs;
                goal.tokens = a.tokens;
            }
            continue;
        }
        if (e.type === "assistant") {
            for (const b of blocks(e)) {
                const condition = (b.input as { condition?: unknown } | undefined)?.condition;
                if (
                    b.type === "tool_use" &&
                    b.name === "ProposeGoal" &&
                    typeof b.id === "string" &&
                    typeof condition === "string"
                ) {
                    proposal = { id: b.id, condition, at: ms(e.timestamp) };
                }
            }
            continue;
        }
        if (e.type === "user") {
            if (proposal != null && blocks(e).some((b) => b.type === "tool_result" && b.tool_use_id === proposal!.id)) {
                proposal = null;
            }
            if (goal != null && goal.phase !== "active" && isPrompt(e)) {
                goal.settledBeforePrompt = true;
            }
        }
    }
    if (proposal != null && (goal == null || goal.phase !== "active")) {
        return {
            phase: "proposed",
            condition: proposal.condition,
            setAt: proposal.at,
            checks: [],
            settledBeforePrompt: false,
        };
    }
    return goal;
}

/** Pure: goalState from raw transcript lines (JSONL), parsing only what it reads: the goal's own records, and the user
 *  records after the last of them (a proposal's answer, a prompt after a settled goal). Null at once for lines with
 *  none, the common case, so a long conversation is not parsed on every append. */
export function goalFromLines(lines: readonly string[]): GoalState | null {
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('"goal_status"') || lines[i].includes('"ProposeGoal"')) {
            last = i;
            break;
        }
    }
    if (last < 0) {
        return null;
    }
    const entries: GoalEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const goalLine = line.includes('"goal_status"') || line.includes('"ProposeGoal"');
        if (!goalLine && !(i > last && line.includes('"type":"user"'))) {
            continue;
        }
        try {
            entries.push(JSON.parse(line));
        } catch {
            continue;
        }
    }
    return goalState(entries);
}

export type GoalMark = "hit" | "miss" | "next";

/** Pure: the goal's meter, a mark per check (hit or miss), the last eight, and while it is active one more for the check
 *  to come. */
export function goalChecks(s: GoalState): GoalMark[] {
    const marks: GoalMark[] = s.checks.slice(-8).map((c) => (c.met ? "hit" : "miss"));
    return s.phase === "active" ? [...marks, "next"] : marks;
}

// "34s", "4m 12s", "1h 4m"
export function shortDuration(msec: number): string {
    const secs = Math.max(0, Math.floor(msec / 1000));
    if (secs < 60) {
        return `${secs}s`;
    }
    const mins = Math.floor(secs / 60);
    if (mins < 60) {
        return `${mins}m ${secs % 60}s`;
    }
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// "860", "48k", "1.2M"
function shortTokens(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    }
    if (n >= 1_000) {
        return `${Math.round(n / 1_000)}k`;
    }
    return String(n);
}

export type GoalTone = "proposed" | "active" | "met" | "stopped";

export interface GoalLine {
    label: string; // "goal", "goal met", "goal stopped", "goal proposed"
    tone: GoalTone;
    condition: string;
    meta: string; // "check 3 · 4m 12s", "4 checks · 12m 0s · ↓48k", "" for a proposal
}

function checksWord(n: number): string {
    return `${n} ${n === 1 ? "check" : "checks"}`;
}

/** Pure: the band's words for a goal at `now` (ms): an active one counts its checks and runs its clock from when it was
 *  set; a met or stopped one gives the evaluator's own counts. */
export function goalBandLine(s: GoalState, now: number): GoalLine {
    switch (s.phase) {
        case "proposed":
            return { label: "goal proposed", tone: "proposed", condition: s.condition, meta: "" };
        case "active": {
            const parts = [`check ${s.checks.length}`];
            if (Number.isFinite(s.setAt)) {
                parts.push(shortDuration(now - s.setAt));
            }
            return { label: "goal", tone: "active", condition: s.condition, meta: parts.join(" · ") };
        }
        case "met":
        case "stopped": {
            const parts = [checksWord(s.iterations ?? s.checks.length)];
            if (s.durationMs != null) {
                parts.push(shortDuration(s.durationMs));
            }
            if (s.tokens != null && s.tokens > 0) {
                parts.push(`↓${shortTokens(s.tokens)}`);
            }
            return {
                label: s.phase === "met" ? "goal met" : "goal stopped",
                tone: s.phase,
                condition: s.condition,
                meta: parts.join(" · "),
            };
        }
    }
}
