// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    chatChips,
    chipEditable,
    chipIcon,
    closeChip,
    drawnChips,
    endsWithQuestion,
    initiativeChips,
    isLongTurn,
    lastReply,
    LONG_TURN_CHARS,
    LONG_TURN_TOOL_CALLS,
    pickedChip,
    pickedHint,
    recentPrompts,
    ROW_ENTER_ACTIONS_MS,
    ROW_LEAVE_ACTIONS_MS,
    rowHold,
    ruleChips,
    runningActions,
    stepPick,
    suggestKey,
    suggestTake,
    TERMINAL_AFTER_MS,
    turnSummary,
    turnToolCount,
    wantsModelSuggest,
    withChipText,
    writesVietnamese,
    type ChatChip,
    type ModelSuggest,
} from "./chatsuggest";
import type { ShipGit } from "./shipmodel";

const act: AgentEntry = { kind: "action", verb: "Read", target: "a.ts" };

describe("lastReply", () => {
    it("is the message that closed the turn, past the tool calls after it", () => {
        const entries: AgentEntry[] = [
            { kind: "user", text: "vẽ tôi xem" },
            { kind: "message", text: "Đang vẽ." },
            act,
            { kind: "message", text: "Bạn chọn A, B hay C?" },
            act,
        ];
        expect(lastReply(entries)).toBe("Bạn chọn A, B hay C?");
    });

    it("is null when an API error ended the turn: the usage limit's line is no reply", () => {
        const entries: AgentEntry[] = [
            { kind: "message", text: "Làm theo hướng này được không?" },
            { kind: "user", text: "được" },
            { kind: "message", text: "You've hit your 5-hour limit · resets 12:20am", apiError: true },
        ];
        expect(lastReply(entries)).toBeNull();
    });

    it("is null when the person spoke last, ran a command, or interrupted", () => {
        expect(
            lastReply([
                { kind: "message", text: "x" },
                { kind: "user", text: "ok" },
            ])
        ).toBeNull();
        expect(
            lastReply([
                { kind: "message", text: "x" },
                { kind: "command", name: "/clear" },
            ])
        ).toBeNull();
        expect(lastReply([{ kind: "message", text: "x" }, { kind: "interrupted" }])).toBeNull();
        expect(lastReply([])).toBeNull();
    });
});

describe("endsWithQuestion", () => {
    it("reads the last line of prose", () => {
        expect(endsWithQuestion('Ba phương án.\n\nBạn chọn A, B hay C, và có ẩn thẻ "Pin" không?')).toBe(true);
        expect(endsWithQuestion("Is it ok?\n\nDone, committed.")).toBe(false);
    });

    it("looks past highlight and emphasis marks and a card block after the question", () => {
        expect(endsWithQuestion("==Bạn đồng ý không?==")).toBe(true);
        expect(endsWithQuestion("**Which one?**")).toBe(true);
        expect(endsWithQuestion('Add it?\n\n```arc-initiative\n{"kind": "note"}\n```\n')).toBe(true);
    });
});

describe("recentPrompts and writesVietnamese", () => {
    it("keeps the person's last messages, oldest first, without what a picture brought", () => {
        const entries: AgentEntry[] = [
            { kind: "user", text: "một" },
            { kind: "message", text: "x" },
            { kind: "user", text: "ví dụ như này thì sao?\n\nAttached images:\n- /a.png" },
            { kind: "user", text: "commit   di" },
        ];
        expect(recentPrompts(entries, 2)).toEqual(["ví dụ như này thì sao?", "commit di"]);
        expect(recentPrompts(entries)).toEqual(["một", "ví dụ như này thì sao?", "commit di"]);
    });

    it("tells Vietnamese by its letters", () => {
        expect(writesVietnamese(["ok", "vẽ tôi xem"])).toBe(true);
        expect(writesVietnamese(["ok", "commit di"])).toBe(false);
    });
});

describe("ruleChips", () => {
    const agent = { kind: "agent" as const, blockId: "b", state: "idle" as const, edited: true };
    const git: ShipGit = { dirty: 2, ahead: 0, upstream: "origin/main" };

    it("asks for a commit of edits the turn left, in the person's language", () => {
        expect(ruleChips(agent, git, true)).toEqual([{ text: "commit đi", kind: "commit", source: "rule" }]);
        expect(ruleChips(agent, git, false)[0].text).toBe("commit it");
    });

    it("asks for a push of commits only", () => {
        const committed = { ...agent, edited: false, committed: true };
        expect(ruleChips(committed, { ...git, dirty: 0, ahead: 1 }, true)).toEqual([
            { text: "push đi", kind: "push", source: "rule" },
        ]);
    });

    it("offers nothing where the header offers no Ship", () => {
        expect(ruleChips(agent, null, true)).toEqual([]);
        expect(ruleChips({ ...agent, runId: "r" }, git, true)).toEqual([]);
        expect(ruleChips({ ...agent, step: "1/3" }, git, true)).toEqual([]);
        expect(ruleChips({ ...agent, edited: false }, git, true)).toEqual([]);
    });
});

