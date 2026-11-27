// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    answerFailureMessage,
    cardHead,
    cardShown,
    choiceAnswer,
    headIdOf,
    keptChoice,
    moreWaiting,
    moveChoice,
    permissionBoxKey,
    permissionChoices,
    permissionRowLabel,
    permissionSummaryLine,
    permissionTitle,
    REFUSAL_MS,
    refusalClears,
    requestsGone,
    rowPermission,
    rowWaitLine,
    secondChoice,
    transformMoves,
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
        expect(permissionTitle("Artifact")).toBe("Wants to use an artifact");
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

describe("the card's choices from the keyboard", () => {
    const withSecond = permissionChoices(true);
    const plain = permissionChoices(false);

    it("lists the buttons in the order the card draws them", () => {
        expect(withSecond).toEqual(["allow", "second", "deny"]);
        expect(plain).toEqual(["allow", "deny"]);
    });

    it("sends what each button sends", () => {
        expect(choiceAnswer("allow")).toEqual({ allow: true });
        expect(choiceAnswer("second")).toEqual({ allow: true, choice: 2 });
        expect(choiceAnswer("deny")).toEqual({ allow: false });
    });

    it("picks the Yes off the screen for a prompt that is a list of its own", () => {
        expect(choiceAnswer("allow", true)).toEqual({ allow: true, screen: true });
        expect(choiceAnswer("deny", true)).toEqual({ allow: false });
    });

    it("moves the highlight with ↑ and ↓, held at the ends", () => {
        expect(moveChoice(withSecond, "allow", 1)).toBe("second");
        expect(moveChoice(withSecond, "second", 1)).toBe("deny");
        expect(moveChoice(withSecond, "deny", 1)).toBe("deny");
        expect(moveChoice(withSecond, "deny", -1)).toBe("second");
        expect(moveChoice(withSecond, "allow", -1)).toBe("allow");
        expect(moveChoice(plain, "allow", 1)).toBe("deny");
    });

    it("keeps the highlighted choice, not its place, when the second button shows up late", () => {
        // ↓ onto Deny before the "Yes, and …" label was read: Deny stays highlighted once the button joins the row
        expect(keptChoice(withSecond, moveChoice(plain, "allow", 1))).toBe("deny");
        // the second button gone (read again as a dialog of two options): back to Allow
        expect(keptChoice(plain, "second")).toBe("allow");
        expect(moveChoice(plain, "second", 1)).toBe("deny");
    });

    it("takes ↑, ↓ and Enter only in an empty box, with no modifier or IME composition", () => {
        const k = (
            key: string,
            more: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing", boolean>> = {}
        ) => ({
            key,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
            ...more,
        });
        expect(permissionBoxKey(k("ArrowUp"), true)).toBe("up");
        expect(permissionBoxKey(k("ArrowDown"), true)).toBe("down");
        expect(permissionBoxKey(k("Enter"), true)).toBe("pick");
        expect(permissionBoxKey(k("Enter"), false)).toBeNull();
        expect(permissionBoxKey(k("ArrowDown"), false)).toBeNull();
        expect(permissionBoxKey(k("Enter", { shiftKey: true }), true)).toBeNull();
        expect(permissionBoxKey(k("ArrowUp", { metaKey: true }), true)).toBeNull();
        expect(permissionBoxKey(k("Enter", { isComposing: true }), true)).toBeNull();
        expect(permissionBoxKey(k("1"), true)).toBeNull();
    });
});

const req = (
    toolname: string,
    summary: string,
    extra: Partial<AgentPermissionRequest> = {}
): AgentPermissionRequest => ({
    id: `${toolname}-1`,
    toolname,
    summary,
    answerable: [
        "Bash",
        "Edit",
        "Write",
        "MultiEdit",
        "NotebookEdit",
        "WebFetch",
        "WebSearch",
        "Agent",
        "Task",
    ].includes(toolname),
    ts: 0,
    ...extra,
});

