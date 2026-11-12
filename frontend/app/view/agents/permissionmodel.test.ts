// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    answerFailureMessage,
    cardHead,
    cardShown,
    headIdOf,
    moreWaiting,
    permissionSummaryLine,
    permissionTitle,
    REFUSAL_MS,
    refusalClears,
    requestsGone,
    secondChoice,
    waitingFor,
} from "./permissionmodel";
import { tuiPermissionOptions } from "./tuiscreen";
import fixtures from "./tuiscreen.fixtures.json";

describe("cardHead", () => {
    const ask = { id: "a", toolname: "AskUserQuestion" };
    const bash = { id: "b", toolname: "Bash" };

    it("leaves an AskUserQuestion at the head to the chat's question card", () => {
        expect(cardHead([ask], true)).toBeUndefined();
        expect(cardHead([ask, bash], true)).toBeUndefined();
    });

    it("draws an AskUserQuestion when the chat shows no question card", () => {
        expect(cardHead([ask], false)).toBe(ask);
    });

    it("draws any other head, with or without a question card", () => {
        expect(cardHead([bash, ask], true)).toBe(bash);
        expect(cardHead([bash], false)).toBe(bash);
        expect(cardHead([], true)).toBeUndefined();
    });
});

describe("permissionTitle", () => {
    it("names what each answerable tool wants", () => {
        expect(permissionTitle("Bash")).toBe("Wants to run a command");
        expect(permissionTitle("Edit")).toBe("Wants to edit a file");
        expect(permissionTitle("MultiEdit")).toBe("Wants to edit a file");
        expect(permissionTitle("Write")).toBe("Wants to write a file");
        expect(permissionTitle("NotebookEdit")).toBe("Wants to edit a notebook");
        expect(permissionTitle("WebFetch")).toBe("Wants to fetch a page");
        expect(permissionTitle("WebSearch")).toBe("Wants to search the web");
        expect(permissionTitle("Agent")).toBe("Wants to start a subagent");
        expect(permissionTitle("Task")).toBe("Wants to start a subagent");
    });

    it("falls back to the tool's own name", () => {
        expect(permissionTitle("ExitPlanMode")).toBe("Wants to use ExitPlanMode");
        expect(permissionTitle("mcp__x__y")).toBe("Wants to use mcp__x__y");
    });
});

describe("waitingFor", () => {
    it("counts seconds under a minute", () => {
        expect(waitingFor(10_000, 14_000)).toBe("waiting 4s");
        expect(waitingFor(10_000, 10_000)).toBe("waiting 0s");
        expect(waitingFor(10_000, 69_999)).toBe("waiting 59s");
    });

    it("counts whole minutes, then hours", () => {
        expect(waitingFor(0, 120_000)).toBe("waiting 2m");
        expect(waitingFor(0, 179_000)).toBe("waiting 2m");
        expect(waitingFor(0, 3_600_000)).toBe("waiting 1h");
    });

    it("never reads a clock that is behind the request as negative", () => {
        expect(waitingFor(20_000, 10_000)).toBe("waiting 0s");
    });
});

describe("moreWaiting", () => {
    it("says nothing for none, and counts the rest", () => {
        expect(moreWaiting(0)).toBe("");
        expect(moreWaiting(-1)).toBe("");
        expect(moreWaiting(1)).toBe("1 more waiting");
        expect(moreWaiting(3)).toBe("3 more waiting");
    });
});

describe("cardShown", () => {
    it("shows for an awake agent that is working or asking", () => {
        expect(cardShown({ state: "asking" })).toBe(true);
        expect(cardShown({ state: "working" })).toBe(true);
    });

    it("hides for an idle agent, whose queue a killed process may have left behind", () => {
        expect(cardShown({ state: "idle" })).toBe(false);
    });

    it("hides for a sleeping agent", () => {
        expect(cardShown({ state: "asking", sleeping: { since: 1, freedBytes: 0 } })).toBe(false);
    });
});

describe("permissionSummaryLine", () => {
    it("prefixes a Bash command with a prompt", () => {
        expect(permissionSummaryLine({ toolname: "Bash", summary: "npm test" })).toBe("$ npm test");
    });

    it("leaves every other summary as it came", () => {
        expect(permissionSummaryLine({ toolname: "Edit", summary: "src/a.ts" })).toBe("src/a.ts");
        expect(permissionSummaryLine({ toolname: "WebFetch", summary: "https://x.test" })).toBe("https://x.test");
    });
});

