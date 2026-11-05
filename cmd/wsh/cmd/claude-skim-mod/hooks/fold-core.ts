// a long reply folds to its verdict and the lead of each top reason, behind a button that opens it in full.
// register.ts draws it; this is the cut.

// a reply longer than this many lines folds
export const FOLD_LINES = 10;

// at most this many reasons, each cut to its bold lead and first sentence
export const MAX_REASONS = 4;
export const MAX_REASON_CHARS = 160;

// the opened replies kept, newest last
export const MAX_OPENED = 200;

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
const TABLE_ROW = /^\s*\|/;
const FENCED = /^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm;

export function lineCount(text: string): number {
    return text.trim().split("\n").length;
}

export function canFold(text: string): boolean {
    return lineCount(text) > FOLD_LINES;
}

// the lead in bold and the sentence after it, or the first sentence
export function firstSentence(item: string): string {
    const lead = item.match(/^(\*\*[^*]+\*\*:?)\s*(.*)$/);
    const head = lead ? `${lead[1]} ` : "";
    const rest = lead ? (lead[2] ?? "") : item;
    const sentence = rest.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? rest;
    const out = (head + sentence).trim();
    return out.length > MAX_REASON_CHARS ? `${out.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…` : out;
}

// the first prose paragraph, then the lead of each item of the first list. code blocks, headings and tables are
// left out: the summary is to be read at a glance, and a cut fence would swallow the rest of it
export function summary(text: string): string {
    const blocks = text
        .replace(FENCED, "")
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block !== "");
    const lines = (block: string) => block.split("\n");
    const isList = (block: string) => lines(block).some((line) => ITEM.test(line));
    const isProse = (block: string) =>
        !isList(block) && !lines(block).every((line) => HEADING.test(line)) && !TABLE_ROW.test(block);
    const verdict = blocks.find(isProse) ?? "";
    const list = blocks.find(isList);
    if (!list) {
        return verdict;
    }
    const items = lines(list)
        .map((line) => line.match(ITEM)?.[1])
        .filter((item): item is string => item !== undefined);
    const shown = items.slice(0, MAX_REASONS).map((item) => `- ${firstSentence(item)}`);
    if (items.length > MAX_REASONS) {
        shown.push(`- … ${items.length - MAX_REASONS} more`);
    }
    return verdict === "" ? shown.join("\n") : `${verdict}\n\n${shown.join("\n")}`;
}

// the opened list with the reply opened or closed
export function toggleOpened(opened: readonly string[], hash: string): string[] {
    return opened.includes(hash) ? opened.filter((one) => one !== hash) : [...opened, hash].slice(-MAX_OPENED);
}
