// a long reply folds to what must be read, behind a button that opens it in full. it folds section by section (a section
// is the opening, or a heading or a bold label on its own line with what follows it): every section keeps its title and
// at least one line, so a warning under "Found not fixed" is never cut away with the rest. a section claude marked shows
// its marked sentences; one it did not shows its first sentence and the top items of its list. register.ts draws it;
// this is the cut. claude/skim-bench measures it against the reply

import { commandSpans } from "./highlight-core";
import { FENCED, isCommandFence, ITEM, sections, stubOf, TABLE_ROW, type Section } from "./sections-core";

// a reply longer than this many lines folds
export const FOLD_LINES = 10;
// a fold this share of the reply's lines or more is not worth a click: the reply draws in full
export const CEILING = 2 / 3;

// at most this many items of a list, each cut to its bold lead and first sentence. a list one longer shows whole: its
// "… 1 more" line would take the line the item takes
export const MAX_REASONS = 4;
// a lead keeps the sentence after it whole while both fit in this many characters; past it the sentence is cut at a space
export const MAX_REASON_CHARS = 160;
// a sentence is never cut short of this; past it, at a space, since a reason cut mid-word reads as broken
export const MAX_SENTENCE_CHARS = 320;

// the opened replies kept, newest last
export const MAX_OPENED = 200;

const NUMBERED = /^\s*(\d+[.)])\s/;
const LEAD = /^(\*\*[^*]+\*\*:?)\s*(.*)$/;

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

function sentenceOf(text: string): string {
    return (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text).trim();
}

// the bold lead and the sentence after it, or the first sentence. a lead never stands alone: an empty "**Why:**" says
// nothing, so a sentence too long to fit beside it is cut at a space instead
export function firstSentence(item: string): string {
    const lead = item.match(LEAD);
    if (lead) {
        const next = sentenceOf(lead[2] ?? "");
        if (next === "") {
            return lead[1] ?? "";
        }
        const room = Math.max(MAX_REASON_CHARS - (lead[1]?.length ?? 0) - 1, 40);
        return `${lead[1]} ${next.length <= room ? next : clip(next, Math.max(room, MAX_SENTENCE_CHARS))}`;
    }
    return clip(sentenceOf(item));
}

