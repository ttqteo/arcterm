// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addBlocker,
    addedRecord,
    blockDraftKey,
    blockKey,
    canAdd,
    cardPhase,
    cardStatic,
    chipProgress,
    chunkLinesOf,
    chunkOptions,
    clipLabel,
    coerceCards,
    coerceDraft,
    coerceHandled,
    coerceLines,
    dismissedRecord,
    draftFromBlock,
    draftFromMessage,
    effortOref,
    fitBytes,
    foldRowLabel,
    foldRowParts,
    hasInitiativeBlock,
    isFreshMessageCard,
    isLaterDraft,
    kindLabel,
    laterRowKeys,
    laterVerb,
    messageDraftKey,
    parseInitiativeBlock,
    pendingSwitch,
    putBackLines,
    queueLine,
    readStoredMap,
    resultLine,
    sentSwitch,
    settleCard,
    startsInEditor,
    stripResultLines,
    switchLine,
    takeLines,
    topicsOf,
    verbOf,
    waitingDot,
    withDraft,
    withEffort,
    withHandled,
    withKind,
    withLaterTarget,
    withMessageCard,
    withoutKey,
    withoutLaterItem,
    withoutSwitchLine,
    withSwitchHeld,
    withResultLines,
    withSwitchLine,
    withTopic,
    type CardPhase,
    type HandledRecord,
    type InitiativeBlock,
    type InitiativeCtx,
    type InitiativeDraft,
    type MessageCard,
} from "./chatinitiative";

const AGENT = "effort:7655bf18";
const OTHER = "effort:aaaa1111";
const TOPIC = "effort:70b1c000";

const efforts = [{ oref: AGENT, parentoid: "70b1c000" }, { oref: OTHER }, { oref: TOPIC }];

const ctx: InitiativeCtx = {
    agentEffortId: "7655bf18",
    agentChunk: "Chat: add to an initiative",
    efforts,
    chunksOf: (oref) =>
        oref === AGENT ? ["Chat: add to an initiative", "Another chunk"] : oref === OTHER ? ["Other one"] : undefined,
};

const note = (over: Partial<HandledRecord> = {}): HandledRecord => ({
    outcome: "added",
    kind: "note",
    effort: AGENT,
    initiative: "GUI redesign after the AI-chat references",
    chunk: "Chat: add to an initiative",
    chunkNumber: 2,
    text: "Spec chốt và đã qua builder check.",
    at: 1000,
    ...over,
});

describe("parseInitiativeBlock", () => {
    it("reads a valid block and keeps the fields it knows", () => {
        const raw = JSON.stringify({
            kind: "note",
            effort: "7655bf18",
            chunk: "Chat: add to an initiative",
            text: "  a note  ",
            extra: 1,
        });
        expect(parseInitiativeBlock(raw)).toEqual({
            kind: "note",
            effort: "7655bf18",
            chunk: "Chat: add to an initiative",
            text: "a note",
        });
    });

    it("reads a new initiative's title, chunks and parent", () => {
        const raw = JSON.stringify({
            kind: "initiative",
            text: "why",
            title: "Shell completion everywhere",
            chunks: ["one", " ", "two", 3],
            parent: "effort:70b1c000",
        });
        expect(parseInitiativeBlock(raw)).toEqual({
            kind: "initiative",
            text: "why",
            title: "Shell completion everywhere",
            chunks: ["one", "two"],
            parent: "effort:70b1c000",
        });
    });

    it("is null for broken JSON", () => {
        expect(parseInitiativeBlock('{"kind": "note", "text": ')).toBeNull();
        expect(parseInitiativeBlock("")).toBeNull();
    });

    it("is null for a value that is not an object", () => {
        expect(parseInitiativeBlock("[]")).toBeNull();
        expect(parseInitiativeBlock('"note"')).toBeNull();
        expect(parseInitiativeBlock("null")).toBeNull();
        expect(parseInitiativeBlock("3")).toBeNull();
    });

    it("is null for an unknown kind", () => {
        expect(parseInitiativeBlock(JSON.stringify({ kind: "task", text: "x" }))).toBeNull();
        expect(parseInitiativeBlock(JSON.stringify({ text: "x" }))).toBeNull();
    });

    it("is null for a missing or blank text", () => {
        expect(parseInitiativeBlock(JSON.stringify({ kind: "note" }))).toBeNull();
        expect(parseInitiativeBlock(JSON.stringify({ kind: "note", text: "  \n " }))).toBeNull();
        expect(parseInitiativeBlock(JSON.stringify({ kind: "note", text: 4 }))).toBeNull();
    });
});

describe("hasInitiativeBlock", () => {
    it("finds an arc-initiative fence at a line start", () => {
        expect(hasInitiativeBlock('Intro\n\n```arc-initiative\n{"kind":"note"}\n```')).toBe(true);
        expect(hasInitiativeBlock("```arc-initiative\n{}\n```")).toBe(true);
    });

    it("leaves other fences and mid-line mentions alone", () => {
        expect(hasInitiativeBlock("```json\n{}\n```")).toBe(false);
        expect(hasInitiativeBlock("use an ```arc-initiative block")).toBe(false);
        expect(hasInitiativeBlock("```arc-initiative-two\n{}\n```")).toBe(false);
    });
});

describe("blockKey", () => {
    const base: InitiativeBlock = { kind: "note", effort: "7655bf18", chunk: "c", text: "a note" };

    it("is equal across whitespace and key order", () => {
        const a = parseInitiativeBlock('{"kind":"note","effort":"7655bf18","chunk":"c","text":"a note"}')!;
        const b = parseInitiativeBlock(
            '{\n  "text": "a note",\n  "chunk": "c",\n  "effort": "7655bf18",\n  "kind": "note"\n}'
        )!;
        expect(blockKey(a)).toBe(blockKey(b));
        expect(blockKey(a)).toBe(blockKey(base));
    });

    it("ignores a field the model does not know", () => {
        const a = parseInitiativeBlock('{"kind":"note","effort":"7655bf18","chunk":"c","text":"a note","why":"x"}')!;
        expect(blockKey(a)).toBe(blockKey(base));
    });

    it("differs when the content differs", () => {
        expect(blockKey({ ...base, text: "another note" })).not.toBe(blockKey(base));
        expect(blockKey({ ...base, kind: "chunk" })).not.toBe(blockKey(base));
        expect(blockKey({ ...base, chunk: "d" })).not.toBe(blockKey(base));
        expect(blockKey({ ...base, chunks: ["x"] })).not.toBe(blockKey(base));
    });
});

describe("effortOref", () => {
    it("is effort:<oid> from either form", () => {
        expect(effortOref("7655bf18")).toBe("effort:7655bf18");
        expect(effortOref("effort:7655bf18")).toBe("effort:7655bf18");
        expect(effortOref("  effort:7655bf18 ")).toBe("effort:7655bf18");
    });

    it("is empty for a blank id", () => {
        expect(effortOref("")).toBe("");
        expect(effortOref("effort:")).toBe("");
    });
});

