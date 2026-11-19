// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    chatChips,
    chipEditable,
    chipIcon,
    chipPickLogLine,
    closeChip,
    drawnChips,
    endsWithQuestion,
    fitChips,
    initiativeChips,
    lastReply,
    pickedChip,
    pickedHint,
    plainAnswer,
    quickChip,
    recentPrompts,
    restatesQuestion,
    ROW_ENTER_ACTIONS_MS,
    ROW_LEAVE_ACTIONS_MS,
    rowHold,
    ruleChips,
    runningActions,
    stepPick,
    suggestKey,
    suggestTake,
    TERMINAL_AFTER_MS,
    wantsModelSuggest,
    withChipText,
    writesVietnamese,
    yesNoChips,
    yesNoQuestion,
    type ChatChip,
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

    it("keeps every chip, the close chip last: the row draws what fits (fitChips)", () => {
        const chips = chatChips({
            question: false,
            rules: [push],
            model: { status: "done", replies: ["build đi", "cài đi", "thêm test"] },
            close,
        });
        expect(chips.map((c) => c.text)).toEqual(["push đi", "build đi", "cài đi", "thêm test", "đóng agent"]);
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

describe("chipPickLogLine", () => {
    const ok: ChatChip = { text: "ok", kind: "reply", source: "fallback" };
    const a: ChatChip = { text: "làm A", kind: "reply", source: "model" };

    it("names where the chip came from, its place and the question's kind", () => {
        const line = chipPickLogLine(
            "d29ef42b-1111",
            ok,
            [a, ok],
            "Nên làm A hay B?\n\nMình nghiêng về A.  Bạn chọn?",
            "send"
        );
        expect(line).toBe(
            'chatsuggest: block=d29ef42b pick send source=fallback kind=reply at=2/2 question=open text="ok" ' +
                'tail="Nên làm A hay B? Mình nghiêng về A. Bạn chọn?"'
        );
    });

    it("reads a yes-or-no question and a turn that asks nothing", () => {
        expect(chipPickLogLine("b", a, [a], "Commit nhé?", "edit")).toContain(
            "pick edit source=model kind=reply at=1/1 question=yesno"
        );
        expect(chipPickLogLine("b", a, [a], "Xong rồi.", "send")).toContain("question=none");
        expect(chipPickLogLine(undefined, a, [a], null, "send")).toContain("block= pick send");
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
        expect(chips.map((c) => c.text)).toEqual(["B, ẩn thẻ Pin", "A", "C", "D"]);
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

describe("quickChip", () => {
    const chips = [
        { kind: "reply", text: "build di", source: "rule" },
        { kind: "reply", text: "ok", source: "rule" },
    ] as ChatChip[];
    it("takes the first chip over an empty box", () => {
        expect(quickChip(chips, "")?.text).toBe("build di");
        expect(quickChip(chips, "  \n")?.text).toBe("build di");
    });
    it("leaves the key to the box once something is typed, or when there is no chip", () => {
        expect(quickChip(chips, "hello")).toBeNull();
        expect(quickChip([], "")).toBeNull();
    });
});

describe("yesNoQuestion", () => {
    it("reads a question that opens or closes like a yes or no", () => {
        for (const reply of [
            "Đã sửa xong. Có muốn mình build luôn không?",
            "Xong phần UI. Build nhé?",
            "Tests pass. Should I commit this?",
            "Done. Want me to run the full suite?",
            "I fixed it. So, ready to build?",
            "Mình sẽ đổi tên hàm, ok?",
            "**Có muốn mình chạy lại test không?**",
            "Bản vá đây:\n\n```ts\nconst a = 1;\n```\n\nÁp dụng luôn nhé?",
        ]) {
            expect(yesNoQuestion(reply), reply).toBe(true);
        }
    });

    it("leaves out a question that asks for something else, offers a choice, or is no question", () => {
        for (const reply of [
            "Bạn chọn A, B hay C?",
            "Should I use the hook or the polling path?",
            "Which one do you want?",
            "Bạn muốn đặt tên là gì?",
            "Đã chạy test chưa?",
            "Cái nào gọn hơn?",
            "Đã sửa xong lỗi.",
            "What do you think about the layout?",
        ]) {
            expect(yesNoQuestion(reply), reply).toBe(false);
        }
    });
});

describe("yes and no chips", () => {
    it("speak the person's language", () => {
        expect(yesNoChips(true).map((c) => c.text)).toEqual(["ok", "không"]);
        expect(yesNoChips(false).map((c) => c.text)).toEqual(["yes", "no"]);
        expect(yesNoChips(true).every((c) => c.kind === "reply" && c.source === "rule")).toBe(true);
    });

    it("show at once, and the model's answers that say more come after them", () => {
        const yesNo = yesNoChips(true);
        expect(chatChips({ question: true, rules: [], model: { status: "loading" }, yesNo })).toEqual(yesNo);
        expect(chatChips({ question: true, rules: [], model: undefined, yesNo })).toEqual(yesNo);
        const done = chatChips({
            question: true,
            rules: [],
            model: { status: "done", replies: ["ok làm đi", "build rồi push luôn", "không cần đâu", "để sau"] },
            yesNo,
        });
        expect(done.map((c) => c.text)).toEqual(["ok", "không", "build rồi push luôn", "để sau"]);
    });

    it("leave out an answer that only says the question's action back", () => {
        const reply =
            'Chỉ code mới còn giữ `witness`.\n\nBạn muốn mình đổi luôn "witness" thành "candidate PoC" trong report này, rồi commit và sync không?';
        const row = chatChips({
            question: true,
            rules: [],
            model: {
                status: "done",
                replies: ["Đổi luôn đi", "Đổi witness thành candidate PoC", "đổi, không sync", "đổi cả trong code"],
            },
            yesNo: yesNoChips(true),
            reply,
        });
        expect(row.map((c) => c.text)).toEqual(["ok", "không", "đổi, không sync", "đổi cả trong code"]);
        expect(restatesQuestion("ok đổi luôn đi", reply)).toBe(true);
        expect(restatesQuestion("chỉ đổi, chưa commit", reply)).toBe(false);
    });

    it("are not a plain yes or no once the reply says what to do", () => {
        expect(plainAnswer("ok làm đi")).toBe(true);
        expect(plainAnswer("Yes, go ahead")).toBe(true);
        expect(plainAnswer("không cần đâu")).toBe(true);
        expect(plainAnswer("ok, và ẩn thẻ Pin")).toBe(false);
        expect(plainAnswer("có, chạy cả e2e")).toBe(false);
    });
});

describe("fitChips", () => {
    const c = (text: string, kind: ChatChip["kind"] = "reply"): ChatChip => ({ text, kind, source: "model" });
    const widths = { a: 100, b: 200, c: 60, d: 300, close: 90 };

    it("keeps the chips that fit whole on the line, a shorter one taking the room a wider one left", () => {
        // room 400: a 100, b +206 = 306, c +66 = 372, d does not fit
        expect(fitChips([c("a"), c("b"), c("d"), c("c")], widths, 400, 0).map((x) => x.text)).toEqual(["a", "b", "c"]);
        // the reserve is room the keys take
        expect(fitChips([c("a"), c("b"), c("c")], widths, 400, 52).map((x) => x.text)).toEqual(["a", "b"]);
    });

    it("always keeps the first, which ends in … when alone too wide", () => {
        expect(fitChips([c("d"), c("a")], widths, 250, 0).map((x) => x.text)).toEqual(["d"]);
    });

    it("keeps a close chip over the replies before it", () => {
        const close = c("close", "close");
        expect(fitChips([c("a"), c("b"), c("c"), close], widths, 400, 0).map((x) => x.text)).toEqual([
            "a",
            "c",
            "close",
        ]);
    });

    it("keeps every chip until each is measured", () => {
        const all = [c("a"), c("new")];
        expect(fitChips(all, widths, 50, 0)).toEqual(all);
        expect(fitChips(all, widths, 0, 0)).toEqual(all);
    });
});
