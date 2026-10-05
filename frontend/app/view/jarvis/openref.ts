// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's one router. A caller holding a string goes through openAddress (parseAddress, then
// openTarget); a caller holding an id builds the target. A landing is a load, then a select. The load awaits
// what proves its target exists and writes no selection; the select writes the destination's selection, then
// switches surface, so the destination renders the item on its first frame and a click never flashes the wrong
// one. A peek is the load alone, shown in the avatar popup (peekstore.ts) without moving the user. A landing
// that cannot open says why and leaves the user where they were — a silent no-op is the failure this module
// exists to remove.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/global";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "../agents/agents";
import { setAgentView } from "../agents/agentview";
import { canvasDir, canvasProjectDir } from "../agents/canvasmodel";
import { attachCanvas, canvasOwner, getCanvas, selectCanvasBoard } from "../agents/canvasstore";
import { jumpToAgent } from "../agents/channelsprimitives";
import { selectChannel } from "../agents/channelsstore";
import { initRadarScope, radarScopeAtom, radarSelectedIdAtom, scopeOfReport, selectReport } from "../agents/radarstore";
import { isCanvasSegment, parseAddress, type AddressHint, type OpenTarget } from "./address";
import { effortDetailAtom, loadEffortDetail } from "./effortstore";
import { briefPeekRecordAtom, briefSheetOpenAtom } from "./jarvisstore";
import { loadRecordDetail, selectSubject, setActiveRunId } from "./jarvissubjectstore";
import { clearLoadingPeek, settlePeek, startPeek, type PeekTarget } from "./peekstore";
import { pendingDecisionAnchorAtom } from "./petstore";
import { refreshTaskList, taskListAtom, tasksErrorAtom } from "./tasksstore";

type OpenFailure = { ok: false; reason: "unsupported" | "unavailable" | "failed" | "superseded"; message: string };

export type OpenResult = { ok: true; notice?: string } | OpenFailure;

export type ReportOpen = (result: OpenResult) => void;

// what a load proved, for its select to write; a notice still lands, and says something on the way
type Loaded<T = undefined> = { ok: true; facts: T; notice?: string } | OpenFailure;

// the click (or key) that asked; Ctrl turns an open into a peek
export type OpenGesture = { ctrlKey: boolean; preventDefault(): void; stopPropagation(): void };

type ChannelTarget = Extract<OpenTarget, { kind: "channel" }>;
type RecordTarget = Extract<OpenTarget, { kind: "record" }>;
type RadarTarget = Extract<OpenTarget, { kind: "radar" }>;
type CanvasTarget = Extract<OpenTarget, { kind: "canvas" }>;
type NoteTarget = Extract<OpenTarget, { kind: "note" }>;
type Caller = AddressHint["caller"];

const OK: OpenResult = { ok: true };
const SUPERSEDED: OpenFailure = { ok: false, reason: "superseded", message: "" };

function loaded<T>(facts?: T, notice?: string): Loaded<T> {
    return notice != null ? { ok: true, facts, notice } : { ok: true, facts };
}

function unavailable(message: string): OpenFailure {
    return { ok: false, reason: "unavailable", message };
}

function failed(target: OpenTarget, why: string): OpenFailure {
    return { ok: false, reason: "failed", message: `Couldn't open ${targetName(target)}: ${why}` };
}

function targetName(target: OpenTarget): string {
    switch (target.kind) {
        case "channel":
            return `channel ${target.channelId}`;
        case "run":
            return `run ${target.runId}`;
        case "agent":
            return `agent ${target.tabId}`;
        case "record":
            return `record ${target.dossierId}`;
        case "effort":
            return `initiative ${target.effortId}`;
        case "radar":
            return `scan report ${target.reportId}`;
        case "canvas":
            return `canvas ${target.topic}`;
        case "note":
            return `note ${target.noteId}`;
    }
}

// A landing waits on its load, so a second click can start before the first lands. Each open or peek takes the
// next number, and one that finds the counter moved on during an await is superseded and writes nothing more.
let openSeq = 0;

