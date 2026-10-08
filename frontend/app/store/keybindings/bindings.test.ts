// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { centerModeAtom } from "@/app/view/agents/agentcenter";
import { SURFACE_ORDER, type SurfaceKey } from "@/app/view/agents/agents";
import type { LauncherKind } from "@/app/view/agents/launcher";
import { atom, type PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusSubagentAtom } from "@/app/view/agents/subagentsstore";
import { activeChannelRunsAtom } from "@/app/view/agents/channelsstore";
import {
    attachCanvas,
    detachCanvas,
    getCanvas,
    setCanvasMode,
    setMarking,
    updateCanvas,
} from "@/app/view/agents/canvasstore";
import { setAgentView } from "@/app/view/agents/agentview";
import { diffScopeAtom } from "@/app/view/agents/diffscopeatom";
import { docReviewAtom } from "@/app/view/agents/docreview";
import { addComment, getDocReview, setGeneralNote, syncDocReview } from "@/app/view/agents/docreviewstore";
import { graphOnAtom, historyFiltersAtom, historyScrollAtom } from "@/app/view/agents/githistorystore";
import { NO_FILTERS } from "@/app/view/agents/historyquery";
import type { LineComment } from "@/app/view/agents/linecomments";
import { activeReviewKeyAtom, lineReviewsAtom, type LineReviewState } from "@/app/view/agents/linecommentstore";
import { renamingRowAtom } from "@/app/view/agents/rowrenameatom";
import { autonomyPanelOpenAtom } from "@/app/view/jarvis/autonomyladder";
import { finalShotsViewerOpenAtom } from "@/app/view/jarvis/finalshotsstore";
import { graphPeekOpenAtom, briefPeekRecordAtom } from "@/app/view/jarvis/jarvisstore";
import { activeRunIdAtom, activeSubjectAtom } from "@/app/view/jarvis/jarvissubjectstore";
import { peekTarget } from "@/app/view/jarvis/openref";
import { petPeekOpenAtom } from "@/app/view/jarvis/petstore";
import { dagModalStateAtom } from "@/app/view/orchestrate/dagmodalstate";
import { codeTreeFocusedAtom } from "@/app/view/code/codestore";
import { codeSearchModeAtom } from "@/app/view/code/codesearchstore";
import {
    buildAgentBindings,
    buildCodeBindings,
    buildFilesBindings,
    buildFinalShotsBindings,
    buildGlobalBindings,
    buildJarvisBindings,
    buildJarvisGraphBindings,
    buildListNavBindings,
    closeTargetForDoubleCtrlC,
} from "./bindings";
import { listNavAtom } from "./listnav";
import type { KeyContext } from "./types";

vi.mock("@/app/view/jarvis/openref", async (orig) => ({
    ...(await orig<typeof import("@/app/view/jarvis/openref")>()),
    peekTarget: vi.fn(async () => ({ ok: true })),
}));

// the canvas guards read the focused agent id from the model
const stubModel = (focusId?: string): any => ({
    focusIdAtom: atom<string | undefined>(focusId) as PrimitiveAtom<string | undefined>,
});

const docAsk = (path: string) => ({
    askId: `doc:${path}`,
    questions: [
        {
            header: "Doc review",
            question: `${path}\n- §3.2: rewritten`,
            options: [{ label: "Approve" }, { label: "Request changes" }],
        },
    ],
});

const ctx = (surface: SurfaceKey = "cockpit"): KeyContext => ({
    surface,
    editable: false,
    modalOpen: false,
    leader: null,
});

describe("closeTargetForDoubleCtrlC", () => {
    const agents = [
        { id: "agent-tab", name: "Agent", state: "working" },
        { id: "terminal-tab", name: "Terminal", state: "idle", kind: "terminal" },
    ] as any;

    it("closes a focused agent session (spec §5: double-Ctrl+C closes the agent)", () => {
        expect(closeTargetForDoubleCtrlC(agents, "agent-tab")).toEqual(agents[0]);
    });

    it("never closes a plain terminal: both presses reach its shell", () => {
        expect(closeTargetForDoubleCtrlC(agents, "terminal-tab")).toBeNull();
    });

    it("goes by the pane that took the keys, not the selected agent: a terminal docked under it closes nothing", () => {
        expect(closeTargetForDoubleCtrlC(agents, "agent-tab", "terminal-tab")).toBeNull();
        expect(closeTargetForDoubleCtrlC(agents, "terminal-tab", "agent-tab")).toEqual(agents[0]);
    });

    it("returns null (no close) when nothing is focused", () => {
        expect(closeTargetForDoubleCtrlC(agents, undefined)).toBeNull();
    });

    it("returns null when the focused id is not in the roster", () => {
        expect(closeTargetForDoubleCtrlC(agents, "gone")).toBeNull();
    });
});

describe("surface switch [ / ]", () => {
    it("cycles SURFACE_ORDER forward/back with wrap and reaches radar", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const bindings = buildGlobalBindings(model);
        const next = bindings.find((b) => b.id === "surface:next")!;
        const prev = bindings.find((b) => b.id === "surface:prev")!;
        expect(next.keys).toBe("]");
        expect(prev.keys).toBe("[");

        next.run(ctx()); // cockpit -> jarvis
        expect(globalStore.get(model.surfaceAtom)).toBe("jarvis");

        globalStore.set(model.surfaceAtom, "files");
        next.run(ctx()); // files (Diff) -> radar (radar follows it in SURFACE_ORDER)
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");

        globalStore.set(model.surfaceAtom, SURFACE_ORDER[SURFACE_ORDER.length - 1]);
        next.run(ctx()); // wrap forward to first
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[0]);

        prev.run(ctx()); // wrap back to last
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[SURFACE_ORDER.length - 1]);
    });

    it("binds Mod+1..7 to SURFACE_ORDER, so Usage is Mod+4 and Radar is Mod+7", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const chords = buildGlobalBindings(model).filter(
            (b) => /^Mod:\d$/.test(b.keys) && b.id.startsWith("surface:")
        );
        expect(chords.map((b) => b.keys)).toEqual([
            "Mod:1",
            "Mod:2",
            "Mod:3",
            "Mod:4",
            "Mod:5",
            "Mod:6",
            "Mod:7",
        ]);
        chords.find((b) => b.keys === "Mod:4")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("usage");
        chords.find((b) => b.keys === "Mod:7")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");
    });

    it("enters the cycle gracefully from a surface not in SURFACE_ORDER (settings)", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("settings") } as any;
        const bindings = buildGlobalBindings(model);
        bindings.find((b) => b.id === "surface:next")!.run(ctx("settings"));
        expect(globalStore.get(model.surfaceAtom)).toBe(SURFACE_ORDER[0]);
    });

    it("switch bindings are suppressed while typing / modal open", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const next = buildGlobalBindings(model).find((b) => b.id === "surface:next")!;
        expect(next.when!({ surface: "cockpit", editable: true, modalOpen: false, leader: null })).toBe(false);
        expect(next.when!({ surface: "cockpit", editable: false, modalOpen: true, leader: null })).toBe(false);
        expect(next.when!(ctx())).toBe(true);
    });

    it("exposes a g r leader teleport to radar", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:radar")!;
        expect(b.keys).toBe("g r");
        b.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");
    });
});

