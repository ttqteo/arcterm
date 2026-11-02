// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
    handler: null as null | ((event: { data?: unknown }) => void),
    blob: vi.fn(),
    file: vi.fn(),
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        CouncilGetCommand: vi.fn(),
        CouncilListCommand: vi.fn(),
        CouncilStartCommand: vi.fn(),
        CouncilReplyCommand: vi.fn(),
        CouncilContinueCommand: vi.fn(),
        CouncilDraftCommand: vi.fn(),
        CouncilSummarizeCommand: vi.fn(),
        CouncilStopCommand: vi.fn(),
        CouncilDeleteCommand: vi.fn(),
        CouncilRetryCommand: vi.fn(),
        CouncilSuggestCommand: vi.fn(),
        CouncilAutoGenerateCommand: vi.fn(),
        CouncilEstimateCommand: vi.fn(),
        CouncilSaveDocCommand: vi.fn(),
        CouncilRolesCommand: vi.fn(),
        CouncilSaveGroupCommand: vi.fn(),
        CouncilRateCommand: vi.fn(),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { client: true } }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: vi.fn((sub: { handler: (event: { data?: unknown }) => void }) => {
        hoisted.handler = sub.handler;
        return () => {};
    }),
}));
vi.mock("@/app/view/term/termutil", () => ({
    createTempFileFromBlob: hoisted.blob,
    createTempFileFromFile: hoisted.file,
}));

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { MAX_ATTACHMENT_BYTES } from "./composerattachments";
import { emptyCouncilDraft } from "./councilmodel";
import {
    addCouncilImages,
    addDraftImage,
    autoGenerateCouncil,
    clearCouncilImages,
    clearDraftImages,
    closeCouncilSources,
    continueCouncil,
    councilAtom,
    councilChatDraftAtom,
    councilListAtom,
    councilOpenProposalAtom,
    councilRoles,
    councilSelAtom,
    councilSetupDraftAtom,
    councilSourcesAtom,
    councilUnreadAtom,
    councilViewAtom,
    deleteCouncil,
    draftCouncil,
    estimateCouncil,
    loadCouncil,
    loadCouncils,
    openCouncilSources,
    patchDraftImage,
    rateCouncil,
    removeCouncilImage,
    removeDraftImage,
    replyCouncil,
    retryExpert,
    saveCouncilDoc,
    saveCouncilGroup,
    startCouncil,
    startSavedCouncil,
    stopCouncil,
    suggestCouncil,
    summarizeCouncil,
} from "./councilstore";
import { MAX_TASK_IMAGES, type TaskImage } from "./launcherimages";

const council = (id: string, project: string, extra: Partial<Council> = {}): Council => ({
    id,
    project,
    feature: `feature ${id}`,
    experts: [],
    state: "running",
    round: 1,
    tokens: 0,
    calls: 0,
    created: 1,
    updated: 1,
    ...extra,
});

const get = vi.mocked(RpcApi.CouncilGetCommand);
const list = vi.mocked(RpcApi.CouncilListCommand);

// the event handler is installed by the first load
const emit = (data: CouncilChangedData) => hoisted.handler!({ data });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    for (const fn of Object.values(RpcApi)) {
        vi.mocked(fn).mockReset();
    }
});