describe("requestsGone", () => {
    const req = (id: string) => ({ id });

    it("lists the ids a new snapshot no longer holds", () => {
        expect(requestsGone([req("a"), req("b"), req("c")], [req("b")])).toEqual(["a", "c"]);
    });

    it("lists nothing while the queue only grows or stays", () => {
        expect(requestsGone([req("a")], [req("a"), req("b")])).toEqual([]);
        expect(requestsGone([], [req("a")])).toEqual([]);
    });

    it("lists everything when the queue empties", () => {
        expect(requestsGone([req("a"), req("b")], [])).toEqual(["a", "b"]);
    });
});

describe("headIdOf", () => {
    it("reads the first request's id, null for an empty queue", () => {
        expect(headIdOf([{ id: "a" }, { id: "b" }])).toBe("a");
        expect(headIdOf([])).toBeNull();
    });
});

describe("refusalClears", () => {
    // raised at t=1000 while "b" was the head (the refused "a" had already left the queue)
    const refusal = { ts: 1000, headId: "b" };

    it("stays while the same head waits, though the refused request is long gone", () => {
        expect(refusalClears(refusal, "b", 1000)).toBe(false);
        expect(refusalClears(refusal, "b", 1000 + REFUSAL_MS - 1)).toBe(false);
    });

    it("stays on an empty queue when it was raised on an empty queue", () => {
        expect(refusalClears({ ts: 1000, headId: null }, null, 2000)).toBe(false);
    });

    it("clears when a different request becomes the head", () => {
        expect(refusalClears(refusal, "c", 1500)).toBe(true);
    });

    it("clears when the head leaves and the queue empties", () => {
        expect(refusalClears(refusal, null, 1500)).toBe(true);
    });

    it("clears when a request arrives on a queue that was empty", () => {
        expect(refusalClears({ ts: 1000, headId: null }, "c", 1500)).toBe(true);
    });

    it("clears after its time, whatever the head", () => {
        expect(refusalClears(refusal, "b", 1000 + REFUSAL_MS)).toBe(true);
        expect(refusalClears({ ts: 1000, headId: null }, null, 1000 + REFUSAL_MS)).toBe(true);
    });
});

describe("answerFailureMessage", () => {
    it("reads an Error's message, which carries the server's refusal", () => {
        expect(answerFailureMessage(new Error("that request is no longer waiting"))).toBe(
            "that request is no longer waiting"
        );
    });

    it("reads a bare string", () => {
        expect(answerFailureMessage("boom")).toBe("boom");
    });

    it("never returns an empty line", () => {
        expect(answerFailureMessage(new Error("  "))).toBe("Could not send the answer");
        expect(answerFailureMessage(undefined)).toBe("Could not send the answer");
    });
});

describe("secondChoice", () => {
    it("is option 2's label for the captured Bash dialog", () => {
        const options = tuiPermissionOptions(fixtures.bashDialog);
        expect(options.length).toBeGreaterThanOrEqual(3);
        expect(secondChoice(options)).toBe(options[1].label);
        expect(secondChoice(options)).toMatch(/^Yes, and always allow access to /);
    });
    it("is option 2's label for the captured edit dialog", () => {
        const options = tuiPermissionOptions(fixtures.editDialog);
        expect(secondChoice(options)).toBe(options[1].label);
        expect(secondChoice(options)).toMatch(/^Yes, and switch to accept edits/);
    });
    it("matches Yes in any case", () => {
        expect(
            secondChoice([
                { n: 1, label: "Yes" },
                { n: 2, label: "yes, always" },
                { n: 3, label: "No" },
            ])
        ).toBe("yes, always");
    });
    it("is null for a two-option dialog", () => {
        expect(
            secondChoice([
                { n: 1, label: "Yes" },
                { n: 2, label: "Yes, and don't ask again" },
            ])
        ).toBeNull();
    });
    it("is null when option 2 starts with No", () => {
        expect(
            secondChoice([
                { n: 1, label: "Yes" },
                { n: 2, label: "No, keep planning" },
                { n: 3, label: "Tell Claude what to change" },
            ])
        ).toBeNull();
    });
    it("is null for no options", () => {
        expect(secondChoice([])).toBeNull();
    });
});
