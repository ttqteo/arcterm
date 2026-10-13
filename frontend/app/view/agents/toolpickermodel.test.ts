// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    flatRows,
    footerHints,
    openRefusal,
    pickerContext,
    pickerGroups,
    pickerKey,
    rowNote,
    rowOpensIn,
    selectedRow,
    type PickerRow,
} from "./toolpickermodel";

function tool(id: string, over: Partial<ToolStatus> = {}): ToolStatus {
    return {
        id,
        name: id,
        category: "Git",
        purpose: `${id} purpose`,
        command: id,
        opensin: "agent",
        shows: "centre",
        install: { windows: `winget install ${id}`, darwin: `brew install ${id}` },
        found: true,
        ...over,
    };
}

const catalog: ToolStatus[] = [
    tool("lazygit", { purpose: "Git: stage hunks, commit, branch, rebase" }),
    tool("gitui", { found: false }),
    tool("yazi", { category: "Files", purpose: "Files: browse, preview, rename, move" }),
    tool("broot", { category: "Files", found: false }),
    tool("btop", { category: "System", opensin: "home", purpose: "System: CPU, memory, processes" }),
    tool("lazydocker", { category: "Containers", found: false, purpose: "Docker: containers, images, logs" }),
    tool("k9s", { category: "Containers", found: false }),
    tool("glow", { category: "Docs and data", found: false, purpose: "Markdown: read docs and plans" }),
    tool("pr-dashboard", { name: "PR dashboard", category: "Yours", user: true, command: "gh", args: "dash" }),
    tool("serpl", { category: "Yours", user: true, found: false, install: {} }),
];

const ids = (rows: { tool: ToolStatus }[]) => rows.map((r) => r.tool.id);
const roots = new Map([["arcterm", "D:/work/arcterm"]]);

describe("pickerContext", () => {
    it("names the agent's worktree, with its branch and its path from the project", () => {
        const ctx = pickerContext(
            {
                project: "arcterm",
                name: "fix-login",
                cwd: "D:\\work\\arcterm\\.worktrees\\fix-login-agent",
                branch: "fix-login-agent",
            },
            roots
        );
        expect(ctx).toEqual({
            text: "Opens in fix-login's worktree",
            branch: "fix-login-agent",
            path: "arcterm/.worktrees/fix-login-agent",
        });
    });

    it("names the project when the agent is in its root, whatever the separators and case", () => {
        const ctx = pickerContext({ project: "arcterm", name: "loom", cwd: "d:\\work\\ARCTERM\\" }, roots);
        expect(ctx).toEqual({ text: "Opens in arcterm" });
    });

    it("names the project for a folder's tool button: no agent, no folder", () => {
        expect(pickerContext({ project: "arcterm" }, roots)).toEqual({ text: "Opens in arcterm" });
    });

    it("names Home with nothing in focus, or a project with no folder to open in", () => {
        expect(pickerContext(undefined, roots)).toEqual({ text: "Opens in Home" });
        expect(pickerContext({ project: "ghost" }, roots)).toEqual({ text: "Opens in Home" });
        expect(pickerContext({}, roots)).toEqual({ text: "Opens in Home" });
    });

    it("shortens the ids an engine worktree carries", () => {
        const ctx = pickerContext(
            {
                project: "arcterm",
                name: "worker",
                cwd: "D:/work/arcterm/.waveterm/worktrees/41df6bc1-ce1e-41f4-bc9c-1719d7f0a424-t-7",
            },
            roots
        );
        expect(ctx.path).toBe("arcterm/.waveterm/worktrees/41df6bc1-t-7");
    });

    it("names a terminal's folder by its own name, a folder outside the project by where it is", () => {
        expect(pickerContext({ project: "arcterm", cwd: "D:/work/arcterm/.worktrees/spike" }, roots).text).toBe(
            "Opens in spike"
        );
        expect(pickerContext({ project: "arcterm", name: "x", cwd: "D:/elsewhere/notes" }, roots)).toEqual({
            text: "Opens in notes",
            path: "D:/elsewhere/notes",
        });
    });

    it("uses the folder a project with no registered root is in", () => {
        expect(pickerContext({ project: "scratch", name: "a", cwd: "D:/scratch" }, roots)).toEqual({
            text: "Opens in scratch",
            path: "D:/scratch",
        });
    });
});

