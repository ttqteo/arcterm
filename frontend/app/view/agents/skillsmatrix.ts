// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Skills tab's matrix, derived from AgentSyncSkillsCommand: managed rows come from the vault,
// unmanaged rows from the adopt plan's per-copy moves, grouped here by name. The keep map is the
// user's answer for skills whose copies differ in body text; adopt skips any such skill without one.

import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { resolveDocLink } from "@/app/view/code/codelink";
import { joinRepoPath } from "@/util/paths";
import type { Tone } from "./setupmodel";

export type SkillKeep = Record<string, string>; // skill name -> runtime whose copy wins

export type SkillGroupKind = "decide" | "differs" | "same" | "only" | "managed";

export interface SkillCell {
    runtime: string;
    label: string;
    tone: Tone | null; // null draws no dot: nothing is there
    title?: string;
}

export interface SkillCopy {
    runtime: string;
    label: string;
    path: string;
    seed: boolean;
    keys: string[];
    files: string[];
    bodydiff: boolean;
}

export interface SkillRow {
    name: string;
    kind: SkillGroupKind;
    description: string;
    // unresolved and unmanaged: the rail offers the keep radio
    needsKeep: boolean;
    copies: SkillCopy[]; // unmanaged copies in column order; empty for a managed skill
    deltas: Record<string, string[]>; // managed only: what each harness overrides
    shipped: boolean; // managed only: arcterm ships it, so its vault copy is not edited
    cells: SkillCell[];
}

export interface SkillGroup {
    key: string;
    kind: SkillGroupKind;
    title: string;
    rows: SkillRow[];
}

const SKILL_FILE = "SKILL.md";
const NOTHING: Omit<SkillCell, "runtime"> = { label: "—", tone: null };

type SkillsData = Pick<CommandAgentSyncSkillsRtnData, "skills" | "columns" | "skillsroot" | "unmanaged" | "unresolved">;

function labelOf(columns: AgentSyncSkillColumn[], runtime: string): string {
    return columns.find((c) => c.runtime === runtime)?.label ?? runtime;
}

function canonicalNames(data: SkillsData): Set<string> {
    return new Set((data.skills ?? []).map((s) => s.name));
}

// copies of each skill arcterm does not own yet, keyed by name, each list in column order
function unmanagedByName(data: SkillsData): Map<string, SkillCopy[]> {
    const order = new Map((data.columns ?? []).map((c, i) => [c.runtime, i]));
    const out = new Map<string, SkillCopy[]>();
    for (const m of data.unmanaged ?? []) {
        const copies = out.get(m.name) ?? [];
        copies.push({
            runtime: m.runtime,
            label: labelOf(data.columns ?? [], m.runtime),
            path: m.from,
            seed: m.seed,
            keys: m.keys ?? [],
            files: m.files ?? [],
            bodydiff: m.bodydiff,
        });
        out.set(m.name, copies);
    }
    for (const copies of out.values()) {
        copies.sort((a, b) => (order.get(a.runtime) ?? 0) - (order.get(b.runtime) ?? 0));
    }
    return out;
}

function hasDelta(c: SkillCopy): boolean {
    return c.bodydiff || c.keys.length > 0 || c.files.length > 0;
}

function overrides(c: Pick<SkillCopy, "keys" | "files">): string {
    return [...c.keys, ...c.files].join(", ");
}

// a keep counts only when it names a runtime holding a copy; a stale one from before a refetch does not
function validKeep(keep: SkillKeep, name: string, copies: SkillCopy[]): string | null {
    const runtime = keep[name];
    return runtime != null && copies.some((c) => c.runtime === runtime) ? runtime : null;
}

// The copy arcterm keeps in a harness's skills folder. It is a local copy, so the labels say whether it matches the
// vault rather than "synced", which reads as an upload.
function managedCell(skill: AgentSyncSkill, col: AgentSyncSkillColumn): SkillCell {
    const state = col.present ? skill.states?.[col.runtime] : "absent";
    const over = skill.deltas?.[col.runtime] ?? [];
    const copy = col.path ? joinRepoPath(col.path, skill.name) : `${col.label}'s skills folder`;
    const title = (fact: string) =>
        [fact, over.length > 0 ? `Overrides ${over.join(", ")}` : null].filter(Boolean).join(". ");
    switch (state) {
        case "synced":
            return { runtime: col.runtime, label: "Up to date", tone: "ok", title: title(`${copy} matches the vault`) };
        case "differs":
            return {
                runtime: col.runtime,
                label: "Out of date",
                tone: "warn",
                title: title(`${copy} is older than the vault; saving or the next agent launch updates it`),
            };
        case "unmanaged":
            return { runtime: col.runtime, label: "Own copy", tone: "none" };
    }
    return { runtime: col.runtime, ...NOTHING };
}