describe("default target", () => {
    it("is the block's own initiative and chunk", () => {
        const block: InitiativeBlock = { kind: "note", effort: "aaaa1111", chunk: "Other one", text: "x" };
        const d = draftFromBlock(block, ctx);
        expect(d.effort).toBe(OTHER);
        expect(d.chunk).toBe("Other one");
        expect(d.kind).toBe("note");
        expect(d.text).toBe("x");
    });

    it("is the agent's initiative and the chunk it holds when the block names none", () => {
        const d = draftFromBlock({ kind: "note", text: "x" }, ctx);
        expect(d.effort).toBe(AGENT);
        expect(d.chunk).toBe("Chat: add to an initiative");
        expect(canAdd(d)).toBe(true);
    });

    it("takes the agent's chunk only for the agent's own initiative", () => {
        const d = draftFromBlock({ kind: "note", effort: "aaaa1111", text: "x" }, { ...ctx, chunksOf: undefined });
        expect(d.effort).toBe(OTHER);
        expect(d.chunk).toBeNull();
        expect(canAdd(d)).toBe(false);
    });

    it("leaves an initiative that is not in the list empty", () => {
        const d = draftFromBlock({ kind: "note", effort: "deadbeef", chunk: "c", text: "x" }, ctx);
        expect(d.effort).toBeNull();
        expect(d.chunk).toBeNull();
        expect(canAdd(d)).toBe(false);
    });

    it("leaves a chunk that is not among the initiative's chunks empty, when they are known", () => {
        const d = draftFromBlock({ kind: "note", chunk: "Not a chunk", text: "x" }, ctx);
        expect(d.effort).toBe(AGENT);
        expect(d.chunk).toBeNull();
        expect(canAdd(d)).toBe(false);
    });

    it("keeps a chunk it cannot check yet", () => {
        const d = draftFromBlock({ kind: "note", chunk: "Whatever", text: "x" }, { ...ctx, chunksOf: undefined });
        expect(d.chunk).toBe("Whatever");
    });

    it("is empty with no block target and no agent initiative, so Add is disabled", () => {
        const d = draftFromBlock({ kind: "note", text: "x" }, { efforts });
        expect(d.effort).toBeNull();
        expect(d.chunk).toBeNull();
        expect(d.parent).toBeNull();
        expect(canAdd(d)).toBe(false);
    });

    it("is empty while the list has not loaded", () => {
        const d = draftFromBlock({ kind: "note", text: "x" }, { ...ctx, efforts: [] });
        expect(d.effort).toBeNull();
    });

    it("puts a new initiative under the block's parent, else under the agent initiative's topic", () => {
        const own = draftFromBlock({ kind: "initiative", text: "x", title: "T", parent: "aaaa1111" }, ctx);
        expect(own.parent).toBe(OTHER);
        const inherited = draftFromBlock({ kind: "initiative", text: "x", title: "T" }, ctx);
        expect(inherited.parent).toBe(TOPIC);
        const unknown = draftFromBlock({ kind: "initiative", text: "x", title: "T", parent: "deadbeef" }, ctx);
        expect(unknown.parent).toBeNull();
    });

    it("fills a new initiative's title and chunks", () => {
        const d = draftFromBlock(
            { kind: "initiative", text: "line one\nline two", title: "Shell completion", chunks: ["a", "b"] },
            ctx
        );
        expect(d.title).toBe("Shell completion");
        expect(d.chunks).toBe("a\nb");
        const noTitle = draftFromBlock({ kind: "initiative", text: "line one\nline two" }, ctx);
        expect(noTitle.title).toBe("line one");
    });

    it("clips a chunk's text to a label", () => {
        const d = draftFromBlock({ kind: "chunk", text: "x".repeat(300) }, ctx);
        expect(d.text).toHaveLength(200);
        expect(d.text.endsWith("…")).toBe(true);
    });

    it("from a message is a note with the whole text into the agent's initiative and chunk", () => {
        const text = "first line\n\nsecond   line";
        const d = draftFromMessage(text, ctx);
        expect(d).toMatchObject({
            kind: "note",
            text,
            effort: AGENT,
            chunk: "Chat: add to an initiative",
            parent: TOPIC,
        });
    });
});

describe("canAdd", () => {
    const draft = (over: Partial<InitiativeDraft>): InitiativeDraft => ({
        kind: "note",
        text: "x",
        title: "",
        chunks: "",
        effort: AGENT,
        chunk: "c",
        parent: null,
        ...over,
    });

    it("needs a note's initiative, chunk and text", () => {
        expect(canAdd(draft({}))).toBe(true);
        expect(canAdd(draft({ effort: null }))).toBe(false);
        expect(canAdd(draft({ chunk: null }))).toBe(false);
        expect(canAdd(draft({ text: " \n" }))).toBe(false);
    });

    it("needs a chunk's initiative and text, not a chunk", () => {
        expect(canAdd(draft({ kind: "chunk", chunk: null }))).toBe(true);
        expect(canAdd(draft({ kind: "chunk", effort: null }))).toBe(false);
        expect(canAdd(draft({ kind: "chunk", text: "" }))).toBe(false);
    });

    it("needs a new initiative's title, nothing else", () => {
        expect(canAdd(draft({ kind: "initiative", effort: null, chunk: null, text: "", title: "T" }))).toBe(true);
        expect(canAdd(draft({ kind: "initiative", title: "  " }))).toBe(false);
    });
});

describe("clipLabel and withKind", () => {
    it("clips to 200 characters with an ellipsis and folds whitespace", () => {
        expect(clipLabel("a   b\n c")).toBe("a b c");
        expect(clipLabel("x".repeat(200))).toBe("x".repeat(200));
        const long = clipLabel("x".repeat(300));
        expect(long).toHaveLength(200);
        expect(long.endsWith("…")).toBe(true);
    });

    it("clips the text when the draft switches to a chunk", () => {
        const d = draftFromMessage("y".repeat(500), ctx);
        const chunk = withKind(d, "chunk");
        expect(chunk.kind).toBe("chunk");
        expect(chunk.text).toHaveLength(200);
        expect(chunk.effort).toBe(AGENT);
    });

    it("gives a new initiative a title from the first line, and keeps one it has", () => {
        const d = draftFromMessage("Shell completion\nmore", ctx);
        expect(withKind(d, "initiative").title).toBe("Shell completion");
        expect(withKind({ ...d, title: "Mine" }, "initiative").title).toBe("Mine");
    });

    it("is the same draft for the same kind", () => {
        const d = draftFromMessage("x", ctx);
        expect(withKind(d, "note")).toBe(d);
    });

    it("names the verb and the switch by kind", () => {
        expect(verbOf("note")).toBe("Add note");
        expect(verbOf("chunk")).toBe("Add chunk");
        expect(verbOf("initiative")).toBe("Create initiative");
        expect(kindLabel("chunk")).toBe("New chunk");
        expect(kindLabel("note")).toBe("Note");
        expect(kindLabel("initiative")).toBe("New initiative");
    });
});

describe("fitBytes and chunkLinesOf", () => {
    it("fits a text to a byte limit without cutting a character", () => {
        expect(fitBytes("short", 200)).toBe("short");
        const vi = fitBytes("ệ".repeat(100), 200); // 3 bytes each
        expect(new TextEncoder().encode(vi).length).toBeLessThanOrEqual(200);
        expect(vi.endsWith("…")).toBe(true);
        expect(vi).not.toContain("�");
    });

    it("reads one chunk per line, drops blanks and repeats", () => {
        expect(chunkLinesOf("one\n\n  two  \none\n")).toEqual(["one", "two"]);
        expect(chunkLinesOf("")).toEqual([]);
    });
});

