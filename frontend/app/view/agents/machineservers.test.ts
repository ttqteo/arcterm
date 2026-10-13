import { describe, expect, it } from "vitest";
import type { DevServerRow } from "./devserversmodel";
import { buildMachineServers, machinePollMs } from "./machineservers";
import type { BackgroundTask } from "./transcriptprojection";

const row = (o: Partial<DevServerRow>): DevServerRow => ({
    pid: 1,
    createms: 1,
    ports: [3000],
    name: "node.exe",
    cmdline: "node server.js",
    cwd: "",
    byagent: false,
    ...o,
});
const agents = [
    { id: "tab-p", name: "portal", agent: "claude" },
    { id: "tab-t", name: "dev", kind: "terminal" as const },
];
const pnpmTask: BackgroundTask = {
    toolUseId: "u1",
    label: "Restart built portal on 4310",
    command: "pnpm run start",
    status: "running",
    outputFile: "C:\\tmp\\bp9.output",
};

describe("buildMachineServers", () => {
    const astro = row({
        pid: 29308,
        ports: [4321],
        cmdline: "node astro.mjs dev --port 4321",
        repo: "D:\\Workspace\\SIEM\\apps\\website",
        owner: { kind: "detached" },
        launchercmdline: "sh /c/nvm4w/nodejs/pnpm dev --port 4321",
    });
    const portal = row({
        pid: 456720,
        ports: [4310],
        cmdline: "node ./dist/server/entry.mjs",
        repo: "D:\\Workspace\\SIEM\\apps\\portal",
        owner: { kind: "detached" },
        launchercmdline: '"C:\\Program Files\\Git\\usr\\bin\\sh.exe" /c/nvm4w/nodejs/pnpm run start',
    });
    const uvicorn = row({
        pid: 291124,
        ports: [8100],
        cmdline: "python -m uvicorn app.main:app",
        repo: "D:\\Workspace\\SIEM\\apps\\portal",
        owner: { kind: "agent", tabid: "tab-p", name: "portal", harness: "claude" },
    });
    const vite = row({
        pid: 456180,
        ports: [5174],
        cmdline: "node vite",
        repo: "D:\\work\\arcterm",
        owner: { kind: "terminal", tabid: "tab-t", blockid: "blk-t", name: "dev" },
    });
    const code = row({
        pid: 41656,
        ports: [58921],
        name: "Code.exe",
        cmdline: "Code.exe",
        owner: { kind: "app", name: "Code.exe" },
    });
    const docker = row({
        pid: 32444,
        ports: [5432],
        name: "com.docker.backend.exe",
        cmdline: "com.docker.backend services",
        owner: { kind: "app", name: "com.docker.backend.exe" },
    });

    it("a detached server a running background task launched belongs to that agent, with its log", () => {
        const v = buildMachineServers([portal], agents, { "tab-p": [pnpmTask] });
        const r = v.groups[0].rows[0];
        expect(r.badge).toEqual({ kind: "agent", text: "claude · portal", tabId: "tab-p" });
        expect(r.log).toEqual({ agentId: "tab-p", task: pnpmTask });
        expect(v.noOwnerCount).toBe(0);
    });

    // the 2026-10-13 :4310 case: `pnpm run dev` ran Astro 7's `astro dev`, which started the server and exited, so the
    // task completed with the server still listening and no live launcher to match
    const daemonized = row({
        pid: 192132,
        createms: Date.parse("2026-10-13T06:50:34Z"),
        ports: [4310],
        cmdline: "node astro.mjs dev --json",
        repo: "D:\\Workspace\\SIEM\\apps\\portal",
        owner: { kind: "detached" },
        launchercmdline: "node astro.mjs dev --json",
    });
    const devTask: BackgroundTask = {
        toolUseId: "u2",
        label: "Start the portal dev server",
        command: "pnpm run dev",
        status: "completed",
        outputFile: "C:\\tmp\\b1f.output",
        startMs: Date.parse("2026-10-13T06:49:45Z"),
        endMs: Date.parse("2026-10-13T06:50:49Z"),
    };

    it("a detached server that came up while a task ran to its end belongs to that task's agent", () => {
        const v = buildMachineServers([daemonized], agents, { "tab-p": [devTask] });
        const r = v.groups[0].rows[0];
        expect(r.badge).toEqual({ kind: "agent", text: "claude · portal", tabId: "tab-p" });
        expect(r.log).toEqual({ agentId: "tab-p", task: devTask });
        expect(v.noOwnerCount).toBe(0);
    });

    it("a detached server started outside an ended task's run, or after it was stopped, has no owner", () => {
        const later = { ...daemonized, createms: devTask.endMs! + 1000 };
        expect(buildMachineServers([later], agents, { "tab-p": [devTask] }).noOwnerCount).toBe(1);
        const stopped = { ...devTask, status: "stopped" as const };
        expect(buildMachineServers([daemonized], agents, { "tab-p": [stopped] }).noOwnerCount).toBe(1);
    });

    it("a detached server no running task matches has no owner", () => {
        const v = buildMachineServers([portal], agents, { "tab-p": [{ ...pnpmTask, status: "stopped" }] });
        expect(v.groups[0].rows[0].badge).toEqual({ kind: "noowner", text: "no owner" });
        expect(v.noOwnerCount).toBe(1);
    });

    // Docker Desktop, OneDrive, wavesrv: an app whose launcher exited reads as itself, not as a stray server
    it("a detached process outside any repo is badged by its own name, not no owner", () => {
        const onedrive = row({
            pid: 144668,
            name: "OneDrive.Sync.Service.exe",
            cmdline: "OneDrive.Sync.Service.exe",
            owner: { kind: "detached" },
        });
        const v = buildMachineServers([onedrive], agents, {});
        expect(v.other[0].badge).toEqual({ kind: "app", text: "OneDrive.Sync.Service" });
        expect(v.other[0].stopConfirm).toBe("Stop OneDrive.Sync.Service?");
        expect(v.noOwnerCount).toBe(0);
    });

    it("groups by repo, no-owner groups first, then by name; the rest go to Other", () => {
        const v = buildMachineServers([vite, uvicorn, astro, code, docker], agents, {});
        expect(v.groups.map((g) => g.title)).toEqual(["SIEM/apps/website", "SIEM/apps/portal", "work/arcterm"]);
        expect(v.repoCount).toBe(3);
        expect(v.other.map((r) => r.server.pid)).toEqual([41656, 32444]);
        expect(v.otherNames).toBe("Code, com.docker.backend");
    });

    it("badges an agent, a terminal and an app", () => {
        const v = buildMachineServers([uvicorn, vite, code], agents, {});
        const byPid = Object.fromEntries(
            [...v.groups.flatMap((g) => g.rows), ...v.other].map((r) => [r.server.pid, r])
        );
        expect(byPid[291124].badge).toEqual({ kind: "agent", text: "claude · portal", tabId: "tab-p" });
        expect(byPid[456180].badge).toEqual({ kind: "terminal", text: "terminal · dev", tabId: "tab-t" });
        expect(byPid[41656].badge).toEqual({ kind: "app", text: "Code" });
        expect(byPid[456180].termLog).toEqual({ tabId: "tab-t", blockId: "blk-t" });
        expect(byPid[291124].termLog).toBeUndefined();
        expect(byPid[41656].termLog).toBeUndefined();
    });

    it("Stop on an app's server names the app", () => {
        const v = buildMachineServers([code, uvicorn], agents, {});
        expect(v.other[0].stopConfirm).toBe("Stop Code?");
        expect(v.groups[0].rows[0].stopConfirm).toBe("Stop?");
    });

    it("an agent's server shows Log only when its launcher matches a running task", () => {
        const launched = { ...uvicorn, launchercmdline: 'bash -c "pnpm run start"' };
        expect(buildMachineServers([launched], agents, { "tab-p": [pnpmTask] }).groups[0].rows[0].log?.task).toBe(
            pnpmTask
        );
        expect(buildMachineServers([uvicorn], agents, { "tab-p": [pnpmTask] }).groups[0].rows[0].log).toBeUndefined();
    });
});

describe("machinePollMs", () => {
    it("polls fast while the popover is open", () => {
        expect(machinePollMs(true)).toBe(3000);
        expect(machinePollMs(false)).toBe(15000);
    });
});