function nextOpen(): () => boolean {
    const token = ++openSeq;
    return () => token === openSeq;
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export async function openTarget(
    model: AgentsViewModel,
    target: OpenTarget,
    report: ReportOpen = toast,
    caller?: Caller
): Promise<OpenResult> {
    // a note has no surface to land on: opening one is peeking it
    if (target.kind === "note") {
        return peekTarget(model, target, report);
    }
    const current = nextOpen();
    // the peek still loading is superseded, so its spinner goes back to whatever it replaced
    clearLoadingPeek();
    let result: OpenResult;
    try {
        result = await land(model, target, current, caller);
    } catch (e) {
        result = current() ? failed(target, errorText(e)) : SUPERSEDED;
    }
    deliver(result, report);
    return result;
}

export async function openAddress(
    model: AgentsViewModel,
    address: string,
    hint?: AddressHint,
    report: ReportOpen = toast
): Promise<OpenResult> {
    const parsed = parseAddress(address, hint);
    if (parsed.kind === "unsupported") {
        return refuse(parsed.message, report);
    }
    return openTarget(model, parsed, report, hint?.caller);
}

export function isPeekable(target: OpenTarget): boolean {
    return target.kind !== "canvas";
}

// Load the target and show it in the avatar popup, writing no destination selection. The popup opens at once on
// a loading item; a failed load puts it back as it was and says why.
export async function peekTarget(
    model: AgentsViewModel,
    target: OpenTarget,
    report: ReportOpen = toast
): Promise<OpenResult> {
    if (target.kind === "canvas") {
        return openTarget(model, target, report);
    }
    const current = nextOpen();
    let result: OpenResult;
    try {
        result = await peek(model, target, current);
    } catch (e) {
        result = current() ? failed(target, errorText(e)) : SUPERSEDED;
    }
    if ("reason" in result && result.reason !== "superseded") {
        clearLoadingPeek();
    }
    deliver(result, report);
    return result;
}

export async function peekAddress(
    model: AgentsViewModel,
    address: string,
    hint?: AddressHint,
    report: ReportOpen = toast
): Promise<OpenResult> {
    const parsed = parseAddress(address, hint);
    if (parsed.kind === "unsupported") {
        return refuse(parsed.message, report);
    }
    return peekTarget(model, parsed, report);
}

// A peek consumes its click: a link nested in a row with its own handler must not peek and then open the row.
export function openOrPeek(model: AgentsViewModel, target: OpenTarget, event?: OpenGesture): Promise<OpenResult> {
    if (event?.ctrlKey && isPeekable(target)) {
        event.preventDefault();
        event.stopPropagation();
        return peekTarget(model, target);
    }
    return openTarget(model, target);
}

export function openOrPeekAddress(
    model: AgentsViewModel,
    address: string,
    event?: OpenGesture,
    hint?: AddressHint
): Promise<OpenResult> {
    const parsed = parseAddress(address, hint);
    if (event?.ctrlKey && (parsed.kind === "unsupported" || isPeekable(parsed))) {
        event.preventDefault();
        event.stopPropagation();
        return peekAddress(model, address, hint);
    }
    return openAddress(model, address, hint);
}

// a click on a dead address is still the user's latest; a slower landing must not arrive over its toast
async function refuse(message: string, report: ReportOpen): Promise<OpenResult> {
    nextOpen();
    clearLoadingPeek();
    const result: OpenResult = { ok: false, reason: "unsupported", message };
    deliver(result, report);
    return result;
}

// superseded is never reported: the open that replaced it is the one the user is waiting on
function deliver(result: OpenResult, report: ReportOpen): void {
    if ("reason" in result ? result.reason !== "superseded" : result.notice != null) {
        report(result);
    }
}

// narrowed with `in`: the tsconfig is not strict, so the `ok` literal does not discriminate the union
function toast(result: OpenResult): void {
    if ("reason" in result) {
        pushToast({ title: result.message, message: "", level: result.reason === "failed" ? "error" : "warn" });
        return;
    }
    pushToast({ title: result.notice ?? "", message: "", level: "info" });
}

async function land(
    model: AgentsViewModel,
    target: Exclude<OpenTarget, NoteTarget>,
    current: () => boolean,
    caller: Caller
): Promise<OpenResult> {
    switch (target.kind) {
        case "channel":
            return select(await loadChannel(target.channelId, target.runId, current), (s) =>
                selectSheet(model, s, current)
            );
        case "run":
            return select(await loadRun(target.runId, current), (s) => selectSheet(model, s, current));
        case "agent":
            return select(loadAgent(model, target.tabId), () => selectAgent(model, target.tabId));
        case "record":
            return select(await loadRecord(target, current), () => selectRecord(model, target));
        case "effort":
            return select(await loadEffort(target.effortId, current), () => selectEffort(model, target.effortId));
        case "radar":
            return select(await loadRadar(target, current), (r) => selectRadar(model, r, current));
        case "canvas":
            return select(await loadCanvas(model, target, current, caller), (c) => selectCanvas(model, target, c));
    }
}

async function select<T>(load: Loaded<T>, write: (facts: T) => OpenResult | Promise<OpenResult>): Promise<OpenResult> {
    if ("reason" in load) {
        return load;
    }
    const result = await write(load.facts);
    return "reason" in result || load.notice == null ? result : { ok: true, notice: load.notice };
}

async function peek(
    model: AgentsViewModel,
    target: Exclude<OpenTarget, CanvasTarget>,
    current: () => boolean
): Promise<OpenResult> {
    const resolved = target.kind === "channel" ? await channelRun(target, current) : loaded<PeekTarget>(target);
    if ("reason" in resolved) {
        return resolved;
    }
    const item = startPeek(resolved.facts);
    const load = await loadPeek(model, resolved.facts, current);
    if ("reason" in load) {
        return load;
    }
    settlePeek(item);
    return load.notice != null ? { ok: true, notice: load.notice } : OK;
}

function loadPeek(
    model: AgentsViewModel,
    target: PeekTarget,
    current: () => boolean
): Loaded<unknown> | Promise<Loaded<unknown>> {
    switch (target.kind) {
        case "run":
            return loadRun(target.runId, current);
        case "agent":
            return loadAgent(model, target.tabId);
        case "record":
            return loadRecord(target, current);
        case "effort":
            return loadEffort(target.effortId, current);
        case "radar":
            return loadRadar(target, current);
        case "note":
            return loadNote(target.noteId, current);
    }
}

// A channel has no peek of its own: it shows the run it names, else its newest.
async function channelRun(target: ChannelTarget, current: () => boolean): Promise<Loaded<PeekTarget>> {
    if (target.runId) {
        return loaded<PeekTarget>({ kind: "run", runId: target.runId });
    }
    const channel = await loadChannel(target.channelId, undefined, current);
    if ("reason" in channel) {
        return channel;
    }
    const rtn = await RpcApi.GetChannelRunsCommand(TabRpcClient, { channelid: target.channelId });
    if (!current()) {
        return SUPERSEDED;
    }
    const newest = [...(rtn?.runs ?? [])].sort((a, b) => b.createdts - a.createdts)[0];
    if (newest == null) {
        return unavailable("That channel has no run to peek");
    }
    return loaded<PeekTarget>({ kind: "run", runId: newest.id });
}

type Sheet = { channelId: string; runId?: string };

async function loadChannel(
    channelId: string,
    runId: string | undefined,
    current: () => boolean
): Promise<Loaded<Sheet>> {
    const channel = await WOS.loadAndPinWaveObject<Channel>(WOS.makeORef("channel", channelId));
    if (!current()) {
        return SUPERSEDED;
    }
    if (channel == null) {
        return unavailable("That channel no longer exists");
    }
    return loaded({ channelId, runId });
}

// A run is not a subject kind of its own: it resolves from its channel plus the selected run id, which is what
// stageRunAtom reads. The channel comes off the run's own object, because a run row projected from WorkState
// carries no channel.
async function loadRun(runId: string, current: () => boolean): Promise<Loaded<Sheet>> {
    const run = await WOS.loadAndPinWaveObject<Run>(WOS.makeORef("run", runId));
    if (!current()) {
        return SUPERSEDED;
    }
    if (run == null) {
        return unavailable("That run no longer exists");
    }
    if (!run.channeloid) {
        return unavailable("That run has no channel to open it in");
    }
    return loadChannel(run.channeloid, runId, current);
}

async function selectSheet(model: AgentsViewModel, sheet: Sheet, current: () => boolean): Promise<OpenResult> {
    await openChannelSheet(sheet.channelId, sheet.runId ?? null);
    if (!current()) {
        return SUPERSEDED;
    }
    globalStore.set(model.surfaceAtom, "jarvis");
    return OK;
}

function loadAgent(model: AgentsViewModel, tabId: string): Loaded {
    // the Agent surface shows a background terminal as readily as an agent, so both count as the roster
    const roster = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
    return roster.some((a) => a.id === tabId) ? loaded() : unavailable("That agent session has ended");
}

function selectAgent(model: AgentsViewModel, tabId: string): OpenResult {
    jumpToAgent(model, tabId);
    return OK;
}

// A reveal names its caller: the canvas is that agent's, in its cwd. The agent reveals on every revision, so its
// reveal only attaches: the user may be anywhere, and moving them there each time pulls them off their work. The
// trail toast and the header's Canvas toggle say it is there. A palette or citation open has no caller, so it is
// the user asking to see it: it lands on whichever agent already has the topic open, in canvas mode.
type CanvasLanding = { owner: string } | { agentId: string; dir: string; cwd: string };

async function loadCanvas(
    model: AgentsViewModel,
    target: CanvasTarget,
    current: () => boolean,
    caller: Caller
): Promise<Loaded<CanvasLanding>> {
    const { topic, board } = target;
    // parseAddress refuses path characters, but a target built in code never went through it
    if (!isCanvasSegment(topic) || (board != null && !isCanvasSegment(board))) {
        return { ok: false, reason: "unsupported", message: `Not a canvas name: ${topic}` };
    }
    if (caller == null) {
        const owner = canvasOwner(topic);
        return owner != null ? loaded({ owner }) : unavailable(`No agent has the canvas ${topic} open`);
    }
    const roster = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
    const agent = roster.find((a) => a.blockId != null && a.blockId === caller.blockId);
    if (agent == null || !caller.cwd) {
        return unavailable(`Run wsh ui reveal canvas:${topic} from the agent's terminal`);
    }
    const dir = canvasDir(caller.cwd, topic);
    const project = canvasProjectDir(dir);
    const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: project } });
    if (!current()) {
        return SUPERSEDED;
    }
    if (info == null || info.notfound) {
        return unavailable(`No canvas at ${project}`);
    }
    return loaded({ agentId: agent.id, dir, cwd: caller.cwd });
}

