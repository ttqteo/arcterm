import { describe, expect, it } from "vitest";
import {
    aggregateStatus,
    badgeToStatus,
    buildDuplicateBlockMeta,
    buildSessionViewModel,
    cwdToServiceLabel,
    cycleTarget,
    findSessionTermBlock,
    flattenVisualOrder,
    labelChanged,
    loomBinOrDefault,
    modelLabel,
    needsYouTarget,
    NO_CWD_LABEL,
    reorderWithinGroup,
    waitingTarget,
    rollUpStatus,
    sessionRunORef,
    sessionTitle,
    subagentExpanded,
    visibleSubagents,
    toggleCollapsed,
    type SessionInput,
} from "./sessionviewmodel";

describe("cwdToServiceLabel", () => {
    it("uses the last path segment (POSIX)", () => {
        expect(cwdToServiceLabel("/home/user/src/CorrelationEngine")).toBe("CorrelationEngine");
    });
    it("uses the last path segment (Windows)", () => {
        expect(cwdToServiceLabel("C:\\Users\\k\\src\\KafkaToSolr")).toBe("KafkaToSolr");
    });
    it("ignores a trailing separator", () => {
        expect(cwdToServiceLabel("/a/b/")).toBe("b");
        expect(cwdToServiceLabel("C:\\a\\b\\")).toBe("b");
    });
    it("falls back when cwd is missing or empty", () => {
        expect(cwdToServiceLabel(undefined)).toBe(NO_CWD_LABEL);
        expect(cwdToServiceLabel("")).toBe(NO_CWD_LABEL);
    });
    it("ignores a run of trailing separators", () => {
        expect(cwdToServiceLabel("/a/b//")).toBe("b");
        expect(cwdToServiceLabel("C:\\a\\b\\\\")).toBe("b");
    });
    it("falls back for a root path", () => {
        expect(cwdToServiceLabel("/")).toBe(NO_CWD_LABEL);
        expect(cwdToServiceLabel("\\")).toBe(NO_CWD_LABEL);
    });
});

describe("badgeToStatus", () => {
    it("maps the working color to working", () => {
        expect(badgeToStatus({ color: "#3fb950" })).toBe("working");
    });
    it("is case-insensitive on the hex", () => {
        expect(badgeToStatus({ color: "#3FB950" })).toBe("working");
    });
    it("maps the waiting color to waiting", () => {
        expect(badgeToStatus({ color: "#d29922" })).toBe("waiting");
    });
    it("maps anything else to idle", () => {
        expect(badgeToStatus({ color: "#999999" })).toBe("idle");
        expect(badgeToStatus({})).toBe("idle");
    });
    it("maps missing badge to idle", () => {
        expect(badgeToStatus(undefined)).toBe("idle");
        expect(badgeToStatus(null)).toBe("idle");
    });
});

describe("aggregateStatus", () => {
    it("prioritizes asking over everything", () => {
        expect(aggregateStatus(["idle", "working", "waiting", "asking"])).toBe("asking");
    });
    it("prioritizes waiting over working/idle", () => {
        expect(aggregateStatus(["idle", "working", "waiting"])).toBe("waiting");
    });
    it("prioritizes working over idle", () => {
        expect(aggregateStatus(["idle", "working", "idle"])).toBe("working");
    });
    it("returns idle when all idle", () => {
        expect(aggregateStatus(["idle", "idle"])).toBe("idle");
    });
    it("returns idle for an empty list", () => {
        expect(aggregateStatus([])).toBe("idle");
    });
});

function input(overrides: Partial<SessionInput>): SessionInput {
    const cwd = overrides.cwd ?? "/src/CorrelationEngine";
    return {
        tabId: "t1",
        name: "tab",
        agent: "claude",
        pinned: false,
        cwd,
        serviceLabel: cwdToServiceLabel(cwd),
        status: "idle",
        active: false,
        ...overrides,
    };
}

