// the must-read sentences of a reply: claude wraps them in ==…== (the prompt section below asks it to), the mod
// strips the marks before the reply is stored and draws the sentences highlighted in the terminal alone. so a
// copy, the transcript file, `wsh agents` and the model's next turn all read the reply without them.
// highlight-row.tsx does the drawing; register.ts the hooks.

export const MARK = "==";

// what the model is told; fixed text, so the system prompt's cache never moves for it
export const HIGHLIGHT_SECTION = [
    "Highlighting in replies: the person reads your replies in a terminal that draws text wrapped in ==double equals== highlighted, and strips the marks everywhere else (copies, the saved transcript).",
    "- When a reply explains something at length, wrap the 2-4 sentences the person must read to get the point in ==…==. Mark whole sentences, never a whole paragraph, and nothing in a short reply.",
    '- In a brainstorming or design turn, mark only the question you are waiting on the person to answer, as the last marked sentence, ending with "?". Never mark your own recommendation.',
    "- Marks go in your reply text only: never in files, code, commands, commit messages or tool inputs, and never inside code spans or blocks.",
].join("\n");

// past these a mark is still stripped but drawn as plain text: a highlight that covers everything shows nothing
export const MAX_MARKS = 4;
export const MAX_MARK_LENGTH = 300;

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const TABLE_ROW = /^\s*\|/;

// a mark opens on == followed by a non-space and closes on a non-space followed by ==, within one line, so
// `a == b` in prose is no mark
function isOpen(line: string, at: number): boolean {
    return line.startsWith(MARK, at) && at + 2 < line.length && !/\s|=/.test(line.charAt(at + 2));
}

// the closing ==, past any inline code the mark holds; -1 when the line has none
function closeOf(line: string, from: number): number {
    let at = from;
    while (at < line.length) {
        if (line[at] === "`") {
            const end = line.indexOf("`", at + 1);
            if (end < 0) {
                return -1;
            }
            at = end + 1;
            continue;
        }
        if (at > from && line.startsWith(MARK, at) && !/\s/.test(line.charAt(at - 1))) {
            return at;
        }
        at++;
    }
    return -1;
}

// strips one line's marks outside inline code; the marked texts in order
function stripLine(line: string): { text: string; marks: string[] } {
    let text = "";
    const marks: string[] = [];
    let at = 0;
    while (at < line.length) {
        if (line[at] === "`") {
            const end = line.indexOf("`", at + 1);
            const stop = end < 0 ? line.length : end + 1;
            text += line.slice(at, stop);
            at = stop;
            continue;
        }
        const close = isOpen(line, at) ? closeOf(line, at + 2) : -1;
        if (close >= 0) {
            const inner = line.slice(at + 2, close);
            text += inner;
            marks.push(inner);
            at = close + 2;
            continue;
        }
        text += line[at];
        at++;
    }
    return { text, marks };
}

// the reply less its marks, and what they marked; code fences pass untouched
export function parseMarks(reply: string): { clean: string; marks: string[] } {
    const lines: string[] = [];
    const marks: string[] = [];
    let inFence = false;
    for (const line of reply.split("\n")) {
        if (FENCE.test(line)) {
            inFence = !inFence;
            lines.push(line);
            continue;
        }
        if (inFence || !line.includes(MARK)) {
            lines.push(line);
            continue;
        }
        const stripped = stripLine(line);
        lines.push(stripped.text);
        marks.push(...stripped.marks);
    }
    return { clean: lines.join("\n"), marks };
}

// the marks that are drawn: the first few short enough to read as a sentence
export function shownMarks(marks: readonly string[]): string[] {
    return marks.filter((m) => m.trim() !== "" && m.length <= MAX_MARK_LENGTH).slice(0, MAX_MARKS);
}

// the question waiting on the person: the last mark, when it asks one
export function askOf(marks: readonly string[]): string | null {
    const last = marks.at(-1)?.trim();
    return last && /[?？]$/.test(last) ? last : null;
}

// FNV-1a over the stored text, the key the marks are kept under once the reply is stored without them
export function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}

// the replies' marks across sessions, newest last; a stored reply past the cap draws without its highlight
export const MAX_KEPT = 500;
export function keepMarks(kept: [string, string[]][], hash: string, marks: string[]): [string, string[]][] {
    return [...kept.filter(([h]) => h !== hash), [hash, marks] as [string, string[]]].slice(-MAX_KEPT);
}

export type Run = { text: string; isMarked?: true; isBold?: true; isItalic?: true; isCode?: true; isStrike?: true };

export type Segment =
    // markdown the engine draws as it draws a reply
    | { kind: "markdown"; text: string; isDim: boolean }
    // one line holding a mark, drawn run by run: its list marker apart, so a wrapped item hangs
    | { kind: "line"; prefix: string; runs: Run[]; isHeading: boolean }
    // a blank line between the two
    | { kind: "gap" };

