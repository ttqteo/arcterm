// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { servicesChip } from "@/app/view/agents/servicesmodel";
import { ensureServicesFeed, servicesAtom } from "@/app/view/agents/servicesstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Server } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toggleServices } from "./servicespopoverstore";

const TONE_TEXT = { error: "text-error", warning: "text-warning", muted: "text-muted" } as const;

// The app bar's Services chip, before the Jobs chip: how many held services run and, in the error tone, how many
// crashed (servicesChip). Amber while one has a taken port or no page, muted otherwise. A click opens the Services
// popover. Nothing while no tool is a service.
export function ServicesChip() {
    useEffect(() => ensureServicesFeed(), []);
    const list = useAtomValue(servicesAtom);
    const chip = useMemo(() => servicesChip(list ?? []), [list]);
    if (chip.hidden) {
        return null;
    }
    return (
        <button
            type="button"
            data-services-chip
            data-tone={chip.tone}
            aria-haspopup="dialog"
            title={chip.title}
            onClick={(e) => toggleServices(e.currentTarget)}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                TONE_TEXT[chip.tone]
            )}
        >
            <Server size={12} aria-hidden />
            {chip.label}
        </button>
    );
}
