// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { centerModeAtom } from "./agentcenter";
import type { SurfaceKey } from "./agents";
import type { AgentAsk, AgentVM } from "./agentsviewmodel";
import { attachCanvas, detachCanvas, getCanvas, setCanvasMode } from "./canvasstore";
import { docReviewAtom } from "./docreview";
import {
    addComment,
    focusedDocReview,
    getDocReview,
    openReview,
    recordShown,
    removeComment,
    setDocReviewMode,
    setDocReviewTab,
    setGeneralNote,
    setLastSend,
    shownContentAtom,
    stepDocReviewTab,
    syncDocReview,
    syncDocReviews,
    toggleWholeFile,
    updateComment,
} from "./docreviewstore";
import type { ProseComment } from "./proseanchor";

const OPTIONS = [{ label: "Approve" }, { label: "Request changes" }];
const docAsk = (askId: string, path = "/r/paper/main.tex"): AgentAsk => ({
    askId,
    questions: [{ header: "Doc review", question: `${path}\nRewrote §3.2.\n- §3.2: rewritten`, options: OPTIONS }],
});
const SPEC_ASK: AgentAsk = {
    askId: "s1",
    questions: [{ header: "Spec review", question: "/r/spec.md\n- one", options: OPTIONS }],
};
const COMMENT: ProseComment = {
    id: "c1",
    sectionIndex: 0,
    sectionLabel: "§1",
    paragraph: 1,
    sentences: [0, 0],
    quote: "q",
    selectedText: "q",
    note: "n",
    draft: false,
};
const IDS = ["a1", "a2", "lead"];

const agentVM = (id: string, ask?: AgentAsk): AgentVM => ({ id, name: id, task: "", state: "asking", ask });

function stubModel(agents: AgentVM[]): any {
    return {
        focusIdAtom: atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>,
        surfaceAtom: atom<SurfaceKey>("cockpit") as PrimitiveAtom<SurfaceKey>,
        agentsAtom: atom(agents),
    };
}

afterEach(() => {
    for (const id of IDS) {
        syncDocReview(id, undefined);
        globalStore.set(shownContentAtom(id), {});
        detachCanvas(id);
    }
    globalStore.set(docReviewAtom, null);
});

describe("syncDocReview", () => {
    it("creates the state for a first Doc review ask, in terminal mode", () => {
        syncDocReview("a1", docAsk("k1"));
        expect(getDocReview("a1")).toEqual({
            askId: "k1",
            path: "/r/paper/main.tex",
            doc: "latex",
            mode: "terminal",
            tab: "changes",
            wholeFile: false,
            comments: [],
            generalNote: "",
            lastSend: null,
        });
    });

    it("reads a .md note as markdown", () => {
        syncDocReview("a1", docAsk("k1", "/r/notes/next_step.md"));
        expect(getDocReview("a1")?.doc).toBe("markdown");
    });

    it("keeps the comments when the same ask comes round again", () => {
        syncDocReview("a1", docAsk("k1"));
        addComment("a1", COMMENT);
        const before = getDocReview("a1");
        syncDocReview("a1", docAsk("k1"));
        expect(getDocReview("a1")).toBe(before);
        expect(getDocReview("a1")?.comments).toEqual([COMMENT]);
    });

    it("a new ask resets the comments, note, tab, whole file and last send, but keeps the mode and the shown content", () => {
        syncDocReview("a1", docAsk("k1"));
        setDocReviewMode("a1", "review", 1);
        setDocReviewTab("a1", "pdf");
        toggleWholeFile("a1");
        addComment("a1", COMMENT);
        setGeneralNote("a1", "tighten §3");
        setLastSend("a1", { kind: "request", comments: 1 });
        recordShown("a1", "/r/paper/main.tex", "round one", 100);

        syncDocReview("a1", docAsk("k2"));

        expect(getDocReview("a1")).toEqual({
            askId: "k2",
            path: "/r/paper/main.tex",
            doc: "latex",
            mode: "review",
            tab: "changes",
            wholeFile: false,
            comments: [],
            generalNote: "",
            lastSend: null,
        });
        expect(globalStore.get(shownContentAtom("a1"))).toEqual({
            "/r/paper/main.tex": { text: "round one", at: 100 },
        });
    });

    it("a new ask arriving while the terminal shows stays on the terminal", () => {
        syncDocReview("a1", docAsk("k1"));
        syncDocReview("a1", docAsk("k2"));
        expect(getDocReview("a1")?.mode).toBe("terminal");
    });

    it("goes to null when the ask clears, or turns into another kind of question", () => {
        syncDocReview("a1", docAsk("k1"));
        syncDocReview("a1", undefined);
        expect(getDocReview("a1")).toBeNull();
        syncDocReview("a1", docAsk("k1"));
        syncDocReview("a1", { askId: "q", questions: [{ header: "Flake fix", question: "Retry?", options: [] }] });
        expect(getDocReview("a1")).toBeNull();
    });

    it("creates no state for a Spec review", () => {
        syncDocReview("lead", SPEC_ASK);
        expect(getDocReview("lead")).toBeNull();
    });
});

describe("syncDocReviews", () => {
    it("syncs every agent of the roster and drops the state of an agent that left it", () => {
        syncDocReviews([agentVM("a1", docAsk("k1")), agentVM("a2", docAsk("k2"))]);
        expect(getDocReview("a1")?.askId).toBe("k1");
        expect(getDocReview("a2")?.askId).toBe("k2");
        syncDocReviews([agentVM("a1", docAsk("k1"))]);
        expect(getDocReview("a1")?.askId).toBe("k1");
        expect(getDocReview("a2")).toBeNull();
    });
});

