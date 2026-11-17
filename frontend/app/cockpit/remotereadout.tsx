// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Remote mode's footer chip: off, starting, on or down at a glance, and the door to Settings > Remote.
// Drawn in the global footer and in the Cockpit's own hints bar, beside the resource readout.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { remoteChip, type RemoteChip } from "@/app/view/agents/remotemodel";
import { loadRemoteStatus, remoteStatusAtom, subscribeRemoteStatus } from "@/app/view/agents/remotestore";
import { pendingSettingsSectionAtom } from "@/app/view/agents/settingsstore";
import { landOn } from "@/app/view/jarvis/returnsurface";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

const DOT: Record<RemoteChip["tone"], string> = {
    off: "bg-ink-faint",
    starting: "bg-ink-faint",
    on: "bg-success",
    down: "bg-warning",
};
const TEXT: Record<RemoteChip["tone"], string> = {
    off: "text-muted",
    starting: "text-secondary",
    on: "text-secondary",
    down: "text-warning-soft",
};

// mounted once in the cockpit root, so the status stays live for Settings > Remote and both footers
export function RemoteStatusPoller() {
    useEffect(() => {
        const unsub = subscribeRemoteStatus();
        fireAndForget(loadRemoteStatus);
        return unsub;
    }, []);
    return null;
}

export function RemoteReadout({ model, className }: { model: AgentsViewModel; className?: string }) {
    const chip = remoteChip(useAtomValue(remoteStatusAtom));
    if (chip == null) {
        return null;
    }
    const open = () => {
        globalStore.set(pendingSettingsSectionAtom, "remote");
        landOn(model.surfaceAtom, "settings");
    };
    return (
        <button
            type="button"
            data-remote-pill={chip.tone}
            onClick={open}
            title={chip.title}
            className={cn(
                "flex h-5 shrink-0 cursor-pointer items-center gap-[7px] rounded-[5px] border border-edge-mid px-2 text-[12px] hover:border-edge-strong focus-visible:outline focus-visible:outline-accent",
                TEXT[chip.tone],
                className
            )}
        >
            <span aria-hidden className={cn("h-[7px] w-[7px] rounded-full", DOT[chip.tone])} />
            {chip.label}
        </button>
    );
}
