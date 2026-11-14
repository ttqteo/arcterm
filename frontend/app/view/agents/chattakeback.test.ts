import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import { withResultLines } from "./chatinitiative";
import type { PendingMessage } from "./chatpending";
import {
    boxHolds,
    boxShowsTyped,
    inputBoxRows,
    mergeTaken,
    takeBackPlan,
    TAKEN_BACK_LANDS_MS,
    takenBackOf,
    typedEcho,
    withoutTakenBack,
} from "./chattakeback";

const rule = "─".repeat(40);
const pend = (id: string, text: string, queued: boolean, kind?: PendingMessage["kind"]): PendingMessage => ({
    id,
    text,
    sentAt: 0,
    seen: 0,
    queued,
    ...(kind != null ? { kind } : {}),
});
const you = (text: string): AgentEntry => ({ kind: "user", text });
const said = (text: string): AgentEntry => ({ kind: "message", text });

describe("takeBackPlan", () => {
    it("takes back every queued message, oldest first, while Claude works: ↑ lets the turn run on, Esc stops it", () => {
        const pending = [pend("a", "first", true), pend("b", "second", true)];
        const taken = { ids: ["a", "b"], texts: ["first", "second"] };
        expect(takeBackPlan("ArrowUp", pending, [], "working")).toEqual({ kind: "queued", ...taken });
        expect(takeBackPlan("Escape", pending, [you("go")], "working")).toEqual({ kind: "interrupt", ...taken });
    });
    it("leaves commands out: Claude Code does not take them back", () => {
        const pending = [pend("a", "/btw why", true, "btw"), pend("b", "and this", true)];
        expect(takeBackPlan("ArrowUp", pending, [], "working")).toEqual({
            kind: "queued",
            ids: ["b"],
            texts: ["and this"],
        });
    });
    it("stops a turn Claude has not answered yet with Esc, for the message that started it", () => {
        expect(takeBackPlan("Escape", [pend("a", "fix it", false)], [], "working")).toEqual({
            kind: "interrupt",
            ids: ["a"],
            texts: ["fix it"],
        });
        // its bubble already gone: the transcript's last entry is still that message
        expect(takeBackPlan("Escape", [], [said("done"), you("fix it")], "working")).toEqual({
            kind: "interrupt",
            ids: [],
            texts: ["fix it"],
        });
    });
    it("puts back only what the person wrote when the message carried initiative result lines (result line)", () => {
        const sent = withResultLines(["initiative: added note to Auth (effort:ab12) › 2"], "fix it");
        expect(takeBackPlan("Escape", [], [said("done"), you(sent)], "working")).toEqual({
            kind: "interrupt",
            ids: [],
            texts: ["fix it"],
        });
        // Claude Code wraps a multi-line message whole as a paste
        const wrapped = `<pasted_content id="45ce">\n${sent}\n</pasted_content id="45ce">`;
        expect(takeBackPlan("Escape", [], [said("done"), you(wrapped)], "working")).toEqual({
            kind: "interrupt",
            ids: [],
            texts: ["fix it"],
        });
    });
    it("takes nothing back once Claude answered: Esc leaves the box as before", () => {
        expect(takeBackPlan("Escape", [], [you("fix it"), said("on it")], "working")).toBeNull();
    });
    it("never stops a turn with ↑: it recalls the history unless a message is queued", () => {
        expect(takeBackPlan("ArrowUp", [pend("a", "fix it", false)], [you("x")], "working")).toBeNull();
    });
    it("takes nothing back while Claude is idle or asks: the keys belong to the box, or to the dialog", () => {
        const pending = [pend("a", "first", true)];
        expect(takeBackPlan("Escape", pending, [you("x")], "idle")).toBeNull();
        expect(takeBackPlan("Escape", pending, [you("x")], "asking")).toBeNull();
        expect(takeBackPlan("ArrowUp", pending, [you("x")], "asking")).toBeNull();
    });
});