describe("Escape back to the Cockpit", () => {
    const backHome = () =>
        buildGlobalBindings({ surfaceAtom: atom<SurfaceKey>("jarvis") } as any).find(
            (b) => b.id === "surface:back-home"
        )!;

    it("leaves a deep surface, but is not bound on the Cockpit itself", () => {
        globalStore.set(graphPeekOpenAtom, false);
        globalStore.set(autonomyPanelOpenAtom, false);
        const b = backHome();
        expect(b.keys).toBe("Escape");
        expect(b.when!(ctx("jarvis"))).toBe(true);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    // an overlay that dismisses on Escape must also suppress this, or one press does both: closes the
    // overlay AND leaves the surface. The dispatcher runs on window capture, so the overlay cannot win
    // the key by registering its own handler — it has to be declared here.
    it("yields to whichever Jarvis overlay owns Escape", () => {
        const b = backHome();
        globalStore.set(graphPeekOpenAtom, true);
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(graphPeekOpenAtom, false);
        globalStore.set(autonomyPanelOpenAtom, true);
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(autonomyPanelOpenAtom, false);
        expect(b.when!(ctx("jarvis"))).toBe(true);
    });

    // the pet lives in window chrome, so unlike the two above its peek can be open on ANY deep surface
    it("yields to the pet's peek on every deep surface it can be open over", () => {
        const b = backHome();
        globalStore.set(petPeekOpenAtom, true);
        expect(b.when!(ctx("jarvis"))).toBe(false);
        expect(b.when!(ctx("files"))).toBe(false);
        expect(b.when!(ctx("usage"))).toBe(false);
        globalStore.set(petPeekOpenAtom, false);
        expect(b.when!(ctx("usage"))).toBe(true);
    });

    // The Brief mounts two overlays that take Escape themselves and were missing from this list, so one
    // press both closed the overlay and left the surface — and because the overlay's owner state was never
    // cleared, returning to the Brief showed it open again. The peek is the Brief's only record
    // destination, and the DAG modal is reachable from its run sheet.
    it("yields to the Brief's record peek and DAG modal", () => {
        const b = backHome();
        globalStore.set(graphPeekOpenAtom, false);
        globalStore.set(autonomyPanelOpenAtom, false);
        globalStore.set(petPeekOpenAtom, false);
        globalStore.set(briefPeekRecordAtom, "task-a");
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(briefPeekRecordAtom, null);
        globalStore.set(dagModalStateAtom, {
            kind: "live",
            channelId: "ch-1",
            runId: "run-1",
            dagOref: "dag:run-1",
            error: "",
        });
        expect(b.when!(ctx("jarvis"))).toBe(false);
        globalStore.set(dagModalStateAtom, null);
        expect(b.when!(ctx("jarvis"))).toBe(true);
    });
});

describe("list-nav bindings", () => {
    const chanCtx: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };

    it("is inactive with no controller, when editable/modal, or on a mismatched surface", () => {
        globalStore.set(listNavAtom, null);
        const j = buildListNavBindings(stubModel()).find((b) => b.id === "list:next-j")!;
        expect(j.keys).toBe("j");
        expect(j.when!(chanCtx)).toBe(false); // no controller

        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: "a", setCursor() {} });
        expect(j.when!(chanCtx)).toBe(true);
        expect(j.when!({ ...chanCtx, editable: true })).toBe(false);
        expect(j.when!({ ...chanCtx, modalOpen: true })).toBe(false);
        expect(j.when!({ ...chanCtx, surface: "usage" })).toBe(false); // controller is for jarvis
        globalStore.set(listNavAtom, null);
    });

    it("j/ArrowDown move forward and k/ArrowUp back via moveCursor (clamped, no wrap)", () => {
        const seen: string[] = [];
        globalStore.set(listNavAtom, {
            surface: "jarvis",
            navigableIds: ["a", "b", "c"],
            cursorId: "b",
            setCursor: (id) => seen.push(id),
        });
        const bindings = buildListNavBindings(stubModel());
        bindings.find((b) => b.id === "list:next-j")!.run(chanCtx);
        bindings.find((b) => b.id === "list:prev-k")!.run(chanCtx);
        bindings.find((b) => b.id === "list:next")!.run(chanCtx);
        bindings.find((b) => b.id === "list:prev")!.run(chanCtx);
        expect(seen).toEqual(["c", "a", "c", "a"]); // from "b": +1=c, -1=a, +1=c, -1=a
        globalStore.set(listNavAtom, null);
    });

    it("first press from an empty/absent cursor lands on the first id", () => {
        const seen: string[] = [];
        globalStore.set(listNavAtom, { surface: "jarvis", navigableIds: ["a", "b"], cursorId: undefined, setCursor: (id) => seen.push(id) });
        buildListNavBindings(stubModel()).find((b) => b.id === "list:next-j")!.run(chanCtx);
        expect(seen).toEqual(["a"]);
        globalStore.set(listNavAtom, null);
    });

    describe("list:peek", () => {
        const run = { kind: "run", runId: "r1" } as const;
        const publish = (peekTarget?: () => typeof run | null) =>
            globalStore.set(listNavAtom, {
                surface: "jarvis",
                navigableIds: ["a"],
                cursorId: "a",
                setCursor() {},
                peekTarget,
            });
        afterEach(() => {
            globalStore.set(listNavAtom, null);
            vi.mocked(peekTarget).mockClear();
        });

        it("is bound to Space and inactive without a peekTarget, when it returns null, in a field, or under a modal", () => {
            const model = stubModel();
            const b = buildListNavBindings(model).find((x) => x.id === "list:peek")!;
            expect(b.keys).toBe("Space");
            publish();
            expect(b.when!(chanCtx)).toBe(false);
            publish(() => null);
            expect(b.when!(chanCtx)).toBe(false);
            publish(() => run);
            expect(b.when!({ ...chanCtx, editable: true })).toBe(false);
            expect(b.when!({ ...chanCtx, modalOpen: true })).toBe(false);
            expect(b.when!(chanCtx)).toBe(true);
        });

        it("peeks the cursor row's target", () => {
            const model = stubModel();
            publish(() => run);
            const peek = buildListNavBindings(model).find((x) => x.id === "list:peek")!;
            peek.run(chanCtx);
            expect(peekTarget).toHaveBeenCalledWith(model, run);
        });
    });
});