describe("pickerGroups", () => {
    it("lists the installed tools pinned first, then yours, then two that are not installed", () => {
        const g = pickerGroups(catalog, ["yazi"], {}, {}, "");
        expect(g.map((x) => x.key)).toEqual(["installed", "notInstalled", "yours"]);
        expect(ids(g[0].rows)).toEqual(["yazi", "lazygit", "btop"]);
        expect(ids(g[1].rows)).toEqual(["gitui", "broot"]);
        expect(ids(g[2].rows)).toEqual(["pr-dashboard", "serpl"]);
    });

    it("labels the groups as the board does", () => {
        const g = pickerGroups(catalog, [], {}, {}, "");
        expect(g.map((x) => x.label)).toEqual(["Installed", "Not installed", "Yours"]);
    });

    it("leaves out a group with nothing in it", () => {
        const onlyYours = catalog.filter((t) => t.category === "Yours");
        expect(pickerGroups(onlyYours, [], {}, {}, "").map((x) => x.key)).toEqual(["yours"]);
        expect(pickerGroups([], [], {}, {}, "")).toEqual([]);
    });

    it("always lists a tool whose install is running or failed, whatever the cap on the not-installed", () => {
        const g = pickerGroups(catalog, [], { glow: "t1" }, { k9s: "t2" }, "");
        const rows = g.find((x) => x.key === "notInstalled")!.rows;
        expect(ids(rows)).toEqual(["gitui", "broot", "k9s", "glow"]);
        expect(rows.find((r) => r.tool.id === "glow")!.state).toBe("installing");
        expect(rows.find((r) => r.tool.id === "k9s")!.state).toBe("failed");
    });

    it("gives a yours tool the install overlay and its PATH state", () => {
        const g = pickerGroups(catalog, [], { serpl: "t1" }, { "pr-dashboard": "t2" }, "");
        const yours = g.find((x) => x.key === "yours")!.rows;
        expect(yours.map((r) => r.state)).toEqual(["failed", "installing"]);
        const plain = pickerGroups(catalog, [], {}, {}, "").find((x) => x.key === "yours")!.rows;
        expect(plain.map((r) => r.state)).toEqual(["on-path", "not-on-path"]);
    });

    it("a query keeps the tools whose name or purpose holds it, the whole catalog searched", () => {
        const g = pickerGroups(catalog, [], {}, {}, "  DOCKER ");
        expect(ids(g.flatMap((x) => x.rows))).toEqual(["lazydocker"]);
        // beyond the two the empty query would show
        expect(ids(pickerGroups(catalog, [], {}, {}, "markdown").flatMap((x) => x.rows))).toEqual(["glow"]);
        expect(pickerGroups(catalog, [], {}, {}, "nothing like it")).toEqual([]);
    });

    it("a query reaches a yours tool by its name and its command", () => {
        expect(ids(pickerGroups(catalog, [], {}, {}, "pr dash").flatMap((x) => x.rows))).toEqual(["pr-dashboard"]);
        expect(ids(pickerGroups(catalog, [], {}, {}, "gh").flatMap((x) => x.rows))).toEqual(["pr-dashboard"]);
    });
});

describe("flatRows and selectedRow", () => {
    const groups = pickerGroups(catalog, [], {}, {}, "");

    it("walks the groups in the order they are drawn", () => {
        expect(ids(flatRows(groups))).toEqual(["lazygit", "yazi", "btop", "gitui", "broot", "pr-dashboard", "serpl"]);
    });

    it("clamps the selection into the rows, none for an empty list", () => {
        const rows = flatRows(groups);
        expect(selectedRow(rows, 1)?.tool.id).toBe("yazi");
        expect(selectedRow(rows, 99)?.tool.id).toBe("serpl");
        expect(selectedRow(rows, -3)?.tool.id).toBe("lazygit");
        expect(selectedRow([], 0)).toBeUndefined();
    });
});

describe("rowOpensIn", () => {
    it("says so for a tool that does not open in the agent's folder", () => {
        expect(rowOpensIn(tool("btop", { opensin: "home" }))).toBe("opens in Home");
        expect(rowOpensIn(tool("broot", { opensin: "root" }))).toBe("opens in the project root");
        expect(rowOpensIn(tool("lazygit"))).toBeUndefined();
    });
});

