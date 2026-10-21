// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-discussion (docs/superpowers/plans/2026-10-21-council.md, Task 14): the Discussion in round 1, round 2, at the
// pause, done, failed and not run. A placeholder until Task 14 writes it; Task 14 owns this file.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Build the
// project and its councils with ./fixtures.mjs (arrangeCouncilProject, seedCouncil for round1, round2, awaiting, done,
// failed and notrun, openCouncil, teardownCouncilProject); every action that calls a model goes through stubRpc.

export const councilDiscussion = {
    async arrange() {
        return {};
    },
    async assert() {
        return [{ step: "council-discussion is built", ok: false, detail: "not built yet" }];
    },
    async teardown() {},
};