describe("jarvis surface bindings", () => {
    const jarvisCtx: KeyContext = { surface: "jarvis", editable: false, modalOpen: false, leader: null };
    const byId = (id: string) => buildJarvisBindings().find((b) => b.id === id)!;

    // The Brief mounts no Stage, so it registers only the graph shortcut (buildJarvisGraphBindings).
    // Sharing one builder rather than re-declaring the key is what keeps the chord from drifting apart
    // between the two compositions.
    it("exposes the graph shortcut on its own, without the Stage-only keys", () => {
        const graphOnly = buildJarvisGraphBindings();
        expect(graphOnly.map((b) => b.id)).toEqual(["jarvis:graph-peek"]);
        const shared = graphOnly[0];
        const fromFull = byId("jarvis:graph-peek");
        expect(shared.keys).toBe(fromFull.keys);
        // the Stage-only keys act on panes the Brief does not have
        expect(graphOnly.some((b) => b.id === "jarvis:toggle-rail" || b.id === "jarvis:new-run")).toBe(false);
    });

    // the click-through bindings (+ Channel, the record band) and composer focus act on rendered DOM, so
    // only their guards are asserted here — this suite runs in node, and the surface has no render harness
    // (see docs: surface behaviour is checked over CDP, not jsdom).
    it("toggles the graph peek with Shift:g — distinct from the g leader, and live while the peek is open", () => {
        globalStore.set(graphPeekOpenAtom, false);
        const g = byId("jarvis:graph-peek");
        expect(g.keys).toBe("Shift:g");
        g.run(jarvisCtx);
        expect(globalStore.get(graphPeekOpenAtom)).toBe(true);
        expect(g.when!(jarvisCtx)).toBe(true); // its own toggle stays reachable behind the overlay
        g.run(jarvisCtx);
        expect(globalStore.get(graphPeekOpenAtom)).toBe(false);
    });

    it("suppresses the surface keys while the graph peek owns the surface", () => {
        globalStore.set(graphPeekOpenAtom, true);
        for (const id of ["jarvis:new-run", "jarvis:record-band", "jarvis:next-run"]) {
            expect(byId(id).when!(jarvisCtx)).toBe(false);
        }
        globalStore.set(graphPeekOpenAtom, false);
        expect(byId("jarvis:new-run").when!(jarvisCtx)).toBe(true);
    });

    // the Brief's filter takes / the way the Diff history's does, on its own surface
    it("focuses the Brief filter with /", () => {
        globalStore.set(graphPeekOpenAtom, false);
        const f = byId("jarvis:filter");
        expect(f.keys).toBe("/");
        expect(f.when!(jarvisCtx)).toBe(true);
    });

    it("guards every key on the surface, the typing state and modals", () => {
        globalStore.set(graphPeekOpenAtom, false);
        for (const b of buildJarvisBindings()) {
            expect(b.when!({ ...jarvisCtx, surface: "cockpit" })).toBe(false);
            expect(b.when!({ ...jarvisCtx, modalOpen: true })).toBe(false);
        }
        // ...except the composer's own Escape, which exists *because* focus is in a field
        expect(byId("jarvis:blur-composer").when!({ ...jarvisCtx, editable: true })).toBe(true);
        for (const b of buildJarvisBindings().filter((x) => x.id !== "jarvis:blur-composer")) {
            expect(b.when!({ ...jarvisCtx, editable: true })).toBe(false);
        }
    });

    it("steps the selected channel's runs with Shift:j / Shift:k, clamped at both ends", () => {
        globalStore.set(graphPeekOpenAtom, false);
        globalStore.set(activeSubjectAtom, { kind: "channel", id: "ch1" });
        globalStore.set(activeChannelRunsAtom, [
            { id: "r1", status: "running" },
            { id: "r2", status: "running" },
        ] as any);
        globalStore.set(activeRunIdAtom, { ch1: "r1" });
        const next = byId("jarvis:next-run");
        const prev = byId("jarvis:prev-run");
        expect(next.keys).toBe("Shift:j");
        expect(prev.keys).toBe("Shift:k");

        next.run(jarvisCtx);
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r2");
        next.run(jarvisCtx); // clamped at the end
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r2");
        prev.run(jarvisCtx);
        expect(globalStore.get(activeRunIdAtom)["ch1"]).toBe("r1");
    });

    it("passes the run keys through when the subject is not a channel, or has nothing to switch", () => {
        globalStore.set(graphPeekOpenAtom, false);
        globalStore.set(activeSubjectAtom, { kind: "dossier", id: "d1" });
        expect(byId("jarvis:next-run").run(jarvisCtx)).toBe(false);

        globalStore.set(activeSubjectAtom, { kind: "channel", id: "ch1" });
        globalStore.set(activeChannelRunsAtom, [{ id: "r1", status: "running" }] as any);
        expect(byId("jarvis:next-run").run(jarvisCtx)).toBe(false); // a single run is not a switch
        globalStore.set(activeChannelRunsAtom, []);
        globalStore.set(activeSubjectAtom, null);
    });
});

describe("subagent vs agent Escape", () => {
    // subagent:back reads the focused element (a region that owns its keys keeps Escape); the suite has no DOM
    beforeEach(() => vi.stubGlobal("document", { activeElement: null }));
    afterEach(() => vi.unstubAllGlobals());

    it("routes Escape to subagent-back only while a subagent is focused, else to agent-back", () => {
        const bindings = buildAgentBindings(stubModel());
        const sub = bindings.find((b) => b.id === "subagent:back")!;
        const back = bindings.find((b) => b.id === "agent:back")!;
        expect(sub.keys).toBe("Escape");
        const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };

        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        expect(sub.when!(agentCtx)).toBe(true);
        expect(back.when!(agentCtx)).toBe(false);
        sub.run(agentCtx);
        expect(globalStore.get(focusSubagentAtom)).toBeNull();

        // now that no subagent is focused, Escape falls to agent-back
        expect(sub.when!(agentCtx)).toBe(false);
        expect(back.when!(agentCtx)).toBe(true);
    });

    // subagent:back is the one Escape on this surface that fires while a field has focus, so it is the
    // one that can steal Escape from an open rename box. Escape there means cancel the edit, and the
    // dispatcher runs on window capture — if this binding claims the key the input never sees it, and
    // the box commits on the following blur instead of discarding.
    it("yields Escape to an open row rename, even with a subagent focused", () => {
        const sub = buildAgentBindings(stubModel()).find((b) => b.id === "subagent:back")!;
        const editingCtx: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);

        expect(sub.when!(editingCtx)).toBe(true); // fires while editable — that is the whole problem
        globalStore.set(renamingRowAtom, "tab-1");
        expect(sub.when!(editingCtx)).toBe(false);

        globalStore.set(renamingRowAtom, null);
        expect(sub.when!(editingCtx)).toBe(true);
        globalStore.set(focusSubagentAtom, null);
    });

    // the Agent panel's File tab closes on Escape: opened over a subagent, it must not also leave the subagent
    it("yields Escape to a region that owns its keys, even with a subagent focused", () => {
        const sub = buildAgentBindings(stubModel()).find((b) => b.id === "subagent:back")!;
        const ctx: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        const owned = { closest: (sel: string) => (sel === "[data-owns-keys]" ? {} : null) };
        vi.stubGlobal("document", { activeElement: owned });
        expect(sub.when!(ctx)).toBe(false);
        vi.stubGlobal("document", { activeElement: null });
        expect(sub.when!(ctx)).toBe(true);
        globalStore.set(focusSubagentAtom, null);
    });
});

