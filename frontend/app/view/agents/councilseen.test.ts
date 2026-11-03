import { describe, expect, it } from "vitest";
import type { ReplyPost, ThreadItem, TypingRow } from "./councilchatmodel";
import { ANSWERING } from "./councilmodel";
import { SEEN_AFTER_MS, sendState, shownItems, TYPING_AFTER_MS } from "./councilseen";

const SENT = 50_000;

const mine = (id: string, pending = ANSWERING): ReplyPost =>
    ({ kind: "reply", id, mine: true, pending, ts: SENT, author: "you", name: "You", tone: "you" }) as ReplyPost;
const seat = (id: string): ReplyPost =>
    ({ kind: "reply", id, mine: false, pending: "", ts: SENT + 3_000, author: "ux", name: "UX" }) as ReplyPost;
const typing = (author: string, waiting = false): TypingRow => ({
    kind: "typing",
    id: `typing:${author}`,
    author,
    name: author.toUpperCase(),
    initials: author.slice(0, 2).toUpperCase(),
    tone: "conn-1",
    tag: "expert",
    tab: "",
    text: waiting ? `Waiting for ${author} to finish its task` : `${author.toUpperCase()} is writing…`,
    waiting,
    on: "",
    proposalid: "P1",
});

describe("sendState", () => {
    it("says nothing with no post of the person's waiting for an answer", () => {
        expect(sendState([], SENT)).toEqual({ status: null, holdTyping: false, nextMs: 0 });
        expect(sendState([seat("r2"), typing("ux")], SENT).status).toBeNull();
        // a post that waits on something else keeps saying so under itself, with no Sent or Seen
        expect(sendState([mine("r1", "Queued for the next step"), typing("ux")], SENT + 5_000)).toEqual({
            status: null,
            holdTyping: false,
            nextMs: 0,
        });
    });

    it("reads Sent at first, holding the typing bubbles, and comes back when Seen is due", () => {
        const s = sendState([mine("r1"), typing("ux")], SENT + 300);
        expect(s).toEqual({
            status: { postId: "r1", word: "Sent", seen: [] },
            holdTyping: true,
            nextMs: SEEN_AFTER_MS - 300,
        });
    });

    it("reads Seen with the seats at work a second after the send, then lets their bubbles show", () => {
        const items = [mine("r1"), typing("ux"), typing("ram")];
        const seen = sendState(items, SENT + SEEN_AFTER_MS + 100);
        expect(seen.status).toMatchObject({ postId: "r1", word: "Seen" });
        expect(seen.status!.seen.map((w) => w.author)).toEqual(["ux", "ram"]);
        expect(seen).toMatchObject({ holdTyping: true, nextMs: TYPING_AFTER_MS - SEEN_AFTER_MS - 100 });
        expect(sendState(items, SENT + TYPING_AFTER_MS)).toMatchObject({ holdTyping: false, nextMs: 0 });
    });

    it("stays Sent while no seat is at work on it, however long", () => {
        expect(sendState([mine("r1")], SENT + 60_000)).toEqual({
            status: { postId: "r1", word: "Sent", seen: [] },
            holdTyping: false,
            nextMs: 0,
        });
        // a seat waiting on its own agent has not seen it
        expect(sendState([mine("r1"), typing("witness", true)], SENT + 60_000).status?.word).toBe("Sent");
    });

    it("goes once a seat answers, and sits only under the newest of the person's posts", () => {
        expect(sendState([mine("r1"), seat("r2"), typing("ram")], SENT + 5_000).status).toBeNull();
        const later = { ...mine("r3"), ts: SENT + 10_000 };
        expect(sendState([mine("r1"), seat("r2"), later], SENT + 10_200).status?.postId).toBe("r3");
    });

    it("counts from the send even when the clock reads earlier than it", () => {
        expect(sendState([mine("r1"), typing("ux")], SENT - 500)).toMatchObject({
            holdTyping: true,
            nextMs: SEEN_AFTER_MS,
        });
    });
});

describe("shownItems", () => {
    it("leaves the typing bubbles out while they wait, and never a seat's wait", () => {
        const items: ThreadItem[] = [mine("r1"), typing("ux"), typing("witness", true)];
        expect(shownItems(items, true).map((i) => i.id)).toEqual(["r1", "typing:witness"]);
        expect(shownItems(items, false)).toEqual(items);
    });
});
