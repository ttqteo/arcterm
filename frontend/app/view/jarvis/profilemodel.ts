// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure helpers for the Jarvis profile editor. The frontend edits only a PrinciplePatch (additions,
// per-global replacements, disables); it never materializes the resolved global list into the override.
// The merge rule itself lives only in Go (ResolvePrinciples) — the editor reads the resolved profile and
// diagnostics from the backend and never re-derives resolution here. principleRows() maps to presentation
// state (which badge / affordance each row shows), not effective policy.

// mirror the Go jarvis diagnostic codes so the editor can route a stale row's removal to the right action.
export const DIAGNOSTIC_MISSING_REPLACEMENT = "missing-replacement";
export const DIAGNOSTIC_MISSING_DISABLED = "missing-disabled";

export type PrinciplePatchAction =
    | { type: "override"; id: string; text: string }
    | { type: "reset"; id: string }
    | { type: "disable"; id: string }
    | { type: "reenable"; id: string }
    | { type: "add"; principle: Principle }
    | { type: "update-addition"; id: string; text: string }
    | { type: "delete-addition"; id: string };

// each action touches exactly one field (replacements / disabled / additions) and is fully immutable;
// the returned patch is cleaned so empty maps/slices are dropped and a fully-empty patch becomes undefined.
export function reducePrinciplePatch(
    patch: PrinciplePatch | undefined,
    action: PrinciplePatchAction
): PrinciplePatch | undefined {
    const additions = patch?.additions ? [...patch.additions] : [];
    const replacements = { ...(patch?.replacements ?? {}) };
    const disabled = patch?.disabled ? [...patch.disabled] : [];
    switch (action.type) {
        case "override":
            replacements[action.id] = action.text;
            break;
        case "reset":
            delete replacements[action.id];
            break;
        case "disable":
            if (!disabled.includes(action.id)) {
                disabled.push(action.id);
            }
            break;
        case "reenable": {
            const idx = disabled.indexOf(action.id);
            if (idx >= 0) {
                disabled.splice(idx, 1);
            }
            break;
        }
        case "add":
            additions.push(action.principle);
            break;
        case "update-addition":
            for (let i = 0; i < additions.length; i++) {
                if (additions[i].id === action.id) {
                    additions[i] = { ...additions[i], text: action.text };
                }
            }
            break;
        case "delete-addition": {
            const idx = additions.findIndex((a) => a.id === action.id);
            if (idx >= 0) {
                additions.splice(idx, 1);
            }
            break;
        }
    }
    return cleanPatch({ additions, replacements, disabled });
}

export type PrincipleRowKind = "inherited" | "modified" | "project" | "disabled" | "stale";

// presentation-only view of one editor row. Not a resolution result — a disabled global still appears
// (so the editor can list it under "Disabled · N"); stale rows exist only to be removed.
export type PrincipleRow = {
    id: string;
    text: string;
    kind: PrincipleRowKind;
    originalText?: string; // "modified" only — the inherited global text, for the comparison disclosure
    diagnostic?: string; // "stale" only — the diagnostic code, to route the remove action
};

export function principleRows(
    global: Principle[],
    patch: PrinciplePatch | undefined,
    diagnostics: PrincipleDiagnostic[]
): PrincipleRow[] {
    const replacements = patch?.replacements ?? {};
    const disabled = new Set(patch?.disabled ?? []);
    const globalIds = new Set(global.map((p) => p.id));
    const rows: PrincipleRow[] = [];
    for (const g of global) {
        if (disabled.has(g.id)) {
            rows.push({ id: g.id, text: g.text, kind: "disabled" });
        } else if (replacements[g.id] != null) {
            rows.push({ id: g.id, text: replacements[g.id], kind: "modified", originalText: g.text });
        } else {
            rows.push({ id: g.id, text: g.text, kind: "inherited" });
        }
    }
    for (const a of patch?.additions ?? []) {
        rows.push({ id: a.id, text: a.text, kind: "project" });
    }
    for (const d of diagnostics ?? []) {
        if (globalIds.has(d.principleid)) {
            continue; // still-valid global — not stale
        }
        rows.push({ id: d.principleid, text: replacements[d.principleid] ?? "", kind: "stale", diagnostic: d.code });
    }
    return rows;
}