describe("what the card view decides", () => {
    const base = draftFromMessage("Spec chốt.", ctx);

    it("reopens in the editor for a message card, or when the body was edited", () => {
        expect(startsInEditor("message", base, base)).toBe(true);
        expect(startsInEditor("agent", base, base)).toBe(false);
        expect(startsInEditor("agent", { ...base, text: "Trimmed." }, base)).toBe(true);
        expect(startsInEditor("agent", { ...base, kind: "chunk" }, base)).toBe(true);
        expect(startsInEditor("agent", { ...base, title: "T" }, base)).toBe(true);
        expect(startsInEditor("agent", { ...base, chunks: "a\nb" }, base)).toBe(true);
    });

    it("does not count a changed target as an edit of the body", () => {
        expect(startsInEditor("agent", { ...base, effort: OTHER, chunk: "Other one", parent: TOPIC }, base)).toBe(
            false
        );
    });

    it("picks an initiative: the agent's own keeps its chunk, another one asks for a chunk", () => {
        const picked = withEffort(base, OTHER, ctx);
        expect(picked.effort).toBe(OTHER);
        expect(picked.chunk).toBeNull();
        expect(picked.text).toBe(base.text);
        const back = withEffort(picked, "7655bf18", ctx);
        expect(back.effort).toBe(AGENT);
        expect(back.chunk).toBe("Chat: add to an initiative");
        expect(withEffort(base, "effort:7655bf18", { ...ctx, agentChunk: null }).chunk).toBeNull();
    });

    it("picks and clears a topic", () => {
        expect(withTopic(base, "70b1c000").parent).toBe(TOPIC);
        expect(withTopic(base, TOPIC).parent).toBe(TOPIC);
        expect(withTopic({ ...base, parent: TOPIC }, null).parent).toBeNull();
    });

    it("numbers the chunks from 1 and marks the agent's own", () => {
        expect(chunkOptions(["A", "B", "C"], "B")).toEqual([
            { n: 1, label: "A", mine: false },
            { n: 2, label: "B", mine: true },
            { n: 3, label: "C", mine: false },
        ]);
        expect(chunkOptions(["A"], null)).toEqual([{ n: 1, label: "A", mine: false }]);
        expect(chunkOptions([], "A")).toEqual([]);
    });

    it("says what Add waits on, and nothing once it can run", () => {
        expect(addBlocker(base)).toBeNull();
        expect(addBlocker({ ...base, effort: null, chunk: null })).toBe("Pick an initiative first");
        expect(addBlocker({ ...base, chunk: null })).toBe("Pick a chunk first");
        expect(addBlocker({ ...base, text: "  " })).toBe("Write the note first");
        expect(addBlocker({ ...base, kind: "chunk", chunk: null })).toBeNull();
        expect(addBlocker({ ...base, kind: "chunk", text: "" })).toBe("Write the chunk first");
        expect(addBlocker({ ...base, kind: "initiative", title: " " })).toBe("Give it a title first");
        expect(addBlocker({ ...base, kind: "initiative", title: "T", effort: null })).toBeNull();
        for (const d of [base, { ...base, chunk: null }, { ...base, kind: "initiative" as const, title: "" }]) {
            expect(addBlocker(d) == null).toBe(canAdd(d));
        }
    });

    it("tells a message card the person just opened from one a reload brings back", () => {
        // openMessageCard's id: "m" + Date.now() in base 36 + four random characters
        const at = 1_800_000_000_000;
        const id = `m${at.toString(36)}ab12`;
        expect(isFreshMessageCard(id, at + 500)).toBe(true);
        expect(isFreshMessageCard(id, at + 5000)).toBe(false);
        expect(isFreshMessageCard(id, at - 10_000)).toBe(false);
        expect(isFreshMessageCard("not-an-id", at)).toBe(false);
        expect(isFreshMessageCard("", at)).toBe(false);
    });

    it("words the chip's count as done/total over the plan", () => {
        expect(chipProgress({ done: 1, remaining: 8 })).toBe("1/9");
        expect(chipProgress({ done: 0, remaining: 0 })).toBe("0/0");
    });
});

describe("cardPhase", () => {
    const run = (from: CardPhase, ...events: Parameters<typeof cardPhase>[1][]): CardPhase =>
        events.reduce<CardPhase>((p, e) => cardPhase(p, e), from);

    it("goes from waiting to editing, adding or dismissed", () => {
        expect(cardPhase("waiting", "edit")).toBe("editing");
        expect(cardPhase("waiting", "add")).toBe("adding");
        expect(cardPhase("waiting", "dismiss")).toBe("dismissed");
    });

    it("goes from editing to adding, back to waiting on cancel, or dismissed", () => {
        expect(cardPhase("editing", "add")).toBe("adding");
        expect(cardPhase("editing", "cancel")).toBe("waiting");
        expect(cardPhase("editing", "dismiss")).toBe("dismissed");
    });

    it("goes from adding to added or failed, and nothing else moves it", () => {
        expect(cardPhase("adding", "added")).toBe("added");
        expect(cardPhase("adding", "failed")).toBe("failed");
        expect(cardPhase("adding", "dismiss")).toBe("adding");
        expect(cardPhase("adding", "edit")).toBe("adding");
        expect(cardPhase("adding", "cancel")).toBe("adding");
    });

    it("goes from failed back to adding on retry, and can still be edited or dismissed", () => {
        expect(cardPhase("failed", "retry")).toBe("adding");
        expect(cardPhase("failed", "edit")).toBe("editing");
        expect(cardPhase("failed", "dismiss")).toBe("dismissed");
        expect(run("waiting", "add", "failed", "retry", "added")).toBe("added");
    });

    it("never leaves added or dismissed", () => {
        for (const end of ["added", "dismissed"] as const) {
            for (const e of ["edit", "add", "added", "failed", "retry", "dismiss", "cancel"] as const) {
                expect(cardPhase(end, e)).toBe(end);
            }
        }
    });

    it("ignores an event the phase has no move for", () => {
        expect(cardPhase("waiting", "retry")).toBe("waiting");
        expect(cardPhase("waiting", "added")).toBe("waiting");
        expect(cardPhase("editing", "failed")).toBe("editing");
    });

    it("shows the amber dot while it waits on the person, but not for an exited agent", () => {
        expect(cardStatic(true)).toBe(true);
        expect(cardStatic(false)).toBe(false);
        expect(waitingDot("waiting", false)).toBe(true);
        expect(waitingDot("editing", false)).toBe(true);
        expect(waitingDot("failed", false)).toBe(true);
        expect(waitingDot("adding", false)).toBe(false);
        expect(waitingDot("waiting", true)).toBe(false);
    });
});