describe("loading", () => {
    it("reads a project's councils into its list and into the atoms already read", async () => {
        get.mockResolvedValue(council("a1", "D:\\code\\a"));
        await loadCouncil("a1");
        list.mockResolvedValue([council("a1", "D:\\code\\a", { round: 2 }), council("a2", "D:\\code\\a")]);
        await loadCouncils("D:\\code\\a");
        expect(list).toHaveBeenCalledWith(TabRpcClient, { project: "D:\\code\\a" });
        expect(globalStore.get(councilListAtom("D:\\code\\a"))?.map((c) => c.id)).toEqual(["a1", "a2"]);
        expect(globalStore.get(councilAtom("a1"))?.round).toBe(2);
        expect(globalStore.get(councilAtom("a2"))).toBeNull();
    });

    it("keeps two spellings of one project in one list atom", async () => {
        list.mockResolvedValue([council("b1", "D:\\code\\b")]);
        await loadCouncils("D:\\code\\b");
        expect(globalStore.get(councilListAtom("d:/code/b/"))?.map((c) => c.id)).toEqual(["b1"]);
    });

    it("leaves what was loaded when a load fails", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        get.mockResolvedValueOnce(council("c1", "/p"));
        await loadCouncil("c1");
        get.mockRejectedValueOnce(new Error("gone"));
        await loadCouncil("c1");
        expect(globalStore.get(councilAtom("c1"))?.id).toBe("c1");
        quiet.mockRestore();
    });

    it("drops an earlier load's late answer", async () => {
        let slow: (c: Council) => void = () => {};
        get.mockImplementationOnce(() => new Promise<Council>((resolve) => (slow = resolve)));
        const first = loadCouncil("d1");
        get.mockResolvedValueOnce(council("d1", "/p", { round: 2 }));
        await loadCouncil("d1");
        slow(council("d1", "/p", { round: 1 }));
        await first;
        expect(globalStore.get(councilAtom("d1"))?.round).toBe(2);
    });
});

describe("council:changed", () => {
    it("reloads the named council and its project's list, only if they were read", async () => {
        get.mockResolvedValue(council("e1", "/p/e"));
        list.mockResolvedValue([council("e1", "/p/e")]);
        await loadCouncil("e1");
        await loadCouncils("/p/e");
        get.mockClear();
        list.mockClear();

        get.mockResolvedValue(council("e1", "/p/e", { round: 3 }));
        list.mockResolvedValue([council("e1", "/p/e", { round: 3 })]);
        emit({ id: "e1", project: "/p/e" });
        await settle();
        expect(get).toHaveBeenCalledTimes(1);
        expect(list).toHaveBeenCalledTimes(1);
        expect(globalStore.get(councilAtom("e1"))?.round).toBe(3);
        expect(globalStore.get(councilListAtom("/p/e"))?.[0].round).toBe(3);

        get.mockClear();
        list.mockClear();
        emit({ id: "never-read", project: "/p/other" });
        await settle();
        expect(get).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
    });

    it("reloads the list of every council too, when something read it", async () => {
        list.mockResolvedValue([]);
        await loadCouncils("");
        list.mockClear();
        emit({ id: "f1", project: "/p/f" });
        await settle();
        expect(list).toHaveBeenCalledWith(TabRpcClient, { project: "" });
    });

    it("forgets a deleted council without loading it back, and closes it when it is open", async () => {
        get.mockResolvedValue(council("k1", "/p/k", { state: "done" }));
        list.mockResolvedValue([council("k1", "/p/k", { state: "done" }), council("k2", "/p/k")]);
        await loadCouncil("k1");
        await loadCouncils("/p/k");
        globalStore.set(councilSelAtom, "k1");
        globalStore.set(councilUnreadAtom, new Set(["k1", "k2"]));
        get.mockClear();
        list.mockResolvedValue([council("k2", "/p/k")]);
        emit({ id: "k1", project: "/p/k", deleted: true });
        expect(globalStore.get(councilAtom("k1"))).toBeNull();
        expect(globalStore.get(councilListAtom("/p/k"))?.map((c) => c.id)).toEqual(["k2"]);
        expect(globalStore.get(councilSelAtom)).toBeNull();
        expect([...globalStore.get(councilUnreadAtom)]).toEqual(["k2"]);
        await settle();
        expect(get).not.toHaveBeenCalled();
    });
});