// Compare normalized overrides so a structurally empty patch reads equal to no patch at all.
export function isDirty(a: ProfileOverride, b: ProfileOverride): boolean {
    return JSON.stringify(normalizeOverride(a)) !== JSON.stringify(normalizeOverride(b));
}

// The frontend mirror of jarvis.ProfileOverrideIsEmpty: every section absent, or a semantically empty one.
// One rule, so no editor can reach a different answer about whether a channel has a profile at all.
export function profileOverrideIsEmpty(o: ProfileOverride | null | undefined): boolean {
    if (o == null) {
        return true;
    }
    return (
        cleanPatch(o.principles) == null &&
        o.route == null &&
        o.defaultmode == null &&
        o.landing == null &&
        o.parallelism == null &&
        o.workerroute == null &&
        o.reviewerpicks == null &&
        o.reviewerroute == null &&
        o.lightreviewerroute == null &&
        o.autonomous == null
    );
}

// A future-run row's reset affordance: it exists exactly where the project overrides the global, and it is
// inert for the whole save — a reset mutates the draft, and the draft is what the in-flight write carries.
export function resetActionState(inherited: boolean, saving: boolean): { show: boolean; disabled: boolean } {
    return { show: !inherited, disabled: saving };
}

// True when the principle patch carries no additions, replacements, or disables.
export function principlePatchIsEmpty(patch: PrinciplePatch | null | undefined): boolean {
    return cleanPatch(patch) == null;
}

function cleanPatch(patch: PrinciplePatch | null | undefined): PrinciplePatch | undefined {
    if (patch == null) {
        return undefined;
    }
    const out: PrinciplePatch = {};
    if (patch.additions?.length) {
        out.additions = patch.additions;
    }
    if (patch.replacements && Object.keys(patch.replacements).length) {
        out.replacements = patch.replacements;
    }
    if (patch.disabled?.length) {
        out.disabled = patch.disabled;
    }
    return Object.keys(out).length ? out : undefined;
}

function normalizeOverride(o: ProfileOverride): ProfileOverride {
    const out: ProfileOverride = { ...o };
    const cleaned = cleanPatch(o.principles);
    if (cleaned == null) {
        delete out.principles;
    } else {
        out.principles = cleaned;
    }
    if (o.route?.runtime == null || o.route.runtime === "") {
        delete out.route;
    } else {
        out.route = { runtime: o.route.runtime, ...(o.route.model ? { model: o.route.model } : {}) };
    }
    return out;
}

export type GlobalPrincipleAction =
    | { type: "add"; principle: Principle }
    | { type: "update"; id: string; text: string }
    | { type: "delete"; id: string }
    | { type: "move"; id: string; dir: -1 | 1 };

// Global-scope principles are a plain flat list (no override/disable/inherit — those only make sense
// against a global baseline). Pure; "add" appends a caller-built principle so the reducer stays deterministic.
export function reduceGlobalPrinciples(list: Principle[], action: GlobalPrincipleAction): Principle[] {
    switch (action.type) {
        case "add":
            return [...list, action.principle];
        case "update":
            return list.map((p) => (p.id === action.id ? { ...p, text: action.text } : p));
        case "delete":
            return list.filter((p) => p.id !== action.id);
        case "move": {
            const i = list.findIndex((p) => p.id === action.id);
            const j = i + action.dir;
            if (i < 0 || j < 0 || j >= list.length) {
                return list;
            }
            const next = [...list];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        }
    }
}

// Structural dirty check for the whole global profile (plain data; key order is stable across edits).
export function globalProfileIsDirty(a: JarvisProfile, b: JarvisProfile): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
}

// the run defaults a project can set for itself, in the order the modal lists them
const OVERRIDE_FIELDS = [
    "defaultmode",
    "parallelism",
    "route",
    "workerroute",
    "reviewerroute",
    "lightreviewerroute",
    "landing",
    "autonomous",
] as const;
export type GlobalDefaultKey =
    | "defaultmode"
    | "parallelism"
    | "workerroute"
    | "reviewerroute"
    | "lightreviewerroute"
    | "landing"
    | "autonomous";
// the fields both scopes share. ProfileOverride and JarvisProfile agree on all of them; `route` is the one
// that does not exist globally, which is why the modal passes its lead-route row in.
export type ProfileDefaults = Pick<ProfileOverride, GlobalDefaultKey | "reviewerpicks">;

