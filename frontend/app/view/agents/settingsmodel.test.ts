// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RUNTIME_FLAGS } from "./launch";
import {
    changedCount,
    filterSections,
    flagRowId,
    keyPillTitle,
    OPENROUTER_SECRET_NAME,
    RADAR_AUDIT_RUNTIMES,
    radarAuditRoute,
    resolveSectionId,
    resolveSelection,
    rowKeys,
    rowMatches,
    sectionRows,
    settingsSections,
    SLEEP_AFTER_MIN,
    stepSleepAfter,
    vaultStatusLine,
    vaultSyncButton,
    vaultSyncFailureNote,
    type SettingSectionDef,
} from "./settingsmodel";

const sections = () => settingsSections("claude");
const rowsOf = (id: string, flagRuntime: Parameters<typeof settingsSections>[0] = "claude") =>
    sectionRows(settingsSections(flagRuntime).find((s) => s.id === id)!);

describe("sleep idle agents rows", () => {
    it("holds the toggle and the minutes, both stored in settings.json", () => {
        const agents = settingsSections("claude").find((s) => s.id === "agents")!;
        const card = agents.cards.find((c) => c.id === "sleep")!;
        expect(card.label).toBe("Sleep idle agents");
        expect(card.rows.map((r) => [r.id, r.key, r.config, r.scope])).toEqual([
            ["agents.sleepidle", "agents:sleepidle", true, "synced"],
            ["agents.sleepaftermin", "agents:sleepaftermin", true, "synced"],
        ]);
        expect(card.rows[1].title).toBe("After idle for");
    });

    it("steps the minutes by 5 and keeps them between 5 and 240", () => {
        expect(stepSleepAfter(30, 1)).toBe(35);
        expect(stepSleepAfter(30, -1)).toBe(25);
        expect(stepSleepAfter(SLEEP_AFTER_MIN.min, -1)).toBe(5);
        expect(stepSleepAfter(SLEEP_AFTER_MIN.max, 1)).toBe(240);
        expect(stepSleepAfter(238, 1)).toBe(240);
        expect(stepSleepAfter(7, -1)).toBe(5);
    });
});

describe("vault sync rows", () => {
    it("treats the vault path as machine-local", () => {
        const row = rowsOf("general").find((r) => r.id === "memory.vaultpath")!;
        expect(row.scope).toBe("local");
    });

    it("offers a sync remote row that stores no setting", () => {
        const row = rowsOf("general").find((r) => r.id === "memory.remote")!;
        expect(row.key).toBeUndefined();
        expect(row.config).toBeUndefined();
    });
});