describe("fold rows", () => {
    it("words a note that was added", () => {
        expect(foldRowLabel(note())).toBe(
            "Note added · GUI redesign after the AI-chat references › 2 — Spec chốt và đã qua builder check."
        );
    });

    it("words a chunk that was added, with its new number", () => {
        const rec = note({
            kind: "chunk",
            initiative: "Chat bash mode follow-ups (run 69a69bfc)",
            chunk: undefined,
            chunkNumber: 8,
            text: "Bash Tab completion hides dotfiles unless the word starts with a dot",
        });
        expect(foldRowLabel(rec)).toBe(
            "Chunk added · Chat bash mode follow-ups (run 69a69bfc) › 8 — Bash Tab completion hides dotfiles unless the word starts with a dot"
        );
    });

    it("words an initiative that was created, with and without a topic", () => {
        const rec = note({ kind: "initiative", initiative: "Shell completion everywhere", topic: "Chat" });
        expect(foldRowLabel(rec)).toBe("Initiative created · “Shell completion everywhere” under Chat");
        expect(foldRowLabel({ ...rec, topic: undefined })).toBe("Initiative created · “Shell completion everywhere”");
    });

    it("words a dismissed note and chunk", () => {
        expect(foldRowLabel(note({ outcome: "dismissed" }))).toBe(
            "Dismissed · note for GUI redesign after the AI-chat references"
        );
        expect(foldRowLabel(note({ outcome: "dismissed", kind: "chunk" }))).toBe(
            "Dismissed · chunk for GUI redesign after the AI-chat references"
        );
    });

    it("words a dismissed new initiative, with and without a topic", () => {
        const rec = note({
            outcome: "dismissed",
            kind: "initiative",
            initiative: "Shell completion everywhere",
            topic: "Chat",
        });
        expect(foldRowLabel(rec)).toBe("Dismissed · new initiative “Shell completion everywhere” under Chat");
        expect(foldRowLabel({ ...rec, topic: undefined })).toBe(
            "Dismissed · new initiative “Shell completion everywhere”"
        );
    });

    it("folds a multi-line text to one line and drops the tail of an empty one", () => {
        expect(foldRowLabel(note({ text: "a\n\nb  c" }))).toContain("— a b c");
        expect(foldRowLabel(note({ text: "  " }))).toBe("Note added · GUI redesign after the AI-chat references › 2");
    });

    it("gives the three spans the view styles apart", () => {
        expect(foldRowParts(note())).toEqual({
            lead: "Note added ·",
            subject: "GUI redesign after the AI-chat references › 2",
            tail: "— Spec chốt và đã qua builder check.",
        });
    });

    it("falls back to the chunk's label for a note with no number, and to the title alone with neither", () => {
        expect(foldRowParts(note({ chunkNumber: undefined })).subject).toBe(
            "GUI redesign after the AI-chat references › Chat: add to an initiative"
        );
        expect(foldRowParts(note({ chunkNumber: undefined, chunk: undefined })).subject).toBe(
            "GUI redesign after the AI-chat references"
        );
    });
});

describe("records", () => {
    const draft: InitiativeDraft = {
        kind: "note",
        text: "a note",
        title: "",
        chunks: "",
        effort: AGENT,
        chunk: "Chat: add to an initiative",
        parent: TOPIC,
    };

    it("builds the record of an added note", () => {
        expect(addedRecord(draft, { initiative: "GUI", effort: AGENT, chunkNumber: 2 }, 5)).toEqual({
            outcome: "added",
            kind: "note",
            effort: AGENT,
            initiative: "GUI",
            chunk: "Chat: add to an initiative",
            chunkNumber: 2,
            text: "a note",
            at: 5,
        });
    });

    it("builds the record of an added chunk with the clipped label", () => {
        const rec = addedRecord(
            { ...draft, kind: "chunk", text: "x".repeat(300) },
            { initiative: "GUI", effort: AGENT, chunkNumber: 9 },
            5
        );
        expect(rec.kind).toBe("chunk");
        expect(rec.chunk).toBeUndefined();
        expect(rec.chunkNumber).toBe(9);
        expect(rec.text).toHaveLength(200);
    });

    it("builds the record of a created initiative with the new oref and the topic", () => {
        const rec = addedRecord(
            { ...draft, kind: "initiative", title: "New one" },
            { initiative: "New one", effort: "effort:new1", topic: "Chat" },
            5
        );
        expect(rec).toMatchObject({ kind: "initiative", effort: "effort:new1", initiative: "New one", topic: "Chat" });
        expect(rec.chunk).toBeUndefined();
        expect(rec.chunkNumber).toBeUndefined();
    });

    it("builds the record of a dismissed card by what the view knows of its target", () => {
        expect(dismissedRecord(draft, { initiative: "GUI" }, 6)).toMatchObject({
            outcome: "dismissed",
            kind: "note",
            effort: AGENT,
            initiative: "GUI",
            chunk: "Chat: add to an initiative",
        });
        const fresh = dismissedRecord({ ...draft, kind: "initiative", title: " New one " }, { topic: "Chat" }, 6);
        expect(fresh).toMatchObject({ kind: "initiative", effort: null, initiative: "New one", topic: "Chat" });
        expect(dismissedRecord({ ...draft, effort: null }, {}, 6).initiative).toBe("");
    });
});

describe("resultLine", () => {
    it("says a note was added, with the oref and the chunk", () => {
        expect(resultLine(note())).toBe(
            "initiative: added note to GUI redesign after the AI-chat references (effort:7655bf18) › Chat: add to an initiative"
        );
    });

    it("says a chunk was added, with its label in quotes", () => {
        expect(resultLine(note({ kind: "chunk", chunk: undefined, text: "Bash Tab completion" }))).toBe(
            'initiative: added chunk "Bash Tab completion" to GUI redesign after the AI-chat references (effort:7655bf18)'
        );
    });

    it("says an initiative was created, under its topic when it has one", () => {
        const rec = note({ kind: "initiative", effort: "effort:new1", initiative: "Shell completion", topic: "Chat" });
        expect(resultLine(rec)).toBe("initiative: created initiative Shell completion (effort:new1) under Chat");
        expect(resultLine({ ...rec, topic: undefined })).toBe(
            "initiative: created initiative Shell completion (effort:new1)"
        );
    });

    it("says a card was dismissed, by kind and initiative", () => {
        expect(resultLine(note({ outcome: "dismissed" }))).toBe(
            "initiative: dismissed note for GUI redesign after the AI-chat references"
        );
        expect(resultLine(note({ outcome: "dismissed", kind: "chunk" }))).toBe(
            "initiative: dismissed chunk for GUI redesign after the AI-chat references"
        );
        expect(
            resultLine(note({ outcome: "dismissed", kind: "initiative", effort: null, initiative: "Shell completion" }))
        ).toBe("initiative: dismissed initiative for Shell completion");
    });

    it("is one line whatever the title holds", () => {
        expect(resultLine(note({ initiative: "two\nlines" }))).not.toContain("\n");
    });
});

describe("sentSwitch", () => {
    const sw = switchLine(5, "Headless claude -p (bypass)", "effort:abc");

    it("reads the chunk a sent message moved the agent to", () => {
        expect(sentSwitch(withResultLines([sw], "go on"))).toEqual({ n: 5, label: "Headless claude -p (bypass)" });
    });

    it("takes the last switched line among the result lines, past the other kinds", () => {
        const other = resultLine(note());
        const first = switchLine(2, "first", "effort:abc");
        expect(sentSwitch(withResultLines([first, other, sw], "go on"))?.n).toBe(5);
        expect(sentSwitch(withResultLines([other], "go on"))).toBeNull();
    });

    it("reads a wrapped paste and a line with a carriage return", () => {
        expect(sentSwitch(`<pasted_content id="a1">\n${sw}\r\n\r\ngo on\n</pasted_content id="a1">`)?.n).toBe(5);
    });

    it("is null for a plain message and for a switched line that is not leading", () => {
        expect(sentSwitch("plain")).toBeNull();
        expect(sentSwitch(`text\n${sw}`)).toBeNull();
    });
});

