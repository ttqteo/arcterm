// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { MachineServersChip } from "@/app/view/agents/machineserverschip";
import { VersionTag } from "./versiontag";

// The right end of a hints bar: servers on the machine, then the app's version (plan usage and free RAM sit in the app
// bar). Both hints bars draw it (the global footer and the Cockpit surface's own), so it reads the same on every surface.
export function FooterStatus({ model }: { model: AgentsViewModel }) {
    return (
        <div className="ml-auto flex shrink-0 items-center gap-3">
            <MachineServersChip model={model} />
            <VersionTag />
        </div>
    );
}
