// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Skills tab's matrix, derived from AgentSyncSkillsCommand: managed rows come from the vault,
// unmanaged rows from the adopt plan's per-copy moves, grouped here by name, and link rows from its linked
// list. The keep map is the user's answer for skills whose copies differ in body text (adopt skips any such
// skill without one), and the choice to replace a vault skill's own copy with the vault's or to leave an
// unmanaged skill where it is: adoptKeep and adoptSkip turn it into the wire's keep and skip.

import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { resolveDocLink } from "@/app/view/code/codelink";
import { joinRepoPath } from "@/util/paths";
import type { Tone } from "./setupmodel";

export type SkillKeep = Record<string, string>; // skill name -> runtime, KEEP_VAULT or KEEP_LEAVE

// mirrors wshrpc.AgentSyncKeepVault: replace a vault skill's stray copies with the vault copy
export const KEEP_VAULT = "vault";
// the in-map "leave it where it is" choice, sent as skip and never as a keep; the colon keeps it apart from
// any runtime name
export const KEEP_LEAVE = ":leave";

export type SkillGroupKind = "decide" | "differs" | "same" | "only" | "linked" | "managed";

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
    vault: boolean; // compared against the vault copy, not a base copy
    keys: string[];
    files: string[];
    bodydiff: boolean;
}

export interface SkillLinkEntry {
    runtime: string;
    label: string;
    path: string;
    target: string;
}

