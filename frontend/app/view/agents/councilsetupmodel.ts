// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Setup's pure rules (councilsetup.tsx draws them): the panel a group makes, editing a draft's panel, files
// and screenshots, when the coordinator's suggestion is asked and how it lands, what Start council sends, and the footer's
// words. The draft type is councilmodel.ts's; every function here returns the next draft and leaves the one it was given
// alone, and returns that same object when nothing changed so an atom set from it does not rerender. Pure, no React, no
// Wave runtime imports (councilsetupmodel.test.ts).

import { councilProjectKey, type CouncilSetupDraft } from "./councilmodel";

export const MODEL_CHOICES = ["sonnet", "opus", "haiku"] as const;

/** The role library and the saved groups, as `councilRoles()` answers them. */
export interface RoleLibrary {
    roles: CouncilExpert[];
    groups: CouncilGroup[];
}

// a role as a panel member: the library's flag and a suggestion's reason are not the panel's to keep
function member(role: CouncilExpert, coordinator: boolean): CouncilExpert {
    return { ...role, coordinator: coordinator ? true : undefined, why: undefined };
}

/** Pure: the panel of a group, as pkg/council's ExpertsFor builds it: its roles in order, a role that is unknown or
 *  repeated left out, the coordinator last and flagged (by the group, not by the role). Empty for a group that is not
 *  there or whose coordinator is not a known role, which cannot run. */
export function panelFor(lib: RoleLibrary, groupId: string): CouncilExpert[] {
    const group = lib.groups.find((g) => g.id === groupId);
    if (group == null) {
        return [];
    }
    const byId = new Map(lib.roles.map((r) => [r.id, r]));
    const coordinator = byId.get(group.coordinator);
    if (coordinator == null) {
        return [];
    }
    const seen = new Set<string>([coordinator.id]);
    const panel: CouncilExpert[] = [];
    for (const id of group.roles) {
        const role = byId.get(id);
        if (role == null || seen.has(id)) {
            continue;
        }
        seen.add(id);
        panel.push(member(role, false));
    }
    return [...panel, member(coordinator, true)];
}

/** Pure: the draft on `groupId`'s panel. `picked` is the person choosing it (a group Setup or the suggestion chose is
 *  not a pick, and a later suggestion may still change it). */
export function applyGroup(
    draft: CouncilSetupDraft,
    lib: RoleLibrary,
    groupId: string,
    picked: boolean
): CouncilSetupDraft {
    const experts = panelFor(lib, groupId);
    if (experts.length === 0) {
        return draft;
    }
    return { ...draft, group: groupId, experts, groupPicked: picked || draft.groupPicked };
}

/** Pure: a draft with no panel yet starts on the library's first group. */
export function initialPanel(draft: CouncilSetupDraft, lib: RoleLibrary): CouncilSetupDraft {
    if (draft.experts.length > 0 || lib.groups.length === 0) {
        return draft;
    }
    return applyGroup(draft, lib, lib.groups[0].id, false);
}

/** Pure: a group's name for the group button; a panel with no group in the library is Custom. */
export function groupName(lib: RoleLibrary, groupId: string): string {
    return lib.groups.find((g) => g.id === groupId)?.name ?? "Custom";
}

// ---- the panel ----

// editing the rows is the person taking the panel over: a suggested group must not replace what they made
export function removeExpert(draft: CouncilSetupDraft, id: string): CouncilSetupDraft {
    const e = draft.experts.find((x) => x.id === id);
    if (e == null || e.coordinator) {
        return draft;
    }
    return { ...draft, experts: draft.experts.filter((x) => x.id !== id), groupPicked: true };
}

export function setExpertModel(draft: CouncilSetupDraft, id: string, model: string): CouncilSetupDraft {
    if (!draft.experts.some((x) => x.id === id)) {
        return draft;
    }
    return {
        ...draft,
        experts: draft.experts.map((x) => (x.id === id ? { ...x, model } : x)),
        groupPicked: true,
    };
}

