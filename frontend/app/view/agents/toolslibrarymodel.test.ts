// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    commandCheck,
    emptyForm,
    formFromTool,
    formKeywords,
    foundLine,
    headerSummary,
    installPanel,
    libraryRows,
    needsRestartHint,
    overrideKeywords,
    selectedTool,
    splitCommandLine,
    stateTone,
    statusLabel,
    toolIdFrom,
    uniqueToolId,
    validateNewTool,
} from "./toolslibrarymodel";

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
    tool("btop", { category: "System", opensin: "home" }),
    tool("k9s", { category: "Containers", found: false }),
    tool("glow", { category: "Docs and data", found: false }),
    tool("mytool", { category: "Yours", user: true, install: {} }),
    tool("gone", { category: "Yours", user: true, found: false, install: {} }),
];

describe("libraryRows", () => {
    it("groups by category in the library's order, each group in catalog order", () => {
        const groups = libraryRows(catalog, {}, {});
        expect(groups.map((g) => g.category)).toEqual([
            "Git",
            "Files",
            "System",
            "Containers",
            "Docs and data",
            "Yours",
        ]);
        expect(groups[0].rows.map((r) => r.tool.id)).toEqual(["lazygit", "gitui"]);
        expect(groups[5].rows.map((r) => r.tool.id)).toEqual(["mytool", "gone"]);
    });

    it("orders the categories whatever order the catalog lists them in", () => {
        const shuffled = [catalog[6], catalog[4], catalog[0]];
        expect(libraryRows(shuffled, {}, {}).map((g) => g.category)).toEqual(["Git", "Containers", "Yours"]);
    });

    it("leaves out a category with no tools", () => {
        expect(libraryRows([tool("yazi", { category: "Files" })], {}, {}).map((g) => g.category)).toEqual(["Files"]);
    });

    it("puts a category the library does not know before Yours rather than dropping it", () => {
        const odd = [tool("mytool", { category: "Yours", user: true }), tool("x", { category: "Network" })];
        expect(libraryRows(odd, {}, {}).map((g) => g.category)).toEqual(["Network", "Yours"]);
    });

    it("gives each row its status word", () => {
        const rows = libraryRows(catalog, {}, {}).flatMap((g) => g.rows);
        const word = (id: string) => rows.find((r) => r.tool.id === id)?.word;
        expect(word("lazygit")).toBe("installed");
        expect(word("gitui")).toBe("not installed");
        expect(word("mytool")).toBe("on PATH");
        expect(word("gone")).toBe("not on PATH");
    });

    it("says installing and install failed over the found state", () => {
        const rows = libraryRows(catalog, { glow: "tab-1" }, { k9s: "tab-2" }).flatMap((g) => g.rows);
        expect(rows.find((r) => r.tool.id === "glow")).toMatchObject({ state: "installing", word: "installing" });
        expect(rows.find((r) => r.tool.id === "k9s")).toMatchObject({ state: "failed", word: "install failed" });
    });

    it("narrows to the tools a query matches in name, command, purpose or category, ignoring case", () => {
        const withPurpose = [
            tool("lazygit", { purpose: "Git: stage single lines" }),
            tool("vd", { name: "visidata", category: "Docs and data", command: "vd", purpose: "Explore CSV" }),
            tool("yazi", { category: "Files", purpose: "browse" }),
        ];
        const ids = (q: string) =>
            libraryRows(withPurpose, {}, {}, q)
                .flatMap((g) => g.rows)
                .map((r) => r.tool.id);
        expect(ids("LAZY")).toEqual(["lazygit"]);
        expect(ids("csv")).toEqual(["vd"]);
        expect(ids("files")).toEqual(["yazi"]);
        expect(ids("  vd ")).toEqual(["vd"]);
        expect(ids("")).toEqual(["lazygit", "yazi", "vd"]);
        expect(libraryRows(withPurpose, {}, {}, "nothing like it")).toEqual([]);
    });
});