export interface SkillRow {
    name: string;
    kind: SkillGroupKind;
    description: string;
    // unresolved and unmanaged: the rail offers the keep radio
    needsKeep: boolean;
    left: boolean; // the user chose to leave it where it is
    copies: SkillCopy[]; // unmanaged copies in column order; empty for a managed skill
    strays: SkillCopy[]; // managed only: a harness's own copies of a vault skill, beside the vault copy
    replace: boolean; // managed only: the user chose to replace those own copies with the vault copy
    links: SkillLinkEntry[]; // a linked row's links, in column order
    deltas: Record<string, string[]>; // managed only: what each harness overrides
    additions: LearnAddition[]; // managed only: the lines the user accepted, rendered after the shipped text
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
const REPLACED: Omit<SkillCell, "runtime"> = {
    label: "Replaced",
    tone: "warn",
    title: "Set aside under skills-replaced when arcterm manages it",
};

// linked is optional: a reply with no list means no links
type SkillsData = Pick<
    CommandAgentSyncSkillsRtnData,
    "skills" | "columns" | "skillsroot" | "unmanaged" | "unresolved"
> &
    Partial<Pick<CommandAgentSyncSkillsRtnData, "linked">>;

function labelOf(columns: AgentSyncSkillColumn[], runtime: string): string {
    return columns.find((c) => c.runtime === runtime)?.label ?? runtime;
}

function canonicalNames(data: SkillsData): Set<string> {
    return new Set((data.skills ?? []).map((s) => s.name));
}

function columnOrder(data: SkillsData): (runtime: string) => number {
    const order = new Map((data.columns ?? []).map((c, i) => [c.runtime, i]));
    return (runtime) => order.get(runtime) ?? 0;
}

// a junction reads back with the NT \??\ prefix, which is no part of the path a person knows
function linkTarget(target: string): string {
    return target.replace(/^\\\?\?\\/, "");
}

// copies of each skill arcterm does not own yet, keyed by name, each list in column order
function unmanagedByName(data: SkillsData): Map<string, SkillCopy[]> {
    const order = columnOrder(data);
    const out = new Map<string, SkillCopy[]>();
    for (const m of data.unmanaged ?? []) {
        const copies = out.get(m.name) ?? [];
        copies.push({
            runtime: m.runtime,
            label: labelOf(data.columns ?? [], m.runtime),
            path: m.from,
            seed: m.seed,
            vault: m.vault === true,
            keys: m.keys ?? [],
            files: m.files ?? [],
            bodydiff: m.bodydiff,
        });
        out.set(m.name, copies);
    }
    for (const copies of out.values()) {
        copies.sort((a, b) => order(a.runtime) - order(b.runtime));
    }
    return out;
}

// links in a harness's skills folder, keyed by name, each list in column order
function linksByName(data: SkillsData): Map<string, SkillLinkEntry[]> {
    const order = columnOrder(data);
    const out = new Map<string, SkillLinkEntry[]>();
    for (const l of data.linked ?? []) {
        const links = out.get(l.name) ?? [];
        links.push({
            runtime: l.runtime,
            label: labelOf(data.columns ?? [], l.runtime),
            path: l.path,
            target: linkTarget(l.target),
        });
        out.set(l.name, links);
    }
    for (const links of out.values()) {
        links.sort((a, b) => order(a.runtime) - order(b.runtime));
    }
    return out;
}

// the own copies the backend marked as a vault skill's: only these ride the vault keep, so a copy of a vault name an
// older backend lists unmarked stays what it was
function strayCopies(canonical: Set<string>, byName: Map<string, SkillCopy[]>, name: string): SkillCopy[] {
    return canonical.has(name) ? (byName.get(name) ?? []).filter((c) => c.vault) : [];
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
function linkCell(link: SkillLinkEntry): SkillCell {
    return { runtime: link.runtime, label: "Link", tone: "none", title: link.target };
}

function managedCell(
    skill: AgentSyncSkill,
    col: AgentSyncSkillColumn,
    replaced: boolean,
    link: SkillLinkEntry | undefined
): SkillCell {
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
            return replaced
                ? { runtime: col.runtime, ...REPLACED }
                : { runtime: col.runtime, label: "Own copy", tone: "none" };
        case "linked":
            // a link to another folder: arcterm never writes through it. The title is the link's target when the
            // backend listed it, else what arcterm does with it
            return {
                runtime: col.runtime,
                label: "Link",
                tone: "warn",
                title:
                    link?.target ??
                    "A link to another folder: arcterm leaves it alone and does not write this skill here",
            };
    }
    return { runtime: col.runtime, ...NOTHING };
}

function unmanagedCell(
    copies: SkillCopy[],
    links: SkillLinkEntry[],
    kept: string | null,
    left: boolean,
    runtime: string
): SkillCell {
    const c = copies.find((x) => x.runtime === runtime);
    if (c == null) {
        const link = links.find((l) => l.runtime === runtime);
        return link != null ? linkCell(link) : { runtime, ...NOTHING };
    }
    if (left) {
        return { runtime, label: "Left alone", tone: "none" };
    }
    if (kept != null) {
        return kept === runtime ? { runtime, label: "Kept", tone: "ok" } : { runtime, ...REPLACED };
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

function unmanagedKind(copies: SkillCopy[], needsKeep: boolean, decided: boolean): SkillGroupKind {
    if (needsKeep && !decided) {
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
    const unmanaged = unmanagedByName(data);
    const links = linksByName(data);
    const rows: SkillRow[] = (data.skills ?? []).map((s) => {
        // a vault skill's own copies stay on its one row: as cells, and in the rail beside the vault copy
        const strays = strayCopies(canonical, unmanaged, s.name);
        const replace = strays.length > 0 && keep[s.name] === KEEP_VAULT;
        const skillLinks = links.get(s.name) ?? [];
        return {
            name: s.name,
            kind: "managed",
            description: s.description ?? "",
            needsKeep: false,
            left: false,
            copies: [],
            strays,
            replace,
            links: [],
            deltas: s.deltas ?? {},
            additions: s.additions ?? [],
            shipped: s.shipped === true,
            cells: columns.map((col) =>
                managedCell(
                    s,
                    col,
                    replace,
                    skillLinks.find((l) => l.runtime === col.runtime)
                )
            ),
        };
    });
    for (const [name, copies] of unmanaged) {
        // a vault skill's stray copies show as its "Own copy" cells, not as a second row
        if (canonical.has(name)) {
            continue;
        }
        const needsKeep = unresolved.has(name);
        const kept = validKeep(keep, name, copies);
        const left = keep[name] === KEEP_LEAVE;
        const nameLinks = links.get(name) ?? [];
        rows.push({
            name,
            kind: unmanagedKind(copies, needsKeep, kept != null || left),
            description: "",
            needsKeep,
            left,
            copies,
            strays: [],
            replace: false,
            links: [],
            deltas: {},
            additions: [],
            shipped: false,
            cells: columns.map((col) => unmanagedCell(copies, nameLinks, kept, left, col.runtime)),
        });
    }
    for (const [name, nameLinks] of links) {
        // a link beside a vault skill or a copy of the same name shows as that row's Link cell
        if (canonical.has(name) || unmanaged.has(name)) {
            continue;
        }
        rows.push({
            name,
            kind: "linked",
            description: "",
            needsKeep: false,
            left: false,
            copies: [],
            strays: [],
            replace: false,
            links: nameLinks,
            deltas: {},
            additions: [],
            shipped: false,
            cells: columns.map((col) => {
                const link = nameLinks.find((l) => l.runtime === col.runtime);
                return link != null ? linkCell(link) : { runtime: col.runtime, ...NOTHING };
            }),
        });
    }
    return rows;
}

// "+2" beside a skill that has lines the user taught it
export function additionsChip(row: SkillRow): string | null {
    return row.additions.length > 0 ? `+${row.additions.length}` : null;
}

const KIND_ORDER: SkillGroupKind[] = ["decide", "differs", "same", "only", "linked", "managed"];

function groupKey(row: SkillRow): string {
    if (row.kind === "managed") {
        return row.shipped ? "managed:shipped" : "managed";
    }
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
        case "linked":
            return "Linked from another folder";
        case "managed":
            // the user's own vault skills, which the rail edits, apart from the read-only ones arcterm ships
            return row.shipped ? "Ships with arcterm" : "Your skills";
    }
}

// Groups in the spec's order; "same" groups run widest first, "only" groups in column order.
export function skillGroups(data: SkillsData, keep: SkillKeep): SkillGroup[] {
    const order = columnOrder(data);
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
            return [kind, order(first.copies[0].runtime)];
        }
        if (g.kind === "managed") {
            return [kind, first.shipped ? 1 : 0];
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

// The keep map sent with adopt: a runtime only for an undecided skill and only one that holds a copy, the
// vault keep only for a vault skill with own copies the backend marked, since the backend refuses any other
// keep and moves nothing. A left-alone name goes in adoptSkip instead.
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
    for (const name of canonical) {
        if (keep[name] === KEEP_VAULT && strayCopies(canonical, byName, name).length > 0) {
            out[name] = KEEP_VAULT;
        }
    }
    return out;
}

// Names the user chose to leave where they are: unmanaged skills only, the one kind adopt would move.
export function adoptSkip(data: SkillsData, keep: SkillKeep): string[] {
    const canonical = canonicalNames(data);
    return [...unmanagedByName(data).keys()].filter((name) => !canonical.has(name) && keep[name] === KEEP_LEAVE).sort();
}

// Skills an adopt would move: every unmanaged name, less the undecided and left-alone ones it skips. A vault
// skill's own copy the backend marked counts once Replace is chosen: until then adopt leaves it where it is.
export function adoptCount(data: SkillsData, keep: SkillKeep): number {
    const canonical = canonicalNames(data);
    const byName = unmanagedByName(data);
    const unresolved = new Set(data.unresolved ?? []);
    const decided = adoptKeep(data, keep);
    let n = 0;
    for (const name of byName.keys()) {
        if (strayCopies(canonical, byName, name).length > 0) {
            n += decided[name] === KEEP_VAULT ? 1 : 0;
        } else if (keep[name] === KEEP_LEAVE && !canonical.has(name)) {
            continue;
        } else if (!unresolved.has(name) || decided[name] != null) {
            n++;
        }
    }
    return n;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The toast after Manage, counted from the adopt reply: what moved, what waits, what was skipped.
export function adoptResultText(rtn: CommandAgentSyncAdoptRtnData, sent: { skip: string[]; keep?: SkillKeep }): string {
    const unresolved = new Set(rtn.unresolved ?? []);
    const moved = new Set(
        (rtn.moves ?? [])
            .filter((m) => !unresolved.has(m.name) && (!m.vault || sent.keep?.[m.name] === KEEP_VAULT))
            .map((m) => m.name)
    );
    if (rtn.dryrun) {
        return `Snapshot: nothing moved (would move ${moved.size})`;
    }
    const parts = [`Moved ${plural(moved.size, "skill")} into the vault`];
    if (unresolved.size > 0) {
        parts.push(`${unresolved.size} wait for a decision`);
    }
    if (sent.skip.length > 0) {
        parts.push(`${sent.skip.length} left alone`);
    }
    return parts.join(" · ");
}

// The header's Pi line: how pi reaches the synced skills, in the tone the backend gave the note. The text is
// never read to decide the tone; a note with no tone is the ok one.
export function piSkillsLine(status: CommandAgentSyncStatusRtnData | null): { text: string; tone: Tone } | null {
    const pi = status?.harnesses?.find((h) => h.runtime === "pi");
    if (pi == null || !pi.present || !pi.note) {
        return null;
    }
    return { text: `Pi skills: ${pi.note}`, tone: pi.notetone === "warn" ? "warn" : "ok" };
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
    if (row.kind === "linked") {
        // a link's own folder: the link itself is what the harness reads
        return joinRepoPath(row.links[0].path, SKILL_FILE);
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
    if (c.vault) {
        return "Same as the vault copy";
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
        case "linked":
            return "A link to a skill kept in another folder. arcterm leaves links alone: it never moves one into the vault or writes through it.";
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
