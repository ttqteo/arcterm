// a reply with marked sentences, as the terminal draws it: the engine's markdown for the unmarked parts, and each
// line holding a mark run by run, the marked runs on a tinted ground. highlight-core.ts cuts the reply.
import type { Elements, RenderElement } from "claude-code";
import type { Run, Segment } from "./highlight-core";

type RowElements = Pick<Elements["terminal"], "Box" | "Text" | "Markdown">;

export type Palette = { markBg: string; markFg?: string };

// a terminal colour has no alpha, so each theme gets a tint of claude's own orange made for its ground
const DARK: Palette = { markBg: "#4a3027", markFg: "#f6f3ec" };
const LIGHT: Palette = { markBg: "#f6dccf" };

export function paletteFor(theme: unknown): Palette {
    return String(theme ?? "").startsWith("light") ? LIGHT : DARK;
}

// inline code in claude's replies is drawn in its theme's `permission` colour
const CODE_COLOR = "permission";

function drawRun({ Text }: RowElements, run: Run, isSkim: boolean, palette: Palette): RenderElement {
    const marked = run.isMarked ? { backgroundColor: palette.markBg, ...(palette.markFg ? { color: palette.markFg } : {}) } : {};
    return (
        <Text
            {...(run.isBold ? { bold: true } : {})}
            {...(run.isItalic ? { italic: true } : {})}
            {...(run.isStrike ? { strikethrough: true } : {})}
            {...(run.isCode ? { color: CODE_COLOR } : {})}
            {...marked}
            {...(isSkim && !run.isMarked && !run.isLead ? { dimColor: true } : {})}
        >
            {run.text}
        </Text>
    );
}

function drawSegment(els: RowElements, segment: Segment, isSkim: boolean, palette: Palette): RenderElement {
    const { Box, Text, Markdown } = els;
    if (segment.kind === "gap") {
        return <Text> </Text>;
    }
    if (segment.kind === "markdown") {
        return <Markdown text={segment.text} {...(segment.isDim ? { dimColor: true } : {})} />;
    }
    const isDimPrefix = isSkim && !segment.isHeading;
    return (
        <Box>
            {segment.prefix !== "" && <Text {...(isDimPrefix ? { dimColor: true } : {})}>{segment.prefix}</Text>}
            <Text>{segment.runs.map((run) => drawRun(els, run, isSkim && !segment.isHeading, palette))}</Text>
        </Box>
    );
}

// the row as the engine frames a reply, since a hook's tree replaces the frame too: a blank line above, and the text
// two columns in, behind the bullet on the block that opens the reply
const BULLET = "⏺";

export function drawHighlighted(
    els: RowElements,
    segments: Segment[],
    isSkim: boolean,
    palette: Palette,
    isFirstOfReply: boolean
): RenderElement {
    const { Box, Text } = els;
    return (
        <Box marginTop={1}>
            <Box width={2} minWidth={2} flexShrink={0}>
                {isFirstOfReply && <Text>{BULLET}</Text>}
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {segments.map((segment) => drawSegment(els, segment, isSkim, palette))}
            </Box>
        </Box>
    );
}

// the line above the prompt while the question a reply asks is out of view, over whatever the band held
export function drawAskLine(
    { Box, Text }: Pick<Elements["terminal"], "Box" | "Text">,
    ask: string,
    below: RenderElement
): RenderElement {
    return (
        <Box flexDirection="column">
            <Box gap={1}>
                <Text color="claude">?</Text>
                <Text wrap="truncate-end">
                    <Text color="claude">Waiting on you</Text>
                    <Text dimColor> · </Text>
                    {ask}
                </Text>
            </Box>
            {below}
        </Box>
    );
}
