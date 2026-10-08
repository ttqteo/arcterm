import { describe, expect, it } from "vitest";
import {
    agentVMFromInput,
    aggregateEditBurst,
    answerHint,
    applyAgentOrder,
    askingCount,
    askingLabel,
    askSentKey,
    buildAskAnswers,
    burstRenderMode,
    canSubmitAsk,
    conversationText,
    cycleId,
    deriveTerminalVMs,
    detailExceedsInline,
    detailLineCount,
    displayAgeMs,
    focusedAskId,
    formatAge,
    formatAgeShort,
    formatAgo,
    formatReset,
    formatTokens,
    groupAgents,
    groupTimeline,
    hasAnswerableAsk,
    isAskStale,
    isEditAction,
    isNearBottom,
    isQuiet,
    isRecentlyIdle,
    latestMessageText,
    liveWindowAgents,
    mergeOrder,
    mergePendingLaunches,
    moveCursor,
    nextAskId,
    nextUnansweredQuestion,
    partitionBackgrounded,
    pendingToVM,
    providerPlanUsage,
    recentActions,
    sortAgents,
    STICK_THRESHOLD_PX,
    streamableTranscriptAgents,
    summarizeActions,
    syncCardOrder,
    taskProgress,
    terminalName,
    toggleSelection,
    usageLevel,
    withAsk,
    type AgentActionEntry,
    type AgentAskQuestion,
    type AgentEntry,
    type AgentVM,
    type CardTask,
    type LiveAgentInput,
    type PendingLaunch,
} from "./agentsviewmodel";

const mk = (id: string, state: AgentVM["state"], extra: Partial<AgentVM> = {}): AgentVM => ({
    id,
    name: id,
    task: "",
    state,
    ...extra,
});

describe("liveWindowAgents", () => {
    it("keeps active (asking/working) agents and drops idle ones (an idle agent's usage is a frozen snapshot)", () => {
        const agents = [mk("a", "asking"), mk("b", "working"), mk("c", "idle")];
        expect(liveWindowAgents(agents).map((a) => a.id)).toEqual(["a", "b"]);
    });
});

describe("sortAgents", () => {
    it("orders asking before working before idle", () => {
        const out = sortAgents([mk("a", "idle"), mk("b", "working"), mk("c", "asking")]);
        expect(out.map((a) => a.id)).toEqual(["c", "b", "a"]);
    });
    it("within asking, longest-blocked first", () => {
        const out = sortAgents([mk("a", "asking", { blockedMs: 60_000 }), mk("b", "asking", { blockedMs: 240_000 })]);
        expect(out.map((a) => a.id)).toEqual(["b", "a"]);
    });
    it("does not mutate the input array", () => {
        const input = [mk("a", "idle"), mk("b", "asking")];
        sortAgents(input);
        expect(input.map((a) => a.id)).toEqual(["a", "b"]);
    });
});

