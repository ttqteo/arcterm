import { describe, expect, it } from "vitest";
import { petErrandState, resolveDestination } from "./peterrandmodel";

const harnesses: HarnessInfo[] = [
    { runtime: "claude", label: "Claude Code", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
    { runtime: "codex", label: "Codex", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
    { runtime: "opencode", label: "OpenCode", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
];

describe("petErrandState", () => {
    it("locks both controls when there is no channel", () => {
        expect(
            petErrandState({
                channel: false,
                draft: "ask",
                busy: false,
                runtime: "opencode",
                saving: false,
                harnesses,
            })
        ).toEqual({
            inputDisabled: true,
            submitDisabled: true,
            reason: "no channel active",
            runtime: "opencode",
        });
    });

    it("locks both controls while a reply is streaming", () => {
        expect(
            petErrandState({
                channel: true,
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
                channel: true,
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
                channel: true,
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
                channel: true,
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
                channel: true,
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
                channel: true,
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

// The composer used to read the Jarvis surface's activeChannelAtom, which nothing sets at boot: primeChannels
// fetches the channel list without selecting, and the surface's first neutral entry lands on Briefing. So on a
// fresh launch the field was dead on every surface until the user visited Jarvis and clicked a channel. A
// creature reachable from everywhere cannot depend on a surface the user may never open.
describe("resolveDestination", () => {
    // deliberately NOT in createdts order: the fallback must not depend on how the backend happened to
    // sort the list. A cockpit accumulates per-task channels, so an arbitrary first pick lands the reply
    // in a months-old test channel.
    const channels = [
        { oid: "c1", name: "wave-core", createdts: 300 },
        { oid: "c2", name: "jarvis", createdts: 100 },
        { oid: "c3", name: "stale-e2e-50701", createdts: 200 },
    ] as Channel[];

    it("is never empty while a channel exists, even with nothing selected anywhere", () => {
        expect(resolveDestination({ picked: null, active: null, channels })?.name).toBe("wave-core");
    });

    it("falls back to the most recently created channel, not to list order", () => {
        const oldestFirst = [...channels].sort((a, b) => a.createdts - b.createdts);
        expect(resolveDestination({ picked: null, active: null, channels: oldestFirst })?.name).toBe("wave-core");
        expect(oldestFirst[0].name).toBe("jarvis");
    });

    it("follows the surface's selection when the panel has no opinion of its own", () => {
        expect(resolveDestination({ picked: null, active: "c2", channels })?.name).toBe("jarvis");
    });

    it("lets the panel's own pick beat the surface, so changing it here sticks", () => {
        expect(resolveDestination({ picked: "c1", active: "c2", channels })?.name).toBe("wave-core");
    });

    it("falls back rather than going dead when a remembered pick no longer exists", () => {
        expect(resolveDestination({ picked: "gone", active: "c2", channels })?.name).toBe("jarvis");
        expect(resolveDestination({ picked: "gone", active: "also-gone", channels })?.name).toBe("wave-core");
    });

    it("is null only when there is genuinely nowhere to send", () => {
        expect(resolveDestination({ picked: "c1", active: "c1", channels: [] })).toBeNull();
        expect(resolveDestination({ picked: null, active: null, channels: null })).toBeNull();
    });
});
