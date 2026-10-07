// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    GetDossierCommand: vi.fn(),
    ListTaskDossiersCommand: vi.fn(),
    ListRadarReportsCommand: vi.fn(),
    GetChannelRunsCommand: vi.fn(),
    GetChannelRunChangesCommand: vi.fn(),
    GetChannelMessagesCommand: vi.fn(),
    SetChannelReadCommand: vi.fn(),
    EffortGetCommand: vi.fn(),
    FileInfoCommand: vi.fn(),
    ReadVaultNoteCommand: vi.fn(),
}));
const loadAndPin = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", async () => {
    const { atom } = await import("jotai");
    return {
        loadAndPinWaveObject: (...a: unknown[]) => loadAndPin(...a),
        makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
        getWaveObjectAtom: () => atom(null),
    };
});
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { globalStore } from "@/app/store/jotaiStore";
import { setPlatform } from "@/util/platformutil";
import { atom } from "jotai";
import type { AgentsViewModel, SurfaceKey } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { attachCanvas, detachCanvas, getCanvas, setCanvasMode } from "../agents/canvasstore";
import { activeChannelIdAtom } from "../agents/channelsstore";
import {
    currentReportIdAtom,
    loadReports,
    radarReportsAtom,
    radarScopeAtom,
    radarSelectedIdAtom,
} from "../agents/radarstore";
import type { OpenTarget } from "./address";
import { effortDetailAtom } from "./effortstore";
import { briefPeekRecordAtom, briefSheetOpenAtom } from "./jarvisstore";
import { activeRunIdAtom, activeSubjectAtom, recordDetailAtom } from "./jarvissubjectstore";
import { isPeekable, openAddress, openOrPeek, openOrPeekAddress, openTarget, peekAddress, peekTarget } from "./openref";
import { peekItemAtom, type PeekItem } from "./peekstore";
import { pendingDecisionAnchorAtom, petPeekOpenAtom } from "./petstore";
import { taskListAtom, tasksErrorAtom } from "./tasksstore";

const objects = new Map<string, unknown>();

function makeModel(roster: string[] = [], terminals: string[] = []): AgentsViewModel {
    const vm = (id: string) => ({ id, name: id, task: "", state: "working", blockId: `block-${id}` }) as AgentVM;
    return {
        surfaceAtom: atom<SurfaceKey>("cockpit"),
        focusIdAtom: atom<string | undefined>(undefined),
        agentsAtom: atom(roster.map(vm)),
        terminalsAtom: atom<AgentVM[]>(terminals.map(vm)),
    } as unknown as AgentsViewModel;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

function report(oid: string, path: string, startedts: number, findingIds: string[] = []): RadarReport {
    return {
        oid,
        projectname: path.slice(1),
        projectpath: path,
        startedts,
        findings: findingIds.map((id) => ({ id })),
    } as unknown as RadarReport;
}

const REPORTS_B = [report("rb-new", "/b", 2, ["f-1"]), report("rb-old", "/b", 1, ["f-1"])];

function seedReports(): void {
    for (const r of REPORTS_B) {
        objects.set(`radarreport:${r.oid}`, r);
    }
}

beforeEach(() => {
    vi.resetAllMocks();
    objects.clear();
    loadAndPin.mockImplementation((oref: string) => Promise.resolve(objects.get(oref) ?? null));
    rpc.GetChannelRunsCommand.mockResolvedValue({ runs: [] });
    rpc.GetChannelRunChangesCommand.mockResolvedValue({ runids: [], runs: [] });
    rpc.GetChannelMessagesCommand.mockResolvedValue({ messages: [] });
    rpc.SetChannelReadCommand.mockResolvedValue(undefined);
    rpc.EffortGetCommand.mockResolvedValue({ effort: null });
    globalStore.set(taskListAtom, null);
    globalStore.set(tasksErrorAtom, null);
    globalStore.set(radarScopeAtom, null);
    globalStore.set(radarReportsAtom, null);
    globalStore.set(currentReportIdAtom, undefined);
    globalStore.set(radarSelectedIdAtom, undefined);
    globalStore.set(briefPeekRecordAtom, null);
    globalStore.set(briefSheetOpenAtom, false);
    globalStore.set(pendingDecisionAnchorAtom, null);
    globalStore.set(activeSubjectAtom, null);
    globalStore.set(activeRunIdAtom, {});
    globalStore.set(recordDetailAtom, {});
    globalStore.set(effortDetailAtom, new Map());
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, false);
});