describe("statusLabel and stateTone", () => {
    it("capitalises the status word for the detail's title line", () => {
        expect(statusLabel("installed")).toBe("Installed");
        expect(statusLabel("failed")).toBe("Install failed");
        expect(statusLabel("not-on-path")).toBe("Not on PATH");
    });

    it("tones a state: found is ok, a running install is busy, a failure is an error, not installed is plain", () => {
        expect(stateTone("installed")).toBe("ok");
        expect(stateTone("on-path")).toBe("ok");
        expect(stateTone("installing")).toBe("busy");
        expect(stateTone("failed")).toBe("error");
        expect(stateTone("not-on-path")).toBe("error");
        expect(stateTone("not-installed")).toBe("none");
    });
});

describe("headerSummary", () => {
    it("counts the built-in tools found and the built-in tools in all; yours are not in the library's count", () => {
        expect(headerSummary(catalog)).toBe("3 installed · 6 in the library");
    });

    it("names the package manager of this system when asked", () => {
        expect(headerSummary(catalog, "win32")).toBe("3 installed · 6 in the library · installs with winget");
        expect(headerSummary(catalog, "darwin")).toBe("3 installed · 6 in the library · installs with brew");
        expect(headerSummary(catalog, "linux")).toBe("3 installed · 6 in the library");
    });

    it("counts an overridden built-in with the library, not with yours", () => {
        expect(headerSummary([tool("lazygit", { user: true })])).toBe("1 installed · 1 in the library");
    });
});

describe("selectedTool", () => {
    it("is the tool selected", () => {
        expect(selectedTool(catalog, "yazi")?.id).toBe("yazi");
    });

    it("falls back to the first row the list shows when nothing, or a tool that is gone, is selected", () => {
        expect(selectedTool(catalog, null)?.id).toBe("lazygit");
        expect(selectedTool(catalog, "removed")?.id).toBe("lazygit");
        expect(selectedTool([catalog[6], catalog[2]], null)?.id).toBe("yazi");
    });

    it("is null with no tools", () => {
        expect(selectedTool([], "yazi")).toBeNull();
    });
});

describe("validateNewTool", () => {
    it("asks for a name first, then a command", () => {
        expect(validateNewTool({ name: "", command: "" })).toBe("Add a name");
        expect(validateNewTool({ name: "  ", command: "gh dash" })).toBe("Add a name");
        expect(validateNewTool({ name: "PR dashboard", command: " " })).toBe("Add a command");
    });

    it("is null when both are there", () => {
        expect(validateNewTool({ name: "PR dashboard", command: "gh dash" })).toBeNull();
    });
});

describe("toolIdFrom and uniqueToolId", () => {
    it("makes a lowercase slug", () => {
        expect(toolIdFrom("PR dashboard")).toBe("pr-dashboard");
        expect(toolIdFrom("  Lazy_Git!! v2 ")).toBe("lazy-git-v2");
        expect(toolIdFrom("k9s")).toBe("k9s");
    });

    it("has a slug for a name made only of symbols", () => {
        expect(toolIdFrom("???")).toBe("tool");
    });

    it("never takes an id a tool already has, so a new tool cannot override a built-in", () => {
        expect(uniqueToolId("lazygit", ["lazygit", "yazi"])).toBe("lazygit-2");
        expect(uniqueToolId("lazygit", ["lazygit", "lazygit-2"])).toBe("lazygit-3");
        expect(uniqueToolId("PR dashboard", ["lazygit"])).toBe("pr-dashboard");
    });
});

describe("foundLine", () => {
    it("says where the command was found", () => {
        expect(foundLine(tool("lazygit", { path: "C:\\bin\\lazygit.exe" }))).toBe("found at C:\\bin\\lazygit.exe");
    });

    it("says found when the backend gave no path, and not found otherwise", () => {
        expect(foundLine(tool("lazygit"))).toBe("found on PATH");
        expect(foundLine(tool("gitui", { found: false }))).toBe("not found on PATH");
    });
});

