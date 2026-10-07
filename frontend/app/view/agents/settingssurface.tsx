// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings as a place you navigate: the section index on the left (grouped, with a changed-count and a
// search that reaches rows it does not render), one section at a time on the right. settingsmodel.ts
// owns which rows exist and what they say; this file owns the controls and where each value lives.
//
// One commit model throughout — every control writes as you change it, text fields on blur or Enter.
// There are no Save buttons; a per-row Revert and a per-section Reset replace them.

import { formatBuildTime, versionInfoAtom } from "@/app/cockpit/versioninfo";
import { MOTION } from "@/app/element/motiontokens";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { Folder, Search } from "lucide-react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import { formatAgeShort } from "./agentsviewmodel";
import { restartCandidates, rowQuota } from "./claudeaccount";
import { KnownEmailsDatalist } from "./claudeemails";
import {
    coerceFontSize,
    coerceScrollback,
    DEFAULT_STARTUP_SURFACE,
    startupSurfaceAtom,
    startupSurfaceOptions,
    vaultPathError,
    type StartupSurface,
} from "./cockpitprefsstore";
import { createCommitGate } from "./commitgate";
import { DEFAULT_MONO, DEFAULT_SANS, DEFAULT_TERM_FONT, MONO_FONTS, SANS_FONTS, stackOf } from "./fonts";
import { fontMonoAtom, fontSansAtom } from "./fontstore";
import { harnessPickerItems } from "./harnesspicker";
import { harnessesAtom, harnessPreferenceAtom, leadRuntimesAtom, loadHarnesses, setPreferredRoute } from "./harnessstore";
import { harnessRowState, rowLabel } from "./harnessupdatemodel";
import { updateHarness, updateRunsAtom } from "./harnessupdatestore";
import { RUNTIME_FLAGS, type Runtime } from "./launch";
import { DEFAULT_REMEMBER_FLAGS, naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { ITEMS } from "./navrail";
import { DEFAULT_RAIL_VISIBLE, railVisibleAtom } from "./railstore";
import {
    claudeIdentityAtom,
    claudeQuotaKey,
    identityFromList,
    savedRateLimitsAtom,
    setClaudeIdentity,
} from "./ratelimitstore";
import { RoutePicker } from "./routepicker";
import {
    changedCount,
    countLabel,
    filterSections,
    flagRowId,
    groupSections,
    OPENROUTER_SECRET_NAME,
    RADAR_AUDIT_MODEL_KEY,
    RADAR_AUDIT_RUNTIME_KEY,
    RADAR_AUDIT_RUNTIMES,
    radarAuditRoute,
    resolveSelection,
    rowKeys,
    settingsSections,
    vaultStatusLine,
    type SettingRowDef,
    type SettingSectionDef,
} from "./settingsmodel";
import { takePendingSettingsSection } from "./settingsstore";
import { SurfaceHeader } from "./surfacescaffold";
import { ACCENT_SWATCHES, activePalette, colorOf, THEMES, type OverrideRole } from "./themes";
import { DEFAULT_THEME_PRESET, themeOverridesAtom, themePresetAtom } from "./themestore";

const LABEL: Record<SurfaceKey, string> = Object.fromEntries(ITEMS.map((i) => [i.key, i.label])) as Record<
    SurfaceKey,
    string
>;

// a startup choice's button label: a surface by its nav name, "last" by what it does
const startupLabel = (k: StartupSurface) => (k === "last" ? "Last opened" : (LABEL[k] ?? k));

// Runtimes the flag editor lists. Terminal stays out (it isn't an agent); pi is included even though
// its catalog is empty so its no-flags state renders in the editor instead of the row vanishing.
const FLAG_RUNTIMES: { id: Runtime; name: string }[] = [
    { id: "claude", name: "Claude" },
    { id: "codex", name: "Codex" },
    { id: "opencode", name: "OpenCode" },
    { id: "pi", name: "Pi" },
    { id: "agy", name: "Antigravity" },
];

const OVERRIDE_ROLES: OverrideRole[] = ["accent", "success", "warning", "error"];

// The settings as they ship, before the user's settings.json merges over them. The only way the surface
// can say which rows were changed and what Revert restores. Null against a backend older than the field:
// an empty map would read as "every set key was changed", so the marks stay off instead of lying.
const defaultSettingsAtom = atom(
    (get) => (get(atoms.fullConfigAtom)?.defaultsettings ?? null) as Record<string, unknown> | null
);

// SetConfigCommand's data param is a typed settings map; a dynamic-key patch needs the cast. A null
// value deletes the key from settings.json (wconfig.SetBaseConfigValue), which is how Revert works —
// dropping the override lets the shipped default take over again.
function writeConfig(patch: Record<string, unknown>) {
    void RpcApi.SetConfigCommand(TabRpcClient, patch as Parameters<typeof RpcApi.SetConfigCommand>[1]);
}

// Every value here is a scalar, so identity is enough; the ?? folds an absent key and an explicit null
// together, since both mean "not set".
function sameValue(a: unknown, b: unknown): boolean {
    return (a ?? null) === (b ?? null);
}

type LocalBinding = { changed: boolean; revert: () => void };

// Which rows differ from their default, and how to put each one back. Lives at the surface rather than
// inside the section components because the left pane counts changed rows for sections it never renders.
function useRowBindings(sections: SettingSectionDef[], flagRuntime: Runtime) {
    const settings = (useAtomValue(atoms.settingsAtom) ?? {}) as unknown as Record<string, unknown>;
    const defaults = useAtomValue(defaultSettingsAtom);
    const [preset, setPreset] = useAtom(themePresetAtom);
    const [overrides, setOverrides] = useAtom(themeOverridesAtom);
    const [sans, setSans] = useAtom(fontSansAtom);
    const [mono, setMono] = useAtom(fontMonoAtom);
    const [startup, setStartup] = useAtom(startupSurfaceAtom);
    const [rail, setRail] = useAtom(railVisibleAtom);
    const [flags, setFlags] = useAtom(naFlagsAtom);
    const [remember, setRemember] = useAtom(naRememberFlagsAtom);

    const local: Record<string, LocalBinding> = {
        "appearance.theme": {
            changed: preset !== DEFAULT_THEME_PRESET,
            revert: () => setPreset(DEFAULT_THEME_PRESET),
        },
        "fonts.sans": { changed: sans !== DEFAULT_SANS, revert: () => setSans(DEFAULT_SANS) },
        "fonts.mono": { changed: mono !== DEFAULT_MONO, revert: () => setMono(DEFAULT_MONO) },
        "general.startup": {
            changed: startup !== DEFAULT_STARTUP_SURFACE,
            revert: () => setStartup(DEFAULT_STARTUP_SURFACE),
        },
        "general.rail": { changed: rail !== DEFAULT_RAIL_VISIBLE, revert: () => setRail(DEFAULT_RAIL_VISIBLE) },
        "newagent.remember": {
            changed: remember !== DEFAULT_REMEMBER_FLAGS,
            revert: () => setRemember(DEFAULT_REMEMBER_FLAGS),
        },
    };
    for (const role of OVERRIDE_ROLES) {
        local[`appearance.${role}`] = {
            changed: overrides[role] != null,
            revert: () =>
                setOverrides((prev) => {
                    const next = { ...prev };
                    delete next[role];
                    return next;
                }),
        };
    }
    for (const f of RUNTIME_FLAGS[flagRuntime]) {
        local[flagRowId(flagRuntime, f.id)] = {
            changed: !!flags[flagRuntime]?.[f.id],
            revert: () => setFlags((prev) => ({ ...prev, [flagRuntime]: { ...prev[flagRuntime], [f.id]: false } })),
        };
    }

    const defs = new Map<string, SettingRowDef>();
    const changed = new Set<string>();
    for (const section of sections) {
        for (const row of section.rows) {
            defs.set(row.id, row);
            const isChanged = row.config
                ? defaults != null && rowKeys(row).some((k) => !sameValue(settings[k], defaults[k]))
                : !!local[row.id]?.changed;
            if (isChanged) {
                changed.add(row.id);
            }
        }
    }

    const revert = (id: string) => {
        const def = defs.get(id);
        if (def?.config) {
            writeConfig(Object.fromEntries(rowKeys(def).map((k) => [k, null])));
            return;
        }
        local[id]?.revert();
    };

    // One config write for the whole section, so reverting Terminal doesn't queue five settings.json
    // rewrites back to back.
    const resetSection = (section: SettingSectionDef) => {
        const patch: Record<string, unknown> = {};
        for (const row of section.rows) {
            if (!changed.has(row.id)) {
                continue;
            }
            if (row.config) {
                for (const k of rowKeys(row)) {
                    patch[k] = null;
                }
            } else {
                local[row.id]?.revert();
            }
        }
        if (Object.keys(patch).length > 0) {
            writeConfig(patch);
        }
    };

    return { defs, changed, revert, resetSection };
}

type RowCtxValue = {
    defs: Map<string, SettingRowDef>;
    // Row ids the active search left standing, or null when there is no search.
    visible: Set<string> | null;
    changed: ReadonlySet<string>;
    revert: (id: string) => void;
};

const RowCtx = createContext<RowCtxValue>({
    defs: new Map(),
    visible: null,
    changed: new Set(),
    revert: () => {},
});

export function SettingsSurface({ model }: { model: AgentsViewModel }) {
    const reduce = useReducedMotion();
    const [query, setQuery] = useState("");
    const [flagRuntime, setFlagRuntime] = useState<Runtime>("claude");
    const [wanted, setWanted] = useState<string>("appearance");

    const sections = useMemo(() => settingsSections(flagRuntime), [flagRuntime]);
    const visibleSections = useMemo(() => filterSections(sections, query), [sections, query]);
    const selected = resolveSelection(visibleSections, wanted);
    const bindings = useRowBindings(sections, flagRuntime);

    useEffect(() => {
        const want = takePendingSettingsSection();
        if (want != null) {
            setWanted(want);
        }
    }, []);

    const section = sections.find((s) => s.id === selected) ?? null;
    const filtered = visibleSections.find((s) => s.id === selected) ?? null;
    const ctx: RowCtxValue = {
        defs: bindings.defs,
        visible: query.trim() === "" || filtered == null ? null : new Set(filtered.rows.map((r) => r.id)),
        changed: bindings.changed,
        revert: bindings.revert,
    };
    const sectionChanged = section != null ? changedCount(section, bindings.changed) : 0;

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 bg-background">
                <SectionIndex
                    groups={groupSections(visibleSections)}
                    selected={selected}
                    onSelect={setWanted}
                    query={query}
                    onQuery={setQuery}
                    changed={bindings.changed}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                    {section == null ? (
                        <div className="flex h-full items-center justify-center text-[13px] text-muted">
                            No setting matches that.
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-none items-start justify-between gap-5 border-b border-edge-faint px-[28px] pb-4 pt-5">
                                <div className="min-w-0">
                                    <div className="text-[19px] font-bold tracking-[-0.01em] text-primary">
                                        {section.name}
                                    </div>
                                    <div className="mt-[5px] max-w-[520px] text-[12.5px] leading-[1.5] text-secondary">
                                        {section.blurb}
                                    </div>
                                </div>
                                {sectionChanged > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => bindings.resetSection(section)}
                                        className="flex-none cursor-pointer rounded border border-edge-mid px-[13px] py-[7px] text-[12px] font-semibold text-secondary transition-colors hover:border-edge-strong hover:text-primary"
                                    >
                                        Reset section
                                    </button>
                                ) : null}
                            </div>
                            <motion.div
                                key={section.id}
                                data-settings-section={section.id}
                                initial={reduce ? false : { opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                                className="min-w-0 flex-1 overflow-y-auto px-[28px] pb-12 pt-2"
                            >
                                <RowCtx.Provider value={ctx}>
                                    <SectionBody
                                        id={section.id}
                                        runtime={flagRuntime}
                                        onRuntime={setFlagRuntime}
                                        model={model}
                                    />
                                </RowCtx.Provider>
                            </motion.div>
                        </>
                    )}
                </div>
            </div>
        </MotionConfig>
    );
}

