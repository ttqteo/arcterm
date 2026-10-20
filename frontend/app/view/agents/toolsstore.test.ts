// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The store's wiring around the RPCs and the wave events, with both mocked: what opening a tool asks launchAgent for, and
// the install terminal's life (started once its exit is being watched, closed out on exit 0, kept on a non-zero exit).

type Sub = { eventType: string; scope?: string; handler: (e: unknown) => void; off: ReturnType<typeof vi.fn> };

const m = vi.hoisted(() => ({
    createTermTab: vi.fn(),
    launchAgent: vi.fn(),
    setMeta: vi.fn(),
    resync: vi.fn(),
    toolsStatus: vi.fn(),
    toolsSetUser: vi.fn(),
    reload: vi.fn(),
    serviceOpen: vi.fn(),
    serviceStart: vi.fn(),
    closeTab: vi.fn(),
    showTerminal: vi.fn(),
    closeLauncher: vi.fn(),
    subs: [] as Sub[],
    log: [] as string[],
    blocks: {} as Record<string, unknown>,
}));

vi.mock("@/app/cockpit/cockpit-actions", () => ({ createTermTab: m.createTermTab, launchAgent: m.launchAgent }));
vi.mock("@/app/store/global-atoms", async () => {
    const { atom } = await import("jotai");
    return {
        atoms: {
            fullConfigAtom: atom({ projects: { arcterm: { path: "C:/code/arcterm" } }, tools: {} }),
            workspace: atom({ oid: "ws1" }),
        },
    };
});
vi.mock("@/app/store/services", () => ({ WorkspaceService: { CloseTab: m.closeTab } }));
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    reloadWaveObject: m.reload,
    getObjectValue: (oref: string) => m.blocks[oref],
}));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (s: { eventType: string; scope?: string; handler: (e: unknown) => void }) => {
        const off = vi.fn();
        m.subs.push({ ...s, off });
        m.log.push(`sub:${s.eventType}`);
        return off;
    },
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ToolsStatusCommand: m.toolsStatus,
        ToolsSetUserCommand: m.toolsSetUser,
        SetMetaCommand: m.setMeta,
        ControllerResyncCommand: m.resync,
        ServiceOpenCommand: m.serviceOpen,
        ServiceStartCommand: m.serviceStart,
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/platformutil", () => ({ PLATFORM: "win32" }));
vi.mock("./agentcenter", () => ({ showTerminal: m.showTerminal }));
vi.mock("./launcher", () => ({ HOME_NAME: "Home", HOME_PICK: "~" }));
vi.mock("./launcherstore", () => ({ closeLauncher: m.closeLauncher }));
vi.mock("./railstore", async () => {
    const { atom } = await import("jotai");
    return { dockedTerminalAtom: atom<string | null>(null), railCwdsAtom: atom<Record<string, string>>({}) };
});
vi.mock("./appsuggeststore", () => ({ homeDir: async () => "/Users/q" }));
vi.mock("./runlineage", () => ({
    agentProject: (_l: unknown, _a: unknown, a: { project?: string }) => a.project ?? "",
}));

import { dockedTerminalAtom, railCwdsAtom } from "./railstore";
import { servicesAtom } from "./servicesstore";
import {
    addUserTool,
    failedAtom,
    installingAtom,
    installTool,
    loadTools,
    openTool,
    openToolPicker,
    pinnedToolsAtom,
    removeUserTool,
    retryInstall,
    setToolPinned,
    showInstall,
    toolPickerAtom,
    toolsErrorAtom,
    toolsStatusAtom,
    toolSuggestionsAtom,
} from "./toolsstore";

function status(id: string, over: Partial<ToolStatus> = {}): ToolStatus {
    return {
        id,
        name: id,
        category: "Git",
        purpose: "",
        command: id,
        opensin: "agent",
        shows: "centre",
        install: { windows: `winget install ${id}`, darwin: `brew install ${id}` },
        found: true,
        ...over,
    };
}