describe("diff-surface history bindings", () => {
    const ctx = { surface: "files", editable: false, modalOpen: false } as KeyContext;
    const find = (id: string) => buildFilesBindings().find((b) => b.id === id)!;

    beforeEach(() => {
        globalStore.set(historyFiltersAtom, NO_FILTERS);
        globalStore.set(diffScopeAtom, null);
        globalStore.set(graphOnAtom, true);
    });

    it("toggles the graph on Shift+g — bare 'g' is the leader key", () => {
        const b = find("files:toggle-graph");
        expect(b.keys).toBe("Shift:g");
        expect(b.when?.(ctx)).toBe(true);
        b.run(ctx);
        expect(globalStore.get(graphOnAtom)).toBe(false);
    });

    it("does not claim the graph or filter keys while compare is on", () => {
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(find("files:toggle-graph").when?.(ctx)).toBe(false);
        expect(find("files:filter").when?.(ctx)).toBe(false);
    });

    it("offers clear-filters only when a filter is actually active", () => {
        expect(find("files:clear-filters").when?.(ctx)).toBe(false);
        globalStore.set(historyFiltersAtom, { author: "dana", path: "", text: "" });
        expect(find("files:clear-filters").when?.(ctx)).toBe(true);
    });

    // These two bindings reach for a real element. The suite runs in node with no DOM, so `document`
    // is stubbed per case rather than switching the whole file to jsdom for two lookups.
    afterEach(() => vi.unstubAllGlobals());

    it("passes the filter key through when the field is not on screen", () => {
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:filter").run(ctx)).toBe(false);
    });

    it("scrolls history to the top on the g g chord", () => {
        const container = { scrollTop: 800 };
        vi.stubGlobal("document", { querySelector: () => container });
        globalStore.set(historyScrollAtom, 800);
        const b = find("files:top");
        expect(b.keys).toBe("g g");
        b.run(ctx);
        expect(globalStore.get(historyScrollAtom)).toBe(0);
        expect(container.scrollTop).toBe(0);
    });

    // Unlike the history-only keys above, refresh is scoped to `on` — it must survive into compare,
    // which has no filter row or graph of its own but still shows changes that can go stale.
    it("stays live in compare — refresh is not gated by inHistory/inCompare", () => {
        const b = find("files:refresh");
        expect(b.keys).toBe("r");
        expect(b.when?.(ctx)).toBe(true);
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(b.when?.(ctx)).toBe(true);
    });

    it("c enters compare from history and changes the refs inside compare", () => {
        expect(find("files:compare").when?.(ctx)).toBe(true);
        expect(find("files:change-refs").when?.(ctx)).toBe(false);
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        expect(find("files:compare").when?.(ctx)).toBe(false);
        expect(find("files:change-refs").when?.(ctx)).toBe(true);
        expect(find("files:change-refs").keys).toBe("c");
    });

    it("change-refs declines the key when no ref chip is on screen", () => {
        globalStore.set(diffScopeAtom, {
            repo: { origin: { kind: "agent", id: "a1" }, label: "a1" },
            range: { kind: "compare", base: "main", head: "feat", form: "mergebase", from: { kind: "working" } },
        });
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:change-refs").run(ctx)).toBe(false);
    });
});

describe("diff-surface line review send", () => {
    const nav = { surface: "files", editable: false, modalOpen: false, leader: null } as KeyContext;
    const find = (id: string) => buildFilesBindings().find((b) => b.id === id)!;
    const onKey = (keys: string, c: KeyContext = nav) =>
        buildFilesBindings()
            .filter((b) => b.keys === keys && (b.when?.(c) ?? true))
            .map((b) => b.id);
    const comment: LineComment = {
        id: "c1",
        source: "worktree",
        file: "a.ts",
        side: "new",
        startLine: 3,
        endLine: 3,
        quote: ["x"],
        note: "why",
    };
    const withReview = (state: LineReviewState, key = "C:/repo") => {
        globalStore.set(lineReviewsAtom, { [key]: state });
        globalStore.set(activeReviewKeyAtom, "C:/repo");
    };

    afterEach(() => {
        globalStore.set(lineReviewsAtom, {});
        globalStore.set(activeReviewKeyAtom, "");
        vi.unstubAllGlobals();
    });

    it("Ctrl+Enter sends with comments under the active key and no box holding text", () => {
        withReview({ comments: [comment] });
        expect(onKey("Mod:Enter")).toEqual(["files:review-send"]);
        withReview({
            comments: [comment],
            box: { file: "a.ts", side: "new", startLine: 4, endLine: 4, source: "worktree", text: "" },
        });
        expect(onKey("Mod:Enter")).toEqual(["files:review-send"]);
    });

    it("stands down in an editable target, with no comments, with a typed box, or under another key", () => {
        withReview({ comments: [comment] });
        expect(onKey("Mod:Enter", { ...nav, editable: true })).toEqual([]);
        expect(onKey("Mod:Enter", { ...nav, modalOpen: true })).toEqual([]);
        withReview({ comments: [] });
        expect(onKey("Mod:Enter")).toEqual([]);
        withReview({
            comments: [comment],
            box: { file: "a.ts", side: "new", startLine: 4, endLine: 4, source: "worktree", text: "half" },
        });
        expect(onKey("Mod:Enter")).toEqual([]);
        withReview({ comments: [comment] }, "C:/other");
        expect(onKey("Mod:Enter")).toEqual([]);
    });

    it("presses the tray's send button, and lets the key pass when it is missing or disabled", () => {
        withReview({ comments: [comment] });
        const click = vi.fn();
        vi.stubGlobal("document", {
            querySelector: (sel: string) => (sel === "[data-review-send]" ? { click, disabled: false } : null),
        });
        expect(find("files:review-send").run(nav)).not.toBe(false);
        expect(click).toHaveBeenCalledOnce();

        vi.stubGlobal("document", { querySelector: () => ({ click, disabled: true }) });
        expect(find("files:review-send").run(nav)).toBe(false);
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("files:review-send").run(nav)).toBe(false);
        expect(click).toHaveBeenCalledOnce();
    });
});

describe("command palette chord", () => {
    const build = () => {
        const model = {
            surfaceAtom: atom<SurfaceKey>("cockpit"),
            paletteOpenAtom: atom(false),
        } as any;
        return { model, b: buildGlobalBindings(model).find((x) => x.id === "palette")! };
    };

    it("is Mod+P with no `when`, so nothing else can claim the chord", () => {
        const { b } = build();
        expect(b.keys).toBe("Mod:p");
        // no guard at all: reachable from inside a text field, and an always-matching binding is
        // what stops WebView2's print dialog from taking the key on unhandled surfaces
        expect(b.when).toBeUndefined();
    });

    // one overlay on every surface; on Code it opens on the Files scope (palette-scope initialNav)
    it("opens the same search on Code as everywhere else", () => {
        for (const surface of ["cockpit", "code"] as const) {
            const { model, b } = build();
            b.run(ctx(surface));
            expect(globalStore.get(model.paletteOpenAtom)).toBe(true);
        }
    });

    it("toggles shut on a second press", () => {
        const { model, b } = build();
        b.run(ctx("code"));
        b.run(ctx("code"));
        expect(globalStore.get(model.paletteOpenAtom)).toBe(false);
    });
});

describe("new run chord", () => {
    const build = () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        return { model, b: buildGlobalBindings(model).find((x) => x.id === "new-run")! };
    };

    // reachable from a field and the terminal, as New agent's Mod+N is; Mod+R would take Ctrl+R from the shell
    it("is Mod+Shift+R and opens the launcher at the run door from anywhere but a modal", () => {
        const { model, b } = build();
        expect(b.keys).toBe("Mod:Shift:r");
        expect(b.when?.({ ...ctx("agent"), editable: true })).toBe(true);
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("run");
    });
});

describe("new agent chord", () => {
    it("is Mod+N and opens the launcher at the agent door", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit"), launcherAtom: atom<LauncherKind | null>(null) } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "new-agent")!;
        expect(b.keys).toBe("Mod:n");
        b.run(ctx());
        expect(globalStore.get(model.launcherAtom)).toBe("agent");
    });
});

