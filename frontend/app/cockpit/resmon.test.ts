// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    busyWords,
    cursorRows,
    fmtAge,
    fmtCpu,
    fmtMem,
    groupHeadline,
    groupView,
    isExpanded,
    killChildrenConfirmText,
    killChildrenTargets,
    killConfirmText,
    orderGroups,
    outcomeNote,
    ownerKindWords,
    ownerNoun,
    readout,
    RESMON_UI_INITIAL,
    resmonReduce,
    rowLabel,
    subtreeSize,
    type ResMonUi,
} from "./resmon";

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

const group = (
    key: string,
    ownerkind: string,
    label: string,
    rows: ProcessInfo[],
    extra: Partial<ResMonGroup> = {}
): ResMonGroup => ({
    key,
    ownerkind,
    label,
    killable: ownerkind === "agenttab" || ownerkind === "runworker",
    cpu: 0,
    mem: 0,
    rows,
    ...extra,
});

const arc = group("arc", "arc", "Arc", [
    proc(2476, 0, "wave-tauri.exe", { role: "Host" }),
    proc(27152, 1, "wavesrv.x64.exe", { role: "Backend" }),
]);

const waveterm = group("job:14820:1", "agenttab", "waveterm", [
    proc(14820, 0, "claude.exe", { tag: "agent", command: '"C:\\bin\\claude.exe" --resume' }),
    proc(14832, 1, "conhost.exe", { tag: "console" }),
    proc(18240, 1, "bash.exe"),
    proc(18244, 2, "go.exe", { command: "C:\\Go\\bin\\go.exe test ./pkg/orchestrate/..." }),
    proc(18311, 3, "orchestrate.test.exe"),
    proc(9932, 1, "cmd.exe"),
    proc(9958, 2, "node.exe"),
]);

const piWorker = group("job:13060:1", "runworker", "Arc · Task 2", [
    proc(13060, 0, "cmd.exe", { tag: "launcher" }),
    proc(13072, 1, "conhost.exe", { tag: "console" }),
    proc(13104, 1, "node.exe", { tag: "agent" }),
    proc(21876, 2, "bash.exe"),
    proc(21890, 3, "node.exe"),
]);

const verify = group("job:22410:1", "runcmd", "Arc · Verify", [
    proc(22410, 0, "bash.exe", { tag: "shell" }),
    proc(22418, 1, "node.exe"),
]);

const snap = (extra: Partial<ResMonSnapshotData> = {}): ResMonSnapshotData => ({
    supported: true,
    ready: true,
    ts: 1,
    cpu: 61.4,
    mem: 7.4 * 1024 * MB,
    totalmem: 32 * 1024 * MB,
    busycpu: false,
    busymem: false,
    groups: [],
    ...extra,
});

describe("formatting", () => {
    it("formats cpu with one decimal by default, integer on request, and – when unavailable", () => {
        expect(fmtCpu(28.94)).toBe("28.9%");
        expect(fmtCpu(61.4, 0)).toBe("61%");
        expect(fmtCpu(0)).toBe("0.0%");
        expect(fmtCpu(-1)).toBe("–");
        expect(fmtCpu(-1, 0)).toBe("–");
    });
    it("formats memory in binary units, MB under 1000 MB, GB at and above", () => {
        expect(fmtMem(486 * MB)).toBe("486 MB");
        expect(fmtMem(999 * MB)).toBe("999 MB");
        expect(fmtMem(1000 * MB)).toBe("1.0 GB");
        expect(fmtMem(1.9 * 1024 * MB)).toBe("1.9 GB");
        expect(fmtMem(0)).toBe("0 MB");
        expect(fmtMem(-1)).toBe("–");
    });
    it("formats age across the second, minute, hour and day edges", () => {
        const now = 10_000_000_000;
        const ago = (s: number) => now - s * 1000;
        expect(fmtAge(ago(45), now)).toBe("45s");
        expect(fmtAge(ago(59), now)).toBe("59s");
        expect(fmtAge(ago(60), now)).toBe("1m");
        expect(fmtAge(ago(42 * 60), now)).toBe("42m");
        expect(fmtAge(ago(3 * 3600 + 12 * 60), now)).toBe("3h 12m");
        expect(fmtAge(ago(24 * 3600 - 1), now)).toBe("23h 59m");
        expect(fmtAge(ago(24 * 3600), now)).toBe("1d 0h");
        expect(fmtAge(ago(2 * 86400 + 4 * 3600), now)).toBe("2d 4h");
        expect(fmtAge(0, now)).toBe("–");
    });
});