function fakeModel(over: { focusId?: string; agents?: unknown[]; terminals?: unknown[] } = {}) {
    return {
        focusIdAtom: atom<string | undefined>(over.focusId),
        agentsAtom: atom(over.agents ?? []),
        terminalsAtom: atom(over.terminals ?? []),
        lineageAtom: atom({ roles: {}, runs: {} }),
        surfaceAtom: atom("cockpit"),
        launcherAtom: atom<string | null>(null),
    } as any;
}

// a wave event for one block, to the subscriptions scoped to it that have not been unsubscribed
function emit(blockId: string, eventType: string, data?: unknown) {
    const scope = `block:${blockId}`;
    for (const s of m.subs.filter(
        (s) => s.eventType === eventType && s.scope === scope && s.off.mock.calls.length === 0
    )) {
        s.handler({ event: eventType, scopes: [scope], data });
    }
}

const done = (code: number) => ({ blockid: "blk-i", shellprocstatus: "done", shellprocexitcode: code });

beforeEach(() => {
    for (const fn of Object.values(m)) {
        if (typeof fn === "function" && "mockReset" in fn) {
            (fn as ReturnType<typeof vi.fn>).mockReset();
        }
    }
    m.subs.length = 0;
    m.log.length = 0;
    m.blocks = {};
    m.toolsStatus.mockResolvedValue({ tools: [] });
    m.setMeta.mockResolvedValue(undefined);
    m.reload.mockResolvedValue(undefined);
    m.closeTab.mockResolvedValue(undefined);
    m.resync.mockImplementation(async () => {
        m.log.push("resync");
    });
    m.createTermTab.mockResolvedValue({ tabId: "tab-i", blockId: "blk-i" });
    m.launchAgent.mockResolvedValue("tab-new");
    globalStore.set(installingAtom, {});
    globalStore.set(failedAtom, {});
    globalStore.set(dockedTerminalAtom, null);
    globalStore.set(railCwdsAtom, {});
    globalStore.set(toolPickerAtom, { open: false });
});

describe("opening a pinned app", () => {
    const app = (over: Partial<ToolStatus> = {}) =>
        status("hong", {
            category: "Yours",
            command: "npm",
            args: "run dash",
            url: "http://127.0.0.1:8386",
            dir: "~/dev/hong",
            shows: "panel",
            ...over,
        });
    const svc = (state: string): ServiceStatus => ({
        id: "hong",
        name: "hong",
        command: "npm run dash",
        dir: "~/dev/hong",
        project: "Home",
        state,
        port: 8386,
        url: "http://127.0.0.1:8386/",
        tabid: "tab-svc",
        blockid: "blk-svc",
        autostart: true,
    });
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        globalStore.set(servicesAtom, null);
        m.serviceStart.mockResolvedValue(undefined);
    });

    it("gives a sleeping service its tab, starts it, and takes the centre whatever it shows", async () => {
        m.serviceOpen.mockResolvedValue(svc("sleeping"));
        const model = fakeModel();
        const res = await openTool(model, app(), { place: "panel" });
        expect(res).toEqual({ ok: true, tabId: "tab-svc" });
        expect(m.serviceOpen).toHaveBeenCalledWith({}, { id: "hong" });
        expect(m.serviceStart).toHaveBeenCalledWith({}, { id: "hong" });
        expect(m.serviceOpen.mock.invocationCallOrder[0]).toBeLessThan(m.serviceStart.mock.invocationCallOrder[0]);
        expect(globalStore.get(model.focusIdAtom)).toBe("tab-svc");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(m.showTerminal).toHaveBeenCalled();
        expect(globalStore.get(dockedTerminalAtom)).toBeNull();
    });

    it("never launches a terminal, probes the page, or writes block meta itself", async () => {
        m.serviceOpen.mockResolvedValue(svc("sleeping"));
        await openTool(fakeModel(), app(), { place: "centre" });
        expect(m.launchAgent).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(m.setMeta).not.toHaveBeenCalled();
        expect(m.resync).not.toHaveBeenCalled();
    });

    it("shows a running or starting service without starting it again", async () => {
        for (const state of ["running", "starting"]) {
            m.serviceStart.mockClear();
            m.serviceOpen.mockResolvedValue(svc(state));
            const model = fakeModel();
            const res = await openTool(model, app(), { place: "centre" });
            expect(res).toEqual({ ok: true, tabId: "tab-svc" });
            expect(m.serviceStart).not.toHaveBeenCalled();
            expect(globalStore.get(model.focusIdAtom)).toBe("tab-svc");
        }
    });

    it("starts a service running elsewhere, which probes its page again", async () => {
        m.serviceOpen.mockResolvedValue(svc("elsewhere"));
        await openTool(fakeModel(), app(), { place: "centre" });
        expect(m.serviceStart).toHaveBeenCalledWith({}, { id: "hong" });
    });

    it("puts the opened service in the list before wavesrv's event arrives", async () => {
        m.serviceOpen.mockResolvedValue(svc("sleeping"));
        await openTool(fakeModel(), app(), { place: "centre" });
        expect(globalStore.get(servicesAtom)?.map((s) => s.id)).toEqual(["hong"]);
    });

    it("says so, and changes nothing, when wavesrv refuses to open it", async () => {
        m.serviceOpen.mockRejectedValue(new Error("no such service"));
        const model = fakeModel();
        const res = await openTool(model, app(), { place: "centre" });
        expect(res).toEqual({ ok: false, reason: "hong could not be opened as a service" });
        expect(m.serviceStart).not.toHaveBeenCalled();
        expect(m.showTerminal).not.toHaveBeenCalled();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });
});

