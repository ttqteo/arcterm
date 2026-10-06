import { statusPickerRows } from "@/app/view/jarvis/briefpeek";
import { openAddress } from "@/app/view/jarvis/openref";
import { confirmDossierStatus } from "@/app/view/jarvis/recordactions";
import { taskListAtom } from "@/app/view/jarvis/tasksstore";
import { fireAndForget } from "@/util/util";
import type { ThingKindDef } from "./types";

export type RecordThing = SpaceSummary;

// the statuses the peek's picker offers: every legal transition, the current status being inert there
function nextStatuses(r: RecordThing): string[] {
    return statusPickerRows(r.status)
        .filter((row) => !row.current)
        .map((row) => row.status);
}

export const RECORD_KIND: ThingKindDef<RecordThing> = {
    kind: "record",
    noun: "Record",
    actions: [
        {
            id: "record:open",
            label: "Open",
            group: "open",
            applies: () => true,
            run: (r, { model }) => fireAndForget(() => openAddress(model, `task:${r.id}`)),
        },
        {
            id: "record:status",
            label: "Change status",
            group: "steer",
            applies: (r) => nextStatuses(r).length > 0,
            input: {
                kind: "pick",
                placeholder: "Set the status to…",
                options: (r) => nextStatuses(r).map((s) => ({ value: s, label: s })),
            },
            run: (r, _deps, value) => {
                if (value) {
                    confirmDossierStatus(r.id, value);
                }
            },
        },
    ],
    entries: (get) =>
        (get(taskListAtom) ?? []).map((r) => ({
            key: `record:${r.id}`,
            title: r.objective || "(untitled record)",
            thing: r,
        })),
};