describe("closeChip", () => {
    it("offers to close an agent the cockpit counts as done, in the person's language", () => {
        expect(closeChip(true, true)).toEqual({ text: "đóng agent", kind: "close", source: "rule" });
        expect(closeChip(true, false)).toEqual({ text: "close agent", kind: "close", source: "rule" });
    });

    it("offers nothing while the agent is not done", () => {
        expect(closeChip(false, true)).toBeUndefined();
    });
});

describe("chatChips with a close chip", () => {
    const push: ChatChip = { text: "push đi", kind: "push", source: "rule" };
    const close: ChatChip = { text: "đóng agent", kind: "close", source: "rule" };

    it("puts it last, after the rules and the model's step", () => {
        const chips = chatChips({
            question: false,
            rules: [push],
            model: { status: "done", replies: ["build đi"] },
            close,
        });
        expect(chips.map((c) => c.text)).toEqual(["push đi", "build đi", "đóng agent"]);
    });

    it("keeps it when the row is full: the model's step gives way", () => {
        const chips = chatChips({
            question: false,
            rules: [push],
            model: { status: "done", replies: ["build đi", "cài đi", "thêm test"] },
            close,
        });
        expect(chips.map((c) => c.text)).toEqual(["push đi", "build đi", "đóng agent"]);
    });

    it("leaves it out of a question's answers", () => {
        const chips = chatChips({ question: true, rules: [], model: { status: "done", replies: ["A", "B"] }, close });
        expect(chips.map((c) => c.text)).toEqual(["A", "B"]);
    });
});

describe("a close chip in the row", () => {
    const close: ChatChip = { text: "close agent", kind: "close", source: "rule" };

    it("is drawn only when the box can close the agent", () => {
        expect(drawnChips([close], true, true)).toEqual([close]);
        expect(drawnChips([close], true, false)).toEqual([]);
    });

    it("has no text to edit, and its hint says it closes the agent", () => {
        expect(chipEditable(close, true)).toBe(false);
        expect(pickedHint(close)[1]).toBe(" closes this agent · ");
    });

    it("has its own icon", () => {
        expect(chipIcon(close)).toBe("close");
    });
});

describe("chatChips", () => {
    const commit: ChatChip = { text: "commit đi", kind: "commit", source: "rule" };

    it("answers a question with the model's replies alone", () => {
        const chips = chatChips({
            question: true,
            rules: [commit],
            model: { status: "done", replies: ["B, ẩn thẻ Pin", "A", "C", "D"] },
        });
        expect(chips.map((c) => c.text)).toEqual(["B, ẩn thẻ Pin", "A", "C"]);
        expect(chips.every((c) => c.source === "model")).toBe(true);
    });

    it("keeps a question's row empty while the answers come, and says ok once the call failed or found none", () => {
        expect(chatChips({ question: true, rules: [], model: { status: "loading" } })).toEqual([]);
        expect(chatChips({ question: true, rules: [], model: undefined })).toEqual([]);
        expect(chatChips({ question: true, rules: [], model: { status: "failed" } })).toEqual([
            { text: "ok", kind: "reply", source: "fallback" },
        ]);
        expect(chatChips({ question: true, rules: [], model: { status: "done", replies: [] } })[0].text).toBe("ok");
    });

    it("puts the rules first on any other turn, then the model's step unless it repeats one", () => {
        expect(
            chatChips({ question: false, rules: [commit], model: { status: "done", replies: ["vẽ tôi xem"] } }).map(
                (c) => c.text
            )
        ).toEqual(["commit đi", "vẽ tôi xem"]);
        expect(
            chatChips({ question: false, rules: [commit], model: { status: "done", replies: ["Commit đi"] } })
        ).toEqual([commit]);
        expect(chatChips({ question: false, rules: [commit], model: { status: "loading" } })).toEqual([commit]);
    });

    it("gives the same chips whether or not the model's answer carries a summary", () => {
        const summary = "Lỗi là do một arcterm thứ hai. Mình chưa sửa code.";
        for (const question of [true, false]) {
            const bare = chatChips({
                question,
                rules: [commit],
                model: { status: "done", replies: ["vẽ tôi xem", "A"] },
            });
            const withSummary = chatChips({
                question,
                rules: [commit],
                model: { status: "done", replies: ["vẽ tôi xem", "A"], summary },
            });
            expect(withSummary).toEqual(bare);
        }
        // a summary with no replies is still a settled answer: a question's row says ok, as it does for none found
        expect(
            chatChips({ question: true, rules: [], model: { status: "done", replies: [], summary: "x" } })[0].text
        ).toBe("ok");
    });
});

