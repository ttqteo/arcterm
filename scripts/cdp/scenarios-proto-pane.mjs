// proto-pane: the canvas pane's Try | Mark toggle, marks across a prototype's screens and the header readout
// (docs/superpowers/plans/2026-11-27-prototype-feedback.md, Task 6). The fixture is ./proto-fixtures.mjs.
//
// A stub until Task 6 builds it: it owns this file, so Tasks 4, 6 and 7 each edit their own module and none edits
// scenarios.mjs. kit is scenarios.mjs's CANVAS_KIT.

const NAME = "proto-pane";

export default function (kit) {
    const { skipStep } = kit;
    return [
        {
            name: NAME,
            surface: "agent",
            arrange: async () => ({}),
            assert: async () => [skipStep(NAME, "built by Task 6 of docs/superpowers/plans/2026-11-27-prototype-feedback.md")],
        },
    ];
}
