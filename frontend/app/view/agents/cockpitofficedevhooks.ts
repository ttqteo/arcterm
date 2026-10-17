// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only seams for the cockpit-office scenarios (scripts/cdp/cockpitofficescenarios.mjs): set what the office draws
// in place of live data, and read what it drew. cockpitsurface.tsx imports this dynamically under
// import.meta.env.DEV only, so a production build never has it.

import { globalStore } from "@/app/store/jotaiStore";
import { petCharacter } from "@/app/view/jarvis/petcharacter";
import { quoteEvent, quotePool } from "@/app/view/jarvis/petquotes";
import { petBubbleAtom, petCharacterAtom } from "@/app/view/jarvis/petstore";
import type { AgentsViewModel } from "./agents";
import type { DiffStats } from "./agentsviewmodel";
import { attentionFixtureAtom } from "./attentionstore";
import { backgroundAgentsFixtureAtom } from "./backgroundagentsstore";
import { diffStatsByIdAtom } from "./cardgitstore";
import { officeDevAtom, readOfficeProbe, type OfficeDev } from "./cockpitoffice";
import { officeSoundLog, setOfficeSoundLog } from "./officeaudio";
import { officeAnimationAtom, officeFloorAtom, officeSoundMusicAtom, officeSoundUiAtom } from "./officestore";
import { themePresetAtom } from "./themestore";

declare global {
    interface Window {
        __cockpitOffice?: (o: OfficeDev | null) => void;
        __cockpitOfficeAttention?: (items: AttentionItem[] | null) => void;
        __cockpitOfficeBackground?: (o: { sessions: BackgroundAgentData[]; backgrounded: string[] } | null) => void;
        __cockpitOfficeDiff?: (id: string, stats: DiffStats | null) => void;
        __cockpitOfficeProbe?: () => unknown;
        __cockpitOfficeAnimation?: (on: boolean) => void;
        __cockpitOfficeTheme?: (preset: string) => string;
        __cockpitOfficePet?: (character: string) => string;
        __cockpitOfficeBubble?: (on: boolean) => void;
        __cockpitOfficeSound?: (on: boolean) => void;
        __cockpitOfficeSoundLog?: () => string[] | null;
        __cockpitOfficeSoundSet?: (o: { ui?: boolean; music?: boolean }) => void;
    }
}

export function installCockpitOfficeDevHooks(model: AgentsViewModel): void {
    window.__cockpitOffice = (o) => {
        // the floor is shown at once and is not kept in what the office draws instead of live data
        const { floor, ...rest } = o ?? {};
        if (floor != null) {
            globalStore.set(officeFloorAtom, floor);
        }
        globalStore.set(officeDevAtom, o == null ? null : { ...(globalStore.get(officeDevAtom) ?? {}), ...rest });
    };
    // the Needs you rows the strip and the notice board show in place of the live list; null is live again
    window.__cockpitOfficeAttention = (items) => globalStore.set(attentionFixtureAtom, items);
    // the detached sessions the Background section shows and the agents moved to the background, in place of the live
    // ones; null is the live sessions again and nothing backgrounded
    window.__cockpitOfficeBackground = (o) => {
        globalStore.set(backgroundAgentsFixtureAtom, o?.sessions ?? null);
        globalStore.set(model.backgroundedIdsAtom, new Set(o?.backgrounded ?? []));
    };
    // the changed files an agent's box shows (and its Diff item), in place of what git found; null drops them
    window.__cockpitOfficeDiff = (id, stats) => {
        const next = { ...globalStore.get(diffStatsByIdAtom) };
        if (stats == null) {
            delete next[id];
        } else {
            next[id] = stats;
        }
        globalStore.set(diffStatsByIdAtom, next);
    };
    window.__cockpitOfficeAnimation = (on) => globalStore.set(officeAnimationAtom, on);
    // sets the theme preset and returns the one it replaced (the cockpit-office scenario's theme steps)
    window.__cockpitOfficeTheme = (preset) => {
        const prev = globalStore.get(themePresetAtom);
        globalStore.set(themePresetAtom, preset);
        return prev;
    };
    // sets the pet the boss is drawn as and returns the one it replaced (the cockpit-office-pet scenario)
    window.__cockpitOfficePet = (character) => {
        const prev = globalStore.get(petCharacterAtom);
        globalStore.set(petCharacterAtom, petCharacter(character));
        return prev;
    };
    // shows a quote in the pet's bubble, or puts it away (the scenario's bubble step)
    window.__cockpitOfficeBubble = (on) =>
        globalStore.set(
            petBubbleAtom,
            on ? quoteEvent(0, Date.now(), quotePool(petCharacter(globalStore.get(petCharacterAtom)))) : null
        );
    // the office-sound scenario: what the office would play, logged instead of played
    window.__cockpitOfficeSound = (on) => setOfficeSoundLog(on);
    window.__cockpitOfficeSoundLog = () => officeSoundLog();
    // turns the boss sounds or the music on or off as the Settings switch does (a localStorage write alone does not
    // reach the atoms)
    window.__cockpitOfficeSoundSet = (o) => {
        if (o.ui != null) {
            globalStore.set(officeSoundUiAtom, o.ui);
        }
        if (o.music != null) {
            globalStore.set(officeSoundMusicAtom, o.music);
        }
    };
    window.__cockpitOfficeProbe = () => {
        const cursor = globalStore.get(model.cursorIdAtom);
        const sel = cursor ? (globalStore.get(model.answerSelAtom)[cursor] ?? {}) : {};
        return {
            ...readOfficeProbe(),
            cursor,
            answerSel: Object.fromEntries(Object.entries(sel).map(([q, s]) => [q, [...(s as Set<number>)]])),
        };
    };
}
