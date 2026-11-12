import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    PASTE_OVER,
    PENDING_IDLE_MS,
    PENDING_MAX_MS,
    PENDING_QUEUED_MAX_MS,
    btwQuestion,
    holdLine,
    isSendNowKey,
    pastesBody,
    pendingKind,
    pendingLine,
    pendingMessage,
    pendingStill,
    pendsAsBubble,
    pushSent,
    queuedBubbleUp,
    recall,
    releasesHeld,
    sendHold,
    submitDelayMs,
    submitSteps,
    userTextCount,
    type PendingMessage,
} from "./chatpending";

const user = (text: string): AgentEntry => ({ kind: "user", text });
const msg = (text: string): AgentEntry => ({ kind: "message", text });

describe("userTextCount", () => {
    it("counts the user entries holding exactly that text, ignoring edge whitespace and Claude's messages", () => {
        const entries = [user("hello"), msg("hello"), user(" hello\n"), user("other")];
        expect(userTextCount(entries, "hello")).toBe(2);
        expect(userTextCount(entries, "nope")).toBe(0);
    });

    it("counts a command entry as the text it was typed as, whitespace runs aside", () => {
        const entries: AgentEntry[] = [
            { kind: "command", name: "/config", shell: { output: "Config dialog dismissed", error: "" } },
            { kind: "command", name: "/btw", args: "which file now?", btw: { answer: "a.ts" } },
            user("/config"),
        ];
        expect(userTextCount(entries, "/config")).toBe(2);
        expect(userTextCount(entries, "/btw which  file\nnow?")).toBe(1);
        expect(userTextCount(entries, "/btw other")).toBe(0);
    });

    it("counts a `! cmd` as the bash row the projection makes of it (name !, the command as args)", () => {
        const entries: AgentEntry[] = [
            { kind: "command", name: "!", args: "git status", shell: { output: "clean", error: "" } },
            { kind: "command", name: "!", args: "ls" },
        ];
        expect(userTextCount(entries, "!git status")).toBe(1);
        expect(userTextCount(entries, "! git  status")).toBe(1);
        expect(userTextCount(entries, "!ls")).toBe(1);
        expect(userTextCount(entries, "!pwd")).toBe(0);
    });

    it("counts a message Claude Code wrapped whole as a paste (a send with a picture or a line break goes in so)", () => {
        const sent = "bash mode không đẹp lắm\n\nAttached images:\n- C:\\a\\image.png";
        const entries = [user(`<pasted_content id="45ce">\n${sent}\n</pasted_content id="45ce">`)];
        expect(userTextCount(entries, sent)).toBe(1);
        expect(userTextCount(entries, "bash mode không đẹp lắm")).toBe(0);
    });
});

describe("btwQuestion and pendingKind", () => {
    it("reads the question of a /btw, and nothing else", () => {
        expect(btwQuestion("/btw which file?")).toBe("which file?");
        expect(btwQuestion("  /btw  two\nlines \n")).toBe("two\nlines");
        expect(btwQuestion("/btw")).toBeNull();
        expect(btwQuestion("/btw   ")).toBeNull();
        expect(btwQuestion("/btwx q")).toBeNull();
        expect(btwQuestion("btw q")).toBeNull();
    });

    it("is btw for a side question and panel for a bare panel command; nothing for the rest", () => {
        expect(pendingKind("/btw which file?")).toBe("btw");
        expect(pendingKind("/config")).toBe("panel");
        expect(pendingKind("/usage\n")).toBe("panel");
        expect(pendingKind("/model opus")).toBeUndefined();
        expect(pendingKind("/compact")).toBeUndefined();
        expect(pendingKind("hello")).toBeUndefined();
    });

    it("is bash for a bash-mode `! cmd`, and nothing for a bare ! or a message ending in one", () => {
        expect(pendingKind("!git status")).toBe("bash");
        expect(pendingKind("! ls -la")).toBe("bash");
        expect(pendingKind("!")).toBeUndefined();
        expect(pendingKind("great!")).toBeUndefined();
    });
});