describe("buildSessionViewModel", () => {
    it("carries the initiative a session is linked to onto its row", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", cwd: "/src/Zeta", effortORef: "effort:e1" })]);
        expect(vm.groups[0].sessions[0].effortORef).toBe("effort:e1");
    });

    it("routes pinned sessions into the pinned group with service in the label", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", cwd: "/src/CorrelationEngine", pinned: true }),
        ]);
        expect(vm.pinned).toHaveLength(1);
        expect(vm.pinned[0].label).toBe("claude · CorrelationEngine");
        expect(vm.groups).toHaveLength(0);
    });

    it("groups non-pinned sessions by service label", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/CorrelationEngine" }),
            input({ tabId: "t2", cwd: "/src/CorrelationEngine" }),
            input({ tabId: "t3", cwd: "/src/KafkaToSolr" }),
        ]);
        expect(vm.groups.map((g) => g.label)).toEqual(["CorrelationEngine", "KafkaToSolr"]);
        expect(vm.groups[0].sessions).toHaveLength(2);
        expect(vm.groups[1].sessions).toHaveLength(1);
    });

    it("preserves first-appearance order for groups", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/Zeta" }),
            input({ tabId: "t2", cwd: "/src/Alpha" }),
        ]);
        expect(vm.groups.map((g) => g.label)).toEqual(["Zeta", "Alpha"]);
    });

    it("computes a group's aggregate status", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/X", status: "idle" }),
            input({ tabId: "t2", cwd: "/src/X", status: "waiting" }),
        ]);
        expect(vm.groups[0].aggregateStatus).toBe("waiting");
    });

    it("labels grouped rows by agent, falling back to tab name", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "codex", name: "ignored", cwd: "/src/X" }),
            input({ tabId: "t2", agent: undefined, name: "my-tab", cwd: "/src/X" }),
        ]);
        expect(vm.groups[0].sessions[0].label).toBe("codex");
        expect(vm.groups[0].sessions[1].label).toBe("my-tab");
    });

    it("a custom label overrides the agent-derived base", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", customLabel: "auth refactor", cwd: "/src/X" }),
        ]);
        const row = vm.groups[0].sessions[0];
        expect(row.label).toBe("auth refactor");
        expect(row.customLabel).toBe("auth refactor");
    });

    it("keeps the service suffix on a renamed pinned row", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", customLabel: "auth refactor", cwd: "/src/CorrelationEngine", pinned: true }),
        ]);
        expect(vm.pinned[0].label).toBe("auth refactor · CorrelationEngine");
    });

    it("ignores an empty custom label and falls back to agent", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", customLabel: "", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("claude");
    });

    it("marks waiting rows as blocked and carries active/pinned flags", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/X", status: "waiting", active: true }),
        ]);
        const row = vm.groups[0].sessions[0];
        expect(row.blocked).toBe(true);
        expect(row.active).toBe(true);
    });

    it("marks asking rows as blocked too", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", cwd: "/src/X", status: "asking" })]);
        expect(vm.groups[0].sessions[0].blocked).toBe(true);
    });

    it("groups by the provided serviceLabel, not the cwd basename", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/CorrelationEngine", serviceLabel: "ServiceA" }),
            input({ tabId: "t2", cwd: "/other/path", serviceLabel: "ServiceA" }),
        ]);
        expect(vm.groups).toHaveLength(1);
        expect(vm.groups[0].label).toBe("ServiceA");
        expect(vm.groups[0].sessions).toHaveLength(2);
    });
});

describe("buildSessionViewModel — agents tab", () => {
    it("agents tab is pinned with no service suffix and is flagged", () => {
        const out = buildSessionViewModel([
            {
                tabId: "t1",
                name: "Agents",
                pinned: true,
                serviceLabel: "ungrouped",
                status: "idle",
                active: false,
                isAgentsTab: true,
            } as SessionInput,
        ]);
        expect(out.pinned).toHaveLength(1);
        expect(out.pinned[0].label).toBe("Agents");
        expect(out.pinned[0].isAgentsTab).toBe(true);
    });

    it("a normal pinned row still gets the service suffix", () => {
        const out = buildSessionViewModel([
            { tabId: "t2", name: "loom", pinned: true, serviceLabel: "waveterm", status: "idle", active: false } as SessionInput,
        ]);
        expect(out.pinned[0].label).toBe("loom · waveterm");
    });
});

describe("buildSessionViewModel — detail", () => {
    it("carries the detail string onto the row", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/X", detail: "editing X.java" }),
        ]);
        expect(vm.groups[0].sessions[0].detail).toBe("editing X.java");
    });
    it("leaves detail undefined when not provided", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].detail).toBeUndefined();
    });
});

