// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit's right rail: the Events rail. Plan usage sits in the footer (FooterUsageMeters).

import { CollapsibleRail } from "@/app/element/collapsiblerail";
import { SquareStack } from "lucide-react";
import type { AgentsViewModel } from "./agents";
import { CockpitEventsRail } from "./cockpiteventsrail";
import type { Lineage } from "./runlineage";

const EVENTS_ICON = <SquareStack size={20} strokeWidth={1.8} aria-hidden />;

export function CockpitRail({
    model,
    lineage,
    runEvents,
    tags,
    onSelectAgent,
}: {
    model: AgentsViewModel;
    lineage: Lineage;
    runEvents: Record<string, RunEvent[]>;
    tags: Record<string, string>;
    onSelectAgent: (id: string) => void;
}) {
    return (
        <CollapsibleRail
            openAtom={model.railOpenAtom}
            ariaLabel="Events"
            sections={[
                {
                    id: "events",
                    label: "Events",
                    icon: EVENTS_ICON,
                    content: (
                        <CockpitEventsRail
                            model={model}
                            lineage={lineage}
                            runEvents={runEvents}
                            tags={tags}
                            onSelect={onSelectAgent}
                        />
                    ),
                },
            ]}
        />
    );
}
