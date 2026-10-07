// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Settings surface's shape as data: which sections exist, which group they sit under, and the
// title/description/config-key of every row. Rendering stays in settingssurface.tsx — this file is
// what lets the left pane count and search rows it does not render, and it is the single source of
// each row's prose so the index and the detail pane cannot disagree.

import { formatAgo } from "./agentsviewmodel";
import { RUNTIME_FLAGS, type Runtime } from "./launch";

// Where a row's value lives. "synced" travels with settings.json; "local" stays on this machine
// (localStorage prefs, and the OS secret store). Read-only build info leaves it off — a provenance
// dot on "App version" would claim something untrue.
export type RowScope = "synced" | "local";

export type SettingRowDef = {
    id: string;
    title: string;
    desc: string;
    // The real config/storage key, shown under the row so a setting can be found in settings.json.
    // Left off by a row that stores no setting (the vault sync remote lives in the vault's git config).
    key?: string;
    scope?: RowScope;
    // Set when `key` is a wconfig settings key. Those rows get their changed mark by diffing the merged
    // value against the shipped default, and revert by deleting the user's override; every other row's
    // value lives somewhere only the surface knows how to reach.
    config?: boolean;
};

export type SettingSectionDef = {
    id: string;
    name: string;
    blurb: string;
    group: string;
    rows: SettingRowDef[];
};

export type SettingGroup = {
    label: string;
    sections: SettingSectionDef[];
};

export const GROUP_ORDER = ["Cockpit", "Agents", "Data", "Build"] as const;

// The secret pkg/consult/openrouter.go reads. Named for the embedding lane that first stored it; the name
// stays because renaming it would orphan every key already stored. Never read back into the UI.
// Underscore, not colon: SetSecret validates against the shell env-var charset and rejects colons.
export const OPENROUTER_SECRET_NAME = "jarvis_embedapikey";

const THEME_OVERRIDE_KEY = "cockpit.theme.overrides";
const LAUNCH_FLAGS_KEY = "agent.launch.flags";

