// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What's new reads CHANGELOG.md itself, so the notes a user sees are the lines written for them in the same commit as
// the change, never a second copy that drifts. An entry may end with `<!-- try: <binding id> -->`: hidden on GitHub,
// it gives the entry a button that runs that global keybinding (whatsnew.test.ts checks every id still exists). An
// entry marked `<!-- big -->` is one of its release's few highlights, drawn as a card above the folded rest.

export type SectionKind = "Added" | "Changed" | "Fixed";

export interface Entry {
    text: string; // the entry's markdown, the try comment removed
    tryId?: string;
    big?: boolean;
}

export interface Section {
    kind: SectionKind;
    entries: Entry[];
}

export interface Release {
    version: string;
    date: string;
    sections: Section[];
}

const RELEASE_RE = /^## (\d+\.\d+\.\d+)\s+—\s+(\d{4}-\d{2}-\d{2})\s*$/;
const SECTION_RE = /^### (Added|Changed|Fixed)\s*$/;
const TRY_RE = /\s*<!--\s*try:\s*([\w:.-]+)\s*-->\s*/;
const BIG_RE = /\s*<!--\s*big\s*-->\s*/;
const SECTION_ORDER: SectionKind[] = ["Added", "Changed", "Fixed"];

// a release's cards: past this many they read as a wall again (whatsnew.test.ts holds CHANGELOG.md to it)
export const MAX_HIGHLIGHTS = 5;

// The dated releases, newest first as the file keeps them. Unreleased is left out: it is not in anyone's build yet.
export function parseChangelog(md: string): Release[] {
    const releases: Release[] = [];
    let release: Release | null = null;
    let section: Section | null = null;
    let lines: string[] | null = null;
    const flush = () => {
        if (section != null && lines != null) {
            section.entries.push(toEntry(lines.join(" ")));
        }
        lines = null;
    };
    for (const line of md.split(/\r?\n/)) {
        if (line.startsWith("## ")) {
            flush();
            const m = RELEASE_RE.exec(line);
            release = m ? { version: m[1], date: m[2], sections: [] } : null;
            if (release != null) {
                releases.push(release);
            }
            section = null;
            continue;
        }
        if (line.startsWith("### ")) {
            flush();
            const m = SECTION_RE.exec(line);
            // a release sometimes carries a kind twice (two Changed lists); they read as one
            section =
                release == null || m == null
                    ? null
                    : (release.sections.find((s) => s.kind === m[1]) ?? addSection(release, m[1] as SectionKind));
            continue;
        }
        if (section == null && release != null && release.sections.length === 0 && line.startsWith("- ")) {
            // a release with no kind headings (0.15.0) lists its notes bare; they read as changes
            section = addSection(release, "Changed");
        }
        if (section == null) {
            continue;
        }
        if (line.startsWith("- ")) {
            flush();
            lines = [line.slice(2).trim()];
        } else if (lines != null && line.trim() !== "") {
            lines.push(line.trim());
        }
    }
    flush();
    for (const r of releases) {
        r.sections.sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
    }
    return releases;
}

function addSection(release: Release, kind: SectionKind): Section {
    const s: Section = { kind, entries: [] };
    release.sections.push(s);
    return s;
}

function toEntry(raw: string): Entry {
    const entry: Entry = { text: raw };
    const m = TRY_RE.exec(entry.text);
    if (m != null) {
        entry.text = entry.text.replace(TRY_RE, " ").trim();
        entry.tryId = m[1];
    }
    if (BIG_RE.test(entry.text)) {
        entry.text = entry.text.replace(BIG_RE, " ").trim();
        entry.big = true;
    }
    return entry;
}

// A release's big entries, Added first as the sections run, and its sections without them; a section left empty goes.
export function splitHighlights(release: Release): { highlights: Entry[]; rest: Section[] } {
    const highlights = release.sections.flatMap((s) => s.entries.filter((e) => e.big));
    if (highlights.length === 0) {
        return { highlights, rest: release.sections };
    }
    const rest = release.sections
        .map((s) => ({ kind: s.kind, entries: s.entries.filter((e) => !e.big) }))
        .filter((s) => s.entries.length > 0);
    return { highlights, rest };
}