describe("rowPermission", () => {
    const open = { shown: true, otherAsk: false, refused: false };

    it("offers Allow and Deny for an answerable head", () => {
        const bash = req("Bash", "ls");
        expect(rowPermission([bash, req("Edit", "/a.ts")], open)).toEqual({
            kind: "answer",
            head: bash,
            screen: false,
        });
    });

    it("answers a ScreenPick head by picking its Yes off the screen", () => {
        const art = req("Artifact", "delete https://claude.ai/artifact/x", { screenpick: true });
        expect(rowPermission([art], open)).toEqual({ kind: "answer", head: art, screen: true });
    });

    it("sends a head it may not allow to the chat", () => {
        const plan = req("ExitPlanMode", 'ExitPlanMode {"plan":"…"}');
        expect(rowPermission([plan], open)).toEqual({ kind: "chat", head: plan });
        expect(rowPermission([req("mcp__x__y", "mcp__x__y {}")], open)?.kind).toBe("chat");
    });

    it("leaves an AskUserQuestion head as it is, whatever waits behind it", () => {
        expect(rowPermission([req("AskUserQuestion", "{}"), req("Bash", "ls")], open)).toBeNull();
    });

    it("shows nothing for a stale queue, or while another ask holds the row", () => {
        expect(rowPermission([req("Bash", "ls")], { ...open, shown: false })).toBeNull();
        expect(rowPermission([req("Bash", "ls")], { ...open, otherAsk: true })).toBeNull();
        expect(rowPermission([], { ...open, refused: true, otherAsk: true })).toBeNull();
    });

    it("keeps the refusal line alone once the queue is empty", () => {
        expect(rowPermission([], { ...open, refused: true })).toEqual({ kind: "refusal" });
        expect(rowPermission([], open)).toBeNull();
    });
});

describe("permissionRowLabel", () => {
    it("reads a Bash command in mono, on one line", () => {
        expect(permissionRowLabel(req("Bash", "task check:ts &&\n  npx vitest run"))).toEqual({
            text: "$ task check:ts && npx vitest run",
            mono: true,
        });
    });

    it("reads a subagent's description without its type and model", () => {
        expect(permissionRowLabel(req("Agent", "Update board CDP scenarios (Explore on haiku)")).text).toBe(
            "subagent · Update board CDP scenarios"
        );
        expect(permissionRowLabel(req("Task", "Fix (the) race (general-purpose)")).text).toBe(
            "subagent · Fix (the) race"
        );
    });

    it("names the file of a file tool, the page of a fetch and the query of a search", () => {
        expect(permissionRowLabel(req("Edit", "D:\\repo\\frontend\\app\\x.tsx")).text).toBe("edit x.tsx");
        expect(permissionRowLabel(req("MultiEdit", "/repo/a/b.go")).text).toBe("edit b.go");
        expect(permissionRowLabel(req("Write", "/repo/docs/new.md")).text).toBe("write new.md");
        expect(permissionRowLabel(req("WebFetch", "https://example.com/docs")).text).toBe("fetch example.com/docs");
        expect(permissionRowLabel(req("WebSearch", "tauri drag region")).text).toBe("search tauri drag region");
    });

    it("prefixes an artifact call and any other answerable tool with its name", () => {
        const art = req("Artifact", "publish /s/a.html", { screenpick: true });
        expect(permissionRowLabel(art).text).toBe("artifact · publish /s/a.html");
        expect(permissionRowLabel(req("Other", "do it", { answerable: true })).text).toBe("Other · do it");
    });

    it("gives a head it may not allow a short name, never its input as JSON", () => {
        expect(permissionRowLabel(req("ExitPlanMode", 'ExitPlanMode {"plan":"# Plan"}'))).toEqual({
            text: "plan approval",
            mono: false,
        });
        expect(permissionRowLabel(req("mcp__stitch__get_project", 'mcp__stitch__get_project {"id":1}')).text).toBe(
            "mcp__stitch__get_project"
        );
    });

    it("falls back to a short name when wavesrv had only the raw input", () => {
        expect(permissionRowLabel(req("Agent", 'Agent {"prompt":"…"}')).text).toBe("subagent");
        expect(permissionRowLabel(req("Bash", "Bash")).text).toBe("Bash");
    });
});

describe("rowWaitLine", () => {
    it("counts what waits behind the head, then how long it waited", () => {
        expect(rowWaitLine(1, 0, 8_000)).toBe("+1 more · waiting 8s");
        expect(rowWaitLine(0, 0, 60_000)).toBe("waiting 1m");
    });
});

describe("transformMoves", () => {
    it("reads a translate as moving and rest or a scale alone as still", () => {
        expect(transformMoves("none")).toBe(false);
        expect(transformMoves("matrix(1, 0, 0, 1, 0, 0)")).toBe(false);
        expect(transformMoves("matrix(1.012, 0, 0, 1.012, 0, 0)")).toBe(false);
        expect(transformMoves("matrix(1, 0, 0, 1, 0, -24.5)")).toBe(true);
        expect(transformMoves("matrix(1, 0, 0, 1, 0.2, 0.3)")).toBe(false);
        expect(transformMoves("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 12, 0, 1)")).toBe(true);
    });
});
