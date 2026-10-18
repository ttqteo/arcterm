# Settings reorganization

**Status:** draft 2026-10-18. Effort `c721a0be` ("sắp xếp lại setting, hiện tại khá là loạn"). Prototype:
`.superpowers/design/settings-reorg/project/` in the main checkout (gitignored): `OptionA.dc.html` is the clickable page
list, `Main.dc.html` maps every card from today's page to its new one.

## Why

The person finds Settings' items arranged in a muddle. Since the 2026-10-08 redesign
(`2026-10-08-settings-redesign-design.md`), cards were added wherever there was room:

- General holds Startup, Notifications (with Telegram), a Window card that mixes folding the window into the pet
  with the menu bar icon, and Vault & sync.
- Appearance holds the theme, colors and fonts, but also the Jarvis pet and the Office (its animation, work hours and
  four sound rows).
- Agents holds the Claude account, sleep, launch flags, and the run route and keeping the Mac awake.
- Four settings that decide whether agents wait have no row at all (decided 2026-10-17, below).

The fix is placement: each card moves to the page named for what it changes. The person's own example: Minimize folds
the window into the pet, so it belongs with the pet, not in General.

## Goals

- A page holds one kind of thing, and its name says which.
- Few pages: eight in the list, About apart at its foot. The person turned down eleven as too many.
- The four rows decided on 2026-10-17 get a home.

## Non-goals

- No change to how a row, card, control, the search, the changed dot, revert or the key pill look or behave: the
  2026-10-08 design stays.
- No setting's key, store or default value changes, and none is removed.
- The canvas takes drawing shortcuts that are not part of this design: theme chips without their swatches, Storage's
  five category cards drawn as one "On disk" card, shortened descriptions, `[…]` placeholders. The built pages keep
  today's controls and copy.

## Anti-goals

- A page that mixes kinds again: pet settings in General, run settings on Agents.

## The page list

In the index in this order. Rows are today's row ids (`frontend/app/view/agents/settingsmodel.ts`); a card keeps its
rows in today's order unless said otherwise.

| # | Section id | Name | Cards |
|---|---|---|---|
| 1 | `general` | General | Startup: `general.startup`, `general.rail` · **Menu bar**: `app.tray`, `app.traymemory` · Notifications: `notifications.os`, `.toast`, `.reply`, `.telegram` |
| 2 | `appearance` | Appearance | Theme · Colors · Fonts · Agent sidebar (as today, without Jarvis and Office) |
| 3 | `agents` | Agents | Claude account · Sleep idle agents · Launch flags |
| 4 | `runs` (new) | Runs & limits | **Runs**: `run.route`, then two new rows · **While work runs**: `runs.keepawake`, then one new row · **Token burn** (new card) |
| 5 | `terminal` | Terminal | as today |
| 6 | `headless` | Background AI | as today |
| 7 | `jarvis` (new) | Jarvis & Office | Jarvis: `appearance.petcharacter`, `.petoutfit`, `.petquotes` · **Folding**: `window.minimize`, `window.sproutcorner`, `window.autosprout` · Office: the six `appearance.office*` rows |
| 8 | `storage` | Storage & sync | Vault & sync: `memory.vaultpath`, `memory.remote`, with the sync status footer it has today · the five category cards · Auto-clean |
| — | `about` | About | as today, at the index's foot |

Card changes:

- Today's Window card splits: its last two rows become a **Menu bar** card on General, the other three become
  **Folding** on Jarvis & Office.
- Today's Runs card on Agents splits: `run.route` goes to Runs on Runs & limits, `runs.keepawake` to While work runs.
- Vault & sync moves from General to Storage & sync, first on the page.

