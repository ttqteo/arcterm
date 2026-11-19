// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { MachineServersChip } from "@/app/view/agents/machineserverschip";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Bug, CircleHelp } from "lucide-react";
import { bugReportAtom, openBugReport } from "./bugreportstore";
import { RemoteReadout } from "./remotereadout";
import { cheatsheetOpenAtom } from "./shortcuts-cheatsheet";
import { VersionTag } from "./versiontag";

// The right end of a hints bar: remote mode (only once it is set up), servers on the machine, the shortcuts button, then the app's version, which opens What's
// new (plan usage and free RAM sit in the app bar). Both hints bars draw it (the global footer and the Cockpit surface's
// own), so it reads the same on every surface. The `?` button is the cheat sheet's door with the mouse: Shift+? drops
// while typing in a terminal, and the button is there in every posture. The bug button before it opens the bug box
// (bugreportbox.tsx), lit while the box is open; its tooltip draws the chord from the binding.
export function FooterStatus({ model }: { model: AgentsViewModel }) {
    const bugOpen = useAtomValue(bugReportAtom).kind === "open";
    const bugKeys = useAtomValue(bindingsAtom).find((b) => b.id === "global:bug-report")?.keys;
    const bugTitle = bugKeys == null ? "Báo lỗi arcterm" : `Báo lỗi arcterm · ${formatChordString(bugKeys)}`;
    return (
        <div className="ml-auto flex shrink-0 items-center gap-3">
            <RemoteReadout model={model} />
            <MachineServersChip model={model} />
            <button
                type="button"
                data-bug-report-button=""
                title={bugTitle}
                aria-label="Báo lỗi arcterm"
                aria-pressed={bugOpen}
                onClick={() => void openBugReport(model)}
                className={cn(
                    "flex size-[22px] cursor-pointer items-center justify-center rounded-md text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    bugOpen && "bg-surface-hover text-primary"
                )}
            >
                <Bug size={13} strokeWidth={1.8} aria-hidden />
            </button>
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
