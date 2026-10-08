// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Appearance: the palette every surface derives from, its role colors, the interface and code
// faces, and Jarvis's outfit. The terminal's own face is a Terminal setting.

import { petOutfitChoice, type PetOutfitChoice } from "@/app/view/jarvis/petoutfit";
import { petOutfitChoiceAtom } from "@/app/view/jarvis/petstore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { MONO_FONTS, SANS_FONTS } from "../fonts";
import { fontMonoAtom, fontSansAtom } from "../fontstore";
import { Segmented, SettingCard, SettingRow } from "../settingsui";
import { ACCENT_SWATCHES, activePalette, colorOf, THEMES, type OverrideRole } from "../themes";
import { themeOverridesAtom, themePresetAtom } from "../themestore";

export function AppearancePage() {
    return (
        <>
            <SettingCard id="theme" label="Theme">
                <ThemeRow />
            </SettingCard>
            <SettingCard id="colors" label="Colors">
                <ColorRows />
            </SettingCard>
            <SettingCard id="fonts" label="Fonts">
                <FontRows />
            </SettingCard>
            <SettingCard id="jarvis" label="Jarvis">
                <PetOutfitRow />
            </SettingCard>
        </>
    );
}

function ThemeRow() {
    const [preset, setPreset] = useAtom(themePresetAtom);
    return (
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
    );
}

function ColorRows() {
    const preset = useAtomValue(themePresetAtom);
    const [overrides, setOverrides] = useAtom(themeOverridesAtom);
    const palette = activePalette(preset);
    const setOverride = (role: OverrideRole, hex: string) => setOverrides((prev) => ({ ...prev, [role]: hex }));
    const accent = colorOf(palette, overrides, "accent");
    const statusRoles: OverrideRole[] = ["success", "warning", "error"];
    return (
        <>
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
                        <span className="pointer-events-none absolute text-[12px] font-bold text-muted">+</span>
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
        </>
    );
}

const PET_OUTFIT_OPTIONS: { id: PetOutfitChoice; label: string }[] = [
    { id: "shirt", label: "Flag shirt" },
    { id: "flag", label: "Holds the flag" },
    { id: "off", label: "Off" },
];

function PetOutfitRow() {
    const [outfit, setOutfit] = useAtom(petOutfitChoiceAtom);
    return (
        <SettingRow id="appearance.petoutfit">
            <Segmented<PetOutfitChoice>
                options={PET_OUTFIT_OPTIONS}
                value={petOutfitChoice(outfit)}
                onChange={(id) => setOutfit(id)}
            />
        </SettingRow>
    );
}

function Swatch({ color }: { color: string }) {
    return <span className="h-[13px] w-[13px] rounded-[4px]" style={{ background: color }} />;
}

// Interface (--font-sans) and Code (--font-mono) are cockpit CSS-var overrides.
function FontRows() {
    const [sans, setSans] = useAtom(fontSansAtom);
    const [mono, setMono] = useAtom(fontMonoAtom);
    const sansOpts = SANS_FONTS.map((f) => ({ id: f.id, label: f.label }));
    const monoOpts = MONO_FONTS.map((f) => ({ id: f.id, label: f.label }));
    return (
        <>
            <SettingRow id="fonts.sans">
                <Segmented options={sansOpts} value={sans} onChange={setSans} />
            </SettingRow>
            <SettingRow id="fonts.mono">
                <Segmented options={monoOpts} value={mono} onChange={setMono} />
            </SettingRow>
        </>
    );
}