describe("busy and readout", () => {
    it("names every busy combination", () => {
        expect(busyWords(snap())).toBeNull();
        expect(busyWords(snap({ busycpu: true }))).toBe("high CPU");
        expect(busyWords(snap({ busymem: true }))).toBe("high memory");
        expect(busyWords(snap({ busycpu: true, busymem: true }))).toBe("high CPU and memory");
    });
    it("reads `Arc –` before any snapshot and before the first CPU delta", () => {
        for (const s of [null, snap({ ready: false, busycpu: true })]) {
            const r = readout(s);
            expect(r).toMatchObject({ visible: true, ready: false, cpu: "–", mem: "–", busy: null });
        }
    });
    it("hides when unsupported", () => {
        expect(readout(snap({ supported: false })).visible).toBe(false);
        expect(readout(snap({ supported: false, ready: false })).visible).toBe(false);
    });
    it("reads integer CPU and memory when ready, with the busy words in the aria label", () => {
        const r = readout(snap({ busycpu: true }));
        expect(r).toMatchObject({ visible: true, ready: true, cpu: "61%", mem: "7.4 GB", busy: "high CPU" });
        expect(r.aria).toBe("Resource Manager: Arc and its agents use 61% CPU and 7.4 GB, high CPU");
    });
});

describe("orderGroups", () => {
    it("pins Arc first however low its CPU, then sorts by CPU, ties by label", () => {
        const g = (key: string, label: string, cpu: number) => group(key, "agenttab", label, [], { cpu });
        const out = orderGroups([g("b", "beta", 5), g("arc", "Arc", 0.1), g("c", "alpha", 5), g("d", "zed", 40)]);
        expect(out.map((x) => x.key)).toEqual(["arc", "d", "c", "b"]);
    });
});

describe("owner words", () => {
    it("maps each owner kind to its header words and its noun", () => {
        expect(["arc", "agenttab", "runworker", "runcmd"].map(ownerKindWords)).toEqual([
            "App, read-only",
            "Agent tab",
            "Run worker",
            "Run command, read-only",
        ]);
        expect(["arc", "agenttab", "runworker", "runcmd"].map(ownerNoun)).toEqual([
            "Arc",
            "agent tab",
            "run worker",
            "run command",
        ]);
    });
});

describe("rowLabel", () => {
    it("labels an Arc row by role, with the image and its --type flag", () => {
        const r = proc(20028, 2, "msedgewebview2.exe", {
            role: "Renderer",
            command: '"C:\\Program Files\\WebView2\\msedgewebview2.exe" --type=renderer --lang=en-US',
        });
        expect(rowLabel(r)).toEqual({ name: "Renderer", cmd: "msedgewebview2.exe --type=renderer" });
        expect(
            rowLabel(proc(27152, 1, "wavesrv.x64.exe", { role: "Backend", command: "C:\\a\\wavesrv.x64.exe --x" }))
        ).toEqual({
            name: "Backend",
            cmd: "wavesrv.x64.exe",
        });
    });
    it("labels other rows by image, with the arguments minus the executable path", () => {
        expect(rowLabel(waveterm.rows[0])).toEqual({ name: "claude.exe", cmd: "--resume" });
        expect(rowLabel(waveterm.rows[3])).toEqual({ name: "go.exe", cmd: "test ./pkg/orchestrate/..." });
        expect(rowLabel(waveterm.rows[1])).toEqual({ name: "conhost.exe", cmd: "" });
    });
    it("falls back to the executable's base name when the image name is missing", () => {
        expect(rowLabel(proc(5, 0, "", { command: '"C:\\x y\\tool.exe" -v' }))).toEqual({
            name: "tool.exe",
            cmd: "-v",
        });
    });
});

