// a long reply folds to its verdict and the lead of each top reason, behind a button that opens it in full; a marked
// reply folds to its verdict and the sentences claude marked. register.ts draws it; this is the cut.

import { commandFenceEnd, commandSpans } from "./highlight-core";

// a reply longer than this many lines folds
export const FOLD_LINES = 10;

// at most this many reasons, each cut to its bold lead and first sentence. a list one longer shows whole: its
// "… 1 more" line would take the line the item takes
export const MAX_REASONS = 4;
// a lead takes the sentence after it only when both fit in this many characters
export const MAX_REASON_CHARS = 160;
// a sentence is never cut short of this; past it, at a space, since a reason cut mid-word reads as broken
export const MAX_SENTENCE_CHARS = 320;

// the opened replies kept, newest last
export const MAX_OPENED = 200;

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const NUMBERED = /^\s*(\d+[.)])\s/;
const HEADING = /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
const TABLE_ROW = /^\s*\|/;
const FENCED = /^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm;

export function lineCount(text: string): number {
    return text.trim().split("\n").length;
}

export function canFold(text: string): boolean {
    return lineCount(text) > FOLD_LINES;
}

// whether the reply's last line asks the person something. such a reply draws in full, like a turn whose last mark is
// the question: folded, it hid the question and the options it asks between, as a reply claude left unmarked did
export function endsOnQuestion(text: string): boolean {
    const last = text.trim().split("\n").at(-1) ?? "";
    return !/^\s*(```|~~~)/.test(last) && /[?？]$/.test(last.replace(/[\s*_)"'”’]+$/, ""));
}

// a fence holding only commands for the person to type, `! task install`
function isCommandFence(block: string): boolean {
    const lines = block.trim().split("\n");
    return commandFenceEnd(lines, 0) === lines.length - 1;
}

// the lead in bold and the sentence after it, the lead alone when that sentence would not fit, or the first sentence;
// whole sentences only, as the fixed cut it replaced fell mid-word on a long sentence after a lead
export function firstSentence(item: string): string {
    const sentenceOf = (text: string) => (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text).trim();
    const lead = item.match(/^(\*\*[^*]+\*\*:?)\s*(.*)$/);
    if (lead) {
        const withNext = `${lead[1]} ${sentenceOf(lead[2] ?? "")}`.trim();
        return withNext.length <= MAX_REASON_CHARS ? withNext : clip(lead[1]);
    }
    return clip(sentenceOf(item));
}

function clip(text: string): string {
    if (text.length <= MAX_SENTENCE_CHARS) {
        return text;
    }
    const cut = text.slice(0, MAX_SENTENCE_CHARS - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const LEAD = /^(\*\*[^*]+\*\*:?)\s/;

// the folded text, and the marks it holds in the order they show: layout draws marks in order and waits on one it
// cannot find, so a mark the fold left out would hold back every mark after it
export type Folded = { text: string; marks: string[] };

// the first prose paragraph, then the lead of each item of the first list; or, when claude marked the reply, the
// first prose paragraph and the marked sentences in the reply's order, since the marks are what must be read and a
// cut by position drops most of them. code blocks, headings and tables are left out: the summary is to be read at a
// glance, and a cut fence would swallow the rest of it. a fence of commands for the person to type stays in the
// marked fold, as the mark before it so often ends on a colon pointing at it
export function folded(text: string, marks: readonly string[]): Folded {
    const blocks = text
        .replace(FENCED, (fence) => (isCommandFence(fence) ? `\n\n${fence.trim()}\n\n` : ""))
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block !== "");
    const lines = (block: string) => block.split("\n");
    const isList = (block: string) => lines(block).some((line) => ITEM.test(line));
    const isProse = (block: string) =>
        !isList(block) &&
        !lines(block).every((line) => HEADING.test(line)) &&
        !TABLE_ROW.test(block) &&
        !isCommandFence(block);
    const at = blocks.findIndex(isProse);
    // a verdict ending on a colon ("answering when it ends:") points at the paragraph after it, which holds the
    // answer: folded without it, the verdict promised what the fold then hid
    const verdict = at >= 0 && /:$/.test(blocks[at]) && isProse(blocks[at + 1] ?? "") ? [at, at + 1] : [at];
    const wanted = marks.filter((mark) => mark.trim() !== "");
    if (wanted.length > 0) {
        return foldMarked(blocks, verdict, wanted);
    }
    const lead = verdict.map((i) => blocks[i] ?? "").join("\n\n");
    return { text: byPosition(lead, blocks.find(isList)), marks: [] };
}

export function summary(text: string, marks: readonly string[] = []): string {
    return folded(text, marks).text;
}

// the verdict whole, then each line holding a mark as its marks alone: an item's behind its bullet and bold lead,
// the items of a run kept as one list. a command for the person to type is as much a must-read as a mark, so a
// command fence stays whole and a command's code span stays beside its line's marks
function foldMarked(blocks: readonly string[], verdictAt: readonly number[], marks: readonly string[]): Folded {
    const left = [...marks];
    const kept: string[] = [];
    const take = (line: string): string[] => {
        const found = left.filter((mark) => line.includes(mark));
        found.forEach((mark) => left.splice(left.indexOf(mark), 1));
        kept.push(...found);
        return found;
    };
    const parts: { text: string; isItem: boolean }[] = [];
    // the heading of the section the walk is in, until a mark under it shows: then it shows once, above that mark, so
    // "the list is not built" still says it is the Stack's list
    let heading: string | undefined;
    blocks.forEach((block, i) => {
        if (verdictAt.includes(i)) {
            block.split("\n").forEach(take);
            parts.push({ text: block, isItem: false });
            return;
        }
        if (isCommandFence(block)) {
            parts.push({ text: block, isItem: false });
            return;
        }
        for (const line of block.split("\n")) {
            const found = take(line);
            if (found.length === 0 && HEADING.test(line) && !ITEM.test(line)) {
                heading = line.trim();
                continue;
            }
            const commands = commandSpans(line)
                .map(([from, to]) => ({ at: from, text: line.slice(from, to) }))
                .filter(({ text }) => !found.some((mark) => mark.includes(text)));
            const shown = [...found.map((mark) => ({ at: line.indexOf(mark), text: mark })), ...commands]
                .sort((a, b) => a.at - b.at)
                .map(({ text }) => text);
            if (shown.length === 0) {
                continue;
            }
            if (heading !== undefined) {
                parts.push({ text: heading, isItem: false });
                heading = undefined;
            }
            const item = line.match(ITEM)?.[1];
            if (item === undefined) {
                parts.push({ text: shown.join(" "), isItem: false });
                continue;
            }
            const lead = item.match(LEAD)?.[1];
            const head = lead && !(shown[0] ?? "").includes(lead) ? `${lead} ` : "";
            parts.push({ text: `- ${head}${shown.join(" ")}`, isItem: true });
        }
    });
    const text = parts
        .map((part, i) => (i === 0 ? "" : part.isItem && parts[i - 1]?.isItem ? "\n" : "\n\n") + part.text)
        .join("");
    return { text, marks: kept };
}

function byPosition(verdict: string, list: string | undefined): string {
    const lines = (block: string) => block.split("\n");
    if (!list) {
        return verdict;
    }
    const items = lines(list).filter((line) => ITEM.test(line));
    const keep = items.length <= MAX_REASONS + 1 ? items.length : MAX_REASONS;
    // a numbered item keeps its number, so a reply's "type 2" still points at it; the items kept run from the first,
    // so the numbers stay in order
    const shown = items
        .slice(0, keep)
        .map((line) => `${line.match(NUMBERED)?.[1] ?? "-"} ${firstSentence(line.match(ITEM)?.[1] ?? "")}`);
    if (items.length > keep) {
        shown.push(`- … ${items.length - keep} more`);
    }
    return verdict === "" ? shown.join("\n") : `${verdict}\n\n${shown.join("\n")}`;
}

// the opened list with the reply opened or closed
export function toggleOpened(opened: readonly string[], hash: string): string[] {
    return opened.includes(hash) ? opened.filter((one) => one !== hash) : [...opened, hash].slice(-MAX_OPENED);
}