describe("withResultLines and stripResultLines", () => {
    const lines = [resultLine(note()), resultLine(note({ outcome: "dismissed", kind: "chunk" }))];

    it("puts the lines first, one blank line, then the message", () => {
        expect(withResultLines(lines, "next question")).toBe(`${lines[0]}\n${lines[1]}\n\nnext question`);
        expect(withResultLines([], "next question")).toBe("next question");
    });

    it("round-trips to the person's text", () => {
        for (const message of ["next question", "two\nlines\n\nof text", "  padded"]) {
            expect(stripResultLines(withResultLines(lines, message))).toBe(message);
        }
    });

    it("leaves a message that mentions initiative: mid-text alone", () => {
        const message = "see this\ninitiative: added note to X\nand that";
        expect(stripResultLines(message)).toBe(message);
        expect(stripResultLines("initiative: pick one")).toBe("initiative: pick one");
        expect(stripResultLines("plain")).toBe("plain");
    });

    it("strips only the leading run, and only one blank line after it", () => {
        expect(stripResultLines(`${lines[0]}\ntext\n${lines[1]}`)).toBe(`text\n${lines[1]}`);
        expect(stripResultLines(`${lines[0]}\n\n\ntext`)).toBe("\ntext");
    });

    it("strips lines that end in a carriage return", () => {
        expect(stripResultLines(`${lines[0]}\r\n\r\ntext`)).toBe("text");
    });

    it("reads a message Claude Code wrapped as one paste, and returns it unwrapped when it strips lines", () => {
        const wrapped = `<pasted_content id="cdd1">\n${lines[0]}\n\nnext question\n</pasted_content id="cdd1">`;
        expect(stripResultLines(wrapped)).toBe("next question");
    });

    it("returns a wrapped message with no lines exactly as it was", () => {
        const wrapped = `<pasted_content id="cdd1">\nsome\npasted text\n</pasted_content id="cdd1">`;
        expect(stripResultLines(wrapped)).toBe(wrapped);
    });

    it("strips a leading switched line, with the card lines around it", () => {
        const sw = switchLine(3, "Build it", "effort:7655bf18");
        expect(stripResultLines(withResultLines([sw], "go on"))).toBe("go on");
        expect(stripResultLines(withResultLines([lines[0], sw], "go on"))).toBe("go on");
        expect(stripResultLines(`<pasted_content id="cdd1">\n${sw}\n\ngo on\n</pasted_content id="cdd1">`)).toBe(
            "go on"
        );
    });
});

describe("the switch line", () => {
    it("words the chunk's place, its label and the initiative's oref", () => {
        expect(switchLine(3, "Build it", "effort:7655bf18")).toBe(
            "initiative: switched you to chunk 3 Build it (effort:7655bf18)"
        );
        expect(switchLine(3, "Build it", "7655bf18")).toBe(
            "initiative: switched you to chunk 3 Build it (effort:7655bf18)"
        );
    });

    it("keeps a label on one line, and leaves the oref out when there is none", () => {
        expect(switchLine(1, "two\nlines   here", "effort:o")).toBe(
            "initiative: switched you to chunk 1 two lines here (effort:o)"
        );
        expect(switchLine(1, "A", "")).toBe("initiative: switched you to chunk 1 A");
    });

    it("is read back as its number and label, a label with parentheses included", () => {
        expect(pendingSwitch([switchLine(3, "Build it", "effort:7655bf18")])).toEqual({ n: 3, label: "Build it" });
        expect(pendingSwitch([switchLine(12, "Fix (the bug)", "effort:o")])).toEqual({ n: 12, label: "Fix (the bug)" });
        expect(pendingSwitch([switchLine(2, "No oref", "")])).toEqual({ n: 2, label: "No oref" });
    });

    it("is read from the last switched line among the others, and is null with none", () => {
        const lines = [
            switchLine(1, "First", "effort:o"),
            resultLine(note()),
            switchLine(4, "Last", "effort:o"),
            resultLine(note({ outcome: "dismissed", kind: "chunk" })),
        ];
        expect(pendingSwitch(lines)).toEqual({ n: 4, label: "Last" });
        expect(pendingSwitch([resultLine(note())])).toBeNull();
        expect(pendingSwitch([])).toBeNull();
        expect(pendingSwitch(["initiative: switched somewhere else"])).toBeNull();
    });

    it("replaces an agent's earlier switched line: only the last switch goes, the other lines stay", () => {
        const added = resultLine(note());
        let p = queueLine({}, "a1", added);
        p = withSwitchLine(p, "a1", switchLine(2, "One", "effort:o"));
        p = withSwitchLine(p, "a1", switchLine(3, "Two", "effort:o"));
        expect(p).toEqual({ a1: [added, switchLine(3, "Two", "effort:o")] });
    });

    it("keeps the lines that came after the earlier switch, in order, and does not touch another agent", () => {
        const added = resultLine(note());
        let p = withSwitchLine({ a2: [switchLine(9, "Theirs", "effort:o")] }, "a1", switchLine(2, "One", "effort:o"));
        p = queueLine(p, "a1", added);
        p = withSwitchLine(p, "a1", switchLine(3, "Two", "effort:o"));
        expect(p).toEqual({ a1: [added, switchLine(3, "Two", "effort:o")], a2: [switchLine(9, "Theirs", "effort:o")] });
    });

    it("does not change the map it was given", () => {
        const before = { a1: [switchLine(2, "One", "effort:o")] };
        withSwitchLine(before, "a1", switchLine(3, "Two", "effort:o"));
        expect(before).toEqual({ a1: [switchLine(2, "One", "effort:o")] });
    });

    it("drops only the switched line from an agent's queue", () => {
        const added = resultLine(note());
        const p = { a1: [added, switchLine(3, "Two", "effort:o")], a2: [switchLine(9, "Theirs", "effort:o")] };
        expect(withoutSwitchLine(p, "a1")).toEqual({ a1: [added], a2: [switchLine(9, "Theirs", "effort:o")] });
        expect(p.a1).toHaveLength(2);
    });

    it("holds and lets go of an agent's waiting line, the same list when it is as asked", () => {
        const none: readonly string[] = [];
        const held = withSwitchHeld(none, "a1", true);
        expect(held).toEqual(["a1"]);
        expect(withSwitchHeld(held, "a1", true)).toBe(held);
        expect(withSwitchHeld(held, "a2", true)).toEqual(["a1", "a2"]);
        expect(withSwitchHeld(["a1", "a2"], "a1", false)).toEqual(["a2"]);
        expect(withSwitchHeld(none, "a1", false)).toBe(none);
        expect(none).toEqual([]);
    });

    it("removes an agent's entry once the switched line was its only one, and is the same map when there is none", () => {
        expect(withoutSwitchLine({ a1: [switchLine(3, "Two", "effort:o")] }, "a1")).toEqual({});
        const same = { a1: [resultLine(note())] };
        expect(withoutSwitchLine(same, "a1")).toBe(same);
        expect(withoutSwitchLine(same, "a9")).toBe(same);
        expect(withoutSwitchLine(same, "constructor")).toBe(same);
    });
});

describe("topicsOf", () => {
    it("is the initiatives another one's parentoid points at, in list order", () => {
        const list = [
            { oref: "effort:a", parentoid: "t1" },
            { oref: "effort:t1" },
            { oref: "effort:b", parentoid: "effort:t2" },
            { oref: "effort:t2", parentoid: "t1" },
            { oref: "effort:c" },
        ];
        expect(topicsOf(list).map((e) => e.oref)).toEqual(["effort:t1", "effort:t2"]);
    });

    it("is empty when nothing has a parent", () => {
        expect(topicsOf([{ oref: "effort:a" }, { oref: "effort:b", parentoid: "" }])).toEqual([]);
        expect(topicsOf([])).toEqual([]);
    });
});