describe("pendingStill", () => {
    const p = (over: Partial<PendingMessage> = {}): PendingMessage => ({
        id: "a",
        text: "hello",
        sentAt: 1000,
        seen: 1,
        ...over,
    });
    it("keeps a pending whose text the entries hold `seen` times", () => {
        expect(pendingStill([p()], [user("hello")], 2000)).toHaveLength(1);
    });
    it("drops it once the entries hold the text one more time", () => {
        expect(pendingStill([p()], [user("hello"), user("hello")], 2000)).toEqual([]);
    });
    it("drops a message older than PENDING_QUEUED_MAX_MS", () => {
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_QUEUED_MAX_MS - 1)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_QUEUED_MAX_MS)).toEqual([]);
    });
    it("drops one the agent has sat idle on for PENDING_IDLE_MS since it was sent", () => {
        // idle from 3000; sent at 1000 (queued before the turn ended, then cleared with Esc)
        expect(pendingStill([p()], [user("hello")], 3000 + PENDING_IDLE_MS - 1, 3000)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 3000 + PENDING_IDLE_MS, 3000)).toEqual([]);
    });
    it("counts the idle wait from the send when it was sent to an idle agent", () => {
        // idle since 500, sent at 1000 (typed in but never submitted)
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_IDLE_MS - 1, 500)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_IDLE_MS, 500)).toEqual([]);
    });
    it("keeps a queued message past two minutes while the agent works: a long tool call holds the queue that long", () => {
        // queued 02:30:56, taken 02:34:17, while a 400 s typecheck ran
        expect(pendingStill([p()], [user("hello")], 1000 + 201_000, null)).toHaveLength(1);
        expect(pendingStill([p()], [user("hello")], 1000 + PENDING_MAX_MS, null)).toHaveLength(1);
    });
    it("keeps a side question or an open panel while the agent sits idle, up to PENDING_MAX_MS", () => {
        for (const kind of ["btw", "panel", "bash"] as const) {
            const q = p({ kind, text: "/config", seen: 0 });
            expect(pendingStill([q], [], 3000 + PENDING_IDLE_MS + 1, 3000)).toHaveLength(1);
            expect(pendingStill([q], [], 1000 + PENDING_MAX_MS, 3000)).toEqual([]);
        }
    });

    it("matches each pending against its own text", () => {
        const out = pendingStill(
            [p({ id: "a" }), p({ id: "b", text: "two", seen: 0 })],
            [user("hello"), user("two")],
            2000
        );
        expect(out.map((x) => x.id)).toEqual(["a"]);
    });
});

// Whether a message is queued is decided when it is sent. Read from the agent's state as it drew, a message sent to an
// idle agent flashed a caption, then Queued with Send now as the turn it started set the agent working, then went as the
// transcript took it.
describe("pendingMessage and the line under it", () => {
    const entries: AgentEntry[] = [];
    it("gives a message sent to an idle agent no line while the turn it started runs", () => {
        const p = pendingMessage("p1", "fix the chip", entries, 1_000, false);
        expect(p.queued).toBe(false);
        expect(pendingLine([p])).toBeNull();
        expect(queuedBubbleUp([p])).toBe(false);
    });
    it("reads Queued under a message sent while the agent works, which Send now can push", () => {
        const p = pendingMessage("p2", "and the tray", entries, 1_000, true);
        expect(pendingLine([p])).toBe("Queued");
        expect(queuedBubbleUp([p])).toBe(true);
    });
    it("counts the queued messages in one line", () => {
        const ps = [
            pendingMessage("p5", "one", entries, 1_000, true),
            pendingMessage("p6", "two", entries, 1_100, true),
            pendingMessage("p7", "three", entries, 1_200, false),
        ];
        expect(pendingLine(ps)).toBe("2 queued");
    });
    it("lets the harness's starting line stand in for either", () => {
        expect(pendingLine([pendingMessage("p3", "go", entries, 1_000, true)], "Starting Claude Code…")).toBe(
            "Starting Claude Code…"
        );
        expect(pendingLine([pendingMessage("p8", "go", entries, 1_000, false)], "Starting Claude Code…")).toBe(
            "Starting Claude Code…"
        );
    });
    it("has no line for commands alone, nor for nothing pending", () => {
        expect(
            pendingLine([pendingMessage("p9", "/btw why", entries, 1_000, true)], "Starting Claude Code…")
        ).toBeNull();
        expect(pendingLine([])).toBeNull();
    });
    it("counts no command card as a queued bubble", () => {
        const p = pendingMessage("p4", "/btw why", entries, 1_000, true);
        expect(p.kind).toBe("btw");
        expect(queuedBubbleUp([p])).toBe(false);
    });
    it("records how often the transcript already held the text, and when it was sent", () => {
        const held: AgentEntry[] = [{ kind: "user", text: "again" } as AgentEntry];
        const p = pendingMessage("p5", "again", held, 42, false);
        expect(p.seen).toBe(1);
        expect(p.sentAt).toBe(42);
    });
});

