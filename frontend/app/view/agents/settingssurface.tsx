// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings as a place you navigate: a flat index of pages on the left (with a changed-count and a search
// that reaches rows it does not render), one page of cards at a time on the right. settingsmodel.ts owns
// which rows exist and what they say; settingsui.tsx owns the card, row and control primitives;
// settingspages/ owns each page's body. This file owns the frame and where each changed row is read from.
//
// One commit model throughout — every control writes as you change it, text fields on blur or Enter.
// There are no Save buttons; a per-row Revert and a per-page Reset section replace them.

import { MOTION } from "@/app/element/motiontokens";
import { atoms } from "@/app/store/global";
import { DEFAULT_PET_CHARACTER, petCharacter } from "@/app/view/jarvis/petcharacter";
import { DEFAULT_PET_OUTFIT, petOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { DEFAULT_PET_QUOTES, petCharacterAtom, petOutfitChoiceAtom, petQuotesOnAtom } from "@/app/view/jarvis/petstore";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue } from "jotai";
import { Search } from "lucide-react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { DEFAULT_STARTUP_SURFACE, startupSurfaceAtom } from "./cockpitprefsstore";
import { DEFAULT_MONO, DEFAULT_SANS } from "./fonts";
import { fontMonoAtom, fontSansAtom } from "./fontstore";
import { RUNTIME_FLAGS, type Runtime } from "./launch";
import { DEFAULT_REMEMBER_FLAGS, naFlagsAtom, naRememberFlagsAtom } from "./naflagsstore";
import { DEFAULT_RAIL_VISIBLE, railVisibleAtom } from "./railstore";
import {
    changedCount,
    filterSections,
    flagRowId,
    resolveSectionId,
    resolveSelection,
    rowKeys,
    sectionRows,
    settingsSections,
    type SettingRowDef,
    type SettingSectionDef,
} from "./settingsmodel";
import { AboutPage } from "./settingspages/about";
import { AgentsPage } from "./settingspages/agents";
import { AppearancePage } from "./settingspages/appearance";
import { BackgroundAIPage } from "./settingspages/backgroundai";
import { GeneralPage } from "./settingspages/general";
import { TerminalPage } from "./settingspages/terminal";
import { takePendingSettingsSection } from "./settingsstore";
import { RowCtx, writeConfig, type RowCtxValue } from "./settingsui";
import type { OverrideRole } from "./themes";
import { DEFAULT_THEME_PRESET, themeOverridesAtom, themePresetAtom } from "./themestore";

const OVERRIDE_ROLES: OverrideRole[] = ["accent", "success", "warning", "error"];

// The settings as they ship, before the user's settings.json merges over them. The only way the surface
// can say which rows were changed and what Revert restores. Null against a backend older than the field:
// an empty map would read as "every set key was changed", so the marks stay off instead of lying.
const defaultSettingsAtom = atom(
    (get) => (get(atoms.fullConfigAtom)?.defaultsettings ?? null) as Record<string, unknown> | null
);

// Every value here is a scalar, so identity is enough; the ?? folds an absent key and an explicit null
// together, since both mean "not set".
function sameValue(a: unknown, b: unknown): boolean {
    return (a ?? null) === (b ?? null);
}

type LocalBinding = { changed: boolean; revert: () => void };