function clip(text: string, max = MAX_SENTENCE_CHARS): string {
    if (text.length <= max) {
        return text;
    }
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// the folded text, and the marks it holds in the order they show: layout draws marks in order and waits on one it
// cannot find, so a mark the fold left out would hold back every mark after it
export type Folded = { text: string; marks: string[] };

// a section's body as blocks: paragraphs, lists and command fences. code the person is not asked to type is left out,
// and so is a table: the fold is read at a glance, and a section that is only one shows as its stub
function blocksOf(lines: readonly string[]): string[] {
    return lines
        .join("\n")
        .replace(FENCED, (fence) => (isCommandFence(fence) ? `\n\n${fence.trim()}\n\n` : "\n\n"))
        .split(/\n\s*\n/)
        .map((block) => block.replace(/^\n+|\s+$/g, ""))
        .filter((block) => block.trim() !== "" && !block.split("\n").every((line) => TABLE_ROW.test(line)));
}

const isList = (block: string) => block.split("\n").some((line) => ITEM.test(line));
const endsOnColon = (text: string) => /:$/.test(text.replace(/[\s*_]+$/, ""));

// a sentence a reader skimming must not miss though nothing marked it: a caveat or warning, what was not done or not
// verified, what waits on the person (an ask, a choice, a command for them, a question). a fold that kept only the
// verdict and the marks lost these most of all (claude/skim-bench), and claude seldom marks them. english and
// vietnamese, the two the replies here are written in
const CAVEAT = new RegExp(
    [
        String.raw`\b(?:not|never) (?:yet )?(?:verified|tested|tried|run|checked|fixed|committed|pushed|built|proven)\b`,
        String.raw`\b(?:didn[’']?t|did not|haven[’']?t|have not|couldn[’']?t|could not|can[’']?t|cannot|won[’']?t) (?:run|test|try|check|verify|reproduce|fix|find|commit|push|build|dig|list)`,
        String.raw`\b(?:unverified|unproven|untested|hand check|caveat|warning|careful|known issue|flagged|left (?:out|alone|uncommitted|them out|it out)|still (?:fails|open|broken|holds|keeps|look))\b`,
        String.raw`\bnote:`,
        String.raw`\b(?:you (?:need|must|should|can|could)|may want|might want|want me to|your call|decision is yours|tell me|let me know)\b`,
        String.raw`\b(?:closes|will close|kills|will kill|breaks|will break|is lost|are lost|stays? down|deletes?|overwrites?)\b`,
        String.raw`(?:^|[\s*_("“])(?:chưa (?:chạy|thử|kiểm|sửa|commit|push|build|có|chắc|xem|đụng)|lưu ý|cảnh báo|cần bạn|nhờ bạn|bạn (?:muốn|chọn|cần|gõ|tự|nên|có thể|gửi)|phải|sẽ (?:đóng|mất|xoá|xóa|vẫn)|đừng|không được|còn (?:chưa|lỗi|treo)|vẫn (?:lỗi|giữ|treo|còn))`,
    ].join("|"),
    "i"
);

// the sentences of a line a fold keeps for CAVEAT, or a question, whole and in order
function caveats(line: string): string[] {
    const text = (line.match(ITEM)?.[1] ?? line).trim();
    return text
        .split(/(?<=[.!?？])\s+/)
        .filter((sentence) => CAVEAT.test(sentence) || /[?？]["'”’)*_]*$/.test(sentence.trim()));
}

// a list's top items, each its lead and first sentence: an item that is only a label ("**Backend:**") takes the first
// line under it. a numbered item keeps its number, so a reply's "type 2" still points at it
function listLines(block: string, all = false): string[] {
    const lines = block.split("\n");
    const indent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
    const items = lines.filter((line) => ITEM.test(line));
    const top = Math.min(...items.map(indent));
    const tops = lines.flatMap((line, i) => (ITEM.test(line) && indent(line) === top ? [i] : []));
    const keep = all || tops.length <= MAX_REASONS + 1 ? tops.length : MAX_REASONS;
    const shown = tops.slice(0, keep).map((at) => {
        const line = lines[at] ?? "";
        let text = firstSentence(line.match(ITEM)?.[1] ?? "");
        // a caveat past the item's first sentence stays beside it
        const more = caveats(line).filter((sentence) => !text.includes(sentence) && !sentence.includes(text));
        text = more.length > 0 ? `${text} ${more.join(" ")}` : text;
        const child = lines[at + 1];
        if ((LEAD.test(text) && (text.match(LEAD)?.[2] ?? "") === "") || endsOnColon(text)) {
            const under = child !== undefined && indent(child) > top ? (child.match(ITEM)?.[1] ?? child.trim()) : "";
            text = under === "" ? text : `${text} ${firstSentence(under)}`;
        }
        return `${line.match(NUMBERED)?.[1] ?? "-"} ${text}`;
    });
    if (tops.length > keep) {
        shown.push(`- … ${tops.length - keep} more`);
    }
    return shown;
}

// a block a sentence ending on ":" points at, shown whole enough to answer it: every item of a list (the options), every
// line of a paragraph to its first sentence, a command fence as it is
function pointedLines(block: string): string {
    if (isCommandFence(block)) {
        return block;
    }
    if (isList(block)) {
        return listLines(block, true).join("\n");
    }
    return block
        .split("\n")
        .map((line) => firstSentence(line.trim()))
        .join("\n");
}

// a section claude left unmarked: its first paragraph (the whole of it in the opening, the verdict), the paragraph a
// colon there points at, the top items of its first list, a paragraph handing the person a command, and the commands
function plainSection(blocks: readonly string[], isOpening: boolean): string[] {
    const out: string[] = [];
    let hasProse = false;
    let hasList = false;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i] ?? "";
        if (isCommandFence(block)) {
            out.push(block);
        } else if (isList(block)) {
            if (!hasList) {
                hasList = true;
                // the sentence leading into the list ("checked it three ways:"), on the lines above its first item or
                // in the paragraph before it, unless it is already shown
                const lines = block.split("\n");
                const head = lines
                    .slice(
                        0,
                        Math.max(
                            lines.findIndex((line) => ITEM.test(line)),
                            0
                        )
                    )
                    .join(" ");
                const before = head !== "" ? head : i > 0 && !isList(blocks[i - 1] ?? "") ? (blocks[i - 1] ?? "") : "";
                const intro =
                    before
                        .replace(/\n/g, " ")
                        .split(/(?<=[.!?])\s+/)
                        .at(-1)
                        ?.trim() ?? "";
                if (endsOnColon(intro) && !out.some((part) => part.includes(intro))) {
                    out.push(intro);
                }
                out.push(listLines(block).join("\n"));
            }
        } else if (hasProse && LEAD.test(block)) {
            // a paragraph under a bold label ("**Cause:** …") is a section of its own in all but layout
            out.push(listLines(`- ${block.replace(/\n/g, " ")}`)[0]?.replace(/^- /, "") ?? "");
        } else if (!hasProse) {
            hasProse = true;
            out.push(isOpening ? block : firstSentence(block.replace(/\n/g, " ")));
            const next = blocks[i + 1];
            if (endsOnColon(block) && next !== undefined && !isCommandFence(next)) {
                out.push(pointedLines(next));
                hasList ||= isList(next);
                i++;
            }
        } else if (endsOnColon(block) && blocks[i + 1] !== undefined && !isCommandFence(blocks[i + 1] ?? "")) {
            // a later paragraph pointing at what follows ("Pick one:") brings it: the options are the point
            const intro =
                block
                    .replace(/\n/g, " ")
                    .split(/(?<=[.!?])\s+/)
                    .at(-1)
                    ?.trim() ?? "";
            out.push(intro, pointedLines(blocks[i + 1] ?? ""));
            hasList ||= isList(blocks[i + 1] ?? "");
            i++;
        } else {
            // a later paragraph keeps what the person must not miss: a caveat, what was not done, what waits on them
            const kept = block
                .split("\n")
                .flatMap((line) => (commandSpans(line).length > 0 ? [line.trim()] : caveats(line)));
            if (kept.length > 0) {
                out.push(kept.join(" "));
            }
        }
    }
    return out;
}

// a section claude marked: the verdict when it is the opening, then each line holding a mark as its marks alone (an
// item's behind its bullet and bold lead, the items of a run kept as one list), and what a mark ending on ":" points at.
// a command for the person to type is as much a must-read as a mark, so a command fence stays whole and a command's
// code span stays beside its line's marks
function markedSection(blocks: readonly string[], take: (line: string) => string[], isOpening: boolean): string[] {
    const parts: { text: string; isItem: boolean }[] = [];
    const verdict = isOpening ? blocks.findIndex((block) => !isList(block) && !isCommandFence(block)) : -1;
    const verdictTo = verdict >= 0 && endsOnColon(blocks[verdict] ?? "") && blocks[verdict + 1] !== undefined ? 1 : 0;
    let pointing = -1;
    blocks.forEach((block, i) => {
        if (i === verdict) {
            block.split("\n").forEach(take);
            parts.push({ text: block, isItem: false });
            return;
        }
        if (isCommandFence(block)) {
            parts.push({ text: block, isItem: false });
            return;
        }
        if (i === pointing || (verdictTo > 0 && i === verdict + 1)) {
            block.split("\n").forEach(take);
            parts.push({ text: pointedLines(block), isItem: false });
            return;
        }
        const lines = block.split("\n");
        lines.forEach((line, j) => {
            const found = take(line);
            const commands = commandSpans(line)
                .map(([from, to]) => ({ at: from, text: line.slice(from, to) }))
                .filter(({ text }) => !found.some((mark) => mark.includes(text)));
            // what claude left unmarked yet the person must not miss, and a command's sentence whole rather than
            // its code span alone
            const unmarked = caveats(line)
                .filter((sentence) => !found.some((mark) => mark.includes(sentence) || sentence.includes(mark)))
                .map((sentence) => ({ at: line.indexOf(sentence), text: sentence }));
            const covered = (at: number) => unmarked.some((s) => at >= s.at && at < s.at + s.text.length);
            const shown = [
                ...found.map((mark) => ({ at: line.indexOf(mark), text: mark })),
                ...unmarked,
                ...commands.filter(({ at }) => !covered(at)),
            ]
                .sort((a, b) => a.at - b.at)
                .map(({ text }) => text);
            if (shown.length === 0) {
                return;
            }
            if (j === lines.length - 1 && endsOnColon(shown.at(-1) ?? "")) {
                pointing = i + 1;
            }
            const item = line.match(ITEM)?.[1];
            if (item === undefined) {
                parts.push({ text: shown.join(" "), isItem: false });
                return;
            }
            const lead = item.match(LEAD)?.[1];
            const head = lead && !(shown[0] ?? "").includes(lead) ? `${lead} ` : "";
            parts.push({ text: `- ${head}${shown.join(" ")}`, isItem: true });
        });
    });
    return parts.map((part, i) => (i > 0 && part.isItem && parts[i - 1]?.isItem ? `\n${part.text}` : part.text));
}

// the fold of a reply: each section in order, its title, then its marked sentences or its first lines. a section that
// is only a table or code shows as its stub, "(table · 12 rows)"
export function folded(text: string, marks: readonly string[]): Folded {
    const left = marks.filter((mark) => mark.trim() !== "");
    const kept: string[] = [];
    const take = (line: string): string[] => {
        const found = left.filter((mark) => line.includes(mark));
        found.forEach((mark) => left.splice(left.indexOf(mark), 1));
        kept.push(...found);
        return found;
    };
    const has = (line: string) => left.some((mark) => line.includes(mark));
    const out: string[] = [];
    for (const section of sections(text)) {
        if (section.title !== null) {
            take(section.title);
        }
        const body = sectionBody(section, has, take);
        if (body.length === 0) {
            continue;
        }
        // no blank line anywhere: the fold is a few lines read at a glance, and a blank line is a line it does not save.
        // a fence keeps a blank line around it, so markdown never reads a line after it as part of it
        const joined = body.map((part) => part.replace(/^\n/, "")).join("\n");
        out.push(section.title === null ? joined : `${section.title.trim()}\n${joined}`);
    }
    return { text: out.join("\n"), marks: kept };
}

function sectionBody(section: Section, has: (line: string) => boolean, take: (line: string) => string[]): string[] {
    const stub = stubOf(section);
    if (stub !== null) {
        return [stub];
    }
    const blocks = blocksOf(section.lines);
    const isOpening = section.title === null;
    if (blocks.some((block) => block.split("\n").some(has))) {
        return markedSection(blocks, take, isOpening);
    }
    return plainSection(blocks, isOpening);
}

// the fold to draw, or null when the reply draws in full: a fold of CEILING of its lines or more saves no reading
export function foldOf(text: string, marks: readonly string[]): Folded | null {
    const fold = folded(text, marks);
    return lineCount(fold.text) / lineCount(text) >= CEILING ? null : fold;
}

export function summary(text: string, marks: readonly string[] = []): string {
    return folded(text, marks).text;
}

// the opened list with the reply opened or closed
export function toggleOpened(opened: readonly string[], hash: string): string[] {
    return opened.includes(hash) ? opened.filter((one) => one !== hash) : [...opened, hash].slice(-MAX_OPENED);
}