/** Pure: a role added to the panel, ahead of the coordinator, without the reason a suggestion gave it. */
export function addRole(draft: CouncilSetupDraft, role: CouncilExpert): CouncilSetupDraft {
    if (draft.experts.some((x) => x.id === role.id)) {
        return draft;
    }
    const added = member(role, false);
    const at = draft.experts.findIndex((x) => x.coordinator);
    const experts =
        at < 0 ? [...draft.experts, added] : [...draft.experts.slice(0, at), added, ...draft.experts.slice(at)];
    return { ...draft, experts, groupPicked: true };
}

/** Pure: the suggested roles not yet on the panel, which Setup draws as dashed rows with Add. */
export function pendingRoles(draft: CouncilSetupDraft): CouncilExpert[] {
    return (draft.suggestion?.roles ?? []).filter((r) => !draft.experts.some((x) => x.id === r.id));
}

export function expertInitial(e: CouncilExpert): string {
    return Array.from(e.name.trim())[0]?.toUpperCase() ?? "?";
}

export type ExpertTone = "conn-1" | "conn-2" | "conn-3" | "conn-6" | "conn-7" | "conn-8" | "coordinator";

// the conn-* identity palette, the same slots the Discussion draws its avatars in; conn-4 (red) and conn-5 (a second
// blue) are left out for reading as an error and as conn-1's twin
const PANEL_TONES: ExpertTone[] = ["conn-1", "conn-2", "conn-3", "conn-6", "conn-7", "conn-8"];

/** Pure: the ring color of the row at `index`: the coordinator apart, the others in turn by their place among the panel. */
export function expertTone(experts: CouncilExpert[], index: number): ExpertTone {
    if (experts[index]?.coordinator) {
        return "coordinator";
    }
    const slot = experts.slice(0, index).filter((e) => !e.coordinator).length;
    return PANEL_TONES[slot % PANEL_TONES.length];
}

// ---- files and screenshots ----

/** Pure: the last part of a path, either separator, a trailing one ignored. */
export function basename(path: string): string {
    return (
        path
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() ?? ""
    );
}

/** Pure: a path under the project as the council keeps it, relative with forward slashes; one outside it, a relative one
 *  and the project itself unchanged. */
export function relativeToProject(project: string, path: string): string {
    const root = councilProjectKey(project.trim());
    const key = councilProjectKey(path);
    if (root === "" || key.length <= root.length || !key.startsWith(`${root}/`)) {
        return path;
    }
    return path
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .slice(root.length + 1);
}

const sameFile = (a: string, b: string) => councilProjectKey(a) === councilProjectKey(b);

function withFiles(draft: CouncilSetupDraft, paths: string[]): string[] {
    const files = [...draft.files];
    for (const raw of paths) {
        const path = relativeToProject(draft.project, raw.trim());
        if (path !== "" && !files.some((f) => sameFile(f, path))) {
            files.push(path);
        }
    }
    return files;
}

/** Pure: files and folders added to what the experts read, each once, the ones under the project relative. */
export function addFiles(draft: CouncilSetupDraft, paths: string[]): CouncilSetupDraft {
    const files = withFiles(draft, paths);
    return files.length === draft.files.length ? draft : { ...draft, files };
}

export function removeFile(draft: CouncilSetupDraft, path: string): CouncilSetupDraft {
    return { ...draft, files: draft.files.filter((f) => f !== path) };
}

/** Pure: a screenshot's file added (as saved, not made relative: it lives outside the project). */
export function addScreenshot(draft: CouncilSetupDraft, path: string): CouncilSetupDraft {
    const p = path.trim();
    if (p === "" || draft.screenshots.some((s) => sameFile(s, p))) {
        return draft;
    }
    return { ...draft, screenshots: [...draft.screenshots, p] };
}

export function removeScreenshot(draft: CouncilSetupDraft, path: string): CouncilSetupDraft {
    return { ...draft, screenshots: draft.screenshots.filter((s) => s !== path) };
}

// ---- the coordinator's suggestion ----

/** Pure: the request that asks the coordinator for files and roles, or null when it is not time: only an idle draft asks
 *  (once), and only with a feature and a first file to read, or a question from Ask the council (a draft with a session)
 *  whose question stands for the feature until the person names one. */