describe("code surface bindings", () => {
    const find = (id: string) => {
        const b = buildCodeBindings().find((x) => x.id === id);
        if (b == null) {
            throw new Error(`no binding ${id}`);
        }
        return b;
    };
    const code = ctx("code");

    beforeEach(() => {
        globalStore.set(codeSearchModeAtom, "files");
    });
    afterEach(() => vi.unstubAllGlobals());

    // Files have no chord of their own — the single global "palette" binding opens the search on its
    // Files scope here (see "command palette chord" above), so a chord here would be a second,
    // conflicting claim on the same key.
    it("owns no Mod+P of its own — the global search binding covers files", () => {
        expect(buildCodeBindings().find((b) => b.keys === "Mod:p")).toBeUndefined();
    });

    it("keeps bare-letter refresh out of the editor, while save survives it", () => {
        expect(find("code:refresh").when?.({ ...code, editable: true })).toBe(false);
        expect(find("code:save").when?.({ ...code, editable: true })).toBe(true);
    });

    // The inline name input sits inside the tree, so its focusin bubbles and leaves the tree
    // "focused". Without the !editable gate, Enter here runs tree-activate — it opens the cursor's
    // file and the create/rename never commits.
    it("stands the tree bindings down while the inline name input has focus", () => {
        globalStore.set(codeTreeFocusedAtom, true);
        const typing = { ...code, editable: true };
        for (const id of ["code:tree-activate", "code:new-file", "code:new-folder", "code:rename", "code:delete"]) {
            expect(find(id).when?.(typing), id).toBe(false);
        }
        expect(find("code:tree-activate").when?.(code)).toBe(true);
        globalStore.set(codeTreeFocusedAtom, false);
    });

    it("opens the collapsed sidebar before switching to Search", () => {
        const clicked = vi.fn();
        const focused = vi.fn();
        const opener = { classList: { contains: () => false }, click: clicked, focus: focused };
        vi.stubGlobal("document", { querySelector: vi.fn(() => opener) });
        vi.stubGlobal("window", { requestAnimationFrame: vi.fn() });

        find("code:search").run(code);

        expect(globalStore.get(codeSearchModeAtom)).toBe("search");
        expect(clicked).toHaveBeenCalledOnce();
        expect(focused).toHaveBeenCalledOnce();
    });

    // The pane focuses its input only when it mounts, and nothing remounts it when Search is already
    // the column's mode — so without this the chord from the editor leaves the caret in Monaco.
    it("puts the caret in the search input when Search is already showing", () => {
        const input = { focus: vi.fn(), select: vi.fn() };
        const querySelector = vi.fn((selector: string) => (selector.includes("data-code-search-input") ? input : null));
        vi.stubGlobal("document", { querySelector });
        vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });
        globalStore.set(codeSearchModeAtom, "search");

        find("code:search").run(code);

        expect(input.focus).toHaveBeenCalledOnce();
        expect(input.select).toHaveBeenCalledOnce();
    });

    it("focuses the reachable opener instead of the hidden tree while collapsed", () => {
        const treeFocus = vi.fn();
        const tree = { closest: vi.fn(() => null), focus: treeFocus };
        const openerFocus = vi.fn();
        const opener = { classList: { contains: () => false }, click: vi.fn(), focus: openerFocus };
        const querySelector = vi.fn((selector: string) => (selector.includes("Expand Code sidebar") ? opener : tree));
        vi.stubGlobal("document", { querySelector });
        vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });

        find("code:focus-tree").run(code);

        expect(openerFocus).toHaveBeenCalledOnce();
        expect(treeFocus).toHaveBeenCalledOnce();
    });
});

describe("leader reachability and the fullscreen chord", () => {
    const model = stubModel();
    const inTerm: KeyContext = { surface: "agent", editable: true, modalOpen: false, leader: null };
    const inTermLeader: KeyContext = { ...inTerm, leader: "g" };

    it("registers a documentation-only leader:enter binding on the alias chord", () => {
        const b = buildGlobalBindings(model).find((x) => x.id === "leader:enter")!;
        expect(b).toBeDefined();
        expect(b.keys).toBe("Mod:g");
        // documentation only — the matcher performs leader entry, so this must never consume the key
        expect(b.run(inTerm)).toBe(false);
    });

    it("leader:enter is advertised while the terminal holds focus", () => {
        const b = buildGlobalBindings(model).find((x) => x.id === "leader:enter")!;
        expect(b.when?.(inTerm) ?? true).toBe(true);
    });

    it("surface teleports are dormant in the terminal but live under the leader", () => {
        const go = buildGlobalBindings(model).find((x) => x.id === "go:agent")!;
        expect(go.when!(inTerm)).toBe(false);
        expect(go.when!(inTermLeader)).toBe(true);
    });

    it("the details rail is dormant in the terminal but live under the leader", () => {
        const rail = buildAgentBindings(model).find((x) => x.id === "agent:toggle-rail")!;
        expect(rail.when!(inTerm)).toBe(false);
        expect(rail.when!(inTermLeader)).toBe(true);
    });

    it("Escape-keyed navigation stays dormant in BOTH postures (the matcher owns Escape)", () => {
        const back = buildAgentBindings(model).find((x) => x.id === "agent:back")!;
        expect(back.when!(inTerm)).toBe(false);
        expect(back.when!(inTermLeader)).toBe(false);
    });

    it("F11 toggles fullscreen and is live while the terminal holds focus", () => {
        const b = buildAgentBindings(model).find((x) => x.id === "agent:fullscreen-chord")!;
        expect(b.keys).toBe("F11");
        expect(b.when!(inTerm)).toBe(true);
        expect(b.when!({ ...inTerm, surface: "cockpit" })).toBe(false);
    });
});

describe("agent:review", () => {
    const reviewAsk = {
        askId: "a1",
        questions: [{ header: "Spec review", question: "/r/spec.md\n- one", options: [{ label: "Approve" }] }],
    };
    const plainAsk = { askId: "a2", questions: [{ header: "Flake fix", question: "Retry?", options: [] }] };
    const modelFocusing = (id: string) =>
        ({
            focusIdAtom: atom<string>(id),
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([
                { id: "lead", state: "asking", ask: reviewAsk },
                { id: "worker", state: "asking", ask: plainAsk },
                { id: "writer", state: "asking", ask: docAsk("/r/paper/main.tex") },
            ]),
        }) as any;
    const review = (model: any) => buildAgentBindings(model).find((b) => b.id === "agent:review")!;

    afterEach(() => {
        globalStore.set(docReviewAtom, null);
        syncDocReview("writer", undefined);
    });

    it("opens a Doc review as the review view, not the dialog", () => {
        expect(review(modelFocusing("writer")).run(ctx("agent"))).not.toBe(false);
        expect(getDocReview("writer")?.mode).toBe("review");
        expect(globalStore.get(docReviewAtom)).toBeNull();
    });

    it("is r on the Agent surface, off while typing", () => {
        const b = review(modelFocusing("lead"));
        expect(b.keys).toBe("r");
        expect(b.when!(ctx("agent"))).toBe(true);
        expect(b.when!({ ...ctx("agent"), editable: true })).toBe(false);
        expect(b.when!(ctx("cockpit"))).toBe(false);
    });

    it("opens the focused agent's doc review", () => {
        expect(review(modelFocusing("lead")).run(ctx("agent"))).not.toBe(false);
        expect(globalStore.get(docReviewAtom)).toBe("lead");
    });

    it("lets the key pass when the focused agent's ask is not a doc review", () => {
        expect(review(modelFocusing("worker")).run(ctx("agent"))).toBe(false);
        expect(globalStore.get(docReviewAtom)).toBeNull();
    });
});