describe("buildSessionViewModel — title (task summary)", () => {
    it("uses the task summary as the label when no custom label is set", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", title: "Fix duplicate-session race", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("Fix duplicate-session race");
    });
    it("lets a custom label override the task summary", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", customLabel: "my name", title: "Fix duplicate-session race", cwd: "/src/X" }),
        ]);
        expect(vm.groups[0].sessions[0].label).toBe("my name");
    });
    it("falls back to the agent name when there is no task summary", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("claude");
    });
    it("ignores a whitespace-only task summary", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", title: "   ", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("claude");
    });
    it("trims surrounding whitespace from the task summary", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", title: "  Refactor auth  ", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("Refactor auth");
    });
    it("keeps the service suffix on a pinned row labeled by its task summary", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", title: "Refactor auth", cwd: "/src/CorrelationEngine", pinned: true }),
        ]);
        expect(vm.pinned[0].label).toBe("Refactor auth · CorrelationEngine");
    });
});

describe("sessionTitle", () => {
    it("takes the live status's ai-title first", () => {
        expect(sessionTitle("Live title", "Scanned title")).toBe("Live title");
    });
    it("falls back to the archive's title when the status has none (a sleeping agent)", () => {
        expect(sessionTitle(undefined, "Scanned title")).toBe("Scanned title");
        expect(sessionTitle("", "Scanned title")).toBe("Scanned title");
    });
    it("falls back to the title read from its own transcript when the archive does not hold the session", () => {
        // the archive holds only the newest sessions: an agent asleep behind more of them is not in it
        expect(sessionTitle(undefined, undefined, "Transcript title")).toBe("Transcript title");
        expect(sessionTitle(undefined, "Scanned title", "Transcript title")).toBe("Scanned title");
    });
    it("is undefined when none has one, so the row falls back to its project", () => {
        expect(sessionTitle(undefined, undefined)).toBeUndefined();
        expect(sessionTitle("", "", "")).toBeUndefined();
    });
});

describe("sessionRunORef", () => {
    it("prefers the tab's run stamp", () => {
        expect(sessionRunORef({ "jarvis:runoref": "run:a" }, { "agent:runid": "b" })).toBe("run:a");
    });

    it("falls back to the terminal block's run id before the tab stamp reaches the app", () => {
        expect(sessionRunORef({}, { "agent:runid": "b" })).toBe("run:b");
    });

    it("is undefined for a session no run spawned", () => {
        expect(sessionRunORef({}, { "cmd:cwd": "/x" })).toBeUndefined();
        expect(sessionRunORef({}, undefined)).toBeUndefined();
    });
});

describe("labelChanged", () => {
    it("is a change when a name is set on a session that had none", () => {
        expect(labelChanged("deploy shell", undefined)).toBe(true);
    });
    it("is a change when the name is replaced", () => {
        expect(labelChanged("deploy shell", "old name")).toBe(true);
    });
    it("is not a change when the same name is resubmitted", () => {
        expect(labelChanged("deploy shell", "deploy shell")).toBe(false);
    });
    it("is not a change when only surrounding whitespace differs", () => {
        expect(labelChanged("  deploy shell  ", "deploy shell")).toBe(false);
    });
    // the clear gesture: emptying the box on a renamed session reverts it to its auto label, so this
    // has to reach renameSession — a no-op here would make a rename permanent
    it("is a change when an existing name is cleared", () => {
        expect(labelChanged("", "deploy shell")).toBe(true);
    });
    it("treats a whitespace-only draft as clearing an existing name", () => {
        expect(labelChanged("   ", "deploy shell")).toBe(true);
    });
    // ...but clearing a name that was never set changes nothing, so it must not write
    it("is not a change when an empty box is submitted on an auto-labeled session", () => {
        expect(labelChanged("", undefined)).toBe(false);
        expect(labelChanged("", "")).toBe(false);
        expect(labelChanged("   ", undefined)).toBe(false);
    });
});