export type FoldPart = { kind: "changes" | "fixes"; text: string };

// The fold line's counts, each drawn beside its own icon: "58 more changes", "12 fixes", without "more" when no card
// sits above them.
export function foldParts(rest: Section[], afterCards: boolean): FoldPart[] {
    const count = (kinds: SectionKind[]) =>
        rest.filter((s) => kinds.includes(s.kind)).reduce((n, s) => n + s.entries.length, 0);
    const more = afterCards ? "more " : "";
    const changes = count(["Added", "Changed"]);
    const fixes = count(["Fixed"]);
    const parts: FoldPart[] = [];
    if (changes > 0) {
        parts.push({ kind: "changes", text: `${changes} ${more}${changes === 1 ? "change" : "changes"}` });
    }
    if (fixes > 0) {
        parts.push({
            kind: "fixes",
            text: `${fixes} ${parts.length === 0 ? more : ""}${fixes === 1 ? "fix" : "fixes"}`,
        });
    }
    return parts;
}

// The fold line under the cards: "58 more changes · 12 fixes".
export function foldLabel(rest: Section[], afterCards: boolean): string {
    return foldParts(rest, afterCards)
        .map((p) => p.text)
        .join(" · ");
}

export type NoteIcon =
    | "palette"
    | "gift"
    | "sprout"
    | "user"
    | "wand"
    | "lightbulb"
    | "diff"
    | "terminal"
    | "folder"
    | "branch"
    | "rocket"
    | "moon"
    | "gauge"
    | "keyboard"
    | "at"
    | "close"
    | "bookmark"
    | "image"
    | "outline"
    | "history"
    | "bot"
    | "sparkles";

// one of the six graph-lane colors, which every theme keeps, so a card's tint reads the same in each
export type NoteTone = 1 | 2 | 3 | 4 | 5 | 6;

