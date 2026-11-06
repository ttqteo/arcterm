// palette-brainstorm-resume: STUB. Task 8 of docs/superpowers/plans/2026-11-06-kael-sync-surfaces.md fills it: the command
// palette lists the projects' open brainstorms (never approved, newest first, with the open question and age), Enter resumes
// one and the row's alt (Mod+Enter) dismisses it. Copy the setup of `brainstorm-mode` in scenarios.mjs (a registered project, a
// brainstorm.json under .superpowers/brainstorm/<topic>; two open ones and a done one here), then drive the palette with
// openPalette.
//
// kit is scenarios.mjs's BS_KIT, the brainstorm helpers, with bsClosePeek, bsSeeHints, openCanvasTerminal, polishReload,
// waitForProjectInConfig and openPalette added for this task and Task 7. Task 8 takes what it needs with
// `export default function (kit)`. What `brainstorm-mode` uses that BS_KIT still lacks is duplicated here, not added to
// scenarios.mjs. The seed also uses node:fs, node:os and node:path, which this file imports itself.
//
// Task 8 replaces the one failing step below with its own steps.

export default function () {
    const scenario = {
        name: "palette-brainstorm-resume",
        surface: "agent",
        async arrange() {
            return {};
        },
        async assert() {
            return [{ step: "not built yet (Task 8)", ok: false, detail: "Task 8 fills this scenario in" }];
        },
        async teardown() {},
    };
    return [scenario];
}