describe("actions", () => {
    it("start puts the council it made in its atom and answers it", async () => {
        const made = council("g1", "/p/g");
        vi.mocked(RpcApi.CouncilStartCommand).mockResolvedValue(made);
        const r = await startCouncil({ project: "/p/g", feature: "Rail", group: "ui" });
        expect(RpcApi.CouncilStartCommand).toHaveBeenCalledWith(TabRpcClient, {
            project: "/p/g",
            feature: "Rail",
            group: "ui",
        });
        expect(r).toEqual({ ok: true, value: made });
        expect(globalStore.get(councilAtom("g1"))).toEqual(made);
    });

    it("start-saved starts by id alone", async () => {
        vi.mocked(RpcApi.CouncilStartCommand).mockResolvedValue(council("g2", "/p/g"));
        await startSavedCouncil("g2");
        expect(RpcApi.CouncilStartCommand).toHaveBeenCalledWith(TabRpcClient, { id: "g2" });
    });

    it("answers why wavesrv refused, and logs", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(RpcApi.CouncilStartCommand).mockRejectedValue(new Error("Not run: over the budget"));
        const r = await startCouncil({ project: "/p", feature: "x" });
        expect(r).toEqual({ ok: false, error: "Not run: over the budget" });
        expect(quiet).toHaveBeenCalled();
        quiet.mockRestore();
    });

    it("passes each command its data", async () => {
        vi.mocked(RpcApi.CouncilReplyCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.CouncilContinueCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.CouncilSummarizeCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.CouncilStopCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.CouncilRetryCommand).mockResolvedValue(undefined);
        vi.mocked(RpcApi.CouncilSaveGroupCommand).mockResolvedValue(undefined);
        await replyCouncil({ id: "h1", proposalid: "P2", parentid: "r1", text: "why?", tools: true });
        await continueCouncil({ id: "h1", cut: ["P6"], question: "which?" });
        await summarizeCouncil("h1");
        await stopCouncil("h1");
        await retryExpert("h1", "sk");
        await retryExpert("h1", "coordinator", "sonnet");
        const group = { id: "mine", name: "Mine", roles: ["ux"], coordinator: "coordinator" };
        await saveCouncilGroup(group);
        expect(RpcApi.CouncilReplyCommand).toHaveBeenCalledWith(TabRpcClient, {
            id: "h1",
            proposalid: "P2",
            parentid: "r1",
            text: "why?",
            tools: true,
        });
        expect(RpcApi.CouncilContinueCommand).toHaveBeenCalledWith(TabRpcClient, {
            id: "h1",
            cut: ["P6"],
            question: "which?",
        });
        expect(RpcApi.CouncilSummarizeCommand).toHaveBeenCalledWith(TabRpcClient, { id: "h1" });
        expect(RpcApi.CouncilStopCommand).toHaveBeenCalledWith(TabRpcClient, { id: "h1" });
        expect(RpcApi.CouncilRetryCommand).toHaveBeenCalledWith(TabRpcClient, { id: "h1", expertid: "sk" });
        expect(RpcApi.CouncilRetryCommand).toHaveBeenCalledWith(TabRpcClient, {
            id: "h1",
            expertid: "coordinator",
            model: "sonnet",
        });
        expect(RpcApi.CouncilSaveGroupCommand).toHaveBeenCalledWith(TabRpcClient, group);
    });

    it("draft passes the council, the item, the action and the text of an edit", async () => {
        vi.mocked(RpcApi.CouncilDraftCommand).mockResolvedValue(undefined);
        expect(await draftCouncil("h1", "P2", "send")).toEqual({ ok: true, value: undefined });
        expect(await draftCouncil("h1", "r3", "edit", "Shorter: keep it awake only while it is on screen.")).toEqual({
            ok: true,
            value: undefined,
        });
        expect(await draftCouncil("h1", "P4", "drop")).toEqual({ ok: true, value: undefined });
        const calls = vi.mocked(RpcApi.CouncilDraftCommand).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0]).toEqual([TabRpcClient, { id: "h1", itemid: "P2", action: "send" }]);
        expect(calls[1]).toEqual([
            TabRpcClient,
            { id: "h1", itemid: "r3", action: "edit", text: "Shorter: keep it awake only while it is on screen." },
        ]);
        expect(calls[2]).toEqual([TabRpcClient, { id: "h1", itemid: "P4", action: "drop" }]);
    });

    it("draft answers why wavesrv refused it, and logs", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(RpcApi.CouncilDraftCommand).mockRejectedValue(new Error("P2 is not a held draft"));
        const r = await draftCouncil("h1", "P2", "send");
        expect(r).toEqual({ ok: false, error: "P2 is not a held draft" });
        expect(quiet).toHaveBeenCalled();
        quiet.mockRestore();
    });

    it("delete removes the council from its atoms once wavesrv agrees, and leaves it when refused", async () => {
        get.mockResolvedValue(council("m1", "/p/m", { state: "failed" }));
        await loadCouncil("m1");
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(RpcApi.CouncilDeleteCommand).mockRejectedValueOnce(new Error("council m1 is running"));
        expect(await deleteCouncil("m1")).toEqual({ ok: false, error: "council m1 is running" });
        expect(globalStore.get(councilAtom("m1"))?.id).toBe("m1");
        quiet.mockRestore();

        vi.mocked(RpcApi.CouncilDeleteCommand).mockResolvedValueOnce(undefined);
        expect(await deleteCouncil("m1")).toEqual({ ok: true, value: undefined });
        expect(RpcApi.CouncilDeleteCommand).toHaveBeenCalledWith(TabRpcClient, { id: "m1" });
        expect(globalStore.get(councilAtom("m1"))).toBeNull();
    });

    it("answers what the read commands answer", async () => {
        const suggestion = { files: ["a.go"], roles: [], group: "ui" };
        const estimate = { calls: 9, tokens: 820_000, minutes: 6 };
        const roles = { roles: [], groups: [] };
        vi.mocked(RpcApi.CouncilSuggestCommand).mockResolvedValue(suggestion);
        vi.mocked(RpcApi.CouncilEstimateCommand).mockResolvedValue(estimate);
        vi.mocked(RpcApi.CouncilSaveDocCommand).mockResolvedValue({ path: "docs/council/x.md" });
        vi.mocked(RpcApi.CouncilRolesCommand).mockResolvedValue(roles);
        expect(await suggestCouncil({ project: "/p", feature: "Rail" })).toEqual({ ok: true, value: suggestion });
        expect(await estimateCouncil({ id: "h1", followup: 2 })).toEqual({ ok: true, value: estimate });
        expect(await saveCouncilDoc("h1")).toEqual({ ok: true, value: { path: "docs/council/x.md" } });
        expect(RpcApi.CouncilSaveDocCommand).toHaveBeenCalledWith(TabRpcClient, { id: "h1", path: undefined });
        expect(await councilRoles()).toEqual({ ok: true, value: roles });
        expect(RpcApi.CouncilRolesCommand).toHaveBeenCalledWith(TabRpcClient);
    });

    it("auto-generate answers the result, or the message of why wavesrv could not write one", async () => {
        const request = { project: "/p", agents: ["t1", "t2"] };
        const written = { topic: "Rail apps", question: "Is the pin worth it?", mode: "brainstorm" };
        vi.mocked(RpcApi.CouncilAutoGenerateCommand).mockResolvedValueOnce(written);
        expect(await autoGenerateCouncil(request)).toEqual({ ok: true, value: written });
        expect(RpcApi.CouncilAutoGenerateCommand).toHaveBeenCalledWith(TabRpcClient, request);

        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(RpcApi.CouncilAutoGenerateCommand).mockRejectedValueOnce(
            new Error("none of the seated agents has a conversation to read")
        );
        expect(await autoGenerateCouncil(request)).toEqual({
            ok: false,
            error: "none of the seated agents has a conversation to read",
        });
        expect(quiet).toHaveBeenCalled();
        quiet.mockRestore();
    });

    it("takes a method swapped in after the module loaded", async () => {
        const stub = vi.fn().mockResolvedValue(undefined);
        const real = RpcApi.CouncilSummarizeCommand;
        RpcApi.CouncilSummarizeCommand = stub;
        try {
            await summarizeCouncil("h2");
        } finally {
            RpcApi.CouncilSummarizeCommand = real;
        }
        expect(stub).toHaveBeenCalledWith(TabRpcClient, { id: "h2" });
    });
});

