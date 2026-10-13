// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { MachineServersChip } from "@/app/view/agents/machineserverschip";
import { CircleHelp } from "lucide-react";
import { cheatsheetOpenAtom } from "./shortcuts-cheatsheet";
import { VersionTag } from "./versiontag";

// The right end of a hints bar: servers on the machine, the shortcuts button, then the app's version, which opens What's
// new (plan usage and free RAM sit in the app bar). Both hints bars draw it (the global footer and the Cockpit surface's
// own), so it reads the same on every surface. The `?` button is the cheat sheet's door with the mouse: Shift+? drops
// while typing in a terminal, and the button is there in every posture.
export function FooterStatus({ model }: { model: AgentsViewModel }) {
    return (
        <div className="ml-auto flex shrink-0 items-center gap-3">
            <MachineServersChip model={model} />
            <button
                type="button"
                title="Keyboard shortcuts"
                aria-label="Keyboard shortcuts"
                onClick={() => globalStore.set(cheatsheetOpenAtom, true)}
                className="flex size-[18px] cursor-pointer items-center justify-center rounded-full text-secondary hover:text-primary"
            >
                <CircleHelp size={14} strokeWidth={1.8} aria-hidden />
            </button>
            <VersionTag />
        </div>
    );
}
