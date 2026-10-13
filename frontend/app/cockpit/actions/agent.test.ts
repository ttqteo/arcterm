import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it } from "vitest";
import { AGENT_KIND, type AgentThing } from "./agent";
import { actionsFor } from "./types";

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
