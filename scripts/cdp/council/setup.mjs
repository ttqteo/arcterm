// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-setup and council-ask (docs/superpowers/plans/2026-10-21-council.md, Task 16): the Setup form, the
// coordinator's suggestion and Start council; and Ask the council on an Ideas question. Placeholders until Task 16 writes
// them; Task 16 owns this file.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Build the
// project with ./fixtures.mjs (arrangeCouncilProject, openCouncilSetup(h, project, prefill), stubRpc with `pending` and
// `reject` for Suggesting… and a failed suggestion, resolveStub, rejectStub, rpcCalls, teardownCouncilProject). Nothing
// here starts a council or spends a token: Start council and Suggest are always stubbed.

export const councilSetup = {
    async arrange() {
        return {};
    },
    async assert() {
        return [{ step: "council-setup is built", ok: false, detail: "not built yet" }];
    },
    async teardown() {},
};

export const councilAsk = {
    async arrange() {
        return {};
    },
    async assert() {
        return [{ step: "council-ask is built", ok: false, detail: "not built yet" }];
    },
    async teardown() {},
};
