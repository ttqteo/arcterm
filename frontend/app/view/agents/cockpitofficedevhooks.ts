// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only seams for the cockpit-office scenarios (scripts/cdp/cockpitofficescenarios.mjs): set what the office draws
// in place of live data, and read what it drew. cockpitsurface.tsx imports this dynamically under
// import.meta.env.DEV only, so a production build never has it.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "./agents";
import { attentionFixtureAtom } from "./attentionstore";
import { backgroundAgentsFixtureAtom } from "./backgroundagentsstore";
import { officeDevAtom, readOfficeProbe, type OfficeDev } from "./cockpitoffice";
import { officeAnimationAtom, officeFloorAtom } from "./officestore";
import { themePresetAtom } from "./themestore";

declare global {
    interface Window {
        __cockpitOffice?: (o: OfficeDev | null) => void;
        __cockpitOfficeAttention?: (items: AttentionItem[] | null) => void;
        __cockpitOfficeBackground?: (o: { sessions: BackgroundAgentData[]; backgrounded: string[] } | null) => void;
        __cockpitOfficeProbe?: () => unknown;
        __cockpitOfficeAnimation?: (on: boolean) => void;
        __cockpitOfficeTheme?: (preset: string) => string;
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
    window.__cockpitOfficeAnimation = (on) => globalStore.set(officeAnimationAtom, on);
    // sets the theme preset and returns the one it replaced (the cockpit-office scenario's theme steps)
    window.__cockpitOfficeTheme = (preset) => {
        const prev = globalStore.get(themePresetAtom);
        globalStore.set(themePresetAtom, preset);
        return prev;
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
