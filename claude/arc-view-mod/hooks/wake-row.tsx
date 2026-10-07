// the transcript row for a wake the cockpit sent over the stream, under the engine's own line naming
// the arc plugin: its events, what passed unverified, and a count of the recaps.
import type { Elements, RenderElement } from "claude-code";
import type { Wake, WakeEvent, WakeKind } from "./wake-core";
import { commandFits, EVENT_INDENT, recapLine, wakeSummary } from "./wake-core";

type RowElements = Pick<Elements["terminal"], "Box" | "Text">;

// claude draws a colour name in an rgb of its own, so these do not follow the cockpit theme
const MARKS: Record<WakeKind, { glyph: string; color: string }> = {
    alert: { glyph: "!", color: "red" },
    note: { glyph: "i", color: "blue" },
    done: { glyph: "✓", color: "green" },
    question: { glyph: "?", color: "yellow" },
};
const CAVEAT_COLOR = "yellow";

// how many of the lines after a headline the row shows before it counts the rest
const MAX_MORE_LINES = 2;
const SHOWS_ALL = "ctrl+o shows all";

function drawEvent({ Box, Text }: RowElements, event: WakeEvent, columns: number): RenderElement {
    const mark = MARKS[event.kind];
    const isBeside = event.command !== "" && commandFits(event, columns);
    const hidden = event.more.length - MAX_MORE_LINES;
    return (
        <Box flexDirection="column">
            <Box justifyContent="space-between">
                <Box gap={1} paddingLeft={EVENT_INDENT - 2}>
                    <Text bold color={mark.color}>
                        {mark.glyph}
                    </Text>
                    <Text wrap="truncate-end">{event.headline}</Text>
                </Box>
                {isBeside && <Text dimColor>{event.command}</Text>}
            </Box>
            <Box flexDirection="column" paddingLeft={EVENT_INDENT}>
                {event.command !== "" && !isBeside && <Text dimColor>{event.command}</Text>}
                {event.more.slice(0, MAX_MORE_LINES).map((line) => (
                    <Text dimColor wrap="truncate-end">
                        {line}
                    </Text>
                ))}
                {hidden > 0 && (
                    <Text dimColor>
                        + {hidden} more {hidden === 1 ? "line" : "lines"}, {SHOWS_ALL}
                    </Text>
                )}
            </Box>
        </Box>
    );
}

export function drawWakeRow(els: RowElements, wake: Wake, columns: number): RenderElement {
    const { Box, Text } = els;
    return (
        <Box flexDirection="column">
            <Text dimColor>{wakeSummary(wake)}</Text>
            {wake.events.map((event) => drawEvent(els, event, columns))}
            {wake.caveats.map((caveat) => (
                <Box gap={1} paddingLeft={EVENT_INDENT - 2}>
                    <Text color={CAVEAT_COLOR}>~</Text>
                    <Text dimColor wrap="truncate-end">
                        unverified {caveat}
                    </Text>
                </Box>
            ))}
            {wake.recaps > 0 && (
                <Box justifyContent="space-between" paddingLeft={EVENT_INDENT - 2}>
                    <Text dimColor>· {recapLine(wake.recaps)}</Text>
                    <Text dimColor>{SHOWS_ALL}</Text>
                </Box>
            )}
        </Box>
    );
}
