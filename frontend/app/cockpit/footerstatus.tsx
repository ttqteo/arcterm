// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { FooterUsageMeters } from "@/app/view/agents/usagemeters";
import { WorkerCapacityChip } from "@/app/view/agents/workercapacitychip";
import { VersionTag } from "./versiontag";

// The right end of a hints bar: plan usage, free RAM, then the app's version. Both hints bars draw it (the global
// footer and the Cockpit surface's own), so it reads the same on every surface.
export function FooterStatus({ model }: { model: AgentsViewModel }) {
    return (
        <div className="ml-auto flex shrink-0 items-center gap-3">
            <FooterUsageMeters model={model} />
            <WorkerCapacityChip />
            <VersionTag />
        </div>
    );
}