describe("rowNote", () => {
    const row = (t: ToolStatus, state: PickerRow["state"]): PickerRow => ({ tool: t, state });

    it("is the purpose for a tool in good standing", () => {
        expect(rowNote(row(tool("lazygit", { purpose: "Git: stage hunks" }), "installed"), "win32")).toEqual({
            text: "Git: stage hunks",
            tone: "none",
        });
        expect(rowNote(row(tool("gitui"), "not-installed"), "win32").text).toBe("gitui purpose");
    });

    it("says where an install runs and that it failed, naming the package manager", () => {
        expect(rowNote(row(tool("glow"), "installing"), "win32")).toEqual({
            text: "Installing with winget",
            tone: "busy",
        });
        expect(rowNote(row(tool("glow"), "installing"), "darwin").text).toBe("Installing with brew");
        expect(rowNote(row(tool("k9s"), "failed"), "win32")).toEqual({
            text: "winget did not finish. The install terminal has its output.",
            tone: "error",
        });
    });

    it("falls back to the install itself when the system has no package manager of arcterm's knowing", () => {
        expect(rowNote(row(tool("glow"), "installing"), "linux").text).toBe("Installing");
        expect(rowNote(row(tool("k9s"), "failed"), "linux").text).toBe(
            "The install did not finish. The install terminal has its output."
        );
    });

    it("tells a yours tool that is not on PATH to check its command in settings", () => {
        expect(rowNote(row(tool("serpl"), "not-on-path"), "win32")).toEqual({
            text: "serpl is not on PATH. Check the command in settings.",
            tone: "error",
        });
    });
});

describe("openRefusal", () => {
    const row = (t: ToolStatus, state: PickerRow["state"]): PickerRow => ({ tool: t, state });

    it("tells a tool that is not installed how to get it", () => {
        expect(openRefusal(row(tool("gitui", { found: false }), "not-installed"), "win32")).toBe(
            "gitui is not installed. Press Ctrl I to install it."
        );
        expect(openRefusal(row(tool("gitui", { found: false, install: {} }), "not-installed"), "win32")).toBe(
            "gitui is not installed, and arcterm has no install command for it here."
        );
    });

    it("points an install under way or failed at its terminal", () => {
        expect(openRefusal(row(tool("glow", { found: false }), "installing"), "win32")).toBe(
            "glow is installing. Show opens its terminal."
        );
        expect(openRefusal(row(tool("k9s", { found: false }), "failed"), "win32")).toBe(
            "k9s did not install. Open output shows why."
        );
    });

    it("tells a yours tool that is not on PATH to check its command", () => {
        expect(openRefusal(row(tool("serpl", { found: false }), "not-on-path"), "win32")).toBe(
            "serpl is not on PATH. Check the command in settings."
        );
    });

    it("has nothing to say about a tool that is found", () => {
        expect(openRefusal(row(tool("lazygit"), "installed"), "win32")).toBeNull();
        expect(openRefusal(row(tool("lazygit"), "installing"), "win32")).toBeNull();
        expect(openRefusal(row(tool("pr"), "on-path"), "win32")).toBeNull();
    });
});

describe("footerHints", () => {
    const row = (t: ToolStatus, state: PickerRow["state"]): PickerRow => ({ tool: t, state });

    it("offers to open the selected tool, in the centre and in the panel", () => {
        expect(footerHints(row(tool("lazygit"), "installed"))).toEqual({
            open: "Open lazygit",
            panel: "Open in the panel",
            install: false,
        });
    });

    it("a yours tool that is on PATH opens too", () => {
        expect(footerHints(row(tool("pr-dashboard", { name: "PR dashboard" }), "on-path")).open).toBe(
            "Open PR dashboard"
        );
    });

    it("offers Install, not Open, on a tool that is not installed", () => {
        expect(footerHints(row(tool("gitui", { found: false }), "not-installed"))).toEqual({
            open: null,
            panel: null,
            install: true,
        });
    });

    it("offers neither on a tool being installed, one that failed or one not on PATH", () => {
        for (const state of ["installing", "failed", "not-on-path"] as const) {
            expect(footerHints(row(tool("x", { found: false }), state))).toEqual({
                open: null,
                panel: null,
                install: false,
            });
        }
    });

    it("still opens an installed tool while an update of it runs", () => {
        expect(footerHints(row(tool("lazygit"), "installing")).open).toBe("Open lazygit");
    });

    it("offers nothing with no row", () => {
        expect(footerHints(undefined)).toEqual({ open: null, panel: null, install: false });
    });
});