describe("installPanel", () => {
    const lazygit = tool("lazygit");

    it("shows this system's line and the other system's as a note, with Install for a tool not found", () => {
        const p = installPanel(tool("lazygit", { found: false }), "not-installed", "win32");
        expect(p.line).toBe("winget install lazygit");
        expect(p.note).toBe("brew install lazygit on a Mac");
        expect(p.buttons).toEqual(["install"]);
    });

    it("notes the Windows line on a Mac", () => {
        expect(installPanel(lazygit, "installed", "darwin").note).toBe("winget install lazygit on Windows");
    });

    it("offers Update for a tool that is found", () => {
        expect(installPanel(lazygit, "installed", "win32").buttons).toEqual(["update"]);
    });

    it("offers Open output while it installs, and Open output with Try again when it failed", () => {
        expect(installPanel(lazygit, "installing", "win32").buttons).toEqual(["open-output"]);
        expect(installPanel(lazygit, "failed", "win32").buttons).toEqual(["open-output", "retry"]);
    });

    it("has no button, and no line, for a system the tool has no install command for", () => {
        const visidata = tool("visidata", { found: false, install: { darwin: "brew install visidata" } });
        const p = installPanel(visidata, "not-installed", "win32");
        expect(p.line).toBeUndefined();
        expect(p.note).toBe("brew install visidata on a Mac");
        expect(p.buttons).toEqual([]);
    });

    it("has nothing for a yours tool with no install command", () => {
        const p = installPanel(tool("mytool", { install: {}, user: true }), "on-path", "win32");
        expect(p).toEqual({ line: undefined, note: undefined, buttons: [] });
    });

    it("still offers Open output on a tool whose install ran here and has no line", () => {
        const p = installPanel(tool("mytool", { install: {}, user: true }), "failed", "win32");
        expect(p.buttons).toEqual(["open-output", "retry"]);
    });
});

describe("needsRestartHint", () => {
    it("is for a tool an install ended on that is still not found", () => {
        const gitui = tool("gitui", { found: false });
        expect(needsRestartHint(gitui, "not-installed", ["gitui"])).toBe(true);
    });

    it("is not for a tool that was found, one still installing or failed, or one no install ended on", () => {
        const found = tool("gitui");
        const missing = tool("gitui", { found: false });
        expect(needsRestartHint(found, "installed", ["gitui"])).toBe(false);
        expect(needsRestartHint(missing, "installing", ["gitui"])).toBe(false);
        expect(needsRestartHint(missing, "failed", ["gitui"])).toBe(false);
        expect(needsRestartHint(missing, "not-installed", ["other"])).toBe(false);
    });
});

describe("overrideKeywords", () => {
    it("writes a built-in's change over the entry it already has, so nothing else it overrides is lost", () => {
        const lazygit = tool("lazygit");
        const current: ToolKeywords = { command: "lazygit", purpose: "mine" };
        expect(overrideKeywords(lazygit, current, { opensin: "root" })).toEqual({
            command: "lazygit",
            purpose: "mine",
            opensin: "root",
        });
    });

    it("gives a built-in with no entry its command, since the entry needs one", () => {
        expect(overrideKeywords(tool("lazygit"), undefined, { shows: "panel" })).toEqual({
            command: "lazygit",
            shows: "panel",
        });
    });

    it("rebuilds a yours tool whole from its status, so a change loses none of its fields", () => {
        const mine = tool("pr", {
            category: "Yours",
            user: true,
            name: "PR dashboard",
            command: "gh",
            args: "dash",
            purpose: "my prs",
            opensin: "root",
            shows: "centre",
            install: { windows: "winget install gh" },
        });
        expect(overrideKeywords(mine, undefined, { shows: "panel" })).toEqual({
            name: "PR dashboard",
            command: "gh",
            args: "dash",
            purpose: "my prs",
            opensin: "root",
            shows: "panel",
            "install:windows": "winget install gh",
        });
    });
});