Blurbs (the page header's second line):

- General: "What opens at launch, arcterm in the menu bar, and when it tells you about an agent."
- Agents: "The Claude subscription new agents run on, when an idle agent sleeps, and the flags every launch starts with."
- Runs & limits: "The route new runs take, how much runs at once, and when a costly spawn asks you first."
- Jarvis & Office: "Who Jarvis is, when the window folds into it, and how the Office looks and sounds."
- Storage & sync: "Where your vault lives and syncs to, what arcterm and its agents leave on disk, and cleaning it.
  Nothing in use is ever removed."
- Appearance: "Theme, colors and fonts, and what an agent row in the sidebar shows."
- Terminal, Background AI, About keep theirs, trimmed of what moved away.

## The index

- The eight items in order, then a 1px `border` line with 10px above it, then About. About is an ordinary item
  otherwise: selectable, with its changed count.
- Search is unchanged and searches all nine pages.

## Old section ids

Every section id that exists today still exists (`general`, `appearance`, `terminal`, `agents`, `storage`, `headless`,
`about`), so links to them keep working. `RETIRED_SECTIONS` in `settingsmodel.ts` changes where its cards moved:
`memory` → `storage` (was `general`) and `run` → `runs` (was `agents`); `fonts`, `notifications`, `newagent` and
`claudeaccount` keep their targets. Today's callers of `openSettingsSection` open `general` from the menu bar popover
(`trayactmodel.ts`, whose Menu bar card stays on General) and `storage` from the storage nudge; both stay right.

## New rows (decided 2026-10-17)

All four are config rows like their neighbours (`config: true`, scope synced): the changed dot comes from diffing the
merged value against the shipped default, and revert deletes the user's override. Each value's default lives in Go
today (`pkg/wconfig/settingsconfig.go`, nil means the default), not in `pkg/wconfig/defaultconfig/settings.json`.

| Card | Title | Control | Key | Default |
|---|---|---|---|---|
| Runs | Active runs at once — "A queued run waits while this many are active. 0 is no cap." | stepper | `runs:maxactive` | 3 |
| Runs | Tell the session that started a run — "Message it when the run lands, so it can pick up the result." | toggle | `runs:wakeorigin` | on |
| While work runs | Heavy jobs — "Builds, the typecheck and whole test suites wait their turn. Auto starts one when its RAM fits; a number caps how many run at once; Off never waits. The Jobs popover sets the same thing." | segmented Auto · 1 · 2 · 3 · 4 · Off | `jobs:mode` + `jobs:slots` | Auto |
| Token burn | Ask before a costly spawn — "An Agent, Task or Workflow call that trips a check below waits on a Token burn card for your yes." | toggle | `tokengate:enabled` | on |
| Token burn | A spawn's share of the 5-hour window — "Ask when one spawn would take this much of it." | stepper | `tokengate:sharepct` | 10% |
| Token burn | 5-hour window used — "Ask once this much of the window is gone." | stepper | `tokengate:windowpct` | 70% |
| Token burn | Agents started together — "Ask when one call starts this many agents." | stepper | `tokengate:agents` | 3 |
| Token burn | Week used — "Ask once this much of the weekly window is gone." | stepper | `tokengate:weekpct` | 80% |
| Token burn | The asking session's share — "Ask when the session asking has used this much of the 5-hour window." | stepper | `tokengate:sessionpct` | 25% |

- The Token burn card ends with the footer "0 turns a check off." For the five checks, 0 means off, as the Go comments
  say.
- Heavy jobs writes exactly what the Jobs popover writes: Auto → `jobs:mode: "auto"`, Off → `"off"`, a number →
  `jobs:mode: "slots"` with `jobs:slots` (`pacePatch` in `frontend/app/cockpit/jobqueue.ts`; share it, don't copy it). The popover keeps its own control and its Pause 1h / 4h (`jobs:pauseuntil`), which gets no row.
- Not getting rows (same decision): the terminal keys left in settings.json, Code's editor keys, `usage:insightslang`
  (the Usage card's own toggle), the pause timers, the Telegram chat fields and `claude:activeaccount`.

## Testing

- `settingsmodel.test.ts`: the nine pages in order with About last, every row id exactly once, each card on its page,
  and `RETIRED_SECTIONS` sending `memory` to `storage` and `run` to `runs`.
- The Heavy jobs value mapping (segment ↔ `jobs:mode`/`jobs:slots`) is a pure function with a test.
- CDP (`scripts/cdp/scenarios.mjs`): `settings-pages` opens each of the nine pages and screenshots it. Scenarios that
  click a section to reach a card that moved open the new section: the run route (`data-section="run"` today), Vault &
  sync (`general`), Keep the Mac awake (`agents`), and any that reach the Fold rows through `general`.
- `docs/guide/settings.md` follows the new pages, and `CHANGELOG.md` gets one `Changed` line.

## Left to the builder

- How the page components split (for example `settingspages/runs.tsx` and `settingspages/jarvis.tsx` beside today's
  files) and what moves out of `general.tsx`, `appearance.tsx` and `agents.tsx`.
- Ids for the new rows, the steppers' steps and bounds (for example 5% steps for the percentages, 0–10 for active runs).
- How the four new rows' defaults feed the changed dot: putting the Go defaults into `defaultconfig/settings.json` (Go
  keeps its nil fallback, so nothing reads a different value) or teaching the diff those defaults.
