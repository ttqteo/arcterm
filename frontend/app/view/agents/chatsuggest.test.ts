// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    chatChips,
    endsWithQuestion,
    initiativeChips,
    lastReply,
    recentPrompts,
    ruleChips,
    suggestKey,
    wantsModelSuggest,
    writesVietnamese,
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
        asleep: false,
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
        expect(wantsModelSuggest({ ...base, asleep: true })).toBe(false);
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
