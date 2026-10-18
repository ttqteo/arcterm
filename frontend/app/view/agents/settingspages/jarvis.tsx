// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Jarvis & Office: Jarvis's character, outfit and quotes, how the window folds into Sprout, and the
// Cockpit office's animation, work hours and sound.

import { getSettingsKeyAtom } from "@/app/store/global";
import { PET_CHARACTER_NAME, petCharacter } from "@/app/view/jarvis/petcharacter";
import { petOutfitChoice, type PetOutfitChoice } from "@/app/view/jarvis/petoutfit";
import type { PetCharacter } from "@/app/view/jarvis/petsprite";
import { petCharacterAtom, petOutfitChoiceAtom, petQuotesOnAtom } from "@/app/view/jarvis/petstore";
import { isMacOS } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import { useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { useContext, useState } from "react";
import { setSproutCorner, sproutSpotAtom } from "../floatstore";
import { spotCorner, SPROUT_CORNER_LABEL, SPROUT_CORNERS } from "../floatwindow";
import { sanitizeHours, type WorkHours } from "../officebehavior";
import {
    DEFAULT_SOUND,
    officeAnimation,
    officeAnimationAtom,
    officeHoursAtom,
    officeSoundEventsAtom,
    officeSoundMusicAtom,
    officeSoundUiAtom,
    officeSoundVolumeAtom,
    SOUND_VOLUMES,
    soundSwitch,
    soundVolume,
} from "../officestore";
import { RowCtx, Segmented, Select, SettingCard, SettingRow, Toggle, writeConfig } from "../settingsui";
import { offersSpiderTheme, SPIDER_THEME } from "../themedecor";
import { SmallSpider } from "../themedecorview";
import { themePresetAtom } from "../themestore";
import { autoSproutOn, minimizeChoice } from "../windowsize";

export function JarvisPage() {
    return (
        <>
            <SettingCard id="jarvis" label="Jarvis">
                <PetCharacterRow />
                <PetOutfitRow />
                <PetQuotesRow />
            </SettingCard>
            <SettingCard id="folding" label="Folding">
                <FoldingRows />
            </SettingCard>
            <SettingCard id="office" label="Office">
                <OfficeAnimationRow />
                <OfficeHoursRow />
                <OfficeSoundRows />
            </SettingCard>
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

// what a minimize does, where Sprout lands, and whether leaving the window folds it
function FoldingRows() {
    const choice = minimizeChoice(useAtomValue(getSettingsKeyAtom("window:minimize")));
    const autoSprout = autoSproutOn(useAtomValue(getSettingsKeyAtom("window:autosprout")));
    const corner = spotCorner(useAtomValue(sproutSpotAtom));
    const cornerItems: ContextMenuItem[] = SPROUT_CORNERS.map((c) => ({
        label: SPROUT_CORNER_LABEL[c],
        type: "radio",
        checked: corner === c,
        click: () => fireAndForget(() => setSproutCorner(c)),
    }));
    const dock = isMacOS() ? "Dock" : "Taskbar";
    const items: ContextMenuItem[] = [
        {
            label: "Sprout",
            type: "radio",
            checked: choice === "sprout",
            sublabel: "Fold the window into Sprout, over every app",
            click: () => writeConfig({ "window:minimize": "sprout" }),
        },
        {
            label: dock,
            type: "radio",
            checked: choice === "dock",
            sublabel: `Send the window to the ${dock.toLowerCase()}`,
            click: () => writeConfig({ "window:minimize": "dock" }),
        },
    ];
    return (
        <>
            <SettingRow id="window.minimize">
                <Select value={choice} label={choice === "dock" ? dock : "Sprout"} items={items} ariaLabel="Minimize" />
            </SettingRow>
            <SettingRow id="window.sproutcorner">
                <Select
                    value={corner ?? "dragged"}
                    label={corner == null ? "Where you dragged it" : SPROUT_CORNER_LABEL[corner]}
                    items={cornerItems}
                    ariaLabel="Fold to"
                />
            </SettingRow>
            <SettingRow id="window.autosprout">
                <Toggle
                    on={autoSprout}
                    onToggle={() => writeConfig({ "window:autosprout": !autoSprout })}
                    label="Fold when you leave"
                />
            </SettingRow>
        </>
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

function OfficeSoundSwitch(props: { id: string; label: string; atom: PrimitiveAtom<boolean>; dflt: boolean }) {
    const [raw, set] = useAtom(props.atom);
    const on = soundSwitch(raw, props.dflt);
    return (
        <SettingRow id={props.id}>
            <Toggle on={on} onToggle={() => set(!on)} label={props.label} />
        </SettingRow>
    );
}

// the office's three sound switches and the volume they share (office sounds spec, "Controls")
function OfficeSoundRows() {
    const [raw, setVolume] = useAtom(officeSoundVolumeAtom);
    const volume = soundVolume(raw);
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const items: ContextMenuItem[] = SOUND_VOLUMES.map((v) => ({
        label: pct(v),
        type: "radio",
        checked: v === volume,
        click: () => setVolume(v),
    }));
    return (
        <>
            <OfficeSoundSwitch
                id="appearance.officesoundevents"
                label="Office jingles"
                atom={officeSoundEventsAtom}
                dflt={DEFAULT_SOUND.events}
            />
            <OfficeSoundSwitch
                id="appearance.officesoundui"
                label="Boss sounds"
                atom={officeSoundUiAtom}
                dflt={DEFAULT_SOUND.ui}
            />
            <OfficeSoundSwitch
                id="appearance.officesoundmusic"
                label="Office music"
                atom={officeSoundMusicAtom}
                dflt={DEFAULT_SOUND.music}
            />
            <SettingRow id="appearance.officesoundvolume">
                <Select value={String(volume)} label={pct(volume)} ariaLabel="Office volume" items={items} />
            </SettingRow>
        </>
    );
}
