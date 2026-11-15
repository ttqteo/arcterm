// The Cockpit, Jarvis, Diff and Setup on Chat's spring (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md;
// the plan's tasks are named below, and git history keeps the plan). One group of scenarios, `surfaces-spring-*`, one file per
// area under surfaces-spring/, so the tasks that run at the same time each own their own file:
//   cockpit.mjs      surfaces-spring-cockpit       the cards view: cards, sections, the empty state   (Task 2)
//   office.mjs       surfaces-spring-office        the Office: its card panel and its pan             (Task 3)
//   brief.mjs        surfaces-spring-brief         Jarvis's brief page                                (Task 4)
//   initiatives.mjs  surfaces-spring-initiatives   Jarvis's initiatives and runs, and the sheets      (Task 5)
//   diff.mjs         surfaces-spring-diff          Diff, Review mode                                  (Task 6)
//   setup.mjs        surfaces-spring-setup         Setup, and the reduced-motion check                (Task 7)
// springprobe.mjs is the shared frame sampler (startSampler / readSampler, and the verdicts between / atOnce / singleCopy)
// every area times its motion with.
//
// kit is scenarios.mjs's SS_KIT: OF_KIT (the Chat redesign's kit, and `scenario(name)`, the registered scenario object of
// that name, resolved when it is called, so a step can reuse an existing scenario's `arrange` / `teardown`), the Kael kits
// (`kit.jarvis`, `kit.files`, `kit.rt`, `kit.code`) and `kit.run`, the run-seeding helpers. Final runs every
// surfaces-spring-* scenario.

import brief from "./surfaces-spring/brief.mjs";
import cockpit from "./surfaces-spring/cockpit.mjs";
import diff from "./surfaces-spring/diff.mjs";
import initiatives from "./surfaces-spring/initiatives.mjs";
import office from "./surfaces-spring/office.mjs";
import setup from "./surfaces-spring/setup.mjs";

export default (kit) => [...cockpit(kit), ...office(kit), ...brief(kit), ...initiatives(kit), ...diff(kit), ...setup(kit)];
