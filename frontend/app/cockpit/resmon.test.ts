// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentWork, busyWords, fmtCpu, fmtMem, groupView, killNote, readout, rowLabel } from "./resmon";

const MB = 1024 * 1024;

const proc = (pid: number, depth: number, name: string, extra: Partial<ProcessInfo> = {}): ProcessInfo => ({
    pid,
    depth,
    name,
    mem: 10 * MB,
    mempct: 0,
    cpu: 0,
    numthreads: 1,
    ...extra,
});

const group = (key: string, rows: ProcessInfo[], extra: Partial<ResMonGroup> = {}): ResMonGroup => ({
    key,
    ownerkind: "agenttab",
    ownerid: `blk-${key}`,
    label: key,
    killable: true,
    cpu: 0,
    mem: 0,
    rows,
    ...extra,
});

const arc = group("arc", [
    proc(2476, 0, "wave-tauri.exe", { role: "Host" }),
    proc(27152, 1, "wavesrv.x64.exe", { role: "Backend" }),
]);

const waveterm = group(
    "job:14820",
    [
        proc(14820, 0, "claude.exe", { tag: "agent", command: '"C:\\bin\\claude.exe" --resume' }),
        proc(14832, 1, "conhost.exe", { tag: "console" }),
        proc(18240, 1, "bash.exe"),
        proc(18244, 2, "go.exe", { command: "C:\\Go\\bin\\go.exe test ./pkg/orchestrate/...", cpu: 0.6 }),
        proc(18311, 3, "orchestrate.test.exe", { mem: 1900 * MB, cpu: 28.9 }),
        proc(9932, 1, "cmd.exe"),
        proc(9958, 2, "node.exe", { command: "node.exe vite --port 5174", mem: 846 * MB }),
    ],
    { cpu: 31.4 }
);

const snap = (extra: Partial<ResMonSnapshotData> = {}): ResMonSnapshotData => ({
    supported: true,
    ready: true,
    ts: 1,
    cpu: 61.4,
    mem: 7.4 * 1024 * MB,
    totalmem: 32 * 1024 * MB,
    busycpu: false,
    busymem: false,
    groups: [arc, waveterm],
    ...extra,
});

describe("formatting", () => {
    it("formats cpu with one decimal by default, integer on request, and – when unavailable", () => {
        expect(fmtCpu(28.94)).toBe("28.9%");
        expect(fmtCpu(61.4, 0)).toBe("61%");
        expect(fmtCpu(0)).toBe("0.0%");
        expect(fmtCpu(-1)).toBe("–");
    });
    it("formats memory in binary units, MB under 1000 MB, GB at and above", () => {
        expect(fmtMem(486 * MB)).toBe("486 MB");
        expect(fmtMem(999 * MB)).toBe("999 MB");
        expect(fmtMem(1000 * MB)).toBe("1.0 GB");
        expect(fmtMem(-1)).toBe("–");
    });
});

describe("busy and readout", () => {
    it("names every busy combination", () => {
        expect(busyWords(snap())).toBeNull();
        expect(busyWords(snap({ busycpu: true }))).toBe("high CPU");
        expect(busyWords(snap({ busymem: true }))).toBe("high memory");
        expect(busyWords(snap({ busycpu: true, busymem: true }))).toBe("high CPU and memory");
    });
    it("reads nothing before a snapshot, before the first CPU delta, and where unsupported", () => {
        for (const s of [null, snap({ ready: false, busycpu: true }), snap({ supported: false })]) {
            expect(readout(s)).toEqual({ ready: false, cpu: "–", mem: "–", busy: null });
        }
    });
    it("reads integer CPU, memory and the busy words when ready", () => {
        expect(readout(snap({ busycpu: true }))).toEqual({ ready: true, cpu: "61%", mem: "7.4 GB", busy: "high CPU" });
    });
});

describe("rowLabel", () => {
    it("labels an Arc row by role, with the image and its --type flag", () => {
        const r = proc(20028, 2, "msedgewebview2.exe", {
            role: "Renderer",
            command: '"C:\\Program Files\\WebView2\\msedgewebview2.exe" --type=renderer --lang=en-US',
        });
        expect(rowLabel(r)).toEqual({ name: "Renderer", cmd: "msedgewebview2.exe --type=renderer" });
    });
    it("labels other rows by image, with the arguments minus the executable path", () => {
        expect(rowLabel(waveterm.rows[0])).toEqual({ name: "claude.exe", cmd: "--resume" });
        expect(rowLabel(waveterm.rows[3])).toEqual({ name: "go.exe", cmd: "test ./pkg/orchestrate/..." });
    });
    it("falls back to the executable's base name when the image name is missing", () => {
        expect(rowLabel(proc(5, 0, "", { command: '"C:\\x y\\tool.exe" -v' }))).toEqual({
            name: "tool.exe",
            cmd: "-v",
        });
    });
});

