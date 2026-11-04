// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what a council message's evidence draws and what the Sources panel shows (A-links-panel.dc.html in the
// council-evidence-chips canvas). A message's `path:line` refs fold into one link per file, named by the shortest tail
// of its path no other link shares, its cited lines after it (`:45, 49`); a click opens the panel on that file, which
// shows the cited lines lit with one line of context each side, runs that touch merged. A claim's chips also carry its check
// badge (Ran, Disproved, Read code, Guess) and a Wrong cite chip for each cite Go found wrong (`claimChips`). No React, no
// Wave runtime imports.

import { evidenceChip } from "./councildiscussionmodel";
import { mapWords } from "./councilmapmodel";
import { checkLabelOf, checkWord, councilLang, wrongCiteWord, type CheckLabel, type CouncilLang } from "./councilmodel";
import { isUnboxedShot, shotName, unboxedWords } from "./councilshots";

/** A run of cited lines, 1-based and inclusive. */
export interface CitedLines {
    start: number;
    end: number;
}

/** A ref the expert wrote, read as a file and its lines. */
export interface SourceRef {
    path: string; // as cited, `\` turned to `/` and a leading `./` dropped
    lines: CitedLines | null; // null when it names no line
}

/** One file a message cites, with every line it cites there. */
export interface SourceGroup {
    path: string;
    name: string; // the file name, or more of its tail when another group's file has the same name
    lines: CitedLines[]; // ascending, each run once
    label: string; // the lines as the link reads them after the name: `:45, 49`, `:12–20`, or "" for none
}

/** A message's evidence, as its links draw it: the files, then whatever is not a file (a screenshot region) as cited. */
export interface EvidenceView {
    groups: SourceGroup[];
    others: string[];
}

/** One line of a file in the panel. */
export interface SourceRow {
    n: number;
    text: string;
    cited: boolean;
}

/** A run of lines the panel shows together. */
export interface SourceHunk {
    start: number;
    end: number;
    rows: SourceRow[];
    cut: boolean; // a cited run longer than MAX_HUNK_ROWS, shown only to that many rows
}

export interface SourceExcerpt {
    hunks: SourceHunk[];
    pastEnd: number[]; // cited lines the file no longer reaches
    lineCount: number;
}

/** A file cited with no line shows this many of its first lines. */
export const HEAD_ROWS = 40;
/** The most rows one hunk draws, so a ref like `a.ts:1-5000` cannot draw the whole file. */
export const MAX_HUNK_ROWS = 120;

const REF = /^(.+?):(\d+)(?::\d+)?(?:\s*[-–]\s*(\d+))?$/;

/** Pure: a cited `path:line`, `path:line:col`, `path:start-end` or bare `path`; null for a screenshot region or nothing. */
export function parseSourceRef(ref: string): SourceRef | null {
    const s = ref.trim();
    if (s === "" || s.startsWith("screenshot:")) {
        return null;
    }
    const m = REF.exec(s);
    if (m == null) {
        return { path: cleanPath(s), lines: null };
    }
    const a = Number(m[2]);
    const b = m[3] != null ? Number(m[3]) : a;
    if (a < 1 || b < 1) {
        return { path: cleanPath(m[1]), lines: null };
    }
    return { path: cleanPath(m[1]), lines: { start: Math.min(a, b), end: Math.max(a, b) } };
}