describe("isLongTurn", () => {
    it("is true for a reply over the character threshold, and not at it", () => {
        expect(isLongTurn("x".repeat(LONG_TURN_CHARS), 0)).toBe(false);
        expect(isLongTurn("x".repeat(LONG_TURN_CHARS + 1), 0)).toBe(true);
    });

    it("is true for a turn with the tool-call threshold or more, and not just under it", () => {
        expect(isLongTurn("ok", LONG_TURN_TOOL_CALLS - 1)).toBe(false);
        expect(isLongTurn("ok", LONG_TURN_TOOL_CALLS)).toBe(true);
        expect(isLongTurn("ok", LONG_TURN_TOOL_CALLS + 5)).toBe(true);
    });

    it("is true when either one is past, false for a short reply of a short turn", () => {
        expect(isLongTurn("x".repeat(LONG_TURN_CHARS + 1), LONG_TURN_TOOL_CALLS)).toBe(true);
        expect(isLongTurn("Đã commit.", 2)).toBe(false);
        expect(isLongTurn("", 0)).toBe(false);
    });

    it("takes the thresholds from the spec: 1,200 characters, 8 tool calls", () => {
        expect(LONG_TURN_CHARS).toBe(1200);
        expect(LONG_TURN_TOOL_CALLS).toBe(8);
    });
});

describe("turnToolCount", () => {
    const user = (text: string): AgentEntry => ({ kind: "user", text });

    it("counts the actions after the last user entry, and none before it", () => {
        const entries: AgentEntry[] = [
            act,
            act,
            user("làm tiếp"),
            { kind: "message", text: "Đang đọc." },
            act,
            act,
            act,
            { kind: "message", text: "Xong." },
        ];
        expect(turnToolCount(entries)).toBe(3);
    });

    it("counts every action when the person has not spoken, and none for a turn that only wrote text", () => {
        expect(turnToolCount([act, act])).toBe(2);
        expect(turnToolCount([user("hi"), { kind: "message", text: "chào" }])).toBe(0);
        expect(turnToolCount([])).toBe(0);
    });

    it("counts an action whatever its outcome, and leaves out what is not an action", () => {
        const entries: AgentEntry[] = [
            user("sửa đi"),
            { kind: "action", verb: "edited", target: "a.ts", outcome: "fail" },
            { kind: "action", verb: "ran", target: "npm test", outcome: "ok" },
            { kind: "command", name: "/compact" },
            { kind: "interrupted" },
        ];
        expect(turnToolCount(entries)).toBe(2);
    });

    it("stops at a user entry that is the very last one: the new turn has no actions yet", () => {
        expect(turnToolCount([act, act, user("tiếp")])).toBe(0);
    });
});

describe("turnSummary", () => {
    const done = (summary?: string): ModelSuggest => ({ status: "done", replies: ["ok"], summary });

    it("is the summary of a done answer", () => {
        expect(turnSummary(done("Mình đã sửa lỗi. Chưa chạy test."))).toBe("Mình đã sửa lỗi. Chưa chạy test.");
    });

    it("is undefined while the call is on its way, after it failed, or before it was asked", () => {
        expect(turnSummary({ status: "loading" })).toBeUndefined();
        expect(turnSummary({ status: "failed" })).toBeUndefined();
        expect(turnSummary(undefined)).toBeUndefined();
    });

    it("is undefined for an answer with no summary, an empty one, or one of only spaces", () => {
        expect(turnSummary(done())).toBeUndefined();
        expect(turnSummary(done(""))).toBeUndefined();
        expect(turnSummary(done("  \n "))).toBeUndefined();
    });

    it("trims the line it gives", () => {
        expect(turnSummary(done("  Xong.  "))).toBe("Xong.");
    });
});