describe("pushSent", () => {
    it("appends, skips a repeat of the newest, and keeps the last 20", () => {
        expect(pushSent(["a"], "b")).toEqual(["a", "b"]);
        expect(pushSent(["a", "b"], "b")).toEqual(["a", "b"]);
        expect(pushSent(["a", "b"], "a")).toEqual(["a", "b", "a"]);
        let h: string[] = [];
        for (let i = 0; i < 25; i++) {
            h = pushSent(h, `m${i}`);
        }
        expect(h).toHaveLength(20);
        expect(h[0]).toBe("m5");
        expect(h[19]).toBe("m24");
    });
});

describe("recall", () => {
    const h = ["one", "two", "three"];
    it("goes up from nothing to the newest, then back through the older ones", () => {
        const a = recall(h, null, "up");
        expect(a).toEqual({ at: 2, text: "three" });
        const b = recall(h, a.at, "up");
        expect(b).toEqual({ at: 1, text: "two" });
        expect(recall(h, 0, "up")).toEqual({ at: 0, text: "one" });
    });
    it("goes down and from the newest to empty", () => {
        expect(recall(h, 0, "down")).toEqual({ at: 1, text: "two" });
        expect(recall(h, 2, "down")).toEqual({ at: null, text: "" });
        expect(recall(h, null, "down")).toEqual({ at: null, text: "" });
    });
    it("with no history stays empty", () => {
        expect(recall([], null, "up")).toEqual({ at: null, text: "" });
    });
});

