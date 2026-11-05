// a long reply folds to its verdict and the lead of each top reason, behind a button that opens it in full; a marked
// reply folds to its verdict and the sentences claude marked. register.ts draws it; this is the cut.

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

const LEAD = /^(\*\*[^*]+\*\*:?)\s/;

// the folded text, and the marks it holds in the order they show: layout draws marks in order and waits on one it
// cannot find, so a mark the fold left out would hold back every mark after it
export type Folded = { text: string; marks: string[] };

// the first prose paragraph, then the lead of each item of the first list; or, when claude marked the reply, the
// first prose paragraph and the marked sentences in the reply's order, since the marks are what must be read and a
// cut by position drops most of them. code blocks, headings and tables are left out: the summary is to be read at a
// glance, and a cut fence would swallow the rest of it
export function folded(text: string, marks: readonly string[]): Folded {
    const blocks = text
        .replace(FENCED, "")
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block !== "");
    const lines = (block: string) => block.split("\n");
    const isList = (block: string) => lines(block).some((line) => ITEM.test(line));
    const isProse = (block: string) =>
        !isList(block) && !lines(block).every((line) => HEADING.test(line)) && !TABLE_ROW.test(block);
    const at = blocks.findIndex(isProse);
    const wanted = marks.filter((mark) => mark.trim() !== "");
    if (wanted.length > 0) {
        return foldMarked(blocks, at, wanted);
    }
    return { text: byPosition(blocks, blocks[at] ?? "", blocks.find(isList)), marks: [] };
}

export function summary(text: string, marks: readonly string[] = []): string {
    return folded(text, marks).text;
}

// the verdict whole, then each line holding a mark as its marks alone: an item's behind its bullet and bold lead,
// the items of a run kept as one list
function foldMarked(blocks: readonly string[], verdictAt: number, marks: readonly string[]): Folded {
    const left = [...marks];
    const kept: string[] = [];
    const take = (line: string): string[] => {
        const found = left.filter((mark) => line.includes(mark));
        found.forEach((mark) => left.splice(left.indexOf(mark), 1));
        kept.push(...found);
        return found;
    };
    const parts: { text: string; isItem: boolean }[] = [];
    blocks.forEach((block, i) => {
        if (i === verdictAt) {
            block.split("\n").forEach(take);
            parts.push({ text: block, isItem: false });
            return;
        }
        for (const line of block.split("\n")) {
            const found = take(line);
            if (found.length === 0) {
                continue;
            }
            const item = line.match(ITEM)?.[1];
            if (item === undefined) {
                parts.push({ text: found.join(" "), isItem: false });
                continue;
            }
            const lead = item.match(LEAD)?.[1];
            const head = lead && !(found[0] ?? "").includes(lead) ? `${lead} ` : "";
            parts.push({ text: `- ${head}${found.join(" ")}`, isItem: true });
        }
    });
    const text = parts
        .map((part, i) => (i === 0 ? "" : part.isItem && parts[i - 1]?.isItem ? "\n" : "\n\n") + part.text)
        .join("");
    return { text, marks: kept };
}

function byPosition(blocks: readonly string[], verdict: string, list: string | undefined): string {
    const lines = (block: string) => block.split("\n");
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