function unmanagedCell(copies: SkillCopy[], kept: string | null, runtime: string): SkillCell {
    const c = copies.find((x) => x.runtime === runtime);
    if (c == null) {
        return { runtime, ...NOTHING };
    }
    if (kept != null) {
        return kept === runtime
            ? { runtime, label: "Kept", tone: "ok" }
            : {
                  runtime,
                  label: "Replaced",
                  tone: "warn",
                  title: "Set aside under skills-replaced when arcterm manages it",
              };
    }
    if (c.bodydiff) {
        return { runtime, label: "Body differs", tone: "warn" };
    }
    if (hasDelta(c)) {
        return { runtime, label: overrides(c), tone: "warn", title: `Overrides ${overrides(c)}` };
    }
    if (copies.length === 1) {
        return { runtime, label: "Only here", tone: "none" };
    }
    // the base copy every other copy was compared against: it differs when any of them does
    return copies.some(hasDelta)
        ? { runtime, label: "Differs", tone: "warn" }
        : { runtime, label: "Own copy", tone: "none" };
}

function unmanagedKind(copies: SkillCopy[], needsKeep: boolean, kept: string | null): SkillGroupKind {
    if (needsKeep && kept == null) {
        return "decide";
    }
    if (copies.length === 1) {
        return "only";
    }
    return copies.some(hasDelta) ? "differs" : "same";
}

export function skillRows(data: SkillsData, keep: SkillKeep): SkillRow[] {
    const columns = data.columns ?? [];
    const canonical = canonicalNames(data);
    const unresolved = new Set(data.unresolved ?? []);
    const rows: SkillRow[] = (data.skills ?? []).map((s) => ({
        name: s.name,
        kind: "managed",
        description: s.description ?? "",
        needsKeep: false,
        copies: [],
        deltas: s.deltas ?? {},
        shipped: s.shipped === true,
        cells: columns.map((col) => managedCell(s, col)),
    }));
    for (const [name, copies] of unmanagedByName(data)) {
        // a vault skill's stray copies show as its "Own copy" cells, not as a second row
        if (canonical.has(name)) {
            continue;
        }
        const needsKeep = unresolved.has(name);
        const kept = validKeep(keep, name, copies);
        rows.push({
            name,
            kind: unmanagedKind(copies, needsKeep, kept),
            description: "",
            needsKeep,
            copies,
            deltas: {},
            shipped: false,
            cells: columns.map((col) => unmanagedCell(copies, kept, col.runtime)),
        });
    }
    return rows;
}

const KIND_ORDER: SkillGroupKind[] = ["decide", "differs", "same", "only", "managed"];

function groupKey(row: SkillRow): string {
    if (row.kind === "same") {
        return `same:${row.copies.length}`;
    }
    if (row.kind === "only") {
        return `only:${row.copies[0].runtime}`;
    }
    return row.kind;
}

function groupTitle(row: SkillRow): string {
    switch (row.kind) {
        case "decide":
            return "Needs a decision";
        case "differs":
            return "Differs between harnesses";
        case "same":
            return `Same copy in ${row.copies.length} harnesses`;
        case "only":
            return `Only in ${row.copies[0].label}`;
        case "managed":
            return "Managed by arcterm";
    }
}