// Which rows differ from their default, and how to put each one back. Lives at the surface rather than
// inside the page components because the index counts changed rows for pages it never renders.
function useRowBindings(sections: SettingSectionDef[], flagRuntime: Runtime) {
    const settings = (useAtomValue(atoms.settingsAtom) ?? {}) as unknown as Record<string, unknown>;
    const defaults = useAtomValue(defaultSettingsAtom);
    const [preset, setPreset] = useAtom(themePresetAtom);
    const [overrides, setOverrides] = useAtom(themeOverridesAtom);
    const [sans, setSans] = useAtom(fontSansAtom);
    const [mono, setMono] = useAtom(fontMonoAtom);
    const [startup, setStartup] = useAtom(startupSurfaceAtom);
    const [rail, setRail] = useAtom(railVisibleAtom);
    const [character, setCharacter] = useAtom(petCharacterAtom);
    const [outfit, setOutfit] = useAtom(petOutfitChoiceAtom);
    const [quotes, setQuotes] = useAtom(petQuotesOnAtom);
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
        "appearance.petcharacter": {
            changed: petCharacter(character) !== DEFAULT_PET_CHARACTER,
            revert: () => setCharacter(DEFAULT_PET_CHARACTER),
        },
        "appearance.petoutfit": {
            changed: petOutfitChoice(outfit) !== DEFAULT_PET_OUTFIT,
            revert: () => setOutfit(DEFAULT_PET_OUTFIT),
        },
        "appearance.petquotes": { changed: quotes !== DEFAULT_PET_QUOTES, revert: () => setQuotes(DEFAULT_PET_QUOTES) },
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
        for (const row of sectionRows(section)) {
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

    // One config write for the whole page, so reverting Terminal doesn't queue six settings.json
    // rewrites back to back.
    const resetSection = (section: SettingSectionDef) => {
        const patch: Record<string, unknown> = {};
        for (const row of sectionRows(section)) {
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
            setWanted(resolveSectionId(want));
        }
    }, []);

    const section = sections.find((s) => s.id === selected) ?? null;
    const filtered = visibleSections.find((s) => s.id === selected) ?? null;
    const searching = query.trim() !== "" && filtered != null;
    const ctx: RowCtxValue = {
        defs: bindings.defs,
        visible: searching ? new Set(sectionRows(filtered).map((r) => r.id)) : null,
        visibleCards: searching ? new Set(filtered.cards.map((c) => c.id)) : null,
        changed: bindings.changed,
        revert: bindings.revert,
    };
    const sectionChanged = section != null ? changedCount(section, bindings.changed) : 0;

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 bg-background">
                <SectionIndex
                    sections={visibleSections}
                    selected={selected}
                    onSelect={setWanted}
                    query={query}
                    onQuery={setQuery}
                    changed={bindings.changed}
                />
                {section == null ? (
                    <div className="flex min-w-0 flex-1 items-center justify-center text-[13px] text-muted">
                        No setting matches that.
                    </div>
                ) : (
                    <motion.div
                        key={section.id}
                        data-settings-section={section.id}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
                        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
                    >
                        <div className="flex max-w-[720px] flex-col gap-[22px] px-10 pb-12 pt-7">
                            <div className="flex items-start gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="text-[18px] font-bold tracking-[-0.01em] text-primary">
                                        {section.name}
                                    </div>
                                    <div className="mt-1 max-w-[560px] text-[12.5px] leading-[1.5] text-muted">
                                        {section.blurb}
                                    </div>
                                </div>
                                {sectionChanged > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => bindings.resetSection(section)}
                                        className="mt-0.5 flex-none cursor-pointer rounded-sm border border-edge-mid px-2.5 py-1 text-[12px] font-semibold text-ink-mid transition-colors hover:bg-surface-hover hover:text-primary"
                                    >
                                        Reset section
                                    </button>
                                ) : null}
                            </div>
                            <RowCtx.Provider value={ctx}>
                                <SectionBody
                                    id={section.id}
                                    runtime={flagRuntime}
                                    onRuntime={setFlagRuntime}
                                    model={model}
                                />
                            </RowCtx.Provider>
                        </div>
                    </motion.div>
                )}
            </div>
        </MotionConfig>
    );
}

function SectionIndex({
    sections,
    selected,
    onSelect,
    query,
    onQuery,
    changed,
}: {
    sections: SettingSectionDef[];
    selected: string | null;
    onSelect: (id: string) => void;
    query: string;
    onQuery: (q: string) => void;
    changed: ReadonlySet<string>;
}) {
    return (
        <div className="flex w-[240px] flex-none flex-col gap-3.5 border-r border-border px-3 py-4">
            <div className="flex h-[30px] flex-none items-center gap-2 rounded-sm border border-edge-mid bg-surface px-2.5">
                <Search size={13} className="flex-none text-muted" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => onQuery(e.target.value)}
                    placeholder="Search settings"
                    spellCheck={false}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
                />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
                {sections.map((s) => {
                    const on = s.id === selected;
                    const n = changedCount(s, changed);
                    return (
                        <button
                            key={s.id}
                            type="button"
                            data-section={s.id}
                            onClick={() => onSelect(s.id)}
                            className={cn(
                                "flex h-8 w-full flex-none cursor-pointer items-center gap-2 rounded-sm px-2.5 text-left text-[13px] font-medium transition-colors",
                                on ? "bg-surface-selected text-primary" : "text-ink-mid hover:bg-surface-hover"
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            {n > 0 ? (
                                <span
                                    data-section-changed={n}
                                    className="flex flex-none items-center gap-[5px] text-[11px] font-semibold tabular-nums text-muted"
                                >
                                    <span className="h-[5px] w-[5px] rounded-full bg-accent" />
                                    {n}
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
        </div>
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
        case "general":
            return <GeneralPage />;
        case "appearance":
            return <AppearancePage />;
        case "terminal":
            return <TerminalPage />;
        case "agents":
            return <AgentsPage model={model} runtime={runtime} onRuntime={onRuntime} />;
        case "headless":
            return <BackgroundAIPage />;
        case "about":
            return <AboutPage />;
        default:
            return null;
    }
}
