// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    applySuggestion,
    failChecking,
    pickChoice,
    reasonLines,
    runNote,
    startBlocker,
    startChecking,
    startLabel,
    toggleTick,
    waitingOn,
    WHEN_START,
    type WhenState,
} from "./launcherwhen";

const live = (runid: string, title: string, over: Partial<RunStartLiveRun> = {}): RunStartLiveRun => ({
    runid,
    title,
    ...over,
});
const suggestion = (over: Partial<RunStartSuggestion> = {}): RunStartSuggestion => ({
    choice: "now",
    reason: "Room for it",
    live: [],
    active: 0,
    maxactive: 3,
    ...over,
});
const LAND = live("r-land", "Land the resolver", { files: ["pkg/orchestrate/land.go"] });
const CHAT = live("r-chat", "Chat cards", { files: ["frontend/chat.tsx"] });
const STUCK = live("r-held", "Held run", { held: true, heldreason: "conflict" });

describe("applySuggestion", () => {
    it("starts on Run now with nothing ticked and nothing known", () => {
        expect(WHEN_START).toEqual({
            choice: "now",
            touched: false,
            ticked: [],
            suggestion: null,
            checking: false,
            error: null,
        });
    });

    it("preselects the suggested choice and ticks the runs it names", () => {
        const s = suggestion({ choice: "after", after: ["r-land"], live: [LAND, CHAT], reason: "Edits land.go" });
        const next = applySuggestion({ ...WHEN_START, checking: true }, s);
        expect(next).toMatchObject({
            choice: "after",
            ticked: ["r-land"],
            checking: false,
            error: null,
            touched: false,
        });
        expect(next.suggestion).toBe(s);
    });

    it("preselects Queue when the suggestion says so", () => {
        expect(applySuggestion(WHEN_START, suggestion({ choice: "queue" })).choice).toBe("queue");
    });

    it("reads a choice it does not know as Run now", () => {
        expect(applySuggestion(WHEN_START, suggestion({ choice: "later" })).choice).toBe("now");
    });

    it("never ticks a held run, even one the suggestion names", () => {
        const s = suggestion({ choice: "after", after: ["r-held", "r-land"], live: [STUCK, LAND] });
        expect(applySuggestion(WHEN_START, s).ticked).toEqual(["r-land"]);
    });

    it("keeps a hand pick: a suggestion after the person chose changes no choice", () => {
        const picked = pickChoice(WHEN_START, "queue");
        const next = applySuggestion(picked, suggestion({ choice: "after", after: ["r-land"], live: [LAND] }));
        expect(next.choice).toBe("queue");
        expect(next.touched).toBe(true);
        // what it still gives is the list After offers, with the overlapping run ticked for a person who goes there
        expect(next.suggestion?.live).toEqual([LAND]);
        expect(next.ticked).toEqual(["r-land"]);
    });

    it("keeps the runs the person ticked, and drops the ones no longer live", () => {
        let state = applySuggestion(WHEN_START, suggestion({ live: [LAND, CHAT] }));
        state = toggleTick(state, "r-chat");
        const next = applySuggestion(
            state,
            suggestion({ choice: "after", after: ["r-land"], live: [CHAT, live("r-new", "New run")] })
        );
        expect(next.ticked).toEqual(["r-chat"]);
        const gone = applySuggestion(state, suggestion({ live: [LAND] }));
        // the ticked run ended, so what is left follows the suggestion again
        expect(gone.ticked).toEqual([]);
    });

    it("clears the error and the checking flag", () => {
        const failed = failChecking(startChecking(WHEN_START), "boom");
        const next = applySuggestion(failed, suggestion());
        expect(next).toMatchObject({ error: null, checking: false });
    });
});