function cleanPath(p: string): string {
    return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Pure: a message's evidence refs folded into one group per file, in the order each file is first cited. */
export function groupSources(refs: readonly string[]): EvidenceView {
    const byPath = new Map<string, CitedLines[]>();
    const others: string[] = [];
    for (const ref of refs) {
        const r = parseSourceRef(ref);
        if (r == null) {
            if (ref.trim() !== "") {
                others.push(ref.trim());
            }
            continue;
        }
        const lines = byPath.get(r.path) ?? [];
        if (r.lines != null && !lines.some((l) => l.start === r.lines.start && l.end === r.lines.end)) {
            lines.push(r.lines);
        }
        byPath.set(r.path, lines);
    }
    const paths = [...byPath.keys()];
    const names = shortNames(paths);
    const groups = paths.map((path, i) => {
        const lines = [...byPath.get(path)].sort((x, y) => x.start - y.start || x.end - y.end);
        return { path, name: names[i], lines, label: linesLabel(lines) };
    });
    return { groups, others };
}

// ---- a claim's chips: the badge, the files, the wrong cites ----

/** A claim's evidence as the chips under it read it: the items Go checked, the label it gave the claim, and the language the
 *  words follow. A message of the chat, a proposal of the Discussion and a position of the Report each carry one. */
export interface ClaimEvidence {
    evidence: CouncilEvidence[];
    label: CheckLabel | ""; // Go's check label; "" for a plain reply or a Brainstorm, which draw no badge
    lang: CouncilLang;
}

/** Pure: a proposal's or a reply's claim, in the council's language (English when the council has none). */
export function claimOf(
    c: Pick<Council, "lang"> | null | undefined,
    x: { evidence?: CouncilEvidence[]; label?: string }
): ClaimEvidence {
    return { evidence: x.evidence ?? [], label: checkLabelOf(x), lang: councilLang(c) };
}

/** The badge a labelled claim wears: an icon (councilchecks.tsx) and the word, with what the word means as its tooltip. */
export interface ClaimBadge {
    label: CheckLabel;
    word: string;
    meaning: string;
}

/** A cite Go found wrong, as its own chip: `Wrong cite`, the file and lines, and why (`line 900 is past the end`). */
export interface WrongCite {
    ref: string;
    name: string; // the file's name
    label: string; // the cited lines after it (`:900`, `:12–20`), "" for none
    word: string; // `Wrong cite` / `Trích sai`
    note: string; // Go's `citenote`, "" when it gave none
}

/** A boxed screenshot region Go drew (`CouncilEvidence.region`): the crop the message shows under its words, and what a
 *  click opens in the Sources panel, the whole image with the same box. */
export interface RegionCrop {
    ref: string;
    name: string; // `home.png#save`, the cite without its box
    region: CouncilRegion;
}

export interface ClaimChips {
    badge: ClaimBadge | null;
    refs: string[]; // what the file links fold (groupSources): every cite that is neither weak nor wrong
    weak: string; // the weak claims, as the amber chip reads them
    wrong: WrongCite[];
    crops: RegionCrop[]; // the regions Go drew, in the order they are cited, each once
}

/** Pure: what a claim's evidence row draws. A cite Go found wrong (`cite: "wrong"`) leaves the file links, so it does not
 *  look like a source, and is a Wrong cite chip instead; a cite nobody checked (a Brainstorm's, a plain reply's) stays a
 *  link; a weak claim is the amber chip. A labelled claim wears its badge, even with no evidence at all (a Guess), and a
 *  screenshot it cites with no box is no evidence: it joins the amber chip, saying the region has no box. Every region Go
 *  drew is a crop, whatever the claim's label. */
export function claimChips(
    evidence: readonly CouncilEvidence[] | undefined,
    label: string | undefined,
    lang: CouncilLang
): ClaimChips {
    const items = evidence ?? [];
    const badge = claimBadge(label, lang);
    // a checked claim asked for evidence, so a region named with no box is drawn weak; elsewhere it is the plain chip
    const unboxed = (e: CouncilEvidence) => isUnboxedShot(e, badge != null);
    const crops: RegionCrop[] = [];
    for (const e of items) {
        if (e.region != null && !e.weak && !isWrongCite(e) && !crops.some((c) => c.region.crop === e.region.crop)) {
            crops.push({ ref: e.ref, name: shotName(e.ref), region: e.region });
        }
    }
    return {
        badge,
        refs: items.filter((e) => !e.weak && !isWrongCite(e) && e.ref !== "" && !unboxed(e)).map((e) => e.ref),
        weak: [
            ...items.filter((e) => e.weak).map((e) => evidenceChip(e).text),
            ...items.filter(unboxed).map((e) => unboxedWords(e.ref)),
        ].join("; "),
        wrong: items.filter(isWrongCite).map((e) => wrongCiteOf(e, lang)),
        crops,
    };
}

// ---- screenshot regions ----

/** Pure: the box as CSS percentages of the image it lies on, for an outline drawn over the whole screenshot. */
export function regionBoxStyle(r: Pick<CouncilRegion, "x" | "y" | "w" | "h">): {
    left: string;
    top: string;
    width: string;
    height: string;
} {
    const pct = (n: number) => `${Math.round(Math.min(1, Math.max(0, n)) * 10000) / 100}%`;
    return { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) };
}

/** Pure: the badge of a claim's label in the council's language; null for a claim Go did not label (or a word it does not
 *  know). */