describe("buildSessionViewModel — project label (launch default)", () => {
    it("uses the project label over the agent name when there is no task summary", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", projectLabel: "waveterm", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("waveterm");
    });
    it("lets the task summary override the project label", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", projectLabel: "waveterm", title: "Fix duplicate-session race", cwd: "/src/X" }),
        ]);
        expect(vm.groups[0].sessions[0].label).toBe("Fix duplicate-session race");
    });
    it("lets a custom rename override the project label", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", agent: "claude", projectLabel: "waveterm", customLabel: "my name", cwd: "/src/X" }),
        ]);
        expect(vm.groups[0].sessions[0].label).toBe("my name");
    });
    it("trims a project label used as the row label", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", projectLabel: "  waveterm  ", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("waveterm");
    });
    it("labels a session with no agent and no tab name as session", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: undefined, name: "", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("session");
    });
    it("ignores a whitespace-only project label", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", projectLabel: "   ", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].label).toBe("claude");
    });
    it("carries the project label onto the row so the roster can group by it", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", projectLabel: "waveterm", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].projectLabel).toBe("waveterm");
    });
    it("carries the cwd onto the row so the roster can resolve its registered project", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", agent: "claude", cwd: "/src/X" })]);
        expect(vm.groups[0].sessions[0].cwd).toBe("/src/X");
    });
});

describe("toggleCollapsed", () => {
    it("adds a label that is not present", () => {
        expect(toggleCollapsed([], "ServiceA")).toEqual(["ServiceA"]);
        expect(toggleCollapsed(["X"], "ServiceA")).toEqual(["X", "ServiceA"]);
    });
    it("removes a label that is present", () => {
        expect(toggleCollapsed(["X", "ServiceA"], "ServiceA")).toEqual(["X"]);
    });
    it("does not mutate the input array", () => {
        const input = ["X"];
        toggleCollapsed(input, "ServiceA");
        expect(input).toEqual(["X"]);
    });
});

describe("flattenVisualOrder", () => {
    it("lists pinned rows first, then group rows in order", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "p1", cwd: "/src/A", pinned: true }),
            input({ tabId: "g1", cwd: "/src/B" }),
            input({ tabId: "g2", cwd: "/src/C" }),
        ]);
        expect(flattenVisualOrder(vm).map((r) => r.tabId)).toEqual(["p1", "g1", "g2"]);
    });
});

describe("cycleTarget", () => {
    const vm = () =>
        buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B" }),
            input({ tabId: "t3", cwd: "/src/C" }),
        ]);
    it("moves to the next row", () => {
        expect(cycleTarget(vm(), 1)).toBe("t2");
    });
    it("wraps from last to first", () => {
        const v = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A" }),
            input({ tabId: "t2", cwd: "/src/B" }),
            input({ tabId: "t3", cwd: "/src/C", active: true }),
        ]);
        expect(cycleTarget(v, 1)).toBe("t1");
    });
    it("moves to the previous row, wrapping", () => {
        expect(cycleTarget(vm(), -1)).toBe("t3");
    });
    it("returns undefined when there are no rows", () => {
        expect(cycleTarget(buildSessionViewModel([]), 1)).toBeUndefined();
    });
    it("starts at the first row for next when none is active", () => {
        const v = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A" }),
            input({ tabId: "t2", cwd: "/src/B" }),
        ]);
        expect(cycleTarget(v, 1)).toBe("t1");
    });
});

describe("needsYouTarget", () => {
    it("returns the next waiting row after the active one, wrapping", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
            input({ tabId: "t3", cwd: "/src/C", status: "waiting" }),
        ]);
        expect(needsYouTarget(vm)).toBe("t3");
    });
    it("wraps past the active row to find an earlier waiting row", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", status: "waiting" }),
            input({ tabId: "t2", cwd: "/src/B", active: true }),
        ]);
        expect(needsYouTarget(vm)).toBe("t1");
    });
    it("targets an asking row (needs-you), not just waiting", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
            input({ tabId: "t3", cwd: "/src/C", status: "asking" }),
        ]);
        expect(needsYouTarget(vm)).toBe("t3");
    });
    it("returns undefined when nothing needs you", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true, status: "working" }),
        ]);
        expect(needsYouTarget(vm)).toBeUndefined();
    });
});

