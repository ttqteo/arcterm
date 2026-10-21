// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Council's scenarios (docs/superpowers/specs/2026-10-21-council-design.md, plan docs/superpowers/plans/
// 2026-10-21-council.md): council-tree, council-setup, council-ask, council-discussion and council-summary. Each one's
// arrange / assert / teardown live in ./council/<view>.mjs, so the tasks that build a view touch only their own file; the
// shared fixtures (a temp project, the six rail-apps councils, the RpcApi stand-ins) are ./council/fixtures.mjs.
//
// `fx` is the helpers scenarios.mjs owns that the fixtures need: waitForProjectInConfig, polishReload, openRailTerminal,
// waveService, and openPalette for the scenario that drives the palette. No scenario here spends tokens or starts an
// agent: an action that would call a model has its RpcApi command replaced in the page (fixtures.mjs stubRpc).

import { councilDiscussion } from "./council/discussion.mjs";
import { councilAsk, councilSetup } from "./council/setup.mjs";
import { councilSummary } from "./council/summary.mjs";
import { councilTree } from "./council/tree.mjs";

export function makeCouncilScenarios(fx) {
    // the manifest shape (scenarios.mjs, top): the hooks get fx as their last argument
    const scenario = (name, hooks) => ({
        name,
        surface: "agent",
        arrange: (h) => hooks.arrange(h, fx),
        assert: (h, ctx) => hooks.assert(h, ctx, fx),
        teardown: (h, ctx) => hooks.teardown(h, ctx, fx),
    });
    return [
        scenario("council-tree", councilTree),
        scenario("council-setup", councilSetup),
        scenario("council-ask", councilAsk),
        scenario("council-discussion", councilDiscussion),
        scenario("council-summary", councilSummary),
    ];
}