function SectionIndex({
    groups,
    selected,
    onSelect,
    query,
    onQuery,
    changed,
}: {
    groups: { label: string; sections: SettingSectionDef[] }[];
    selected: string | null;
    onSelect: (id: string) => void;
    query: string;
    onQuery: (q: string) => void;
    changed: ReadonlySet<string>;
}) {
    return (
        <div className="flex w-[340px] flex-none flex-col border-r border-border">
            <div className="flex-none border-b border-border">
                <SurfaceHeader
                    title="Settings"
                    subtitle="Cockpit preferences, appearance, and agent defaults."
                    border={false}
                />
                <div className="mx-[28px] mb-4 flex items-center gap-2 rounded border border-border bg-surface-raised px-2.5 py-1.5">
                    <Search size={12} className="flex-none text-muted" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        placeholder="Search settings"
                        spellCheck={false}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-primary outline-none placeholder:text-muted"
                    />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 pt-3">
                {groups.map((g) => (
                    <div key={g.label} className="mb-3.5">
                        <div className="flex items-center gap-2.5 px-1 pb-2">
                            <span className={cn(REGION_LABEL, "text-accent-soft")}>{g.label}</span>
                            <span className="h-px flex-1 bg-edge-faint" />
                            <span className="text-[10.5px] tabular-nums text-muted">{g.sections.length}</span>
                        </div>
                        <div className="flex flex-col gap-[2px]">
                            {g.sections.map((s) => {
                                const on = s.id === selected;
                                const n = changedCount(s, changed);
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        data-section={s.id}
                                        onClick={() => onSelect(s.id)}
                                        className={cn(
                                            "flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] border px-3 py-[8px] text-left transition-colors",
                                            on
                                                ? "border-accent bg-surface-hover"
                                                : "border-transparent hover:bg-surface-hover"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "min-w-0 flex-1 truncate text-[13px] font-semibold",
                                                on ? "text-primary" : "text-secondary"
                                            )}
                                        >
                                            {s.name}
                                        </span>
                                        {n > 0 ? (
                                            <span
                                                className={cn(
                                                    "flex-none rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tabular-nums tracking-[0.06em]",
                                                    on ? "bg-accentbg text-accent" : "bg-accentbg/70 text-accent-soft"
                                                )}
                                            >
                                                {n} changed
                                            </span>
                                        ) : null}
                                        <span className="flex-none text-[10.5px] tabular-nums text-muted">
                                            {countLabel(s.rows.length)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex flex-none flex-col gap-1.5 border-t border-edge-faint px-4 py-[11px]">
                <Legend scope="synced" text="synced — settings.json" />
                <Legend scope="local" text="this machine only" />
            </div>
        </div>
    );
}

function Legend({ scope, text }: { scope: "synced" | "local"; text: string }) {
    return (
        <div className="flex items-center gap-[7px] text-[10.5px] text-muted">
            <ScopeDot scope={scope} />
            {text}
        </div>
    );
}

function ScopeDot({ scope }: { scope: "synced" | "local" }) {
    return (
        <span
            className={cn("h-1.5 w-1.5 flex-none rounded-[2px]", scope === "synced" ? "bg-success" : "bg-ink-faint")}
        />
    );
}

// Labeled settings row. `stacked` drops the control onto its own full-width line for the controls that
// cannot sit in a right-hand slot (the theme grid, the flag list, the runtime radios).
function SettingRow({ id, stacked, children }: { id: string; stacked?: boolean; children?: ReactNode }) {
    const ctx = useContext(RowCtx);
    const def = ctx.defs.get(id);
    if (def == null || (ctx.visible != null && !ctx.visible.has(id))) {
        return null;
    }
    const changed = ctx.changed.has(id);
    const header = (
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-primary">{def.title}</span>
                {changed ? (
                    <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-accent">
                        <span className="h-[5px] w-[5px] rounded-full bg-accent" />
                        changed
                    </span>
                ) : null}
            </div>
            <div className="mt-[3px] max-w-[440px] text-[12px] leading-[1.5] text-muted">{def.desc}</div>
            {def.key != null ? (
                <div className="mt-1.5 flex items-center gap-[7px] font-mono text-[10.5px] text-muted">
                    {def.scope != null ? <ScopeDot scope={def.scope} /> : null}
                    {rowKeys(def).join(" · ")}
                </div>
            ) : null}
        </div>
    );
    const revert = changed ? (
        <button
            type="button"
            onClick={() => ctx.revert(id)}
            className="flex-none cursor-pointer text-[11.5px] font-semibold text-muted transition-colors hover:text-primary"
        >
            Revert
        </button>
    ) : null;

    if (stacked) {
        return (
            <div data-setting-row={id} className="border-b border-edge-faint py-[15px]">
                <div className="flex items-start justify-between gap-6">
                    {header}
                    {revert}
                </div>
                <div className="mt-3">{children}</div>
            </div>
        );
    }
    return (
        <div
            data-setting-row={id}
            className="flex items-center justify-between gap-6 border-b border-edge-faint py-[15px]"
        >
            {header}
            <div className="flex flex-none items-center gap-2.5">
                {children}
                {revert}
            </div>
        </div>
    );
}

function Note({ tone = "warning", children }: { tone?: "warning" | "error"; children: ReactNode }) {
    return (
        <div
            className={cn(
                "mt-4 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[12.5px] leading-[1.55]",
                tone === "warning"
                    ? "border-warning/35 bg-warning/[0.08] text-warning-soft"
                    : "border-error/40 bg-error/[0.08] text-error"
            )}
        >
            {children}
        </div>
    );
}

function Value({ children, warn }: { children: ReactNode; warn?: boolean }) {
    return <span className={cn("text-[12.5px]", warn ? "text-warning" : "text-secondary")}>{children}</span>;
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onToggle}
            className={cn(
                "relative h-[23px] w-[42px] shrink-0 cursor-pointer rounded-full transition-colors",
                on ? "bg-accent" : "bg-surface-selected"
            )}
        >
            <span
                className={cn(
                    "absolute top-[2px] h-[19px] w-[19px] rounded-full bg-white shadow-popover-line transition-all",
                    on ? "left-[21px]" : "left-[2px]"
                )}
            />
        </button>
    );
}

// Segmented pill group. Labels render in the UI font (matching the design).
function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { id: T; label: string }[];
    value: T;
    onChange: (id: T) => void;
}) {
    return (
        <div className="flex overflow-hidden rounded border border-edge-mid bg-surface-raised">
            {options.map((o, i) => (
                <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange(o.id)}
                    className={cn(
                        "cursor-pointer whitespace-nowrap px-3 py-[6px] text-[11.5px] font-semibold transition-colors",
                        i > 0 && "border-l border-border",
                        value === o.id ? "bg-accentbg text-accent" : "text-secondary hover:text-primary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// +/- stepper. onStep receives -1 or 1; the caller applies its own step size.
function Stepper({ value, onStep, ariaLabel }: { value: number; onStep: (dir: -1 | 1) => void; ariaLabel: string }) {
    return (
        <div className="flex items-center overflow-hidden rounded border border-edge-mid bg-surface-raised">
            <button
                type="button"
                aria-label={`Decrease ${ariaLabel}`}
                onClick={() => onStep(-1)}
                className="h-[28px] w-[28px] cursor-pointer border-r border-border text-[15px] font-semibold text-secondary hover:bg-surface-hover"
            >
                −
            </button>
            <div className="min-w-[52px] px-2 text-center text-[12px] tabular-nums text-primary">{value}</div>
            <button
                type="button"
                aria-label={`Increase ${ariaLabel}`}
                onClick={() => onStep(1)}
                className="h-[28px] w-[28px] cursor-pointer border-l border-border text-[15px] font-semibold text-secondary hover:bg-surface-hover"
            >
                +
            </button>
        </div>
    );
}

// A text field that commits on blur or Enter and abandons on Escape — the page's one commit model,
// minus a settings.json write per keystroke. The stored value only overwrites the draft when it moves
// on its own (a Revert, or another window's write), so committing never flashes the old text back.
function CommitText({
    value,
    placeholder,
    disabled,
    width = "w-[300px]",
    list,
    onCommit,
    children,
}: {
    value: string;
    placeholder: string;
    disabled?: boolean;
    width?: string;
    list?: string; // id of a <datalist> offering values
    onCommit: (v: string) => void;
    children?: ReactNode;
}) {
    const [draft, setDraft] = useState(value);
    const external = useRef(value);
    useEffect(() => {
        if (value !== external.current) {
            external.current = value;
            setDraft(value);
        }
    }, [value]);
    const commit = () => {
        const next = draft.trim();
        external.current = next;
        if (next !== value) {
            onCommit(next);
        }
    };
    return (
        <div className={cn("relative", width)}>
            <input
                type="text"
                value={draft}
                placeholder={placeholder}
                disabled={disabled}
                list={list}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        commit();
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        setDraft(value);
                        e.currentTarget.blur();
                    }
                }}
                className={cn(
                    "w-full rounded border border-edge-mid bg-surface-raised py-[6px] pl-2.5 text-[12px] text-primary outline-none focus:border-accent-700",
                    children != null ? "pr-9" : "pr-2.5",
                    disabled && "cursor-not-allowed opacity-40"
                )}
            />
            {children}
        </div>
    );
}

// Write-only key field. There is nothing to sync down from, so it keeps its own draft and clears only
// once the key actually lands — a failed write leaves what you pasted in place. Enter blurs the field, so
// Enter and the blur both commit; the gate drops the second while the first is in flight.
function SecretInput({ placeholder, onCommit }: { placeholder: string; onCommit: (v: string) => Promise<boolean> }) {
    const [draft, setDraft] = useState("");
    const [gate] = useState(createCommitGate);
    const commit = () => {
        const v = draft.trim();
        if (v === "") {
            return;
        }
        const pending = gate.commit(v, onCommit);
        if (pending == null) {
            return;
        }
        fireAndForget(async () => {
            if (await pending) {
                setDraft("");
            }
        });
    };
    return (
        <input
            type="password"
            value={draft}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    commit();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    setDraft("");
                    e.currentTarget.blur();
                }
            }}
            className="w-[300px] rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[12px] text-primary outline-none focus:border-accent-700"
        />
    );
}

function SectionBody({
    id,
    runtime,
    onRuntime,
    model,
}: {
    id: string;
    runtime: Runtime;
    onRuntime: (r: Runtime) => void;
    model: AgentsViewModel;
}) {
    switch (id) {
        case "appearance":
            return <AppearanceSection />;
        case "fonts":
            return <FontsSection />;
        case "general":
            return <GeneralSection />;
        case "notifications":
            return <NotificationsSection />;
        case "newagent":
            return <NewAgentSection runtime={runtime} onRuntime={onRuntime} />;
        case "run":
            return <RunRouteSection />;
        case "claudeaccount":
            return <ClaudeAccountSection model={model} />;
        case "terminal":
            return <TerminalSection />;
        case "memory":
            return <MemorySection />;
        case "headless":
            return <HeadlessAISection />;
        case "about":
            return <AboutSection />;
        default:
            return null;
    }
}

function AppearanceSection() {
    const [preset, setPreset] = useAtom(themePresetAtom);
    const [overrides, setOverrides] = useAtom(themeOverridesAtom);
    const palette = activePalette(preset);
    const setOverride = (role: OverrideRole, hex: string) => setOverrides((prev) => ({ ...prev, [role]: hex }));
    const accent = colorOf(palette, overrides, "accent");
    const statusRoles: OverrideRole[] = ["success", "warning", "error"];
    return (
        <div>
            <SettingRow id="appearance.theme" stacked>
                <div data-theme-presets className="grid grid-cols-3 gap-2.5">
                    {THEMES.map((t) => {
                        const on = t.id === preset;
                        return (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => setPreset(t.id)}
                                className={cn(
                                    "flex cursor-pointer items-center gap-2.5 rounded-[11px] border p-[10px] text-left transition-colors",
                                    on ? "border-accent-700 bg-surface-hover" : "border-border hover:border-edge-strong"
                                )}
                            >
                                <div className="grid flex-none grid-cols-2 gap-[3px]">
                                    <Swatch color={t.palette.bg} />
                                    <Swatch color={t.palette.surface} />
                                    <Swatch color={t.palette.accent} />
                                    <Swatch color={t.palette.success} />
                                </div>
                                <span
                                    className={cn(
                                        "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
                                        on ? "text-primary" : "text-secondary"
                                    )}
                                >
                                    {t.name}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </SettingRow>

            <SettingRow id="appearance.accent">
                <div className="flex items-center gap-[7px]">
                    {ACCENT_SWATCHES.map((hex) => (
                        <button
                            key={hex}
                            type="button"
                            title={hex}
                            onClick={() => setOverride("accent", hex)}
                            className="h-[22px] w-[22px] cursor-pointer rounded-sm border-2 p-0"
                            style={{
                                background: hex,
                                borderColor:
                                    hex.toLowerCase() === accent.toLowerCase() ? "var(--color-primary)" : "transparent",
                            }}
                        />
                    ))}
                    <label
                        title="Custom hex"
                        className="relative flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-edge-mid"
                    >
                        <span className="pointer-events-none absolute text-[12px] font-bold text-muted">
                            +
                        </span>
                        <input
                            type="color"
                            value={accent}
                            onChange={(e) => setOverride("accent", e.target.value)}
                            className="h-[36px] w-[36px] cursor-pointer opacity-0"
                        />
                    </label>
                </div>
            </SettingRow>

            {statusRoles.map((role) => {
                const hex = colorOf(palette, overrides, role);
                return (
                    <SettingRow key={role} id={`appearance.${role}`}>
                        <div className="flex items-center gap-[9px]">
                            <span className="font-mono text-[11px] text-muted">{hex}</span>
                            <label className="block h-[24px] w-[34px] cursor-pointer overflow-hidden rounded border border-edge-mid">
                                <input
                                    type="color"
                                    value={hex}
                                    onChange={(e) => setOverride(role, e.target.value)}
                                    className="m-[-5px] h-[34px] w-[44px] cursor-pointer"
                                />
                            </label>
                        </div>
                    </SettingRow>
                );
            })}
        </div>
    );
}

function Swatch({ color }: { color: string }) {
    return <span className="h-[13px] w-[13px] rounded-[4px]" style={{ background: color }} />;
}

// Interface (--font-sans) and Code (--font-mono) are cockpit CSS-var overrides; Terminal is the backend
// term:fontfamily config key.
function FontsSection() {
    const [sans, setSans] = useAtom(fontSansAtom);
    const [mono, setMono] = useAtom(fontMonoAtom);
    const termFontStack = (useAtomValue(getSettingsKeyAtom("term:fontfamily")) as string) ?? "";
    // terminal font is stored as the full stack string; match it back to a catalog id for the control.
    const termFontId = MONO_FONTS.find((f) => f.stack === termFontStack)?.id ?? DEFAULT_TERM_FONT;
    const sansOpts = SANS_FONTS.map((f) => ({ id: f.id, label: f.label }));
    const monoOpts = MONO_FONTS.map((f) => ({ id: f.id, label: f.label }));
    return (
        <div>
            <SettingRow id="fonts.sans">
                <Segmented options={sansOpts} value={sans} onChange={setSans} />
            </SettingRow>
            <SettingRow id="fonts.mono">
                <Segmented options={monoOpts} value={mono} onChange={setMono} />
            </SettingRow>
            <SettingRow id="fonts.term">
                <Segmented
                    options={monoOpts}
                    value={termFontId}
                    onChange={(id) => writeConfig({ "term:fontfamily": stackOf(MONO_FONTS, id) })}
                />
            </SettingRow>
        </div>
    );
}

function GeneralSection() {
    const [startup, setStartup] = useAtom(startupSurfaceAtom);
    const [railVisible, setRailVisible] = useAtom(railVisibleAtom);
    const options = startupSurfaceOptions();
    return (
        <div>
            {/* stacked: the startup choices are a full-width grid — as a right-hand segmented group they
                would push the row past the pane on a narrow window. */}
            <SettingRow id="general.startup" stacked>
                <div
                    className="grid overflow-hidden rounded border border-edge-mid bg-surface-raised"
                    style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
                >
                    {options.map((k, i) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setStartup(k)}
                            className={cn(
                                "cursor-pointer whitespace-nowrap px-2 py-[8px] text-[12px] font-semibold transition-colors",
                                i > 0 && "border-l border-border",
                                startup === k ? "bg-accentbg text-accent" : "text-secondary hover:text-primary"
                            )}
                        >
                            {startupLabel(k)}
                        </button>
                    ))}
                </div>
            </SettingRow>
            <SettingRow id="general.rail">
                <Toggle
                    on={railVisible}
                    onToggle={() => setRailVisible((v) => !v)}
                    label="Show details rail by default"
                />
            </SettingRow>
        </div>
    );
}

function NewAgentSection({ runtime, onRuntime }: { runtime: Runtime; onRuntime: (r: Runtime) => void }) {
    const [flags, setFlags] = useAtom(naFlagsAtom);
    const [remember, setRemember] = useAtom(naRememberFlagsAtom);
    const catalog = RUNTIME_FLAGS[runtime];
    const runtimeFlags = flags[runtime] ?? {};
    const setFlag = (id: string, on: boolean) =>
        setFlags((prev) => ({ ...prev, [runtime]: { ...prev[runtime], [id]: on } }));
    return (
        <div>
            <SettingRow id="newagent.remember">
                <Toggle on={remember} onToggle={() => setRemember((v) => !v)} label="Remember flags" />
            </SettingRow>
            <SettingRow id="newagent.runtime">
                <Segmented
                    options={FLAG_RUNTIMES.map((r) => ({ id: r.id, label: r.name }))}
                    value={runtime}
                    onChange={onRuntime}
                />
            </SettingRow>
            {catalog.length === 0 ? (
                <div className="py-4 text-[12px] text-muted">
                    {FLAG_RUNTIMES.find((r) => r.id === runtime)?.name} takes no launch flags.
                </div>
            ) : (
                catalog.map((f) => {
                    const on = !!runtimeFlags[f.id];
                    return (
                        <SettingRow key={f.id} id={flagRowId(runtime, f.id)}>
                            <Toggle on={on} onToggle={() => setFlag(f.id, !on)} label={f.flag} />
                        </SettingRow>
                    );
                })
            )}
        </div>
    );
}

function RunRouteSection() {
    const preference = useAtomValue(harnessPreferenceAtom);
    const leadRuntimes = useAtomValue(leadRuntimesAtom);
    return (
        <div>
            <SettingRow id="run.route">
                <RoutePicker
                    value={preference.route}
                    canInherit={false}
                    runtimes={leadRuntimes}
                    onChange={(route) => route && setPreferredRoute(route)}
                />
            </SettingRow>
            {preference.error ? <Note tone="error">{preference.error}</Note> : null}
        </div>
    );
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// shell-side: the dialog embeds CockpitFocusPane, which view/agents must not import statically
const ClaudeSigninModal = lazy(() =>
    import("@/app/cockpit/claude-signin-modal").then((m) => ({ default: m.ClaudeSigninModal }))
);

// the emails the account rows and the paste form offer (KnownEmailsDatalist)
const EMAIL_LIST_ID = "claude-known-emails";

function quotaPct(pct: number | undefined): string {
    return pct == null ? "—" : `${Math.round(pct)}%`;
}

// The account list and the tokens live behind the claudeaccount RPCs, not in settings; only the active
// id is a setting (claude:activeaccount). wavesrv applies that setting to its own environment before it
// broadcasts the change, so re-listing whenever the setting moves reads back what was actually applied —
// `active` falls back to Default when the account's token is gone, and the radios show that, not the
// setting.
function ClaudeAccountSection({ model }: { model: AgentsViewModel }) {
    const setting = (useAtomValue(getSettingsKeyAtom("claude:activeaccount")) as string) ?? "";
    const saved = useAtomValue(savedRateLimitsAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const [list, setList] = useState<CommandClaudeAccountListRtnData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteLabel, setPasteLabel] = useState("");
    const [pasteEmail, setPasteEmail] = useState("");
    const [pasteError, setPasteError] = useState<string | null>(null);
    const [signinOpen, setSigninOpen] = useState(false);
    // bumped when a rename is cleared to nothing: remounting the field puts the stored label back
    const [renameReset, setRenameReset] = useState(0);

    const reload = () =>
        fireAndForget(async () => {
            try {
                const next = await RpcApi.ClaudeAccountListCommand(TabRpcClient);
                setList(next);
                // snapshots are filed under the accounts' emails: every add, rename, remove and set-email
                // lands here, so the rest of the app learns the new identity too
                setClaudeIdentity(identityFromList(next));
            } catch (e) {
                setError(errorText(e));
            }
        });
    useEffect(() => {
        reload();
    }, [setting]);

    const active = list?.active ?? null;
    const select = (id: string) => {
        if (id === active) {
            return;
        }
        setError(null);
        writeConfig({ "claude:activeaccount": id });
        setList((prev) => (prev == null ? prev : { ...prev, active: id }));
        const candidates = restartCandidates(globalStore.get(model.agentsAtom), id);
        if (candidates.length > 0) {
            modalsModel.pushModal("ClaudeAccountRestartModal", { candidates, account: id });
        }
    };
    const rename = (id: string, label: string) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.ClaudeAccountRenameCommand(TabRpcClient, { id, label });
            } catch (e) {
                setError(errorText(e));
            }
            reload();
        });
    const setEmail = (id: string, email: string) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.ClaudeAccountSetEmailCommand(TabRpcClient, { id, email });
            } catch (e) {
                setError(errorText(e));
            }
            reload();
        });
    // the backend switches to Default first when the account is the active one
    const remove = (a: ClaudeAccountData) =>
        modalsModel.pushModal("ConfirmModal", {
            title: "Remove account",
            message: `Xoá "${a.label}" khỏi máy này? Token của nó bị xoá theo.${a.id === active ? " Agent mới sẽ chạy trên Default (/login)." : ""}`,
            confirmLabel: "Remove",
            destructive: true,
            onConfirm: () =>
                fireAndForget(async () => {
                    setError(null);
                    try {
                        await RpcApi.ClaudeAccountRemoveCommand(TabRpcClient, { id: a.id });
                    } catch (e) {
                        setError(errorText(e));
                    }
                    reload();
                }),
        });
    // write-only: the token never comes back. A refused one stays in the field, with the reason under it.
    const add = async (token: string): Promise<boolean> => {
        setPasteError(null);
        try {
            await RpcApi.ClaudeAccountAddCommand(TabRpcClient, {
                label: pasteLabel.trim(),
                token,
                email: pasteEmail.trim(),
            });
        } catch (e) {
            setPasteError(errorText(e));
            return false;
        }
        setPasteLabel("");
        setPasteEmail("");
        reload();
        return true;
    };

    const now = Date.now();
    const rows: { id: string; account?: ClaudeAccountData }[] = [
        { id: "" },
        ...(list?.accounts ?? []).map((a) => ({ id: a.id, account: a })),
    ];
    return (
        <div className="py-[15px]">
            <KnownEmailsDatalist id={EMAIL_LIST_ID} />
            <div role="radiogroup" aria-label="claude account" className="flex flex-col gap-1.5">
                {rows.map(({ id, account }) => {
                    const on = id === active;
                    const quota = rowQuota(saved, claudeQuotaKey(id, identity), now);
                    return (
                        <div
                            key={id || "default"}
                            role="radio"
                            aria-checked={on}
                            tabIndex={0}
                            data-claude-account-row={id || "default"}
                            onClick={() => select(id)}
                            onKeyDown={(e) => {
                                if (e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) {
                                    e.preventDefault();
                                    select(id);
                                }
                            }}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border p-[10px] text-left transition-colors",
                                on ? "border-accent-700 bg-surface-hover" : "border-border hover:border-edge-strong"
                            )}
                        >
                            <span
                                className={cn(
                                    "flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 transition-colors",
                                    on ? "border-accent" : "border-edge-strong"
                                )}
                            >
                                {on ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                            </span>
                            {account == null ? (
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span
                                        className={cn(
                                            "truncate text-[13px] font-semibold",
                                            on ? "text-primary" : "text-secondary"
                                        )}
                                    >
                                        Default (/login)
                                    </span>
                                    {identity.loginEmail ? (
                                        <span
                                            data-claude-account-login-email
                                            className="truncate text-[11px] text-muted"
                                        >
                                            {identity.loginEmail}
                                        </span>
                                    ) : null}
                                </span>
                            ) : (
                                // the rename and email fields and Remove sit inside the row; their clicks must not select it
                                <span
                                    data-claude-account-rename={id}
                                    className="flex min-w-0 flex-1 flex-col gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => e.stopPropagation()}
                                >
                                    <CommitText
                                        key={renameReset}
                                        value={account.label}
                                        placeholder="Account label"
                                        width="w-[220px]"
                                        onCommit={(v) => (v === "" ? setRenameReset((n) => n + 1) : rename(id, v))}
                                    />
                                    <span data-claude-account-email={id}>
                                        <CommitText
                                            value={account.email ?? ""}
                                            placeholder="chưa gắn email"
                                            width="w-[220px]"
                                            list={EMAIL_LIST_ID}
                                            onCommit={(v) => setEmail(id, v)}
                                        />
                                    </span>
                                </span>
                            )}
                            <span className="flex-none text-[11px] tabular-nums text-muted">
                                {quota == null
                                    ? "chưa dùng"
                                    : `5h ${quotaPct(quota.fivehourpct)} · tuần ${quotaPct(quota.weekpct)} · đo ${formatAgeShort(now - quota.capturedAt)} trước`}
                            </span>
                            {account != null ? (
                                <button
                                    type="button"
                                    data-claude-account-remove={id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        remove(account);
                                    }}
                                    className="flex-none cursor-pointer rounded border border-edge-mid px-2.5 py-[4px] text-[11.5px] font-semibold text-secondary transition-colors hover:border-error/50 hover:text-error"
                                >
                                    Remove
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 flex items-center gap-2.5">
                <button
                    type="button"
                    data-claude-account-signin
                    onClick={() => setSigninOpen(true)}
                    className="cursor-pointer rounded border border-edge-mid px-3 py-[6px] text-[12px] font-semibold text-secondary transition-colors hover:border-edge-strong hover:text-primary"
                >
                    + Đăng nhập account
                </button>
                <button
                    type="button"
                    data-claude-account-paste
                    aria-expanded={pasteOpen}
                    onClick={() => setPasteOpen((v) => !v)}
                    className="cursor-pointer text-[12px] font-semibold text-muted transition-colors hover:text-primary"
                >
                    {pasteOpen ? "▾" : "▸"} Dán token
                </button>
            </div>
            {pasteOpen ? (
                <div className="mt-3 flex flex-col gap-2 rounded-[11px] border border-border p-3">
                    <div className="text-[12px] leading-[1.5] text-muted">
                        Token từ <span className="font-mono">claude setup-token</span> (bắt đầu bằng{" "}
                        <span className="font-mono">sk-ant-oat</span>). Enter để lưu.
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <input
                            type="text"
                            data-claude-account-paste-label
                            value={pasteLabel}
                            placeholder="Label (mặc định Account N)"
                            spellCheck={false}
                            onChange={(e) => setPasteLabel(e.target.value)}
                            className="w-[200px] rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[12px] text-primary outline-none focus:border-accent-700"
                        />
                        <input
                            type="text"
                            data-claude-account-paste-email
                            value={pasteEmail}
                            list={EMAIL_LIST_ID}
                            placeholder="Email (không bắt buộc)"
                            spellCheck={false}
                            onChange={(e) => setPasteEmail(e.target.value)}
                            className="w-[200px] rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[12px] text-primary outline-none focus:border-accent-700"
                        />
                        <span data-claude-account-paste-token>
                            <SecretInput placeholder="sk-ant-oat01-…" onCommit={add} />
                        </span>
                    </div>
                    {pasteError ? (
                        <div data-claude-account-error className="text-[12px] text-error">
                            {pasteError}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {error ? <Note tone="error">{error}</Note> : null}
            {signinOpen ? (
                <Suspense fallback={null}>
                    <ClaudeSigninModal onClose={() => setSigninOpen(false)} onAdded={reload} />
                </Suspense>
            ) : null}
        </div>
    );
}

function TerminalSection() {
    const fontSize = (useAtomValue(getSettingsKeyAtom("term:fontsize")) as number) ?? 12;
    const scrollback = (useAtomValue(getSettingsKeyAtom("term:scrollback")) as number) ?? 1000;
    const cursorRaw = (useAtomValue(getSettingsKeyAtom("term:cursor")) as string) ?? "block";
    const cursorBlink = (useAtomValue(getSettingsKeyAtom("term:cursorblink")) as boolean) ?? false;
    const copyOnSelect = (useAtomValue(getSettingsKeyAtom("term:copyonselect")) as boolean) ?? false;

    const cursor = cursorRaw === "bar" || cursorRaw === "underline" ? cursorRaw : "block";

    const stepFontSize = (dir: -1 | 1) => {
        const next = coerceFontSize(String(fontSize + dir));
        if (next != null && next !== fontSize) writeConfig({ "term:fontsize": next });
    };
    const stepScrollback = (dir: -1 | 1) => {
        const next = coerceScrollback(String(Math.max(100, scrollback + dir * 250)));
        if (next != null && next !== scrollback) writeConfig({ "term:scrollback": next });
    };

    return (
        <div>
            <SettingRow id="terminal.fontsize">
                <Stepper value={fontSize} onStep={stepFontSize} ariaLabel="font size" />
            </SettingRow>
            <SettingRow id="terminal.cursor">
                <Segmented
                    options={[
                        { id: "block", label: "Block" },
                        { id: "bar", label: "Bar" },
                        { id: "underline", label: "Underline" },
                    ]}
                    value={cursor}
                    onChange={(v) => writeConfig({ "term:cursor": v })}
                />
            </SettingRow>
            <SettingRow id="terminal.cursorblink">
                <Toggle
                    on={cursorBlink}
                    onToggle={() => writeConfig({ "term:cursorblink": !cursorBlink })}
                    label="Cursor blink"
                />
            </SettingRow>
            <SettingRow id="terminal.scrollback">
                <Stepper value={scrollback} onStep={stepScrollback} ariaLabel="scrollback" />
            </SettingRow>
            <SettingRow id="terminal.copyonselect">
                <Toggle
                    on={copyOnSelect}
                    onToggle={() => writeConfig({ "term:copyonselect": !copyOnSelect })}
                    label="Copy on select"
                />
            </SettingRow>
        </div>
    );
}

function NotificationsSection() {
    const os = (useAtomValue(getSettingsKeyAtom("notify:os")) as boolean | undefined) ?? true;
    const toast = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const reply = (useAtomValue(getSettingsKeyAtom("notify:reply")) as boolean | undefined) ?? true;
    return (
        <div>
            <SettingRow id="notifications.os">
                <Toggle on={os} onToggle={() => writeConfig({ "notify:os": !os })} label="OS notifications" />
            </SettingRow>
            <SettingRow id="notifications.toast">
                <Toggle on={toast} onToggle={() => writeConfig({ "notify:toast": !toast })} label="In-app toasts" />
            </SettingRow>
            <SettingRow id="notifications.reply">
                <Toggle
                    on={reply}
                    onToggle={() => writeConfig({ "notify:reply": !reply })}
                    label="When an agent finishes"
                />
            </SettingRow>
        </div>
    );
}

function MemorySection() {
    const stored = (useAtomValue(getSettingsKeyAtom("memory:vaultpath")) as string) ?? "";
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<VaultStatusRtnData | null>(null);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const loadStatus = () =>
        fireAndForget(async () => {
            try {
                setStatus(await RpcApi.VaultStatusCommand(TabRpcClient));
            } catch (e) {
                setRemoteError(String(e));
            }
        });
    useEffect(() => {
        loadStatus();
    }, []);
    const setRemote = (url: string) =>
        fireAndForget(async () => {
            setRemoteError(null);
            try {
                await RpcApi.VaultSetRemoteCommand(TabRpcClient, { url: url.trim() });
            } catch (e) {
                setRemoteError(String(e));
            }
            loadStatus();
        });
    const statusLine = vaultStatusLine(status);
    // validate before persisting: an empty path clears the override (falls back to the default vault),
    // otherwise the folder must exist and be a directory. reuses FileInfoCommand (bare local path, ~
    // expanded by the backend) instead of a dedicated RPC — mirrors the New Project picker's stat check.
    const commit = (path: string) =>
        fireAndForget(async () => {
            setError(null);
            if (path !== "") {
                try {
                    const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
                    const err = vaultPathError(info);
                    if (err) {
                        setError(err);
                        return;
                    }
                } catch (e) {
                    setError(String(e));
                    return;
                }
            }
            writeConfig({ "memory:vaultpath": path });
        });
    // native OS folder picker (Tauri dialog plugin), mirroring newprojectmodal's browse. dynamic import
    // keeps non-Tauri contexts (preview, vitest) clean.
    const browse = () =>
        fireAndForget(async () => {
            try {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const picked = await open({ directory: true, multiple: false, title: "Select vault folder" });
                if (typeof picked === "string" && picked) {
                    commit(picked);
                }
            } catch (e) {
                console.error("vault folder picker failed", e);
            }
        });
    return (
        <div>
            <SettingRow id="memory.vaultpath">
                <CommitText value={stored} placeholder="~/vault" onCommit={commit}>
                    <button
                        type="button"
                        onClick={browse}
                        title="Browse for folder"
                        aria-label="Browse for folder"
                        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                    >
                        <Folder size={14} />
                    </button>
                </CommitText>
            </SettingRow>
            {error ? <Note tone="error">{error}</Note> : null}
            <SettingRow id="memory.remote">
                <CommitText value={status?.remoteurl ?? ""} placeholder="git@host:you/vault.git" onCommit={setRemote} />
            </SettingRow>
            {remoteError ? <Note tone="error">{remoteError}</Note> : null}
            {statusLine ? <div className="px-1 pb-2 text-[11.5px] tabular-nums text-muted">{statusLine}</div> : null}
        </div>
    );
}

function HeadlessAISection() {
    const runtime = (useAtomValue(getSettingsKeyAtom("headless:runtime")) as string) ?? "";
    const cheapModel = (useAtomValue(getSettingsKeyAtom("headless:openroutercheapmodel")) as string) ?? "";
    const auditRuntime = (useAtomValue(getSettingsKeyAtom(RADAR_AUDIT_RUNTIME_KEY)) as string) ?? "";
    const auditModel = (useAtomValue(getSettingsKeyAtom(RADAR_AUDIT_MODEL_KEY)) as string) ?? "";

    const [hasKey, setHasKey] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
    useEffect(() => {
        fireAndForget(async () => {
            try {
                const names = await RpcApi.GetSecretsNamesCommand(TabRpcClient);
                setHasKey((names ?? []).includes(OPENROUTER_SECRET_NAME));
            } catch (_) {
                // best-effort probe; the key warning below simply stays "missing" on failure
            }
        });
        fireAndForget(async () => {
            try {
                const rtn = await RpcApi.ListHarnessesCommand(TabRpcClient);
                setHarnesses(rtn?.harnesses ?? []);
            } catch (_) {
                // best-effort probe; a failed catalog leaves the selector with openrouter only
            }
        });
    }, []);

    // Write-only in both directions: the UI can ask whether a key exists, never what it is.
    const saveKey = async (key: string): Promise<boolean> => {
        setError(null);
        try {
            await RpcApi.SetSecretsCommand(TabRpcClient, { [OPENROUTER_SECRET_NAME]: key });
            setHasKey(true);
            return true;
        } catch (e) {
            setError(String(e));
            return false;
        }
    };

    // A null value deletes the secret (wshserver_secrets takes map[string]*string). The generated client
    // types values as string, so expressing "delete" needs the cast.
    const clearKey = () =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.SetSecretsCommand(TabRpcClient, { [OPENROUTER_SECRET_NAME]: null } as unknown as Record<
                    string,
                    string
                >);
                setHasKey(false);
            } catch (e) {
                setError(String(e));
            }
        });

    // empty setting means openrouter (the backend default); only openrouter reads the model keys.
    const isOpenRouter = runtime === "" || runtime === "openrouter";
    const effectiveRuntime = isOpenRouter ? "openrouter" : runtime;

    const harnessRows = harnessPickerItems(harnesses, effectiveRuntime, "consult");
    const options = [
        {
            id: "openrouter",
            label: "OpenRouter",
            mono: "openrouter",
            selectable: true,
            isDefault: true,
            notInstalled: false,
        },
        ...harnessRows.map((h) => ({
            id: h.runtime,
            label: h.label,
            mono: h.runtime,
            selectable: h.selectable,
            isDefault: false,
            notInstalled: h.unavailableReason === "not-installed",
        })),
    ];

    const modelRow = (id: string, value: string, placeholder: string, key: string) => (
        <SettingRow id={id}>
            {!isOpenRouter ? (
                <span className="text-[10.5px] tracking-[0.02em] text-muted">openrouter only</span>
            ) : null}
            <CommitText
                value={value}
                placeholder={placeholder}
                disabled={!isOpenRouter}
                onCommit={(v) => writeConfig({ [key]: v })}
            />
        </SettingRow>
    );

    return (
        <div>
            {/* stacked: the runtime list carries an install/key status per option, which does not fit a
                right-hand control slot. */}
            <SettingRow id="headless.runtime" stacked>
                <div role="radiogroup" aria-label="headless runtime" className="flex flex-col gap-1.5">
                    {options.map((o) => {
                        const on = o.id === effectiveRuntime;
                        return (
                            <button
                                key={o.id}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                disabled={!o.selectable}
                                onClick={() => writeConfig({ "headless:runtime": o.id })}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border p-[10px] text-left transition-colors",
                                    on
                                        ? "border-accent-700 bg-surface-hover"
                                        : "border-border hover:border-edge-strong",
                                    !o.selectable && "cursor-not-allowed opacity-55 hover:border-border"
                                )}
                            >
                                <span
                                    className={cn(
                                        "flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 transition-colors",
                                        on ? "border-accent" : "border-edge-strong"
                                    )}
                                >
                                    {on ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                                </span>
                                <span
                                    className={cn(
                                        "min-w-0 flex-1 truncate text-[13px] font-semibold",
                                        on ? "text-primary" : "text-secondary"
                                    )}
                                >
                                    {o.label}
                                </span>
                                <span className="text-[10.5px] font-normal tracking-[0.02em] text-muted">
                                    {o.mono}
                                </span>
                                <span
                                    className={cn(
                                        "flex flex-none items-center gap-1.5 text-[11px] font-semibold",
                                        o.isDefault
                                            ? hasKey
                                                ? "text-accent-soft"
                                                : "text-warning-soft"
                                            : o.notInstalled
                                              ? "text-muted"
                                              : "text-success-soft"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            o.isDefault
                                                ? hasKey
                                                    ? "bg-accent"
                                                    : "bg-warning"
                                                : o.notInstalled
                                                  ? "bg-ink-faint"
                                                  : "bg-success"
                                        )}
                                    />
                                    {o.isDefault
                                        ? hasKey
                                            ? "default · key stored"
                                            : "default · key missing"
                                        : o.notInstalled
                                          ? "not installed"
                                          : "installed"}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </SettingRow>
            <SettingRow id="headless.apikey">
                <span className={cn("text-[12px] font-semibold", hasKey ? "text-success-soft" : "text-muted")}>
                    {hasKey ? "A key is stored." : "No key stored."}
                </span>
                <SecretInput
                    placeholder={hasKey ? "••••••••  (enter a new key to replace)" : "sk-or-…"}
                    onCommit={saveKey}
                />
                {hasKey ? (
                    <button
                        type="button"
                        onClick={clearKey}
                        className="flex-none cursor-pointer rounded border border-edge-mid px-3 py-[6px] text-[12px] font-semibold text-secondary transition-colors hover:border-error/50 hover:text-error"
                    >
                        Clear
                    </button>
                ) : null}
            </SettingRow>
            {modelRow("headless.cheap", cheapModel, "deepseek/deepseek-v4-flash", "headless:openroutercheapmodel")}
            <SettingRow id="headless.radaraudit">
                <RoutePicker
                    value={radarAuditRoute(auditRuntime, auditModel)}
                    title="Radar audit route"
                    runtimes={RADAR_AUDIT_RUNTIMES}
                    onChange={(route) =>
                        route &&
                        writeConfig({
                            [RADAR_AUDIT_RUNTIME_KEY]: route.runtime,
                            [RADAR_AUDIT_MODEL_KEY]: route.model ?? null,
                        })
                    }
                />
            </SettingRow>
            {isOpenRouter && !hasKey ? (
                <Note>OpenRouter key not set — background AI features stay off until a key is stored.</Note>
            ) : null}
            {error ? <Note tone="error">{error}</Note> : null}
        </div>
    );
}

// App + backend version, so the pair is inspectable rather than only shouted about by the app-bar
// pill when they disagree.
// one row per installed harness: its version, and when a newer release is out, an Update button (harnessupdatemodel.ts)
function HarnessVersions() {
    const harnesses = useAtomValue(harnessesAtom);
    const runs = useAtomValue(updateRunsAtom);
    useEffect(() => {
        if (harnesses.length === 0) {
            fireAndForget(() => loadHarnesses());
        }
    }, []);
    const rows = harnesses.flatMap((h) => {
        const state = harnessRowState(h, runs[h.runtime]);
        return state == null ? [] : [{ h, state }];
    });
    if (rows.length === 0) {
        return (
            <span data-harness-none className="text-[12.5px] text-muted">
                No harness installed.
            </span>
        );
    }
    return (
        <div className="flex flex-col divide-y divide-border rounded border border-edge-mid bg-surface-raised">
            {rows.map(({ h, state }) => (
                <div key={h.runtime} data-harness-row={h.runtime} className="flex items-center gap-3 px-3 py-[7px]">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">{h.label}</span>
                    <span className="text-[12px] tabular-nums text-muted">{state.version}</span>
                    {state.kind !== "current" ? (
                        <span
                            className={cn(
                                "max-w-[260px] truncate text-[12px]",
                                state.kind === "failed" ? "text-error" : "text-accent-soft"
                            )}
                            title={rowLabel(state)}
                        >
                            {rowLabel(state)}
                        </span>
                    ) : null}
                    {state.kind === "available" || state.kind === "failed" ? (
                        <button
                            type="button"
                            data-harness-update={h.runtime}
                            onClick={() => fireAndForget(() => updateHarness(h.runtime))}
                            className="flex-none cursor-pointer rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[3px] text-[12px] font-semibold text-secondary hover:border-accent hover:text-accent-soft"
                        >
                            Update
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

function AboutSection() {
    const version = useAtomValue(versionInfoAtom);
    const updateCheck = (useAtomValue(getSettingsKeyAtom("harness:updatecheck")) as boolean) ?? true;
    return (
        <div>
            <SettingRow id="about.app">
                <Value>{version.app}</Value>
            </SettingRow>
            <SettingRow id="about.server">
                <Value warn={version.mismatch}>{version.server}</Value>
            </SettingRow>
            <SettingRow id="about.buildtime">
                <span className="text-[12.5px] tabular-nums text-secondary">{formatBuildTime(version.buildTime)}</span>
            </SettingRow>
            <SettingRow id="about.platform">
                <Value>{version.platform}</Value>
            </SettingRow>
            <SettingRow id="about.harnesses" stacked>
                <HarnessVersions />
            </SettingRow>
            <SettingRow id="about.updatecheck">
                <Toggle
                    on={updateCheck}
                    onToggle={() => writeConfig({ "harness:updatecheck": !updateCheck })}
                    label="Check for harness updates"
                />
            </SettingRow>
            {version.mismatch ? (
                <Note>
                    The backend does not match the app — dist/bin is stale. Run `task build:backend` and restart.
                </Note>
            ) : null}
        </div>
    );
}