// a line's inline markdown as styled runs, `marked` the char ranges of the source line to highlight.
// handles **bold**, *italic*, ~~strike~~, `code` and [text](url) (drawn as its text); anything unclosed is literal
export function inlineRuns(line: string, marked: readonly [number, number][]): Run[] {
    const runs: Run[] = [];
    const isMarkedAt = (at: number) => marked.some(([from, to]) => at >= from && at < to);
    const push = (text: string, at: number, style: Omit<Run, "text" | "isMarked">) => {
        for (let i = 0; i < text.length; i++) {
            const isMarked = isMarkedAt(at + i);
            const last = runs.at(-1);
            const same =
                last &&
                !!last.isMarked === isMarked &&
                !!last.isBold === !!style.isBold &&
                !!last.isItalic === !!style.isItalic &&
                !!last.isCode === !!style.isCode &&
                !!last.isStrike === !!style.isStrike;
            if (same) {
                last.text += text.charAt(i);
            } else {
                runs.push({ text: text.charAt(i), ...style, ...(isMarked ? { isMarked: true } : {}) });
            }
        }
    };
    let isBold = false;
    let isItalic = false;
    let isStrike = false;
    const style = () => ({
        ...(isBold ? { isBold: true as const } : {}),
        ...(isItalic ? { isItalic: true as const } : {}),
        ...(isStrike ? { isStrike: true as const } : {}),
    });
    let at = 0;
    while (at < line.length) {
        const rest = line.slice(at);
        if (rest[0] === "`") {
            const end = line.indexOf("`", at + 1);
            if (end > at) {
                push(line.slice(at + 1, end), at + 1, { ...style(), isCode: true });
                at = end + 1;
                continue;
            }
        }
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
        if (link) {
            push(link[1] ?? "", at + 1, style());
            at += link[0].length;
            continue;
        }
        if (rest.startsWith("**") && (isBold || line.indexOf("**", at + 2) > at + 2)) {
            isBold = !isBold;
            at += 2;
            continue;
        }
        if (rest.startsWith("~~") && (isStrike || line.indexOf("~~", at + 2) > at + 2)) {
            isStrike = !isStrike;
            at += 2;
            continue;
        }
        if (rest[0] === "*" && rest[1] !== " " && (isItalic || line.indexOf("*", at + 1) > at + 1)) {
            isItalic = !isItalic;
            at += 1;
            continue;
        }
        push(rest.charAt(0), at, style());
        at += 1;
    }
    return runs;
}

// the stored reply cut into what the engine draws as markdown and the lines holding a mark. under skim a
// heading is its own undimmed block, so the reply keeps its outline while the rest fades.
export function layout(clean: string, marks: readonly string[], isSkim: boolean): Segment[] {
    const segments: Segment[] = [];
    let chunk: string[] = [];
    // the markdown gathered since the last marked line; its blank edges become gaps, none at the reply's ends
    const flush = (isEnd: boolean) => {
        let lead = 0;
        while (lead < chunk.length && (chunk[lead] ?? "").trim() === "") lead++;
        let tail = chunk.length;
        while (tail > lead && (chunk[tail - 1] ?? "").trim() === "") tail--;
        if (lead > 0 && segments.length > 0 && !(isEnd && tail === lead)) segments.push({ kind: "gap" });
        if (tail > lead) segments.push({ kind: "markdown", text: chunk.slice(lead, tail).join("\n"), isDim: isSkim });
        if (tail < chunk.length && tail > lead && !isEnd) segments.push({ kind: "gap" });
        chunk = [];
    };
    const pending = [...marks];
    let inFence = false;
    for (const line of clean.split("\n")) {
        if (FENCE.test(line)) {
            inFence = !inFence;
        }
        const ranges: [number, number][] = [];
        // a table row stays the engine's: one row drawn apart would break the table
        if (!inFence && !FENCE.test(line) && !TABLE_ROW.test(line)) {
            let from = 0;
            for (let want = pending[0]; want !== undefined; want = pending[0]) {
                const at = line.indexOf(want, from);
                if (at < 0) break;
                ranges.push([at, at + want.length]);
                from = at + want.length;
                pending.shift();
            }
        }
        const isHeading = !inFence && HEADING.test(line);
        if (ranges.length === 0 && !(isSkim && isHeading)) {
            chunk.push(line);
            continue;
        }
        flush(false);
        if (ranges.length === 0) {
            segments.push({ kind: "markdown", text: line, isDim: false });
            continue;
        }
        const heading = /^\s*#{1,6}\s+/.exec(line);
        const item = heading ? null : LIST_ITEM.exec(line);
        const cut = (heading ?? item)?.[0].length ?? 0;
        const shifted = ranges.map(([a, b]) => [a - cut, b - cut] as [number, number]);
        const runs = inlineRuns(line.slice(cut), shifted).map((run) =>
            heading ? { ...run, isBold: true as const } : run
        );
        segments.push({ kind: "line", prefix: item?.[1] ?? "", runs, isHeading: !!heading });
    }
    flush(true);
    return segments;
}

// whether the rows of a reply holding the question are in view: the question starts `rowsFromAsk` rows before the
// reply's end. onScreen is `{ first, last, of }` from the site's first row, null off screen
export function isAskInView(onScreen: { first: number; last: number; of: number } | null, rowsFromAsk: number): boolean {
    if (onScreen === null) {
        return false;
    }
    const start = Math.max(0, onScreen.of - rowsFromAsk);
    return onScreen.last >= start && onScreen.first <= onScreen.of - 1;
}

// how many rows the reply takes from the line holding the question to its end, at `columns` wide
export function rowsFromAsk(clean: string, ask: string, columns: number): number {
    const lines = clean.split("\n");
    const from = lines.findIndex((line) => line.includes(ask));
    const width = Math.max(1, columns);
    return lines
        .slice(from < 0 ? lines.length - 1 : from)
        .reduce((rows, line) => rows + Math.max(1, Math.ceil([...line].length / width)), 0);
}
