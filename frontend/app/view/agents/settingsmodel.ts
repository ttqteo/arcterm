// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Settings surface's shape as data: which pages exist, which cards each page holds, and the
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
    // Further wconfig keys a config row writes beside `key` (a route is a runtime key and a model key).
    morekeys?: string[];
};

// A labelled group of rows on a page. A card may hold no rows: the Claude account card renders a list
// that lives behind its own RPCs, so the index has nothing to count or search in it but its label.
export type SettingCardDef = {
    id: string;
    label: string;
    rows: SettingRowDef[];
};

export type SettingSectionDef = {
    id: string;
    name: string;
    blurb: string;
    cards: SettingCardDef[];
};

// Ids of the eleven pages the six replaced, for a deep link written before the merge.
const RETIRED_SECTIONS: Record<string, string> = {
    fonts: "appearance",
    notifications: "general",
    memory: "general",
    newagent: "agents",
    run: "agents",
    claudeaccount: "agents",
};

export function resolveSectionId(id: string): string {
    return RETIRED_SECTIONS[id] ?? id;
}

export function sectionRows(section: SettingSectionDef): SettingRowDef[] {
    return section.cards.flatMap((c) => c.rows);
}

// The secret pkg/consult/openrouter.go reads. Named for the embedding lane that first stored it; the name
// stays because renaming it would orphan every key already stored. Never read back into the UI.
// Underscore, not colon: SetSecret validates against the shell env-var charset and rejects colons.
export const OPENROUTER_SECRET_NAME = "jarvis_embedapikey";

// The Radar audit route. Its sessions read and grep the repository, so only a runtime with tools can run
// them; the empty-key defaults mirror pkg/reporadar's.
export const RADAR_AUDIT_RUNTIME_KEY = "radar:auditruntime";
export const RADAR_AUDIT_MODEL_KEY = "radar:auditmodel";
export const RADAR_AUDIT_RUNTIMES: readonly string[] = ["claude", "pi"];
const RADAR_AUDIT_DEFAULT_RUNTIME = "claude";
const RADAR_AUDIT_DEFAULT_CLAUDE_MODEL = "sonnet";

// The route the two settings select. An unset model on pi stays unset: pi runs its own default.
export function radarAuditRoute(runtime: string, model: string): RoutePin {
    const rt = runtime || RADAR_AUDIT_DEFAULT_RUNTIME;
    const m = model || (rt === RADAR_AUDIT_DEFAULT_RUNTIME ? RADAR_AUDIT_DEFAULT_CLAUDE_MODEL : "");
    return { runtime: rt, ...(m ? { model: m } : {}) };
}

const THEME_OVERRIDE_KEY = "cockpit.theme.overrides";
const LAUNCH_FLAGS_KEY = "agent.launch.flags";