function selectCanvas(model: AgentsViewModel, target: CanvasTarget, landing: CanvasLanding): OpenResult {
    const { topic, board } = target;
    if ("owner" in landing) {
        if (board != null && board !== getCanvas(landing.owner)?.board) {
            selectCanvasBoard(landing.owner, board);
        }
        setAgentView(landing.owner, "canvas", Date.now());
        jumpToAgent(model, landing.owner);
        return OK;
    }
    attachCanvas(landing.agentId, { topic, dir: landing.dir, projectDir: landing.cwd, board }, Date.now());
    return OK;
}

// The peek renders nothing until the record's detail loads, so it cannot say a record is gone; the list can.
// The list loads once per Brief mount, so a record created since is refreshed in before it is called missing.
async function loadRecord(target: RecordTarget, current: () => boolean): Promise<Loaded> {
    const listed = () => globalStore.get(taskListAtom)?.some((d) => d.id === target.dossierId) === true;
    if (!listed()) {
        await refreshTaskList();
        if (!current()) {
            return SUPERSEDED;
        }
        if (!listed()) {
            const loadError = globalStore.get(tasksErrorAtom);
            return loadError != null ? failed(target, loadError) : unavailable("That record no longer exists");
        }
    }
    return loaded();
}

function selectRecord(model: AgentsViewModel, target: RecordTarget): OpenResult {
    globalStore.set(pendingDecisionAnchorAtom, target.anchor ?? null);
    openRecordPeek(target.dossierId);
    globalStore.set(model.surfaceAtom, "jarvis");
    return OK;
}

