// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Councils (pkg/council), as the Agent tree and the council centre mode read them. One atom per council id and one
// list atom per project, loaded over wshrpc and reloaded when wavesrv says a council changed (`council:changed`, which
// every save of a running council, `wsh council` and the UI's own actions publish). After the load/event plumbing come
// the actions, one per wshrpc command, and the UI state that outlives a view: which council is open and on which view,
// which proposal is open in it, and a Setup draft per project. Pure rules are in councilmodel.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import { councilProjectKey, type CouncilSetupDraft, type CouncilView } from "./councilmodel";

const sameProject = (a: string, b: string) => councilProjectKey(a) === councilProjectKey(b);

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig

/** A project's councils, newest save first, or null before the first load. The empty project is every council. Two
 *  spellings of one path (`D:\x`, `d:/x`) share an atom. */
export const councilListAtom = atomFamily(
    (_project: string) => atom<Council[] | null>(null) as PrimitiveAtom<Council[] | null>,
    sameProject
);

/** One council by id, or null before it is loaded. */
export const councilAtom = atomFamily((_id: string) => atom<Council | null>(null) as PrimitiveAtom<Council | null>);

// what has been read: an event only reloads those (atomFamily cannot be enumerated)
const knownCouncils = new Set<string>();
const knownProjects = new Map<string, string>(); // project key -> the path as first read
// a reload that overtakes an earlier one must not be overwritten by the earlier one's late answer
const councilSeq = new Map<string, number>();
const listSeq = new Map<string, number>();

let subscribed = false;
function subscribeCouncilChanged() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "council:changed",
        handler: (event) => {
            const data = event.data as CouncilChangedData | undefined;
            if (data == null) {
                return;
            }
            if (knownCouncils.has(data.id)) {
                void loadCouncil(data.id);
            }
            // the project's own list, and the list of every council (the empty project) if something read it
            for (const key of new Set([councilProjectKey(data.project), ""])) {
                const project = knownProjects.get(key);
                if (project != null) {
                    void loadCouncils(project);
                }
            }
        },
    });
}

/** Reads one council into its atom. A failure leaves the atom as it was and logs. */
export async function loadCouncil(id: string): Promise<void> {
    if (id === "") {
        return;
    }
    knownCouncils.add(id);
    subscribeCouncilChanged();
    const seq = (councilSeq.get(id) ?? 0) + 1;
    councilSeq.set(id, seq);
    try {
        const council = await RpcApi.CouncilGetCommand(TabRpcClient, { id });
        if (councilSeq.get(id) === seq) {
            globalStore.set(councilAtom(id), council);
        }
    } catch (err) {
        console.error(`loading council ${id} failed`, err);
    }
}

/** Reads a project's councils into its list atom (and each one into its own, so a row and its view agree). A failure
 *  leaves the list as it was and logs. */
export async function loadCouncils(project: string): Promise<void> {
    const key = councilProjectKey(project);
    if (!knownProjects.has(key)) {
        knownProjects.set(key, project);
    }
    subscribeCouncilChanged();
    const seq = (listSeq.get(key) ?? 0) + 1;
    listSeq.set(key, seq);
    try {
        const councils = (await RpcApi.CouncilListCommand(TabRpcClient, { project })) ?? [];
        if (listSeq.get(key) === seq) {
            globalStore.set(councilListAtom(project), councils);
            for (const c of councils) {
                if (knownCouncils.has(c.id)) {
                    globalStore.set(councilAtom(c.id), c);
                }
            }
        }
    } catch (err) {
        console.error(`loading the councils of ${project || "every project"} failed`, err);
    }
}

const noCouncil = atom<Council | null>(null);
const noCouncils = atom<Council[] | null>(null);

/** Reads a council and keeps it loaded while the caller shows; a null id reads nothing. */
export function useCouncil(id: string | null): Council | null {
    const council = useAtomValue(id != null ? councilAtom(id) : noCouncil);
    useEffect(() => {
        if (id != null) {
            void loadCouncil(id);
        }
    }, [id]);
    return council;
}

/** Reads a project's councils and keeps them loaded while the caller shows; a null project reads nothing, "" every one. */
export function useCouncils(project: string | null): Council[] | null {
    const councils = useAtomValue(project != null ? councilListAtom(project) : noCouncils);
    useEffect(() => {
        if (project != null) {
            void loadCouncils(project);
        }
    }, [project]);
    return councils;
}

// ---- actions: one per wshrpc command ----

/** What an action answers: the value, or why wavesrv refused (a gate's `Not run: …`, a missing expert), logged. A view
 *  shows `error` where it was clicked instead of catching. */
