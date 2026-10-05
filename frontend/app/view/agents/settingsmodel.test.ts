// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RUNTIME_FLAGS } from "./launch";
import {
    changedCount,
    countLabel,
    filterSections,
    flagRowId,
    groupSections,
    OPENROUTER_SECRET_NAME,
    resolveSelection,
    rowMatches,
    settingsSections,
    vaultStatusLine,
    type SettingSectionDef,
} from "./settingsmodel";

const sections = () => settingsSections("claude");

describe("vault sync rows", () => {
    it("treats the vault path as machine-local", () => {
        const row = sections()
            .find((s) => s.id === "memory")!
            .rows.find((r) => r.id === "memory.vaultpath")!;
        expect(row.scope).toBe("local");
    });

    it("offers a sync remote row that stores no setting", () => {
        const row = sections()
            .find((s) => s.id === "memory")!
            .rows.find((r) => r.id === "memory.remote")!;
        expect(row.key).toBeUndefined();
        expect(row.config).toBeUndefined();
    });
});

describe("details rail row", () => {
    it("is a local pref on agent.rail.visible whose copy says the rail is on unless turned off", () => {
        const row = sections()
            .find((s) => s.id === "general")!
            .rows.find((r) => r.id === "general.rail")!;
        expect(row.key).toBe("agent.rail.visible");
        expect(row.scope).toBe("local");
        expect(row.title).toBe("Show details rail by default");
        expect(row.desc).toBe(
            "The per-agent rail on the Agent surface: changed files, artifacts, uploads and terminals. On unless you turn it off."
        );
    });
});

describe("vaultStatusLine", () => {
    it("says nothing until the status loads", () => {
        expect(vaultStatusLine(null)).toBe("");
    });

    it("explains why sync is off", () => {
        expect(vaultStatusLine({ off: "no-remote" })).toBe("Sync off — no remote");
        expect(vaultStatusLine({ off: "no-git" })).toBe("Sync off — git not found");
    });

    it("reports a running sync, a failure and a success", () => {
        expect(vaultStatusLine({ running: true })).toBe("Syncing…");
        expect(vaultStatusLine({ lasterror: "push rejected" })).toBe("Sync failed: push rejected");
        expect(vaultStatusLine({ lastsuccessts: Date.now() - 5 * 60_000 })).toBe("Last synced 5m ago");
        expect(vaultStatusLine({})).toBe("Not synced yet");
    });

    it("appends conflict and malformed counts only when non-zero", () => {
        const ok = { lastsuccessts: Date.now() };
        expect(vaultStatusLine({ ...ok, conflicts: [], malformedefforts: [] })).toBe("Last synced just now");
        expect(vaultStatusLine({ ...ok, conflicts: ["a", "b"], malformedefforts: ["x"] })).toBe(
            "Last synced just now, 2 conflict copies, 1 malformed effort"
        );
    });
});