export function suggestRequest(draft: CouncilSetupDraft): CommandCouncilSuggestData | null {
    if (draft.suggestState !== "idle" || draft.project.trim() === "") {
        return null;
    }
    const feature = draft.feature.trim();
    const question = draft.question.trim();
    const fromAsk = question !== "" && (draft.sessionId ?? "") !== "";
    if (!(feature !== "" && draft.files.length > 0) && !fromAsk) {
        return null;
    }
    return {
        project: draft.project,
        feature: feature || question,
        question: question || undefined,
        files: [...draft.files],
    };
}

export function beginSuggest(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.suggestState === "idle" ? { ...draft, suggestState: "asking" } : draft;
}

/** Pure: a draft that arrives already configured (Run again hands over its experts with the group counted as picked) is
 *  a rerun of a council that had its say, and opening it must not spend a model call: its suggestion counts as done.
 *  Only for a draft that came from outside Setup: a person who picks a group or drops a row on a fresh draft is not
 *  rerunning anything and still gets the suggestion. */
export function settleRerun(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.suggestState === "idle" && draft.groupPicked && draft.experts.length > 0
        ? { ...draft, suggestState: "done" }
        : draft;
}

/** Pure: what the answer changes: its files join the chips, its roles wait as dashed rows, and its group replaces the
 *  panel unless the person has picked a group or edited the rows. Lands only on a draft that is waiting for it. */
export function applySuggestion(
    draft: CouncilSetupDraft,
    suggestion: CouncilSuggestion,
    lib: RoleLibrary
): CouncilSetupDraft {
    if (draft.suggestState !== "asking") {
        return draft;
    }
    let next: CouncilSetupDraft = {
        ...draft,
        files: withFiles(draft, suggestion.files ?? []),
        suggestion: { files: suggestion.files ?? [], roles: suggestion.roles ?? [], group: suggestion.group },
        suggestState: "done",
    };
    const group = suggestion.group ?? "";
    if (group !== "" && !draft.groupPicked) {
        next = applyGroup(next, lib, group, false);
    }
    return next;
}

/** Pure: the suggestion failed; the panel and the files are left as they were. */
export function failSuggestion(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.suggestState === "asking" ? { ...draft, suggestState: "failed" } : draft;
}

/** Pure: a failed suggestion may be asked again. */
export function retrySuggestion(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.suggestState === "failed" ? { ...draft, suggestState: "idle" } : draft;
}

// ---- Start council ----

// ---- the composer ----

/** Pure: the composer's text split the way the draft keeps it: the first non-empty line is the feature, the rest (trimmed,
 *  its line breaks kept) the question. One line that ends with `?` is both: a question alone names what to review. */
export function splitAsk(text: string): { feature: string; question: string } {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() !== "");
    if (at < 0) {
        return { feature: "", question: "" };
    }
    const feature = lines[at].trim();
    const question = lines
        .slice(at + 1)
        .join("\n")
        .trim();
    return { feature, question: question === "" && feature.endsWith("?") ? feature : question };
}

/** Pure: the draft as the composer shows it: the feature, then the question on the next line; the question alone when
 *  there is no feature or it is the same line. */
export function joinAsk(draft: CouncilSetupDraft): string {
    const feature = draft.feature.trim();
    const question = draft.question.trim();
    if (feature === "") {
        return question;
    }
    return question === "" || question === feature ? feature : `${feature}\n${question}`;
}

/** Pure: what the composer shows: the text the person last typed while the draft still reads from it (so a trailing line
 *  break survives until there is a second line), else the draft's own text (it came from outside: Run again, Ask the
 *  council, a draft saved before the composer). */
export function askText(draft: CouncilSetupDraft, typed: string | null): string {
    if (typed != null) {
        const s = splitAsk(typed);
        if (s.feature === draft.feature.trim() && s.question === draft.question.trim()) {
            return typed;
        }
    }
    return joinAsk(draft);
}