// Whether an override sets a row itself. The Worker route row is the workers setting, which Go resolves as
// one section made of workerroute and reviewerpicks (jarvis.ResolveProfile): either half makes it the project's.
export function overridesRow(o: ProfileOverride, key: GlobalDefaultKey | "route"): boolean {
    return key === "workerroute" ? o.workerroute != null || o.reviewerpicks != null : o[key] != null;
}

// the project-scope Run defaults meta: how many rows this project sets instead of inheriting
export function overrideSummary(o: ProfileOverride): string {
    const n = OVERRIDE_FIELDS.filter((k) => overridesRow(o, k)).length;
    return n === 0 ? "All from global" : `${n} set for this project`;
}

export type WorkersRow = { picks: boolean; route: RoutePin | null; inherited: boolean };

// What the Worker route row shows. An inherited row shows what the global resolves to, since its Same as lead
// answer is a value a project can state (reviewerpicks false), not the way back to global; Reset is that.
export function workersRow(draft: ProfileDefaults, base: JarvisProfile, inheritable: boolean): WorkersRow {
    const inherited = inheritable && !overridesRow(draft, "workerroute");
    const from = inherited ? base : draft;
    return { picks: from.reviewerpicks ?? false, route: from.workerroute ?? null, inherited };
}

export type WorkersChoice =
    | { kind: "lead" }
    | { kind: "picks" }
    | { kind: "route"; route: RoutePin }
    | { kind: "reset" };

// The server refuses Reviewer picks beside a worker route, so every choice writes both halves of the pair.
// Global scope unsets rather than stores false, so choosing Same as lead there reads clean against a profile
// that never had the key.
export function applyWorkersChoice<T extends ProfileDefaults>(
    draft: T,
    choice: WorkersChoice,
    inheritable: boolean
): T {
    const next = { ...draft };
    delete next.workerroute;
    delete next.reviewerpicks;
    switch (choice.kind) {
        case "picks":
            next.reviewerpicks = true;
            break;
        case "route":
            next.workerroute = choice.route;
            break;
        case "lead":
            if (inheritable) {
                next.reviewerpicks = false;
            }
            break;
    }
    return next;
}

export type ApprovalsRow = { autonomous: boolean; inherited: boolean };

// The Approvals row. A project's Ask me is a stated false, so it holds over a global Autonomous; Reset is the
// way back to inheriting.
export function approvalsRow(draft: ProfileDefaults, base: JarvisProfile, inheritable: boolean): ApprovalsRow {
    const inherited = inheritable && !overridesRow(draft, "autonomous");
    return { autonomous: (inherited ? base.autonomous : draft.autonomous) ?? false, inherited };
}

// Global scope unsets rather than stores false, so Ask me there reads clean against a profile that never had
// the key; a project stores the false, since unset would inherit.
export function applyApprovals<T extends ProfileDefaults>(draft: T, autonomous: boolean, inheritable: boolean): T {
    const next = { ...draft };
    if (autonomous || inheritable) {
        next.autonomous = autonomous;
    } else {
        delete next.autonomous;
    }
    return next;
}

// A row's Reset: drop the project's value so the row inherits again. The workers row is a pair, so both halves go.
export function resetRow(o: ProfileOverride, key: GlobalDefaultKey | "route"): ProfileOverride {
    if (key === "workerroute") {
        return applyWorkersChoice(o, { kind: "reset" }, true);
    }
    const next = { ...o };
    delete next[key];
    return next;
}

export type ReviewerRow = { value: RoutePin | null; inheritedLabel: string };

// The Reviewer route row. Unlike the workers pair, a project override has no way to say Same as lead over a
// global reviewer route (nil inherits), so its unset answer reads as the global's.
export function reviewerRow(draft: ProfileDefaults, base: JarvisProfile, inheritable: boolean): ReviewerRow {
    return {
        value: draft.reviewerroute ?? null,
        inheritedLabel: inheritable && base.reviewerroute != null ? "Same as global" : "Same as lead",
    };
}

// The Light reviewers route row: the plan review's lens and follow-up reviewers. Unset is the server's
// claude/sonnet default rather than the lead's route, so that is what the unset answer names.
export function lightReviewerRow(draft: ProfileDefaults, base: JarvisProfile, inheritable: boolean): ReviewerRow {
    return {
        value: draft.lightreviewerroute ?? null,
        inheritedLabel: inheritable && base.lightreviewerroute != null ? "Same as global" : "Sonnet (default)",
    };
}