describe("initiativeChips", () => {
    const me = { kind: "agent", oref: "agent:t1" };
    const other = { kind: "agent", oref: "agent:t2" };
    const plan = (
        ...chunks: { label: string; status: string; workrefs?: { kind: string; oref: string; ts?: number }[] }[]
    ) => ({
        chunks,
    });

    it("offers to tick the chunk the agent holds once a turn committed", () => {
        const effort = plan(
            { label: "Build", status: "active", workrefs: [me] },
            { label: "Scenario", status: "pending" }
        );
        expect(initiativeChips(effort, "t1", true, true)).toEqual([
            { text: "xong: Build", kind: "done", source: "rule", chunk: "Build" },
        ]);
        expect(initiativeChips(effort, "t1", true, false)[0].text).toBe("done: Build");
        expect(initiativeChips(effort, "t1", false, true)).toEqual([]);
    });

    it("does not stand the active chunk in for an agent that holds none", () => {
        const effort = plan({ label: "Decide", status: "done" }, { label: "Build", status: "active" });
        expect(initiativeChips(effort, "t1", true, true)).toEqual([]);
        expect(initiativeChips(effort, "t1", false, true)).toEqual([]);
    });

    it("offers the live chunk the agent holds even when it also holds settled ones", () => {
        const effort = plan(
            { label: "Decide", status: "done", workrefs: [me] },
            { label: "Build", status: "pending", workrefs: [me] }
        );
        expect(initiativeChips(effort, "t1", true, false).map((c) => c.chunk)).toEqual(["Build"]);
    });

    describe("a turn's own work", () => {
        const stamped = (ts: number) => ({ kind: "agent", oref: "agent:t1", ts });
        const effort = (ts: number | undefined) =>
            plan(
                { label: "Build", status: "active", workrefs: [ts === undefined ? me : stamped(ts)] },
                { label: "Scenario", status: "pending" }
            );

        it("offers done for a chunk attached at or before the turn ended", () => {
            expect(initiativeChips(effort(100), "t1", true, false, 200).map((c) => c.chunk)).toEqual(["Build"]);
            expect(initiativeChips(effort(200), "t1", true, false, 200).map((c) => c.chunk)).toEqual(["Build"]);
        });

        it("hides done for a chunk attached after the turn ended (a switch, a carry-forward)", () => {
            expect(initiativeChips(effort(201), "t1", true, false, 200)).toEqual([]);
        });

        it("reads the stamp only when it is given: with no turn end, or no stamp, the chip is as it was", () => {
            expect(initiativeChips(effort(201), "t1", true, false).map((c) => c.chunk)).toEqual(["Build"]);
            expect(initiativeChips(effort(undefined), "t1", true, false, 200).map((c) => c.chunk)).toEqual(["Build"]);
        });

        it("does not hide go on with: by the stamp", () => {
            const e = plan(
                { label: "Build", status: "done", workrefs: [stamped(900)] },
                { label: "Scenario", status: "pending" }
            );
            expect(initiativeChips(e, "t1", false, false, 200).map((c) => c.chunk)).toEqual(["Scenario"]);
        });
    });

    it("offers the next chunk once the agent's are settled, skipping one someone else is on", () => {
        const effort = plan(
            { label: "Build", status: "done", workrefs: [me] },
            { label: "Polish", status: "active", workrefs: [other] },
            { label: "Blocked", status: "blocked" },
            { label: "Scenario", status: "pending" }
        );
        expect(initiativeChips(effort, "t1", false, true)).toEqual([
            { text: "làm tiếp: Scenario", kind: "next", source: "rule", chunk: "Scenario" },
        ]);
    });

    it("offers nothing after the last chunk, with no initiative, or on a proposed chunk", () => {
        expect(initiativeChips(plan({ label: "Build", status: "done", workrefs: [me] }), "t1", true, true)).toEqual([]);
        expect(initiativeChips(undefined, "t1", true, true)).toEqual([]);
        expect(initiativeChips(plan({ label: "Idea", status: "proposed", workrefs: [me] }), "t1", true, true)).toEqual(
            []
        );
    });
});