describe("kill texts", () => {
    it("counts a row's contiguous deeper rows as its subtree", () => {
        expect(subtreeSize(waveterm.rows, 2)).toBe(2); // bash.exe → go.exe → orchestrate.test.exe
        expect(subtreeSize(waveterm.rows, 4)).toBe(0);
        expect(subtreeSize(waveterm.rows, 0)).toBe(6);
    });
    it("asks to kill a row with 0, 1 and several children", () => {
        expect(killConfirmText(waveterm.rows[4], 0)).toBe(
            "Kill orchestrate.test.exe (18311)? It has no child processes."
        );
        expect(killConfirmText(waveterm.rows[3], 1)).toBe("Kill go.exe (18244) and its 1 child process?");
        expect(killConfirmText(waveterm.rows[2], 3)).toBe("Kill bash.exe (18240) and its 3 child processes?");
    });
    it("targets only the untagged rows for kill children", () => {
        expect(killChildrenTargets(waveterm).map((r) => r.pid)).toEqual([18240, 18244, 18311, 9932, 9958]);
        expect(killChildrenTargets(piWorker).map((r) => r.pid)).toEqual([21876, 21890]);
    });
    it("names the agent and its console as the survivors of kill children", () => {
        expect(killChildrenConfirmText(waveterm)).toBe(
            "Kill 5 processes under waveterm? claude.exe and its console keep running."
        );
    });
    it("names node.exe, not the cmd.exe launcher, as the survivor of a pi launcher chain", () => {
        expect(killChildrenConfirmText(piWorker)).toBe(
            "Kill 2 processes under Arc · Task 2? node.exe and its console keep running."
        );
    });
    it("names a lone shell with no console, and one process in the singular", () => {
        const g = group("job:1:1", "agenttab", "notes", [
            proc(1, 0, "pwsh.exe", { tag: "shell" }),
            proc(2, 1, "git.exe"),
        ]);
        expect(killChildrenConfirmText(g)).toBe("Kill 1 process under notes? pwsh.exe keeps running.");
    });
});

describe("outcomeNote", () => {
    const killed = (n: number): ResMonKillRtnData => ({ outcome: "killed", killed: n });
    it("notes a row kill with 0, 1 and 3 children", () => {
        expect(outcomeNote(killed(1), { name: "orchestrate.test.exe", pid: 18311 }, waveterm)).toEqual({
            text: "Killed orchestrate.test.exe (18311).",
            tone: "note",
        });
        expect(outcomeNote(killed(2), { name: "go.exe", pid: 18244 }, waveterm).text).toBe(
            "Killed go.exe (18244) and 1 child process."
        );
        expect(outcomeNote(killed(4), { name: "go.exe", pid: 18244 }, waveterm).text).toBe(
            "Killed go.exe (18244) and 3 child processes."
        );
    });
    it("notes a group kill of 1 and 5", () => {
        expect(outcomeNote(killed(1), null, waveterm)).toEqual({ text: "Killed 1 process.", tone: "note" });
        expect(outcomeNote(killed(5), null, waveterm).text).toBe("Killed 5 processes.");
    });
    it("notes a target that had already exited", () => {
        expect(outcomeNote({ outcome: "gone", killed: 0 }, { name: "node.exe", pid: 21890 }, piWorker)).toEqual({
            text: "node.exe (21890) had already exited.",
            tone: "note",
        });
    });
    it("alerts a refusal naming each owner noun", () => {
        const t = { name: "jarvis.test.exe", pid: 22590 };
        const refused: ResMonKillRtnData = { outcome: "refused", killed: 0 };
        for (const [kind, noun] of [
            ["arc", "Arc"],
            ["agenttab", "agent tab"],
            ["runworker", "run worker"],
            ["runcmd", "run command"],
        ]) {
            expect(outcomeNote(refused, t, group("k", kind, "L", []))).toEqual({
                text: `Not killed: pid 22590 no longer belongs to this ${noun}. The list refreshes in 2s.`,
                tone: "alert",
            });
        }
    });
    it("alerts a protected agent process", () => {
        expect(outcomeNote({ outcome: "protected", killed: 0 }, { name: "claude.exe", pid: 14820 }, waveterm)).toEqual({
            text: "Not killed: claude.exe (14820) is the agent's own process. Kill children stops what it started.",
            tone: "alert",
        });
    });
    it("alerts a failure with the OS text, with or without its trailing period", () => {
        const t = { name: "jarvis.test.exe", pid: 22590 };
        const want = {
            text: "Could not kill jarvis.test.exe (22590): Access is denied. It is still running.",
            tone: "alert",
        };
        expect(outcomeNote({ outcome: "failed", killed: 0, error: "Access is denied." }, t, piWorker)).toEqual(want);
        expect(outcomeNote({ outcome: "failed", killed: 0, error: "Access is denied" }, t, piWorker)).toEqual(want);
    });
});