describe("rating", () => {
    // a command with no answer resolves null over the wire, though its type is void
    const nullAnswer = null as unknown as void;

    it("sends the rating and puts it on the council's atom at once, without waiting for council:changed", async () => {
        get.mockResolvedValue(council("r1", "/p/r", { state: "done" }));
        await loadCouncil("r1");
        // so the atom is patched from what was sent, not from the answer
        vi.mocked(RpcApi.CouncilRateCommand).mockResolvedValue(nullAnswer);
        const before = Date.now();
        const r = await rateCouncil("r1", "useful");
        expect(r).toEqual({ ok: true, value: null });
        expect(RpcApi.CouncilRateCommand).toHaveBeenCalledWith(TabRpcClient, { id: "r1", rating: "useful" });
        const rated = globalStore.get(councilAtom("r1"));
        expect(rated?.rating).toBe("useful");
        expect(rated?.ratedat).toBeGreaterThanOrEqual(before);
        expect(rated?.state).toBe("done");

        // changing it takes the later one
        await rateCouncil("r1", "not");
        expect(globalStore.get(councilAtom("r1"))?.rating).toBe("not");
    });

    it("leaves the council's atom as it was when the call fails, and says why", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
        get.mockResolvedValue(council("r2", "/p/r", { state: "done" }));
        await loadCouncil("r2");
        vi.mocked(RpcApi.CouncilRateCommand).mockRejectedValue(new Error("disk full"));
        const r = await rateCouncil("r2", "not");
        expect(r).toEqual({ ok: false, error: "disk full" });
        expect(globalStore.get(councilAtom("r2"))?.rating).toBeUndefined();
        expect(quiet).toHaveBeenCalled();
        quiet.mockRestore();
    });

    it("rates a council that is not loaded without making an atom value out of nothing", async () => {
        vi.mocked(RpcApi.CouncilRateCommand).mockResolvedValue(nullAnswer);
        const r = await rateCouncil("r3", "useful");
        expect(r.ok).toBe(true);
        expect(globalStore.get(councilAtom("r3"))).toBeNull();
    });
});