describe("wantsModelSuggest", () => {
    const base = {
        reply: "x",
        idle: true,
        asking: false,
        questionWaits: false,
        pending: false,
        seen: true,
    };

    it("asks for a turn the person has in front of them", () => {
        expect(wantsModelSuggest(base)).toBe(true);
    });

    it("asks nothing while anything else holds the turn, or nobody looks", () => {
        expect(wantsModelSuggest({ ...base, reply: null })).toBe(false);
        expect(wantsModelSuggest({ ...base, idle: false })).toBe(false);
        expect(wantsModelSuggest({ ...base, asking: true })).toBe(false);
        expect(wantsModelSuggest({ ...base, questionWaits: true })).toBe(false);
        expect(wantsModelSuggest({ ...base, pending: true })).toBe(false);
        expect(wantsModelSuggest({ ...base, seen: false })).toBe(false);
    });
});

describe("suggestKey", () => {
    it("is the same for the same turn and differs for another", () => {
        expect(suggestKey("a", "Bạn chọn A?")).toBe(suggestKey("a", "Bạn chọn A?"));
        expect(suggestKey("a", "Bạn chọn A?")).not.toBe(suggestKey("a", "Bạn chọn B?"));
        expect(suggestKey("a", "x")).not.toBe(suggestKey("b", "x"));
    });
});

describe("rowHold", () => {
    it("changes at once between replies and nothing, and when nothing changes", () => {
        expect(rowHold("suggest", "none")).toBe(0);
        expect(rowHold("none", "suggest")).toBe(0);
        expect(rowHold("actions", "actions")).toBe(0);
    });
    it("waits before the actions come, from replies or from nothing", () => {
        expect(rowHold("suggest", "actions")).toBe(ROW_ENTER_ACTIONS_MS);
        expect(rowHold("none", "actions")).toBe(ROW_ENTER_ACTIONS_MS);
    });
    it("waits before the actions go", () => {
        expect(rowHold("actions", "suggest")).toBe(ROW_LEAVE_ACTIONS_MS);
        expect(rowHold("actions", "none")).toBe(ROW_LEAVE_ACTIONS_MS);
    });
});

describe("runningActions", () => {
    const now = 1_000_000;
    const edit = (outcome?: "ok" | "fail" | "blocked"): AgentEntry => ({
        kind: "action",
        verb: "edited",
        target: "a.ts",
        outcome,
    });
    const ran = (startedAt: number, outcome?: "ok"): AgentEntry => ({
        kind: "action",
        verb: "ran",
        target: "npm test",
        startedAt,
        outcome,
    });

    it("offers neither while the turn only reads", () => {
        expect(runningActions([{ kind: "user", text: "xem giúp" }, act], now)).toEqual({
            diff: false,
            terminal: false,
            terminalAt: null,
        });
    });
    it("offers the diff once the turn edited a file, not for an edit that failed or was refused", () => {
        expect(runningActions([{ kind: "user", text: "sửa đi" }, edit("ok"), act], now).diff).toBe(true);
        expect(runningActions([{ kind: "user", text: "sửa đi" }, edit()], now).diff).toBe(true);
        expect(runningActions([{ kind: "user", text: "sửa đi" }, edit("fail"), edit("blocked")], now).diff).toBe(false);
    });
    it("reads only the turn since the person's last message", () => {
        expect(runningActions([edit("ok"), { kind: "user", text: "giải thích thôi" }, act], now).diff).toBe(false);
    });
    it("offers the terminal once a command has run long enough, and says when one will", () => {
        const user: AgentEntry = { kind: "user", text: "chạy test đi" };
        expect(runningActions([user, ran(now - TERMINAL_AFTER_MS)], now)).toEqual({
            diff: false,
            terminal: true,
            terminalAt: null,
        });
        expect(runningActions([user, ran(now - 2_000)], now)).toEqual({
            diff: false,
            terminal: false,
            terminalAt: now - 2_000 + TERMINAL_AFTER_MS,
        });
        expect(runningActions([user, ran(now - 60_000, "ok")], now).terminal).toBe(false);
    });
});

