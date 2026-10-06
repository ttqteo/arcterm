---
name: cockpit-ui
description: Use when you want to show the user something in the arcterm cockpit (a run, an agent terminal, a record, a memory note, a radar finding, a surface), read what they're looking at, or run a cockpit action for them — via `wsh ui`.
---

# Driving the arcterm cockpit

You run inside arcterm. `wsh ui` lets you see and steer the cockpit the user is looking at.

- `wsh ui state` — JSON: current surface, `busy`, `selection` (addresses), and the `actions` available now.
- `wsh ui reveal <address>` — take the user to an entity. Addresses: `run:<id>`, `channel:<id>`,
  `agent:<tabId>`, `task:<id>`, `memnote:<id>`, `effort:<id>`, `radarreport:<id> [--anchor <findingId>]`,
  `surface:<cockpit|jarvis|agent|code|files|radar|usage|setup|settings|history>` (`history` is Conversation History, a mode of the Agent surface).
  Your own terminal is `agent:$WAVETERM_TABID`. Files: use `wsh view <path>` instead.
  A `memnote:` has no surface: it shows in the avatar popup and leaves the user where they are.
- `wsh ui actions` — the actions available right now (they depend on the surface and selection).
- `wsh ui do <action-id>` — run one, exactly as if the user pressed its key.

Rules:
- Read `state` before `do`: actions act on the current selection, so `reveal` the target first.
- Prefer `reveal` to show the user something; only `do` what they asked for.
- "the user is busy" means they are typing or in a dialog — wait and retry; never loop tightly.
- "waiting on the user's confirmation" means they must approve it; check `state` later, don't re-issue.
- Closing sessions and answering asks are not available here (use `wsh ask` for your own questions).
- Every successful call shows the user a toast naming you, so keep calls purposeful.