describe("waitingTarget", () => {
    it("forward: returns the next waiting row after active, skipping non-waiting", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
            input({ tabId: "t3", cwd: "/src/C", status: "waiting" }),
        ]);
        expect(waitingTarget(vm, 1)).toBe("t3");
    });
    it("backward: returns the previous waiting row before active", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", status: "waiting" }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
            input({ tabId: "t3", cwd: "/src/C", active: true }),
        ]);
        expect(waitingTarget(vm, -1)).toBe("t1");
    });
    it("backward: wraps past the start to the last waiting row", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
            input({ tabId: "t3", cwd: "/src/C", status: "waiting" }),
        ]);
        expect(waitingTarget(vm, -1)).toBe("t3");
    });
    it("returns undefined when nothing is waiting (both directions)", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true, status: "working" }),
            input({ tabId: "t2", cwd: "/src/B", status: "idle" }),
        ]);
        expect(waitingTarget(vm, 1)).toBeUndefined();
        expect(waitingTarget(vm, -1)).toBeUndefined();
    });
    it("with exactly one waiting row, both directions find it", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", active: true }),
            input({ tabId: "t2", cwd: "/src/B", status: "waiting" }),
        ]);
        expect(waitingTarget(vm, 1)).toBe("t2");
        expect(waitingTarget(vm, -1)).toBe("t2");
    });
    it("returns undefined for an empty model", () => {
        expect(waitingTarget(buildSessionViewModel([]), 1)).toBeUndefined();
        expect(waitingTarget(buildSessionViewModel([]), -1)).toBeUndefined();
    });
    it("does not throw and is deterministic when no row is active", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/A", status: "waiting" }),
            input({ tabId: "t2", cwd: "/src/B", status: "working" }),
        ]);
        expect(waitingTarget(vm, 1)).toBe("t1");
        expect(waitingTarget(vm, -1)).toBe("t1");
    });
});

describe("rollUpStatus", () => {
    it("waiting parent dominates a working child", () => {
        expect(rollUpStatus("waiting", [{ id: "a", type: "E", state: "working" }])).toBe("waiting");
    });
    it("idle parent with a working child becomes working", () => {
        expect(rollUpStatus("idle", [{ id: "a", type: "E", state: "working" }])).toBe("working");
    });
    it("idle parent with only finished children stays idle", () => {
        expect(rollUpStatus("idle", [{ id: "a", type: "E", state: "success" }])).toBe("idle");
    });
    it("no children returns the parent status", () => {
        expect(rollUpStatus("working", [])).toBe("working");
    });
});

describe("subagentExpanded", () => {
    it("an empty list is never expanded", () => {
        expect(subagentExpanded([], undefined)).toBe(false);
        expect(subagentExpanded([], true)).toBe(false);
    });
    it("auto-expands while a child is working", () => {
        expect(subagentExpanded([{ id: "a", type: "E", state: "working" }], undefined)).toBe(true);
    });
    it("auto-collapses when all children finished", () => {
        expect(subagentExpanded([{ id: "a", type: "E", state: "success" }], undefined)).toBe(false);
    });
    it("manual override wins over auto", () => {
        expect(subagentExpanded([{ id: "a", type: "E", state: "working" }], false)).toBe(false);
        expect(subagentExpanded([{ id: "a", type: "E", state: "success" }], true)).toBe(true);
    });
});

describe("visibleSubagents", () => {
    it("keeps working and failure, drops success and done", () => {
        const subs: { id: string; type: string; state: "working" | "success" | "failure" | "done" }[] = [
            { id: "a", type: "E", state: "working" },
            { id: "b", type: "E", state: "success" },
            { id: "c", type: "E", state: "failure" },
            { id: "d", type: "E", state: "done" },
        ];
        expect(visibleSubagents(subs).map((s) => s.id)).toEqual(["a", "c"]);
    });
    it("returns [] when every child has finished cleanly", () => {
        expect(visibleSubagents([{ id: "a", type: "E", state: "success" }])).toEqual([]);
        expect(visibleSubagents([])).toEqual([]);
    });
});