describe("groupView", () => {
    const pids = (lines: { row: ProcessInfo; depth: number }[]) => lines.map((l) => [l.row.pid, l.depth]);

    it("keeps the agent and its commands, folding the wrapping shells, consoles and single-child chains", () => {
        const lines = groupView(waveterm);
        expect(pids(lines)).toEqual([
            [14820, 0],
            [18244, 1],
            [9958, 1],
        ]);
        expect(lines[1]).toMatchObject({ leaf: { pid: 18311 }, mem: 1910 * MB });
        expect(lines[1].cpu).toBeCloseTo(29.5);
    });
    it("leaves out a launcher, wsh agentctl and Claude's nested bash chain; an orphaned command sits under the agent", () => {
        const g = group("job:1", [
            proc(1, 0, "powershell.exe", { tag: "launcher" }),
            proc(2, 1, "claude.exe", { tag: "agent" }),
            proc(3, 2, "wsh.exe", { command: "wsh.exe agentctl" }),
            proc(4, 3, "conhost.exe"),
            proc(5, 2, "bash.exe"),
            proc(6, 3, "bash.exe"),
            proc(7, 4, "conhost.exe"),
            proc(8, 4, "bash.exe"),
            proc(9, 5, "git.exe", { cpu: 2.1 }),
            proc(10, 0, "awk.exe"),
            proc(11, 0, "wsh.exe", { command: "wsh.exe runs list" }),
        ]);
        expect(pids(groupView(g))).toEqual([
            [2, 0],
            [9, 1],
            [10, 1],
            [11, 1],
        ]);
    });
    it("leaves out an idle shell with nothing in it and keeps a busy one", () => {
        const g = group("job:2", [
            proc(1, 0, "claude.exe", { tag: "agent" }),
            proc(2, 1, "cmd.exe"),
            proc(3, 2, "conhost.exe"),
            proc(4, 1, "powershell.exe", { cpu: 12 }),
        ]);
        expect(pids(groupView(g))).toEqual([
            [1, 0],
            [4, 1],
        ]);
    });
});

describe("agentWork", () => {
    it("finds the agent's group by its block and names its heaviest command, weighed with everything under it", () => {
        expect(agentWork(snap(), "blk-job:14820")).toEqual({
            cpu: 31.4,
            command: {
                label: "go test ./pkg/orchestrate/...",
                pid: 18244,
                ownerid: "blk-job:14820",
                cpu: expect.closeTo(29.5, 5),
                mem: 1910 * MB,
            },
        });
    });
    it("names no command for an agent running nothing", () => {
        const idle = group(
            "job:7716",
            [proc(7716, 0, "claude.exe", { tag: "agent" }), proc(7724, 1, "conhost.exe", { tag: "console" })],
            { cpu: 0.1 }
        );
        expect(agentWork(snap({ groups: [idle] }), "blk-job:7716")).toEqual({ cpu: 0.1, command: null });
    });
    it("reads nothing with no snapshot, where unsupported, or for a block with no group", () => {
        expect(agentWork(null, "blk-job:14820")).toBeNull();
        expect(agentWork(snap({ supported: false }), "blk-job:14820")).toBeNull();
        expect(agentWork(snap(), "blk-elsewhere")).toBeNull();
        expect(agentWork(snap(), "blk-arc")).toBeNull();
    });
});

describe("killNote", () => {
    const label = "git log --all -p";
    it("notes a kill and a command that had already exited", () => {
        expect(killNote({ outcome: "killed", killed: 4 }, label)).toEqual({
            text: "Killed git log --all -p.",
            tone: "note",
        });
        expect(killNote({ outcome: "gone", killed: 0 }, label)).toEqual({
            text: "git log --all -p had already exited.",
            tone: "note",
        });
    });
    it("alerts a refusal and a failure, with the OS text and without its trailing period", () => {
        expect(killNote({ outcome: "refused", killed: 0 }, label)).toEqual({
            text: "Not killed: git log --all -p no longer belongs to this agent.",
            tone: "alert",
        });
        expect(killNote({ outcome: "failed", killed: 0, error: "Access is denied." }, label)).toEqual({
            text: "Could not kill git log --all -p: Access is denied. It is still running.",
            tone: "alert",
        });
    });
});