// First match wins, so the narrow words come before the ones nearly every note says (agent, session): "Claude
// account" is the account before it is Code, "terminal tools … in the right folder" the tools before the folder.
const ICON_RULES: { re: RegExp; icon: NoteIcon; tone: NoteTone }[] = [
    { re: /\bcanvas|\bmockups?\b/, icon: "palette", tone: 4 },
    { re: /\bwhat's new\b|\brelease notes?\b/, icon: "gift", tone: 5 },
    { re: /\bsprout\b|\bjarvis\b|\bspider-man\b|\bcharacter\b|\bfold(s|ed|ing)?\b/, icon: "sprout", tone: 2 },
    { re: /\baccounts?\b|\blogin\b/, icon: "user", tone: 2 },
    { re: /\bskills?\b/, icon: "wand", tone: 4 },
    { re: /\bideas?\b/, icon: "lightbulb", tone: 3 },
    { re: /\bdiff\b|\bcommit|\breview/, icon: "diff", tone: 1 },
    { re: /\btools?\b|\bterminals?\b|\blazygit\b/, icon: "terminal", tone: 6 },
    { re: /\bcode\b|\bfolders?\b|\bfiles?\b|\bpin\b/, icon: "folder", tone: 6 },
    { re: /\bgit\b|\bbranch/, icon: "branch", tone: 1 },
    { re: /\bsleep|\bidle\b/, icon: "moon", tone: 4 },
    { re: /\bruns?\b|\borchestrat|\bworkers?\b|\bqueue/, icon: "rocket", tone: 5 },
    { re: /\bresources?\b|\bcpu\b|\bram\b|\bstorage\b|\bdisk\b|\busage\b|\btokens?\b/, icon: "gauge", tone: 3 },
    { re: /\bctrl\b|\bshortcuts?\b|\bkeys\b|\bswitcher\b/, icon: "keyboard", tone: 1 },
    { re: /@?\bmention|\bmessages?\b/, icon: "at", tone: 2 },
    { re: /\bclose|\bdelete|\btrash\b|\bclean up\b/, icon: "close", tone: 5 },
    { re: /\bbookmark|\bmark for later\b/, icon: "bookmark", tone: 3 },
    { re: /\bimages?\b|\bpaste\b/, icon: "image", tone: 6 },
    { re: /\boutline\b|\bheadings?\b/, icon: "outline", tone: 1 },
    { re: /\btranscripts?\b|\bsessions?\b|\bconversations?\b/, icon: "history", tone: 6 },
    { re: /\bagents?\b|\bcodex\b|\bclaude\b/, icon: "bot", tone: 2 },
];

// The picture a highlight card leads with, picked by the words of its headline (its bold lead, or its first words
// when it has none). A note no rule knows gets sparkles, tinted by its place so a release's cards still differ.
export function noteIcon(text: string, index: number): { icon: NoteIcon; tone: NoteTone } {
    const head = (entryLead(text) ?? text.slice(0, 100)).replace(/[*`]/g, "").toLowerCase();
    const rule = ICON_RULES.find((r) => r.re.test(head));
    return rule != null
        ? { icon: rule.icon, tone: rule.tone }
        : { icon: "sparkles", tone: ((index % 6) + 1) as NoteTone };
}

// Numeric semver order; a missing or non-numeric part counts as 0, so "0.15" sorts with "0.15.0".
export function compareVersions(a: string, b: string): number {
    const pa = a.replace(/^v/i, "").split(".");
    const pb = b.replace(/^v/i, "").split(".");
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
        if (d !== 0) {
            return d;
        }
    }
    return 0;
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// The releases the sheet lists: the latest `count`, none newer than the running build (a dev checkout's changelog runs
// ahead of its version). Headlines are short, so a few releases back still fit a glance.
export function releasesToShow(releases: Release[], current: string, count = 5): Release[] {
    const inBuild = VERSION_RE.test(current)
        ? releases.filter((r) => compareVersions(r.version, current) <= 0)
        : releases;
    return inBuild.slice(0, count);
}

export type Span = { kind: "text" | "bold" | "em" | "code"; text: string };

// The inline markdown the changelog uses: **bold**, *em* and `code`. Anything else stays text.
export function inlineSpans(text: string): Span[] {
    const spans: Span[] = [];
    const re = /\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*|`([^`]+)`/g;
    let last = 0;
    for (let m = re.exec(text); m != null; m = re.exec(text)) {
        if (m.index > last) {
            spans.push({ kind: "text", text: text.slice(last, m.index) });
        }
        spans.push(
            m[1] != null
                ? { kind: "bold", text: m[1] }
                : m[2] != null
                  ? { kind: "em", text: m[2] }
                  : { kind: "code", text: m[3] }
        );
        last = re.lastIndex;
    }
    if (last < text.length) {
        spans.push({ kind: "text", text: text.slice(last) });
    }
    return spans;
}

// An entry's headline, shown alone until the entry is opened: its bold lead. Null when the entry has none, or when
// the lead is the whole entry, so there is nothing more to open.
export function entryLead(text: string): string | null {
    const m = /^\*\*(.+?)\*\*(.*)$/.exec(text);
    if (m == null || m[2].replace(/^[\s.,:;]+/, "") === "") {
        return null;
    }
    return m[1];
}

// A card's text under its title: the entry after its bold lead, the punctuation joining them dropped. The whole entry
// when it has no lead; empty when the lead is all of it.
export function entryBody(text: string): string {
    const m = /^\*\*(.+?)\*\*(.*)$/.exec(text);
    if (m == null) {
        return text;
    }
    return m[2].replace(/^[\s.,:;]+/, "");
}

// "2026-10-13" → "Oct 13", read as a date on the calendar rather than an instant, so no timezone moves it a day
export function formatReleaseDate(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (m == null) {
        return date;
    }
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// every try id in the changelog, for the test that keeps them pointing at live bindings
export function tryIds(releases: Release[]): string[] {
    return releases.flatMap((r) => r.sections.flatMap((s) => s.entries.flatMap((e) => (e.tryId ? [e.tryId] : []))));
}