describe("openTool", () => {
    it("refuses a tool whose command was not found, and spawns nothing", async () => {
        const res = await openTool(fakeModel(), status("gitui", { found: false }), { place: "centre" });
        expect(res).toEqual({ ok: false, reason: "gitui is not on PATH" });
        expect(m.launchAgent).not.toHaveBeenCalled();
    });

    it("opens in the focused agent's worktree, under the agent's project, and takes the focus", async () => {
        globalStore.set(railCwdsAtom, { "tab-a": "C:/code/arcterm/.wt/fix" });
        const model = fakeModel({
            focusId: "tab-a",
            agents: [{ id: "tab-a", name: "fix-login", project: "arcterm", blockId: "blk-a" }],
        });
        const res = await openTool(model, status("lazygit"), { place: "centre" });
        expect(res).toEqual({ ok: true, tabId: "tab-new" });
        expect(m.launchAgent).toHaveBeenCalledWith(model, {
            runtime: "terminal",
            startupCommand: "lazygit",
            task: "",
            projectPath: "C:/code/arcterm/.wt/fix",
            projectName: "arcterm",
            toolId: "lazygit",
            focus: true,
        });
    });

    it("falls back to the agent block's cmd:cwd when the rail has not resolved a folder", async () => {
        m.blocks["block:blk-a"] = { meta: { "cmd:cwd": "C:/code/arcterm/.wt/other" } };
        const model = fakeModel({
            focusId: "tab-a",
            agents: [{ id: "tab-a", name: "a", project: "arcterm", blockId: "blk-a" }],
        });
        await openTool(model, status("lazygit"), { place: "centre" });
        expect(m.launchAgent.mock.calls[0][1].projectPath).toBe("C:/code/arcterm/.wt/other");
    });

    it("falls back to the project root when the agent has no folder of its own", async () => {
        const model = fakeModel({ focusId: "tab-a", agents: [{ id: "tab-a", name: "a", project: "arcterm" }] });
        await openTool(model, status("lazygit"), { place: "centre" });
        expect(m.launchAgent.mock.calls[0][1].projectPath).toBe("C:/code/arcterm");
    });

    it("a named project opens in its root, whatever agent is focused", async () => {
        globalStore.set(railCwdsAtom, { "tab-a": "C:/elsewhere/.wt/x" });
        const model = fakeModel({ focusId: "tab-a", agents: [{ id: "tab-a", name: "a", project: "other" }] });
        await openTool(model, status("lazygit"), { project: "arcterm", place: "centre" });
        expect(m.launchAgent.mock.calls[0][1]).toMatchObject({
            projectPath: "C:/code/arcterm",
            projectName: "arcterm",
        });
    });

    it("a tool that opens in Home goes to Home, in the home folder", async () => {
        const model = fakeModel({ focusId: "tab-a", agents: [{ id: "tab-a", name: "a", project: "arcterm" }] });
        await openTool(model, status("btop", { opensin: "home" }), { place: "centre" });
        expect(m.launchAgent.mock.calls[0][1]).toMatchObject({ projectPath: "~", projectName: "Home" });
    });

    it("with nothing in focus opens in Home", async () => {
        await openTool(fakeModel(), status("lazygit"), { place: "centre" });
        expect(m.launchAgent.mock.calls[0][1]).toMatchObject({ projectPath: "~", projectName: "Home" });
    });

    it("types the command with its args", async () => {
        await openTool(fakeModel(), status("k9s", { args: "--readonly" }), { place: "centre" });
        expect(m.launchAgent.mock.calls[0][1].startupCommand).toBe("k9s --readonly");
    });

    it("in the panel keeps the focus where it is, docks the new terminal and shows the Agent surface", async () => {
        const model = fakeModel();
        const res = await openTool(model, status("lazygit"), { place: "panel" });
        expect(res).toEqual({ ok: true, tabId: "tab-new" });
        expect(m.launchAgent.mock.calls[0][1].focus).toBe(false);
        expect(globalStore.get(dockedTerminalAtom)).toBe("tab-new");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });
});