describe("details rail row", () => {
    it("is a local pref on agent.rail.visible whose copy says the rail is on unless turned off", () => {
        const row = rowsOf("general").find((r) => r.id === "general.rail")!;
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

describe("vaultSyncButton", () => {
    it("is disabled and reads Syncing… while a sync runs, from a click or from launch/focus", () => {
        const syncing = { enabled: false, label: "Syncing…" };
        expect(vaultSyncButton({ running: true }, false)).toEqual(syncing);
        expect(vaultSyncButton({}, true)).toEqual(syncing);
    });

    it("is disabled but keeps its label when sync is off", () => {
        const off = { enabled: false, label: "Sync now" };
        expect(vaultSyncButton({ off: "no-git" }, false)).toEqual(off);
        expect(vaultSyncButton({ off: "no-remote" }, false)).toEqual(off);
    });

    it("stays enabled after a failed sync so the user can retry", () => {
        expect(vaultSyncButton({ lasterror: "push rejected" }, false)).toEqual({ enabled: true, label: "Sync now" });
    });

    it("is enabled when idle", () => {
        expect(vaultSyncButton({ lastsuccessts: Date.now() }, false)).toEqual({ enabled: true, label: "Sync now" });
    });

    it("is disabled until the status loads", () => {
        expect(vaultSyncButton(null, false)).toEqual({ enabled: false, label: "Sync now" });
    });
});

describe("vaultSyncFailureNote", () => {
    it("leaves a sync's own failure to the status line", () => {
        expect(vaultSyncFailureNote("push rejected", { lasterror: "push rejected" })).toBeNull();
    });

    it("notes a timeout that fired while the sync still runs", () => {
        expect(vaultSyncFailureNote("timeout", { running: true, lasterror: "old error" })).toBe("timeout");
    });

    it("notes a rejection the status does not explain", () => {
        expect(vaultSyncFailureNote("rpc closed", { lastsuccessts: Date.now() })).toBe("rpc closed");
    });

    it("notes a rejection when the status could not be reloaded", () => {
        expect(vaultSyncFailureNote("rpc closed", null)).toBe("rpc closed");
    });
});

describe("settingsSections", () => {
    it("lists the flags of the runtime being edited, and only those", () => {
        const flags = settingsSections("claude")
            .find((s) => s.id === "agents")!
            .cards.find((c) => c.id === "flags")!.rows;
        expect(flags.map((r) => r.id)).toEqual([
            "newagent.remember",
            "newagent.runtime",
            ...RUNTIME_FLAGS.claude.map((f) => flagRowId("claude", f.id)),
        ]);
        const codex = rowsOf("agents", "codex");
        expect(codex.some((r) => r.title === "--verbose")).toBe(false);
    });

    it("renders a runtime with an empty flag catalog as a card with no flag rows", () => {
        const flags = settingsSections("pi")
            .find((s) => s.id === "agents")!
            .cards.find((c) => c.id === "flags")!.rows;
        expect(flags.map((r) => r.id)).toEqual(["newagent.remember", "newagent.runtime"]);
    });

    it("offers the OpenRouter key where the OpenRouter models are set", () => {
        const key = rowsOf("headless").find((r) => r.id === "headless.apikey")!;
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
        const keys = sections()
            .flatMap(sectionRows)
            .map((r) => r.key ?? "");
        expect(keys.some((k) => k.startsWith("jarvis:embed"))).toBe(false);
    });

    it("leaves read-only build info without a provenance scope", () => {
        const about = rowsOf("about");
        const info = about.filter((r) => r.id !== "about.updatecheck");
        expect(info.every((r) => r.scope === undefined)).toBe(true);
        expect(about.find((r) => r.id === "about.updatecheck")!.scope).toBe("synced");
    });

    it("marks exactly the wconfig-backed rows as config rows", () => {
        const rows = sections().flatMap(sectionRows);
        const config = rows.filter((r) => r.config).flatMap(rowKeys);
        expect(config).toEqual([
            "notify:os",
            "notify:toast",
            "notify:reply",
            "window:minimize",
            "memory:vaultpath",
            "term:fontfamily",
            "term:fontsize",
            "term:cursor",
            "term:cursorblink",
            "term:scrollback",
            "term:copyonselect",
            "agents:sleepidle",
            "agents:sleepaftermin",
            "headless:runtime",
            "headless:openroutercheapmodel",
            "radar:auditruntime",
            "radar:auditmodel",
            "harness:updatecheck",
        ]);
    });

    it("lists the Radar audit route in Background AI, and no mid model", () => {
        const headless = sections().find((s) => s.id === "headless")!;
        expect(sectionRows(headless).map((r) => r.id)).toEqual([
            "headless.runtime",
            "headless.apikey",
            "headless.cheap",
            "headless.radaraudit",
        ]);
        expect(sectionRows(headless).find((r) => r.id === "headless.radaraudit")!.title).toBe("Radar audit");
        const prose = [headless.blurb, ...sectionRows(headless).flatMap((r) => [r.title, r.desc])]
            .join(" ")
            .toLowerCase();
        for (const gone of ["mid model", "gatekeeper", "decompose"]) {
            expect(prose).not.toContain(gone);
        }
    });

    it("finds the Radar audit row by either of its keys", () => {
        expect(sectionRows(filterSections(sections(), "radar:auditmodel")[0]).map((r) => r.id)).toEqual([
            "headless.radaraudit",
        ]);
    });
});

describe("radarAuditRoute", () => {
    it("shows claude on sonnet when both keys are unset", () => {
        expect(radarAuditRoute("", "")).toEqual({ runtime: "claude", model: "sonnet" });
        expect(radarAuditRoute("claude", "")).toEqual({ runtime: "claude", model: "sonnet" });
    });

    it("leaves pi on its own default when no model is set", () => {
        expect(radarAuditRoute("pi", "")).toEqual({ runtime: "pi" });
    });

    it("shows the configured route", () => {
        expect(radarAuditRoute("pi", "opencode/deepseek-v4-pro")).toEqual({
            runtime: "pi",
            model: "opencode/deepseek-v4-pro",
        });
        expect(radarAuditRoute("", "opus")).toEqual({ runtime: "claude", model: "opus" });
    });

    it("offers only runtimes that have tools", () => {
        expect(RADAR_AUDIT_RUNTIMES).toEqual(["claude", "pi"]);
    });
});

describe("settings pages", () => {
    it("has six pages in order", () => {
        expect(sections().map((s) => s.id)).toEqual([
            "general",
            "appearance",
            "terminal",
            "agents",
            "headless",
            "about",
        ]);
        expect(sections().map((s) => s.name)).toEqual([
            "General",
            "Appearance",
            "Terminal",
            "Agents",
            "Background AI",
            "About",
        ]);
    });

    it("puts each row in the card the spec names", () => {
        const cards = Object.fromEntries(
            sections().flatMap((s) => s.cards.map((c) => [`${s.id}/${c.id}`, c.rows.map((r) => r.id)]))
        );
        expect(cards["general/startup"]).toEqual(["general.startup", "general.rail"]);
        expect(cards["general/notifications"]).toEqual([
            "notifications.os",
            "notifications.toast",
            "notifications.reply",
        ]);
        expect(cards["general/window"]).toEqual(["window.minimize"]);
        expect(cards["general/vault"]).toEqual(["memory.vaultpath", "memory.remote"]);
        expect(cards["appearance/theme"]).toEqual(["appearance.theme"]);
        expect(cards["appearance/colors"]).toEqual([
            "appearance.accent",
            "appearance.success",
            "appearance.warning",
            "appearance.error",
        ]);
        expect(cards["appearance/fonts"]).toEqual(["fonts.sans", "fonts.mono"]);
        expect(cards["appearance/jarvis"]).toEqual([
            "appearance.petcharacter",
            "appearance.petoutfit",
            "appearance.petquotes",
        ]);
        expect(cards["terminal/text"]).toEqual(["fonts.term", "terminal.fontsize"]);
        expect(cards["terminal/cursor"]).toEqual(["terminal.cursor", "terminal.cursorblink"]);
        expect(cards["terminal/behavior"]).toEqual(["terminal.scrollback", "terminal.copyonselect"]);
        expect(cards["agents/claudeaccount"]).toEqual([]);
        expect(cards["agents/sleep"]).toEqual(["agents.sleepidle", "agents.sleepaftermin"]);
        expect(cards["agents/runs"]).toEqual(["run.route"]);
        expect(cards["agents/flags"].slice(0, 2)).toEqual(["newagent.remember", "newagent.runtime"]);
        expect(cards["headless/runtime"]).toEqual(["headless.runtime"]);
        expect(cards["headless/openrouter"]).toEqual(["headless.apikey", "headless.cheap"]);
        expect(cards["headless/radar"]).toEqual(["headless.radaraudit"]);
        expect(cards["about/versions"]).toEqual(["about.app", "about.server", "about.buildtime", "about.platform"]);
        expect(cards["about/agents"]).toEqual(["about.harnesses", "about.updatecheck"]);
    });

    it("keeps every row exactly once", () => {
        const ids = sections()
            .flatMap(sectionRows)
            .map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(39 + RUNTIME_FLAGS.claude.length);
    });

    it("leaves the backend-authoritative run route off the config path", () => {
        const route = sections()
            .flatMap(sectionRows)
            .find((r) => r.id === "run.route")!;
        expect(route.scope).toBe("synced");
        expect(route.config).toBeUndefined();
    });
});

describe("resolveSectionId", () => {
    it("sends a retired id to the page that holds its rows", () => {
        expect(resolveSectionId("fonts")).toBe("appearance");
        expect(resolveSectionId("notifications")).toBe("general");
        expect(resolveSectionId("memory")).toBe("general");
        expect(resolveSectionId("newagent")).toBe("agents");
        expect(resolveSectionId("run")).toBe("agents");
        expect(resolveSectionId("claudeaccount")).toBe("agents");
    });

    it("passes a current id through", () => {
        expect(resolveSectionId("headless")).toBe("headless");
    });
});

describe("keyPillTitle", () => {
    it("says what is copied and where the value lives", () => {
        expect(keyPillTitle({ id: "a", title: "", desc: "", key: "term:scrollback", scope: "synced" })).toBe(
            "Copy term:scrollback · synced in settings.json"
        );
        expect(keyPillTitle({ id: "b", title: "", desc: "", key: "cockpit.font.sans", scope: "local" })).toBe(
            "Copy cockpit.font.sans · stored on this machine only"
        );
        expect(
            keyPillTitle({
                id: "c",
                title: "",
                desc: "",
                key: "radar:auditruntime",
                morekeys: ["radar:auditmodel"],
                scope: "synced",
            })
        ).toBe("Copy radar:auditruntime · radar:auditmodel · synced in settings.json");
    });

    it("has no pill for a row that stores no setting", () => {
        expect(keyPillTitle({ id: "d", title: "", desc: "" })).toBeNull();
        // build info: a provenance "key" but no scope, like about.app
        expect(
            keyPillTitle({ id: "about.app", title: "App version", desc: "This shell.", key: "tauri.conf.json" })
        ).toBeNull();
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

    it("drops non-matching rows, then empty cards, then empty pages", () => {
        const found = filterSections(sections(), "scrollback");
        expect(found.map((s) => s.id)).toEqual(["terminal"]);
        expect(found[0].cards.map((c) => c.id)).toEqual(["behavior"]);
        expect(sectionRows(found[0]).map((r) => r.id)).toEqual(["terminal.scrollback"]);
    });

    it("reaches rows in pages the query does not name", () => {
        const found = filterSections(sections(), "caret");
        expect(sectionRows(found[0]).map((r) => r.id)).toEqual(["terminal.cursor", "terminal.cursorblink"]);
    });

    it("keeps a card whose label matches, rows and all, so a row-less card can be found", () => {
        const found = filterSections(sections(), "claude account");
        expect(found.map((s) => s.id)).toEqual(["agents"]);
        expect(found[0].cards.map((c) => c.id)).toEqual(["claudeaccount"]);
    });

    it("returns nothing when no row or card matches", () => {
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
        cards: [
            { id: "x", label: "X", rows: [{ id: "a", title: "A", desc: "", key: "a" }] },
            { id: "y", label: "Y", rows: [{ id: "b", title: "B", desc: "", key: "b" }] },
        ],
    };

    it("counts this page's changed rows across its cards", () => {
        expect(changedCount(section, new Set(["a", "b", "elsewhere"]))).toBe(2);
        expect(changedCount(section, new Set())).toBe(0);
    });
});
