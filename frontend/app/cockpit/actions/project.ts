import { globalStore } from "@/app/store/jotaiStore";
import { openLauncher } from "@/app/view/agents/launcherstore";
import {
    confirmRemoveProject,
    projectListAtom,
    rowsWithChannel,
    type ProjectRow,
} from "@/app/view/agents/projectsstore";
import { briefProfileAtom } from "@/app/view/jarvis/jarvisstore";
import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import type { ThingEntry, ThingKindDef } from "./types";

export interface ProjectThing {
    channel: Channel;
    name: string; // the name the project is registered and shown under
}

// one entry per project, as the palette's project rows
export function projectEntries(rows: ProjectRow[]): ThingEntry<ProjectThing>[] {
    return rowsWithChannel(rows).map(({ name, channel }) => ({
        key: `channel:${channel.oid}`,
        title: `#${name}`,
        thing: { channel, name },
    }));
}

export const PROJECT_KIND: ThingKindDef<ProjectThing> = {
    kind: "channel",
    noun: "Project",
    actions: [
        {
            id: "channel:switch",
            label: "Switch to it",
            group: "open",
            applies: () => true,
            run: (p, { model }) =>
                fireAndForget(() => openTarget(model, { kind: "channel", channelId: p.channel.oid })),
        },
        {
            id: "channel:new-run",
            label: "New run in it",
            group: "steer",
            applies: () => true,
            run: (p, { model }) => openLauncher(model, "run", { projectName: p.name, goal: "", shape: "orchestrator" }),
        },
        {
            id: "channel:defaults",
            label: "Run defaults",
            group: "steer",
            applies: () => true,
            // the Brief's Profile window, which the Brief mounts
            run: (p, { model }) => {
                globalStore.set(briefProfileAtom, p.channel.oid);
                globalStore.set(model.surfaceAtom, "jarvis");
            },
        },
        {
            id: "channel:remove",
            label: "Remove",
            group: "stop",
            destructive: true,
            applies: () => true,
            run: (p, { model }) => confirmRemoveProject(model, p.name),
        },
    ],
    entries: (get) => projectEntries(get(projectListAtom)),
};
