import { globalStore } from "@/app/store/jotaiStore";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { rosterSeededAtom } from "@/app/view/agents/liveagents";
import { endedWorkerId } from "@/app/view/agents/runlineage";
import { atom } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_KIND, type AgentThing } from "./agent";
import { actionsFor } from "./types";

const openInSplit = vi.fn();
vi.mock("@/app/view/agents/gridstore", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openInSplit: (...a: any[]) => openInSplit(...a),
}));

const vm = (over: Partial<AgentVM> = {}): AgentVM => ({
    id: "tab1",
    name: "loom",
    task: "",
    state: "working",
    blockId: "blk1",
    ...over,
});
const thing = (over: Partial<AgentVM> = {}, rest: Partial<Omit<AgentThing, "agent">> = {}): AgentThing => ({
    agent: vm(over),
    contextLevel: null,
    hasDiff: false,
    ...rest,
});
const applies = (id: string, t: AgentThing) => AGENT_KIND.actions.find((a) => a.id === id)!.applies(t);
const available = (t: AgentThing) =>
    Object.values(actionsFor(AGENT_KIND.actions, t).available)
        .flat()
        .map((a) => a.id);

describe("agent actions", () => {
    it("offers Answer only while asking", () => {
        expect(applies("agent:answer", thing({ state: "asking" }))).toBe(true);
        expect(applies("agent:answer", thing({ state: "working" }))).toBe(false);
        expect(applies("agent:answer", thing({ state: "idle" }))).toBe(false);
    });
    it("cannot interrupt, nudge or close a card without a terminal block", () => {
        const t = thing({ state: "idle", blockId: undefined });
        expect(applies("agent:interrupt", t)).toBe(false);
        expect(applies("agent:nudge", t)).toBe(false);
        expect(applies("agent:close", t)).toBe(false);
        expect(applies("agent:interrupt", thing())).toBe(true);
    });
    it("nudges only an idle agent, as the rail's Resume", () => {
        expect(applies("agent:nudge", thing({ state: "idle" }))).toBe(true);
        expect(applies("agent:nudge", thing({ state: "working" }))).toBe(false);
        expect(applies("agent:nudge", thing({ state: "asking" }))).toBe(false);
    });
    it("backgrounds a working or asking agent and dismisses an idle one", () => {
        expect(available(thing({ state: "working" }))).toContain("agent:background");
        expect(available(thing({ state: "working" }))).not.toContain("agent:dismiss");
        expect(available(thing({ state: "asking" }))).toContain("agent:background");
        expect(available(thing({ state: "idle" }))).toContain("agent:dismiss");
        expect(available(thing({ state: "idle" }))).not.toContain("agent:background");
        const labels = Object.fromEntries(AGENT_KIND.actions.map((a) => [a.id, a.label]));
        expect(labels["agent:background"]).toBe("Move to background");
        expect(labels["agent:dismiss"]).toBe("Dismiss");
    });
    it("offers Compact and Clear only when the context level offers a reset", () => {
        const idle = { state: "idle" as const };
        expect(applies("agent:compact", thing(idle, { contextLevel: "warn" }))).toBe(true);
        expect(applies("agent:clear", thing(idle, { contextLevel: "hot" }))).toBe(true);
        expect(applies("agent:compact", thing(idle, { contextLevel: "ok" }))).toBe(false);
        // no usage reported yet: the rail shows no context line, so no reset
        expect(applies("agent:compact", thing(idle, { contextLevel: null }))).toBe(false);
        expect(applies("agent:compact", thing({ state: "working" }, { contextLevel: "hot" }))).toBe(false);
        expect(applies("agent:compact", thing({ ...idle, agent: "pi" }, { contextLevel: "hot" }))).toBe(false);
        expect(applies("agent:compact", thing({ ...idle, blockId: undefined }, { contextLevel: "hot" }))).toBe(false);
    });
    it("offers Review changes only when the card has a diff", () => {
        expect(applies("agent:review", thing({}, { hasDiff: true }))).toBe(true);
        expect(applies("agent:review", thing())).toBe(false);
    });
    it("offers Open in split for a live agent with a terminal, not a finished worker or a card with no block", () => {
        expect(applies("agent:split", thing())).toBe(true);
        expect(applies("agent:split", thing({ blockId: undefined }))).toBe(false);
        expect(applies("agent:split", thing({ id: endedWorkerId("r1", "t1") }))).toBe(false);
    });
    describe("Open in split, run", () => {
        const split = (model: unknown) =>
            AGENT_KIND.actions.find((a) => a.id === "agent:split")!.run(thing(), { model } as any);
        const modelOn = (surface: string) => ({ surfaceAtom: atom(surface), openTerminal: vi.fn() }) as any;
        afterEach(() => {
            openInSplit.mockReset();
            globalStore.set(rosterSeededAtom, false);
        });
        it("splits and shows the Agent surface, whichever surface it ran from", () => {
            globalStore.set(rosterSeededAtom, true);
            openInSplit.mockReturnValue(true);
            const model = modelOn("cockpit");
            split(model);
            expect(openInSplit).toHaveBeenCalledWith(model, "tab1");
            expect(globalStore.get(model.surfaceAtom)).toBe("agent");
            expect(model.openTerminal).not.toHaveBeenCalled();
        });
        it("just opens the agent's terminal when it cannot split (already a cell, grid full)", () => {
            globalStore.set(rosterSeededAtom, true);
            openInSplit.mockReturnValue(false);
            const model = modelOn("cockpit");
            split(model);
            expect(model.openTerminal).toHaveBeenCalledWith("tab1");
        });
        it("opens the terminal and leaves the grid alone before the roster is seeded", () => {
            const model = modelOn("cockpit");
            split(model);
            expect(openInSplit).not.toHaveBeenCalled();
            expect(model.openTerminal).toHaveBeenCalledWith("tab1");
        });
    });
    it("lists what does not apply now", () => {
        const notNow = actionsFor(AGENT_KIND.actions, thing({ state: "working" })).notNow.map((a) => a.id);
        expect(notNow).toContain("agent:answer");
        expect(notNow).toContain("agent:nudge");
        expect(notNow).not.toContain("agent:open");
    });
    it("builds entries keyed and titled as the palette's agent rows", () => {
        const agents = [vm(), vm({ id: "tab2", name: "fern", task: "Fix race", usage: { contextpct: 90 } as any })];
        const get = ((a: unknown) => (a === model.agentsAtom ? agents : {})) as any;
        const model = { agentsAtom: {} } as any;
        const entries = AGENT_KIND.entries(get, model);
        expect(entries.map((e) => [e.key, e.title])).toEqual([
            ["agent:tab1", "loom"],
            ["agent:tab2", "fern — Fix race"],
        ]);
        expect(entries[0].thing.contextLevel).toBeNull();
        expect(entries[1].thing.contextLevel).toBe("hot");
    });
});