describe("settingsSections", () => {
    it("gives every row a unique id", () => {
        const ids = sections().flatMap((s) => s.rows.map((r) => r.id));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("lists the flags of the runtime being edited, and only those", () => {
        const rows = sections().find((s) => s.id === "newagent")!.rows;
        expect(rows.map((r) => r.id)).toEqual([
            "newagent.remember",
            "newagent.runtime",
            ...RUNTIME_FLAGS.claude.map((f) => flagRowId("claude", f.id)),
        ]);
        const codex = settingsSections("codex").find((s) => s.id === "newagent")!.rows;
        expect(codex.some((r) => r.title === "--verbose")).toBe(false);
    });

    it("renders a runtime with an empty flag catalog as a section with no flag rows", () => {
        const rows = settingsSections("pi").find((s) => s.id === "newagent")!.rows;
        expect(rows.map((r) => r.id)).toEqual(["newagent.remember", "newagent.runtime"]);
    });

    it("offers the OpenRouter key where the OpenRouter models are set", () => {
        const headless = sections().find((s) => s.id === "headless")!;
        const key = headless.rows.find((r) => r.id === "headless.apikey")!;
        expect(key.key).toBe("keychain");
        expect(key.scope).toBe("local");
        expect(key.config).toBeUndefined();
    });

    it("reads the OpenRouter key from the secret it has always been stored under", () => {
        // renaming it would orphan every stored key; pkg/consult/openrouter.go reads the same name
        expect(OPENROUTER_SECRET_NAME).toBe("jarvis_embedapikey");
    });

    it("has no embeddings section", () => {
        expect(sections().some((s) => s.id === "embeddings")).toBe(false);
        const keys = sections().flatMap((s) => s.rows.map((r) => r.key ?? ""));
        expect(keys.some((k) => k.startsWith("jarvis:embed"))).toBe(false);
    });

    it("leaves read-only build info without a provenance scope", () => {
        const about = sections().find((s) => s.id === "about")!;
        expect(about.rows.every((r) => r.scope === undefined)).toBe(true);
    });

    it("marks exactly the wconfig-backed rows as config rows", () => {
        const rows = sections().flatMap((s) => s.rows);
        const config = rows.filter((r) => r.config).map((r) => r.key);
        expect(config).toEqual([
            "term:fontfamily",
            "term:fontsize",
            "term:cursor",
            "term:cursorblink",
            "term:scrollback",
            "term:copyonselect",
            "memory:vaultpath",
            "headless:runtime",
            "headless:openroutercheapmodel",
            "headless:openroutermidmodel",
        ]);
    });

    it("leaves the backend-authoritative run route off the config path", () => {
        const route = sections()
            .find((s) => s.id === "run")!
            .rows.find((r) => r.id === "run.route")!;
        expect(route.scope).toBe("synced");
        expect(route.config).toBeUndefined();
    });

    it("puts every section in a known group", () => {
        const grouped = groupSections(sections()).flatMap((g) => g.sections);
        expect(grouped).toHaveLength(sections().length);
    });
});

describe("rowMatches", () => {
    const row = { id: "terminal.fontsize", title: "Font size", desc: "Default font size (px).", key: "term:fontsize" };

    it("matches an empty query", () => {
        expect(rowMatches(row, "   ")).toBe(true);
    });

    it("matches on title, description and config key, case-insensitively", () => {
        expect(rowMatches(row, "FONT")).toBe(true);
        expect(rowMatches(row, "px")).toBe(true);
        expect(rowMatches(row, "term:fontsize")).toBe(true);
    });

    it("does not match unrelated text", () => {
        expect(rowMatches(row, "scrollback")).toBe(false);
    });
});

describe("filterSections", () => {
    it("returns the sections untouched for an empty query", () => {
        const all = sections();
        expect(filterSections(all, "")).toBe(all);
    });

    it("drops non-matching rows and then empty sections", () => {
        const found = filterSections(sections(), "scrollback");
        expect(found.map((s) => s.id)).toEqual(["terminal"]);
        expect(found[0].rows.map((r) => r.id)).toEqual(["terminal.scrollback"]);
    });

    it("reaches rows in sections the query does not name", () => {
        const found = filterSections(sections(), "caret");
        expect(found.map((s) => s.id)).toEqual(["terminal"]);
        expect(found[0].rows.map((r) => r.id)).toEqual(["terminal.cursor", "terminal.cursorblink"]);
    });

    it("returns nothing when no row matches", () => {
        expect(filterSections(sections(), "zzzz")).toEqual([]);
    });
});

describe("resolveSelection", () => {
    it("keeps the wanted section when it survived the filter", () => {
        expect(resolveSelection(sections(), "terminal")).toBe("terminal");
    });

    it("falls back to the first surviving section", () => {
        expect(resolveSelection(filterSections(sections(), "scrollback"), "about")).toBe("terminal");
    });

    it("returns null when the filter emptied the list", () => {
        expect(resolveSelection([], "terminal")).toBeNull();
    });
});

describe("changedCount", () => {
    const section: SettingSectionDef = {
        id: "terminal",
        name: "Terminal",
        blurb: "",
        group: "Agents",
        rows: [
            { id: "a", title: "A", desc: "", key: "a" },
            { id: "b", title: "B", desc: "", key: "b" },
        ],
    };

    it("counts only this section's changed rows", () => {
        expect(changedCount(section, new Set(["a", "elsewhere"]))).toBe(1);
        expect(changedCount(section, new Set())).toBe(0);
    });
});

describe("countLabel", () => {
    it("singularizes one", () => {
        expect(countLabel(1)).toBe("1 setting");
        expect(countLabel(4)).toBe("4 settings");
    });
});
