// Overlays in the Chat look: the frosted fill (docs/superpowers/specs/2026-11-14-overlays-chat-look-design.md;
// the plan's tasks are named below, and git history keeps the plan). One group of scenarios, `overlays-frost-*`, one file per area
// under overlays-frost/, so the tasks that run at the same time each own their own file:
//   palette.mjs  overlays-frost-palette                              the command palette over today's scrim   (Task 3)
//   menus.mjs    overlays-frost-menus                                context menus, PickerList dropdowns      (Task 2)
//   chat.mjs     overlays-frost-chat                                 Chat and council popovers                (Task 4)
//   agents.mjs   overlays-frost-agents                               sidebar, launcher and Radar popovers     (Task 5)
//   jarvis.mjs   overlays-frost-jarvis                               Jarvis, Code and Jobs popovers           (Task 6)
//   toast.mjs    overlays-frost-toast, overlays-frost-toast-timing   the toast fill, and its one-off timing    (Task 8)
// frostcheck.mjs is the shared check (frostProbe / frostVerdict / solidVerdict) every area runs on its panels.
//
// kit is scenarios.mjs's CR_KIT (what the Chat redesign's scenario takes of it) plus `scenario(name)`, which returns the
// registered scenario object of that name, resolved when it is called (not when the group is built), so a step can run an
// existing scenario's `arrange` / `teardown` (the consumers-popover, jobqueue-chip and notify-toast fixtures) without
// scenarios.mjs having to export it. Final runs every overlays-frost-* scenario except overlays-frost-toast-timing.

import agents from "./overlays-frost/agents.mjs";
import chat from "./overlays-frost/chat.mjs";
import jarvis from "./overlays-frost/jarvis.mjs";
import menus from "./overlays-frost/menus.mjs";
import palette from "./overlays-frost/palette.mjs";
import toast from "./overlays-frost/toast.mjs";

export default (kit) => [...palette(kit), ...menus(kit), ...chat(kit), ...agents(kit), ...jarvis(kit), ...toast(kit)];