// the project-scope Principles meta, counted off the same rows the editor draws
export function principleSummary(rows: PrincipleRow[]): string {
    const count = (kind: PrincipleRowKind) => rows.filter((r) => r.kind === kind).length;
    const fromGlobal = `${count("inherited") + count("modified") + count("disabled")} from global`;
    const changes = (
        [
            [count("modified"), "customized"],
            [count("project"), "added"],
            [count("disabled"), "disabled"],
        ] as const
    )
        .filter(([n]) => n > 0)
        .map(([n, label]) => `${n} ${label}`);
    return changes.length === 0 ? `${fromGlobal}, no changes here` : [fromGlobal, ...changes].join(" · ");
}

// one project's stored override, under the name the modal's project chips give it
export type ProjectOverride = { name: string; override: ProfileOverride };
export type Reach = { main: string; sub?: string };

// how far a global default reaches: every project that sets no value of its own inherits it. null with no
// projects, where there is nobody to reach.
export function defaultReach(projects: ProjectOverride[], key: GlobalDefaultKey): Reach | null {
    const total = projects.length;
    if (total === 0) {
        return null;
    }
    const own = projects.filter((p) => overridesRow(p.override, key)).map((p) => p.name);
    if (own.length === 0) {
        return { main: total === 1 ? "1 project" : `All ${total} projects` };
    }
    const sub = own.length === 1 ? `${own[0]} sets its own` : `${own.length} set their own`;
    if (own.length === total) {
        return { main: "No projects", sub };
    }
    return { main: `${total - own.length} of ${total} projects`, sub };
}

function nameList(names: string[]): string {
    return names.length <= 2 ? names.join(" and ") : `${names.length} projects`;
}

// the line under a global principle naming the projects an edit to it will not reach. A disable wins over a
// replacement, as it does in principleRows. `edited` turns it into a warning while the draft differs.
export function principleNote(
    projects: ProjectOverride[],
    id: string,
    edited: boolean
): { text: string; warn: boolean } | null {
    const disabled = projects.filter((p) => p.override.principles?.disabled?.includes(id)).map((p) => p.name);
    const reworded = projects
        .filter((p) => p.override.principles?.replacements?.[id] != null && !disabled.includes(p.name))
        .map((p) => p.name);
    if (disabled.length === 0 && reworded.length === 0) {
        return null;
    }
    if (edited) {
        return { text: `This edit won't reach ${nameList([...reworded, ...disabled])}`, warn: true };
    }
    const parts: string[] = [];
    if (reworded.length > 0) {
        parts.push(`${nameList(reworded)} ${reworded.length === 1 ? "uses its" : "use their"} own wording`);
    }
    if (disabled.length > 0) {
        parts.push(`Disabled in ${nameList(disabled)}`);
    }
    return { text: parts.join(" · "), warn: false };
}

// The kinds a playbook phase can be authored as. Deliberately not Go's full PhaseKind set: the profile
// playbook only ever composes a pipeline run — resolveRunPlan builds quick and orchestrator runs from their
// own fixed playbooks — so an "orchestrate" phase authored here would never be dispatched.
export const PHASE_KINDS = ["brainstorm", "plan", "execute", "custom"] as const;

export type PlaybookAction =
    | { type: "add" }
    | { type: "update"; index: number; phase: RunPhase }
    | { type: "remove"; index: number }
    | { type: "move"; index: number; dir: -1 | 1 };

// Pure and index-addressed, because a phase carries no id — two "custom" phases are distinguishable only
// by position. An out-of-range index returns the list unchanged rather than throwing, so a click that
// lands after the list has shrunk cannot corrupt the draft.
export function reducePlaybook(phases: RunPhase[], action: PlaybookAction): RunPhase[] {
    switch (action.type) {
        case "add":
            return [...phases, { kind: "custom", state: "pending" }];
        case "update":
            return phases.map((p, i) => (i === action.index ? action.phase : p));
        case "remove":
            return phases.filter((_, i) => i !== action.index);
        case "move": {
            const j = action.index + action.dir;
            if (action.index < 0 || action.index >= phases.length || j < 0 || j >= phases.length) {
                return phases;
            }
            const next = [...phases];
            [next[action.index], next[j]] = [next[j], next[action.index]];
            return next;
        }
    }
}