describe("installTool", () => {
    const glow = status("glow", { found: false, install: { windows: "winget install --id charmbracelet.glow -e" } });

    it("runs the install line in a command block of its own, labelled for the tree, in the project", async () => {
        const res = await installTool(fakeModel(), glow, "arcterm");
        expect(res).toEqual({ ok: true, tabId: "tab-i" });
        expect(m.createTermTab).toHaveBeenCalledWith("arcterm");
        expect(m.setMeta).toHaveBeenCalledWith(
            {},
            {
                oref: "block:blk-i",
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: "winget install --id charmbracelet.glow -e",
                    "cmd:shell": true,
                    "cmd:closeonexit": true,
                    "cmd:cwd": "C:/code/arcterm",
                },
            }
        );
        expect(m.reload).toHaveBeenCalledWith("block:blk-i");
        expect(m.setMeta).toHaveBeenCalledWith(
            {},
            { oref: "tab:tab-i", meta: { "session:project": "arcterm", "session:label": "Install glow" } }
        );
        expect(globalStore.get(installingAtom)).toEqual({ glow: "tab-i" });
    });

    it("starts the block with no view mounted, and only once its exit is being watched", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        expect(m.resync).toHaveBeenCalledWith(
            {},
            { tabid: "tab-i", blockid: "blk-i", rtopts: { termsize: { rows: 30, cols: 120 } } }
        );
        expect(m.log.indexOf("sub:controllerstatus")).toBeGreaterThanOrEqual(0);
        expect(m.log.indexOf("sub:controllerstatus")).toBeLessThan(m.log.indexOf("resync"));
        expect(m.log.indexOf("sub:blockclose")).toBeLessThan(m.log.indexOf("resync"));
    });

    it("with no project named, installs in the focused agent's project, else Home", async () => {
        const model = fakeModel({ focusId: "tab-a", agents: [{ id: "tab-a", name: "a", project: "arcterm" }] });
        await installTool(model, glow);
        expect(m.createTermTab).toHaveBeenLastCalledWith("arcterm");
        globalStore.set(installingAtom, {});
        await installTool(fakeModel(), glow);
        expect(m.createTermTab).toHaveBeenLastCalledWith("Home");
        const blockMetas = m.setMeta.mock.calls.filter((c) => c[1].oref === "block:blk-i");
        expect(blockMetas.at(-1)?.[1].meta["cmd:cwd"]).toBe("~");
    });

    it("says why when the tool has no install line for this system, and opens no terminal", async () => {
        const res = await installTool(fakeModel(), status("visidata", { found: false, install: { darwin: "brew i" } }));
        expect(res).toEqual({ ok: false, reason: "visidata has no install command for this system" });
        expect(m.createTermTab).not.toHaveBeenCalled();
    });

    it("does not start a second install of a tool already installing", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        m.createTermTab.mockClear();
        const res = await installTool(fakeModel(), glow, "arcterm");
        expect(res).toEqual({ ok: false, reason: "glow is already installing" });
        expect(m.createTermTab).not.toHaveBeenCalled();
    });

    it("ignores a status that is not the end, then on exit 0 drops the tool from both lists and reads the status", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        emit("blk-i", "controllerstatus", { blockid: "blk-i", shellprocstatus: "running", shellprocexitcode: 0 });
        expect(globalStore.get(installingAtom)).toEqual({ glow: "tab-i" });
        emit("blk-i", "controllerstatus", done(0));
        expect(globalStore.get(installingAtom)).toEqual({});
        expect(globalStore.get(failedAtom)).toEqual({});
        await vi.waitFor(() => expect(m.toolsStatus).toHaveBeenCalled());
        // the tab closes itself after the exit, and that close is no longer of interest
        expect(m.subs.every((s) => s.off.mock.calls.length > 0)).toBe(true);
    });

    it("on a non-zero exit keeps the tab, moves the tool to failed and releases the block from its controller", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        emit("blk-i", "controllerstatus", done(1));
        expect(globalStore.get(installingAtom)).toEqual({});
        expect(globalStore.get(failedAtom)).toEqual({ glow: "tab-i" });
        expect(m.setMeta).toHaveBeenCalledWith({}, { oref: "block:blk-i", meta: { controller: "" } });
        expect(m.closeTab).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(m.toolsStatus).toHaveBeenCalled());
    });

    it("a failed install's tab being closed clears the failure", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        emit("blk-i", "controllerstatus", done(1));
        emit("blk-i", "blockclose", "blk-i");
        expect(globalStore.get(failedAtom)).toEqual({});
    });

    it("a running install's tab closed by the user clears it, and the exit that follows changes nothing", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        emit("blk-i", "blockclose", "blk-i");
        expect(globalStore.get(installingAtom)).toEqual({});
        emit("blk-i", "controllerstatus", done(-1));
        expect(globalStore.get(failedAtom)).toEqual({});
    });

    it("closes its tab and clears its state when the block cannot be started", async () => {
        m.resync.mockRejectedValue(new Error("boom"));
        await expect(installTool(fakeModel(), glow, "arcterm")).rejects.toThrow("boom");
        expect(globalStore.get(installingAtom)).toEqual({});
        expect(m.closeTab).toHaveBeenCalledWith("ws1", "tab-i");
        expect(m.subs.every((s) => s.off.mock.calls.length > 0)).toBe(true);
    });
});