// The per-runtime launch flags are a catalog, not a fixed list, so the New Agent section's rows depend
// on which runtime is being edited. Everything else is static.
export function settingsSections(flagRuntime: Runtime): SettingSectionDef[] {
    return [
        {
            id: "appearance",
            name: "Appearance",
            blurb: "Base palette and the four role colors every surface derives from.",
            group: "Cockpit",
            rows: [
                {
                    id: "appearance.theme",
                    title: "Theme",
                    desc: "Base palette for every surface. Tints and gradients recompute from it.",
                    key: "cockpit.theme.preset",
                    scope: "local",
                },
                {
                    id: "appearance.accent",
                    title: "Accent",
                    desc: "Primary actions, active nav, links.",
                    key: THEME_OVERRIDE_KEY,
                    scope: "local",
                },
                {
                    id: "appearance.success",
                    title: "Working / accept",
                    desc: "Live agents, accepted diffs.",
                    key: THEME_OVERRIDE_KEY,
                    scope: "local",
                },
                {
                    id: "appearance.warning",
                    title: "Asking / attention",
                    desc: "Awaiting your reply.",
                    key: THEME_OVERRIDE_KEY,
                    scope: "local",
                },
                {
                    id: "appearance.error",
                    title: "Blocked / reject",
                    desc: "Errors, discarded changes.",
                    key: THEME_OVERRIDE_KEY,
                    scope: "local",
                },
            ],
        },
        {
            id: "fonts",
            name: "Fonts",
            blurb: "Three faces: the app, code surfaces, and the terminal.",
            group: "Cockpit",
            rows: [
                {
                    id: "fonts.sans",
                    title: "Interface font",
                    desc: "App-wide UI text — nav, panels, labels.",
                    key: "cockpit.font.sans",
                    scope: "local",
                },
                {
                    id: "fonts.mono",
                    title: "Code font",
                    desc: "Inline code, diffs, and file trees.",
                    key: "cockpit.font.mono",
                    scope: "local",
                },
                {
                    id: "fonts.term",
                    title: "Terminal font",
                    desc: "Monospace face inside agent terminals.",
                    key: "term:fontfamily",
                    scope: "synced",
                    config: true,
                },
            ],
        },
        {
            id: "general",
            name: "General",
            blurb: "What opens at launch and what the Agent surface shows by default.",
            group: "Cockpit",
            rows: [
                {
                    id: "general.startup",
                    title: "Startup surface",
                    desc: "Which surface opens when the app launches.",
                    key: "cockpit.startup.surface",
                    scope: "local",
                },
                {
                    id: "general.rail",
                    title: "Show details rail by default",
                    desc: "The per-agent rail on the Agent surface: changed files, artifacts, uploads and terminals. On unless you turn it off.",
                    key: "agent.rail.visible",
                    scope: "local",
                },
            ],
        },
        {
            id: "notifications",
            name: "Notifications",
            blurb: "When an agent needs you or finishes: an OS notification while arcterm is in the background, a toast while it is in front.",
            group: "Cockpit",
            rows: [
                {
                    id: "notifications.os",
                    title: "OS notifications",
                    desc: "Show a system notification while arcterm is in the background. Clicking it opens the agent.",
                    key: "notify:os",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "notifications.toast",
                    title: "In-app toasts",
                    desc: "Show a toast while arcterm is in front, unless you are already looking at that agent.",
                    key: "notify:toast",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "notifications.reply",
                    title: "When an agent finishes",
                    desc: "Also notify when an agent finishes its turn, not only when it needs you. Run workers never do.",
                    key: "notify:reply",
                    scope: "synced",
                    config: true,
                },
            ],
        },
        {
            id: "newagent",
            name: "New Agent",
            blurb: "Launch flags reused for every new agent, per runtime.",
            group: "Agents",
            rows: [
                {
                    id: "newagent.remember",
                    title: "Remember flags",
                    desc: "Reuse the enabled flags for every new agent instead of clearing after launch.",
                    key: "agent.launch.remember",
                    scope: "local",
                },
                {
                    id: "newagent.runtime",
                    title: "Runtime",
                    desc: "Which runtime's flag set you're editing.",
                    key: LAUNCH_FLAGS_KEY,
                    scope: "local",
                },
                ...RUNTIME_FLAGS[flagRuntime].map((f) => ({
                    id: flagRowId(flagRuntime, f.id),
                    title: f.flag,
                    desc: f.desc,
                    key: LAUNCH_FLAGS_KEY,
                    scope: "local" as const,
                })),
            ],
        },
        {
            id: "run",
            name: "Run defaults",
            blurb: "Backend-authoritative harness and model for new runs.",
            group: "Agents",
            rows: [
                {
                    id: "run.route",
                    title: "Run route",
                    desc: "Harness and resolved model for new runs.",
                    key: "harness.preference",
                    scope: "synced",
                },
            ],
        },
        {
            id: "terminal",
            name: "Terminal",
            blurb: "Defaults for every agent terminal.",
            group: "Agents",
            rows: [
                {
                    id: "terminal.fontsize",
                    title: "Font size",
                    desc: "Default font size for agent terminals (px).",
                    key: "term:fontsize",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "terminal.cursor",
                    title: "Cursor style",
                    desc: "Shape of the terminal caret.",
                    key: "term:cursor",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "terminal.cursorblink",
                    title: "Cursor blink",
                    desc: "Pulse the caret when the terminal is focused.",
                    key: "term:cursorblink",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "terminal.scrollback",
                    title: "Scrollback",
                    desc: "Lines of history kept per terminal.",
                    key: "term:scrollback",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "terminal.copyonselect",
                    title: "Copy on select",
                    desc: "Copy highlighted text to the clipboard automatically.",
                    key: "term:copyonselect",
                    scope: "synced",
                    config: true,
                },
            ],
        },
        {
            id: "memory",
            name: "Vault",
            blurb: "Where Jarvis reads records, decisions and attachments from.",
            group: "Data",
            rows: [
                {
                    id: "memory.vaultpath",
                    title: "Vault path",
                    desc: "Validated on change — the folder must exist. Empty falls back to the default vault.",
                    key: "memory:vaultpath",
                    scope: "local",
                    config: true,
                },
                {
                    id: "memory.remote",
                    title: "Sync remote",
                    desc: "A private git remote that keeps the vault, initiatives and portable settings the same on every machine. Empty turns sync off.",
                },
            ],
        },
        {
            id: "headless",
            name: "Headless AI",
            blurb: "The runtime background jobs call when no agent is attached.",
            group: "Data",
            rows: [
                {
                    id: "headless.runtime",
                    title: "Runtime",
                    desc: "Which engine powers background AI features. Empty means OpenRouter, the backend default.",
                    key: "headless:runtime",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "headless.apikey",
                    title: "OpenRouter API key",
                    desc: "OS secret store — never in settings, never shown again.",
                    key: "keychain",
                    scope: "local",
                },
                {
                    id: "headless.cheap",
                    title: "Cheap model",
                    desc: "For mechanical tasks: gatekeeper, decompose, continuity, volunteer judge.",
                    key: "headless:openroutercheapmodel",
                    scope: "synced",
                    config: true,
                },
                {
                    id: "headless.mid",
                    title: "Mid model",
                    desc: "For synthesis: radar, Jarvis.",
                    key: "headless:openroutermidmodel",
                    scope: "synced",
                    config: true,
                },
            ],
        },
        {
            id: "about",
            name: "About",
            blurb: "Versions of the shell and the backend it spawned.",
            group: "Build",
            rows: [
                { id: "about.app", title: "App version", desc: "This shell.", key: "tauri.conf.json" },
                {
                    id: "about.server",
                    title: "Backend version",
                    desc: "The wavesrv this app spawned.",
                    key: "dist/bin",
                },
                {
                    id: "about.buildtime",
                    title: "Backend build time",
                    desc: "When the wavesrv binary was stamped.",
                    key: "dist/bin",
                },
                { id: "about.platform", title: "Platform", desc: "Host the shell reported at boot.", key: "runtime" },
                {
                    id: "about.harnesses",
                    title: "Coding agents",
                    desc: "Installed harnesses, their versions, and the latest release when one is newer.",
                    key: "harness:*",
                },
                {
                    id: "about.updatecheck",
                    title: "Check for harness updates",
                    desc: "Asks the npm registry every 6 hours and says once when a newer release is out.",
                    key: "harness:updatecheck",
                    scope: "synced",
                    config: true,
                },
            ],
        },
    ];
}

