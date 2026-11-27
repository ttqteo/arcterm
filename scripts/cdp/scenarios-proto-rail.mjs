// proto-rail: the brainstorm rail's opened prototype board: Try on it, the question's slot previewing its options, marks that
// survive Try (docs/superpowers/plans/2026-11-27-prototype-feedback.md, Task 7). The fixture is ./proto-fixtures.mjs.
//
// A stub until Task 7 builds it: it owns this file, so Tasks 4, 6 and 7 each edit their own module and none edits
// scenarios.mjs. kit is scenarios.mjs's CANVAS_KIT and BS_KIT together.

const NAME = "proto-rail";

export default function (kit) {
    const { skipStep } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            arrange: async () => ({}),
            assert: async () => [skipStep(NAME, "built by Task 7 of docs/superpowers/plans/2026-11-27-prototype-feedback.md")],
        },
    ];
}