describe("groupView", () => {
    const pids = (v: { lines: { row: ProcessInfo; depth: number }[] }) => v.lines.map((l) => [l.row.pid, l.depth]);

    it("keeps the agent and its commands, and counts the wrapping shells and consoles it leaves out", () => {
        const v = groupView(waveterm, RESMON_UI_INITIAL);
        expect(pids(v)).toEqual([
            [14820, 0],
            [18244, 1],
            [9958, 1],
        ]);
        expect(v.hidden).toBe(3);
        expect(v.hiddenMem).toBe(30 * MB);
        expect(v.full).toBe(false);
    });
    it("folds a chain of single children into its top line, naming its bottom and summing the chain", () => {
        const g = group("job:3", "agenttab", "arcterm", [
            proc(1, 0, "claude.exe", { tag: "agent" }),
            proc(2, 1, "task.exe", { command: "task.exe tauri:build", cpu: 0.1 }),
            proc(3, 2, "node.exe", { cpu: 0.2 }),
            proc(4, 3, "cargo.exe", { cpu: 0.3 }),
            proc(5, 4, "makensis.exe", { cpu: 8 }),
            proc(6, 4, "vctip.exe"),
            proc(7, 1, "sleep.exe", { command: "sleep.exe 10" }),
        ]);
        const v = groupView(g, RESMON_UI_INITIAL);
        expect(pids(v)).toEqual([
            [1, 0],
            [2, 1],
            [5, 2],
            [6, 2],
            [7, 1],
        ]);
        expect(v.lines[1]).toMatchObject({ leaf: { pid: 4 }, mem: 30 * MB });
        expect(v.lines[1].cpu).toBeCloseTo(0.6);
        expect(v.lines[2].leaf).toBeUndefined();
        expect(v.lines[4]).toMatchObject({ leaf: undefined, cpu: 0, mem: 10 * MB });
        expect(groupHeadline(g)).toBe("task tauri:build, sleep 10");
    });
    it("names no headline for Arc or a group running nothing, and leaves out a flag or a quoted argument", () => {
        const idle = group("job:4", "agenttab", "obsidian", [proc(1, 0, "claude.exe", { tag: "agent" })]);
        expect(groupHeadline(arc)).toBeNull();
        expect(groupHeadline(idle)).toBeNull();
        const g = group("job:5", "agenttab", "x", [
            proc(1, 0, "claude.exe", { tag: "agent" }),
            proc(2, 1, "vctip.exe"),
            proc(3, 1, "git.exe", { command: "git.exe -C D:/x log" }),
            proc(4, 1, "node.exe", { command: 'node.exe "C:/a b/x.js"' }),
        ]);
        expect(groupHeadline(g)).toBe("vctip, git, node");
    });
    it("leaves out a launcher, wsh agentctl and Claude's nested bash chain; an orphaned command sits under the agent", () => {
        const g = group("job:1", "agenttab", "arcterm", [
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
        const v = groupView(g, RESMON_UI_INITIAL);
        expect(pids(v)).toEqual([
            [2, 0],
            [9, 1],
            [10, 1],
            [11, 1],
        ]);
        expect(v.hidden).toBe(7);
    });
    it("leaves out an idle shell with nothing in it, keeps a busy one, and shows Arc whole", () => {
        const g = group("job:2", "agenttab", "portal", [
            proc(1, 0, "claude.exe", { tag: "agent" }),
            proc(2, 1, "cmd.exe"),
            proc(3, 2, "conhost.exe"),
            proc(4, 1, "bash.exe", { command: 'bash.exe -c "source snapshot"' }),
            proc(5, 2, "bash.exe"),
            proc(6, 1, "powershell.exe", { cpu: 12 }),
        ]);
        expect(pids(groupView(g, RESMON_UI_INITIAL))).toEqual([
            [1, 0],
            [6, 1],
        ]);
        expect(groupView(g, RESMON_UI_INITIAL).hidden).toBe(4);
        expect(groupView(arc, RESMON_UI_INITIAL)).toMatchObject({ hidden: 0, full: false });
        expect(groupView(arc, RESMON_UI_INITIAL).lines).toHaveLength(2);
    });
    it("shows the whole tree at its own depths when the group is full", () => {
        const v = groupView(waveterm, { ...RESMON_UI_INITIAL, full: { [waveterm.key]: true } });
        expect(pids(v)).toEqual(waveterm.rows.map((r) => [r.pid, r.depth]));
        expect(v).toMatchObject({ full: true, hidden: 3 });
    });
});

describe("resmonReduce", () => {
    const groups = [arc, waveterm, verify];
    const at = (ui: ResMonUi, cursor: string): ResMonUi => ({ ...ui, cursor });
    // the agent groups opened, Arc left folded
    const OPEN: ResMonUi = { ...RESMON_UI_INITIAL, expanded: { [waveterm.key]: true, [verify.key]: true } };

    it("starts with every group folded to its header", () => {
        for (const g of groups) {
            expect(isExpanded(RESMON_UI_INITIAL, g)).toBe(false);
        }
        expect(cursorRows(groups, RESMON_UI_INITIAL)).toEqual(["arc", waveterm.key, verify.key]);
        expect(cursorRows(groups, OPEN)).toEqual([
            "arc",
            waveterm.key,
            ...[14820, 18244, 9958].map((pid) => `${waveterm.key}/${pid}`),
            `${waveterm.key}/more`,
            verify.key,
            ...verify.rows.map((r) => `${verify.key}/${r.pid}`),
        ]);
    });
    it("moves across a collapsed Arc group straight to the next header, and clamps at the ends", () => {
        let ui = resmonReduce(OPEN, { type: "move", delta: 1, groups });
        expect(ui.cursor).toBe("arc");
        ui = resmonReduce(ui, { type: "move", delta: 1, groups });
        expect(ui.cursor).toBe(waveterm.key);
        ui = resmonReduce(ui, { type: "move", delta: -1, groups });
        ui = resmonReduce(ui, { type: "move", delta: -1, groups });
        expect(ui.cursor).toBe("arc");
        expect(resmonReduce(OPEN, { type: "move", delta: -1, groups }).cursor).toBe(`${verify.key}/22418`);
    });
    it("toggles the cursor's group, and a collapse pulls a row cursor up to its header", () => {
        let ui = resmonReduce(at(RESMON_UI_INITIAL, "arc"), { type: "toggle", groups });
        expect(isExpanded(ui, arc)).toBe(true);
        expect(resmonReduce(ui, { type: "move", delta: 1, groups }).cursor).toBe("arc/2476");
        ui = resmonReduce(at(OPEN, `${waveterm.key}/18244`), { type: "toggle", groups });
        expect(isExpanded(ui, waveterm)).toBe(false);
        expect(ui.cursor).toBe(waveterm.key);
        ui = resmonReduce(ui, { type: "toggle", groups, key: "arc" });
        expect(isExpanded(ui, arc)).toBe(true);
        expect(ui.cursor).toBe(waveterm.key);
        expect(resmonReduce(RESMON_UI_INITIAL, { type: "toggle", groups })).toBe(RESMON_UI_INITIAL);
    });
    it("⏎ on a group's helper line shows its whole tree; back to compact, a hidden cursor moves to that line", () => {
        let ui = resmonReduce(at(OPEN, `${waveterm.key}/more`), { type: "toggle", groups });
        expect(groupView(waveterm, ui).full).toBe(true);
        expect(isExpanded(ui, waveterm)).toBe(true);
        expect(cursorRows([waveterm], ui)).toEqual([
            waveterm.key,
            ...waveterm.rows.map((r) => `${waveterm.key}/${r.pid}`),
            `${waveterm.key}/more`,
        ]);
        ui = resmonReduce(at(ui, `${waveterm.key}/18240`), { type: "toggleFull", groups, key: waveterm.key });
        expect(groupView(waveterm, ui).full).toBe(false);
        expect(ui.cursor).toBe(`${waveterm.key}/more`);
        ui = resmonReduce(at(ui, `${waveterm.key}/18244`), { type: "toggleFull", groups, key: waveterm.key });
        ui = resmonReduce(ui, { type: "toggleFull", groups, key: waveterm.key });
        expect(ui.cursor).toBe(`${waveterm.key}/18244`);
    });
    it("asks to kill an untagged row in a killable group", () => {
        const ui = resmonReduce(at(RESMON_UI_INITIAL, `${waveterm.key}/18244`), { type: "askKill", groups });
        expect(ui.confirm).toEqual({ kind: "row", key: waveterm.key, pid: 18244 });
    });
    it("asks to kill the row a click names, moving the cursor there", () => {
        const ui = resmonReduce(RESMON_UI_INITIAL, { type: "askKill", groups, at: `${waveterm.key}/18311` });
        expect(ui.cursor).toBe(`${waveterm.key}/18311`);
        expect(ui.confirm).toEqual({ kind: "row", key: waveterm.key, pid: 18311 });
    });
    it("ignores x on a tagged row, in a read-only group, or on a header", () => {
        for (const cursor of [
            `${waveterm.key}/14820`,
            `${waveterm.key}/14832`,
            `${verify.key}/22418`,
            "arc/2476",
            waveterm.key,
        ]) {
            const ui = at(RESMON_UI_INITIAL, cursor);
            expect(resmonReduce(ui, { type: "askKill", groups })).toBe(ui);
        }
    });
    it("asks to kill children of the cursor's killable group, from its header or a row", () => {
        for (const cursor of [waveterm.key, `${waveterm.key}/14820`]) {
            expect(resmonReduce(at(RESMON_UI_INITIAL, cursor), { type: "askChildren", groups }).confirm).toEqual({
                kind: "group",
                key: waveterm.key,
            });
        }
    });
    it("ignores ⇧X on a read-only group or a group with no targets", () => {
        const bare = group("job:7716:1", "agenttab", "obsidian", [proc(7716, 0, "claude.exe", { tag: "agent" })]);
        for (const cursor of [verify.key, "arc", `${verify.key}/22418`, bare.key]) {
            const ui = at(RESMON_UI_INITIAL, cursor);
            expect(resmonReduce(ui, { type: "askChildren", groups: [...groups, bare] })).toBe(ui);
        }
    });
    it("cancels a confirm, and a new confirm clears that group's note", () => {
        let ui = resmonReduce(RESMON_UI_INITIAL, {
            type: "note",
            key: waveterm.key,
            note: { text: "Killed 1 process.", tone: "note" },
        });
        ui = resmonReduce(ui, { type: "askChildren", groups, at: waveterm.key });
        expect(ui.notes).toEqual({});
        expect(resmonReduce(ui, { type: "cancel" }).confirm).toBeNull();
    });
    it("close clears the cursor, confirm and notes but keeps the expansion", () => {
        let ui = resmonReduce(at(RESMON_UI_INITIAL, "arc"), { type: "toggle", groups });
        ui = resmonReduce(ui, { type: "toggleFull", groups, key: waveterm.key });
        ui = resmonReduce(ui, { type: "askKill", groups, at: `${waveterm.key}/18311` });
        ui = resmonReduce(ui, { type: "note", key: verify.key, note: { text: "x", tone: "alert" } });
        ui = resmonReduce(ui, { type: "close" });
        expect(ui).toEqual({
            cursor: null,
            confirm: null,
            notes: {},
            expanded: { arc: true },
            full: { [waveterm.key]: true },
        });
    });
});