describe("pickerKey", () => {
    const rows: PickerRow[] = [
        { tool: tool("lazygit"), state: "installed" },
        { tool: tool("gitui"), state: "not-installed" },
        { tool: tool("k9s"), state: "failed" },
    ];
    const key = (k: string, mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => ({
        key: k,
        ...mods,
    });

    it("moves down and up, wrapping at the ends", () => {
        expect(pickerKey({ sel: 0, rows }, key("ArrowDown"))).toEqual({ kind: "move", sel: 1 });
        expect(pickerKey({ sel: 2, rows }, key("ArrowDown"))).toEqual({ kind: "move", sel: 0 });
        expect(pickerKey({ sel: 1, rows }, key("ArrowUp"))).toEqual({ kind: "move", sel: 0 });
        expect(pickerKey({ sel: 0, rows }, key("ArrowUp"))).toEqual({ kind: "move", sel: 2 });
    });

    it("clamps a stale selection before it moves", () => {
        expect(pickerKey({ sel: 9, rows }, key("ArrowDown"))).toEqual({ kind: "move", sel: 0 });
        expect(pickerKey({ sel: 9, rows }, key("ArrowUp"))).toEqual({ kind: "move", sel: 1 });
    });

    it("does not move over nothing", () => {
        expect(pickerKey({ sel: 0, rows: [] }, key("ArrowDown"))).toBeNull();
        expect(pickerKey({ sel: 0, rows: [] }, key("ArrowUp"))).toBeNull();
    });

    it("opens in the centre on Enter and in the panel on Shift+Enter", () => {
        expect(pickerKey({ sel: 0, rows }, key("Enter"))).toEqual({ kind: "open", place: "centre" });
        expect(pickerKey({ sel: 0, rows }, key("Enter", { shiftKey: true }))).toEqual({
            kind: "open",
            place: "panel",
        });
    });

    it("opens whatever row is selected: the dialog says why one that is not installed does not", () => {
        expect(pickerKey({ sel: 1, rows }, key("Enter"))).toEqual({ kind: "open", place: "centre" });
        expect(pickerKey({ sel: 2, rows }, key("Enter"))).toEqual({ kind: "open", place: "centre" });
    });

    it("opens nothing with no rows", () => {
        expect(pickerKey({ sel: 0, rows: [] }, key("Enter"))).toBeNull();
    });

    it("leaves Enter with Ctrl or Alt to the app", () => {
        expect(pickerKey({ sel: 0, rows }, key("Enter", { ctrlKey: true }))).toBeNull();
        expect(pickerKey({ sel: 0, rows }, key("Enter", { altKey: true }))).toBeNull();
    });

    it("installs on Ctrl+I over a row that is not installed, and only there", () => {
        expect(pickerKey({ sel: 1, rows }, key("i", { ctrlKey: true }))).toEqual({ kind: "install" });
        expect(pickerKey({ sel: 0, rows }, key("i", { ctrlKey: true }))).toBeNull();
        expect(pickerKey({ sel: 2, rows }, key("i", { ctrlKey: true }))).toBeNull();
    });

    it("takes Ctrl+I in upper case too, as Caps Lock types it", () => {
        expect(pickerKey({ sel: 1, rows }, key("I", { ctrlKey: true }))).toEqual({ kind: "install" });
    });

    it("types a bare i into the search", () => {
        expect(pickerKey({ sel: 1, rows }, key("i"))).toBeNull();
    });

    it("closes on Escape", () => {
        expect(pickerKey({ sel: 0, rows }, key("Escape"))).toEqual({ kind: "close" });
        expect(pickerKey({ sel: 0, rows: [] }, key("Escape"))).toEqual({ kind: "close" });
    });

    it("leaves every other key to the search box", () => {
        expect(pickerKey({ sel: 0, rows }, key("a"))).toBeNull();
        expect(pickerKey({ sel: 0, rows }, key("Backspace"))).toBeNull();
        expect(pickerKey({ sel: 0, rows }, key("Tab"))).toBeNull();
    });
});