// Row id for one runtime's launch flag. Runtime-qualified: the same flag id ("skip-permissions") is a
// different row on claude than on codex, and the changed-count has to tell them apart.
export function flagRowId(runtime: Runtime, flagId: string): string {
    return `newagent.flag.${runtime}.${flagId}`;
}

export function rowMatches(row: SettingRowDef, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return true;
    }
    return `${row.title} ${row.desc} ${row.key ?? ""}`.toLowerCase().includes(q);
}

// The one-line sync state under the Sync remote field. null is "not loaded yet".
export function vaultStatusLine(s: VaultStatusRtnData | null): string {
    if (s == null) {
        return "";
    }
    if (s.off === "no-git") {
        return "Sync off — git not found";
    }
    if (s.off === "no-remote") {
        return "Sync off — no remote";
    }
    let line: string;
    if (s.running) {
        line = "Syncing…";
    } else if (s.lasterror) {
        line = `Sync failed: ${s.lasterror}`;
    } else if (s.lastsuccessts) {
        line = `Last synced ${formatAgo(Date.now() - s.lastsuccessts)}`;
    } else {
        line = "Not synced yet";
    }
    const conflicts = s.conflicts?.length ?? 0;
    if (conflicts > 0) {
        line += `, ${conflicts} conflict ${conflicts === 1 ? "copy" : "copies"}`;
    }
    const malformed = s.malformedefforts?.length ?? 0;
    if (malformed > 0) {
        line += `, ${malformed} malformed ${malformed === 1 ? "effort" : "efforts"}`;
    }
    return line;
}

// Sections with non-matching rows dropped, then empty sections dropped. An empty query returns the
// sections unchanged (identity, not a copy of every row) so callers can skip the filtered path.
export function filterSections(sections: SettingSectionDef[], query: string): SettingSectionDef[] {
    if (query.trim() === "") {
        return sections;
    }
    return sections
        .map((s) => ({ ...s, rows: s.rows.filter((r) => rowMatches(r, query)) }))
        .filter((s) => s.rows.length > 0);
}

export function groupSections(sections: SettingSectionDef[]): SettingGroup[] {
    return GROUP_ORDER.map((label) => ({ label, sections: sections.filter((s) => s.group === label) })).filter(
        (g) => g.sections.length > 0
    );
}

// Which section the detail pane shows. A search that filters the selected section away moves the
// selection to the first surviving one rather than leaving the pane blank.
export function resolveSelection(sections: SettingSectionDef[], wanted: string): string | null {
    if (sections.length === 0) {
        return null;
    }
    return sections.some((s) => s.id === wanted) ? wanted : sections[0].id;
}

export function changedCount(section: SettingSectionDef, changed: ReadonlySet<string>): number {
    return section.rows.filter((r) => changed.has(r.id)).length;
}

export function countLabel(n: number): string {
    return `${n} ${n === 1 ? "setting" : "settings"}`;
}
