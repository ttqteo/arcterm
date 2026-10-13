// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DEFAULT_PINNED_TOOLS,
    installBlockMeta,
    installCommand,
    installOutcome,
    openToolRefusal,
    parsePinnedTools,
    pickerOrder,
    toolCommandLine,
    toolCwd,
    toolGroups,
    toolIcon,
    toolProjectName,
    toolTerminalName,
    withPinned,
} from "./toolsmodel";

function tool(id: string, over: Partial<ToolStatus> = {}): ToolStatus {
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

const catalog: ToolStatus[] = [
    tool("lazygit"),
    tool("gitui", { found: false }),
    tool("yazi", { category: "Files" }),
    tool("broot", { category: "Files", found: false }),
    tool("btop", { category: "System", opensin: "home" }),
    tool("glow", { category: "Docs and data", found: false }),
    tool("mytool", { category: "Yours", user: true }),
    tool("gone", { category: "Yours", user: true, found: false }),
];

const ids = (rows: { tool: ToolStatus }[]) => rows.map((r) => r.tool.id);

describe("toolGroups", () => {
    it("splits found, not found and yours, each in catalog order", () => {
        const g = toolGroups(catalog, {}, {});
        expect(ids(g.installed)).toEqual(["lazygit", "yazi", "btop"]);
        expect(ids(g.notInstalled)).toEqual(["gitui", "broot", "glow"]);
        expect(ids(g.yours)).toEqual(["mytool", "gone"]);
    });

    it("states a built-in tool by whether it was found", () => {
        const g = toolGroups(catalog, {}, {});
        expect(g.installed.every((r) => r.state === "installed")).toBe(true);
        expect(g.notInstalled.every((r) => r.state === "not-installed")).toBe(true);
    });

    it("reads a yours tool as on or not on PATH, found or not", () => {
        const g = toolGroups(catalog, {}, {});
        expect(g.yours.map((r) => r.state)).toEqual(["on-path", "not-on-path"]);
    });

    it("marks a tool with an install terminal running as installing, and keeps it in its group", () => {
        const g = toolGroups(catalog, { glow: "tab-1" }, {});
        expect(g.notInstalled.find((r) => r.tool.id === "glow")?.state).toBe("installing");
        expect(g.notInstalled.find((r) => r.tool.id === "gitui")?.state).toBe("not-installed");
    });

    it("marks a tool whose last install failed as failed", () => {
        const g = toolGroups(catalog, {}, { broot: "tab-2" });
        expect(g.notInstalled.find((r) => r.tool.id === "broot")?.state).toBe("failed");
    });

    it("an update running over an installed tool reads installing, still in Installed", () => {
        const g = toolGroups(catalog, { lazygit: "tab-3" }, {});
        expect(g.installed.find((r) => r.tool.id === "lazygit")?.state).toBe("installing");
    });

    it("a built-in the user overrode stays in its category, not in yours", () => {
        const overridden = [tool("lazygit", { user: true }), tool("gitui", { found: false })];
        const g = toolGroups(overridden, {}, {});
        expect(ids(g.installed)).toEqual(["lazygit"]);
        expect(g.yours).toEqual([]);
    });

    it("is empty for no statuses", () => {
        expect(toolGroups([], {}, {})).toEqual({ installed: [], notInstalled: [], yours: [] });
    });
});

describe("pickerOrder", () => {
    it("lists pinned installed first, then other installed, then yours, then two not installed", () => {
        const order = pickerOrder(catalog, ["btop"]).map((t) => t.id);
        expect(order).toEqual(["btop", "lazygit", "yazi", "mytool", "gone", "gitui", "broot"]);
    });

    it("keeps pinned tools in catalog order", () => {
        const order = pickerOrder(catalog, ["yazi", "lazygit"]).map((t) => t.id);
        expect(order.slice(0, 2)).toEqual(["lazygit", "yazi"]);
    });

    it("ignores a pinned tool that is not installed (it sits with the not installed)", () => {
        const order = pickerOrder(catalog, ["glow"]).map((t) => t.id);
        expect(order.slice(0, 3)).toEqual(["lazygit", "yazi", "btop"]);
        expect(order).toContain("gitui");
        expect(order).not.toContain("glow");
    });

    it("never offers more than two not installed", () => {
        const many = [tool("a", { found: false }), tool("b", { found: false }), tool("c", { found: false })];
        expect(pickerOrder(many, []).map((t) => t.id)).toEqual(["a", "b"]);
    });

    it("with nothing pinned lists installed in catalog order", () => {
        expect(
            pickerOrder(catalog, [])
                .slice(0, 3)
                .map((t) => t.id)
        ).toEqual(["lazygit", "yazi", "btop"]);
    });
});

describe("toolCwd", () => {
    const ctx = { agentCwd: "/code/p/.wt/fix", projectRoot: "/code/p", home: "/home/u" };
    it("agent: the agent's folder, else the project root, else home", () => {
        expect(toolCwd(tool("a", { opensin: "agent" }), ctx)).toBe("/code/p/.wt/fix");
        expect(toolCwd(tool("a", { opensin: "agent" }), { ...ctx, agentCwd: undefined })).toBe("/code/p");
        expect(toolCwd(tool("a", { opensin: "agent" }), { home: "/home/u" })).toBe("/home/u");
    });
    it("root: the project root, else home, never the agent's folder", () => {
        expect(toolCwd(tool("a", { opensin: "root" }), ctx)).toBe("/code/p");
        expect(toolCwd(tool("a", { opensin: "root" }), { agentCwd: "/x", home: "/home/u" })).toBe("/home/u");
    });
    it("home: home", () => {
        expect(toolCwd(tool("a", { opensin: "home" }), ctx)).toBe("/home/u");
    });
    it("an empty folder counts as missing", () => {
        expect(toolCwd(tool("a", { opensin: "agent" }), { agentCwd: "", projectRoot: "", home: "~" })).toBe("~");
    });
    it("an unknown opensin reads as agent", () => {
        expect(toolCwd(tool("a", { opensin: "weird" }), ctx)).toBe("/code/p/.wt/fix");
    });
});

describe("toolProjectName", () => {
    it("a tool that opens in the agent's folder or the project root belongs to the project", () => {
        expect(toolProjectName(tool("a", { opensin: "agent" }), "arcterm", "Home")).toBe("arcterm");
        expect(toolProjectName(tool("a", { opensin: "root" }), "arcterm", "Home")).toBe("arcterm");
    });
    it("a tool that opens in Home belongs to Home, whatever project it was opened from", () => {
        expect(toolProjectName(tool("btop", { opensin: "home" }), "arcterm", "Home")).toBe("Home");
    });
    it("with no project it is Home's", () => {
        expect(toolProjectName(tool("a", { opensin: "agent" }), undefined, "Home")).toBe("Home");
        expect(toolProjectName(tool("a", { opensin: "agent" }), "", "Home")).toBe("Home");
    });
});

describe("toolCommandLine", () => {
    it("is the command alone, or the command with its args", () => {
        expect(toolCommandLine(tool("lazygit"))).toBe("lazygit");
        expect(toolCommandLine(tool("k9s", { args: "--readonly" }))).toBe("k9s --readonly");
        expect(toolCommandLine(tool("k9s", { args: "  " }))).toBe("k9s");
    });
});

describe("installCommand", () => {
    const t = tool("glow", { install: { windows: "winget install glow", darwin: "brew install glow" } });
    it("picks the platform's line", () => {
        expect(installCommand(t, "win32")).toBe("winget install glow");
        expect(installCommand(t, "darwin")).toBe("brew install glow");
    });
    it("is undefined where the tool has no line, or the OS has none", () => {
        expect(
            installCommand(tool("visidata", { install: { darwin: "brew install visidata" } }), "win32")
        ).toBeUndefined();
        expect(installCommand(t, "linux")).toBeUndefined();
        expect(installCommand(tool("x", { install: {} }), "darwin")).toBeUndefined();
    });
});

describe("toolTerminalName", () => {
    const tools = [
        tool("lazygit"),
        tool("k9s", { name: "k9s", args: "--readonly" }),
        tool("visidata", { command: "vd" }),
    ];
    it("a terminal with no tool keeps its own name", () => {
        expect(toolTerminalName({ name: "npm run dev" }, tools)).toBe("npm run dev");
    });
    it("a tool terminal still on its launch shows the tool's name", () => {
        expect(toolTerminalName({ name: "lazygit", toolId: "lazygit" }, tools)).toBe("lazygit");
        expect(toolTerminalName({ name: "vd", toolId: "visidata" }, tools)).toBe("visidata");
        expect(toolTerminalName({ name: "k9s --readonly", toolId: "k9s" }, tools)).toBe("k9s");
    });
    it("the placeholder before any command reads as the tool", () => {
        expect(toolTerminalName({ name: "Terminal 3", toolId: "visidata" }, tools)).toBe("visidata");
    });
    it("a rename, or the last command once the tool quit, wins", () => {
        expect(toolTerminalName({ name: "git work", toolId: "lazygit" }, tools)).toBe("git work");
        expect(toolTerminalName({ name: "ls -la", toolId: "lazygit" }, tools)).toBe("ls -la");
    });
    it("a tool id the catalog no longer has falls back to the terminal's name", () => {
        expect(toolTerminalName({ name: "Terminal 2", toolId: "removed" }, tools)).toBe("Terminal 2");
    });
});

describe("toolIcon", () => {
    it("names an icon per category", () => {
        expect(toolIcon(tool("a", { category: "Git" }))).toBe("git-branch");
        expect(toolIcon(tool("a", { category: "Files" }))).toBe("folder");
        expect(toolIcon(tool("a", { category: "System" }))).toBe("activity");
        expect(toolIcon(tool("a", { category: "Containers" }))).toBe("container");
        expect(toolIcon(tool("a", { category: "Docs and data" }))).toBe("book-open");
        expect(toolIcon(tool("a", { category: "Yours" }))).toBe("wrench");
    });
    it("an unknown category gets the wrench, and no tool the terminal icon", () => {
        expect(toolIcon(tool("a", { category: "Whatever" }))).toBe("wrench");
        expect(toolIcon(undefined)).toBe("terminal");
    });
});

describe("openToolRefusal", () => {
    it("lets a tool found on PATH open", () => {
        expect(openToolRefusal(tool("lazygit"))).toBeNull();
    });
    it("refuses one whose command was not found, with the reason the UI shows", () => {
        expect(openToolRefusal(tool("gitui", { found: false }))).toBe("gitui is not on PATH");
        expect(openToolRefusal(tool("vd", { found: false, name: "visidata", command: "vd" }))).toBe(
            "visidata is not on PATH"
        );
    });
});

describe("installBlockMeta", () => {
    it("runs the install line through a shell and closes on exit 0 only", () => {
        expect(installBlockMeta("winget install --id x -e", "/code/p")).toEqual({
            view: "term",
            controller: "cmd",
            cmd: "winget install --id x -e",
            "cmd:shell": true,
            "cmd:closeonexit": true,
            "cmd:cwd": "/code/p",
        });
    });
    it("trims the line", () => {
        expect(installBlockMeta("  brew install glow ", "~").cmd).toBe("brew install glow");
    });
});

describe("installOutcome", () => {
    it("is running until the process is done", () => {
        expect(installOutcome(undefined)).toBe("running");
        expect(installOutcome({ shellprocstatus: "init", shellprocexitcode: 0 })).toBe("running");
        expect(installOutcome({ shellprocstatus: "running", shellprocexitcode: 0 })).toBe("running");
    });
    it("done with exit 0 is ok, any other code is failed", () => {
        expect(installOutcome({ shellprocstatus: "done", shellprocexitcode: 0 })).toBe("ok");
        expect(installOutcome({ shellprocstatus: "done", shellprocexitcode: 1 })).toBe("failed");
        expect(installOutcome({ shellprocstatus: "done", shellprocexitcode: -1 })).toBe("failed");
    });
});

describe("parsePinnedTools", () => {
    it("falls back to the default for nothing stored or junk", () => {
        expect(parsePinnedTools(null)).toEqual(DEFAULT_PINNED_TOOLS);
        expect(parsePinnedTools("not json")).toEqual(DEFAULT_PINNED_TOOLS);
        expect(parsePinnedTools('{"a":1}')).toEqual(DEFAULT_PINNED_TOOLS);
    });
    it("keeps a stored list, dropping non-strings and duplicates, and an emptied list stays empty", () => {
        expect(parsePinnedTools('["yazi","yazi",3,"btop"]')).toEqual(["yazi", "btop"]);
        expect(parsePinnedTools("[]")).toEqual([]);
    });
    it("defaults to lazygit, yazi and btop", () => {
        expect(DEFAULT_PINNED_TOOLS).toEqual(["lazygit", "yazi", "btop"]);
    });
});

describe("withPinned", () => {
    it("pins a tool once, leaving a tool already pinned where it is", () => {
        expect(withPinned(["lazygit"], "yazi", true)).toEqual(["lazygit", "yazi"]);
        expect(withPinned(["lazygit", "yazi"], "lazygit", true)).toEqual(["lazygit", "yazi"]);
    });
    it("unpins a tool, and unpinning one that is not pinned changes nothing", () => {
        expect(withPinned(["lazygit", "yazi"], "lazygit", false)).toEqual(["yazi"]);
        expect(withPinned(["yazi"], "btop", false)).toEqual(["yazi"]);
    });
    it("does not change the list it is given", () => {
        const pinned = ["yazi"];
        withPinned(pinned, "btop", true);
        expect(pinned).toEqual(["yazi"]);
    });
});
