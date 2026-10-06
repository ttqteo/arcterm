import { globalStore } from "@/app/store/jotaiStore";
import {
    confirmCloseSession,
    dismissAgent,
    driveAgent,
    interruptAgent,
    NUDGE_INPUT,
    toggleAgentBackground,
} from "@/app/view/agents/agentactions";
import { agentDiffScope, openDiff } from "@/app/view/agents/agentdiffnav";
import { contextLevel, offersContextReset, railAction } from "@/app/view/agents/agentrailmodel";
import { muteMode } from "@/app/view/agents/agentrowmodel";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { diffStatsByIdAtom } from "@/app/view/agents/cardgitstore";
import { openInSplit } from "@/app/view/agents/gridstore";
import { rosterSeededAtom } from "@/app/view/agents/liveagents";
import { isEndedWorkerId } from "@/app/view/agents/runlineage";
import type { ThingAction, ThingKindDef } from "./types";

export type ContextLevel = ReturnType<typeof contextLevel>;

export interface AgentThing {
    agent: AgentVM;
    contextLevel: ContextLevel | null; // null until usage reports a context %, when the rail shows no context line
    hasDiff: boolean; // the card's Review changes button shows only when it has diff stats
}

// the rail's notion of a drivable agent: a terminal block, and not a finished worker's record
const live = (a: AgentVM) => a.blockId != null && !isEndedWorkerId(a.id);

const offersReset = ({ agent: a, contextLevel: level }: AgentThing) =>
    level != null &&
    offersContextReset({ isClaude: (a.agent || "claude") === "claude", state: a.state, level, live: live(a) });

const actions: ThingAction<AgentThing>[] = [
    {
        id: "agent:open",
        label: "Open terminal",
        group: "open",
        applies: () => true,
        run: ({ agent }, { model }) => model.openTerminal(agent.id),
    },
    {
        id: "agent:answer",
        label: "Answer",
        group: "open",
        applies: ({ agent }) => agent.state === "asking",
        // the terminal opens at its question
        run: ({ agent }, { model }) => model.openTerminal(agent.id),
    },
    {
        id: "agent:review",
        label: "Review changes",
        group: "open",
        applies: (t) => t.hasDiff,
        run: ({ agent }, { model }) => {
            globalStore.set(model.focusIdAtom, agent.id);
            openDiff(model, agentDiffScope(agent.id, agent.name));
        },
    },
    {
        id: "agent:split",
        label: "Open in split",
        group: "open",
        applies: ({ agent }) => live(agent),
        // a new cell beside the focused one; when it cannot (already a cell, grid full, roster not seeded yet: a grid
        // operation prunes against the roster as it is) it just opens the agent, which also shows its terminal
        run: ({ agent }, { model }) => {
            if (globalStore.get(rosterSeededAtom) && openInSplit(model, agent.id)) {
                globalStore.set(model.surfaceAtom, "agent");
            } else {
                model.openTerminal(agent.id);
            }
        },
    },
    {
        id: "agent:nudge",
        label: "Nudge (continue)",
        group: "steer",
        applies: ({ agent }) => railAction(agent.state, live(agent))?.kind === "resume",
        run: ({ agent }) => driveAgent(agent.blockId, NUDGE_INPUT),
    },
    {
        id: "agent:interrupt",
        label: "Interrupt",
        group: "steer",
        applies: ({ agent }) => agent.blockId != null,
        run: ({ agent }) => interruptAgent(agent.blockId),
    },
    {
        id: "agent:compact",
        label: "Compact",
        group: "steer",
        applies: offersReset,
        run: ({ agent }) => driveAgent(agent.blockId, "/compact\r"),
    },
    {
        id: "agent:clear",
        label: "Clear",
        group: "steer",
        destructive: true,
        applies: offersReset,
        run: ({ agent }) => driveAgent(agent.blockId, "/clear\r"),
    },
    // one mute control on the card, split in two here because a label cannot follow the agent's state
    {
        id: "agent:background",
        label: "Move to background",
        group: "steer",
        applies: ({ agent }) => muteMode(agent.state) === "background",
        run: ({ agent }, { model }) => toggleAgentBackground(model, agent.id),
    },
    {
        id: "agent:dismiss",
        label: "Dismiss",
        group: "steer",
        applies: ({ agent }) => muteMode(agent.state) === "dismiss",
        run: ({ agent }, { model }) => dismissAgent(model, agent),
    },
    {
        id: "agent:close",
        label: "Close",
        group: "stop",
        destructive: true,
        applies: ({ agent }) => agent.blockId != null,
        run: ({ agent }, { model }) => confirmCloseSession(agent, model),
    },
];

export const AGENT_KIND: ThingKindDef<AgentThing> = {
    kind: "agent",
    noun: "Agent",
    actions,
    entries: (get, model) => {
        const diffs = get(diffStatsByIdAtom) ?? {};
        return get(model.agentsAtom).map((a) => {
            const pct = a.usage?.contextpct;
            return {
                key: `agent:${a.id}`,
                title: a.task ? `${a.name} — ${a.task}` : a.name,
                thing: {
                    agent: a,
                    contextLevel: pct != null ? contextLevel(pct, a.usage?.contextmax) : null,
                    hasDiff: diffs[a.id] != null,
                },
            };
        });
    },
};