// remote callers (wsh ui do) must get the user's confirmation for these; the keyboard still runs them directly
describe("destructive bindings", () => {
    it("flags the irreversible actions that do not confirm on their own", () => {
        expect(buildCodeBindings().find((b) => b.id === "code:save")?.destructive).toBe(true);
    });

    it("leaves actions that confirm themselves, or can be undone, unflagged", () => {
        expect(buildCodeBindings().find((b) => b.id === "code:delete")?.destructive).toBeUndefined();
    });
});

describe("agent canvas mode keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const inTerm: KeyContext = { ...nav, editable: true };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;
    const active = (id: string, c: KeyContext = nav) => find(id).when!(c);

    beforeEach(() => {
        model = { ...stubModel("a1"), surfaceAtom: atom<SurfaceKey>("agent") };
        attachCanvas("a1", { topic: "t", dir: "C:\\p\\.superpowers\\design\\t", projectDir: "C:\\p" }, 0);
        updateCanvas("a1", (s) => ({
            ...s,
            status: "ready",
            boards: [
                { name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 },
                { name: "States.dc.html", x: 0, y: 0, w: 1440, h: 900 },
            ],
        }));
    });

    afterEach(() => {
        detachCanvas("a1");
    });

    it("c opens the canvas from the nav, not with no canvas or from inside the terminal", () => {
        expect(active("agent:canvas-open")).toBe(true);
        expect(active("agent:canvas-open", inTerm)).toBe(false);
        detachCanvas("a1");
        expect(active("agent:canvas-open")).toBe(false);
    });

    it("running c switches the focused agent to canvas mode", () => {
        find("agent:canvas-open").run(nav);
        expect(getCanvas("a1")!.mode).toBe("canvas");
    });

    it("in canvas mode: c, [ ], m and the agent switches are live; the surface, rail, fullscreen and back keys stand down", () => {
        setCanvasMode("a1", "canvas", 1);
        for (const id of [
            "agent:canvas-close",
            "agent:canvas-prev",
            "agent:canvas-next",
            "agent:mark-start",
            "agent:prev",
            "agent:next",
            "agent:prev-k",
            "agent:next-j",
            "cycle-agent-next",
            "cycle-agent-prev",
        ]) {
            expect(active(id), id).toBe(true);
        }
        expect(active("agent:canvas-open")).toBe(false);
        expect(active("agent:mark-stop")).toBe(false);
        for (const id of [
            "surface:next",
            "surface:prev",
            "agent:toggle-rail",
            "agent:fullscreen",
            "agent:fullscreen-chord",
            "agent:back",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("the surface switch still works on other surfaces while an agent is in canvas mode", () => {
        setCanvasMode("a1", "canvas", 1);
        expect(active("surface:next", { ...nav, surface: "jarvis" })).toBe(true);
    });

    it("board keys wait for the board to load", () => {
        setCanvasMode("a1", "canvas", 1);
        updateCanvas("a1", (s) => ({ ...s, status: "probing" }));
        expect(active("agent:canvas-next")).toBe(false);
        expect(active("agent:mark-start")).toBe(false);
        expect(active("agent:canvas-close")).toBe(true);
    });

    it("while marking: m stops marking, and the board keys and m-to-mark stand down", () => {
        setCanvasMode("a1", "canvas", 1);
        setMarking("a1", true);
        expect(active("agent:mark-stop")).toBe(true);
        expect(active("agent:mark-start")).toBe(false);
        expect(active("agent:canvas-prev")).toBe(false);
        expect(active("agent:canvas-next")).toBe(false);
        expect(active("agent:canvas-close")).toBe(true);
        find("agent:mark-stop").run(nav);
        expect(getCanvas("a1")!.marking).toBe(false);
    });

    it("] steps to the next board", () => {
        setCanvasMode("a1", "canvas", 1);
        find("agent:canvas-next").run(nav);
        expect(getCanvas("a1")!.board).toBe("States.dc.html");
        find("agent:canvas-prev").run(nav);
        expect(getCanvas("a1")!.board).toBe("Main.dc.html");
    });

    it("c from canvas mode goes back to the terminal", () => {
        setCanvasMode("a1", "canvas", 1);
        find("agent:canvas-close").run(nav);
        expect(getCanvas("a1")!.mode).toBe("terminal");
    });

    describe("Ctrl+Enter sends the marks", () => {
        const MARK = { x: 0, y: 0, w: 20, h: 20, note: "" };
        afterEach(() => vi.unstubAllGlobals());

        it("only while marking with at least one mark", () => {
            setCanvasMode("a1", "canvas", 1);
            expect(active("agent:canvas-send")).toBe(false);
            setMarking("a1", true);
            expect(active("agent:canvas-send")).toBe(false);
            updateCanvas("a1", (s) => ({ ...s, marks: [MARK] }));
            expect(active("agent:canvas-send")).toBe(true);
        });

        it("stays live in a note input, and yields to a modal and other surfaces", () => {
            setCanvasMode("a1", "canvas", 1);
            setMarking("a1", true);
            updateCanvas("a1", (s) => ({ ...s, marks: [MARK] }));
            expect(active("agent:canvas-send", inTerm)).toBe(true);
            expect(active("agent:canvas-send", { ...nav, modalOpen: true })).toBe(false);
            expect(active("agent:canvas-send", { ...nav, surface: "jarvis" })).toBe(false);
        });

        it("clicks the tray's Send button, and lets the key pass with none on screen", () => {
            const click = vi.fn();
            const querySelector = vi.fn((sel: string) => (sel === "[data-canvas-send]" ? { click } : null));
            vi.stubGlobal("document", { querySelector });
            find("agent:canvas-send").run(nav);
            expect(click).toHaveBeenCalledOnce();
            vi.stubGlobal("document", { querySelector: () => null });
            expect(find("agent:canvas-send").run(nav)).toBe(false);
        });
    });

    it("another focused agent without canvas mode keeps its keys", () => {
        setCanvasMode("a1", "canvas", 1);
        globalStore.set(model.focusIdAtom, "a2");
        expect(active("agent:toggle-rail")).toBe(true);
        expect(active("surface:next")).toBe(true);
        expect(active("agent:canvas-close")).toBe(false);
        expect(getCanvas("a1")!.mode).toBe("canvas");
    });
});

describe("agent review mode keys", () => {
    const nav: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...nav, editable: true };
    let model: any;
    const all = () => [...buildGlobalBindings(model), ...buildListNavBindings(model), ...buildAgentBindings(model)];
    const find = (id: string) => all().find((b) => b.id === id)!;
    const active = (id: string, c: KeyContext = nav) => find(id).when!(c);
    const onKey = (keys: string, c: KeyContext = nav) =>
        all()
            .filter((b) => b.keys === keys && (b.when?.(c) ?? true))
            .map((b) => b.id);
    const focusWith = (ask: any) => {
        model = {
            focusIdAtom: atom<string | undefined>("a1") as PrimitiveAtom<string | undefined>,
            surfaceAtom: atom<SurfaceKey>("agent"),
            agentsAtom: atom([{ id: "a1", name: "paper-writer", state: "asking", ask }]),
        };
        syncDocReview("a1", ask);
    };

    beforeEach(() => focusWith(docAsk("/r/paper/main.tex")));

    afterEach(() => {
        syncDocReview("a1", undefined);
        detachCanvas("a1");
        globalStore.set(docReviewAtom, null);
        vi.unstubAllGlobals();
    });

    it("r resolves to exactly one binding in each mode, and goes both ways", () => {
        expect(onKey("r")).toEqual(["agent:review"]);
        find("agent:review").run(nav);
        expect(getDocReview("a1")!.mode).toBe("review");
        expect(onKey("r")).toEqual(["agent:review-close"]);
        find("agent:review-close").run(nav);
        expect(getDocReview("a1")!.mode).toBe("terminal");
        expect(onKey("r")).toEqual(["agent:review"]);

        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        setAgentView("a1", "canvas", 1);
        expect(onKey("r")).toEqual(["agent:review"]);
        find("agent:review").run(nav);
        expect(getDocReview("a1")!.mode).toBe("review");
        expect(getCanvas("a1")!.mode).toBe("terminal");
        expect(onKey("r")).toEqual(["agent:review-close"]);
    });

    it("in review mode: [ ], c and Ctrl+Enter are the review's; the surface switch, canvas, rail, fullscreen and back keys stand down", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        setAgentView("a1", "review", 1);
        expect(onKey("[")).toEqual(["agent:review-prev"]);
        expect(onKey("]")).toEqual(["agent:review-next"]);
        expect(onKey("c")).toEqual(["agent:review-comment"]);
        expect(onKey("Mod:Enter")).toEqual(["agent:review-approve"]);
        for (const id of ["agent:prev", "agent:next", "agent:prev-k", "agent:next-j"]) {
            expect(active(id), id).toBe(true);
        }
        for (const id of [
            "surface:next",
            "surface:prev",
            "agent:canvas-open",
            "agent:toggle-rail",
            "agent:fullscreen",
            "agent:fullscreen-chord",
            "agent:back",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("[ ] step the LaTeX tabs", () => {
        setAgentView("a1", "review", 1);
        find("agent:review-next").run(nav);
        expect(getDocReview("a1")!.tab).toBe("pdf");
        find("agent:review-prev").run(nav);
        expect(getDocReview("a1")!.tab).toBe("changes");
    });

    it("a markdown note has no tabs: [ ] do nothing, and the surface switch still stands down", () => {
        focusWith(docAsk("/r/notes/next_step.md"));
        setAgentView("a1", "review", 1);
        expect(onKey("[")).toEqual([]);
        expect(onKey("]")).toEqual([]);
        expect(onKey("c")).toEqual(["agent:review-comment"]);
    });

    it("in terminal mode the review keys stand down", () => {
        for (const id of ["agent:review-close", "agent:review-prev", "agent:review-next", "agent:review-comment"]) {
            expect(active(id), id).toBe(false);
        }
        expect(active("agent:review-approve", typing)).toBe(false);
        expect(active("agent:review-request", typing)).toBe(false);
        expect(active("surface:next")).toBe(true);
    });

    it("in canvas mode the review keys stand down and the canvas keeps its own", () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        expect(onKey("c")).toEqual(["agent:canvas-open"]);
        find("agent:canvas-open").run(nav);
        expect(getCanvas("a1")!.mode).toBe("canvas");
        expect(getDocReview("a1")!.mode).toBe("terminal");
        expect(onKey("c")).toEqual(["agent:canvas-close"]);
        for (const id of [
            "agent:review-close",
            "agent:review-comment",
            "agent:review-prev",
            "agent:review-approve",
            "agent:review-request",
        ]) {
            expect(active(id), id).toBe(false);
        }
    });

    it("c clicks the Comment button, and lets the key pass with none on screen", () => {
        setAgentView("a1", "review", 1);
        const click = vi.fn();
        vi.stubGlobal("document", {
            querySelector: (sel: string) => (sel === "[data-doc-review-comment]" ? { click } : null),
        });
        find("agent:review-comment").run(nav);
        expect(click).toHaveBeenCalledOnce();
        vi.stubGlobal("document", { querySelector: () => null });
        expect(find("agent:review-comment").run(nav)).toBe(false);
    });

    it("Ctrl+Enter clicks the accent answer, live in the note input; a draft comment keeps its own Ctrl+Enter", () => {
        setAgentView("a1", "review", 1);
        expect(active("agent:review-approve", typing)).toBe(true);
        expect(active("agent:review-approve", { ...nav, modalOpen: true })).toBe(false);
        expect(active("agent:review-approve", { ...nav, surface: "cockpit" })).toBe(false);

        const click = vi.fn();
        const note = { closest: () => null };
        vi.stubGlobal("document", {
            activeElement: note,
            querySelector: (sel: string) => (sel === "[data-doc-review-send]" ? { click } : null),
        });
        find("agent:review-approve").run(typing);
        expect(click).toHaveBeenCalledOnce();

        const draft = { closest: (sel: string) => (sel === "[data-doc-review-draft]" ? {} : null) };
        vi.stubGlobal("document", { activeElement: draft, querySelector: () => ({ click }) });
        expect(find("agent:review-approve").run(typing)).toBe(false);
        expect(click).toHaveBeenCalledOnce();
    });

    it("Ctrl+Enter is Approve until there is something to send, then Request changes", () => {
        setAgentView("a1", "review", 1);
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
        expect(find("agent:review-approve").label).toBe("Approve");

        setGeneralNote("a1", "tighten §3");
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-request"]);
        expect(find("agent:review-request").label).toBe("Request changes");
        setGeneralNote("a1", "  ");
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);

        const anchor = { sectionIndex: 0, sectionLabel: "§1", paragraph: 1, sentences: [0, 0] as [number, number] };
        addComment("a1", { ...anchor, id: "d", quote: "q", selectedText: "q", note: "", draft: true });
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
        addComment("a1", { ...anchor, id: "s", quote: "q", selectedText: "q", note: "say why", draft: false });
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-request"]);
    });

    it("Ctrl+Enter stands down in History and a session, which hide the review pane without leaving review mode", () => {
        setAgentView("a1", "review", 1);
        try {
            for (const mode of ["history", "session"] as const) {
                globalStore.set(centerModeAtom, mode);
                expect(onKey("Mod:Enter", typing)).toEqual([]);
                setGeneralNote("a1", "tighten §3");
                expect(onKey("Mod:Enter", typing)).toEqual([]);
                setGeneralNote("a1", "");
            }
        } finally {
            globalStore.set(centerModeAtom, "terminal");
        }
        expect(onKey("Mod:Enter", typing)).toEqual(["agent:review-approve"]);
    });
});

describe("final shots viewer bindings", () => {
    afterEach(() => globalStore.set(finalShotsViewerOpenAtom, false));

    function build() {
        const calls: string[] = [];
        const bindings = buildFinalShotsBindings({
            scenario: (d) => calls.push(`scenario ${d}`),
            shot: (d) => calls.push(`shot ${d}`),
            zoom: () => calls.push("zoom"),
            steps: () => calls.push("steps"),
            close: () => calls.push("close"),
        });
        return { bindings, calls };
    }

    it("maps the arrows, z, s and Escape onto their handlers", () => {
        const { bindings, calls } = build();
        const byKey = new Map(bindings.map((b) => [b.keys, b]));
        for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "z", "s", "Escape"]) {
            byKey.get(key)!.run(ctx("jarvis"));
        }
        expect(calls).toEqual(["scenario -1", "scenario 1", "shot -1", "shot 1", "zoom", "steps", "close"]);
        expect(bindings).toHaveLength(7);
    });

    it("is active only while the viewer is open, whatever the context says", () => {
        const { bindings } = build();
        expect(bindings.some((b) => b.when!(ctx("jarvis")))).toBe(false);
        globalStore.set(finalShotsViewerOpenAtom, true);
        expect(bindings.every((b) => b.when!({ ...ctx("jarvis"), modalOpen: true }))).toBe(true);
    });
});

describe("Agent centre modes", () => {
    const agentCtx: KeyContext = { surface: "agent", editable: false, modalOpen: false, leader: null };
    const typing: KeyContext = { ...agentCtx, editable: true };
    const find = (id: string, model: any = stubModel()) => buildAgentBindings(model).find((b) => b.id === id)!;
    const CENTER_MODES = ["history", "session"] as const;

    afterEach(() => {
        vi.unstubAllGlobals();
        globalStore.set(centerModeAtom, "terminal");
        globalStore.set(focusSubagentAtom, null);
        detachCanvas("a1");
        syncDocReview("a1", undefined);
    });

    // a1 focused with a ready canvas, still in terminal mode
    const focusedWithCanvas = () => {
        attachCanvas("a1", { topic: "t", dir: "/p/.superpowers/design/t", projectDir: "/p" }, 0);
        updateCanvas("a1", (s) => ({
            ...s,
            status: "ready",
            boards: [{ name: "Main.dc.html", x: 0, y: 0, w: 1440, h: 900 }],
        }));
        return stubModel("a1");
    };

    it("keeps the agent keys live on the terminal and stands them down while History or a session is open", () => {
        const next = find("agent:next-j");
        const rail = find("agent:toggle-rail");
        expect(next.when!(agentCtx)).toBe(true);
        expect(rail.when!(agentCtx)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(next.when!(agentCtx)).toBe(false);
            expect(rail.when!(agentCtx)).toBe(false);
        }
    });

    it("stands the F11 chord down while History or a session is open, and keeps it live in the terminal", () => {
        const f11 = find("agent:fullscreen-chord");
        expect(f11.when!(agentCtx)).toBe(true);
        expect(f11.when!(typing)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(f11.when!(agentCtx)).toBe(false);
            expect(f11.when!(typing)).toBe(false);
        }
    });

    it("stands the canvas send down while History or a session is open, and keeps it live in a note input", () => {
        const model = focusedWithCanvas();
        setAgentView("a1", "canvas", 1);
        setMarking("a1", true);
        updateCanvas("a1", (s) => ({ ...s, marks: [{ x: 0, y: 0, w: 20, h: 20, note: "" }] }));
        const send = find("agent:canvas-send", model);
        expect(send.when!(typing)).toBe(true);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(send.when!(agentCtx)).toBe(false);
            expect(send.when!(typing)).toBe(false);
        }
        globalStore.set(centerModeAtom, "terminal");
        expect(send.when!(typing)).toBe(true);
    });

    it("gives Escape to the terminal while History or a session is open, and to the Cockpit otherwise", () => {
        const back = find("agent:back");
        const leave = find("agent:leave-center");
        expect(leave.keys).toBe("Escape");
        expect(back.when!(agentCtx)).toBe(true);
        expect(leave.when!(agentCtx)).toBe(false);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            expect(back.when!(agentCtx)).toBe(false);
            expect(leave.when!(agentCtx)).toBe(true);
        }
    });

    it("lets a focused subagent's Escape close it before leaving the centre mode", () => {
        vi.stubGlobal("document", { activeElement: null });
        globalStore.set(centerModeAtom, "session");
        globalStore.set(focusSubagentAtom, { parentId: "p", agentId: "s" } as any);
        expect(find("agent:leave-center").when!(agentCtx)).toBe(false);
        expect(find("subagent:back").when!(agentCtx)).toBe(true);
    });

    it("leaves Escape inside a text field to the field, and to an open modal", () => {
        globalStore.set(centerModeAtom, "history");
        const leave = find("agent:leave-center");
        expect(leave.when!({ ...agentCtx, editable: true })).toBe(false);
        expect(leave.when!({ ...agentCtx, modalOpen: true })).toBe(false);
        expect(leave.when!(agentCtx)).toBe(true);
    });

    it("still leaves History or a session while the focused agent's canvas or review is on", () => {
        const model = focusedWithCanvas();
        const leave = find("agent:leave-center", model);
        const back = find("agent:back", model);
        for (const mode of CENTER_MODES) {
            globalStore.set(centerModeAtom, mode);
            setAgentView("a1", "canvas", 1);
            expect(getCanvas("a1")!.mode).toBe("canvas");
            expect(leave.when!(agentCtx)).toBe(true);
            expect(back.when!(agentCtx)).toBe(false);
            syncDocReview("a1", docAsk("/r/paper/main.tex"));
            setAgentView("a1", "review", 2);
            expect(getDocReview("a1")!.mode).toBe("review");
            expect(leave.when!(agentCtx)).toBe(true);
            expect(back.when!(agentCtx)).toBe(false);
            setAgentView("a1", "terminal", 3);
            syncDocReview("a1", undefined);
        }
    });

    it("returns to the terminal when run", () => {
        globalStore.set(centerModeAtom, "history");
        find("agent:leave-center").run(agentCtx);
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
});

describe("g s: Conversation History", () => {
    afterEach(() => globalStore.set(centerModeAtom, "terminal"));

    it("opens History in the Agent surface and leaves g a on the Agent surface itself", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("cockpit") } as any;
        const bindings = buildGlobalBindings(model);
        const history = bindings.find((b) => b.id === "go:history")!;
        expect(history.keys).toBe("g s");
        expect(bindings.find((b) => b.id === "go:agent")!.keys).toBe("g a");
        history.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
});

describe("g w: what's waiting", () => {
    afterEach(() => globalStore.set(petPeekOpenAtom, false));

    // the creature's peek is otherwise reached only by a click or by tabbing to the sprite
    it("opens the creature's peek from any surface, and from inside the terminal through the leader", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:waiting")!;
        expect(b.keys).toBe("g w");
        expect(b.when?.(ctx("agent"))).toBe(true);
        expect(b.when?.({ ...ctx("agent"), editable: true, leader: "g" })).toBe(true);
        b.run(ctx("agent"));
        expect(globalStore.get(petPeekOpenAtom)).toBe(true);
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });

    it("stays out of the way of an open modal, the peek included", () => {
        const model = { surfaceAtom: atom<SurfaceKey>("agent") } as any;
        const b = buildGlobalBindings(model).find((x) => x.id === "go:waiting")!;
        expect(b.when?.({ ...ctx(), modalOpen: true })).toBe(false);
    });
});