describe("UI state", () => {
    it("starts with no council open, on the Discussion", () => {
        expect(globalStore.get(councilSelAtom)).toBeNull();
        expect(globalStore.get(councilViewAtom)).toBe("discussion");
        expect(globalStore.get(councilOpenProposalAtom("x"))).toBeNull();
        expect(globalStore.get(councilSourcesAtom("x"))).toBeNull();
    });

    it("opens the Sources panel in place of a thread, and closing it goes back to that thread", () => {
        globalStore.set(councilOpenProposalAtom("s1"), "P2");
        openCouncilSources("s1", { owner: "P2", title: "Two", refs: ["a.ts:1", "b.ts:2"], pick: 0 });
        expect(globalStore.get(councilOpenProposalAtom("s1"))).toBeNull();
        expect(globalStore.get(councilSourcesAtom("s1"))).toMatchObject({ owner: "P2", pick: 0, thread: "P2" });
        // picking another file of the same message keeps where to go back to
        openCouncilSources("s1", { owner: "P2", title: "Two", refs: ["a.ts:1", "b.ts:2"], pick: 1 });
        expect(globalStore.get(councilSourcesAtom("s1"))).toMatchObject({ pick: 1, thread: "P2" });
        closeCouncilSources("s1");
        expect(globalStore.get(councilSourcesAtom("s1"))).toBeNull();
        expect(globalStore.get(councilOpenProposalAtom("s1"))).toBe("P2");
    });

    it("closes Sources opened from the channel with no thread to go back to", () => {
        openCouncilSources("s2", { owner: "P1", title: "One", refs: ["a.ts:1"], pick: 0 });
        closeCouncilSources("s2");
        expect(globalStore.get(councilSourcesAtom("s2"))).toBeNull();
        expect(globalStore.get(councilOpenProposalAtom("s2"))).toBeNull();
    });

    it("keeps a Setup draft per project, under either spelling of its path", () => {
        const draft = { ...emptyCouncilDraft("D:\\code\\z"), feature: "Rail apps" };
        expect(globalStore.get(councilSetupDraftAtom("D:\\code\\z"))).toBeNull();
        globalStore.set(councilSetupDraftAtom("D:\\code\\z"), draft);
        expect(globalStore.get(councilSetupDraftAtom("d:/code/z"))?.feature).toBe("Rail apps");
        expect(globalStore.get(councilSetupDraftAtom("D:\\code\\other"))).toBeNull();
    });
});