describe("readStoredMap", () => {
    it("is empty with no reason when nothing is stored", () => {
        expect(readStoredMap(null)).toEqual({ map: {} });
        expect(readStoredMap(undefined)).toEqual({ map: {} });
        expect(readStoredMap("")).toEqual({ map: {} });
    });

    it("is empty with a reason for broken JSON", () => {
        const r = readStoredMap("{not json");
        expect(r.map).toEqual({});
        expect(r.reason).toMatch(/JSON/);
    });

    it("is empty with a reason for JSON that is not an object", () => {
        for (const raw of ["[]", "[1,2]", "null", "3", '"x"']) {
            const r = readStoredMap(raw);
            expect(r.map).toEqual({});
            expect(r.reason).toBeDefined();
        }
    });

    it("reads an object's entries, and never swaps the prototype", () => {
        const r = readStoredMap('{"a":1,"__proto__":{"polluted":true}}');
        expect(r.reason).toBeUndefined();
        expect(r.map).toEqual({ a: 1 });
        expect(Object.getPrototypeOf(r.map)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("drops the entries a coerce refuses", () => {
        const r = readStoredMap(
            JSON.stringify({ ok: note(), bad: { outcome: "added" }, worse: "text" }),
            coerceHandled
        );
        expect(Object.keys(r.map)).toEqual(["ok"]);
    });

    it("coerces drafts, cards and lines", () => {
        const draft = draftFromMessage("x", ctx);
        expect(coerceDraft(draft)).toEqual(draft);
        expect(coerceDraft({ ...draft, kind: "other" })).toBeUndefined();
        expect(coerceDraft({ ...draft, effort: 3 })).toBeUndefined();
        const card: MessageCard = { id: "m1", anchor: "agent:3", text: "x" };
        expect(
            coerceCards([card, { id: "", anchor: "a", text: "x" }, "no", { ...card, id: "m2", outcome: note() }])
        ).toEqual([card, { ...card, id: "m2", outcome: note() }]);
        expect(coerceCards([{ id: "m3", anchor: "a", text: "x", outcome: { outcome: "added" } }])).toBeUndefined();
        expect(coerceCards("nope")).toBeUndefined();
        expect(coerceLines(["a", 3, "", "b"])).toEqual(["a", "b"]);
        expect(coerceLines([])).toBeUndefined();
    });
});

describe("pending lines", () => {
    it("queues in order per agent", () => {
        let p = queueLine({}, "a1", "initiative: added note to X");
        p = queueLine(p, "a1", "initiative: dismissed chunk for X");
        p = queueLine(p, "a2", 'initiative: added chunk "c" to Y');
        expect(p).toEqual({
            a1: ["initiative: added note to X", "initiative: dismissed chunk for X"],
            a2: ['initiative: added chunk "c" to Y'],
        });
    });

    it("does not change the map it was given", () => {
        const before = { a1: ["one"] };
        queueLine(before, "a1", "two");
        expect(before).toEqual({ a1: ["one"] });
    });

    it("takes an agent's lines in order and clears them, leaving the others", () => {
        const p = { a1: ["one", "two"], a2: ["three"] };
        const { lines, next } = takeLines(p, "a1");
        expect(lines).toEqual(["one", "two"]);
        expect(next).toEqual({ a2: ["three"] });
        expect(p.a1).toEqual(["one", "two"]);
    });

    it("takes nothing for an agent with no lines", () => {
        const p = { a1: ["one"] };
        const { lines, next } = takeLines(p, "a9");
        expect(lines).toEqual([]);
        expect(next).toBe(p);
        expect(takeLines(p, "constructor").lines).toEqual([]);
    });

    it("puts lines back at the front, before what came in meanwhile", () => {
        const p = putBackLines({ a1: ["late"] }, "a1", ["one", "two"]);
        expect(p).toEqual({ a1: ["one", "two", "late"] });
        expect(putBackLines({}, "a1", ["one"])).toEqual({ a1: ["one"] });
        const same = { a1: ["x"] };
        expect(putBackLines(same, "a1", [])).toBe(same);
    });

    it("keeps at most 30 lines per agent, the newest", () => {
        let p = {};
        for (let i = 0; i < 40; i++) {
            p = queueLine(p, "a1", `line ${i}`);
        }
        const lines = (p as Record<string, string[]>).a1;
        expect(lines).toHaveLength(30);
        expect(lines[0]).toBe("line 10");
        expect(lines[29]).toBe("line 39");
    });
});

describe("withHandled", () => {
    it("adds a record under its key and leaves the others", () => {
        const a = note({ at: 1 });
        const b = note({ at: 2, text: "other" });
        const m = withHandled(withHandled({}, "k1", a), "k2", b);
        expect(m).toEqual({ k1: a, k2: b });
    });

    it("replaces the record under a key", () => {
        const m = withHandled(withHandled({}, "k1", note({ at: 1 })), "k1", note({ at: 2 }));
        expect(m.k1.at).toBe(2);
        expect(Object.keys(m)).toEqual(["k1"]);
    });

    it("keeps the 500 newest records", () => {
        let m = {};
        for (let i = 0; i < 510; i++) {
            m = withHandled(m, `k${i}`, note({ at: i }));
        }
        const keys = Object.keys(m);
        expect(keys).toHaveLength(500);
        expect(keys).not.toContain("k0");
        expect(keys).toContain("k509");
    });
});

describe("message cards", () => {
    const card = (id: string): MessageCard => ({ id, anchor: "agent:41", text: `text ${id}` });

    it("adds a card at the end of an agent's list", () => {
        const m = withMessageCard(withMessageCard({}, "a1", card("m1")), "a1", card("m2"));
        expect(m.a1.map((c) => c.id)).toEqual(["m1", "m2"]);
    });

    it("settles a card with a record, its anchor and text kept", () => {
        const m = withMessageCard(withMessageCard({}, "a1", card("m1")), "a1", card("m2"));
        const rec = note();
        const next = settleCard(m, "a1", "m2", rec);
        expect(next.a1[0]).toEqual(card("m1"));
        expect(next.a1[1]).toEqual({ ...card("m2"), outcome: rec });
    });

    it("removes a card settled with null, and the agent when it was the last", () => {
        const m = withMessageCard(withMessageCard({}, "a1", card("m1")), "a1", card("m2"));
        const one = settleCard(m, "a1", "m1", null);
        expect(one.a1.map((c) => c.id)).toEqual(["m2"]);
        const none = settleCard(one, "a1", "m2", null);
        expect(none).toEqual({});
    });

    it("leaves the map as it was for a card it does not find or one already settled", () => {
        const m = withMessageCard({}, "a1", card("m1"));
        expect(settleCard(m, "a1", "nope", note())).toBe(m);
        expect(settleCard(m, "a9", "m1", null)).toBe(m);
        const settled = settleCard(m, "a1", "m1", note({ at: 1 }));
        expect(settleCard(settled, "a1", "m1", note({ at: 2 }))).toBe(settled);
        expect(settleCard(settled, "a1", "m1", null)).toBe(settled);
    });
});

describe("drafts", () => {
    const draft = (text: string): InitiativeDraft => draftFromMessage(text, ctx);

    it("keys a block's draft and a message card's apart", () => {
        expect(blockDraftKey("abc")).not.toBe(messageDraftKey("abc"));
    });

    it("keeps a draft under its key, the newest last", () => {
        let m = withDraft({}, "k1", draft("one"));
        m = withDraft(m, "k2", draft("two"));
        m = withDraft(m, "k1", draft("one again"));
        expect(Object.keys(m)).toEqual(["k2", "k1"]);
        expect(m.k1.text).toBe("one again");
    });

    it("keeps the 100 newest drafts", () => {
        let m = {};
        for (let i = 0; i < 105; i++) {
            m = withDraft(m, `k${i}`, draft(String(i)));
        }
        expect(Object.keys(m)).toHaveLength(100);
        expect(Object.keys(m)).not.toContain("k0");
    });

    it("drops a key", () => {
        const m = withDraft({}, "k1", draft("one"));
        expect(withoutKey(m, "k1")).toEqual({});
        expect(withoutKey(m, "k2")).toBe(m);
        expect(m.k1.text).toBe("one");
    });
});

// a list the agent leaves for later (docs/superpowers/specs/2026-11-27-ask-later-design.md Decision 4, Builder's call 13)
describe("a later list", () => {
    const ITEMS = [
        "push DEV",
        "delete the backup branch",
        "check where the parser branch stands",
        "decide which parser takes the logs",
    ];
    const laterBlock: InitiativeBlock = { kind: "chunk", later: true, text: "Left for later", chunks: ITEMS };
    const laterRaw = JSON.stringify({ kind: "chunk", later: true, text: "Left for later", chunks: ITEMS });
    // the draft of an agent linked to AGENT
    const draft = (over: Partial<InitiativeDraft> = {}): InitiativeDraft => ({
        ...draftFromBlock(laterBlock, ctx),
        ...over,
    });
    const record = (over: Partial<HandledRecord> = {}): HandledRecord => ({
        outcome: "added",
        kind: "chunk",
        effort: AGENT,
        initiative: "GUI redesign",
        text: "Left for later",
        later: 3,
        at: 1000,
        ...over,
    });

    describe("the block", () => {
        it("reads later: true on a chunk block that lists chunks", () => {
            expect(parseInitiativeBlock(laterRaw)).toEqual(laterBlock);
        });

        it("leaves a later block with no list a plain chunk", () => {
            const block = parseInitiativeBlock(JSON.stringify({ kind: "chunk", later: true, text: "one thing" }))!;
            expect(block).toEqual({ kind: "chunk", text: "one thing" });
            expect("later" in block).toBe(false);
            const blank = parseInitiativeBlock(
                JSON.stringify({ kind: "chunk", later: true, text: "x", chunks: [" ", 4] })
            )!;
            expect("later" in blank).toBe(false);
        });

        it("reads only the boolean true", () => {
            for (const later of [false, "true", 1, null]) {
                const block = parseInitiativeBlock(JSON.stringify({ kind: "chunk", later, text: "x", chunks: ["a"] }))!;
                expect("later" in block).toBe(false);
            }
        });

        it("leaves a note and an initiative as they were", () => {
            expect(
                parseInitiativeBlock(JSON.stringify({ kind: "note", later: true, text: "x", chunks: ["a"] }))
            ).toEqual({ kind: "note", text: "x", chunks: ["a"] });
            expect(
                parseInitiativeBlock(JSON.stringify({ kind: "initiative", later: true, text: "x", chunks: ["a"] }))
            ).toEqual({ kind: "initiative", text: "x", chunks: ["a"] });
        });

        it("keeps a plain chunk's listed chunks as they were", () => {
            expect(parseInitiativeBlock(JSON.stringify({ kind: "chunk", text: "x", chunks: ["a"] }))).toEqual({
                kind: "chunk",
                text: "x",
                chunks: ["a"],
            });
        });

        it("is keyed apart from the same list written as a plain chunk", () => {
            const { later: _later, ...plain } = laterBlock;
            expect(blockKey(laterBlock)).not.toBe(blockKey(plain));
        });

        it("is keyed the same whatever order the keys came in", () => {
            const reordered = parseInitiativeBlock(
                JSON.stringify({ chunks: ITEMS, text: "Left for later", later: true, kind: "chunk" })
            )!;
            expect(blockKey(reordered)).toBe(blockKey(laterBlock));
        });

        it("is keyed apart when the list changes", () => {
            expect(blockKey({ ...laterBlock, chunks: ITEMS.slice(0, 3) })).not.toBe(blockKey(laterBlock));
        });
    });

    describe("the draft", () => {
        it("carries the items as rows and the heading as its text", () => {
            const d = draftFromBlock(laterBlock, ctx);
            expect(d).toMatchObject({ kind: "chunk", text: "Left for later", later: ITEMS });
            expect(isLaterDraft(d)).toBe(true);
        });

        it("keeps the rows out of the new-initiative chunk lines", () => {
            expect(draftFromBlock(laterBlock, ctx).chunks).toBe("");
        });

        it("copies the block's list, so a removal never reaches the block", () => {
            const d = draftFromBlock(laterBlock, ctx);
            expect(d.later).not.toBe(laterBlock.chunks);
        });

        it("aims at the agent's initiative, and at none for an agent with none", () => {
            expect(draftFromBlock(laterBlock, ctx).effort).toBe(AGENT);
            expect(draftFromBlock(laterBlock, { ...ctx, agentEffortId: undefined }).effort).toBeNull();
        });

        it("aims at the block's own initiative when it names one", () => {
            const d = draftFromBlock({ ...laterBlock, effort: "aaaa1111" }, ctx);
            expect(d.effort).toBe(OTHER);
        });

        it("is no later draft for a plain chunk, a note or a new initiative", () => {
            expect(isLaterDraft(draftFromBlock({ kind: "chunk", text: "x" }, ctx))).toBe(false);
            expect(isLaterDraft(draftFromBlock({ kind: "note", text: "x" }, ctx))).toBe(false);
            expect(isLaterDraft(draftFromBlock({ kind: "initiative", text: "x", chunks: ["a"] }, ctx))).toBe(false);
            expect("later" in draftFromBlock({ kind: "chunk", text: "x", chunks: ["a"] }, ctx)).toBe(false);
        });

        it("drops one row by its place and keeps the others in order", () => {
            expect(withoutLaterItem(draft(), 1).later).toEqual([ITEMS[0], ITEMS[2], ITEMS[3]]);
            expect(withoutLaterItem(draft(), 0).later).toEqual(ITEMS.slice(1));
            expect(withoutLaterItem(draft(), 3).later).toEqual(ITEMS.slice(0, 3));
        });

        it("drops only the row asked for when two read the same", () => {
            const twins = draft({ later: ["same", "other", "same"] });
            expect(withoutLaterItem(twins, 2).later).toEqual(["same", "other"]);
        });

        it("is the same draft for a place no row holds, and for a draft with no rows", () => {
            const d = draft();
            expect(withoutLaterItem(d, 4)).toBe(d);
            expect(withoutLaterItem(d, -1)).toBe(d);
            const plain = draftFromMessage("x", ctx);
            expect(withoutLaterItem(plain, 0)).toBe(plain);
        });

        it("leaves the draft it was given alone", () => {
            const d = draft();
            withoutLaterItem(d, 0);
            expect(d.later).toEqual(ITEMS);
        });

        it("is aimed at an initiative by its oref, or at a new one", () => {
            expect(withLaterTarget(draft(), "aaaa1111")).toMatchObject({ effort: OTHER, chunk: null });
            expect(withLaterTarget(draft(), OTHER).effort).toBe(OTHER);
            expect(withLaterTarget(draft({ effort: null }), "new").effort).toBe("new");
        });

        it("keeps its rows when the target changes", () => {
            expect(withLaterTarget(draft(), "new").later).toEqual(ITEMS);
        });

        it("keys each row by its text, a repeated one by which of its twins it is", () => {
            expect(laterRowKeys(["a", "b", "a", "a"])).toEqual(["0:a", "0:b", "1:a", "2:a"]);
            expect(laterRowKeys([])).toEqual([]);
        });

        it("keeps a row's key when a row before it is removed", () => {
            const before = laterRowKeys(ITEMS);
            const after = laterRowKeys(withoutLaterItem(draft(), 0).later!);
            expect(after).toEqual(before.slice(1));
        });
    });

    describe("Add", () => {
        it("needs an initiative (or a new one) and a row", () => {
            expect(canAdd(draft())).toBe(true);
            expect(canAdd(draft({ effort: "new" }))).toBe(true);
            expect(canAdd(draft({ effort: null }))).toBe(false);
            expect(canAdd(draft({ later: [] }))).toBe(false);
        });

        it("needs no chunk and no title", () => {
            expect(canAdd(draft({ chunk: null, title: "" }))).toBe(true);
        });

        it("says what it waits on", () => {
            expect(addBlocker(draft())).toBeNull();
            expect(addBlocker(draft({ effort: null }))).toBe("Pick an initiative first");
            expect(addBlocker(draft({ later: [] }))).toBe("Keep at least one item first");
        });

        it("is worded by the count", () => {
            expect(laterVerb(4)).toBe("Add 4 for later");
            expect(laterVerb(1)).toBe("Add 1 for later");
            expect(laterVerb(0)).toBe("Add for later");
        });
    });

    describe("the card's phases", () => {
        it("adds straight from waiting, with no editor between", () => {
            expect(cardPhase("waiting", "add")).toBe("adding");
            expect(cardPhase(cardPhase("waiting", "add"), "added")).toBe("added");
            expect(cardPhase(cardPhase("waiting", "add"), "failed")).toBe("failed");
            expect(cardPhase("failed", "retry")).toBe("adding");
        });

        it("starts in its compact form, even with rows removed", () => {
            const initial = draftFromBlock(laterBlock, ctx);
            expect(startsInEditor("agent", initial, initial)).toBe(false);
            expect(startsInEditor("agent", withoutLaterItem(initial, 0), initial)).toBe(false);
        });

        it("waits on the person while it waits, adds and fails", () => {
            expect(waitingDot("waiting", false)).toBe(true);
            expect(waitingDot("adding", false)).toBe(false);
            expect(waitingDot("added", false)).toBe(false);
        });
    });

    describe("the stored draft", () => {
        it("reads a stored later draft back, its rows with it", () => {
            const d = draft({ later: ["a", "b"] });
            expect(coerceDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
        });

        it("reads a stored draft with no rows as it was", () => {
            const plain = draftFromMessage("x", ctx);
            const back = coerceDraft(JSON.parse(JSON.stringify(plain)))!;
            expect(back).toEqual(plain);
            expect("later" in back).toBe(false);
        });

        it("is undefined for rows that are not all strings", () => {
            expect(coerceDraft({ ...draft(), later: ["a", 3] })).toBeUndefined();
            expect(coerceDraft({ ...draft(), later: "a" })).toBeUndefined();
            expect(coerceDraft({ ...draft(), later: null })).toBeUndefined();
        });
    });

    describe("what the card keeps", () => {
        it("builds the record of an added list: its count, no chunk and no place", () => {
            const rec = addedRecord(draft(), { initiative: "GUI redesign", effort: AGENT }, 5);
            expect(rec).toEqual({
                outcome: "added",
                kind: "chunk",
                effort: AGENT,
                initiative: "GUI redesign",
                text: "Left for later",
                later: 4,
                at: 5,
            });
        });

        it("counts only the rows that were left", () => {
            const rec = addedRecord(withoutLaterItem(draft(), 0), { initiative: "GUI redesign", effort: AGENT }, 5);
            expect(rec.later).toBe(3);
        });

        it("leaves a plain chunk's record with no count", () => {
            const rec = addedRecord(
                draftFromBlock({ kind: "chunk", text: "one" }, ctx),
                { initiative: "GUI", effort: AGENT, chunkNumber: 3 },
                5
            );
            expect("later" in rec).toBe(false);
            expect(rec.chunkNumber).toBe(3);
        });

        it("builds the record of a dismissed list with the rows it had", () => {
            expect(dismissedRecord(draft(), { initiative: "GUI redesign" }, 6)).toMatchObject({
                outcome: "dismissed",
                kind: "chunk",
                effort: AGENT,
                initiative: "GUI redesign",
                later: 4,
            });
            expect(dismissedRecord(draft({ later: [] }), {}, 6).later).toBe(0);
        });

        it("reads a stored record's count back, and drops a record whose count is not a number", () => {
            expect(coerceHandled(JSON.parse(JSON.stringify(record())))).toEqual(record());
            expect(coerceHandled({ ...record(), later: "3" })).toBeUndefined();
        });
    });

    describe("the folded row", () => {
        it("words a list that was added, by its count", () => {
            expect(foldRowLabel(record())).toBe("Saved for later · GUI redesign — 3 items");
            expect(foldRowLabel(record({ later: 1 }))).toBe("Saved for later · GUI redesign — 1 item");
        });

        it("gives the three spans the view styles apart", () => {
            expect(foldRowParts(record())).toEqual({
                lead: "Saved for later ·",
                subject: "GUI redesign",
                tail: "— 3 items",
            });
        });

        it("words a dismissed list, with and without a target", () => {
            expect(foldRowLabel(record({ outcome: "dismissed" }))).toBe("Dismissed · later list for GUI redesign");
            expect(foldRowLabel(record({ outcome: "dismissed", initiative: "" }))).toBe("Dismissed · later list");
        });

        it("leaves a plain chunk's row as it was", () => {
            expect(foldRowLabel(note({ kind: "chunk", chunk: undefined, chunkNumber: 8, text: "x" }))).toBe(
                "Chunk added · GUI redesign after the AI-chat references › 8 — x"
            );
        });
    });

    describe("the result line", () => {
        it("says how many chunks were added for later, with the oref", () => {
            expect(resultLine(record())).toBe("initiative: added 3 chunks for later to GUI redesign (effort:7655bf18)");
            expect(resultLine(record({ later: 1 }))).toBe(
                "initiative: added 1 chunk for later to GUI redesign (effort:7655bf18)"
            );
        });

        it("names a created initiative's oref, as the agent will act on it", () => {
            expect(resultLine(record({ effort: "effort:new1", initiative: "Left for later" }))).toBe(
                "initiative: added 3 chunks for later to Left for later (effort:new1)"
            );
        });

        it("says a dismissed list was, with and without a target", () => {
            expect(resultLine(record({ outcome: "dismissed" }))).toBe(
                "initiative: dismissed later list for GUI redesign"
            );
            expect(resultLine(record({ outcome: "dismissed", initiative: "", effort: null }))).toBe(
                "initiative: dismissed later list"
            );
        });

        it("is one line whatever the title holds", () => {
            expect(resultLine(record({ initiative: "two\nlines" }))).not.toContain("\n");
        });

        it("is stripped from the person's bubble as the others are", () => {
            const line = resultLine(record());
            expect(stripResultLines(withResultLines([line], "thanks"))).toBe("thanks");
        });

        it("leaves a plain chunk's line as it was", () => {
            expect(resultLine(note({ kind: "chunk", chunk: undefined, text: "Bash Tab completion" }))).toBe(
                'initiative: added chunk "Bash Tab completion" to GUI redesign after the AI-chat references (effort:7655bf18)'
            );
        });
    });
});
