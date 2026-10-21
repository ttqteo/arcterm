// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// council-tree (docs/superpowers/plans/2026-10-21-council.md, Task 13): council rows in the Agent tree, the New council
// row and the palette's New council… row. A placeholder until Task 13 writes it; Task 13 owns this file.
//
// The hooks are called by councilscenarios.mjs as arrange(h, fx), assert(h, ctx, fx), teardown(h, ctx, fx). Build the
// project and its councils with ./fixtures.mjs (arrangeCouncilProject with `extraProjects` for a project with no
// council, seedCouncil, openCouncil, teardownCouncilProject); `fx` also holds openPalette.

export const councilTree = {
    async arrange() {
        return {};
    },
    async assert() {
        return [{ step: "council-tree is built", ok: false, detail: "not built yet" }];
    },
    async teardown() {},
};
