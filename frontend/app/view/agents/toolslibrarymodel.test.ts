// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RAIL_FULL_TITLE } from "./railapps";
import {
    commandCheck,
    emptyForm,
    formFromTool,
    formKeywords,
    foundLine,
    foundRows,
    headerSummary,
    initialChoice,
    installPanel,
    libraryRows,
    needsRestartHint,
    overrideKeywords,
    reduceChoice,
    selectedTool,
    splitCommandLine,
    stateTone,
    statusLabel,
    toolIdFrom,
    toolRailPin,
    toolServiceStatus,
    uniqueToolId,
    validateNewTool,
    type ChoiceEvent,
    type ChoiceState,
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

    it("counts the suggestions found on this machine before the package manager", () => {
        expect(headerSummary(catalog, "win32", 2)).toBe(
            "3 installed · 6 in the library · 2 found · installs with winget"
        );
        expect(headerSummary(catalog, "win32", 0)).toBe("3 installed · 6 in the library · installs with winget");
    });
});

describe("foundRows", () => {
    const suggestions = [
        tool("ncdu", { category: "System", detected: true, purpose: "Disk: see what fills a folder" }),
        tool("tig", { detected: true }),
        tool("htop", { category: "System", detected: true }),
    ];

    it("keeps the suggestions in catalog order, minus the hidden ones", () => {
        expect(foundRows(suggestions, ["tig"]).map((t) => t.id)).toEqual(["ncdu", "htop"]);
    });

    it("matches the query as the library's search does", () => {
        expect(foundRows(suggestions, [], "disk").map((t) => t.id)).toEqual(["ncdu"]);
        expect(foundRows(suggestions, [], " SYSTEM ").map((t) => t.id)).toEqual(["ncdu", "htop"]);
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
    it("takes an empty page when a free port is picked", () => {
        expect(validateNewTool({ name: "docs", command: "npm run dev", url: "", autoPort: true })).toBeNull();
    });

    it("asks for a name first, then a command", () => {
        expect(validateNewTool({ name: "", command: "" })).toBe("Add a name");
        expect(validateNewTool({ name: "  ", command: "gh dash" })).toBe("Add a name");
        expect(validateNewTool({ name: "PR dashboard", command: " " })).toBe("Add a command");
    });

    it("is null when both are there", () => {
        expect(validateNewTool({ name: "PR dashboard", command: "gh dash" })).toBeNull();
        expect(validateNewTool({ name: "Hong", command: "npm run dash", url: "http://127.0.0.1:8386" })).toBeNull();
        expect(validateNewTool({ name: "Hong", command: "npm run dash", url: "http://localhost:8386" })).toMatch(
            /127\.0\.0\.1/
        );
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
            url: "",
            dir: "",
            autoPort: false,
            autostart: false,
        });
        expect(emptyForm().autostart).toBe(false);
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
            url: "",
            dir: "",
            autoPort: false,
            autostart: false,
        });
        expect(formFromTool(mine, "darwin").install).toBe("brew install gh");
    });

    it("keeps a pinned app's page and folder through an edit and a save", () => {
        const app = tool("hong", {
            category: "Yours",
            user: true,
            command: "npm",
            args: "run dash",
            url: "http://127.0.0.1:8386",
            dir: "~/dev/hong",
        });
        const form = formFromTool(app, "darwin");
        expect(form).toMatchObject({ url: "http://127.0.0.1:8386", dir: "~/dev/hong" });
        expect(formKeywords({ ...form, url: " http://127.0.0.1:8386 " }, "darwin", {})).toMatchObject({
            command: "npm",
            args: "run dash",
            url: "http://127.0.0.1:8386",
            dir: "~/dev/hong",
        });
        expect(overrideKeywords(app, undefined, { shows: "panel" })).toMatchObject({
            url: "http://127.0.0.1:8386",
            dir: "~/dev/hong",
        });
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

    it("writes port auto and no url for a free port", () => {
        const form = { ...emptyForm(), name: "docs", command: "npm run dev", url: "", autoPort: true };
        const kw = formKeywords(form, "darwin", {});
        expect(kw).toMatchObject({ name: "docs", command: "npm", args: "run dev", port: "auto" });
        expect(kw).not.toHaveProperty("url");
        expect(formKeywords({ ...form, url: "http://127.0.0.1:8386" }, "darwin", {})).not.toHaveProperty("url");
    });

    it("writes no port key for a fixed page", () => {
        const form = { ...emptyForm(), name: "hong", command: "npm run dash", url: "http://127.0.0.1:8386" };
        expect(formKeywords(form, "darwin", {})).not.toHaveProperty("port");
    });

    it("writes autostart only when Keep running is on", () => {
        const form = { ...emptyForm(), name: "hong", command: "npm run dash", url: "http://127.0.0.1:8386" };
        expect(formKeywords({ ...form, autostart: true }, "darwin", {})).toMatchObject({ autostart: true });
        expect(formKeywords({ ...form, autostart: false }, "darwin", {})).not.toHaveProperty("autostart");
    });

    it("reads a free port and Keep running back from a tool", () => {
        const auto = tool("docs", { category: "Yours", user: true, command: "npm", port: "auto", autostart: true });
        expect(formFromTool(auto, "darwin")).toMatchObject({ autoPort: true, autostart: true, url: "" });
        const fixed = tool("hong", { category: "Yours", user: true, command: "npm", url: "http://127.0.0.1:8386" });
        expect(formFromTool(fixed, "darwin")).toMatchObject({ autoPort: false });
    });

    it("reads a free port as off when the tool also has a url, since the url wins", () => {
        const both = tool("docs", {
            category: "Yours",
            user: true,
            command: "npm",
            port: "auto",
            url: "http://127.0.0.1:8386",
            autostart: true,
        });
        expect(formFromTool(both, "darwin")).toMatchObject({ autoPort: false, url: "http://127.0.0.1:8386" });
        expect(formKeywords(formFromTool(both, "darwin"), "darwin", {})).toMatchObject({
            url: "http://127.0.0.1:8386",
        });
        expect(formKeywords(formFromTool(both, "darwin"), "darwin", {})).not.toHaveProperty("port");
    });

    it("reads Keep running as off for a tool with no page, and a save writes no autostart", () => {
        const plain = tool("pr", { category: "Yours", user: true, command: "gh" });
        expect(formFromTool(plain, "darwin").autostart).toBe(false);
        expect(formKeywords(formFromTool(plain, "darwin"), "darwin", {})).not.toHaveProperty("autostart");
    });

    it("reads Keep running as off for a service whose status has no autostart", () => {
        const app = tool("hong", { category: "Yours", user: true, command: "npm", url: "http://127.0.0.1:8386" });
        expect(formFromTool(app, "darwin").autostart).toBe(false);
    });

    it("keeps a plain tool's autostart default when the edit adds a page", () => {
        const plain = tool("pr", { category: "Yours", user: true, command: "gh" });
        const withFreePort = { ...formFromTool(plain, "darwin"), autoPort: true };
        const kw = formKeywords(withFreePort, "darwin", {});
        expect(kw).toMatchObject({ port: "auto" });
        expect(kw).not.toHaveProperty("autostart");
        const withUrl = { ...formFromTool(plain, "darwin"), url: "http://127.0.0.1:8386" };
        expect(formKeywords(withUrl, "darwin", {})).not.toHaveProperty("autostart");
    });

    it("keeps a free port and Keep running when only Opens in changes", () => {
        const on = tool("docs", { category: "Yours", user: true, command: "npm", port: "auto", autostart: true });
        expect(overrideKeywords(on, undefined, { shows: "panel" })).toMatchObject({
            port: "auto",
            autostart: true,
        });
        const off = tool("docs", { category: "Yours", user: true, command: "npm", port: "auto", autostart: false });
        expect(overrideKeywords(off, undefined, { shows: "panel" })).not.toHaveProperty("autostart");
        const page = tool("hong", { category: "Yours", user: true, command: "npm", url: "http://127.0.0.1:8386" });
        expect(overrideKeywords(page, undefined, { shows: "panel" })).not.toHaveProperty("autostart");
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

function service(state: string, over: Partial<ServiceStatus> = {}): ServiceStatus {
    return {
        id: "dash",
        name: "Dash",
        command: "npm run dev",
        dir: "~/dash",
        project: "dash",
        state,
        autostart: false,
        ...over,
    };
}

describe("toolServiceStatus", () => {
    const now = 1_000_000;

    it("running: the port, in the working tone, with Stop and Restart on offer", () => {
        expect(toolServiceStatus(service("running", { port: 5173 }), now)).toEqual({
            words: ":5173",
            tone: "working",
            dot: "solid",
            canStop: true,
            canRestart: true,
        });
    });

    it("sleeping: says it starts when opened, and has no button", () => {
        expect(toolServiceStatus(service("sleeping"), now)).toEqual({
            words: "sleeping · starts when opened",
            tone: "muted",
            dot: "hollow",
            canStop: false,
            canRestart: false,
        });
    });

    it("crashed: the exit code in the error tone, Restart but no Stop", () => {
        expect(toolServiceStatus(service("crashed", { exitcode: 2 }), now)).toEqual({
            words: "crashed · exit 2",
            tone: "error",
            dot: "solid",
            canStop: false,
            canRestart: true,
        });
    });

    it("retrying: counts down to the next try, and can still be stopped", () => {
        const s = toolServiceStatus(service("retrying", { retryatms: now + 4_200 }), now);
        expect(s.words).toBe("crashed · retry in 5s");
        expect(s.tone).toBe("error");
        expect(s.canStop).toBe(true);
        expect(s.canRestart).toBe(true);
    });

    it("starting: the pulsing dot, and Stop", () => {
        const s = toolServiceStatus(service("starting"), now);
        expect(s.words).toBe("starting…");
        expect(s.dot).toBe("pulse");
        expect(s.canStop).toBe(true);
    });

    it("a page answered by a program arcterm did not start has the port and no button", () => {
        expect(toolServiceStatus(service("elsewhere", { port: 5173 }), now)).toEqual({
            words: "not started by arcterm · :5173",
            tone: "working",
            dot: "hollow",
            canStop: false,
            canRestart: false,
        });
    });

    it("a taken port names its holder, in the warning tone", () => {
        const s = toolServiceStatus(service("porttaken", { port: 5173, holder: "node.exe" }), now);
        expect(s.words).toBe("5173 is held by node.exe");
        expect(s.tone).toBe("warning");
    });

    it("no status from wavesrv yet: not started, in the muted tone, no button", () => {
        for (const none of [undefined, null]) {
            expect(toolServiceStatus(none, now)).toEqual({
                words: "not started yet",
                tone: "muted",
                dot: "hollow",
                canStop: false,
                canRestart: false,
            });
        }
    });
});

describe("toolRailPin", () => {
    const list = ["a", "b", "c", "d"].map((id) => service("sleeping", { id, name: id }));

    it("is on when the rail holds the tool", () => {
        expect(toolRailPin("b", ["a", "b"], list)).toEqual({ on: true, disabled: false });
    });

    it("is off, and free to turn on, while the rail has room", () => {
        expect(toolRailPin("c", ["a", "b"], list)).toEqual({ on: false, disabled: false });
    });

    it("is off and disabled, with the rail's title, when three others fill the rail", () => {
        expect(toolRailPin("d", ["a", "b", "c"], list)).toEqual({
            on: false,
            disabled: true,
            title: RAIL_FULL_TITLE,
        });
    });

    it("stays on, and enabled, for a tool that is one of the three", () => {
        expect(toolRailPin("c", ["a", "b", "c"], list)).toEqual({ on: true, disabled: false });
    });

    it("does not count a pin whose service is gone against the rail", () => {
        expect(toolRailPin("d", ["a", "gone", "b", "c"], list)).toEqual({
            on: false,
            disabled: true,
            title: RAIL_FULL_TITLE,
        });
        expect(toolRailPin("d", ["a", "gone", "b"], list)).toEqual({ on: false, disabled: false });
    });

    it("is off and disabled, with no title, while wavesrv has no status for the tool", () => {
        expect(toolRailPin("a", ["a"], null)).toEqual({ on: false, disabled: true });
        expect(toolRailPin("new", [], list)).toEqual({ on: false, disabled: true });
    });

    it("does not depend on the service's state", () => {
        const running = list.map((s) => ({ ...s, state: "running" }));
        expect(toolRailPin("a", ["a"], running)).toEqual({ on: true, disabled: false });
    });
});

describe("reduceChoice", () => {
    const click = (value: boolean): ChoiceEvent<boolean> => ({ type: "click", value });
    const settled = (ok = true): ChoiceEvent<boolean> => ({ type: "settled", ok });
    const stored = (value: boolean): ChoiceEvent<boolean> => ({ type: "stored", value });
    const run = <T>(start: ChoiceState<T>, ...events: ChoiceEvent<T>[]): ChoiceState<T> =>
        events.reduce((s, e) => reduceChoice(s, e), start);

    const permutations = <T>(xs: T[]): T[][] =>
        xs.length <= 1
            ? [xs]
            : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

    it("reads the stored value, and follows it while nothing is picked", () => {
        expect(initialChoice(true).shown).toBe(true);
        const s = run(initialChoice(false), stored(true));
        expect(s).toMatchObject({ shown: true, stored: true, held: false });
        expect(run(s, stored(false)).shown).toBe(false);
    });

    it("reads the pick from the click, before the write or any status has answered", () => {
        const s = run(initialChoice(false), click(true));
        expect(s).toMatchObject({ shown: true, stored: false, held: true, writes: 1 });
    });

    it("holds the pick when the write is done but the stored value has not caught up", () => {
        const s = run(initialChoice(false), click(true), settled());
        expect(s).toMatchObject({ shown: true, held: true, writes: 0 });
    });

    it("gives the pick up to the stored value once nothing is in flight and the stored value is the pick", () => {
        expect(run(initialChoice(false), click(true), settled(), stored(true))).toMatchObject({
            shown: true,
            stored: true,
            held: false,
            writes: 0,
        });
        // the update can beat the answer to the write
        expect(run(initialChoice(false), click(true), stored(true), settled())).toMatchObject({
            shown: true,
            held: false,
        });
    });

    it("off then on: the off status landing after the on click does not take the switch back", () => {
        const afterOff = run(initialChoice(true), click(false), settled(), stored(false));
        expect(afterOff).toMatchObject({ shown: false, held: false });
        let s = run(afterOff, click(true));
        expect(s.shown).toBe(true);
        // the late status of the off write, then the on write's own answer, still before its status
        s = run(s, stored(false), settled());
        expect(s).toMatchObject({ shown: true, held: true });
        s = run(s, stored(true));
        expect(s).toMatchObject({ shown: true, stored: true, held: false });
    });

    it("off then on, clicked before the off write's status has landed", () => {
        let s = run(initialChoice(true), click(false), click(true));
        expect(s.shown).toBe(true);
        s = run(s, stored(false), settled(), settled());
        expect(s).toMatchObject({ shown: true, held: true, writes: 0 });
        expect(run(s, stored(true))).toMatchObject({ shown: true, held: false });
    });

    it("on then off", () => {
        const afterOn = run(initialChoice(false), click(true), settled(), stored(true));
        let s = run(afterOn, click(false));
        expect(s.shown).toBe(false);
        s = run(s, stored(true), settled());
        expect(s).toMatchObject({ shown: false, held: true });
        s = run(s, stored(false));
        expect(s).toMatchObject({ shown: false, stored: false, held: false });
    });

    it("a failed write falls back to the stored value", () => {
        expect(run(initialChoice(false), click(true), settled(false))).toMatchObject({
            shown: false,
            held: false,
            writes: 0,
        });
        // the stored value it falls back to is the latest one seen
        const s = run(initialChoice(false), click(true), stored(true), stored(false), stored(true), settled(false));
        expect(s).toMatchObject({ shown: true, held: false });
        // a later change of the stored value is shown, not held back by the pick that failed
        expect(run(s, stored(false)).shown).toBe(false);
    });

    it("an unrelated status read leaves a pending click alone", () => {
        const pending = run(initialChoice(false), click(true));
        // a read that carries the stored value it already had changes nothing at all
        expect(reduceChoice(pending, stored(false))).toBe(pending);
        const written = reduceChoice(pending, settled());
        expect(reduceChoice(written, stored(false))).toBe(written);
        expect(written.shown).toBe(true);
    });

    it("shows an outside change of the stored value once the pick has been given up", () => {
        const s = run(initialChoice(false), click(true), settled(), stored(true));
        expect(run(s, stored(false))).toMatchObject({ shown: false, held: false });
    });

    it("keeps the last pick, whichever order the writes and the status reads arrive in", () => {
        // From `from`, the person picks the other value (the first write), then picks `from` back (the second). A is the
        // first write's answer, B the second click, C the second write's answer, D the update of the first write, E the
        // update of the second. Everything may arrive in any order except what wavesrv fixes: the update of an earlier
        // write is sent before a later write is answered (D before C), the updates come in the order of the writes
        // (D before E), and what a click causes comes after it (B before C and E).
        for (const from of [true, false]) {
            const events: Record<string, ChoiceEvent<boolean>> = {
                A: settled(),
                B: click(from),
                C: settled(),
                D: stored(!from),
                E: stored(from),
            };
            const before = (p: string[], a: string, b: string) => p.indexOf(a) < p.indexOf(b);
            const orders = permutations(Object.keys(events)).filter(
                (p) => before(p, "B", "C") && before(p, "B", "E") && before(p, "D", "E") && before(p, "D", "C")
            );
            expect(orders.length).toBeGreaterThan(10);
            for (const order of orders) {
                let s = run(initialChoice(from), click(!from));
                let picked = false;
                for (const key of order) {
                    s = reduceChoice(s, events[key]);
                    picked ||= key === "B";
                    if (picked) {
                        expect(s.shown, `${order.join("")} after ${key}`).toBe(from);
                    }
                }
                expect(s, order.join("")).toMatchObject({ shown: from, stored: from, held: false, writes: 0 });
            }
        }
    });

    it("holds a choice among strings the same way", () => {
        let s = run(initialChoice("agent"), { type: "click", value: "home" });
        expect(s.shown).toBe("home");
        s = run(s, { type: "stored", value: "agent" }, { type: "settled", ok: true });
        expect(s).toMatchObject({ shown: "home", held: true });
        s = run(s, { type: "stored", value: "home" });
        expect(s).toMatchObject({ shown: "home", held: false });
        s = run(s, { type: "click", value: "root" }, { type: "settled", ok: false });
        expect(s).toMatchObject({ shown: "home", held: false });
    });
});
