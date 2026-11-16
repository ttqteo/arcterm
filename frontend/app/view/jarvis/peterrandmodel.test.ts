import { describe, expect, it } from "vitest";
import { errandReplyShown, petErrandState, resolveDestination } from "./peterrandmodel";
import { NO_FOLDER_DEST } from "./petstore";

const harnesses: HarnessInfo[] = [
    { runtime: "claude", label: "Claude Code", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
    { runtime: "codex", label: "Codex", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
    { runtime: "opencode", label: "OpenCode", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
];

describe("petErrandState", () => {
    // a destination always exists (No folder), so the field is never disabled for want of a channel
    it("never disables the field for want of a channel: an idle composer with a draft is open", () => {
        const state = petErrandState({
            draft: "ask",
            busy: false,
            runtime: "opencode",
            saving: false,
            harnesses,
        });
        expect(state.inputDisabled).toBe(false);
        expect(state.reason).not.toBe("no channel active");
    });

    it("locks both controls while a reply is streaming", () => {
        expect(
            petErrandState({
                draft: "ask",
                busy: true,
                runtime: "opencode",
                saving: false,
                harnesses,
            })
        ).toEqual({
            inputDisabled: true,
            submitDisabled: true,
            reason: "busy",
            runtime: "opencode",
        });
    });

    it("keeps an empty draft editable while blocking only submission", () => {
        expect(
            petErrandState({
                draft: "  ",
                busy: false,
                runtime: "opencode",
                saving: false,
                harnesses,
            })
        ).toEqual({
            inputDisabled: false,
            submitDisabled: true,
            reason: "empty draft",
            runtime: "opencode",
        });
    });

    it("keeps the draft editable while the harness choice is unresolved", () => {
        expect(
            petErrandState({
                draft: "ask",
                busy: false,
                runtime: "",
                saving: false,
                harnesses,
            })
        ).toEqual({
            inputDisabled: false,
            submitDisabled: true,
            reason: "Choose a harness",
            runtime: "",
        });

        const notInstalled = harnesses.map((h) => (h.runtime === "opencode" ? { ...h, installed: false } : h));
        expect(
            petErrandState({
                draft: "ask",
                busy: false,
                runtime: "opencode",
                saving: false,
                harnesses: notInstalled,
            })
        ).toEqual({
            inputDisabled: false,
            submitDisabled: true,
            reason: "Choose a harness",
            runtime: "opencode",
        });
    });

    it("keeps the draft editable while the harness preference is saving", () => {
        expect(
            petErrandState({
                draft: "ask",
                busy: false,
                runtime: "opencode",
                saving: true,
                harnesses,
            })
        ).toEqual({
            inputDisabled: false,
            submitDisabled: true,
            reason: "saving harness preference…",
            runtime: "opencode",
        });
    });

    it("enables both controls for a non-empty draft and valid harness", () => {
        expect(
            petErrandState({
                draft: "ask",
                busy: false,
                runtime: "opencode",
                saving: false,
                harnesses,
            })
        ).toEqual({
            inputDisabled: false,
            submitDisabled: false,
            reason: null,
            runtime: "opencode",
        });
    });
});

// The composer must work from every surface and from a fresh launch, with no project registered yet, so it cannot
// wait on a channel the person may never pick: the destination is always something. No folder is the default; a
// project channel is only ever the person's own pick in the panel (spec D8). Neither the Jarvis surface's
// selection nor the newest channel decides it any more — the reply used to land in whichever channel happened to
// be newest, which was reliably a months-old per-task one.
describe("resolveDestination", () => {
    const channels = [
        { oid: "c1", name: "wave-core", createdts: 300 },
        { oid: "c2", name: "jarvis", createdts: 100 },
        { oid: "c3", name: "stale-e2e-50701", createdts: 200 },
    ] as Channel[];
    const noFolder = { kind: "no-folder" };

    it("starts at No folder with nothing picked, even while channels exist", () => {
        expect(resolveDestination({ picked: null, channels })).toEqual(noFolder);
    });

    it("reads the NO_FOLDER_DEST sentinel as No folder", () => {
        expect(resolveDestination({ picked: NO_FOLDER_DEST, channels })).toEqual(noFolder);
    });

    it("is a live pick's channel, whichever channel is newest", () => {
        const dest = resolveDestination({ picked: "c2", channels });
        expect(dest).toEqual({ kind: "channel", channel: channels[1] });
        expect(resolveDestination({ picked: "c1", channels })).toEqual({ kind: "channel", channel: channels[0] });
    });

    it("falls back to No folder, not to another channel, when a remembered pick no longer exists", () => {
        expect(resolveDestination({ picked: "gone", channels })).toEqual(noFolder);
    });

    it("is No folder when there is no channel list yet or an empty one, so Ask works before any project exists", () => {
        expect(resolveDestination({ picked: null, channels: null })).toEqual(noFolder);
        expect(resolveDestination({ picked: null, channels: [] })).toEqual(noFolder);
        expect(resolveDestination({ picked: "c1", channels: [] })).toEqual(noFolder);
        expect(resolveDestination({ picked: "c1", channels: null })).toEqual(noFolder);
    });
});

// A routing reply whose model sent the verdict block and no prose has nothing visible left once the block is
// stripped. Under a chooser card that would be an empty "replied" box, so the card stands alone.
describe("errandReplyShown", () => {
    const errand = (status: "streaming" | "done" | "error", text: string) => ({ status, text });

    it("shows nothing without an errand", () => {
        expect(errandReplyShown(null, false)).toBe(false);
        expect(errandReplyShown(null, true)).toBe(false);
    });

    it("shows a reply that has text, with or without a card", () => {
        expect(errandReplyShown(errand("done", "Two agents are open in wave-core."), true)).toBe(true);
        expect(errandReplyShown(errand("done", "It is the retry loop."), false)).toBe(true);
    });

    it("hides a finished, blank reply only while a card is up", () => {
        expect(errandReplyShown(errand("done", "  \n"), true)).toBe(false);
        expect(errandReplyShown(errand("done", ""), false)).toBe(true);
    });

    it("always shows one in flight or failed, blank or not: those carry the status", () => {
        expect(errandReplyShown(errand("streaming", ""), true)).toBe(true);
        expect(errandReplyShown(errand("error", ""), true)).toBe(true);
    });
});
