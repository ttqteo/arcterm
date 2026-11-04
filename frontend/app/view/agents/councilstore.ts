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
import { createTempFileFromBlob, createTempFileFromFile } from "@/app/view/term/termutil";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { useEffect, useState } from "react";
import { isOversize } from "./composerattachments";
import {
    councilProjectKey,
    withThumb,
    type CouncilSetupDraft,
    type CouncilThumb,
    type CouncilView,
} from "./councilmodel";
import type { RegionCrop } from "./councilsources";
import type { CouncilRating, KeptCouncilView } from "./councilsummarymodel";
import { imageRoom, type TaskImage } from "./launcherimages";

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
            if (data.deleted) {
                forgetCouncil(data.id);
            } else if (knownCouncils.has(data.id)) {
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

// drops a removed council from every atom that holds it, and closes it if it is open; a load of it still in flight is
// dropped when it answers
function forgetCouncil(id: string): void {
    knownCouncils.delete(id);
    councilSeq.set(id, (councilSeq.get(id) ?? 0) + 1);
    globalStore.set(councilAtom(id), null);
    for (const project of knownProjects.values()) {
        const list = globalStore.get(councilListAtom(project));
        if (list?.some((c) => c.id === id)) {
            globalStore.set(
                councilListAtom(project),
                list.filter((c) => c.id !== id)
            );
        }
    }
    const unread = globalStore.get(councilUnreadAtom);
    if (unread.has(id)) {
        const next = new Set(unread);
        next.delete(id);
        globalStore.set(councilUnreadAtom, next);
    }
    if (globalStore.get(councilSelAtom) === id) {
        globalStore.set(councilSelAtom, null);
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

/** Ask <seat> too: reopens the person's routed message `replyId` for the seat `expertId` (a panel seat the router did not
 *  choose), which answers under that message seeing the answers already there. wavesrv refuses a reply that was not
 *  routed or is still pending, a seat that is not on the panel or already answers it; the council reloads through
 *  `council:changed`. */
export function askCouncilSeatToo(id: string, replyId: string, expertId: string): Promise<CouncilCall<void>> {
    return call("ask too", () =>
        RpcApi.CouncilAskTooCommand(TabRpcClient, { id, replyid: replyId, expertid: expertId })
    );
}

/** Continues a council waiting at the pause: `cut` is the proposal ids the person unticked, `question` what they ask. */
export function continueCouncil(data: CommandCouncilContinueData): Promise<CouncilCall<void>> {
    return call("continue", () => RpcApi.CouncilContinueCommand(TabRpcClient, data));
}

/** What the person does with a held draft: `send` lets it reach the other seats as written, `edit` replaces its text and
 *  sends that, `drop` keeps it from reaching anyone. */
export type CouncilDraftAction = "send" | "edit" | "drop";

/** Settles one held draft of a council with live agents. `itemId` is the idea's id (P1) or the reply's (r3); `text` is
 *  the new text of an `edit`. The council reloads through `council:changed`; wavesrv refuses an item that is not held. */
export function draftCouncil(
    id: string,
    itemId: string,
    action: CouncilDraftAction,
    text?: string
): Promise<CouncilCall<void>> {
    return call("draft", () => RpcApi.CouncilDraftCommand(TabRpcClient, { id, itemid: itemId, action, text }));
}

/** Runs the synthesis again on the discussion so far. */
export function summarizeCouncil(id: string): Promise<CouncilCall<void>> {
    return call("summarize", () => RpcApi.CouncilSummarizeCommand(TabRpcClient, { id }));
}

/** Stops a running council, keeping the rounds that finished. */
export function stopCouncil(id: string): Promise<CouncilCall<void>> {
    return call("stop", () => RpcApi.CouncilStopCommand(TabRpcClient, { id }));
}

/** Pins a council (the tree keeps it at the top of its project) or unpins it (`pinned` false), in any state, running
 *  ones too. council:changed brings the saved council to every atom. */
export function setCouncilPinned(id: string, pinned: boolean): Promise<CouncilCall<void>> {
    return call(pinned ? "pin" : "unpin", () => RpcApi.CouncilPinCommand(TabRpcClient, { id, pinned }));
}

/** Removes an ended council (canRemoveCouncil) for good: its file goes to ~/.arc/trash, the document it wrote into the project stays. wavesrv
 *  refuses one still running, waiting on the person or queued. On success it leaves every atom at once, without
 *  waiting for `council:changed`. */
export async function deleteCouncil(id: string): Promise<CouncilCall<void>> {
    const r = await call("remove", () => RpcApi.CouncilDeleteCommand(TabRpcClient, { id }));
    if (r.ok) {
        forgetCouncil(id);
    }
    return r;
}

/** Reruns a failed expert's call in the round it failed in (the coordinator's: the synthesis). With a model it runs this
 *  once on that model instead of the seat's own; the seat keeps its model. */
export function retryExpert(id: string, expertId: string, model?: string): Promise<CouncilCall<void>> {
    const data: CommandCouncilRetryData = { id, expertid: expertId };
    if (model) {
        data.model = model;
    }
    return call("retry", () => RpcApi.CouncilRetryCommand(TabRpcClient, data));
}

/** Reruns every failed seat but the coordinator in one run, the seats at once; models picks a seat's model for this
 *  retry only, by expert id (`retryAllModels`). */
export function retryAllExperts(id: string, models: Record<string, string>): Promise<CouncilCall<void>> {
    const data: CommandCouncilRetryData = { id, all: true };
    if (Object.keys(models).length > 0) {
        data.models = models;
    }
    return call("retry", () => RpcApi.CouncilRetryCommand(TabRpcClient, data));
}

/** Asks the coordinator which files to read and which roles fit the feature: one model call, so Setup waits for it. */
export function suggestCouncil(data: CommandCouncilSuggestData): Promise<CouncilCall<CouncilSuggestion>> {
    return call("suggest", () => RpcApi.CouncilSuggestCommand(TabRpcClient, data));
}

/** Has wavesrv write a topic, one question and the mode from the seated agents' recent conversations: one haiku call that
 *  reads no code and sends nothing into any agent. The failure's message is the reason Setup shows under the composer. */
export function autoGenerateCouncil(data: CommandCouncilAutoGenerateData): Promise<CouncilCall<CouncilAutoGenerate>> {
    return call("auto-generate", () => RpcApi.CouncilAutoGenerateCommand(TabRpcClient, data));
}

/** The calls, tokens and minutes of a council to start (`experts`, `files`), its remaining rounds (`id`), or a
 *  follow-up round (`id` and `followup`, the number of experts). */
export function estimateCouncil(data: CommandCouncilEstimateData): Promise<CouncilCall<CouncilEstimateRtnData>> {
    return call("estimate", () => RpcApi.CouncilEstimateCommand(TabRpcClient, data));
}

/** One estimate over wshrpc, or null while it is on its way (a stale one for other inputs is never shown). Free: it
 *  prices, it calls no model. */
export function useEstimate(data: CommandCouncilEstimateData | null): CouncilEstimateRtnData | null {
    const key = data == null ? "" : JSON.stringify(data);
    const [got, setGot] = useState<{ key: string; value: CouncilEstimateRtnData } | null>(null);
    useEffect(() => {
        if (key === "") {
            return;
        }
        let live = true;
        void estimateCouncil(JSON.parse(key) as CommandCouncilEstimateData).then((r) => {
            if (live && r.ok) {
                setGot({ key, value: r.value });
            }
        });
        return () => {
            live = false;
        };
    }, [key]);
    return got?.key === key ? got.value : null;
}

/** Writes the Summary and Matrix as markdown into the project and answers the path. Never commits. */
export function saveCouncilDoc(id: string, path?: string): Promise<CouncilCall<CouncilSaveDocRtnData>> {
    return call("save doc", () => RpcApi.CouncilSaveDocCommand(TabRpcClient, { id, path }));
}

/** The person's Useful / Not really on a finished council's report: wavesrv keeps it on the council and adds it to the
 *  benchmark's results. The command answers nothing, so on success the council's atom is patched from what was sent at
 *  once and the thanks line does not wait for `council:changed`. A failure leaves the council as it was. */
export async function rateCouncil(id: string, rating: CouncilRating): Promise<CouncilCall<void>> {
    const r = await call("rate", () => RpcApi.CouncilRateCommand(TabRpcClient, { id, rating }));
    const rated = globalStore.get(councilAtom(id));
    if (r.ok && rated != null) {
        globalStore.set(councilAtom(id), { ...rated, rating, ratedat: Date.now() });
    }
    return r;
}

/** The person's like or dislike on a seat's sent idea or reply (`item`, P1 or r3), "" to take it back. wavesrv keeps it
 *  and the seats' later prompts and the summary read it. As with a rating, the command answers nothing, so on success
 *  the council's atom is patched from what was sent and the button does not wait for `council:changed`. */
export async function thumbCouncil(id: string, item: string, thumb: CouncilThumb | ""): Promise<CouncilCall<void>> {
    const r = await call("thumb", () => RpcApi.CouncilThumbCommand(TabRpcClient, { id, item, thumb }));
    const marked = globalStore.get(councilAtom(id));
    if (r.ok && marked != null) {
        globalStore.set(councilAtom(id), withThumb(marked, item, thumb));
    }
    return r;
}

/** Pins a seat's sent idea or reply (`item`, P1 or r3) to the report as its Final proposal, in place of the one pinned
 *  before (a council has one), or with "" takes the pin back. wavesrv refuses the person's own reply, an unsent draft and
 *  an id the council lacks; its words come back as `error`. The command answers nothing, so on success the council's atom
 *  is patched from what was sent and the buttons do not wait for `council:changed`; a failure leaves the council as it
 *  was. Not the council's own pin (setCouncilPinned: its place in the tree). */
export async function finalPickCouncil(id: string, item: string): Promise<CouncilCall<void>> {
    const r = await call("final pick", () => RpcApi.CouncilFinalPickCommand(TabRpcClient, { id, item }));
    const picked = globalStore.get(councilAtom(id));
    if (r.ok && picked != null) {
        globalStore.set(councilAtom(id), { ...picked, finalpick: item });
    }
    return r;
}

/** The words of one move on a council's direction (the Memory tab, Chốt): `set` types a direction, `pin` takes one from
 *  an idea or message, `edit` rewrites the chosen one, `accept` / `dismiss` settle the waiting suggestion, `setanyway` /
 *  `discard` the held direction, `unpin` takes the chosen one off. */
export type CouncilDirectionAction = "set" | "pin" | "edit" | "accept" | "dismiss" | "setanyway" | "discard" | "unpin";

/** One move on the council's direction memory. `text` is the direction of a set, pin or edit, `from` the idea (P3) or
 *  message (r7) a pin comes from. A set, pin or edit is checked first (a model call, so it takes a moment): it becomes the
 *  chosen direction, or is held on the Memory tab with the check's reason. The command answers nothing: the new memory
 *  reaches the council through `council:changed`. wavesrv refuses an action it does not know and a set, pin or edit with
 *  no text, naming it. */
export function directionCouncil(
    id: string,
    action: CouncilDirectionAction,
    text?: string,
    from?: string
): Promise<CouncilCall<void>> {
    const data: CommandCouncilDirectionData = { id, action };
    if (text != null) {
        data.text = text;
    }
    if (from != null && from !== "") {
        data.from = from;
    }
    return call("direction", () => RpcApi.CouncilDirectionCommand(TabRpcClient, data));
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

/** The idea whose thread is open in each council's chat, or null while none is. */
export const councilOpenProposalAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

/** What is typed and not sent in a council's chat, so it survives a trip to the Summary: the channel's composer under
 *  `""`, a thread's under its idea's id; the images pasted or dropped into each box, under the same keys; and Let them
 *  read files for the next follow-up: the person's own choice, or null to let the question decide (`readsFiles`). The
 *  Summary's Ask next writes the channel's text. */
export interface CouncilChatDrafts {
    texts: Record<string, string>;
    images: Record<string, TaskImage[]>;
    tools: boolean | null;
}

export const councilChatDraftAtom = atomFamily(
    (_id: string) => atom<CouncilChatDrafts>({ texts: {}, images: {}, tools: null }) as PrimitiveAtom<CouncilChatDrafts>
);

// ---- the images in a message box ----

/** Pure: the draft with `image` added to the end of box `key`'s images. */
export function addDraftImage(d: CouncilChatDrafts, key: string, image: TaskImage): CouncilChatDrafts {
    return { ...d, images: { ...d.images, [key]: [...(d.images[key] ?? []), image] } };
}

/** Pure: the draft with `patch` (the path once written, the error once failed) on image `id` of box `key`. An image
 *  that is no longer there (a send cleared the box, an x removed it) is left gone: the draft comes back unchanged. */
export function patchDraftImage(
    d: CouncilChatDrafts,
    key: string,
    id: string,
    patch: Partial<TaskImage>
): CouncilChatDrafts {
    const images = d.images[key];
    if (images == null || !images.some((i) => i.id === id)) {
        return d;
    }
    return { ...d, images: { ...d.images, [key]: images.map((i) => (i.id === id ? { ...i, ...patch } : i)) } };
}

/** Pure: the draft without image `id` of box `key`. */
export function removeDraftImage(d: CouncilChatDrafts, key: string, id: string): CouncilChatDrafts {
    const images = d.images[key];
    if (images == null) {
        return d;
    }
    return { ...d, images: { ...d.images, [key]: images.filter((i) => i.id !== id) } };
}

/** Pure: the draft with box `key`'s images gone; the other boxes keep theirs. */
export function clearDraftImages(d: CouncilChatDrafts, key: string): CouncilChatDrafts {
    if (d.images[key] == null) {
        return d;
    }
    const { [key]: _gone, ...rest } = d.images;
    return { ...d, images: rest };
}

/** What a refused image says on its chip. */
export const IMAGE_TOO_BIG = "Image too large (over 10 MB)";

const setDraft = (councilId: string, next: (d: CouncilChatDrafts) => CouncilChatDrafts) =>
    globalStore.set(councilChatDraftAtom(councilId), next);

/** Takes the images pasted or dropped into box `key` of a council's chat (`""` the channel's, else an idea's thread): each
 *  waits at once as a chip with a preview, and is written to ~/.arc/attachments (`Keep`: the council keeps the path, and no
 *  temp sweep takes the file) as a paste's bare blob (`createTempFileFromBlob`) or a drop's file under its own name
 *  (`createTempFileFromFile`). A file over 10 MB is refused before any write, and a write that fails puts its reason on its
 *  chip; either stays on show until removed. A box holds `MAX_TASK_IMAGES`; the rest are dropped. The draft is the atom's,
 *  so a write that ends after the person left the council lands in it. */
export function addCouncilImages(councilId: string, key: string, files: File[], from: "paste" | "drop"): void {
    const room = imageRoom(globalStore.get(councilChatDraftAtom(councilId)).images[key]?.length ?? 0, files.length);
    for (const f of files.slice(0, room)) {
        const id = crypto.randomUUID();
        const previewUrl = URL.createObjectURL(f);
        if (isOversize(f.size)) {
            setDraft(councilId, (d) => addDraftImage(d, key, { id, previewUrl, error: IMAGE_TOO_BIG }));
            continue;
        }
        setDraft(councilId, (d) => addDraftImage(d, key, { id, previewUrl }));
        const write = from === "paste" ? createTempFileFromBlob(f, true) : createTempFileFromFile(f, true);
        write.then(
            (path) => setDraft(councilId, (d) => patchDraftImage(d, key, id, { path })),
            (e) => setDraft(councilId, (d) => patchDraftImage(d, key, id, { error: String(e?.message ?? e) }))
        );
    }
}

/** The x on a chip: the image goes and its preview is let go. */
export function removeCouncilImage(councilId: string, key: string, id: string): void {
    const img = globalStore.get(councilChatDraftAtom(councilId)).images[key]?.find((i) => i.id === id);
    if (img != null) {
        URL.revokeObjectURL(img.previewUrl);
    }
    setDraft(councilId, (d) => removeDraftImage(d, key, id));
}

/** A sent message took its box's images: they go and their previews are let go. */
export function clearCouncilImages(councilId: string, key: string): void {
    for (const img of globalStore.get(councilChatDraftAtom(councilId)).images[key] ?? []) {
        URL.revokeObjectURL(img.previewUrl);
    }
    setDraft(councilId, (d) => clearDraftImages(d, key));
}

/** The view each council was last shown on (showCouncil keeps it), so its tree row opens it there again. */
export const councilLastViewAtom = atomFamily(
    (_id: string) => atom<KeptCouncilView | null>(null) as PrimitiveAtom<KeptCouncilView | null>
);

/** Whether the Ideas rail beside a council's channel is folded: one choice for every council, kept per browser. */
export const councilIdeasRailFoldedAtom = atomWithStorage<boolean>("council.ideasRail.folded", false, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<boolean>;

/** The seat whose messages alone a council's Discussion shows, per council; null shows everyone. The Summary's column
 *  sets it (showCouncil's `only`); every other way into a council clears it. */
export const councilOnlyAtom = atomFamily((_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>);

/** The seat whose timeline a council's Seats popover shows, by expert id; null shows the list of seats. A seat's Timeline
 *  button and an expert card on the Map set it; the popover clears it when it closes. */
export const councilTimelineAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

/** The idea whose row is open in a council's Map matrix (the reasons under each seat's column), by proposal id; null while
 *  none is. One row is open at a time: a second click on it closes it. Kept per council so it survives a trip to the
 *  Report or the Discussion, which unmount the Map. */
export const councilMapOpenAtom = atomFamily(
    (_id: string) => atom<string | null>(null) as PrimitiveAtom<string | null>
);

/** What a council chat's Sources panel shows: the evidence of the message whose link was clicked, the file picked
 *  among it, and the thread it was opened from, which closing the panel goes back to. */
export interface CouncilSourcesView {
    owner: string; // the idea, reply or draft whose evidence it is
    title: string;
    refs: string[];
    pick: number; // the group of groupSources(refs) shown
    thread: string | null;
    // a screenshot region the person clicked: the panel shows the whole image with its box in place of the files
    region?: RegionCrop;
}

/** Each council's Sources panel, or null while it is closed. It shares the right of the chat with the thread panel. */
export const councilSourcesAtom = atomFamily(
    (_id: string) => atom<CouncilSourcesView | null>(null) as PrimitiveAtom<CouncilSourcesView | null>
);

/** Opens the Sources panel on one file of a message's evidence, in place of the thread panel it then goes back to. */
export function openCouncilSources(councilId: string, view: Omit<CouncilSourcesView, "thread">): void {
    const open = globalStore.get(councilOpenProposalAtom(councilId));
    const prev = globalStore.get(councilSourcesAtom(councilId));
    globalStore.set(councilSourcesAtom(councilId), { ...view, thread: open ?? prev?.thread ?? null });
    globalStore.set(councilOpenProposalAtom(councilId), null);
}

/** Closes the Sources panel, back to the thread it was opened from. */
export function closeCouncilSources(councilId: string): void {
    const view = globalStore.get(councilSourcesAtom(councilId));
    globalStore.set(councilSourcesAtom(councilId), null);
    if (view?.thread != null) {
        globalStore.set(councilOpenProposalAtom(councilId), view.thread);
    }
}

/** Each project's unsent Setup draft, so it survives switching away; null when there is none. */
export const councilSetupDraftAtom = atomFamily(
    (_project: string) => atom<CouncilSetupDraft | null>(null) as PrimitiveAtom<CouncilSetupDraft | null>,
    sameProject
);