describe("buildSessionViewModel — subagents", () => {
    it("attaches subagents and rolls an idle parent up to working", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/X", status: "idle", subagents: [{ id: "a", type: "Explore", state: "working" }] }),
        ]);
        const row = vm.groups[0].sessions[0];
        expect(row.subagents).toHaveLength(1);
        expect(row.status).toBe("working");
    });
    it("keeps a waiting parent amber even with a working subagent", () => {
        const vm = buildSessionViewModel([
            input({ tabId: "t1", cwd: "/src/X", status: "waiting", subagents: [{ id: "a", type: "E", state: "working" }] }),
        ]);
        expect(vm.groups[0].sessions[0].status).toBe("waiting");
    });
    it("defaults subagents to [] and expanded to false", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", cwd: "/src/X" })]);
        const row = vm.groups[0].sessions[0];
        expect(row.subagents).toEqual([]);
        expect(row.subagentsExpanded).toBe(false);
    });
});

describe("buildDuplicateBlockMeta", () => {
    it("copies an agent session's launch meta and forces view=term", () => {
        const src = { view: "term", controller: "cmd", cmd: "claude", "cmd:interactive": true, "cmd:cwd": "/src/x" };
        expect(buildDuplicateBlockMeta(src)).toEqual({
            view: "term",
            controller: "cmd",
            cmd: "claude",
            "cmd:interactive": true,
            "cmd:cwd": "/src/x",
        });
    });
    it("copies a plain shell session (no cmd)", () => {
        const src = { view: "term", controller: "shell", "cmd:cwd": "/src/x" };
        expect(buildDuplicateBlockMeta(src)).toEqual({ view: "term", controller: "shell", "cmd:cwd": "/src/x" });
    });
    it("preserves a remote connection", () => {
        const src = { view: "term", controller: "shell", "cmd:cwd": "/src/x", connection: "user@host" };
        expect(buildDuplicateBlockMeta(src)).toEqual({
            view: "term",
            controller: "shell",
            "cmd:cwd": "/src/x",
            connection: "user@host",
        });
    });
    it("copies cmd:args when present", () => {
        const src = { view: "term", controller: "cmd", cmd: "codex", "cmd:args": ["--flag"], "cmd:cwd": "/x" };
        expect(buildDuplicateBlockMeta(src)["cmd:args"]).toEqual(["--flag"]);
    });
    it("keeps the agent launch flags (cmd:shell/cmd:jwt/agent:baseargs) so the clone still gets the JWT env", () => {
        const src = {
            view: "term",
            controller: "cmd",
            cmd: "pi",
            "cmd:args": ["--session", "/x/session.jsonl"],
            "cmd:cwd": "/x",
            "cmd:shell": false,
            "cmd:jwt": true,
            "agent:baseargs": ["--session", "/x/session.jsonl"],
        };
        expect(buildDuplicateBlockMeta(src)).toEqual({ ...src });
    });
    it("drops non-launch keys (labels, fontsize, view override)", () => {
        const src = { view: "preview", controller: "shell", "cmd:cwd": "/x", "session:label": "L", "term:fontsize": 14 };
        const out = buildDuplicateBlockMeta(src);
        expect(out.view).toBe("term");
        expect(out["session:label"]).toBeUndefined();
        expect(out["term:fontsize"]).toBeUndefined();
    });
    it("handles a null/empty source", () => {
        expect(buildDuplicateBlockMeta(undefined as any)).toEqual({ view: "term" });
        expect(buildDuplicateBlockMeta({})).toEqual({ view: "term" });
    });
});

describe("loomBinOrDefault", () => {
    it("returns the configured binary when set", () => {
        expect(loomBinOrDefault("loom")).toBe("loom");
        expect(loomBinOrDefault("/usr/local/bin/loom")).toBe("/usr/local/bin/loom");
        expect(loomBinOrDefault("C:\\tools\\loom.exe")).toBe("C:\\tools\\loom.exe");
    });
    it("trims surrounding whitespace", () => {
        expect(loomBinOrDefault("  loom.exe  ")).toBe("loom.exe");
    });
    it("falls back to 'loom' when unset or blank", () => {
        expect(loomBinOrDefault(undefined)).toBe("loom");
        expect(loomBinOrDefault("")).toBe("loom");
        expect(loomBinOrDefault("   ")).toBe("loom");
    });
});

