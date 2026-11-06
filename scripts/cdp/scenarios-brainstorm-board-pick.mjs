// brainstorm-board-pick: STUB. Task 7 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: a board an open
// question's answer names gets a pick row under the full-size board ("Pick A" sends that answer). Copy its seed,
// `brainstorm-mode` in scenarios.mjs (a brainstorm terminal made with bsArrangeAgent, a registered project, the canvas boards
// written under .superpowers/design/<topic>/project), and look at the board scenarios in scenarios-brainstorm-*.mjs for the
// shape of a module that takes the kit.
//
// kit is scenarios.mjs's BS_KIT, the brainstorm helpers, with bsClosePeek, bsSeeHints, openCanvasTerminal, polishReload,
// waitForProjectInConfig and openPalette added for these two tasks. Task 7 takes what it needs with
// `export default function (kit)`. What `brainstorm-mode` uses that BS_KIT still lacks (the BS_Q* fixtures, bsHover, bsEscape,
// ...) is duplicated here, not added to scenarios.mjs. The seed also uses node:fs, node:os and node:path, which this file
// imports itself.
//
// Task 7 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "brainstorm-board-pick",
        surface: "agent",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 7)", ok: false, detail: "Task 7 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