describe("the images in a council's message boxes", () => {
    const img = (id: string, extra: Partial<TaskImage> = {}): TaskImage => ({ id, previewUrl: `blob:${id}`, ...extra });
    const empty = () => ({ texts: {}, images: {}, tools: null as boolean | null });
    const png = (name = "shot.png") => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

    describe("the pure helpers", () => {
        it("keeps each box's images apart, the channel's under the empty key and a thread's under its idea", () => {
            let d = addDraftImage(empty(), "", img("a"));
            d = addDraftImage(d, "P1", img("b"));
            d = addDraftImage(d, "", img("c"));
            expect(d.images[""].map((i) => i.id)).toEqual(["a", "c"]);
            expect(d.images["P1"].map((i) => i.id)).toEqual(["b"]);
        });

        it("leaves the texts and the switch alone", () => {
            const d = addDraftImage({ texts: { "": "hello" }, images: {}, tools: true }, "", img("a"));
            expect(d.texts).toEqual({ "": "hello" });
            expect(d.tools).toBe(true);
        });

        it("patches one image of one box: its path once written, its error once failed", () => {
            let d = addDraftImage(addDraftImage(empty(), "", img("a")), "P1", img("a"));
            d = patchDraftImage(d, "", "a", { path: "/att/a.png" });
            expect(d.images[""][0].path).toBe("/att/a.png");
            expect(d.images["P1"][0].path).toBeUndefined();
            d = patchDraftImage(d, "P1", "a", { error: "boom" });
            expect(d.images["P1"][0].error).toBe("boom");
        });

        it("patches nothing for an image a send or a remove took away while it uploaded", () => {
            const d = addDraftImage(empty(), "", img("a"));
            const gone = removeDraftImage(d, "", "a");
            expect(patchDraftImage(gone, "", "a", { path: "/att/a.png" })).toEqual(gone);
            expect(patchDraftImage(empty(), "P9", "a", { path: "/x" })).toEqual(empty());
        });

        it("removes one image and keeps the rest of its box and the other boxes", () => {
            let d = addDraftImage(addDraftImage(empty(), "", img("a")), "", img("b"));
            d = addDraftImage(d, "P1", img("a"));
            d = removeDraftImage(d, "", "a");
            expect(d.images[""].map((i) => i.id)).toEqual(["b"]);
            expect(d.images["P1"].map((i) => i.id)).toEqual(["a"]);
        });

        it("clears one box's images and keeps the other boxes", () => {
            let d = addDraftImage(addDraftImage(empty(), "", img("a")), "P1", img("b"));
            d = clearDraftImages(d, "");
            expect(d.images[""] ?? []).toEqual([]);
            expect(d.images["P1"].map((i) => i.id)).toEqual(["b"]);
        });
    });

    describe("the actions", () => {
        const realUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
        let revoke: ReturnType<typeof vi.fn>;
        let n = 0;
        let id = 0;
        const box = () => globalStore.get(councilChatDraftAtom(`img-${id}`));

        beforeEach(() => {
            id++;
            n = 0;
            URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
            revoke = vi.fn();
            URL.revokeObjectURL = revoke;
            hoisted.blob.mockReset();
            hoisted.file.mockReset();
        });

        afterEach(() => {
            URL.createObjectURL = realUrl.create;
            URL.revokeObjectURL = realUrl.revoke;
        });

        it("shows a pasted image at once as a chip with no path, then keeps its file once written", async () => {
            hoisted.blob.mockResolvedValue("/home/u/.arc/attachments/d-1/paste.png");
            addCouncilImages(`img-${id}`, "", [png()], "paste");
            expect(box().images[""]).toEqual([{ id: expect.any(String), previewUrl: "blob:preview-1" }]);
            await settle();
            expect(hoisted.blob).toHaveBeenCalledWith(expect.any(File), true);
            expect(box().images[""][0].path).toBe("/home/u/.arc/attachments/d-1/paste.png");
        });

        it("keeps a dropped image under its own name, in the attachments folder as a paste is", async () => {
            hoisted.file.mockResolvedValue("/home/u/.arc/attachments/d-2/shot.png");
            addCouncilImages(`img-${id}`, "P1", [png("shot.png")], "drop");
            await settle();
            expect(hoisted.file).toHaveBeenCalledWith(expect.any(File), true);
            expect(box().images["P1"][0].path).toBe("/home/u/.arc/attachments/d-2/shot.png");
            expect(box().images[""] ?? []).toEqual([]);
        });

        it("puts the reason on the chip of an upload that failed, and keeps it on show", async () => {
            hoisted.blob.mockRejectedValue(new Error("disk full"));
            addCouncilImages(`img-${id}`, "", [png()], "paste");
            await settle();
            expect(box().images[""]).toHaveLength(1);
            expect(box().images[""][0]).toMatchObject({ error: "disk full" });
            expect(box().images[""][0].path).toBeUndefined();
        });

        it("refuses a file over 10 MB before any upload, as an error chip", async () => {
            const big = png("big.png");
            Object.defineProperty(big, "size", { value: MAX_ATTACHMENT_BYTES + 1 });
            addCouncilImages(`img-${id}`, "", [big], "paste");
            await settle();
            expect(hoisted.blob).not.toHaveBeenCalled();
            expect(hoisted.file).not.toHaveBeenCalled();
            expect(box().images[""]).toHaveLength(1);
            expect(box().images[""][0].error).toMatch(/10 MB/);
        });

        it("takes a file of exactly 10 MB", async () => {
            hoisted.blob.mockResolvedValue("/att/edge.png");
            const edge = png("edge.png");
            Object.defineProperty(edge, "size", { value: MAX_ATTACHMENT_BYTES });
            addCouncilImages(`img-${id}`, "", [edge], "paste");
            await settle();
            expect(hoisted.blob).toHaveBeenCalledTimes(1);
            expect(box().images[""][0].path).toBe("/att/edge.png");
        });

        it("takes no more images than a box has room for", async () => {
            hoisted.blob.mockResolvedValue("/att/x.png");
            addCouncilImages(
                `img-${id}`,
                "",
                Array.from({ length: MAX_TASK_IMAGES + 3 }, () => png()),
                "paste"
            );
            await settle();
            expect(box().images[""]).toHaveLength(MAX_TASK_IMAGES);
        });

        it("removes one image and lets go of its preview", async () => {
            hoisted.blob.mockResolvedValue("/att/x.png");
            addCouncilImages(`img-${id}`, "", [png(), png()], "paste");
            await settle();
            const [first, second] = box().images[""];
            removeCouncilImage(`img-${id}`, "", first.id);
            expect(box().images[""].map((i) => i.id)).toEqual([second.id]);
            expect(revoke).toHaveBeenCalledTimes(1);
            expect(revoke).toHaveBeenCalledWith(first.previewUrl);
        });

        it("clears one box on a send and lets go of every preview in it, and none of another box's", async () => {
            hoisted.blob.mockResolvedValue("/att/x.png");
            addCouncilImages(`img-${id}`, "", [png(), png()], "paste");
            addCouncilImages(`img-${id}`, "P1", [png()], "paste");
            await settle();
            const kept = box().images["P1"][0];
            clearCouncilImages(`img-${id}`, "");
            expect(box().images[""] ?? []).toEqual([]);
            expect(box().images["P1"]).toEqual([kept]);
            expect(revoke).toHaveBeenCalledTimes(2);
            expect(revoke).not.toHaveBeenCalledWith(kept.previewUrl);
        });

        it("keeps the images of a council that was left, for when it is opened again", async () => {
            hoisted.blob.mockResolvedValue("/att/x.png");
            addCouncilImages(`img-${id}`, "", [png()], "paste");
            await settle();
            // nothing in the view holds the draft: it is the atom's
            expect(globalStore.get(councilChatDraftAtom(`img-${id}`)).images[""][0].path).toBe("/att/x.png");
        });

        it("finishes an upload into the draft after the box was left, and into no box after a send cleared it", async () => {
            let done: (path: string) => void = () => {};
            hoisted.blob.mockImplementation(() => new Promise<string>((resolve) => (done = resolve)));
            addCouncilImages(`img-${id}`, "", [png()], "paste");
            clearCouncilImages(`img-${id}`, "");
            done("/att/late.png");
            await settle();
            expect(box().images[""] ?? []).toEqual([]);
        });
    });
});
