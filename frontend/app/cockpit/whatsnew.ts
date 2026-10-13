// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What's new reads CHANGELOG.md itself, so the notes a user sees are the lines written for them in the same commit as
// the change, never a second copy that drifts. An entry may end with `<!-- try: <binding id> -->`: hidden on GitHub,
// it gives the entry a button that runs that global keybinding (whatsnew.test.ts checks every id still exists).

export type SectionKind = "Added" | "Changed" | "Fixed";

export interface Entry {
    text: string; // the entry's markdown, the try comment removed
    tryId?: string;
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
const SECTION_ORDER: SectionKind[] = ["Added", "Changed", "Fixed"];

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
    const m = TRY_RE.exec(raw);
    if (m == null) {
        return { text: raw };
    }
    return { text: raw.replace(TRY_RE, " ").trim(), tryId: m[1] };
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