// Groups in the spec's order; "same" groups run widest first, "only" groups in column order.
export function skillGroups(data: SkillsData, keep: SkillKeep): SkillGroup[] {
    const colOrder = new Map((data.columns ?? []).map((c, i) => [c.runtime, i]));
    const groups = new Map<string, SkillGroup>();
    for (const row of skillRows(data, keep)) {
        const key = groupKey(row);
        const g = groups.get(key) ?? { key, kind: row.kind, title: groupTitle(row), rows: [] };
        g.rows.push(row);
        groups.set(key, g);
    }
    const rank = (g: SkillGroup): number[] => {
        const kind = KIND_ORDER.indexOf(g.kind);
        const first = g.rows[0];
        if (g.kind === "same") {
            return [kind, -first.copies.length];
        }
        if (g.kind === "only") {
            return [kind, colOrder.get(first.copies[0].runtime) ?? 0];
        }
        return [kind, 0];
    };
    const out = [...groups.values()];
    for (const g of out) {
        g.rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    return out.sort((a, b) => {
        const [ka, sa] = rank(a);
        const [kb, sb] = rank(b);
        return ka - kb || sa - sb;
    });
}

// The keep map sent with adopt: only undecided skills, and only runtimes that hold a copy, since the
// backend refuses a keep for a managed skill or a missing copy and moves nothing.
export function adoptKeep(data: SkillsData, keep: SkillKeep): SkillKeep {
    const canonical = canonicalNames(data);
    const byName = unmanagedByName(data);
    const out: SkillKeep = {};
    for (const name of data.unresolved ?? []) {
        const copies = byName.get(name);
        const kept = copies != null && !canonical.has(name) ? validKeep(keep, name, copies) : null;
        if (kept != null) {
            out[name] = kept;
        }
    }
    return out;
}

// Skills an adopt would move: every unmanaged name, less the undecided ones it skips.
export function adoptCount(data: SkillsData, keep: SkillKeep): number {
    const unresolved = new Set(data.unresolved ?? []);
    const decided = adoptKeep(data, keep);
    let n = 0;
    for (const name of unmanagedByName(data).keys()) {
        if (!unresolved.has(name) || decided[name] != null) {
            n++;
        }
    }
    return n;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// "19 skills · none managed by arcterm"
export function skillsSummary(data: SkillsData): string {
    const canonical = canonicalNames(data);
    const unmanagedOnly = [...unmanagedByName(data).keys()].filter((n) => !canonical.has(n)).length;
    const managed = canonical.size === 0 ? "none" : String(canonical.size);
    return `${plural(canonical.size + unmanagedOnly, "skill")} · ${managed} managed by arcterm`;
}

export function manageLabel(n: number): string {
    return `Manage ${plural(n, "skill")} in arcterm`;
}

function shownCopy(row: SkillRow, keep: SkillKeep): SkillCopy {
    const kept = validKeep(keep, row.name, row.copies);
    return row.copies.find((c) => c.runtime === kept) ?? row.copies.find((c) => c.seed) ?? row.copies[0];
}

// The SKILL.md that Open shows: the vault copy once arcterm owns it, else the kept copy, else the base copy.
export function skillFilePath(row: SkillRow, skillsroot: string, keep: SkillKeep): string {
    if (row.kind === "managed") {
        return joinRepoPath(skillsroot, `${row.name}/${SKILL_FILE}`);
    }
    return joinRepoPath(shownCopy(row, keep).path, SKILL_FILE);
}

// Whose copy the rail's preview reads, named only when there is more than one to choose from.
export function skillFileSource(row: SkillRow, keep: SkillKeep): string | null {
    return row.copies.length > 1 ? shownCopy(row, keep).label : null;
}

export interface SkillPreview {
    description: string;
    fields: [string, string][];
    body: string;
}

// The rail's read of a SKILL.md: the description for its head (the vault's for a managed skill, else the file's),
// and the frontmatter left for the card, without the name and description the head already shows.
export function skillPreview(row: SkillRow, text: string): SkillPreview {
    const doc = splitFrontmatter(text);
    return {
        description: row.description || (doc.fields.find(([k]) => k === "description")?.[1] ?? ""),
        fields: doc.fields.filter(([k]) => k !== "name" && k !== "description"),
        body: doc.body,
    };
}

// A relative link in the previewed SKILL.md (references/x.md, scripts/run.sh) as a file in the skill's folder;
// null for a web link, an anchor, or one that climbs out of the folder.
export function skillLinkTarget(skillFile: string, href: string): { path: string; line: number | null } | null {
    const target = resolveDocLink(SKILL_FILE, href);
    if (target == null) {
        return null;
    }
    return { path: joinRepoPath(skillFile.replace(/[\\/][^\\/]*$/, ""), target.rel), line: target.line };
}

// What one copy carries against the base copy, for the rail's "What differs" list.
export function copyDelta(c: SkillCopy): string {
    if (c.bodydiff) {
        return "Body text differs";
    }
    if (hasDelta(c)) {
        return `Overrides ${overrides(c)}`;
    }
    return c.seed ? "Base copy" : "Same as the base copy";
}

export function skillNote(row: SkillRow): string {
    switch (row.kind) {
        case "decide":
            return "The copies differ in body text, so arcterm will not pick one for you. Choose the copy every harness gets, or leave them alone.";
        case "differs":
            return row.needsKeep
                ? "The kept copy becomes the one every harness gets. The others are set aside under skills-replaced."
                : "The copies differ in frontmatter or files. arcterm keeps one shared copy and records each harness's differences beside it.";
        case "same":
            return "The same SKILL.md sits in each harness's skills folder, copied by hand. Managing it in arcterm keeps one copy in the vault and writes it into every harness.";
        case "only":
            return `Kept in ${row.copies[0].label}'s skills folder only. Managing it in arcterm also writes it into the other harnesses.`;
        case "managed":
            return row.shipped
                ? "Ships with arcterm. Every launch puts its vault copy back, so it is read-only here."
                : "One copy in the vault on this machine. arcterm copies it into each harness's skills folder when you save, and again at every agent launch.";
    }
}

export interface SkillCopyTarget {
    runtime: string;
    label: string;
    path: string;
}

// Where a vault skill is copied: each harness that is set up, at <its skills folder>/<name>.
export function skillCopyTargets(row: SkillRow, columns: AgentSyncSkillColumn[]): SkillCopyTarget[] {
    if (row.kind !== "managed") {
        return [];
    }
    return columns
        .filter((c) => c.present && c.path)
        .map((c) => ({ runtime: c.runtime, label: c.label, path: joinRepoPath(c.path, row.name) }));
}

// Mirrors the backend's rule (agentsync.CreateSkill): lowercase words joined by single hyphens, at most 64 characters,
// and a name no skill row already has, managed or not.
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SKILL_NAME = 64;

export function skillNameError(name: string, taken: string[]): string | null {
    if (name === "") {
        return null;
    }
    if (name.length > MAX_SKILL_NAME) {
        return `At most ${MAX_SKILL_NAME} characters.`;
    }
    if (!SKILL_NAME.test(name)) {
        return "Lowercase letters, digits and single hyphens, like trade-check.";
    }
    if (taken.includes(name)) {
        return `A skill named ${name} already exists.`;
    }
    return null;
}