describe("inputBoxRows and boxHolds", () => {
    const screen = (...box: string[]) => [
        "⏺ Working on it",
        "",
        "> fix the chip",
        "",
        rule,
        ...box,
        rule,
        "  ⏵⏵ auto mode on",
    ];
    it("reads the rows between the last two rules", () => {
        expect(inputBoxRows(screen("❯ first", "  second"))).toEqual(["❯ first", "  second"]);
        expect(inputBoxRows(["no box here"])).toBeNull();
    });
    it("sees a taken-back text in the box, wrapped or not", () => {
        expect(boxHolds(screen("❯ first", "  second"), ["first", "second"])).toBe(true);
        expect(
            boxHolds(screen("❯ a long message that the termi", "  nal wrapped"), [
                "a long message that the terminal wrapped",
            ])
        ).toBe(true);
        expect(boxHolds(screen("❯ [Pasted text #1 +12 lines]"), ["a\nlong\npaste"])).toBe(true);
    });
    it("does not take the conversation's copy of the message for the box", () => {
        expect(boxHolds(screen("❯ "), ["fix the chip"])).toBe(false);
        expect(boxHolds(["> fix the chip"], ["fix the chip"])).toBe(false);
    });
});

// a send presses Enter only once the box shows the whole text: an Enter read in the same chunk as the text is a line break,
// and the next message went in after it as one prompt ("…cũng hay\ncó", 2026-11-12)
describe("boxShowsTyped", () => {
    const screen = (...box: string[]) => ["> có, và tôi thấy", "", rule, ...box, rule, "  ⏵⏵ auto mode on"];
    const msg = "có, và tôi thấy nó link mở SKILL hay memory/claude file cũng hay";
    it("waits while the box is empty or shows only part of the text", () => {
        expect(boxShowsTyped(screen("❯ "), msg)).toBe(false);
        expect(boxShowsTyped(screen("❯ có, và tôi thấy nó link mở SKI"), msg)).toBe(false);
        expect(boxShowsTyped(screen("❯ "), "có")).toBe(false);
    });
    it("sees the whole text, wrapped, after a draft, or as a paste placeholder", () => {
        expect(boxShowsTyped(screen(`❯ ${msg}`), msg)).toBe(true);
        expect(
            boxShowsTyped(screen("❯ có, và tôi thấy nó link mở SKILL hay memory/claude", "  file cũng hay"), msg)
        ).toBe(true);
        expect(boxShowsTyped(screen("❯ draft then có"), "có")).toBe(true);
        expect(boxShowsTyped(screen("❯ [Pasted text #1 +3 lines]"), "a\nb\nc\nd")).toBe(true);
    });
    it("matches a decomposed text against the composed screen", () => {
        expect(boxShowsTyped(screen("❯ cũng hay"), "cũng hay".normalize("NFD"))).toBe(true);
    });
    it("has nothing to wait for when no box shows", () => {
        expect(boxShowsTyped(["a permission dialog"], msg)).toBeNull();
    });
});

// a chat send whose text never reached Claude Code read as Queued for good: its box stayed empty through the turn
// ("thiếu chọn effort", 2026-11-13)
describe("typedEcho", () => {
    const screen = (...box: string[]) => ["> earlier message", "", rule, ...box, rule, "  ⏵⏵ auto mode on"];
    it("is shown once the box holds the text", () => {
        expect(typedEcho(screen("❯ thiếu chọn effort"), "thiếu chọn effort")).toBe("shown");
    });
    it("is absent while the box is readable and empty", () => {
        expect(typedEcho(screen("❯ "), "thiếu chọn effort")).toBe("absent");
        expect(typedEcho(screen("❯ ", "  "), "thiếu chọn effort")).toBe("absent");
    });
    it("is other while the box holds something that is not the text yet", () => {
        expect(typedEcho(screen("❯ thiếu chọn"), "thiếu chọn effort")).toBe("other");
        expect(typedEcho(screen("❯ ls -la"), "! ls -la")).toBe("other");
    });
    it("is unknown with no screen or no box on it", () => {
        expect(typedEcho(null, "x")).toBe("unknown");
        expect(typedEcho(["a permission dialog"], "x")).toBe("unknown");
    });
});