/** Pure: why Start council is off, or empty when it is on. */
export function startBlocker(draft: CouncilSetupDraft): string {
    if (draft.project.trim() === "") {
        return "Choose a project first";
    }
    if (draft.feature.trim() === "" && draft.question.trim() === "") {
        return "Say what the council should review";
    }
    if (!draft.experts.some((e) => e.coordinator)) {
        return "Pick a group of experts";
    }
    if (!draft.experts.some((e) => !e.coordinator)) {
        return "Keep at least one expert besides the coordinator";
    }
    return "";
}

/** Pure: what Start council sends: the draft's inputs and its panel, the coordinator last. */
export function startData(draft: CouncilSetupDraft): CommandCouncilStartData {
    const question = draft.question.trim();
    return {
        project: draft.project,
        // a question from Ask the council stands for the feature until the person names one (as suggestRequest has it)
        feature: draft.feature.trim() || question,
        question: question || undefined,
        files: draft.files,
        screenshots: draft.screenshots,
        group: draft.group || undefined,
        experts: draft.experts,
        pause: draft.pause,
        sessionid: draft.sessionId || undefined,
    };
}

// ---- the footer ----

export function estimateRequest(draft: CouncilSetupDraft): CommandCouncilEstimateData {
    return { project: draft.project, files: draft.files, experts: draft.experts };
}

/** Pure: what the estimate depends on. Tokens are counted, not priced, so a model change does not move it. */
export function estimateKey(draft: CouncilSetupDraft): string {
    const n = draft.experts.filter((e) => !e.coordinator).length;
    return `${councilProjectKey(draft.project)}\n${draft.files.join("\n")}\n${n}`;
}

/** Pure: `4 sonnet experts read the code first; then they argue over text only`; empty with no expert. */
export function readingLine(draft: CouncilSetupDraft): string {
    const panel = draft.experts.filter((e) => !e.coordinator);
    if (panel.length === 0) {
        return "";
    }
    const counts = new Map<string, number>();
    for (const e of panel) {
        const model = e.model || "sonnet";
        counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    // the model most of them use first; a tie keeps the order the panel names them in
    const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([model, n]) => `${n} ${model}`);
    const who = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `${who} ${panel.length === 1 ? "expert reads" : "experts read"} the code first; then they argue over text only`;
}

/** Pure: the one line under the composer: the group, its experts by name, and the coordinator who writes the answer;
 *  empty with no expert. */
export function expertsLine(draft: CouncilSetupDraft, lib: RoleLibrary): string {
    const names = draft.experts.filter((e) => !e.coordinator).map((e) => e.name);
    if (names.length === 0) {
        return "";
    }
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const coordinator = draft.experts.find((e) => e.coordinator)?.name;
    const read = `${who} ${names.length === 1 ? "reads the code from its own side" : "each read the code from their own side"}`;
    return `${groupName(lib, draft.group)}: ${read}${coordinator != null ? `; the ${coordinator} writes the answer` : ""}.`;
}

// ---- Save as group ----

/** Pure: the id a saved group gets from the name typed: lower case words joined by dashes; empty when nothing is left. */
export function groupSlug(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

/** Pure: the group the panel saves as, from the library roles on it in order and its coordinator, and the names left out
 *  because a group keeps role ids and wavesrv has nowhere to keep a role (a suggested one). Null with no name, no
 *  coordinator from the library or no role to keep. */
export function groupFromDraft(
    draft: CouncilSetupDraft,
    lib: RoleLibrary,
    name: string
): { group: CouncilGroup; left: string[] } | null {
    const id = groupSlug(name);
    const known = new Set(lib.roles.map((r) => r.id));
    const coordinator = draft.experts.find((e) => e.coordinator);
    if (id === "" || coordinator == null || !known.has(coordinator.id)) {
        return null;
    }
    const others = draft.experts.filter((e) => !e.coordinator);
    const roles = others.filter((e) => known.has(e.id)).map((e) => e.id);
    if (roles.length === 0) {
        return null;
    }
    return {
        group: { id, name: name.trim(), roles, coordinator: coordinator.id },
        left: others.filter((e) => !known.has(e.id)).map((e) => e.name),
    };
}