describe("retryInstall and showInstall", () => {
    const glow = status("glow", { found: false, install: { windows: "winget install glow" } });

    it("Try again closes the failed tab and installs again in the project it ran in", async () => {
        await installTool(fakeModel(), glow, "arcterm");
        emit("blk-i", "controllerstatus", done(1));
        m.createTermTab.mockResolvedValue({ tabId: "tab-j", blockId: "blk-j" });
        const res = await retryInstall(fakeModel(), glow);
        expect(res).toEqual({ ok: true, tabId: "tab-j" });
        expect(m.closeTab).toHaveBeenCalledWith("ws1", "tab-i");
        expect(m.createTermTab).toHaveBeenLastCalledWith("arcterm");
        expect(globalStore.get(failedAtom)).toEqual({});
        expect(globalStore.get(installingAtom)).toEqual({ glow: "tab-j" });
        // the old tab's close arrives after the new install started: it must not take the new one with it
        emit("blk-i", "blockclose", "blk-i");
        expect(globalStore.get(installingAtom)).toEqual({ glow: "tab-j" });
    });

    it("Show focuses the running or the failed install's tab in the centre", async () => {
        const model = fakeModel();
        await installTool(model, glow, "arcterm");
        expect(showInstall(model, "glow")).toBe(true);
        expect(globalStore.get(model.focusIdAtom)).toBe("tab-i");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(m.showTerminal).toHaveBeenCalledTimes(1);
        emit("blk-i", "controllerstatus", done(1));
        expect(showInstall(model, "glow")).toBe(true);
    });

    it("Show says there is nothing to show for a tool with no install terminal", () => {
        expect(showInstall(fakeModel(), "glow")).toBe(false);
        expect(m.showTerminal).not.toHaveBeenCalled();
    });
});