// A record's home is the Brief peek: it is the only surface that writes a record's status, so it was always
// the authoritative view. The Vault's second, read-only index is gone. Detail is loaded before the surface
// flips so the peek mounts on the record rather than on its own empty frame.
function openRecordPeek(dossierId: string): void {
    loadRecordDetail(dossierId);
    globalStore.set(briefPeekRecordAtom, dossierId);
}

// initRadarScope selects its project's newest report, and Radar's first mount derives a scope unless one is
// already owned — so the report's own project is owned first and the report selected after it. selectReport,
// not radarSelectedIdAtom, pins the report: that atom holds the selected FINDING.
type RadarLanding = { report: RadarReport; findingId?: string };

async function loadRadar(target: RadarTarget, current: () => boolean): Promise<Loaded<RadarLanding>> {
    const report = await WOS.loadAndPinWaveObject<RadarReport>(WOS.makeORef("radarreport", target.reportId));
    if (!current()) {
        return SUPERSEDED;
    }
    if (report == null) {
        return unavailable("That scan report no longer exists");
    }
    const findingId = target.findingId;
    const found = findingId != null && (report.findings ?? []).some((f) => f.id === findingId);
    if (findingId != null && !found) {
        return loaded({ report }, "That finding is no longer in this report");
    }
    return loaded({ report, findingId });
}

