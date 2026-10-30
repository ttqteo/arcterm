// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Setup's pure rules (councilsetup.tsx draws them): the panel a group makes, editing a draft's panel, files
// and screenshots, the mode (Review or Brainstorm) and its chip, the live agents seated beside the experts and the Rounds
// they answer, when the coordinator's suggestion is asked and how it lands, when Auto-generate asks and how its answer
// lands on the composer, what Start council sends and what the button reads, and the footer's words. The draft type is councilmodel.ts's; every function here returns the next draft and leaves the one it was given
// alone, and returns that same object when nothing changed so an atom set from it does not rerender. Pure, no React, no
// Wave runtime imports (councilsetupmodel.test.ts).

import { formatTokens, projectOf, type AgentVM } from "./agentsviewmodel";
import {
    agentSeat,
    councilProjectKey,
    estimateLabel,
    estimateTokens,
    type CouncilSetupDraft,
    type SeatableAgent,
} from "./councilmodel";

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

// ---- the mode ----

export type CouncilMode = CouncilSetupDraft["mode"];

/** The group a Brainstorm opens on, and the one a Review falls back to when the suggestion names none. */
export const BRAINSTORM_GROUP = "product-ideas";
export const REVIEW_GROUP = "ui-feature";

const MODE_NAME: Record<CouncilMode, string> = { review: "Review", brainstorm: "Brainstorm" };

const MODE_RULES: Record<CouncilMode, string> = {
    brainstorm: "Ideas first and no doubts yet; then they build on each other and pick the best.",
    review: "Every claim cites a file line or a screenshot, or is marked as citing nothing.",
};

// the wire word of a suggestion's mode; anything but the two modes is no answer
function asMode(word: string | undefined): CouncilMode | undefined {
    return word === "review" || word === "brainstorm" ? word : undefined;
}

function suggestedMode(draft: CouncilSetupDraft): CouncilMode | undefined {
    return asMode(draft.suggestion?.mode);
}

/** Pure: the mode chip in the composer's bar: the mode, and whose pick it is: `Brainstorm · picked from your question`
 *  when the coordinator named it, `Review · picked from the conversation` when Auto-generate did, `Review · you picked
 *  it` once the person flipped the chip (or a rerun carried it). A draft whose suggestion named no mode reads the mode
 *  alone. */
export function modeChip(draft: CouncilSetupDraft): string {
    const name = MODE_NAME[draft.mode];
    if (draft.modeFrom === "conversation") {
        return `${name} · picked from the conversation`;
    }
    if (draft.modePicked) {
        return `${name} · you picked it`;
    }
    return suggestedMode(draft) != null ? `${name} · picked from your question` : name;
}

/** Pure: the one sentence of rules under the chip. */
export function modeRules(mode: CouncilMode): string {
    return MODE_RULES[mode];
}

/** Pure: the suggestion's one-line reason for the mode, empty when the person picked it, Auto-generate did or it named
 *  none. */
export function modeReason(draft: CouncilSetupDraft): string {
    if (draft.modePicked || draft.modeFrom != null || suggestedMode(draft) == null) {
        return "";
    }
    return (draft.suggestion?.modewhy ?? "").trim();
}

// the draft in `mode`, its group following unless the person picked or edited one: Product ideas for Brainstorm, the
// suggestion's group or the UI group for Review. Whose pick the mode is stays the caller's to say
function followMode(draft: CouncilSetupDraft, mode: CouncilMode, lib: RoleLibrary): CouncilSetupDraft {
    const next: CouncilSetupDraft = { ...draft, mode };
    if (draft.groupPicked) {
        return next;
    }
    return applyGroup(
        next,
        lib,
        mode === "brainstorm" ? BRAINSTORM_GROUP : draft.suggestion?.group || REVIEW_GROUP,
        false
    );
}

/** Pure: the draft in the other mode, counted as the person's pick (a later suggestion no longer changes it, and the
 *  chip stops saying Auto-generate picked it). Its group follows the mode unless the person picked or edited one:
 *  Product ideas for Brainstorm, the suggestion's group or the UI group for Review. */
