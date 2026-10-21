// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-summary (docs/superpowers/plans/2026-10-21-council.md, Task 15): the Summary, its directions and matrix, Save
// as doc, Run again and the follow-up composer. A placeholder until Task 15 writes it; Task 15 owns this file.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Build the
// project and its councils with ./fixtures.mjs (arrangeCouncilProject, seedCouncil for done, openCouncil(h, id,
// "summary"), teardownCouncilProject); every action that calls a model goes through stubRpc. Save as doc writes into
// the temp project (ctx.repo), never the repo checkout.

export const councilSummary = {
    async arrange() {
        return {};
    },
    async assert() {
        return [{ step: "council-summary is built", ok: false, detail: "not built yet" }];
    },
    async teardown() {},
};