export function claimBadge(label: string | undefined, lang: CouncilLang): ClaimBadge | null {
    const kind = checkLabelOf({ label });
    if (kind === "") {
        return null;
    }
    return {
        label: kind,
        word: checkWord(kind, lang),
        meaning: mapWords({ lang }).legend.find((l) => l.label === kind)?.meaning ?? "",
    };
}

/** Pure: whether Go found this cite wrong. A weak claim is a claim without evidence, so it is never a cite. */
export function isWrongCite(e: CouncilEvidence): boolean {
    return !e.weak && e.cite === "wrong";
}

/** Pure: a wrong cite as its chip reads it. */
export function wrongCiteOf(e: CouncilEvidence, lang: CouncilLang): WrongCite {
    const ref = parseSourceRef(e.ref);
    return {
        ref: e.ref,
        name: ref?.path.split("/").pop() || shotName(e.ref),
        label: ref?.lines == null ? "" : linesLabel([ref.lines]),
        word: wrongCiteWord(lang),
        note: e.citenote ?? "",
    };
}

// ---- an idea's signal line: its evidence as a few quiet words and a counted files icon ----

/** One word on an idea's signal line (board A-details-line in .superpowers/design/council-card-calm) that says its claim
 *  needs a second look, its details in the hover (`title`): a label that warns (Disproved, Guess), the cites Go found
 *  wrong, the weak claims. */
export interface ClaimSignal {
    kind: "badge" | "wrong" | "weak";
    word: string;
    title: string;
    check: CheckLabel | ""; // the badge's label; "" for the others
}

// the labels that say something the files icon does not: Ran and Read code only say how the files were used
const WARNING_CHECKS: readonly CheckLabel[] = ["disproved", "guess"];

const WEAK_CLAIM_WORD: Record<CouncilLang, string> = { en: "Weak claim", vi: "Chứng cứ yếu" };

/** Pure: the warning words an idea's signal line shows for its claim, in this order: the badge when it warns, the wrong
 *  cites (one word, counted past one), the weak claims. Empty for a claim with nothing to look at again. */
export function claimSignals(chips: ClaimChips, lang: CouncilLang): ClaimSignal[] {
    const out: ClaimSignal[] = [];
    if (chips.badge != null && WARNING_CHECKS.includes(chips.badge.label)) {
        out.push({ kind: "badge", word: chips.badge.word, title: chips.badge.meaning, check: chips.badge.label });
    }
    if (chips.wrong.length > 0) {
        const word = wrongCiteWord(lang);
        out.push({
            kind: "wrong",
            word: chips.wrong.length === 1 ? word : `${word} ×${chips.wrong.length}`,
            title: chips.wrong.map((w) => `${w.name}${w.label}${w.note === "" ? "" : `: ${w.note}`}`).join("\n"),
            check: "",
        });
    }
    if (chips.weak !== "") {
        out.push({ kind: "weak", word: WEAK_CLAIM_WORD[lang], title: chips.weak, check: "" });
    }
    return out;
}

/** Pure: the files icon on an idea's signal line: how many sources it cites (the files, then any other cite), and the
 *  name a screen reader gives the icon, its label first (`Read code: 3 sources`, `Đã đọc code: 3 nguồn`). Null when it
 *  cites none. */
export function filesSignal(
    view: EvidenceView,
    badge: ClaimBadge | null,
    lang: CouncilLang = "en"
): { count: number; label: string } | null {
    const count = view.groups.length + view.others.length;
    if (count === 0) {
        return null;
    }
    const n = lang === "vi" ? `${count} nguồn` : `${count} ${count === 1 ? "source" : "sources"}`;
    return { count, label: badge == null ? n : `${badge.word}: ${n}` };
}

/** How many of a message's files show as chips; the rest fold into one `+N files` that opens the Sources panel, which
 *  lists them all. */
export const SHOWN_SOURCES = 2;

/** Pure: the files a message shows as chips, and the `+N files` the rest fold into ("" when none is left). */
export function foldSources<T>(groups: readonly T[]): { shown: T[]; more: string } {
    const rest = groups.length - SHOWN_SOURCES;
    return {
        shown: groups.slice(0, SHOWN_SOURCES),
        more: rest <= 0 ? "" : `+${rest} ${rest === 1 ? "file" : "files"}`,
    };
}