describe("startChecking and failChecking", () => {
    it("marks the check in flight and keeps what was chosen", () => {
        const picked = pickChoice(WHEN_START, "queue");
        expect(startChecking(picked)).toMatchObject({ choice: "queue", checking: true, error: null });
    });

    it("a failed check leaves Run now and no suggestion", () => {
        const state = applySuggestion(WHEN_START, suggestion({ choice: "queue" }));
        const failed = failChecking(startChecking(state), "boom");
        expect(failed).toMatchObject({ choice: "now", suggestion: null, ticked: [], checking: false, error: "boom" });
    });

    it("a failed check leaves a hand pick where the person put it", () => {
        const failed = failChecking(startChecking(pickChoice(WHEN_START, "queue")), "boom");
        expect(failed.choice).toBe("queue");
        expect(failed.touched).toBe(true);
    });
});

describe("pickChoice", () => {
    it("sets the choice and marks it as the person's", () => {
        expect(pickChoice(WHEN_START, "after")).toMatchObject({ choice: "after", touched: true });
    });
});

describe("toggleTick", () => {
    const state = (): WhenState => applySuggestion(WHEN_START, suggestion({ live: [LAND, CHAT, STUCK] }));

    it("ticks a run and unticks it again", () => {
        const ticked = toggleTick(state(), "r-land");
        expect(ticked.ticked).toEqual(["r-land"]);
        expect(ticked.touched).toBe(true);
        expect(toggleTick(ticked, "r-land").ticked).toEqual([]);
    });

    it("keeps the order the runs were ticked in", () => {
        expect(toggleTick(toggleTick(state(), "r-chat"), "r-land").ticked).toEqual(["r-chat", "r-land"]);
    });

    it("cannot tick a held run", () => {
        const next = toggleTick(state(), "r-held");
        expect(next.ticked).toEqual([]);
        // nothing the person did took effect, so nothing counts as their pick
        expect(next.touched).toBe(false);
    });

    it("cannot tick a run the suggestion does not list", () => {
        expect(toggleTick(state(), "r-unknown").ticked).toEqual([]);
    });

    it("drops a ticked run that went held when the next suggestion lands", () => {
        const ticked = toggleTick(state(), "r-land");
        const went = applySuggestion(ticked, suggestion({ live: [{ ...LAND, held: true }] }));
        expect(went.ticked).toEqual([]);
        expect(toggleTick(went, "r-land").ticked).toEqual([]);
    });
});

describe("reasonLines", () => {
    it("says Checking… while the call is in flight", () => {
        expect(reasonLines(startChecking(WHEN_START))).toEqual(["Checking…"]);
    });

    it("says Checking… over an older suggestion's reason", () => {
        const state = startChecking(applySuggestion(WHEN_START, suggestion({ reason: "old" })));
        expect(reasonLines(state)).toEqual(["Checking…"]);
    });

    it("says Couldn't check: and the error", () => {
        const state = failChecking(startChecking(WHEN_START), "run start suggestions are not built yet");
        expect(reasonLines(state)).toEqual(["Couldn't check: run start suggestions are not built yet"]);
    });

    it("is the suggestion's reason", () => {
        const state = applySuggestion(WHEN_START, suggestion({ reason: "Edits land.go like run Land" }));
        expect(reasonLines(state)).toEqual(["Edits land.go like run Land"]);
    });

    it("adds the quota note as a second line", () => {
        const state = applySuggestion(
            WHEN_START,
            suggestion({
                reason: "Room for it",
                quotanote: "Quota at 8%: the run will pause until 16:40, then carry on",
            })
        );
        expect(reasonLines(state)).toEqual([
            "Room for it",
            "Quota at 8%: the run will pause until 16:40, then carry on",
        ]);
    });

    it("has no line before the first check", () => {
        expect(reasonLines(WHEN_START)).toEqual([]);
    });
});