describe("run and channel landings", () => {
    it("lands a run on its channel's sheet, on that run", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "channel", id: "c1" });
        expect(globalStore.get(activeRunIdAtom)["c1"]).toBe("r1");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("reports a missing run and leaves the user where they were", async () => {
        const model = makeModel();
        const result = await openTarget(model, { kind: "run", runId: "r-gone" });
        expect(result).toEqual({ ok: false, reason: "unavailable", message: "That run no longer exists" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(pushToast).toHaveBeenCalledWith({ title: "That run no longer exists", message: "", level: "warn" });
    });

    it("reports a run that has no channel to open it in", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "" });
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That run has no channel to open it in",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
    });

    it("reports a channel that no longer exists", async () => {
        const model = makeModel();
        expect(await openTarget(model, { kind: "channel", channelId: "c-gone" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That channel no longer exists",
        });
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
    });

    it("names the target when a load throws", async () => {
        const model = makeModel();
        loadAndPin.mockRejectedValue(new Error("db closed"));
        expect(await openTarget(model, { kind: "run", runId: "r1" })).toEqual({
            ok: false,
            reason: "failed",
            message: "Couldn't open run r1: db closed",
        });
        expect(pushToast).toHaveBeenCalledWith({
            title: "Couldn't open run r1: db closed",
            message: "",
            level: "error",
        });
    });
});

describe("agent landing", () => {
    it("focuses an agent still in the roster", async () => {
        const model = makeModel(["t1"]);
        expect(await openAddress(model, "tab:t1")).toEqual({ ok: true });
        expect(globalStore.get(model.focusIdAtom)).toBe("t1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("reports an agent that has left the roster", async () => {
        const model = makeModel(["t1"]);
        expect(await openAddress(model, "agent:t2")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That agent session has ended",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("record landing", () => {
    it("opens a decision's record in the peek with the decision anchored", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]);
        expect(await openAddress(model, "task:task-a", { sourceType: "decision", anchor: "dec-1" })).toEqual({
            ok: true,
        });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-a");
        expect(globalStore.get(pendingDecisionAnchorAtom)).toBe("dec-1");
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        expect(rpc.ListTaskDossiersCommand).not.toHaveBeenCalled();
    });

    it("loads the record list before calling a record gone, and says so", async () => {
        const model = makeModel();
        rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "other" }] });
        expect(await openAddress(model, "task:task-a")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That record no longer exists",
        });
        expect(rpc.ListTaskDossiersCommand).toHaveBeenCalled();
        expect(globalStore.get(briefPeekRecordAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    // the list loads once per Brief mount, so a record created since is not in it yet
    it("refreshes a loaded list once before calling a record gone", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "old" } as SpaceSummary]);
        rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "old" }, { id: "task-new" }] });
        expect(await openAddress(model, "task:task-new")).toEqual({ ok: true });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-new");
    });

    it("reports a list that failed to load as a failure, not as a missing record", async () => {
        const model = makeModel();
        rpc.ListTaskDossiersCommand.mockRejectedValue(new Error("vault locked"));
        const result = await openAddress(model, "task:task-a");
        expect(result.ok).toBe(false);
        expect("reason" in result ? result.reason : null).toBe("failed");
        expect("reason" in result ? result.message : "").toContain("record task-a");
    });

    it("a record target opens the Brief peek", async () => {
        const model = makeModel();
        globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]);
        rpc.GetDossierCommand.mockResolvedValue({ id: "task-a", status: "active", decisions: [] });
        expect(await openTarget(model, { kind: "record", dossierId: "task-a" })).toEqual({ ok: true });
        expect(globalStore.get(briefPeekRecordAtom)).toBe("task-a");
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
        await vi.waitFor(() => expect(globalStore.get(recordDetailAtom)["task-a"]).toBeDefined());
    });
});