async function selectRadar(model: AgentsViewModel, landing: RadarLanding, current: () => boolean): Promise<OpenResult> {
    const scope = scopeOfReport(landing.report);
    if (globalStore.get(radarScopeAtom)?.path !== scope.path) {
        await initRadarScope(scope);
        if (!current()) {
            return SUPERSEDED;
        }
    }
    await selectReport(landing.report.oid);
    if (!current()) {
        return SUPERSEDED;
    }
    globalStore.set(radarSelectedIdAtom, landing.findingId);
    globalStore.set(model.surfaceAtom, "radar");
    return OK;
}

// A rejected fetch and one that leaves no entry both mean the initiative is gone: the store throws on a missing
// effort, and the cache entry is what the sheet reads.
const EFFORT_GONE = "That initiative no longer exists";

async function loadEffort(effortId: string, current: () => boolean): Promise<Loaded<Effort>> {
    const oref = "effort:" + effortId;
    try {
        await loadEffortDetail(oref);
    } catch {
        return current() ? unavailable(EFFORT_GONE) : SUPERSEDED;
    }
    if (!current()) {
        return SUPERSEDED;
    }
    const effort = globalStore.get(effortDetailAtom).get(oref);
    return effort != null ? loaded(effort) : unavailable(EFFORT_GONE);
}

function selectEffort(model: AgentsViewModel, effortId: string): OpenResult {
    openEffortSheet(effortId);
    globalStore.set(model.surfaceAtom, "jarvis");
    return OK;
}

// Any rejected read, a timeout included, reads as gone, as an initiative's does: the server names no cause.
const NOTE_GONE = "That note no longer exists";

async function loadNote(noteId: string, current: () => boolean): Promise<Loaded> {
    try {
        await RpcApi.ReadVaultNoteCommand(TabRpcClient, { id: noteId });
    } catch {
        return current() ? unavailable(NOTE_GONE) : SUPERSEDED;
    }
    return current() ? loaded() : SUPERSEDED;
}

// The Brief's detail sheet, opened on a channel. Selecting the channel is what LOADS it: the sheet's body
// resolves its run from the active channel's list (stageRunAtom), so a sheet opened on a channel that was never
// selected had a null run and read "Reading this channel…" forever. Exported for Jarvis's own flow (the
// investigation draft), not for cross-surface callers — those open a target. + Run is one of those: it
// sits on the app bar, so a launch started from any surface has to land through the router.
export async function openChannelSheet(channelId: string, runId: string | null): Promise<void> {
    await selectChannel(channelId);
    selectSubject({ kind: "channel", id: channelId });
    if (runId != null) {
        setActiveRunId(channelId, runId);
    }
    globalStore.set(briefSheetOpenAtom, true);
}

function openEffortSheet(effortId: string): void {
    selectSubject({ kind: "effort", id: effortId });
    globalStore.set(briefSheetOpenAtom, true);
}
