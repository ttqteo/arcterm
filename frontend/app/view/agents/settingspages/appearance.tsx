// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Appearance: the palette every surface derives from, its role colors, the interface and code
// faces, Jarvis's character, outfit and quotes, the Cockpit office's animation and work hours, and what an agent row in the sidebar shows. The terminal's own face is
// a Terminal setting.

import { PET_CHARACTER_NAME, petCharacter } from "@/app/view/jarvis/petcharacter";
import { petOutfitChoice, type PetOutfitChoice } from "@/app/view/jarvis/petoutfit";
import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import { petCharacterAtom, petOutfitChoiceAtom, petQuotesOnAtom } from "@/app/view/jarvis/petstore";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Check } from "lucide-react";
import { useContext, useState } from "react";
import { MONO_FONTS, SANS_FONTS } from "../fonts";
import { fontMonoAtom, fontSansAtom } from "../fontstore";
import { sanitizeHours, type WorkHours } from "../officebehavior";
import { officeAnimation, officeAnimationAtom, officeHoursAtom } from "../officestore";
import { ROW_FIELD_ROWS } from "../rowfields";
import { rowFieldsAtom } from "../rowfieldsstore";
import { RowCtx, Segmented, Select, SettingCard, SettingRow, Toggle } from "../settingsui";
import { chipSwatches, offersSpiderTheme, SPIDER_THEME } from "../themedecor";
import { SmallSpider } from "../themedecorview";
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
            <SettingCard id="office" label="Office">
                <OfficeAnimationRow />
                <OfficeHoursRow />
            </SettingCard>
            <SettingCard id="agentrows" label="Agent sidebar">
                <AgentRowFieldRows />
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
                const [bg, surface, accent, last] = chipSwatches(t.id, t.palette);
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
                            <Swatch color={bg} />
                            <Swatch color={surface} />
                            <Swatch color={accent} />
                            <Swatch color={last} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{t.name}</span>
                        {t.id === SPIDER_THEME ? <SmallSpider /> : null}
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

const PET_CHARACTER_OPTIONS: { id: PetCharacter; label: string }[] = (["sprout", "minion", "spidey"] as const).map(
    (id) => ({
        id,
        label: PET_CHARACTER_NAME[id],
    })
);

function PetCharacterRow() {
    const [character, setCharacter] = useAtom(petCharacterAtom);
    const [preset, setPreset] = useAtom(themePresetAtom);
    // asked on the pick itself, never on a later visit: local state, gone when Settings closes
    const [offer, setOffer] = useState(false);
    const ctx = useContext(RowCtx);
    const rowShown = ctx.visible == null || ctx.visible.has("appearance.petcharacter");
    return (
        <>
            <SettingRow id="appearance.petcharacter">
                <Segmented<PetCharacter>
                    options={PET_CHARACTER_OPTIONS}
                    value={petCharacter(character)}
                    onChange={(id) => {
                        setCharacter(id);
                        setOffer(offersSpiderTheme(id, preset));
                    }}
                />
            </SettingRow>
            {offer && rowShown && offersSpiderTheme(petCharacter(character), preset) ? (
                <SpiderThemeOffer
                    onSwitch={() => {
                        setPreset(SPIDER_THEME);
                        setOffer(false);
                    }}
                    onDismiss={() => setOffer(false)}
                />
            ) : null}
        </>
    );
}

// Under the Character row once Spider-Man is picked: the theme that goes with him, one click away. A step down in
// tone from the card, so it reads as the row's follow-up rather than a setting of its own.
function SpiderThemeOffer({ onSwitch, onDismiss }: { onSwitch: () => void; onDismiss: () => void }) {
    return (
        <div
            role="group"
            aria-label="Spider theme"
            data-spider-theme-offer
            className="flex items-center gap-3 border-t border-edge-mid bg-surface px-4 py-2.5"
        >
            <SmallSpider />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-primary">Switch to the Spider theme too?</div>
                <div className="mt-0.5 text-[12px] leading-[1.45] text-muted">
                    The suit's blue accent, a spider logo and webs in two corners. Theme above puts it back.
                </div>
            </div>
            <button
                type="button"
                onClick={onSwitch}
                className="h-[26px] flex-none cursor-pointer whitespace-nowrap rounded-[7px] bg-accent px-2.5 text-[12px] font-semibold text-background hover:bg-accenthover"
            >
                Switch theme
            </button>
            <button
                type="button"
                onClick={onDismiss}
                className="h-[26px] flex-none cursor-pointer whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-2.5 text-[12px] font-semibold text-muted hover:border-edge-strong hover:bg-surface-hover"
            >
                Not now
            </button>
        </div>
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

function OfficeAnimationRow() {
    const [raw, setOn] = useAtom(officeAnimationAtom);
    const on = officeAnimation(raw);
    return (
        <SettingRow id="appearance.officeanimation">
            <Toggle on={on} onToggle={() => setOn(!on)} label="Office animation" />
        </SettingRow>
    );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

// two hour pickers; each offers only hours that keep the start before the end
function OfficeHoursRow() {
    const [raw, setHours] = useAtom(officeHoursAtom);
    const hours = sanitizeHours(raw);
    const items = (pick: (h: number) => WorkHours, current: number, ok: (h: number) => boolean): ContextMenuItem[] =>
        HOURS.filter(ok).map((h) => ({
            label: hourLabel(h),
            type: "radio",
            checked: h === current,
            click: () => setHours(pick(h)),
        }));
    return (
        <SettingRow id="appearance.officehours">
            <div className="flex items-center gap-2">
                <Select
                    value={String(hours.start)}
                    label={hourLabel(hours.start)}
                    ariaLabel="Work starts"
                    items={items(
                        (h) => ({ ...hours, start: h }),
                        hours.start,
                        (h) => h < hours.end
                    )}
                />
                <span className="text-muted">to</span>
                <Select
                    value={String(hours.end)}
                    label={hourLabel(hours.end)}
                    ariaLabel="Work ends"
                    items={items(
                        (h) => ({ ...hours, end: h }),
                        hours.end,
                        (h) => h > hours.start
                    )}
                />
            </div>
        </SettingRow>
    );
}

// One toggle per piece of meta an agent row shows (rowfields.ts); off hides it from the row only
function AgentRowFieldRows() {
    const [fields, setField] = useAtom(rowFieldsAtom);
    return (
        <>
            {ROW_FIELD_ROWS.map((r) => (
                <SettingRow key={r.id} id={r.id}>
                    <Toggle on={fields[r.field]} onToggle={() => setField(r.field, !fields[r.field])} label={r.title} />
                </SettingRow>
            ))}
        </>
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