describe("loadTools", () => {
    it("keeps the statuses it reads, and the reason when it cannot", async () => {
        m.toolsStatus.mockResolvedValueOnce({ tools: [status("lazygit")] });
        await loadTools();
        expect(globalStore.get(toolsStatusAtom)?.map((t) => t.id)).toEqual(["lazygit"]);
        expect(globalStore.get(toolsErrorAtom)).toBeNull();

        m.toolsStatus.mockRejectedValueOnce(new Error("backend down"));
        await loadTools();
        expect(globalStore.get(toolsErrorAtom)).toBe("backend down");
        expect(globalStore.get(toolsStatusAtom)?.map((t) => t.id)).toEqual(["lazygit"]);
    });

    it("keeps a suggestion out of the statuses every picker reads, and an added one in them", async () => {
        m.toolsStatus.mockResolvedValueOnce({
            tools: [
                status("lazygit"),
                status("ncdu", { detected: true }),
                status("tig", { detected: true, user: true }),
            ],
        });
        await loadTools();
        expect(globalStore.get(toolsStatusAtom)?.map((t) => t.id)).toEqual(["lazygit", "tig"]);
        expect(globalStore.get(toolSuggestionsAtom).map((t) => t.id)).toEqual(["ncdu"]);
    });

    it("a read asked for while one is under way runs again when it ends", async () => {
        let release: (v: { tools: ToolStatus[] }) => void = () => {};
        m.toolsStatus.mockReturnValueOnce(new Promise((r) => (release = r)));
        const first = loadTools();
        const second = loadTools();
        expect(m.toolsStatus).toHaveBeenCalledTimes(1);
        release({ tools: [] });
        await Promise.all([first, second]);
        expect(m.toolsStatus).toHaveBeenCalledTimes(2);
    });
});

describe("the user's own tools", () => {
    it("addUserTool writes the entry, then reads the status", async () => {
        await addUserTool("mytool", { command: "mytool", purpose: "mine" });
        expect(m.toolsSetUser).toHaveBeenCalledWith({}, { id: "mytool", tool: { command: "mytool", purpose: "mine" } });
        expect(m.toolsStatus).toHaveBeenCalled();
    });

    it("removeUserTool deletes the entry (no tool in the call), then reads the status", async () => {
        await removeUserTool("mytool");
        expect(m.toolsSetUser).toHaveBeenCalledWith({}, { id: "mytool" });
        expect(m.toolsStatus).toHaveBeenCalled();
    });
});

describe("the pinned tools and the picker", () => {
    it("starts with lazygit, yazi and btop, and pins or unpins one", () => {
        expect(globalStore.get(pinnedToolsAtom)).toEqual(["lazygit", "yazi", "btop"]);
        setToolPinned("glow", true);
        expect(globalStore.get(pinnedToolsAtom)).toEqual(["lazygit", "yazi", "btop", "glow"]);
        setToolPinned("yazi", false);
        expect(globalStore.get(pinnedToolsAtom)).toEqual(["lazygit", "btop", "glow"]);
    });

    it("openToolPicker opens it for a project, reads the status fresh and closes an open New dialog", async () => {
        const model = fakeModel();
        globalStore.set(model.launcherAtom, "agent");
        openToolPicker(model, "arcterm");
        expect(globalStore.get(toolPickerAtom)).toEqual({ open: true, project: "arcterm" });
        expect(m.closeLauncher).toHaveBeenCalledWith(model);
        await vi.waitFor(() => expect(m.toolsStatus).toHaveBeenCalled());
    });

    it("opens with no project to follow the focused agent, and leaves a closed New dialog alone", () => {
        openToolPicker(fakeModel());
        expect(globalStore.get(toolPickerAtom)).toEqual({ open: true, project: undefined });
        expect(m.closeLauncher).not.toHaveBeenCalled();
    });
});