// a note has no surface, so opening one peeks it: a plain click and wsh ui reveal both show the popup
describe("memory note landing", () => {
    it("opens a note as a ready peek, writing no selection", async () => {
        for (const open of [
            (model: AgentsViewModel) => openTarget(model, { kind: "note", noteId: "n1" }),
            (model: AgentsViewModel) => openAddress(model, "memnote:n1"),
        ]) {
            const model = makeModel();
            rpc.ReadVaultNoteCommand.mockResolvedValue({ id: "n1", title: "n1", body: "", updated: 1 });
            seedSelections(model);
            globalStore.set(peekItemAtom, null);
            globalStore.set(petPeekOpenAtom, false);
            const before = selections(model);

            expect(await open(model)).toEqual({ ok: true });

            expect(selections(model)).toEqual(before);
            expect(globalStore.get(peekItemAtom)).toEqual({
                target: { kind: "note", noteId: "n1" },
                status: "ready",
            });
            expect(globalStore.get(petPeekOpenAtom)).toBe(true);
            expect(rpc.ReadVaultNoteCommand).toHaveBeenLastCalledWith({}, { id: "n1" });
        }
    });

    it("says a missing note no longer exists and opens nothing", async () => {
        const model = makeModel();
        rpc.ReadVaultNoteCommand.mockRejectedValue(new Error('wavevault: node "n-gone" not in scope'));
        expect(await openTarget(model, { kind: "note", noteId: "n-gone" })).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That note no longer exists",
        });
        expect(pushToast).toHaveBeenCalledWith({ title: "That note no longer exists", message: "", level: "warn" });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("radar landing", () => {
    it("owns the report's project before selecting the report, so the project's newest does not win", async () => {
        const model = makeModel();
        seedReports();
        rpc.ListRadarReportsCommand.mockResolvedValue({ reports: REPORTS_B });
        expect(await openAddress(model, "radarreport:rb-old", { anchor: "f-1" })).toEqual({ ok: true });
        expect(rpc.ListRadarReportsCommand).toHaveBeenCalledWith(expect.anything(), { projectpath: "/b" });
        expect(globalStore.get(radarScopeAtom)).toEqual({ name: "b", path: "/b" });
        expect(globalStore.get(currentReportIdAtom)).toBe("rb-old");
        expect(globalStore.get(radarSelectedIdAtom)).toBe("f-1");
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");
    });

    it("lands on the report and says so when the finding is no longer in it", async () => {
        const model = makeModel();
        seedReports();
        rpc.ListRadarReportsCommand.mockResolvedValue({ reports: REPORTS_B });
        expect(await openAddress(model, "radarreport:rb-old", { anchor: "f-gone" })).toEqual({
            ok: true,
            notice: "That finding is no longer in this report",
        });
        expect(globalStore.get(currentReportIdAtom)).toBe("rb-old");
        expect(globalStore.get(radarSelectedIdAtom)).toBeUndefined();
        expect(pushToast).toHaveBeenCalledWith({
            title: "That finding is no longer in this report",
            message: "",
            level: "info",
        });
    });

    it("reports a deleted report", async () => {
        const model = makeModel();
        expect(await openAddress(model, "radarreport:rr-gone")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That scan report no longer exists",
        });
    });

    it("is not overwritten by another project's report load still in flight", async () => {
        const model = makeModel();
        seedReports();
        globalStore.set(radarScopeAtom, { name: "a", path: "/a" });
        const slowA = deferred<{ reports: RadarReport[] }>();
        rpc.ListRadarReportsCommand.mockImplementation((_client: unknown, data: { projectpath: string }) =>
            data.projectpath === "/a" ? slowA.promise : Promise.resolve({ reports: REPORTS_B })
        );
        const loadingA = loadReports("/a");

        expect(await openAddress(model, "radarreport:rb-old", { anchor: "f-1" })).toEqual({ ok: true });

        slowA.resolve({ reports: [report("ra-new", "/a", 9)] });
        await loadingA;
        expect(globalStore.get(currentReportIdAtom)).toBe("rb-old");
        expect(globalStore.get(radarReportsAtom)?.map((r) => r.oid)).toEqual(["rb-new", "rb-old"]);
    });
});

describe("effort landing", () => {
    it("opens the initiative's sheet", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1" } });
        expect(await openAddress(model, "effort:e-1")).toEqual({ ok: true });
        expect(globalStore.get(activeSubjectAtom)).toEqual({ kind: "effort", id: "e-1" });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");
    });

    it("reports an initiative the store cannot find, instead of opening an empty sheet", async () => {
        const model = makeModel();
        rpc.EffortGetCommand.mockRejectedValue(new Error("effort e-gone: not found"));
        expect(await openAddress(model, "effort:e-gone")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That initiative no longer exists",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(globalStore.get(activeSubjectAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("reports an initiative whose fetch returns nothing", async () => {
        const model = makeModel();
        expect(await openAddress(model, "effort:e-none")).toEqual({
            ok: false,
            reason: "unavailable",
            message: "That initiative no longer exists",
        });
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
    });
});

describe("a newer open", () => {
    it("supersedes a landing still loading, which then writes and reports nothing", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const first = openTarget(model, { kind: "run", runId: "r-slow" });
        expect(await openTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });

        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(briefSheetOpenAtom)).toBe(false);
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("includes a click on an address nothing can open", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation(() => slow.promise);
        const first = openTarget(model, { kind: "run", runId: "r-slow" });
        await openAddress(model, "bogus:x");
        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("unsupported addresses", () => {
    it("reports an address nothing can open, and stays put", async () => {
        const model = makeModel();
        expect(await openAddress(model, "bogus:x")).toEqual({
            ok: false,
            reason: "unsupported",
            message: "This item can't be opened",
        });
        expect(pushToast).toHaveBeenCalledWith({ title: "This item can't be opened", message: "", level: "warn" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("hands the result to a caller that renders failure itself, instead of toasting", async () => {
        const model = makeModel();
        const report = vi.fn();
        await openAddress(model, "vault:dec-1", { sourceType: "decision" }, report);
        expect(report).toHaveBeenCalledWith({
            ok: false,
            reason: "unsupported",
            message: "This citation can't locate its record",
        });
        expect(pushToast).not.toHaveBeenCalled();
    });
});

describe("canvas landing", () => {
    const CWD = "C:\\p";
    const DIR = "C:\\p\\.superpowers\\design\\t";
    const caller = { blockId: "block-a1", cwd: CWD };
    const noReport = () => {};

    afterEach(() => {
        for (const id of ["a1", "a2", "t9"]) {
            detachCanvas(id);
        }
    });

    it("refuses a caller that is no roster agent, and changes nothing", async () => {
        const model = makeModel(["a1"]);
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, blockId: "block-x" } }, noReport);
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect("reason" in result ? result.message : "").toContain("wsh ui reveal canvas:t");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(getCanvas("a1")).toBeNull();
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("refuses a caller whose working directory is unknown", async () => {
        const model = makeModel(["a1"]);
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, cwd: "" } }, noReport);
        expect("reason" in result ? result.message : "").toContain("wsh ui reveal canvas:t");
        expect(getCanvas("a1")).toBeNull();
    });

    it("refuses a canvas folder that does not exist, naming it", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });
        const result = await openAddress(model, "canvas:t", { caller }, noReport);
        expect("reason" in result ? result.reason : null).toBe("unavailable");
        expect("reason" in result ? result.message : "").toContain(`${DIR}\\project`);
        expect(rpc.FileInfoCommand).toHaveBeenCalledWith(expect.anything(), {
            info: { path: `${DIR}\\project` },
        });
        expect(getCanvas("a1")).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("attaches the caller's canvas without moving the user or leaving the terminal", async () => {
        const model = makeModel(["a1", "a2"]);
        globalStore.set(model.focusIdAtom, "a2");
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        expect(await openAddress(model, "canvas:t", { caller }, noReport)).toEqual({ ok: true });
        const s = getCanvas("a1");
        expect(s?.topic).toBe("t");
        expect(s?.dir).toBe(DIR);
        expect(s?.projectDir).toBe(CWD);
        expect(s?.mode).toBe("terminal");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("leaves a canvas the user is already looking at in canvas mode", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        attachCanvas("a1", { topic: "t", dir: DIR, projectDir: CWD }, 1);
        setCanvasMode("a1", "canvas", 2);
        expect(await openAddress(model, "canvas:t", { caller }, noReport)).toEqual({ ok: true });
        expect(getCanvas("a1")?.mode).toBe("canvas");
    });

    it("attaches a background terminal as readily as an agent", async () => {
        const model = makeModel(["a1"], ["t9"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        const result = await openAddress(model, "canvas:t", { caller: { ...caller, blockId: "block-t9" } }, noReport);
        expect(result).toEqual({ ok: true });
        expect(getCanvas("t9")?.topic).toBe("t");
    });

    it("sets the board a reveal names", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        expect(await openAddress(model, "canvas:t/States", { caller }, noReport)).toEqual({ ok: true });
        expect(getCanvas("a1")?.board).toBe("States.dc.html");
    });

    it("without a caller, lands on the agent that already has the canvas", async () => {
        const model = makeModel(["a1", "a2"]);
        attachCanvas("a2", { topic: "t", dir: DIR, projectDir: CWD }, 1);
        expect(await openAddress(model, "canvas:t", undefined, noReport)).toEqual({ ok: true });
        expect(getCanvas("a2")?.mode).toBe("canvas");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
    });

    it("without a caller or an owner, says no agent has it open", async () => {
        const model = makeModel(["a1"]);
        expect(await openAddress(model, "canvas:t", undefined, noReport)).toEqual({
            ok: false,
            reason: "unavailable",
            message: "No agent has the canvas t open",
        });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("refuses a target built in code with a path in its topic", async () => {
        const model = makeModel(["a1"]);
        rpc.FileInfoCommand.mockResolvedValue({ path: "x" });
        const result = await openTarget(model, { kind: "canvas", topic: ".." }, noReport, caller);
        expect(result.ok).toBe(false);
        expect(rpc.FileInfoCommand).not.toHaveBeenCalled();
        expect(getCanvas("a1")).toBeNull();
    });
});

// every atom an open writes to land somewhere; a peek must leave each one where it was
function selections(model: AgentsViewModel) {
    return {
        sheetOpen: globalStore.get(briefSheetOpenAtom),
        subject: globalStore.get(activeSubjectAtom),
        runIds: globalStore.get(activeRunIdAtom),
        channel: globalStore.get(activeChannelIdAtom),
        record: globalStore.get(briefPeekRecordAtom),
        anchor: globalStore.get(pendingDecisionAnchorAtom),
        radarScope: globalStore.get(radarScopeAtom),
        report: globalStore.get(currentReportIdAtom),
        finding: globalStore.get(radarSelectedIdAtom),
        focus: globalStore.get(model.focusIdAtom),
        surface: globalStore.get(model.surfaceAtom),
    };
}

// priors that are not the defaults, so a write of the default would still show
function seedSelections(model: AgentsViewModel): void {
    globalStore.set(briefSheetOpenAtom, false);
    globalStore.set(activeSubjectAtom, { kind: "channel", id: "c-prior" });
    globalStore.set(activeRunIdAtom, { "c-prior": "r-prior" });
    globalStore.set(activeChannelIdAtom, "c-prior");
    globalStore.set(briefPeekRecordAtom, "task-prior");
    globalStore.set(pendingDecisionAnchorAtom, "dec-prior");
    globalStore.set(radarScopeAtom, { name: "a", path: "/a" });
    globalStore.set(currentReportIdAtom, "ra-prior");
    globalStore.set(radarSelectedIdAtom, "f-prior");
    globalStore.set(model.focusIdAtom, "t0");
    globalStore.set(model.surfaceAtom, "code");
}

type PeekCase = { kind: string; arrange: () => void; target: OpenTarget; shown: PeekItem["target"] };

const LOADABLE: PeekCase[] = [
    {
        kind: "run",
        arrange: () => {
            objects.set("run:r1", { oid: "r1", channeloid: "c1" });
            objects.set("channel:c1", { oid: "c1" });
        },
        target: { kind: "run", runId: "r1" },
        shown: { kind: "run", runId: "r1" },
    },
    {
        kind: "channel",
        arrange: () => {
            objects.set("channel:c1", { oid: "c1" });
            objects.set("run:r-new", { oid: "r-new", channeloid: "c1" });
            rpc.GetChannelRunsCommand.mockResolvedValue({
                runs: [
                    { id: "r-old", createdts: 1 },
                    { id: "r-new", createdts: 2 },
                ],
            });
        },
        target: { kind: "channel", channelId: "c1" },
        shown: { kind: "run", runId: "r-new" },
    },
    {
        kind: "agent",
        arrange: () => {},
        target: { kind: "agent", tabId: "t1" },
        shown: { kind: "agent", tabId: "t1" },
    },
    {
        kind: "record",
        arrange: () => globalStore.set(taskListAtom, [{ id: "task-a" } as SpaceSummary]),
        target: { kind: "record", dossierId: "task-a", anchor: "dec-1" },
        shown: { kind: "record", dossierId: "task-a", anchor: "dec-1" },
    },
    {
        kind: "effort",
        arrange: () => rpc.EffortGetCommand.mockResolvedValue({ effort: { oid: "e-1" } }),
        target: { kind: "effort", effortId: "e-1" },
        shown: { kind: "effort", effortId: "e-1" },
    },
    {
        kind: "radar",
        arrange: seedReports,
        target: { kind: "radar", reportId: "rb-old", findingId: "f-1" },
        shown: { kind: "radar", reportId: "rb-old", findingId: "f-1" },
    },
    {
        kind: "note",
        arrange: () => rpc.ReadVaultNoteCommand.mockResolvedValue({ id: "n1", title: "n1", body: "", updated: 1 }),
        target: { kind: "note", noteId: "n1" },
        shown: { kind: "note", noteId: "n1" },
    },
];

const UNLOADABLE: { kind: string; arrange: () => void; target: OpenTarget; message: string }[] = [
    { kind: "run", arrange: () => {}, target: { kind: "run", runId: "r-gone" }, message: "That run no longer exists" },
    {
        kind: "channel",
        arrange: () => objects.set("channel:c1", { oid: "c1" }),
        target: { kind: "channel", channelId: "c1" },
        message: "That channel has no run to peek",
    },
    {
        kind: "agent",
        arrange: () => {},
        target: { kind: "agent", tabId: "t-gone" },
        message: "That agent session has ended",
    },
    {
        kind: "record",
        arrange: () => rpc.ListTaskDossiersCommand.mockResolvedValue({ dossiers: [{ id: "other" }] }),
        target: { kind: "record", dossierId: "task-gone" },
        message: "That record no longer exists",
    },
    {
        kind: "effort",
        arrange: () => rpc.EffortGetCommand.mockRejectedValue(new Error("not found")),
        target: { kind: "effort", effortId: "e-gone" },
        message: "That initiative no longer exists",
    },
    {
        kind: "radar",
        arrange: () => {},
        target: { kind: "radar", reportId: "rr-gone" },
        message: "That scan report no longer exists",
    },
    {
        kind: "note",
        arrange: () => rpc.ReadVaultNoteCommand.mockRejectedValue(new Error("not in scope")),
        target: { kind: "note", noteId: "n-gone" },
        message: "That note no longer exists",
    },
];

const FROM = [
    { from: "closed" as const, popupOpen: false },
    { from: "hub" as const, popupOpen: true },
];

describe("peek", () => {
    for (const c of LOADABLE) {
        for (const { from, popupOpen } of FROM) {
            it(`shows a ${c.kind} in the popup from ${from}, writing no selection`, async () => {
                const model = makeModel(["t1"]);
                c.arrange();
                seedSelections(model);
                globalStore.set(petPeekOpenAtom, popupOpen);
                const before = selections(model);

                expect(await peekTarget(model, c.target)).toEqual({ ok: true });

                expect(selections(model)).toEqual(before);
                expect(globalStore.get(peekItemAtom)).toEqual({ target: c.shown, status: "ready" });
                expect(globalStore.get(petPeekOpenAtom)).toBe(true);
                expect(pushToast).not.toHaveBeenCalled();
            });
        }
    }

    for (const c of UNLOADABLE) {
        for (const { from, popupOpen } of FROM) {
            it(`says a ${c.kind} cannot be peeked and leaves the popup ${from}`, async () => {
                const model = makeModel(["t1"]);
                c.arrange();
                seedSelections(model);
                globalStore.set(petPeekOpenAtom, popupOpen);
                const before = selections(model);

                expect(await peekTarget(model, c.target)).toEqual({
                    ok: false,
                    reason: "unavailable",
                    message: c.message,
                });

                expect(pushToast).toHaveBeenCalledWith({ title: c.message, message: "", level: "warn" });
                expect(globalStore.get(peekItemAtom)).toBeNull();
                expect(globalStore.get(petPeekOpenAtom)).toBe(popupOpen);
                expect(selections(model)).toEqual(before);
            });
        }
    }

    it("opens the popup on a loading item before the load lands", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r1" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const peeking = peekTarget(model, { kind: "run", runId: "r1" });
        expect(globalStore.get(peekItemAtom)).toEqual({
            target: { kind: "run", runId: "r1" },
            status: "loading",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        slow.resolve({ oid: "r1", channeloid: "c1" });
        expect(await peeking).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.status).toBe("ready");
    });

    it("peeks the run a channel target names", async () => {
        const model = makeModel();
        objects.set("run:r1", { oid: "r1", channeloid: "c1" });
        objects.set("channel:c1", { oid: "c1" });
        expect(await peekTarget(model, { kind: "channel", channelId: "c1", runId: "r1" })).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "run", runId: "r1" });
        expect(rpc.GetChannelRunsCommand).not.toHaveBeenCalled();
    });

    it("a failed peek over an item already shown puts that item back", async () => {
        const model = makeModel(["t1"]);
        const shown: PeekItem = { target: { kind: "agent", tabId: "t1" }, status: "ready" };
        globalStore.set(peekItemAtom, shown);
        globalStore.set(petPeekOpenAtom, true);
        await peekTarget(model, { kind: "run", runId: "r-gone" });
        expect(globalStore.get(peekItemAtom)).toEqual(shown);
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
    });

    it("keeps only the later of two peeks, and says nothing about the first", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const first = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(await peekTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });

        // gone by the time it lands: a current peek would toast this
        slow.resolve(null);
        expect(await first).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(peekItemAtom)).toEqual({
            target: { kind: "agent", tabId: "t1" },
            status: "ready",
        });
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("an open started while a peek loads clears the loading item", async () => {
        const model = makeModel(["t1"]);
        const slow = deferred<unknown>();
        objects.set("channel:c1", { oid: "c1" });
        loadAndPin.mockImplementation((oref: string) =>
            oref === "run:r-slow" ? slow.promise : Promise.resolve(objects.get(oref) ?? null)
        );
        const peeking = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(globalStore.get(peekItemAtom)?.status).toBe("loading");

        expect(await openTarget(model, { kind: "agent", tabId: "t1" })).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);

        slow.resolve({ oid: "r-slow", channeloid: "c1" });
        expect(await peeking).toEqual({ ok: false, reason: "superseded", message: "" });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("a dead address clears a peek still loading", async () => {
        const model = makeModel();
        const slow = deferred<unknown>();
        loadAndPin.mockImplementation(() => slow.promise);
        const peeking = peekTarget(model, { kind: "run", runId: "r-slow" });
        expect(await peekAddress(model, "bogus:x")).toEqual({
            ok: false,
            reason: "unsupported",
            message: "This item can't be opened",
        });
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(globalStore.get(petPeekOpenAtom)).toBe(false);
        slow.resolve(null);
        expect(await peeking).toEqual({ ok: false, reason: "superseded", message: "" });
    });

    it("hands a canvas to openTarget: there is nothing to peek", async () => {
        const model = makeModel(["a1"]);
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\t", projectDir: "C:\\p" }, 1);
        expect(isPeekable({ kind: "canvas", topic: "t" })).toBe(false);
        expect(await peekTarget(model, { kind: "canvas", topic: "t" })).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        detachCanvas("a1");
    });
});

describe("openOrPeek", () => {
    const gesture = (ctrlKey: boolean, metaKey = false) => ({
        ctrlKey,
        metaKey,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    });
    // Ctrl is the Windows peek key; a Mac's is Command (ctrlheld.ts isPeekGesture)
    beforeEach(() => setPlatform("win32"));
    afterEach(() => setPlatform("darwin"));

    it("peeks on Command on a Mac, where Ctrl+click is the right click", async () => {
        setPlatform("darwin");
        const model = makeModel(["t1"]);
        const cmd = gesture(false, true);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, cmd)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(cmd.preventDefault).toHaveBeenCalled();

        const ctrl = gesture(true);
        expect(await openOrPeekAddress(model, "tab:t1", ctrl)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(ctrl.preventDefault).not.toHaveBeenCalled();
    });

    it("peeks on Ctrl and consumes the click", async () => {
        const model = makeModel(["t1"]);
        const event = gesture(true);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, event)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it("opens without Ctrl and leaves the click alone", async () => {
        const model = makeModel(["t1"]);
        const event = gesture(false);
        expect(await openOrPeek(model, { kind: "agent", tabId: "t1" }, event)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(event.stopPropagation).not.toHaveBeenCalled();
    });

    it("opens a canvas even with Ctrl", async () => {
        const model = makeModel(["a1"]);
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\t", projectDir: "C:\\p" }, 1);
        const event = gesture(true);
        expect(await openOrPeek(model, { kind: "canvas", topic: "t" }, event)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(peekItemAtom)).toBeNull();
        expect(event.preventDefault).not.toHaveBeenCalled();
        detachCanvas("a1");
    });

    it("does the same for an address", async () => {
        const model = makeModel(["t1"]);
        const ctrl = gesture(true);
        expect(await openOrPeekAddress(model, "tab:t1", ctrl)).toEqual({ ok: true });
        expect(globalStore.get(peekItemAtom)?.target).toEqual({ kind: "agent", tabId: "t1" });
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(ctrl.stopPropagation).toHaveBeenCalled();

        const plain = gesture(false);
        expect(await openOrPeekAddress(model, "tab:t1", plain)).toEqual({ ok: true });
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(plain.stopPropagation).not.toHaveBeenCalled();
    });
});