export function flipMode(draft: CouncilSetupDraft, lib: RoleLibrary): CouncilSetupDraft {
    const { modeFrom: _modeFrom, ...rest } = draft;
    return followMode({ ...rest, modePicked: true }, draft.mode === "brainstorm" ? "review" : "brainstorm", lib);
}

/** Pure: whether a council runs (any project: one runs at a time, and a council waiting on the person holds no slot),
 *  which makes a new one wait its turn. */
export function anyCouncilRunning(councils: readonly Council[] | null | undefined): boolean {
    return (councils ?? []).some((c) => c.state === "running");
}

/** Pure: Start council's label: Queue council while a council runs, else Start council. */
export function startLabel(councils: readonly Council[] | null | undefined): string {
    return anyCouncilRunning(councils) ? "Queue council" : "Start council";
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

// ---- live agents and rounds ----

/** The Rounds switch's choices: how many rounds the seats answer, the ideas round included. */
export const ROUND_CHOICES = [1, 2, 3] as const;

/** The one line under the Seats list. */
export const AGENT_NOTE =
    "An agent takes its turn in its own session, so the talk also lands in its transcript. A busy agent is waited for up to 10 min, then skips that round.";

// what a seat's turn costs, as pkg/council/estimate.go counts an expert's (round1BaseTokens, round2Tokens,
// synthesisTokens). They only label the rows: the estimate in the composer's bar is wavesrv's own number.
const EXPERT_FIRST_TURN_TOKENS = 140_000;
const EXPERT_TURN_TOKENS = 45_000;
const COORDINATOR_TOKENS = 80_000;

// the harnesses wavesrv can seat: the ones `wsh agents` reaches
const SEATABLE_HARNESSES = new Set(["claude", "pi"]);

/** Pure: whether a live agent is seated. The council then holds every answer as a draft, so Setup shows Rounds and has
 *  no pause after the first ideas. */
export function draftHasAgents(draft: Pick<CouncilSetupDraft, "agents">): boolean {
    return draft.agents.length > 0;
}

/** Pure: every seat in the order Setup lists and the start sends them: the agents as they were added, then the experts,
 *  the coordinator last. */
export function seatsOf(draft: Pick<CouncilSetupDraft, "agents" | "experts">): CouncilExpert[] {
    return [...draft.agents.map((a) => a.seat), ...draft.experts];
}

/** Pure: a live agent seated, once. Its project is the one it works in, which the council's own may differ from. */
export function addAgent(draft: CouncilSetupDraft, agent: SeatableAgent): CouncilSetupDraft {
    if (draft.agents.some((a) => a.seat.agent === agent.id)) {
        return draft;
    }
    return { ...draft, agents: [...draft.agents, { seat: agentSeat(agent), project: agent.project }] };
}

/** Pure: the agent with tab id `tabId` taken out of the seats. */
export function removeAgent(draft: CouncilSetupDraft, tabId: string): CouncilSetupDraft {
    if (!draft.agents.some((a) => a.seat.agent === tabId)) {
        return draft;
    }
    return { ...draft, agents: draft.agents.filter((a) => a.seat.agent !== tabId) };
}

/** Pure: the Rounds the seats answer, 1 to 3 (anything else leaves the draft as it was). */
export function setRounds(draft: CouncilSetupDraft, rounds: number): CouncilSetupDraft {
    if (!(ROUND_CHOICES as readonly number[]).includes(rounds) || rounds === draft.rounds) {
        return draft;
    }
    return { ...draft, rounds };
}

/** Pure: the roster's agents a council can seat: a claude or pi agent (not a terminal, a background agent or another
 *  harness), with the project's path (the registered one, else where it runs, else `fallbackProject`) and the context it
 *  holds now, which is what each of its turns re-reads. This is the one seat rule: the agent tree's Discuss together
 *  asks it too (`seatableOf`), with an empty `fallbackProject` when there is no council project yet. */
export function seatableAgents(
    roster: readonly AgentVM[],
    registry: Readonly<Record<string, { path?: string }>> | null | undefined,
    fallbackProject: string
): SeatableAgent[] {
    const seatable: SeatableAgent[] = [];
    for (const vm of roster) {
        if ((vm.kind != null && vm.kind !== "agent") || !SEATABLE_HARNESSES.has(vm.agent ?? "")) {
            continue;
        }
        const usage = vm.usage;
        seatable.push({
            id: vm.id,
            name: vm.name,
            project: registry?.[projectOf(vm)]?.path || vm.cwd || fallbackProject,
            harness: vm.agent ?? "",
            context: usage?.contextmax ? Math.round(((usage.contextpct ?? 0) / 100) * usage.contextmax) : 0,
        });
    }
    return seatable;
}

/** Pure: the agents Add agent offers: the seatable ones not seated yet. */
export function unseatedAgents(
    agents: readonly SeatableAgent[],
    draft: Pick<CouncilSetupDraft, "agents">
): SeatableAgent[] {
    return agents.filter((a) => !draft.agents.some((d) => d.seat.agent === a.id));
}

/** Pure: the library roles Add expert offers: not on the panel yet, and not a group's coordinator (the panel has its own). */
export function addableRoles(draft: CouncilSetupDraft, lib: RoleLibrary): CouncilExpert[] {
    const coordinators = new Set(lib.groups.map((g) => g.coordinator));
    return lib.roles.filter(
        (r) => !r.coordinator && !coordinators.has(r.id) && !draft.experts.some((x) => x.id === r.id)
    );
}

/** Pure: ` + 2 more` after the project's name when the agents come from other projects than the council's own (the
 *  first agent's); empty when every seat is in one. */
export function moreProjects(draft: Pick<CouncilSetupDraft, "project" | "agents">): string {
    const keys = new Set([draft.project, ...draft.agents.map((a) => a.project)].map(councilProjectKey));
    return keys.size > 1 ? ` + ${keys.size - 1} more` : "";
}

/** One line of Setup's Seats list. */
export interface SeatRow {
    expert: CouncilExpert;
    kind: "agent" | "expert";
    meta: string; // `claude · arc`, `sonnet · <its brief>`, `opus · writes the summary`
    cost: string; // what one turn costs: an agent's whole context, an expert's call, the coordinator's summary
    costNote: string; // the title that says what the cost is
    removable: boolean; // the coordinator stays
}

/** Pure: the Seats list: the agents first, then the experts and the coordinator, each with its cost per turn.
 *  `projectName` names the project an agent works in. */
export function seatRows(draft: CouncilSetupDraft, projectName: (path: string) => string): SeatRow[] {
    const agents = draft.agents.map(
        (a): SeatRow => ({
            expert: a.seat,
            kind: "agent",
            meta: [a.seat.harness, projectName(a.project)].filter(Boolean).join(" · "),
            cost: a.seat.context ? `${formatTokens(a.seat.context)} / turn` : "size unknown",
            costNote: "Its context, which every turn of its own session re-reads",
            removable: true,
        })
    );
    const experts = draft.experts.map(
        (e): SeatRow =>
            e.coordinator
                ? {
                      expert: e,
                      kind: "expert",
                      meta: `${e.model} · writes the summary`,
                      cost: `≈${formatTokens(COORDINATOR_TOKENS)}`,
                      costNote: "One call, for the summary",
                      removable: false,
                  }
                : {
                      expert: e,
                      kind: "expert",
                      meta: [e.model, e.brief].filter(Boolean).join(" · "),
                      cost: `≈${formatTokens(EXPERT_TURN_TOKENS)} / turn`,
                      costNote: `About ${formatTokens(EXPERT_FIRST_TURN_TOKENS)} in round 1, when it reads the code`,
                      removable: true,
                  }
    );
    return [...agents, ...experts];
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

/** Pure: what the answer changes: its files join the chips, its roles wait as dashed rows, its mode becomes the draft's
 *  unless the person flipped the chip, and its group replaces the panel unless the person has picked a group or edited
 *  the rows. A Brainstorm opens on Product ideas whatever group came with it. Lands only on a draft that is waiting for
 *  it. */
export function applySuggestion(
    draft: CouncilSetupDraft,
    suggestion: CouncilSuggestion,
    lib: RoleLibrary
): CouncilSetupDraft {
    if (draft.suggestState !== "asking") {
        return draft;
    }
    const named = asMode(suggestion.mode);
    const mode: CouncilMode = draft.modePicked || named == null ? draft.mode : named;
    let next: CouncilSetupDraft = {
        ...draft,
        mode,
        files: withFiles(draft, suggestion.files ?? []),
        suggestion: {
            files: suggestion.files ?? [],
            roles: suggestion.roles ?? [],
            group: suggestion.group,
            mode: suggestion.mode,
            modewhy: suggestion.modewhy,
        },
        suggestState: "done",
    };
    // a suggestion with no mode named keeps the draft's: its group alone decides, as before modes
    const group =
        mode === "brainstorm" ? BRAINSTORM_GROUP : suggestion.group || (mode !== draft.mode ? REVIEW_GROUP : "");
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

// ---- Auto-generate ----

/** Pure: whether Setup offers Auto-generate: at least one live agent is seated, whose conversation it reads. */
export function autoGenerateShown(draft: CouncilSetupDraft): boolean {
    return draftHasAgents(draft);
}

/** Pure: the request that has wavesrv write the topic, a question and the mode from the seated agents' conversations
 *  (their tab ids, in seat order), or null when it is not time: one is already out, no agent is seated or there is no
 *  project to read from. */
export function autoGenerateRequest(draft: CouncilSetupDraft): CommandCouncilAutoGenerateData | null {
    const agents = draft.agents.map((a) => a.seat.agent ?? "").filter((id) => id !== "");
    if (draft.autoState === "asking" || agents.length === 0 || draft.project.trim() === "") {
        return null;
    }
    return { project: draft.project, agents };
}

// the draft with Auto-generate's state cleared: nothing out, no reason held, no answer waiting. `autoLast` and
// `modeFrom` belong to the composer and the mode, not to a press
function withoutAutoState(draft: CouncilSetupDraft): CouncilSetupDraft {
    const { autoState: _state, autoError: _error, autoPending: _pending, ...rest } = draft;
    return rest;
}

/** Pure: the press: the draft waits on the answer, with an earlier failure or waiting answer forgotten. A draft that
 *  already waits is left as it is. */
export function beginAutoGenerate(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.autoState === "asking" ? draft : { ...withoutAutoState(draft), autoState: "asking" };
}

// the answer written into the draft: the topic is the feature, the question the question, and `autoLast` the composer
// text that makes. The mode and group stay when the person picked the mode; otherwise (never picked, or picked by an
// earlier Auto-generate, which is not a pick) the mode is the answer's, counted as picked from the conversation, and the
// group follows it as a flip does. An answer with no mode of the two leaves the mode alone
function applyAutoGenerate(draft: CouncilSetupDraft, result: CouncilAutoGenerate, lib: RoleLibrary): CouncilSetupDraft {
    const written: CouncilSetupDraft = { ...withoutAutoState(draft), feature: result.topic, question: result.question };
    const next: CouncilSetupDraft = { ...written, autoLast: joinAsk(written) };
    const named = asMode(result.mode);
    if (named == null || (draft.modePicked && draft.modeFrom !== "conversation")) {
        return next;
    }
    return followMode({ ...next, modePicked: true, modeFrom: "conversation" }, named, lib);
}

/** Pure: the answer landed. It is decided here, not at the press, so text typed during the call is seen: an empty
 *  composer, or one still exactly the last answer, takes it at once; any other text waits on Replace / Keep, the answer
 *  held in `autoPending`. Lands only on a draft that waits for it. */
export function settleAutoGenerate(
    draft: CouncilSetupDraft,
    result: CouncilAutoGenerate,
    lib: RoleLibrary
): CouncilSetupDraft {
    if (draft.autoState !== "asking") {
        return draft;
    }
    const text = joinAsk(draft);
    if (text === "" || text === draft.autoLast) {
        return applyAutoGenerate(draft, result, lib);
    }
    return { ...withoutAutoState(draft), autoState: "confirm", autoPending: result };
}

/** Pure: Replace: the waiting answer is written over the composer's text. */
export function replaceAutoGenerate(draft: CouncilSetupDraft, lib: RoleLibrary): CouncilSetupDraft {
    if (draft.autoState !== "confirm" || draft.autoPending == null) {
        return draft;
    }
    return applyAutoGenerate(draft, draft.autoPending, lib);
}

/** Pure: Keep: the waiting answer is dropped and every other field stays as it was. */
export function keepAutoGenerate(draft: CouncilSetupDraft): CouncilSetupDraft {
    return draft.autoState === "confirm" ? withoutAutoState(draft) : draft;
}

/** Pure: the call failed, or nothing could be read: the reason is kept for the line under the composer and the
 *  composer is left as it was. A press clears it. Lands only on a draft that waits for an answer. */
export function failAutoGenerate(draft: CouncilSetupDraft, reason: string): CouncilSetupDraft {
    return draft.autoState === "asking"
        ? { ...withoutAutoState(draft), autoState: "failed", autoError: reason }
        : draft;
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
    // a seated agent is a seat that proposes and replies, so it stands in for the expert a council needs besides its coordinator
    if (!draftHasAgents(draft) && !draft.experts.some((e) => !e.coordinator)) {
        return "Keep at least one expert besides the coordinator";
    }
    return "";
}

// Rounds count only while an agent is seated (an expert-only council keeps its fixed shape) and the held drafts are the
// pause then, so a draft that carries a Rounds pick or a pause from before the agents were seated sends neither
function roundsFor(draft: CouncilSetupDraft): number | undefined {
    return draftHasAgents(draft) ? draft.rounds : undefined;
}

/** Pure: what Start council sends: the draft's inputs and its seats, the agents first and the coordinator last, with the
 *  Rounds when an agent is seated. */
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
        experts: seatsOf(draft),
        pause: draft.pause && !draftHasAgents(draft),
        sessionid: draft.sessionId || undefined,
        mode: draft.mode,
        modewhy: modeReason(draft) || "picked by hand",
        rounds: roundsFor(draft),
    };
}

// ---- the footer ----

/** Pure: whether there is a panel to price: a seat besides the coordinator. */
export function estimateWanted(draft: CouncilSetupDraft): boolean {
    return seatsOf(draft).some((e) => !e.coordinator);
}

export function estimateRequest(draft: CouncilSetupDraft): CommandCouncilEstimateData {
    return { project: draft.project, files: draft.files, experts: seatsOf(draft), rounds: roundsFor(draft) };
}

/** Pure: what the estimate depends on. Tokens are counted, not priced, so a model change does not move it; an agent's
 *  context and the Rounds do. */
export function estimateKey(draft: CouncilSetupDraft): string {
    const n = draft.experts.filter((e) => !e.coordinator).length;
    const agents = draft.agents.map((a) => `${a.seat.agent}:${a.seat.context ?? 0}`).join(",");
    return `${councilProjectKey(draft.project)}\n${draft.files.join("\n")}\n${n}\n${agents}\n${roundsFor(draft) ?? 0}`;
}

/** Pure: the estimate in the composer's bar: `≈ 9 calls · ~1.9M tokens · ~8 min`, and ` · agents ~1.3M of it` when
 *  seated agents take a share of the tokens. */
export function setupEstimate(est: CouncilEstimateRtnData): string {
    const label = estimateLabel(est);
    return (est.agenttokens ?? 0) > 0 ? `${label} · agents ~${estimateTokens(est.agenttokens ?? 0)} of it` : label;
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