describe("startLabel", () => {
    const withLive = (choice: string, ticks: string[]): WhenState => {
        let state = applySuggestion(WHEN_START, suggestion({ choice, live: [LAND, CHAT, STUCK] }));
        state = pickChoice(state, choice as "now" | "after" | "queue");
        for (const id of ticks) {
            state = toggleTick(state, id);
        }
        return state;
    };

    it("is Start for Run now", () => {
        expect(startLabel(withLive("now", []))).toBe("Start");
    });

    it("takes the Run now label the caller already uses", () => {
        expect(startLabel(withLive("now", []), "Start run")).toBe("Start run");
    });

    it("is Queue for Queue", () => {
        expect(startLabel(withLive("queue", []))).toBe("Queue");
    });

    it("names the one run After waits for", () => {
        expect(startLabel(withLive("after", ["r-land"]))).toBe("Queue after Land the resolver");
    });

    it("counts two runs", () => {
        expect(startLabel(withLive("after", ["r-land", "r-chat"]))).toBe("Queue after 2 runs");
    });

    it("keeps a long title short", () => {
        const long = live("r-long", "A run whose title goes on and on past any button");
        const state = toggleTick(
            pickChoice(applySuggestion(WHEN_START, suggestion({ live: [long] })), "after"),
            "r-long"
        );
        const label = startLabel(state);
        expect(label.startsWith("Queue after A run whose")).toBe(true);
        expect(label.endsWith("…")).toBe(true);
        expect(label.length).toBeLessThanOrEqual("Queue after ".length + 30);
    });

    it("says Queue after… while After has nothing ticked", () => {
        expect(startLabel(withLive("after", []))).toBe("Queue after…");
    });

    it("counts a tick whose run left the list as a run", () => {
        const state: WhenState = { ...WHEN_START, choice: "after", touched: true, ticked: ["r-gone"] };
        expect(startLabel(state)).toBe("Queue after 1 run");
    });
});

describe("startBlocker", () => {
    it("holds After with nothing ticked", () => {
        expect(startBlocker(pickChoice(WHEN_START, "after"))).toBe("Pick a run to wait for");
    });

    it("lets After through once a run is ticked", () => {
        const state = toggleTick(
            pickChoice(applySuggestion(WHEN_START, suggestion({ live: [LAND] })), "after"),
            "r-land"
        );
        expect(startBlocker(state)).toBeNull();
    });

    it("never holds Run now or Queue", () => {
        expect(startBlocker(WHEN_START)).toBeNull();
        expect(startBlocker(pickChoice(WHEN_START, "queue"))).toBeNull();
    });
});

describe("runNote", () => {
    it("names the files a run shares with the new one", () => {
        expect(runNote(LAND)).toBe("shares pkg/orchestrate/land.go");
    });

    it("keeps a long list to three files and counts the rest", () => {
        const many = live("r-many", "Many", { files: ["a.go", "b.go", "c.go", "d.go", "e.go"] });
        expect(runNote(many)).toBe("shares a.go, b.go, c.go +2 more");
    });

    it("says a held run must land first, whatever it shares", () => {
        expect(runNote({ ...STUCK, files: ["land.go"] })).toBe("held: land it first");
    });

    it("has no line for a run that shares nothing", () => {
        expect(runNote(live("r-x", "Quiet"))).toBe("");
    });
});

describe("waitingOn", () => {
    it("is the ticked runs for After, in the order ticked", () => {
        let state = pickChoice(applySuggestion(WHEN_START, suggestion({ live: [LAND, CHAT] })), "after");
        state = toggleTick(toggleTick(state, "r-chat"), "r-land");
        expect(waitingOn(state)).toEqual(["r-chat", "r-land"]);
    });

    it("is nothing for Run now and Queue, whatever is ticked", () => {
        let state = toggleTick(applySuggestion(WHEN_START, suggestion({ live: [LAND] })), "r-land");
        expect(waitingOn(pickChoice(state, "queue"))).toEqual([]);
        expect(waitingOn(pickChoice(state, "now"))).toEqual([]);
    });
});