describe("openReview", () => {
    it("on a Doc review: creates the state, focuses the agent on the Agent surface in review mode, no dialog", () => {
        const model = stubModel([agentVM("a1", docAsk("k1"))]);
        openReview(model, "a1");
        expect(globalStore.get(model.focusIdAtom)).toBe("a1");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(getDocReview("a1")).toMatchObject({ askId: "k1", mode: "review" });
        expect(globalStore.get(docReviewAtom)).toBeNull();
    });

    it("on a Doc review: brings the centre column back from History or a session to the terminal", () => {
        const model = stubModel([agentVM("a1", docAsk("k1"))]);
        globalStore.set(centerModeAtom, "history");
        openReview(model, "a1");
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });

    it("puts a showing canvas back to the terminal", () => {
        const model = stubModel([agentVM("a1", docAsk("k1"))]);
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        setCanvasMode("a1", "canvas", 1);
        openReview(model, "a1");
        expect(getCanvas("a1")?.mode).toBe("terminal");
        expect(getDocReview("a1")?.mode).toBe("review");
    });

    it("on a Spec review: opens the dialog, creates no state and leaves the surface alone", () => {
        const model = stubModel([agentVM("lead", SPEC_ASK)]);
        openReview(model, "lead");
        expect(globalStore.get(docReviewAtom)).toBe("lead");
        expect(getDocReview("lead")).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
    });

    it("does nothing for an agent with nothing to review", () => {
        const model = stubModel([agentVM("a1")]);
        openReview(model, "a1");
        expect(globalStore.get(docReviewAtom)).toBeNull();
        expect(globalStore.get(model.surfaceAtom)).toBe("cockpit");
        expect(getDocReview("a1")).toBeNull();
    });
});

describe("edits", () => {
    it("sets and steps the tab, LaTeX only", () => {
        syncDocReview("a1", docAsk("k1"));
        stepDocReviewTab("a1", 1);
        expect(getDocReview("a1")?.tab).toBe("pdf");
        stepDocReviewTab("a1", 1);
        expect(getDocReview("a1")?.tab).toBe("changes");
        stepDocReviewTab("a1", -1);
        expect(getDocReview("a1")?.tab).toBe("pdf");
        setDocReviewTab("a1", "changes");
        expect(getDocReview("a1")?.tab).toBe("changes");

        syncDocReview("a2", docAsk("k2", "/r/notes/n.md"));
        stepDocReviewTab("a2", 1);
        expect(getDocReview("a2")?.tab).toBe("changes");
    });

    it("toggles the whole file", () => {
        syncDocReview("a1", docAsk("k1"));
        toggleWholeFile("a1");
        expect(getDocReview("a1")?.wholeFile).toBe(true);
        toggleWholeFile("a1");
        expect(getDocReview("a1")?.wholeFile).toBe(false);
    });

    it("adds, updates and removes comments", () => {
        syncDocReview("a1", docAsk("k1"));
        addComment("a1", { ...COMMENT, draft: true, note: "" });
        addComment("a1", { ...COMMENT, id: "c2" });
        updateComment("a1", "c1", { note: "say why", draft: false });
        expect(getDocReview("a1")?.comments.map((c) => [c.id, c.note, c.draft])).toEqual([
            ["c1", "say why", false],
            ["c2", "n", false],
        ]);
        removeComment("a1", "c1");
        expect(getDocReview("a1")?.comments.map((c) => c.id)).toEqual(["c2"]);
    });

    it("sets the general note and the last send", () => {
        syncDocReview("a1", docAsk("k1"));
        setGeneralNote("a1", "§3 still reads like a tutorial");
        setLastSend("a1", { kind: "approve", comments: 0 });
        expect(getDocReview("a1")).toMatchObject({
            generalNote: "§3 still reads like a tutorial",
            lastSend: { kind: "approve", comments: 0 },
        });
    });

    it("does nothing for an agent with no review", () => {
        addComment("a1", COMMENT);
        setGeneralNote("a1", "x");
        setDocReviewMode("a1", "review", 1);
        expect(getDocReview("a1")).toBeNull();
    });
});

describe("recordShown", () => {
    it("stores the text and its time under the path, keeping the other paths", () => {
        recordShown("a1", "/r/a.tex", "A", 1);
        recordShown("a1", "/r/b.md", "B", 2);
        recordShown("a1", "/r/a.tex", "A2", 3);
        expect(globalStore.get(shownContentAtom("a1"))).toEqual({
            "/r/a.tex": { text: "A2", at: 3 },
            "/r/b.md": { text: "B", at: 2 },
        });
        expect(globalStore.get(shownContentAtom("a2"))).toEqual({});
    });
});

describe("focusedDocReview", () => {
    it("reads the focused agent's review, and null with nothing focused", () => {
        const model = stubModel([]);
        syncDocReview("a1", docAsk("k1"));
        expect(focusedDocReview(model)).toBeNull();
        globalStore.set(model.focusIdAtom, "a1");
        expect(focusedDocReview(model)?.askId).toBe("k1");
        globalStore.set(model.focusIdAtom, "a2");
        expect(focusedDocReview(model)).toBeNull();
    });
});
