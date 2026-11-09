// a reply read as sections: the opening (what comes before the first title), then one section per title, a markdown
// heading or a bold label standing on its own line. the fold and the skim bench's rules read a reply the same way

import { commandFenceEnd } from "./highlight-core";

export const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
// a heading, or a bold label alone on its line ("**Found not fixed:**"); a list item never is one
export const TITLE = /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/;
export const TABLE_ROW = /^\s*\|/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;
const FENCE = /^\s*(```|~~~)/;
export const FENCED = /^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm;

// the stand-in for a section that is only a table or only code: its one line in a fold, never raw rows or code
export const STUB = /^\((?:table · \d+ rows?|code · \d+ lines?)\)$/;

// title is null for the opening; lines are the section's own, the title's line left out, fences kept whole
export type Section = { title: string | null; lines: string[] };

export function isTitle(line: string): boolean {
    return TITLE.test(line) && !ITEM.test(line);
}

// a fence holding only commands for the person to type, `! task install`
export function isCommandFence(block: string): boolean {
    const lines = block.trim().split("\n");
    return commandFenceEnd(lines, 0) === lines.length - 1;
}

// the reply's sections in order. a line inside a fence is never a title, as a `# comment` in a shell block is not a
// heading. the opening is left out when nothing comes before the first title
export function sections(text: string): Section[] {
    const out: Section[] = [{ title: null, lines: [] }];
    let fence: string | null = null;
    for (const line of text.split("\n")) {
        const marker = line.match(FENCE)?.[1];
        if (marker !== undefined) {
            fence = fence === null ? marker : fence === marker ? null : fence;
        } else if (fence === null && isTitle(line)) {
            out.push({ title: line.trim(), lines: [] });
            continue;
        }
        out.at(-1)?.lines.push(line);
    }
    return out.filter((section, i) => i > 0 || hasContent(section));
}

export function hasContent(section: Section): boolean {
    return section.lines.some((line) => line.trim() !== "");
}

// a title as it reads, without its markdown: "## Found not fixed" and "**Found not fixed:**" are the same section
export function titleKey(title: string): string {
    return title
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/:\s*$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

// the one line a section that is only a table or only code shows as, "(table · 12 rows)" or "(code · 8 lines)"; null
// for a section holding anything else. a fence of commands for the person to type is not code here: it stays whole
export function stubOf(section: Section): string | null {
    const body = section.lines.filter((line) => line.trim() !== "");
    if (body.length === 0) {
        return null;
    }
    if (body.every((line) => TABLE_ROW.test(line))) {
        const rows = body.filter((line) => !TABLE_RULE.test(line)).length - 1;
        return `(table · ${Math.max(rows, 0)} ${rows === 1 ? "row" : "rows"})`;
    }
    const text = section.lines.join("\n");
    const fences = text.match(FENCED) ?? [];
    const rest = text.replace(FENCED, "").trim();
    if (fences.length === 0 || rest !== "" || fences.some(isCommandFence)) {
        return null;
    }
    const lines = fences.reduce((n, fence) => n + fence.trim().split("\n").length - 2, 0);
    return `(code · ${lines} ${lines === 1 ? "line" : "lines"})`;
}
