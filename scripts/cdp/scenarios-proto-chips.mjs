// proto-chips: the A/B/C chips Arc draws on a clickable prototype's variant slots, on every board opened large
// (docs/superpowers/plans/2026-11-27-prototype-feedback.md, Task 4). The fixture is ./proto-fixtures.mjs.
//
// A stub until Task 4 builds it: it owns this file, so Tasks 4, 6 and 7 each edit their own module and none edits
// scenarios.mjs. kit is scenarios.mjs's CANVAS_KIT.

const NAME = "proto-chips";

export default function (kit) {
    const { skipStep } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            arrange: async () => ({}),
            assert: async () => [skipStep(NAME, "built by Task 4 of docs/superpowers/plans/2026-11-27-prototype-feedback.md")],
        },
    ];
}
