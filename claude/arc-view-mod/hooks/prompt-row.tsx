// the transcript row for a prompt arcterm put into the session: its role and tags, a label column of what it names,
// and its own text where it has one. what the card shows is prompt-core.ts's; this only lays out the props it is
// handed.
import type { Elements, RenderElement } from "claude-code";
import type { Card, Field } from "./prompt-core";
import { cardHeader, labelWidth } from "./prompt-core";

type RowElements = Pick<Elements["terminal"], "Box" | "Text">;

// how many of a card's own lines the row shows before it counts the rest
const MAX_BODY_LINES = 3;
const SHOWS_ALL = "ctrl+o shows all";
const INDENT = 2;

function drawField({ Box, Text }: RowElements, f: Field, width: number): RenderElement {
    return (
        <Box gap={1}>
            <Text dimColor>{f.label.padEnd(width)}</Text>
            {/* a path's end names the file, so a long one loses its middle */}
            <Text wrap={f.isPath ? "truncate-middle" : "truncate-end"}>{f.value}</Text>
        </Box>
    );
}

export function drawPromptRow(els: RowElements, c: Card): RenderElement {
    const { Box, Text } = els;
    const width = labelWidth(c);
    const hidden = c.body.length - MAX_BODY_LINES;
    return (
        <Box flexDirection="column">
            <Box justifyContent="space-between">
                <Text bold wrap="truncate-end">
                    {cardHeader(c)}
                </Text>
                {c.isAbridged && <Text dimColor>{SHOWS_ALL}</Text>}
            </Box>
            <Box flexDirection="column" paddingLeft={INDENT}>
                {c.fields.map((f) => drawField(els, f, width))}
                {c.body.slice(0, MAX_BODY_LINES).map((line) => (
                    <Text wrap="truncate-end">{line}</Text>
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