describe("Tab through the suggested replies", () => {
    const a: ChatChip = { text: "làm theo cách này", kind: "reply", source: "model" };
    const b: ChatChip = { text: "vẽ thử", kind: "reply", source: "model" };
    const done: ChatChip = { text: "xong: Tab hint", kind: "done", source: "rule", chunk: "Tab hint" };
    const row = [a, b, done];

    it("drawnChips leaves a done chip out when nothing can tick it", () => {
        expect(drawnChips(row, true)).toEqual(row);
        expect(drawnChips(row, false)).toEqual([a, b]);
    });

    it("stepPick starts at the first, Shift+Tab at the last", () => {
        expect(stepPick(row, null, false)).toBe(a.text);
        expect(stepPick(row, null, true)).toBe(done.text);
    });

    it("stepPick walks and wraps both ways", () => {
        expect(stepPick(row, a.text, false)).toBe(b.text);
        expect(stepPick(row, done.text, false)).toBe(a.text);
        expect(stepPick(row, a.text, true)).toBe(done.text);
    });

    it("stepPick treats a text gone from the row as none picked, and an empty row picks none", () => {
        expect(stepPick(row, "commit đi", false)).toBe(a.text);
        expect(stepPick([], null, false)).toBeNull();
    });

    it("pickedChip finds the chip by text, or none once the row changed", () => {
        expect(pickedChip(row, b.text)).toBe(b);
        expect(pickedChip(row, "commit đi")).toBeNull();
        expect(pickedChip(row, null)).toBeNull();
    });

    it("pickedHint says what Enter does: send the text, or tick the chunk", () => {
        expect(pickedHint(b)).toEqual([
            { key: "Enter" },
            " sends “vẽ thử” · ",
            { key: "Tab" },
            " next · ",
            { key: "Esc" },
            " back to typing",
        ]);
        expect(pickedHint(done)[1]).toBe(" marks “Tab hint” done · ");
    });

    it("pickedHint names Shift+Enter only when the chip's text can be edited first", () => {
        expect(pickedHint(b, true)).toEqual([
            { key: "Enter" },
            " sends “vẽ thử” · ",
            { key: "Shift+Enter" },
            " edits first · ",
            { key: "Tab" },
            " next · ",
            { key: "Esc" },
            " back to typing",
        ]);
        expect(pickedHint(b, false)).toEqual(pickedHint(b));
    });

    it("chipEditable: a sent text is editable, a done chip and a next chip that starts its chunk are not", () => {
        const next: ChatChip = { text: "làm tiếp: Docs", kind: "next", source: "rule", chunk: "Docs" };
        expect(chipEditable(b, true)).toBe(true);
        expect(chipEditable({ text: "commit đi", kind: "commit", source: "rule" }, true)).toBe(true);
        expect(chipEditable(done, true)).toBe(false);
        expect(chipEditable(next, true)).toBe(false);
        expect(chipEditable(next, false)).toBe(true);
    });
});

describe("suggestTake", () => {
    it("sends over an empty box, or one already holding the reply", () => {
        expect(suggestTake("", null, "commit đi")).toBe("send");
        expect(suggestTake("  \n", null, "commit đi")).toBe("send");
        expect(suggestTake("commit đi", null, "commit đi")).toBe("send");
    });
    it("over typed text arms the chip first, and the armed chip sends", () => {
        expect(suggestTake("đổi qua ⌘↓?", null, "commit đi")).toBe("arm");
        expect(suggestTake("đổi qua ⌘↓?", "commit đi", "commit đi")).toBe("send");
    });
    it("another chip than the armed one arms in its place", () => {
        expect(suggestTake("đổi qua ⌘↓?", "push đi", "commit đi")).toBe("arm");
    });
});

describe("chipIcon", () => {
    it("marks a reply that asks for a build with the hammer, and leaves other replies plain", () => {
        expect(chipIcon({ kind: "reply", text: "build đi" })).toBe("build");
        expect(chipIcon({ kind: "reply", text: "Build it" })).toBe("build");
        expect(chipIcon({ kind: "reply", text: "rebuild rồi cài" })).toBe("build");
        expect(chipIcon({ kind: "reply", text: "builder pattern?" })).toBeNull();
        expect(chipIcon({ kind: "reply", text: "vẽ tôi xem" })).toBeNull();
    });

    it("keeps each other kind's own icon", () => {
        expect(chipIcon({ kind: "commit", text: "commit đi" })).toBe("commit");
        expect(chipIcon({ kind: "push", text: "build and push" })).toBe("push");
        expect(chipIcon({ kind: "done", text: "xong: a" })).toBe("done");
        expect(chipIcon({ kind: "next", text: "go on with: b" })).toBe("next");
    });
});

describe("withChipText", () => {
    it("puts the suggestion alone in an empty box", () => {
        expect(withChipText("", "Có, đổi đi")).toBe("Có, đổi đi");
        expect(withChipText("  \n", "ok")).toBe("ok");
    });

    it("adds it after the typed text, one space between", () => {
        expect(withChipText("hello", "Có, đổi đi")).toBe("hello Có, đổi đi");
        expect(withChipText("hello ", "Có, đổi đi")).toBe("hello Có, đổi đi");
        expect(withChipText("hello\n", "Có, đổi đi")).toBe("hello\nCó, đổi đi");
    });
});
