// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Network } from "lucide-react";
import { useMemo } from "react";
import type { AgentsViewModel } from "./agents";
import { consumersOpenAtom } from "./consumersstore";
import { portsLabel } from "./devserversmodel";
import { buildMachineServers } from "./machineservers";
import { machineServersOpenAtom, machineServersReadingAtom } from "./machineserversstore";
import { backgroundTasksByIdAtom } from "./subagentsstore";

// The footer's Servers chip, before the RAM chip: how many servers run inside a git repo and, in the warning tone,
// how many of those nothing holds. Muted and icon-only with none in a repo, an icon and `?` when the last read failed.
// A click opens the Servers popover (and closes Consumers, which rises from the same corner). Nothing until there is
// a reading.
export function MachineServersChip({ model }: { model: AgentsViewModel }) {
    const reading = useAtomValue(machineServersReadingAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const bgTasks = useAtomValue(backgroundTasksByIdAtom);
    const view = useMemo(
        () =>
            reading.servers == null ? null : buildMachineServers(reading.servers, [...agents, ...terminals], bgTasks),
        [reading.servers, agents, terminals, bgTasks]
    );
    if (view == null) {
        return null;
    }
    const muted = reading.failed || view.repoCount === 0;
    return (
        <button
            type="button"
            data-machine-servers-chip
            aria-haspopup="dialog"
            title={view.groups.flatMap((g) => g.rows.map((r) => portsLabel(r.server.ports))).join(" ")}
            onClick={() => {
                globalStore.set(consumersOpenAtom, null);
                globalStore.set(machineServersOpenAtom, (open) => !open);
            }}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                muted ? "text-muted" : "text-secondary"
            )}
        >
            <Network size={12} aria-hidden />
            {reading.failed ? (
                <span>?</span>
            ) : view.repoCount === 0 ? null : (
                <span>
                    {view.repoCount}
                    {view.noOwnerCount > 0 ? (
                        <span className="text-warning"> · {view.noOwnerCount} no owner</span>
                    ) : null}
                </span>
            )}
        </button>
    );
}
