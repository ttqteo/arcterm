// the session's /goal in the band above the prompt: one row, its label in its tone, the condition, the meter of
// checks and its counts. register.ts owns the state; goal-core.ts the words.
import type { Elements, RenderElement } from "claude-code";
import { drawCacheMiss } from "./cache-band";
import { goalBandLine, goalChecks, type GoalState } from "./goal-core";

const TONE = { proposed: "warning", active: "success", met: "success", stopped: "error" } as const;
const MARK = { hit: "▮", miss: "▮", next: "▯" } as const;
const MARK_TONE = { hit: "success", miss: "warning", next: "subtle" } as const;
const GLYPH = { proposed: "◎", active: "◎", met: "✓", stopped: "✗" } as const;

// the goal's row, and under it the turn's cache miss when there is one
export function drawGoal(
    els: Pick<Elements["terminal"], "Box" | "Text">,
    goal: GoalState,
    now: number,
    cacheMiss?: string | null
): RenderElement {
    const row = drawGoalRow(els, goal, now);
    if (!cacheMiss) {
        return row;
    }
    const { Box } = els;
    return (
        <Box flexDirection="column">
            {row}
            {drawCacheMiss(els, cacheMiss)}
        </Box>
    );
}

function drawGoalRow(
    { Box, Text }: Pick<Elements["terminal"], "Box" | "Text">,
    goal: GoalState,
    now: number
): RenderElement {
    const line = goalBandLine(goal, now);
    const marks = goalChecks(goal);
    return (
        <Box flexDirection="row" gap={2} borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text color={TONE[line.tone]} bold>
                {GLYPH[line.tone]} {line.label}
            </Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text wrap="truncate-end">{line.condition}</Text>
            </Box>
            {marks.length > 0 ? (
                // the misses always come before a hit, and the check to come is last: a run of each, a Text apiece
                <Text>
                    {(["miss", "hit", "next"] as const).map((m) => {
                        const n = marks.filter((x) => x === m).length;
                        return n > 0 ? <Text color={MARK_TONE[m]}>{MARK[m].repeat(n)}</Text> : null;
                    })}
                </Text>
            ) : null}
            {line.meta !== "" ? <Text dimColor>{line.meta}</Text> : null}
            {goal.phase === "proposed" ? <Text dimColor>answer in the dialog</Text> : null}
        </Box>
    );
}