export type CouncilCall<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(what: string, run: () => Promise<T>): Promise<CouncilCall<T>> {
    try {
        return { ok: true, value: await run() };
    } catch (err) {
        console.error(`council ${what} failed`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

// each action reads RpcApi.<X>Command when it is called, not when this file loads, so a scenario that swaps the method
// in the page takes the next click

/** Starts a council, or saves it as not-run (`notrun`). The council that comes back is put in its atom at once. */
export async function startCouncil(data: CommandCouncilStartData): Promise<CouncilCall<Council>> {
    const r = await call("start", () => RpcApi.CouncilStartCommand(TabRpcClient, data));
    if (r.ok && r.value?.id) {
        globalStore.set(councilAtom(r.value.id), r.value);
    }
    return r;
}

/** Starts a council saved as not-run: Start council on its Discussion, which is the yes the gate wanted. */
export function startSavedCouncil(id: string): Promise<CouncilCall<Council>> {
    return startCouncil({ id });
}

/** Posts the person's reply. `proposalid` empty with no `parentid` asks the whole council. */
export function replyCouncil(data: CommandCouncilReplyData): Promise<CouncilCall<void>> {
    return call("reply", () => RpcApi.CouncilReplyCommand(TabRpcClient, data));
}

/** Continues a council waiting at the pause: `cut` is the proposal ids the person unticked, `question` what they ask. */
export function continueCouncil(data: CommandCouncilContinueData): Promise<CouncilCall<void>> {
    return call("continue", () => RpcApi.CouncilContinueCommand(TabRpcClient, data));
}

/** Runs the synthesis again on the discussion so far. */
export function summarizeCouncil(id: string): Promise<CouncilCall<void>> {
    return call("summarize", () => RpcApi.CouncilSummarizeCommand(TabRpcClient, { id }));
}

/** Stops a running council, keeping the rounds that finished. */
export function stopCouncil(id: string): Promise<CouncilCall<void>> {
    return call("stop", () => RpcApi.CouncilStopCommand(TabRpcClient, { id }));
}

/** Reruns a failed expert's call in the round it failed in (the coordinator's: the synthesis). */
export function retryExpert(id: string, expertId: string): Promise<CouncilCall<void>> {
    return call("retry", () => RpcApi.CouncilRetryCommand(TabRpcClient, { id, expertid: expertId }));
}

/** Asks the coordinator which files to read and which roles fit the feature: one model call, so Setup waits for it. */
export function suggestCouncil(data: CommandCouncilSuggestData): Promise<CouncilCall<CouncilSuggestion>> {
    return call("suggest", () => RpcApi.CouncilSuggestCommand(TabRpcClient, data));
}

/** The calls, tokens and minutes of a council to start (`experts`, `files`), its remaining rounds (`id`), or a
 *  follow-up round (`id` and `followup`, the number of experts). */
export function estimateCouncil(data: CommandCouncilEstimateData): Promise<CouncilCall<CouncilEstimateRtnData>> {
    return call("estimate", () => RpcApi.CouncilEstimateCommand(TabRpcClient, data));
}

/** Writes the Summary and Matrix as markdown into the project and answers the path. Never commits. */
export function saveCouncilDoc(id: string, path?: string): Promise<CouncilCall<CouncilSaveDocRtnData>> {
    return call("save doc", () => RpcApi.CouncilSaveDocCommand(TabRpcClient, { id, path }));
}

/** The role library and the saved groups. */
export function councilRoles(): Promise<CouncilCall<CouncilRolesRtnData>> {
    return call("roles", () => RpcApi.CouncilRolesCommand(TabRpcClient));
}

/** Saves a group of roles (Save as group on Setup). */
export function saveCouncilGroup(group: CouncilGroup): Promise<CouncilCall<void>> {
    return call("save group", () => RpcApi.CouncilSaveGroupCommand(TabRpcClient, group));
}

// ---- UI state that outlives a view ----

/** The council open in the centre, or null. */
export const councilSelAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** Which view of the open council shows. */
export const councilViewAtom = atom<CouncilView>("discussion") as PrimitiveAtom<CouncilView>;

/** The councils that ended (done, stopped, failed) while the person was elsewhere and have not been opened since: the
 *  Agent tree draws a dot on each. Lives for the app session; councilnotifysync.tsx fills and clears it. */
export const councilUnreadAtom = atom<ReadonlySet<string>>(new Set<string>()) as PrimitiveAtom<ReadonlySet<string>>;

/** The project Setup shows, the one showCouncilSetup last opened: its form is `councilSetupDraftAtom(project)`. */
export const councilSetupProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** The proposal open in each council's Discussion, or null for the first in the ranking. */
export const councilOpenProposalAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

/** Each project's unsent Setup draft, so it survives switching away; null when there is none. */
export const councilSetupDraftAtom = atomFamily(
    (_project: string) => atom<CouncilSetupDraft | null>(null) as PrimitiveAtom<CouncilSetupDraft | null>,
    sameProject
);
