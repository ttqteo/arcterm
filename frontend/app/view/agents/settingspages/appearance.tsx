// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Appearance: the palette every surface derives from, its role colors, the interface and code
// faces, and Jarvis's character, outfit and quotes. The terminal's own face is a Terminal setting.

import { PET_CHARACTER_NAME, petCharacter } from "@/app/view/jarvis/petcharacter";
import { petOutfitChoice, type PetOutfitChoice } from "@/app/view/jarvis/petoutfit";
import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import { petCharacterAtom, petOutfitChoiceAtom, petQuotesOnAtom } from "@/app/view/jarvis/petstore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { MONO_FONTS, SANS_FONTS } from "../fonts";
import { fontMonoAtom, fontSansAtom } from "../fontstore";
import { Segmented, SettingCard, SettingRow, Toggle } from "../settingsui";
import { ACCENT_SWATCHES, activePalette, colorOf, THEMES, type OverrideRole } from "../themes";
import { themeOverridesAtom, themePresetAtom } from "../themestore";

export function AppearancePage() {
    return (
        <>
            <SettingCard id="theme" label="Theme" rowId="appearance.theme">
                <ThemeChips />
            </SettingCard>
            <SettingCard id="colors" label="Colors">
                <ColorRows />
            </SettingCard>
            <SettingCard id="fonts" label="Fonts">
                <FontRows />
            </SettingCard>
            <SettingCard id="jarvis" label="Jarvis">
                <PetCharacterRow />
                <PetOutfitRow />
                <PetQuotesRow />
            </SettingCard>
        </>
    );
}

// The theme card has no row of its own to draw: the card label says Theme, and the label line carries the
// changed dot and revert. `data-theme-presets` scopes the terminal-theme scenario's preset clicks.
function ThemeChips() {
    const [preset, setPreset] = useAtom(themePresetAtom);
    return (
        <div data-theme-presets role="group" aria-label="Theme" className="grid grid-cols-3 gap-1.5 p-3">
            {THEMES.map((t) => {
                const on = t.id === preset;
                return (
                    <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPreset(t.id)}
                        className={cn(
                            "flex h-[38px] min-w-0 cursor-pointer items-center gap-2.5 rounded-sm border px-2.5 text-left text-[12.5px] font-semibold transition-colors",
                            on
                                ? "border-edge-strong bg-surface-selected text-primary"
                                : "border-edge-mid bg-surface text-secondary hover:bg-surface-hover"
                        )}
                    >
                        <span className="grid flex-none grid-cols-2 gap-[2px]">
                            <Swatch color={t.palette.bg} />
                            <Swatch color={t.palette.surface} />
                            <Swatch color={t.palette.accent} />
                            <Swatch color={t.palette.success} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {on ? <Check size={13} className="flex-none" aria-hidden /> : null}
                    </button>
                );
            })}
        </div>
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
                            className={cn(
                                "h-[18px] w-[18px] cursor-pointer rounded-sm border-2 p-0",
                                hex.toLowerCase() === accent.toLowerCase() ? "border-primary" : "border-transparent"
                            )}
                            style={{ background: hex }}
                        />
                    ))}
                    <label
                        title="Custom hex"
                        className="relative flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-edge-mid"
                    >
                        <span className="pointer-events-none absolute text-[12px] font-bold leading-none text-muted">
                            +
                        </span>
                        <input
                            type="color"
                            value={accent}
                            aria-label="Custom accent color"
                            onChange={(e) => setOverride("accent", e.target.value)}
                            className="h-[30px] w-[30px] cursor-pointer opacity-0"
                        />
                    </label>
                </div>
            </SettingRow>

            {statusRoles.map((role) => {
                const hex = colorOf(palette, overrides, role);
                return (
                    <SettingRow key={role} id={`appearance.${role}`} compact>
                        <div className="flex items-center gap-[9px]">
                            <span className="font-mono text-[11.5px] text-muted">{hex}</span>
                            <label className="block h-[18px] w-[26px] cursor-pointer overflow-hidden rounded-sm border border-edge-mid">
                                <input
                                    type="color"
                                    value={hex}
                                    aria-label={`${role} color`}
                                    onChange={(e) => setOverride(role, e.target.value)}
                                    className="m-[-6px] h-[30px] w-[38px] cursor-pointer"
                                />
                            </label>
                        </div>
                    </SettingRow>
                );
            })}
        </>
    );
}

const PET_CHARACTER_OPTIONS: { id: PetCharacter; label: string }[] = (["sprout", "minion"] as const).map((id) => ({
    id,
    label: PET_CHARACTER_NAME[id],
}));

function PetCharacterRow() {
    const [character, setCharacter] = useAtom(petCharacterAtom);
    return (
        <SettingRow id="appearance.petcharacter">
            <Segmented<PetCharacter>
                options={PET_CHARACTER_OPTIONS}
                value={petCharacter(character)}
                onChange={(id) => setCharacter(id)}
            />
        </SettingRow>
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

function PetQuotesRow() {
    const [on, setOn] = useAtom(petQuotesOnAtom);
    return (
        <SettingRow id="appearance.petquotes">
            <Toggle on={on} onToggle={() => setOn(!on)} label="Jarvis quotes" />
        </SettingRow>
    );
}

function Swatch({ color }: { color: string }) {
    return <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />;
}

// Interface (--font-sans) and Code (--font-mono) are cockpit CSS-var overrides. Each option is drawn in
// its own face, so the choice reads as what it will look like.
function FontRows() {
    const [sans, setSans] = useAtom(fontSansAtom);
    const [mono, setMono] = useAtom(fontMonoAtom);
    const sansOpts = SANS_FONTS.map((f) => ({ id: f.id, label: f.label, fontFamily: f.stack }));
    const monoOpts = MONO_FONTS.map((f) => ({ id: f.id, label: f.label, fontFamily: f.stack }));
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