/** Pure: `:45, 49` for the cited lines, a run as `12–20`; "" when there are none. */
export function linesLabel(lines: readonly CitedLines[]): string {
    if (lines.length === 0) {
        return "";
    }
    return ":" + lines.map((l) => (l.start === l.end ? `${l.start}` : `${l.start}–${l.end}`)).join(", ");
}

// each path's file name, with as many of its folders as it takes for no two to read the same
function shortNames(paths: readonly string[]): string[] {
    const parts = paths.map((p) => p.split("/").filter((s) => s !== ""));
    const depth = paths.map(() => 1);
    const name = (i: number) => parts[i].slice(-depth[i]).join("/") || paths[i];
    for (let round = 0; round < 64; round++) {
        const seen = new Map<string, number[]>();
        paths.forEach((_, i) => seen.set(name(i), [...(seen.get(name(i)) ?? []), i]));
        let grew = false;
        for (const same of seen.values()) {
            if (same.length < 2) {
                continue;
            }
            for (const i of same) {
                if (depth[i] < parts[i].length) {
                    depth[i]++;
                    grew = true;
                }
            }
        }
        if (!grew) {
            break;
        }
    }
    return paths.map((_, i) => name(i));
}

/** Pure: the folder part of a cited path, with its trailing `/`; "" for a file at the project's root. */
export function sourceDir(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i + 1);
}

/** Pure: where a cited path is on disk: as written when absolute, else under the council's project folder. */
export function sourceFilePath(project: string, path: string): string {
    if (/^([A-Za-z]:\/|\/|~)/.test(path)) {
        return path;
    }
    const root = project.replace(/[\\/]+$/, "");
    return root === "" ? path : `${root}/${path}`;
}

/** Pure: the lines of `text` the panel shows for `lines`: each cited run with `context` lines each side, runs that
 *  overlap or touch merged into one hunk. With no cited line it is the file's first HEAD_ROWS lines. */
export function sourceExcerpt(text: string, lines: readonly CitedLines[], context = 1): SourceExcerpt {
    const all = text.split(/\r?\n/);
    if (all.length > 1 && all[all.length - 1] === "") {
        all.pop();
    }
    const lineCount = all.length;
    const pastEnd: number[] = [];
    const cited: (CitedLines & { cut: boolean })[] = [];
    for (const l of lines) {
        if (l.start > lineCount) {
            pastEnd.push(l.start);
            continue;
        }
        const want = Math.min(l.end, lineCount);
        const end = Math.min(want, l.start + MAX_HUNK_ROWS - 1);
        cited.push({ start: l.start, end, cut: end < want });
    }
    const isCited = (n: number) => cited.some((c) => n >= c.start && n <= c.end);
    const row = (n: number): SourceRow => ({ n, text: all[n - 1], cited: isCited(n) });
    const span = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => row(start + i));
    if (lines.length === 0) {
        const end = Math.min(lineCount, HEAD_ROWS);
        return { hunks: [{ start: 1, end, rows: span(1, end), cut: false }], pastEnd, lineCount };
    }
    const windows = cited
        .map((c) => ({
            start: Math.max(1, c.start - context),
            end: Math.min(lineCount, c.end + context),
            cut: c.cut,
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number; cut: boolean }[] = [];
    for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last != null && w.start <= last.end + 1) {
            last.end = Math.max(last.end, w.end);
            last.cut = last.cut || w.cut;
        } else {
            merged.push({ ...w });
        }
    }
    return {
        hunks: merged.map((m) => ({ start: m.start, end: m.end, rows: span(m.start, m.end), cut: m.cut })),
        pastEnd,
        lineCount,
    };
}

/** Pure: the line under the hunks when cited lines are past the file's end, which means it changed since the council
 *  ran; "" when none is. */
export function pastEndWords(x: SourceExcerpt): string {
    if (x.pastEnd.length === 0) {
        return "";
    }
    const many = x.pastEnd.length > 1;
    return `${many ? "Lines" : "Line"} ${x.pastEnd.join(", ")} ${many ? "are" : "is"} past the end of the file (${x.lineCount} lines): it has changed since the council ran.`;
}

/** Pure: a hunk's heading: `Line 12` or `Lines 44–46`. */
export function hunkLabel(h: { start: number; end: number }): string {
    return h.start === h.end ? `Line ${h.start}` : `Lines ${h.start}–${h.end}`;
}