// The per-runtime launch flags are a catalog, not a fixed list, so the Launch flags card's rows depend
// on which runtime is being edited. Everything else is static.
export function settingsSections(flagRuntime: Runtime): SettingSectionDef[] {
    return [
        {
            id: "general",
            name: "General",
            blurb: "What opens at launch, when arcterm tells you about an agent, and where Jarvis keeps its vault.",
            cards: [
                {
                    id: "startup",
                    label: "Startup",
                    rows: [
                        {
                            id: "general.startup",
                            title: "Startup surface",
                            desc: "Which surface opens when the app launches. Last opened reopens the one you left.",
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
                    label: "Notifications",
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
                    id: "window",
                    label: "Window",
                    rows: [
                        {
                            id: "window.minimize",
                            title: "Minimize",
                            desc: "What minimize does, the yellow button and ⌘M on macOS included: fold the window into Sprout, which floats over every app, or send it to the Dock or taskbar. The Sprout button folds either way.",
                            key: "window:minimize",
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
                {
                    id: "vault",
                    label: "Vault & sync",
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
            ],
        },
        {
            id: "appearance",
            name: "Appearance",
            blurb: "The palette every surface derives from, its role colors, and the faces the app is set in.",
            cards: [
                {
                    id: "theme",
                    label: "Theme",
                    rows: [
                        {
                            id: "appearance.theme",
                            title: "Theme",
                            desc: "Base palette for every surface. Tints and gradients recompute from it.",
                            key: "cockpit.theme.preset",
                            scope: "local",
                        },
                    ],
                },
                {
                    id: "colors",
                    label: "Colors",
                    rows: [
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
                    label: "Fonts",
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
                    ],
                },
                {
                    id: "jarvis",
                    label: "Jarvis",
                    rows: [
                        {
                            id: "appearance.petcharacter",
                            title: "Character",
                            desc: "Who walks the footer as Jarvis. The marks and the outfit work the same for either.",
                            key: "jarvis.pet.character",
                            scope: "local",
                        },
                        {
                            id: "appearance.petoutfit",
                            title: "Jarvis in Vietnam's colours",
                            desc: "The flag shirt, or the flag in its hand. On 30/4, 1/5 and 2/9 it wears the shirt even when this is off.",
                            key: "jarvis.pet.outfit",
                            scope: "local",
                        },
                        {
                            id: "appearance.petquotes",
                            title: "Jarvis quotes",
                            desc: "Now and then, when nothing waits on you, Jarvis says a well-known line about programming.",
                            key: "jarvis.pet.quotes",
                            scope: "local",
                        },
                    ],
                },
            ],
        },
        {
            id: "terminal",
            name: "Terminal",
            blurb: "Defaults for every agent and shell terminal.",
            cards: [
                {
                    id: "text",
                    label: "Text",
                    rows: [
                        {
                            id: "fonts.term",
                            title: "Terminal font",
                            desc: "Monospace face inside agent terminals.",
                            key: "term:fontfamily",
                            scope: "synced",
                            config: true,
                        },
                        {
                            id: "terminal.fontsize",
                            title: "Font size",
                            desc: "Default font size for agent terminals (px).",
                            key: "term:fontsize",
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
                {
                    id: "cursor",
                    label: "Cursor",
                    rows: [
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
                    ],
                },
                {
                    id: "behavior",
                    label: "Behavior",
                    rows: [
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
            ],
        },
        {
            id: "agents",
            name: "Agents",
            blurb: "The Claude subscription new agents run on, the route new runs take, and the flags every launch starts with.",
            cards: [
                // The account list lives behind its own RPCs, not in settings, so the card has no rows for the
                // index to count or search; ClaudeAccountSection renders it whole.
                { id: "claudeaccount", label: "Claude account", rows: [] },
                {
                    id: "runs",
                    label: "Runs",
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
                    id: "flags",
                    label: "Launch flags",
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
            ],
        },
        {
            id: "headless",
            name: "Background AI",
            blurb: "The runtime behind session classify, continuity, the volunteer judge and pi titles, and the route Radar audits run on.",
            cards: [
                {
                    id: "runtime",
                    label: "Runtime",
                    rows: [
                        {
                            id: "headless.runtime",
                            title: "Runtime",
                            desc: "Which engine powers background AI features. Empty means OpenRouter, the backend default.",
                            key: "headless:runtime",
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
                {
                    id: "openrouter",
                    label: "OpenRouter",
                    rows: [
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
                            desc: "The OpenRouter model for session classify, continuity, the volunteer judge and pi titles.",
                            key: "headless:openroutercheapmodel",
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
                {
                    id: "radar",
                    label: "Radar",
                    rows: [
                        {
                            id: "headless.radaraudit",
                            title: "Radar audit",
                            desc: "Each scan runs one read-only session per fix commit on this route. OpenRouter cannot be used: it has no tools.",
                            key: RADAR_AUDIT_RUNTIME_KEY,
                            morekeys: [RADAR_AUDIT_MODEL_KEY],
                            scope: "synced",
                            config: true,
                        },
                    ],
                },
            ],
        },
        {
            id: "about",
            name: "About",
            blurb: "Versions of the shell, the backend it spawned, and the coding agents on this machine.",
            cards: [
                {
                    id: "versions",
                    label: "Versions",
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
                        {
                            id: "about.platform",
                            title: "Platform",
                            desc: "Host the shell reported at boot.",
                            key: "runtime",
                        },
                    ],
                },
                {
                    id: "agents",
                    label: "Coding agents",
                    rows: [
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
            ],
        },
    ];
}

// Row id for one runtime's launch flag. Runtime-qualified: the same flag id ("skip-permissions") is a
// different row on claude than on codex, and the changed-count has to tell them apart.
export function flagRowId(runtime: Runtime, flagId: string): string {
    return `newagent.flag.${runtime}.${flagId}`;
}

// Every settings key a row stores under, primary first. Empty for a row that stores no setting.
export function rowKeys(row: SettingRowDef): string[] {
    return row.key == null ? [] : [row.key, ...(row.morekeys ?? [])];
}

// The key pill's tooltip: what a click copies, then where the value lives. Null — no pill — for a row that
// stores no setting: no key, or no scope (build info, whose key only names where the value came from).
export function keyPillTitle(row: SettingRowDef): string | null {
    const keys = rowKeys(row);
    if (keys.length === 0 || row.scope == null) {
        return null;
    }
    const where = row.scope === "synced" ? "synced in settings.json" : "stored on this machine only";
    return `Copy ${keys.join(" · ")} · ${where}`;
}

export function rowMatches(row: SettingRowDef, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return true;
    }
    return `${row.title} ${row.desc} ${rowKeys(row).join(" ")}`.toLowerCase().includes(q);
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

// the Sync now button. `clicking` is the local in-flight flag, set before the RPC so the row reads
// syncing at once; `status.running` also covers a sync started at launch or on window focus.
export function vaultSyncButton(s: VaultStatusRtnData | null, clicking: boolean): { enabled: boolean; label: string } {
    if (clicking || s?.running) {
        return { enabled: false, label: "Syncing…" };
    }
    return { enabled: s != null && !s.off, label: "Sync now" };
}

// what a rejected Sync now puts in the row's error note. a sync's own failure is already in the reloaded
// status as `lasterror` (shown by the status line), so only an RPC failure gets a note: the status has no
// error, could not be loaded, or still runs (the RPC timeout fired mid-sync).
export function vaultSyncFailureNote(err: string, reloaded: VaultStatusRtnData | null): string | null {
    if (reloaded == null || reloaded.running || !reloaded.lasterror) {
        return err;
    }
    return null;
}

// Cards keep the rows the query matches; a card whose label matches keeps all of its rows, which is how
// the Claude account card (no rows) is found. Empty cards drop, then empty pages. An empty query returns
// the sections unchanged (identity) so callers can skip the filtered path.
export function filterSections(sections: SettingSectionDef[], query: string): SettingSectionDef[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return sections;
    }
    return sections
        .map((s) => ({
            ...s,
            cards: s.cards
                .map((c) =>
                    c.label.toLowerCase().includes(q) ? c : { ...c, rows: c.rows.filter((r) => rowMatches(r, q)) }
                )
                .filter((c) => c.rows.length > 0 || c.label.toLowerCase().includes(q)),
        }))
        .filter((s) => s.cards.length > 0);
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
    return sectionRows(section).filter((r) => changed.has(r.id)).length;
}