// the screen as the terminal reads it: each full-width rule is joined to the row drawn after it (a wrap to xterm), so no
// rule stands alone; read from a live Claude Code 2.1.323 on 2026-11-13, where every send logged echo=unknown
describe("a rule joined to the row after it", () => {
    const joined = (...box: string[]) => [
        "> earlier message",
        "",
        rule + (box[0] ?? ""),
        ...box.slice(1),
        rule + "  ⏵⏵ auto mode on (shift+tab to cycle) · esc to interrupt",
    ];
    const sent = "có, và ví dụ tôi muốn cockpit fullscreen ở màn 2 có được không?";
    it("still finds the box", () => {
        expect(inputBoxRows(joined("❯ "))).toEqual(["❯ "]);
        expect(inputBoxRows(joined(`❯ ${sent}`, "  "))).toEqual([`❯ ${sent}`, "  "]);
    });
    it("reads the box's text and an empty box from it", () => {
        expect(typedEcho(joined("❯ "), sent)).toBe("absent");
        expect(typedEcho(joined(`❯ ${sent}`), sent)).toBe("shown");
        expect(boxHolds(joined(`❯ ${sent}`), [sent])).toBe(true);
    });
    it("leaves a line that is a rule alone, and one that only starts with a short dash run", () => {
        expect(inputBoxRows(["x", rule, "❯ a", rule])).toEqual(["❯ a"]);
        expect(inputBoxRows(["──── not a rule", "❯ a"])).toBeNull();
    });
});

describe("mergeTaken", () => {
    it("puts the taken-back messages ahead of what the box holds, one per line, as Claude Code does", () => {
        expect(mergeTaken(["first", "second"], "")).toBe("first\nsecond");
        expect(mergeTaken(["first"], "draft")).toBe("first\ndraft");
    });
});

describe("withoutTakenBack", () => {
    const reply: AgentEntry = { kind: "message", text: "cce381a4 is the run's lead.", uuid: "r1" };
    const said = (uuid: string, text: string): AgentEntry => ({ kind: "user", text, uuid });
    const plan = (texts: string[]) => ({ kind: "interrupt" as const, ids: [], texts });

    it("hides a message that had landed when Esc took it back (2026-11-14, Windows)", () => {
        const entries = [said("u0", "đóng đi rồi xếp lại"), reply, said("u1", "đóng đi rồi xếp lại")];
        const taken = takenBackOf(plan(["đóng đi rồi xếp lại"]), entries, 1000);
        expect(taken.uuids).toEqual(["u1"]);
        // the same words sent and answered before are not it
        expect(withoutTakenBack(entries, taken, 1500).entries).toEqual([entries[0], reply]);
    });

    it("hides the record when it reaches Chat after the take-back, and keeps it hidden past the wait", () => {
        const before = [reply];
        const taken = takenBackOf(plan(["viết bài luận"]), before, 1000);
        expect(taken.texts).toEqual(["viết bài luận"]);
        const after = [reply, said("u2", "viết bài luận")];
        const { entries, next } = withoutTakenBack(after, taken, 1600);
        expect(entries).toEqual([reply]);
        expect(next?.uuids).toEqual(["u2"]);
        expect(withoutTakenBack(after, next!, 1000 + TAKEN_BACK_LANDS_MS * 3).entries).toEqual([reply]);
    });

    it("shows the message sent again: a record past the wait, or one Chat held at the take-back, is not it", () => {
        const taken = takenBackOf(plan(["viết bài luận"]), [reply], 1000);
        const resent = [reply, said("u3", "viết bài luận")];
        expect(withoutTakenBack(resent, taken, 1000 + TAKEN_BACK_LANDS_MS + 1).entries).toEqual(resent);
        const held = takenBackOf(plan(["khác"]), resent, 1000);
        expect(withoutTakenBack(resent, held, 1200).entries).toBe(resent);
    });

    it("leaves the entries as they are with no take-back", () => {
        const entries = [reply];
        expect(withoutTakenBack(entries, undefined, 0)).toEqual({ entries, next: null });
    });
});
