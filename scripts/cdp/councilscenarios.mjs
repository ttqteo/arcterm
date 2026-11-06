// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Council's scenarios (docs/superpowers/specs/2026-10-21-council-design.md, plan docs/superpowers/plans/
// 2026-10-21-council.md): council-tree, council-setup, council-ask, council-discussion, council-ideas (the Ideas rail
// grouped by where the seats stand, 2026-11-04-council-ideas-memory.md), council-memory (the rail's Memory tab and Chốt,
// the same plan), council-routing (the composer of a
// whole-council message the router takes, 2026-11-03-council-reply-routing.md), council-summary, council-map
// (docs/superpowers/plans/2026-11-03-council-stronger.md), council-needs-you and council-regions (the screenshot regions a
// seat cites, 2026-11-04-council-screenshot-regions-design.md) and council-final-proposal (Copy and Pin to Report on a
// message, and the Report's Final proposal section, 2026-11-04-council-final-proposal-design.md) and jarvis-council-sheet
// (a council's report in the Brief's sheet, 2026-11-05-jarvis-revamp-design.md decision 8). Each one's
// arrange / assert / teardown live in ./council/<view>.mjs, so the tasks that build a view touch only their own file; the
// shared fixtures (a temp project, the six rail-apps councils, the RpcApi stand-ins) are ./council/fixtures.mjs.
//
// `fx` is the helpers scenarios.mjs owns that the fixtures need: waitForProjectInConfig, polishReload, openRailTerminal,
// waveService, openPalette for the scenario that drives the palette, and openLauncherStart, which focuses the New
// dialog's Start column before a Council row is clicked. No scenario here spends tokens or starts an
// agent: an action that would call a model has its RpcApi command replaced in the page (fixtures.mjs stubRpc).

import { councilDiscussion } from "./council/discussion.mjs";
import { councilFinalProposal } from "./council/finalproposal.mjs";
import { councilIdeas } from "./council/ideas.mjs";
import { councilMap } from "./council/map.mjs";
import { councilMemory } from "./council/memory.mjs";
import { councilNeedsYou } from "./council/needsyou.mjs";
import { councilRegions } from "./council/regions.mjs";
import { councilRouting } from "./council/routing.mjs";
import { councilAsk, councilSetup } from "./council/setup.mjs";
import { councilSheet } from "./council/sheet.mjs";
import { councilSummary } from "./council/summary.mjs";
import { councilTree } from "./council/tree.mjs";

export function makeCouncilScenarios(fx) {
    // the manifest shape (scenarios.mjs, top): the hooks get fx as their last argument
    const scenario = (name, hooks) => ({
        name,
        surface: hooks.surface ?? "agent",
        arrange: (h) => hooks.arrange(h, fx),
        assert: (h, ctx) => hooks.assert(h, ctx, fx),
        teardown: (h, ctx) => hooks.teardown(h, ctx, fx),
    });
    return [
        scenario("council-tree", councilTree),
        scenario("council-setup", councilSetup),
        scenario("council-ask", councilAsk),
        scenario("council-discussion", councilDiscussion),
        scenario("council-ideas", councilIdeas),
        scenario("council-memory", councilMemory),
        scenario("council-routing", councilRouting),
        scenario("council-summary", councilSummary),
        scenario("council-map", councilMap),
        scenario("council-needs-you", councilNeedsYou),
        scenario("council-regions", councilRegions),
        scenario("council-final-proposal", councilFinalProposal),
        scenario("jarvis-council-sheet", councilSheet),
    ];
}