describe("the add and edit form", () => {
    it("starts empty, opening in the agent's folder and showing in the centre", () => {
        expect(emptyForm()).toEqual({
            id: null,
            name: "",
            command: "",
            opensin: "agent",
            shows: "centre",
            install: "",
            purpose: "",
        });
    });

    it("is prefilled from a yours tool, with this system's install line", () => {
        const mine = tool("pr", {
            category: "Yours",
            user: true,
            name: "PR dashboard",
            command: "gh",
            args: "dash",
            purpose: "prs",
            opensin: "root",
            install: { windows: "winget install gh", darwin: "brew install gh" },
        });
        expect(formFromTool(mine, "win32")).toEqual({
            id: "pr",
            name: "PR dashboard",
            command: "gh dash",
            opensin: "root",
            shows: "centre",
            install: "winget install gh",
            purpose: "prs",
        });
        expect(formFromTool(mine, "darwin").install).toBe("brew install gh");
    });

    it("saves the fields trimmed, leaving out the ones left empty", () => {
        const form = { ...emptyForm(), name: " PR dashboard ", command: " gh dash ", opensin: "root" };
        expect(formKeywords(form, "win32", {})).toEqual({
            name: "PR dashboard",
            command: "gh",
            args: "dash",
            opensin: "root",
            shows: "centre",
        });
    });

    it("saves the install line under this system's key and keeps the other system's line", () => {
        const form = { ...emptyForm(), name: "gh", command: "gh", install: " gh extension install x " };
        expect(formKeywords(form, "win32", { darwin: "brew install gh" })).toMatchObject({
            "install:windows": "gh extension install x",
            "install:darwin": "brew install gh",
        });
        expect(formKeywords(form, "darwin", { windows: "winget install gh" })).toMatchObject({
            "install:darwin": "gh extension install x",
            "install:windows": "winget install gh",
        });
    });

    it("drops this system's install line when it is emptied", () => {
        const form = { ...emptyForm(), name: "gh", command: "gh", install: "" };
        expect(formKeywords(form, "win32", { windows: "old" })).not.toHaveProperty("install:windows");
    });

    it("splits the line into the program, which is looked up on PATH, and its arguments", () => {
        const form = { ...emptyForm(), name: "PR dashboard", command: "  gh   dash --repo x " };
        expect(formKeywords(form, "win32", {})).toMatchObject({ command: "gh", args: "dash --repo x" });
        expect(formKeywords({ ...form, command: "lazygit" }, "win32", {})).not.toHaveProperty("args");
    });

    it("keeps the purpose an edit started with", () => {
        const form = { ...emptyForm(), id: "pr", name: "PR", command: "gh", purpose: "prs" };
        expect(formKeywords(form, "win32", {})).toMatchObject({ purpose: "prs" });
    });
});

describe("splitCommandLine", () => {
    it("is the first word and the rest", () => {
        expect(splitCommandLine("gh dash")).toEqual({ command: "gh", args: "dash" });
        expect(splitCommandLine("  lazygit ")).toEqual({ command: "lazygit", args: "" });
        expect(splitCommandLine("")).toEqual({ command: "", args: "" });
    });
});

describe("commandCheck", () => {
    it("answers for the command the status has looked up", () => {
        expect(commandCheck("gh dash", { command: "gh", found: true })).toEqual({ ok: true, text: "gh is on PATH" });
        expect(commandCheck("serpl", { command: "serpl", found: false })).toEqual({
            ok: false,
            text: "serpl is not on PATH",
        });
    });

    it("has no answer for an edited command, a new tool or an empty line", () => {
        expect(commandCheck("gh2", { command: "gh", found: true })).toBeNull();
        expect(commandCheck("gh", null)).toBeNull();
        expect(commandCheck("  ", { command: "gh", found: true })).toBeNull();
    });
});
