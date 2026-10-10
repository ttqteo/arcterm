// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a Needs you item lands: the palette's Enter and a click on a notification share it.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { openReview } from "@/app/view/agents/docreviewstore";
import { openRunDag } from "@/app/view/agents/runrailsections";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import type { NeedsTarget } from "./palette-needs";

/** Opens t; false when t names nowhere to go. */
export function openNeedsTarget(model: AgentsViewModel, t: NeedsTarget | null): boolean {
    switch (t?.kind) {
        case "agent":
            model.openTerminal(t.agentId);
            return true;
        case "review":
            // as the Agent surface's Review binding: the agent, with its review open (a Spec or Plan
            // review's dialog, or a Doc review in the terminal's place)
            model.openTerminal(t.agentId);
            openReview(model, t.agentId);
            return true;
        case "dag":
            // openRunDag reads only the dag's oid off the run's dag
            openRunDag(
                model,
                {
                    runId: t.runId,
                    channelId: t.channelId,
                    title: "",
                    project: "",
                    dag: { oid: t.dagId } as TaskGroup,
                },
                t.taskId
            );
            return true;
        case "run":
            fireAndForget(() => openTarget(model, { kind: "channel", channelId: t.channelId, runId: t.runId }));
            return true;
        case "channel":
            fireAndForget(() => openTarget(model, { kind: "channel", channelId: t.channelId }));
            return true;
        case "effort":
            fireAndForget(() => openTarget(model, { kind: "effort", effortId: t.effortId }));
            return true;
        default:
            return false;
    }
}