describe("isSendNowKey", () => {
    const k = (over: Partial<Parameters<typeof isSendNowKey>[0]> = {}) => ({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...over,
    });
    it("is Ctrl+Enter, and Cmd+Enter on a Mac", () => {
        expect(isSendNowKey(k({ ctrlKey: true }), false)).toBe(true);
        expect(isSendNowKey(k({ metaKey: true }), true)).toBe(true);
        expect(isSendNowKey(k({ metaKey: true }), false)).toBe(false);
        expect(isSendNowKey(k({ ctrlKey: true }), true)).toBe(false);
    });
    it("is not a plain Enter, nor one with Shift or Alt held too", () => {
        expect(isSendNowKey(k(), false)).toBe(false);
        expect(isSendNowKey(k({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
        expect(isSendNowKey(k({ ctrlKey: true, altKey: true }), false)).toBe(false);
        expect(isSendNowKey(k({ key: "s", ctrlKey: true }), false)).toBe(false);
    });
});

describe("sendHold", () => {
    it("names why a send waits", () => {
        expect(sendHold(true, false)).toBe("Answer the permission prompt first");
        expect(sendHold(false, true)).toBe("Answer Claude's question first");
        expect(sendHold(true, true)).toBe("Answer the permission prompt first");
        expect(sendHold(false, false)).toBeNull();
    });
});

describe("holdLine", () => {
    it("says what to answer and that Send queues, then that the queued message waits", () => {
        const hold = sendHold(false, true);
        expect(holdLine(hold, false)).toBe("Answer Claude's question first · Send queues your message");
        expect(holdLine(hold, true)).toBe("Queued · sends once you answer");
    });

    it("draws nothing when no prompt holds the send", () => {
        expect(holdLine(null, false)).toBeNull();
        expect(holdLine(null, true)).toBeNull();
    });
});

describe("releasesHeld", () => {
    it("sends a queued message once the prompt is answered and the box can send", () => {
        expect(releasesHeld(true, null, true)).toBe(true);
    });

    it("keeps it while the prompt is up or the box cannot send, and has nothing to send unqueued", () => {
        expect(releasesHeld(true, "Answer the permission prompt first", false)).toBe(false);
        expect(releasesHeld(true, null, false)).toBe(false);
        expect(releasesHeld(false, null, true)).toBe(false);
    });
});

describe("pendsAsBubble", () => {
    it("is true for a message, false for a /command (the projection draws it as a command entry, never your bubble)", () => {
        expect(pendsAsBubble("hello")).toBe(true);
        expect(pendsAsBubble("use src/app and/or lib")).toBe(true);
        expect(pendsAsBubble("/compact")).toBe(false);
        expect(pendsAsBubble("  /model opus\n")).toBe(false);
    });

    it("is true for a side question and a bare panel command, which the chat shows until their row lands", () => {
        expect(pendsAsBubble("/btw which file?")).toBe(true);
        expect(pendsAsBubble("/config")).toBe(true);
        expect(pendsAsBubble("/btw")).toBe(false);
    });

    // Claude Code writes a `! cmd`'s row only once it finishes (or goes to the background at 120 s)
    it("is true for a `! cmd`, which shows nothing in the transcript while it runs; false for a bare !", () => {
        expect(pendsAsBubble("! ls")).toBe(true);
        expect(pendsAsBubble("!git status")).toBe(true);
        expect(pendsAsBubble("!")).toBe(false);
        expect(pendsAsBubble("!  ")).toBe(false);
        expect(pendsAsBubble("great!")).toBe(true);
    });
});

describe("pastesBody", () => {
    it("pastes a message with a line break, or one longer than a typed line", () => {
        expect(pastesBody(["one", "two"].join("\n"))).toBe(true);
        expect(pastesBody("x".repeat(PASTE_OVER + 1))).toBe(true);
        expect(pastesBody("x".repeat(PASTE_OVER))).toBe(false);
        expect(pastesBody("hello")).toBe(false);
    });
});

// Claude Code reads "\r" as Enter only when it arrives as its own chunk: "text\r" in one write is one text token, its "\r"
// a line break in the box, and the message sat unsent (seen with a 165-character line from Chat)
describe("submitSteps", () => {
    it("types a short line, then presses Enter on its own once the box shows it", () => {
        expect(submitSteps("máy windows đang chạy PREREG")).toEqual([
            { kind: "type", text: "máy windows đang chạy PREREG" },
            { kind: "wait", ms: 80, echo: "máy windows đang chạy PREREG" },
            { kind: "enter" },
        ]);
    });

    it("pastes a message with a line break or a long one, then Enter on its own", () => {
        const long = "x".repeat(PASTE_OVER + 1);
        expect(submitSteps("one\ntwo")[0]).toEqual({ kind: "paste", text: "one\ntwo" });
        expect(submitSteps(long)).toEqual([
            { kind: "paste", text: long },
            { kind: "wait", ms: submitDelayMs(long.length), echo: long },
            { kind: "enter" },
        ]);
    });

    it("never sends Enter in the same write as text", () => {
        for (const text of ["/clear", "continue", "! ls", "a\nb", "x".repeat(5000)]) {
            for (const step of submitSteps(text)) {
                if (step.kind === "type" || step.kind === "paste") {
                    expect(step.text.includes("\r")).toBe(false);
                }
            }
        }
    });

    it("presses Enter alone for an empty line", () => {
        expect(submitSteps("")).toEqual([{ kind: "enter" }]);
    });
});

describe("submitDelayMs", () => {
    it("waits at least the keystroke gap, more for a long paste, never past the cap", () => {
        expect(submitDelayMs(5)).toBe(80);
        expect(submitDelayMs(20_000)).toBeGreaterThan(submitDelayMs(2_000));
        expect(submitDelayMs(10_000_000)).toBe(600);
    });
});