describe("isNearBottom", () => {
    it("true at the exact bottom", () => {
        expect(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
    });
    it("false when scrolled up beyond the threshold", () => {
        expect(isNearBottom({ scrollTop: 500, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
    });
    it("true within the threshold of the bottom", () => {
        // distance = 1000 - 790 - 200 = 10 < 24
        expect(isNearBottom({ scrollTop: 790, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
    });
    it("false exactly at the threshold distance (check is strict <)", () => {
        // distance = 1000 - 776 - 200 = 24, not < 24
        expect(isNearBottom({ scrollTop: 776, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
    });
    it("respects an explicit threshold override", () => {
        // distance = 100; near at threshold 200, not near at threshold 50
        expect(isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 200 }, 200)).toBe(true);
        expect(isNearBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 200 }, 50)).toBe(false);
    });
    it("exposes the default threshold used by the narration card", () => {
        expect(STICK_THRESHOLD_PX).toBe(24);
    });
});

describe("burstRenderMode", () => {
    it("animates a burst the user explicitly expanded", () => {
        expect(burstRenderMode({ userOpened: true, autoOpen: false })).toBe("reveal");
    });
    it("renders the collapsed summary when neither open", () => {
        expect(burstRenderMode({ userOpened: false, autoOpen: false })).toBe("collapsed");
    });
    it("renders the auto-open trailing burst plain (no animation) during streaming", () => {
        expect(burstRenderMode({ userOpened: false, autoOpen: true })).toBe("open");
    });
    it("keeps the streaming path un-animated even if the burst was also user-opened (anti-strobe)", () => {
        expect(burstRenderMode({ userOpened: true, autoOpen: true })).toBe("open");
    });
});

describe("askingCount", () => {
    it("counts only asking agents", () => {
        expect(askingCount([mk("a", "asking"), mk("b", "working"), mk("c", "asking")])).toBe(2);
    });
    it("is zero when none are asking", () => {
        expect(askingCount([mk("a", "idle"), mk("b", "working")])).toBe(0);
    });
});

describe("groupAgents", () => {
    it("splits into asking/working/idle, each sorted", () => {
        const s = groupAgents([
            mk("a", "idle"),
            mk("b", "asking", { blockedMs: 1_000 }),
            mk("c", "working"),
            mk("d", "asking", { blockedMs: 9_000 }),
        ]);
        expect(s.asking.map((a) => a.id)).toEqual(["d", "b"]);
        expect(s.working.map((a) => a.id)).toEqual(["c"]);
        expect(s.idle.map((a) => a.id)).toEqual(["a"]);
    });
});

describe("formatAge", () => {
    it("under a minute is 'just now'", () => {
        expect(formatAge(5_000)).toBe("just now");
        expect(formatAge(undefined)).toBe("just now");
    });
    it("minutes then hours", () => {
        expect(formatAge(240_000)).toBe("4m");
        expect(formatAge(7_200_000)).toBe("2h");
    });
    it("rolls over to days past 24h rather than counting hours forever", () => {
        // a record last touched 8 days ago read as "192h"
        expect(formatAge(86_400_000)).toBe("1d");
        expect(formatAge(8 * 86_400_000)).toBe("8d");
    });
    it("keeps hours right up to the boundary", () => {
        expect(formatAge(23 * 3_600_000)).toBe("23h");
    });
});

describe("formatAgeShort", () => {
    it("reads under a minute as '<1m' and otherwise as formatAge", () => {
        expect(formatAgeShort(5_000)).toBe("<1m");
        expect(formatAgeShort(undefined)).toBe("<1m");
        expect(formatAgeShort(240_000)).toBe("4m");
    });
});

describe("displayAgeMs", () => {
    it("reads blockedMs for an asking agent — the bug was rendering activeMs, which is undefined there", () => {
        // withAsk clears activeMs and sets blockedMs, so an activeMs reader showed "just now" forever
        const a = mk("a", "asking", { blockedMs: 25 * 60_000, activeMs: undefined });
        expect(displayAgeMs(a)).toBe(25 * 60_000);
        expect(formatAge(displayAgeMs(a))).toBe("25m");
    });
    it("reads activeMs for a working agent", () => {
        expect(displayAgeMs(mk("a", "working", { activeMs: 240_000 }))).toBe(240_000);
    });
    it("derives an idle agent's age from idleSince, which is a stamp rather than a duration", () => {
        const a = mk("a", "idle", { idleSince: 1_000_000 - 7_200_000 });
        expect(formatAge(displayAgeMs(a, 1_000_000))).toBe("2h");
    });
    it("falls back to no age for idle when the caller has no clock", () => {
        expect(displayAgeMs(mk("a", "idle", { idleSince: 1 }))).toBeUndefined();
    });
    it("stays undefined when the state's own field is absent, rather than borrowing another state's", () => {
        expect(displayAgeMs(mk("a", "asking", { activeMs: 999_000 }))).toBeUndefined();
    });
});

describe("agentVMFromInput", () => {
    const NOW = 1_000_000;

    it("reads the linked initiative's id off its oref", () => {
        const vm = agentVMFromInput({ id: "tab-9", name: "x", status: "idle", effortORef: "effort:e1" }, NOW);
        expect(vm.effortId).toBe("e1");
        expect(agentVMFromInput({ id: "tab-9", name: "x", status: "idle" }, NOW).effortId).toBeUndefined();
    });

    it("carries the /login email the agent's session started on, only when it has one", () => {
        const vm = agentVMFromInput({ id: "tab-9", name: "x", status: "idle", loginEmail: "old@x.io" }, NOW);
        expect(vm.loginEmail).toBe("old@x.io");
        expect(
            agentVMFromInput({ id: "tab-9", name: "x", status: "idle", loginEmail: "" }, NOW).loginEmail
        ).toBeUndefined();
    });

    it("maps a working row: status->working, model label, activeMs from ts", () => {
        const input: LiveAgentInput = {
            id: "tab-1",
            name: "waveterm",
            status: "working",
            detail: "go test ./pkg/wconfig/…",
            model: "claude-sonnet-4-6",
            ts: NOW - 120_000,
            transcriptPath: "/p/t.jsonl",
        };
        expect(agentVMFromInput(input, NOW)).toEqual({
            id: "tab-1",
            name: "waveterm",
            task: "",
            state: "working",
            model: "sonnet",
            activity: "go test ./pkg/wconfig/…",
            activeMs: 120_000,
            transcriptPath: "/p/t.jsonl",
        });
    });

    it("maps a waiting row (a permission prompt or other input request) to asking", () => {
        const input: LiveAgentInput = {
            id: "tab-2",
            name: "loom",
            status: "waiting",
            model: "claude-opus-4-8",
            ts: NOW - 240_000,
        };
        const vm = agentVMFromInput(input, NOW);
        expect(vm.state).toBe("asking");
        expect(vm.blockedMs).toBe(240_000);
        expect(vm.activeMs).toBeUndefined();
        expect(vm.atPrompt).toBe(true);
        expect(vm.model).toBe("opus");
    });

    it("carries the agent identity through to the vm (drives projector selection)", () => {
        const vm = agentVMFromInput({ id: "tab-c", name: "siem", status: "working", agent: "codex", ts: NOW }, NOW);
        expect(vm.agent).toBe("codex");
    });

    it("maps anything else to idle, with no age field, and tolerates a missing ts", () => {
        const vm = agentVMFromInput(
            { id: "tab-3", name: "obsidian", status: "idle", detail: "stopped without asking" },
            NOW
        );
        expect(vm.state).toBe("idle");
        expect(vm.activeMs).toBeUndefined();
        expect(vm.blockedMs).toBeUndefined();
        expect(vm.activity).toBe("stopped without asking");
        expect(vm.model).toBe("");
        expect(vm.idleSince).toBeUndefined();
    });

    it("stamps idleSince from ts for an idle row", () => {
        const vm = agentVMFromInput({ id: "tab-3", name: "obsidian", status: "idle", ts: NOW - 30_000 }, NOW);
        expect(vm.idleSince).toBe(NOW - 30_000);
    });

    it("carries the terminal blockId", () => {
        const vm = agentVMFromInput({ id: "tab-1", name: "x", status: "working", blockId: "uuid-1" }, NOW);
        expect(vm.blockId).toBe("uuid-1");
    });

    it("carries the launch project name through to the vm (so grouping uses it, not the lossy transcript-path derivation)", () => {
        const vm = agentVMFromInput(
            { id: "tab-w", name: "waveterm", status: "working", project: "waveterm", ts: NOW },
            NOW
        );
        expect(vm.project).toBe("waveterm");
    });

    it("marks a waiting or idle row as at its prompt, and a working one not", () => {
        expect(agentVMFromInput({ id: "t", name: "a", status: "waiting", ts: 1000 }, 2000).atPrompt).toBe(true);
        expect(agentVMFromInput({ id: "t", name: "a", status: "idle", ts: 1000 }, 2000).atPrompt).toBe(true);
        expect(agentVMFromInput({ id: "t", name: "a", status: "working", ts: 1000 }, 2000).atPrompt).toBeUndefined();
    });

    it("keeps the step an idle turn or a question stopped on, and drops it once the agent works or hits a prompt", () => {
        expect(agentVMFromInput({ id: "t", name: "a", status: "idle", step: "1/3" }, 2000).step).toBe("1/3");
        expect(agentVMFromInput({ id: "t", name: "a", status: "working", step: "1/3" }, 2000).step).toBeUndefined();
        expect(agentVMFromInput({ id: "t", name: "a", status: "asking", step: "1/3" }, 2000).step).toBe("1/3");
        expect(agentVMFromInput({ id: "t", name: "a", status: "waiting", step: "1/3" }, 2000).step).toBeUndefined();
        expect(agentVMFromInput({ id: "t", name: "a", status: "idle" }, 2000).step).toBeUndefined();
    });
});

describe("agentVMFromInput status mapping", () => {
    it("maps a waiting row (a permission prompt or other input request) to asking", () => {
        const vm = agentVMFromInput({ id: "t1", name: "a", status: "waiting", ts: 1000 }, 5000);
        expect(vm.state).toBe("asking");
        expect(vm.blockedMs).toBe(4000);
        expect(vm.activeMs).toBeUndefined();
        expect(vm.atPrompt).toBe(true);
    });
    it("maps backend 'asking' (a pending AskUserQuestion) straight to asking, with blockedMs (not idleSince)", () => {
        const vm = agentVMFromInput({ id: "t1", name: "a", status: "asking", ts: 1000 }, 5000);
        expect(vm.state).toBe("asking");
        expect(vm.blockedMs).toBe(4000);
        expect(vm.activeMs).toBeUndefined();
        expect(vm.idleSince).toBeUndefined();
    });
    it("maps 'working' to working and 'idle' to idle", () => {
        expect(agentVMFromInput({ id: "t", name: "a", status: "working", ts: 1000 }, 2000).state).toBe("working");
        expect(agentVMFromInput({ id: "t", name: "a", status: "idle", ts: 1000 }, 2000).state).toBe("idle");
    });
});

describe("withAsk", () => {
    const NOW = 1_000_000;
    const baseWorking = (): AgentVM => ({
        id: "tab-1",
        name: "waveterm",
        task: "",
        state: "working",
        activity: "go test ./…",
        activeMs: 5_000,
    });

    it("flips a working agent to asking, clears activeMs, sets blockedMs from ts, maps questions", () => {
        const ask: AgentAskData = {
            oref: "block:abc",
            askid: "ask-1",
            questions: [
                {
                    question: "Guard the nil case?",
                    header: "Safety",
                    multiselect: false,
                    options: [{ label: "Yes" }, { label: "No", description: "risky" }],
                },
            ],
            ts: NOW - 60_000,
        };
        const vm = withAsk(baseWorking(), ask, NOW);
        expect(vm.state).toBe("asking");
        expect(vm.blockedMs).toBe(60_000);
        expect(vm.activeMs).toBeUndefined();
        expect(vm.ask?.askId).toBe("ask-1");
        expect(vm.ask?.questions).toHaveLength(1);
        expect(vm.ask?.questions[0].question).toBe("Guard the nil case?");
        expect(vm.ask?.questions[0].header).toBe("Safety");
        // multiselect (lowercase Go json tag) maps to multiSelect (camelCase)
        expect(vm.ask?.questions[0].multiSelect).toBe(false);
        expect(vm.ask?.questions[0].options).toEqual([
            { label: "Yes", description: undefined },
            { label: "No", description: "risky" },
        ]);
    });

    it("carries a held command's card as hold", () => {
        const ask: AgentAskData = { oref: "block:abc", askid: "ask-3", ts: NOW, hold: true };
        expect(withAsk(baseWorking(), ask, NOW).ask?.hold).toBe(true);
    });

    it("carries an empty questions array when questions is absent", () => {
        const ask: AgentAskData = { oref: "block:abc", askid: "ask-2", ts: NOW - 10_000 };
        const vm = withAsk(baseWorking(), ask, NOW);
        expect(vm.state).toBe("asking");
        expect(vm.ask?.questions).toEqual([]);
    });

    it("returns the vm unchanged when ask is null or cleared", () => {
        expect(withAsk(baseWorking(), null, NOW)).toEqual(baseWorking());
        const cleared: AgentAskData = { oref: "block:abc", askid: "ask-1", cleared: true };
        expect(withAsk(baseWorking(), cleared, NOW)).toEqual(baseWorking());
    });

    it("carries why an ask came back onto the card", () => {
        const vm = withAsk(
            { id: "t1", name: "loom", task: "", state: "working" } as AgentVM,
            {
                oref: "block:b1",
                askid: "a1",
                questions: [],
                ts: 1_000,
                note: "answer was sent but never confirmed",
            } as AgentAskData,
            2_000
        );
        expect(vm.ask?.note).toBe("answer was sent but never confirmed");
    });
});

describe("buildAskAnswers", () => {
    const q = (multiSelect = false): AgentAskQuestion => ({
        question: "q",
        multiSelect,
        options: [{ label: "a" }, { label: "b" }, { label: "c" }],
    });

    it("emits one answer item per question, indexes sorted ascending", () => {
        const questions = [q(false), q(true)];
        const selections = { 0: new Set([1]), 1: new Set([2, 0]) };
        expect(buildAskAnswers(questions, selections)).toEqual([{ selectedindexes: [1] }, { selectedindexes: [0, 2] }]);
    });

    it("emits empty indexes for an unanswered question", () => {
        expect(buildAskAnswers([q()], {})).toEqual([{ selectedindexes: [] }]);
    });

    it("emits text over selection when a question has free text", () => {
        const questions = [q(), q()];
        const selections = { 0: new Set([1]) };
        const texts = { 1: "  custom answer " };
        expect(buildAskAnswers(questions, selections, texts)).toEqual([
            { selectedindexes: [1] },
            { text: "custom answer" }, // trimmed
        ]);
    });
});

describe("canSubmitAsk", () => {
    const q = (): AgentAskQuestion => ({ question: "q", options: [{ label: "a" }] });

    it("true only when every question has at least one selection", () => {
        expect(canSubmitAsk([q(), q()], { 0: new Set([0]), 1: new Set([0]) })).toBe(true);
        expect(canSubmitAsk([q(), q()], { 0: new Set([0]) })).toBe(false);
        expect(canSubmitAsk([], {})).toBe(false);
    });

    it("accepts a text-only answer and rejects a blank question", () => {
        const questions = [q(), q()];
        expect(canSubmitAsk(questions, { 0: new Set([0]) }, { 1: "typed" })).toBe(true);
        expect(canSubmitAsk(questions, { 0: new Set([0]) }, { 1: "   " })).toBe(false);
    });
});

describe("hasAnswerableAsk", () => {
    it("true when the ask carries at least one question", () => {
        expect(
            hasAnswerableAsk(mk("a", "asking", { ask: { questions: [{ question: "q", options: [{ label: "a" }] }] } }))
        ).toBe(true);
    });
    it("false for an asking agent with no structured ask (plain-text question)", () => {
        expect(hasAnswerableAsk(mk("a", "asking"))).toBe(false);
    });
    it("false when the ask exists but has zero questions", () => {
        expect(hasAnswerableAsk(mk("a", "asking", { ask: { questions: [] } }))).toBe(false);
    });
    it("false for working and idle agents", () => {
        expect(hasAnswerableAsk(mk("a", "working"))).toBe(false);
        expect(hasAnswerableAsk(mk("a", "idle"))).toBe(false);
    });
});

describe("askSentKey", () => {
    it("returns the ask's askId as the answered-ask identity", () => {
        const a = mk("agent-1", "asking", {
            ask: { questions: [{ question: "Q?" }], askId: "ask-1", oref: "block:abc" },
        });
        expect(askSentKey(a)).toBe("ask-1");
    });
    it("distinguishes two successive asks from the same agent (same id, new askId)", () => {
        const ask1 = mk("agent-1", "asking", { ask: { questions: [], askId: "ask-1", oref: "block:abc" } });
        const ask2 = mk("agent-1", "asking", { ask: { questions: [], askId: "ask-2", oref: "block:abc" } });
        expect(askSentKey(ask1)).not.toBe(askSentKey(ask2));
    });
    it("is NOT the block oref (oref is reused across asks)", () => {
        const a = mk("agent-1", "asking", { ask: { questions: [], askId: "ask-1", oref: "block:abc" } });
        expect(askSentKey(a)).not.toBe("block:abc");
    });
    it("is undefined when the agent has no ask", () => {
        expect(askSentKey(mk("agent-1", "working"))).toBeUndefined();
    });
});

describe("isQuiet", () => {
    it("true past the threshold, false within it or when activity is unknown", () => {
        expect(isQuiet(1_000, 1_000 + 46_000)).toBe(true);
        expect(isQuiet(1_000, 1_000 + 10_000)).toBe(false);
        expect(isQuiet(undefined, 99_999)).toBe(false);
    });
});

describe("isRecentlyIdle", () => {
    const NOW = 1_000_000;

    it("true for an idle agent within the grace window", () => {
        expect(isRecentlyIdle(mk("a", "idle", { idleSince: NOW - 60_000 }), NOW)).toBe(true);
    });
    it("false once past the grace window", () => {
        expect(isRecentlyIdle(mk("a", "idle", { idleSince: NOW - 360_000 }), NOW)).toBe(false);
    });
    it("false for non-idle agents regardless of idleSince", () => {
        expect(isRecentlyIdle(mk("a", "working", { idleSince: NOW }), NOW)).toBe(false);
        expect(isRecentlyIdle(mk("a", "asking", { idleSince: NOW }), NOW)).toBe(false);
    });
    it("false when idleSince is missing", () => {
        expect(isRecentlyIdle(mk("a", "idle"), NOW)).toBe(false);
    });
    it("honors a custom grace window (boundary exclusive)", () => {
        expect(isRecentlyIdle(mk("a", "idle", { idleSince: NOW - 1_000 }), NOW, 1_000)).toBe(false);
        expect(isRecentlyIdle(mk("a", "idle", { idleSince: NOW - 999 }), NOW, 1_000)).toBe(true);
    });
});

describe("streamableTranscriptAgents", () => {
    const NOW = 1_000_000;

    it("keeps streams open for rendered recently-idle agents", () => {
        const agents = [
            mk("asking", "asking", { transcriptPath: "/a.jsonl" }),
            mk("working", "working", { transcriptPath: "/w.jsonl" }),
            mk("recent", "idle", { transcriptPath: "/r.jsonl", idleSince: NOW - 30_000 }),
            mk("old", "idle", { transcriptPath: "/o.jsonl", idleSince: NOW - 360_000 }),
            mk("missing", "working"),
        ];

        expect(streamableTranscriptAgents(agents, NOW).map((a) => a.id)).toEqual(["asking", "working", "recent"]);
    });
});

describe("isAskStale", () => {
    it("stale when a materially newer working status shows the agent resumed", () => {
        expect(isAskStale(1_000, 5_000, "working")).toBe(true);
    });
    it("not stale on a sub-second working update: the pi status reporter's message_end + tool_execution_start RPCs race the ask mirror RPC, so a same-instant newer status must not kill a just-rendered card", () => {
        expect(isAskStale(1_000, 1_500, "working")).toBe(false);
    });
    it("not stale on a newer idle status: the pi prose bridge raises its ask at agent_settled, the same moment the status reporter emits settle-idle, so a same-tick idle must not kill the card", () => {
        expect(isAskStale(1_000, 1_010, "idle")).toBe(false);
        expect(isAskStale(1_000, 2_000, "idle")).toBe(false);
    });
    it("not stale while waiting, when status is not newer, or when a ts is missing", () => {
        expect(isAskStale(1_000, 2_000, "waiting")).toBe(false);
        expect(isAskStale(1_000, 1_000, "working")).toBe(false);
        expect(isAskStale(1_000, 500, "working")).toBe(false);
        expect(isAskStale(undefined, 2_000, "working")).toBe(false);
        expect(isAskStale(1_000, undefined, "working")).toBe(false);
    });
});

describe("mergeOrder", () => {
    it("seeds from ids when prev is empty", () => {
        expect(mergeOrder([], ["a", "b"])).toEqual(["a", "b"]);
    });
    it("keeps existing slots even when ids reorders them (the anchor)", () => {
        // 'a' jumped to the front of ids (e.g. it started asking) — it must NOT move slot
        expect(mergeOrder(["a", "b", "c"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    });
    it("appends genuinely-new ids after the kept ones", () => {
        expect(mergeOrder(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    });
    it("drops ids no longer present", () => {
        expect(mergeOrder(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
    });
    it("is a no-op when the set is unchanged", () => {
        expect(mergeOrder(["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
    });
});

describe("syncCardOrder", () => {
    it("keeps every agent's slot while it goes idle and starts again, so the sidebar's Active rows never move", () => {
        const first = syncCardOrder([], [mk("a", "working"), mk("b", "working"), mk("c", "idle")]);
        expect(first).toEqual(["a", "b", "c"]);
        // by the Cockpit's next visit a has gone idle and c has started working
        expect(syncCardOrder(first, [mk("a", "idle"), mk("b", "working"), mk("c", "working")])).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    it("appends a new agent and drops one that left the roster", () => {
        expect(syncCardOrder(["a", "b", "c"], [mk("a", "idle"), mk("c", "asking"), mk("d", "working")])).toEqual([
            "a",
            "c",
            "d",
        ]);
    });
});

describe("applyAgentOrder", () => {
    it("renders current agents even when stored order is empty or stale", () => {
        const active = [mk("a", "working"), mk("b", "asking")];

        expect(applyAgentOrder([], active).map((a) => a.id)).toEqual(["a", "b"]);
        expect(applyAgentOrder(["missing"], active).map((a) => a.id)).toEqual(["a", "b"]);
    });

    it("preserves stored order for ids that still exist", () => {
        const active = [mk("a", "working"), mk("b", "asking"), mk("c", "working")];

        expect(applyAgentOrder(["b"], active).map((a) => a.id)).toEqual(["b", "a", "c"]);
    });
});

describe("nextAskId", () => {
    it("returns the first when current is undefined", () => {
        expect(nextAskId(["x", "y", "z"], undefined)).toBe("x");
    });
    it("advances to the id after current", () => {
        expect(nextAskId(["x", "y", "z"], "x")).toBe("y");
    });
    it("wraps from the last back to the first", () => {
        expect(nextAskId(["x", "y", "z"], "z")).toBe("x");
    });
    it("returns the first when current is no longer present", () => {
        expect(nextAskId(["x", "y", "z"], "gone")).toBe("x");
    });
    it("returns undefined for an empty list", () => {
        expect(nextAskId([], "x")).toBeUndefined();
    });
    it("wraps to itself for a single ask (last one stays put on submit — T2)", () => {
        expect(nextAskId(["only"], "only")).toBe("only");
    });
});

describe("usageLevel", () => {
    it("bands by threshold (boundaries inclusive toward ok/warn)", () => {
        expect(usageLevel(0)).toBe("ok");
        expect(usageLevel(60)).toBe("ok");
        expect(usageLevel(60.1)).toBe("warn");
        expect(usageLevel(85)).toBe("warn");
        expect(usageLevel(85.1)).toBe("hot");
        expect(usageLevel(100)).toBe("hot");
    });
});

describe("formatTokens", () => {
    it("formats by magnitude", () => {
        expect(formatTokens(512)).toBe("512");
        expect(formatTokens(38_000)).toBe("38k");
        expect(formatTokens(142_000)).toBe("142k");
        expect(formatTokens(2_100_000)).toBe("2.1M");
        expect(formatTokens(1_000_000)).toBe("1.0M");
    });
});

describe("formatReset", () => {
    const NOW = 1_000_000_000_000; // ms
    const inMins = (m: number) => Math.floor(NOW / 1000) + m * 60;

    it("'now' at or past the reset", () => {
        expect(formatReset(Math.floor(NOW / 1000), NOW)).toBe("now");
        expect(formatReset(Math.floor(NOW / 1000) - 60, NOW)).toBe("now");
    });
    it("minutes under an hour", () => {
        expect(formatReset(inMins(44), NOW)).toBe("44m");
    });
    it("hours and minutes past an hour", () => {
        expect(formatReset(inMins(131), NOW)).toBe("2h 11m");
        expect(formatReset(inMins(23 * 60 + 59), NOW)).toBe("23h 59m");
    });
    it("days and hours from a day out", () => {
        expect(formatReset(inMins(24 * 60), NOW)).toBe("1d 0h");
        expect(formatReset(inMins(85 * 60 + 57), NOW)).toBe("3d 13h");
    });
});

describe("providerPlanUsage", () => {
    const claude = mk("c", "working", { agent: "claude", usage: { fivehourpct: 42, weekpct: 78 } });
    const codex = mk("x", "working", { agent: "codex", usage: { fivehourpct: 17, weekpct: 57 } });

    it("returns one row per provider, claude before codex", () => {
        const rows = providerPlanUsage([codex, claude]);
        expect(rows.map((r) => r.provider)).toEqual(["claude", "codex"]);
        expect(rows[0].usage.fivehourpct).toBe(42);
        expect(rows[1].usage.weekpct).toBe(57);
    });

    it("returns a row per same-provider agent (no dedup), preserving input order", () => {
        const other = mk("c2", "idle", { agent: "claude", usage: { fivehourpct: 5, weekpct: 5 } });
        const rows = providerPlanUsage([claude, other]);
        expect(rows.map((r) => r.agentId)).toEqual(["c", "c2"]);
        expect(rows[0].usage.fivehourpct).toBe(42);
    });

    it("excludes agents with no rate-limit data (context-only or none)", () => {
        const ctxOnly = mk("k", "working", { agent: "codex", usage: { contextpct: 80 } });
        const bare = mk("b", "working", { agent: "claude" });
        expect(providerPlanUsage([ctxOnly, bare])).toEqual([]);
    });

    it("defaults a missing provider label to claude", () => {
        const rows = providerPlanUsage([mk("u", "working", { usage: { weekpct: 30 } })]);
        expect(rows[0].provider).toBe("claude");
    });

    it("sorts opencode after codex", () => {
        const claude = mk("c", "working", { agent: "claude", usage: { fivehourpct: 10, weekpct: 10 } });
        const codex = mk("x", "working", { agent: "codex", usage: { fivehourpct: 10, weekpct: 10 } });
        const opencode = mk("o", "working", { agent: "opencode", usage: { fivehourpct: 10, weekpct: 10 } });
        const rows = providerPlanUsage([opencode, claude, codex]);
        expect(rows.map((r) => r.provider)).toEqual(["claude", "codex", "opencode"]);
    });
});

describe("providerPlanUsage (no dedup)", () => {
    const mk = (id: string, agent: string, five: number): AgentVM => ({
        id,
        name: id,
        task: "",
        state: "working",
        agent,
        usage: { fivehourpct: five },
    });
    it("returns a row per agent with rate data (does not collapse same-provider agents)", () => {
        const rows = providerPlanUsage([mk("a", "claude", 10), mk("b", "claude", 20), mk("c", "codex", 30)]);
        expect(rows.map((r) => r.agentId)).toEqual(["a", "b", "c"]);
        expect(rows.map((r) => r.provider)).toEqual(["claude", "claude", "codex"]);
    });
    it("skips agents without rate data and sorts claude before codex", () => {
        const noRate: AgentVM = { id: "z", name: "z", task: "", state: "idle", agent: "claude" };
        const rows = providerPlanUsage([mk("c", "codex", 30), noRate, mk("a", "claude", 10)]);
        expect(rows.map((r) => r.agentId)).toEqual(["a", "c"]);
    });
});

describe("latestMessageText", () => {
    it("returns the last message-kind entry's text", () => {
        const entries: AgentEntry[] = [
            { kind: "message", text: "first" },
            { kind: "action", verb: "read", target: "a.ts" },
            { kind: "message", text: "second" },
        ];
        expect(latestMessageText(entries)).toBe("second");
    });
    it("ignores trailing actions and user turns", () => {
        const entries: AgentEntry[] = [
            { kind: "message", text: "hello" },
            { kind: "user", text: "do x" },
            { kind: "action", verb: "ran", target: "go test" },
        ];
        expect(latestMessageText(entries)).toBe("hello");
    });
    it("is undefined when there are no messages", () => {
        expect(latestMessageText([{ kind: "action", verb: "read", target: "a" }])).toBeUndefined();
        expect(latestMessageText([])).toBeUndefined();
    });
});

describe("recentActions", () => {
    const entries: AgentEntry[] = [
        { kind: "action", verb: "read", target: "a" },
        { kind: "message", text: "m" },
        { kind: "action", verb: "edited", target: "b" },
        { kind: "action", verb: "ran", target: "test", outcome: "ok" },
    ];
    it("returns only actions, oldest-first, capped to max", () => {
        expect(recentActions(entries, 2)).toEqual([
            { kind: "action", verb: "edited", target: "b" },
            { kind: "action", verb: "ran", target: "test", outcome: "ok" },
        ]);
    });
    it("returns all actions when max exceeds the count", () => {
        expect(recentActions(entries, 10)).toHaveLength(3);
    });
    it("returns an empty array when there are no actions", () => {
        expect(recentActions([{ kind: "message", text: "x" }], 3)).toEqual([]);
    });
});

describe("moveCursor", () => {
    const ids = ["a", "b", "c"];
    it("moves by one and clamps at both ends (no wrap)", () => {
        expect(moveCursor(ids, "a", 1)).toBe("b");
        expect(moveCursor(ids, "b", -1)).toBe("a");
        expect(moveCursor(ids, "c", 1)).toBe("c");
        expect(moveCursor(ids, "a", -1)).toBe("a");
    });
    it("starts at the first id when current is absent or unknown", () => {
        expect(moveCursor(ids, undefined, 1)).toBe("a");
        expect(moveCursor(ids, "zzz", -1)).toBe("a");
    });
    it("is undefined for an empty list", () => {
        expect(moveCursor([], "a", 1)).toBeUndefined();
    });
});

describe("cycleId", () => {
    it("wraps forward past the end and starts at 0 when current is unknown", () => {
        expect(cycleId(["a", "b", "c"], "c", 1)).toBe("a");
        expect(cycleId(["a", "b", "c"], undefined, 1)).toBe("a");
        expect(cycleId(["a", "b", "c"], "a", 1)).toBe("b");
    });
    it("wraps backward and returns undefined for empty", () => {
        expect(cycleId(["a", "b", "c"], "a", -1)).toBe("c");
        expect(cycleId([], "a", 1)).toBeUndefined();
    });
});

describe("groupTimeline", () => {
    it("leaves a run of two actions inline (no group)", () => {
        const entries: AgentEntry[] = [
            { kind: "message", text: "m" },
            { kind: "action", verb: "read", target: "a" },
            { kind: "action", verb: "read", target: "b" },
        ];
        const items = groupTimeline(entries);
        expect(items.map((i) => i.kind)).toEqual(["message", "action", "action"]);
        expect(items.some((i) => i.kind === "group")).toBe(false);
    });

    it("folds a run of three or more actions into one group keyed by first index", () => {
        const entries: AgentEntry[] = [
            { kind: "message", text: "m" },
            { kind: "action", verb: "read", target: "a" },
            { kind: "action", verb: "read", target: "b" },
            { kind: "action", verb: "grep", target: "c" },
        ];
        const items = groupTimeline(entries);
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({ kind: "message", text: "m", index: 0 });
        const group = items[1];
        expect(group.kind).toBe("group");
        if (group.kind === "group") {
            expect(group.startIndex).toBe(1);
            expect(group.actions).toHaveLength(3);
        }
    });

    it("splits adjacent runs around a message into separate groups", () => {
        const entries: AgentEntry[] = [
            { kind: "action", verb: "read", target: "a" },
            { kind: "action", verb: "read", target: "b" },
            { kind: "action", verb: "read", target: "c" },
            { kind: "message", text: "thinking" },
            { kind: "action", verb: "edit", target: "d" },
            { kind: "action", verb: "edit", target: "e" },
            { kind: "action", verb: "edit", target: "f" },
        ];
        const items = groupTimeline(entries);
        expect(items.map((i) => i.kind)).toEqual(["group", "message", "group"]);
        const g1 = items[0];
        const g2 = items[2];
        if (g1.kind === "group" && g2.kind === "group") {
            expect(g1.startIndex).toBe(0);
            expect(g2.startIndex).toBe(4);
        }
    });

    it("honors an explicit threshold", () => {
        const entries: AgentEntry[] = [
            { kind: "action", verb: "read", target: "a" },
            { kind: "action", verb: "read", target: "b" },
        ];
        expect(groupTimeline(entries, 2).map((i) => i.kind)).toEqual(["group"]);
    });
});

describe("groupTimeline command/compaction", () => {
    it("passes command and compaction through as standalone items, keeping order and flushing runs", () => {
        const entries: AgentEntry[] = [
            { kind: "command", name: "/review", args: "PR #402" },
            { kind: "action", verb: "ran", target: "gh pr diff" },
            { kind: "compaction", trigger: "manual", preTokens: 415334, postTokens: 22859, summary: "kept" },
            { kind: "command", name: "brainstorming", args: "x", isSkill: true },
        ];
        const items = groupTimeline(entries);
        expect(items.map((i) => i.kind)).toEqual(["command", "action", "compaction", "command"]);
        expect(items[0]).toEqual({ kind: "command", name: "/review", args: "PR #402", isSkill: undefined, index: 0 });
        expect(items[2]).toEqual({
            kind: "compaction",
            trigger: "manual",
            preTokens: 415334,
            postTokens: 22859,
            summary: "kept",
            index: 2,
        });
        expect(items[3]).toMatchObject({ kind: "command", name: "brainstorming", isSkill: true, index: 3 });
    });

    it("passes notification and interrupted through as standalone items, flushing runs", () => {
        const entries: AgentEntry[] = [
            { kind: "action", verb: "spawned", target: "worker" },
            { kind: "notification", summary: "worker finished", status: "completed", result: "report body" },
            { kind: "interrupted" },
        ];
        const items = groupTimeline(entries);
        expect(items.map((i) => i.kind)).toEqual(["action", "notification", "interrupted"]);
        expect(items[1]).toEqual({
            kind: "notification",
            summary: "worker finished",
            status: "completed",
            result: "report body",
            index: 1,
        });
        expect(items[2]).toEqual({ kind: "interrupted", index: 2 });
    });
});
describe("summarizeActions", () => {
    const actions: AgentActionEntry[] = [
        { kind: "action", verb: "read", target: "a" },
        { kind: "action", verb: "grep", target: "b" },
        { kind: "action", verb: "read", target: "c" },
        { kind: "action", verb: "read", target: "d" },
        { kind: "action", verb: "edit", target: "e" },
    ];

    it("counts verbs ordered by count desc then first appearance", () => {
        const s = summarizeActions(actions);
        expect(s.total).toBe(5);
        expect(s.byVerb).toEqual([
            { verb: "read", count: 3 },
            { verb: "grep", count: 1 },
            { verb: "edit", count: 1 },
        ]);
    });

    it("aggregates outcome as ok when nothing failed", () => {
        expect(summarizeActions(actions).outcome).toBe("ok");
    });

    it("aggregates outcome as fail when any action failed", () => {
        const withFail: AgentActionEntry[] = [
            { kind: "action", verb: "read", target: "a", outcome: "ok" },
            { kind: "action", verb: "edit", target: "b", outcome: "fail" },
        ];
        expect(summarizeActions(withFail).outcome).toBe("fail");
    });

    it("counts failed actions", () => {
        expect(summarizeActions(actions).failed).toBe(0);
        const mixed: AgentActionEntry[] = [
            { kind: "action", verb: "ran", target: "a", outcome: "fail" },
            { kind: "action", verb: "read", target: "b", outcome: "ok" },
            { kind: "action", verb: "ran", target: "c", outcome: "fail" },
        ];
        expect(summarizeActions(mixed).failed).toBe(2);
        const allFailed: AgentActionEntry[] = [
            { kind: "action", verb: "ran", target: "a", outcome: "fail" },
            { kind: "action", verb: "ran", target: "b", outcome: "fail" },
        ];
        expect(summarizeActions(allFailed).failed).toBe(2);
    });
});

describe("partitionBackgrounded", () => {
    it("splits working agents by the backgrounded id set, preserving order", () => {
        const working = [mk("a", "working"), mk("b", "working"), mk("c", "working")];
        const out = partitionBackgrounded(working, new Set(["b"]));
        expect(out.active.map((x) => x.id)).toEqual(["a", "c"]);
        expect(out.backgrounded.map((x) => x.id)).toEqual(["b"]);
    });
    it("returns all active when the set is empty", () => {
        const working = [mk("a", "working"), mk("b", "working")];
        const out = partitionBackgrounded(working, new Set());
        expect(out.active.map((x) => x.id)).toEqual(["a", "b"]);
        expect(out.backgrounded).toEqual([]);
    });
});

describe("focusedAskId", () => {
    it("is undefined when nothing is asking", () => {
        expect(focusedAskId([], "a")).toBeUndefined();
    });
    it("is the cursor when the cursor is on an ask", () => {
        expect(focusedAskId(["a", "b"], "b")).toBe("b");
    });
    it("falls back to the first ask when the cursor is not an ask", () => {
        expect(focusedAskId(["a", "b"], "z")).toBe("a");
        expect(focusedAskId(["a", "b"], undefined)).toBe("a");
    });
});

describe("toggleSelection", () => {
    it("single-select replaces the prior choice for that question", () => {
        const out = toggleSelection({ 0: new Set([1]) }, 0, 2, false);
        expect([...out[0]]).toEqual([2]);
    });
    it("multi-select adds then removes on repeat", () => {
        const added = toggleSelection({}, 0, 1, true);
        expect([...added[0]]).toEqual([1]);
        const removed = toggleSelection(added, 0, 1, true);
        expect([...removed[0]]).toEqual([]);
    });
    it("does not mutate the previous selections", () => {
        const prev = { 0: new Set([1]) };
        toggleSelection(prev, 0, 2, false);
        expect([...prev[0]]).toEqual([1]);
    });
    it("keeps selections for other questions intact", () => {
        const out = toggleSelection({ 0: new Set([1]), 1: new Set([3]) }, 0, 2, false);
        expect([...out[1]]).toEqual([3]);
    });
});

describe("taskProgress", () => {
    it("taskProgress computes done/total/pct", () => {
        expect(taskProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
        const all: CardTask[] = [
            { text: "a", done: true },
            { text: "b", done: true },
        ];
        expect(taskProgress(all)).toEqual({ done: 2, total: 2, pct: 100 });
        const some: CardTask[] = [
            { text: "a", done: true },
            { text: "b", done: false },
            { text: "c", done: false },
            { text: "d", done: false },
        ];
        expect(taskProgress(some)).toEqual({ done: 1, total: 4, pct: 25 });
    });
});

describe("pendingToVM", () => {
    it("maps a pending launch to a booting working VM with age from now-ts", () => {
        const p: PendingLaunch = {
            tabId: "t1",
            blockId: "b1",
            name: "payments-api",
            project: "payments-api",
            ts: 1000,
        };
        expect(pendingToVM(p, 5000)).toMatchObject({
            id: "t1",
            name: "payments-api",
            task: "",
            state: "working",
            project: "payments-api",
            blockId: "b1",
            activeMs: 4000,
        });
    });
});

describe("mergePendingLaunches", () => {
    const base: AgentVM[] = [{ id: "a", name: "loom", task: "", state: "working" }];

    it("appends a pending launch not present in the base roster", () => {
        const pending: PendingLaunch[] = [
            { tabId: "t1", blockId: "b1", name: "payments-api", project: "payments-api", ts: 0 },
        ];
        const out = mergePendingLaunches(base, pending, 1000);
        expect(out.map((a) => a.id)).toEqual(["a", "t1"]);
        expect(out[1].state).toBe("working");
    });

    it("drops a pending launch once its tabId exists in the base roster (supersede)", () => {
        const real: AgentVM[] = [{ id: "t1", name: "payments-api", task: "", state: "working" }];
        const pending: PendingLaunch[] = [
            { tabId: "t1", blockId: "b1", name: "payments-api", project: "payments-api", ts: 0 },
        ];
        const out = mergePendingLaunches(real, pending, 1000);
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe("t1");
    });

    it("returns the base unchanged when there are no pending launches", () => {
        expect(mergePendingLaunches(base, [], 1000)).toHaveLength(1);
    });
});

describe("deriveTerminalVMs", () => {
    type Row = {
        tabId: string;
        label: string;
        termBlockOref?: string;
        isAgentsTab?: boolean;
        agent?: string;
        projectLabel?: string;
        cwd?: string;
        customLabel?: string;
    };
    const none = () => false;

    it("maps a plain terminal session (term block, no agent status) to a terminal VM", () => {
        const rows: Row[] = [{ tabId: "t1", label: "SIEM", termBlockOref: "block:b1", customLabel: "SIEM" }];
        const out = deriveTerminalVMs(rows, none);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            id: "t1",
            name: "SIEM",
            blockId: "b1",
            kind: "terminal",
            agent: "terminal",
            state: "idle",
        });
    });

    it("skips rows that have an agent status (those are real agents)", () => {
        const rows: Row[] = [{ tabId: "t1", label: "loom", termBlockOref: "block:b1" }];
        const out = deriveTerminalVMs(rows, (oref) => oref === "block:b1");
        expect(out).toHaveLength(0);
    });

    it("skips the Agents tab and rows with no term block", () => {
        const rows: Row[] = [
            { tabId: "agents", label: "Agents", termBlockOref: "block:ba", isAgentsTab: true },
            { tabId: "t2", label: "no-term" },
        ];
        expect(deriveTerminalVMs(rows, none)).toHaveLength(0);
    });

    it("skips agent-runtime sessions whose reporter hasn't fired yet (session:agent set, no status)", () => {
        const rows: Row[] = [{ tabId: "t1", label: "waveterm", termBlockOref: "block:b1", agent: "claude" }];
        expect(deriveTerminalVMs(rows, none)).toHaveLength(0);
    });

    it("still maps a real terminal session (no session:agent) to a terminal VM", () => {
        const rows: Row[] = [{ tabId: "t1", label: "waveterm", termBlockOref: "block:b1", agent: undefined }];
        expect(deriveTerminalVMs(rows, none)).toHaveLength(1);
    });

    it("carries the launch-time project (session:project) onto the terminal", () => {
        const rows: Row[] = [{ tabId: "t1", label: "SIEM", termBlockOref: "block:b1", projectLabel: "siem-platform" }];
        expect(deriveTerminalVMs(rows, none)[0].project).toBe("siem-platform");
    });

    it("prefers the registry's project for the terminal's cwd over the launch-time label", () => {
        const rows: Row[] = [
            { tabId: "t1", label: "SIEM", termBlockOref: "block:b1", cwd: "C:\\code\\siem", projectLabel: "old-name" },
        ];
        const out = deriveTerminalVMs(rows, none, (cwd) => (cwd === "C:\\code\\siem" ? "SIEM Platform" : ""));
        expect(out[0].project).toBe("SIEM Platform");
    });

    it("leaves project unset when neither the registry nor the launch label names one", () => {
        const rows: Row[] = [
            { tabId: "t1", label: "sh", termBlockOref: "block:b1", cwd: "~" },
            { tabId: "t2", label: "sh", termBlockOref: "block:b2", projectLabel: "   " },
        ];
        const out = deriveTerminalVMs(rows, none, () => "");
        expect(out.map((t) => t.project)).toEqual([undefined, undefined]);
    });

    it("names two shells of one project by what they last ran, else by their place", () => {
        const rows: Row[] = [
            { tabId: "t1", label: "arcterm", termBlockOref: "block:b1", projectLabel: "arcterm" },
            { tabId: "agent", label: "loom", termBlockOref: "block:ba" },
            { tabId: "t2", label: "arcterm", termBlockOref: "block:b2", projectLabel: "arcterm" },
            { tabId: "t3", label: "arcterm", termBlockOref: "block:b3", customLabel: "logs" },
        ];
        const cmds: Record<string, string> = { b1: "task dev" };
        const out = deriveTerminalVMs(
            rows,
            (oref) => oref === "block:ba",
            () => "",
            (id) => cmds[id]
        );
        expect(out.map((t) => t.name)).toEqual(["task dev", "Terminal 2", "logs"]);
    });

    it("marks only the terminals whose shell is running a command", () => {
        const rows: Row[] = [
            { tabId: "t1", label: "a", termBlockOref: "block:b1" },
            { tabId: "t2", label: "b", termBlockOref: "block:b2" },
        ];
        const out = deriveTerminalVMs(
            rows,
            none,
            () => "",
            () => undefined,
            (id) => id === "b1"
        );
        expect(out.map((t) => t.running)).toEqual([true, undefined]);
    });
});

describe("terminalName", () => {
    it("prefers the rename, then the last command, then the ordinal", () => {
        expect(terminalName("logs", "task dev", 1)).toBe("logs");
        expect(terminalName("  ", "task dev", 1)).toBe("task dev");
        expect(terminalName(undefined, undefined, 3)).toBe("Terminal 3");
        expect(terminalName(undefined, "  \n ", 2)).toBe("Terminal 2");
    });

    it("takes a multi-line command's first non-empty line, its whitespace collapsed", () => {
        expect(terminalName(undefined, "\n  go test   ./pkg/x \\\n  -run Foo", 1)).toBe("go test ./pkg/x \\");
    });
});

describe("answerHint", () => {
    const q = (multiSelect = false): AgentAskQuestion => ({
        question: "Q?",
        options: [{ label: "a" }, { label: "b" }],
        multiSelect,
    });
    it("empty when no questions", () => {
        expect(answerHint([], {}, true)).toBe("");
    });
    it("single single-select, numbered: prompts 1–9 or click", () => {
        expect(answerHint([q()], {}, true)).toBe("Press 1–9 or click to answer");
    });
    it("single single-select, not numbered: prompts click only", () => {
        expect(answerHint([q()], {}, false)).toBe("Click to answer");
    });
    it("single multi-select: press Enter to submit", () => {
        expect(answerHint([q(true)], {}, true)).toBe("press Enter to submit");
    });
    it("multi question single-select: shows answered progress", () => {
        expect(answerHint([q(), q()], { 0: new Set([1]) }, true)).toBe("1/2 answered");
    });
    it("multi question with a multi-select: progress + Enter", () => {
        expect(answerHint([q(), q(true)], { 0: new Set([0]) }, true)).toBe("1/2 answered · press Enter to submit");
    });
});

describe("nextUnansweredQuestion", () => {
    const qs = [
        { question: "a", options: [{ label: "x" }] },
        { question: "b", options: [{ label: "y" }] },
    ] as AgentAskQuestion[];
    it("moves to the next question with neither a selection nor typed text", () => {
        expect(nextUnansweredQuestion(qs, {}, {}, 0)).toBe(1);
    });
    it("is -1 once every other question is answered, by a selection or by typed text", () => {
        expect(nextUnansweredQuestion(qs, { 1: new Set([0]) }, {}, 0)).toBe(-1);
        expect(nextUnansweredQuestion(qs, {}, { 1: "my own answer" }, 0)).toBe(-1);
        expect(nextUnansweredQuestion(qs, {}, { 1: "   " }, 0)).toBe(1);
    });
});

describe("answerHint with typed text", () => {
    const one = [{ question: "a", options: [{ label: "x" }] }] as AgentAskQuestion[];
    it("says Enter sends once an answer is typed", () => {
        expect(answerHint(one, {}, true, { 0: "my own answer" })).toBe("press Enter to send");
        expect(answerHint(one, {}, true, {})).toBe("Press 1–9 or click to answer");
    });
});

describe("conversationText", () => {
    it("joins message and user prose with blank lines, dropping tool actions", () => {
        const entries: AgentEntry[] = [
            { kind: "user", text: "add a test" },
            { kind: "action", verb: "Read", target: "file.ts", outcome: "ok" },
            { kind: "message", text: "done — added it" },
        ];
        expect(conversationText(entries)).toBe("add a test\n\ndone — added it");
    });

    it("returns an empty string when there is no prose", () => {
        expect(conversationText([{ kind: "action", verb: "Bash", target: "ls" }])).toBe("");
    });
});

describe("conversationText command/compaction", () => {
    it("includes commands as slash lines and skips compaction", () => {
        const entries: AgentEntry[] = [
            { kind: "user", text: "hi" },
            { kind: "command", name: "/clear" },
            { kind: "command", name: "brainstorming", args: "design x", isSkill: true },
            { kind: "compaction", summary: "big summary" },
            { kind: "message", text: "done" },
        ];
        expect(conversationText(entries)).toBe("hi\n\n/clear\n\n/brainstorming design x\n\ndone");
    });
});
describe("detail inline routing", () => {
    it("counts grep matches", () => {
        expect(detailLineCount({ kind: "grep", matches: [{ loc: "a", code: "b" }] })).toBe(1);
    });
    it("routes a 7-match grep to the modal (budget 6)", () => {
        const matches = Array.from({ length: 7 }, () => ({ loc: "x", code: "y" }));
        expect(detailExceedsInline({ kind: "grep", matches })).toBe(true);
    });
    it("keeps a 6-match grep inline", () => {
        const matches = Array.from({ length: 6 }, () => ({ loc: "x", code: "y" }));
        expect(detailExceedsInline({ kind: "grep", matches })).toBe(false);
    });
});

describe("edit-burst grouping", () => {
    const edit = (path: string): AgentEntry => ({
        kind: "action",
        verb: "edited",
        target: path,
        detail: { kind: "edit", files: [{ path, badge: "M", adds: 2, dels: 1, lines: [{ sign: "+", text: "a" }] }] },
    });
    it("folds 3+ consecutive edits into one edit-burst with summed totals", () => {
        const items = groupTimeline([edit("a.ts"), edit("b.ts"), edit("c.ts")]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: "edit-burst", adds: 6, dels: 3 });
        expect((items[0] as any).files).toHaveLength(3);
    });
    it("leaves a 2-edit run as inline actions", () => {
        const items = groupTimeline([edit("a.ts"), edit("b.ts")]);
        expect(items.map((i) => i.kind)).toEqual(["action", "action"]);
    });
    it("isEditAction requires the edit detail", () => {
        expect(isEditAction({ kind: "action", verb: "edited", target: "a.ts" })).toBe(false);
        expect(isEditAction(edit("a.ts"))).toBe(true);
    });
    it("aggregateEditBurst sums files across actions", () => {
        const burst = aggregateEditBurst([edit("a.ts"), edit("b.ts")] as AgentActionEntry[], 0);
        expect(burst.files).toHaveLength(2);
        expect(burst.adds).toBe(4);
        expect(burst.dels).toBe(2);
    });
});

describe("buildAskAnswers prose", () => {
    const q = (): AgentAskQuestion => ({ question: "q", options: [{ label: "a" }, { label: "b" }] });

    it("submits the chip label as text", () => {
        expect(buildAskAnswers([q()], { 0: new Set([1]) }, {}, true)).toEqual([{ text: "b" }]);
    });

    it("lets typed text win over a chip", () => {
        expect(buildAskAnswers([q()], { 0: new Set([1]) }, { 0: "  custom  " }, true)).toEqual([{ text: "custom" }]);
    });

    it("emits empty text for an unanswered prose question", () => {
        expect(buildAskAnswers([q()], {}, {}, true)).toEqual([{ text: "" }]);
    });

    it("keeps index answers when prose is off", () => {
        expect(buildAskAnswers([q()], { 0: new Set([1]) })).toEqual([{ selectedindexes: [1] }]);
    });
});

describe("withAsk prose", () => {
    const NOW = 1_000_000;
    const baseWorking = (): AgentVM => ({
        id: "tab-1",
        name: "waveterm",
        task: "",
        state: "working",
        activity: "go test ./…",
        activeMs: 5_000,
    });

    it("maps the prose flag onto the VM ask", () => {
        const vm = withAsk(baseWorking(), { oref: "block:x", askid: "a1", prose: true, questions: [] }, NOW);
        expect(vm.ask?.prose).toBe(true);
    });

    it("leaves prose unset when the ask is not prose", () => {
        const vm = withAsk(baseWorking(), { oref: "block:x", askid: "a1", questions: [] }, NOW);
        expect(vm.ask?.prose).toBeUndefined();
    });
});

describe("formatAgo", () => {
    it("says just now under a minute and when the age is unknown", () => {
        expect(formatAgo(undefined)).toBe("just now");
        expect(formatAgo(59_000)).toBe("just now");
    });
    it("says how long ago past a minute", () => {
        expect(formatAgo(5 * 60_000)).toBe("5m ago");
        expect(formatAgo(3 * 3_600_000)).toBe("3h ago");
    });
});

describe("askingLabel", () => {
    const asking = (ask: AgentVM["ask"]): AgentVM => ({ id: "t", name: "n", task: "", state: "asking", ask });

    it("reads a question the agent asked as asking", () => {
        expect(askingLabel(asking({ questions: [{ question: "Which one?", header: "Approach" }] }))).toBe("asking");
    });

    it("reads a held command's card as its header", () => {
        expect(askingLabel(asking({ hold: true, questions: [{ question: "Run it?", header: "Low RAM" }] }))).toBe(
            "Low RAM"
        );
    });

    it("falls back to held when the card has no header", () => {
        expect(askingLabel(asking({ hold: true, questions: [] }))).toBe("held");
    });
});