describe("reorderWithinGroup", () => {
    it("moves a member up within a contiguous group", () => {
        expect(reorderWithinGroup(["a", "b", "c"], ["a", "b", "c"], "c", "a", true)).toEqual(["c", "a", "b"]);
    });
    it("moves a member down (placeBefore=false)", () => {
        expect(reorderWithinGroup(["a", "b", "c"], ["a", "b", "c"], "a", "b", false)).toEqual(["b", "a", "c"]);
    });
    it("leaves other groups' interleaved tabs byte-for-byte untouched", () => {
        // group = a,b,c at slots 0,2,4; x,y at 1,3 belong to other groups
        expect(reorderWithinGroup(["a", "x", "b", "y", "c"], ["a", "b", "c"], "c", "a", true)).toEqual([
            "c", "x", "a", "y", "b",
        ]);
    });
    it("works for the pinned group (members are the pinned ids)", () => {
        expect(reorderWithinGroup(["p1", "p2", "g1"], ["p1", "p2"], "p2", "p1", true)).toEqual(["p2", "p1", "g1"]);
    });
    it("returns the input unchanged when dragged === target", () => {
        const tabids = ["a", "b", "c"];
        expect(reorderWithinGroup(tabids, ["a", "b", "c"], "a", "a", true)).toBe(tabids);
    });
    it("returns the input unchanged when either id is not a member", () => {
        const tabids = ["a", "b", "c"];
        expect(reorderWithinGroup(tabids, ["a", "b"], "a", "c", true)).toBe(tabids);
        expect(reorderWithinGroup(tabids, ["a", "b"], "zzz", "a", true)).toBe(tabids);
    });
});

describe("modelLabel", () => {
    it("names the family and its version", () => {
        expect(modelLabel("claude-opus-5-5")).toBe("opus 5.5");
        expect(modelLabel("claude-opus-4-8")).toBe("opus 4.8");
        expect(modelLabel("claude-sonnet-4-6")).toBe("sonnet 4.6");
        expect(modelLabel("claude-haiku-4-5-20251001")).toBe("haiku 4.5");
        expect(modelLabel("claude-fable-5")).toBe("fable 5");
    });
    it("reads the version through a date snapshot, a context suffix and a provider prefix", () => {
        expect(modelLabel("claude-sonnet-4-20250514")).toBe("sonnet 4");
        expect(modelLabel("claude-opus-5-5[1m]")).toBe("opus 5.5");
        expect(modelLabel("anthropic/claude-opus-5-5")).toBe("opus 5.5");
    });
    it("keeps a bare family alias as it is", () => {
        expect(modelLabel("sonnet")).toBe("sonnet");
    });
    it("strips a leading claude- for unknown ids", () => {
        expect(modelLabel("claude-foo-9")).toBe("foo-9");
    });
    it("returns empty for missing input", () => {
        expect(modelLabel("")).toBe("");
        expect(modelLabel(undefined)).toBe("");
    });
});

describe("buildSessionViewModel — model", () => {
    it("carries the session model onto the row", () => {
        const vm = buildSessionViewModel([input({ tabId: "t1", cwd: "/src/X", model: "claude-opus-4-8" })]);
        expect(vm.groups[0].sessions[0].model).toBe("claude-opus-4-8");
    });
});

describe("findSessionTermBlock", () => {
    const resolved = (blockId: string, meta?: Record<string, any>) => ({
        blockId,
        block: meta == null ? undefined : ({ meta } as Block),
    });

    it("returns the first terminal block with a non-empty cwd", () => {
        const firstMeta = { view: "term" };
        const selectedMeta = { view: "term", "cmd:cwd": "/first", cmd: "claude" };

        expect(
            findSessionTermBlock([
                resolved("preview", { view: "preview", "cmd:cwd": "/ignored" }),
                resolved("missing", firstMeta),
                resolved("term-1", selectedMeta),
                resolved("term-2", { view: "term", "cmd:cwd": "/second" }),
            ])
        ).toEqual({ blockId: "term-1", cwd: "/first", meta: selectedMeta });
    });

    it("returns undefined when no block qualifies", () => {
        expect(
            findSessionTermBlock([
                resolved("missing-block"),
                resolved("preview", { view: "preview", "cmd:cwd": "/ignored" }),
                resolved("term", { view: "term", "cmd:cwd": "" }),
            ])
        ).toBeUndefined();
    });
});
