# Settings Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Settings card to the page named for what it changes (eight pages, About at the index's foot) and give four settings that had no row a home.

**Architecture:** `settingsmodel.ts` is the single source of the page list, cards and row prose; the page components in `settingspages/` render it and `settingssurface.tsx` routes a section id to its page. Two pages are new (`runs`, `jarvis`); cards move whole between page components; the new rows are config rows like their neighbours.

**Tech Stack:** React 19 + jotai + Tailwind 4 (frontend), vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-18-settings-reorg-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/wconfig ./pkg/jobqueue ./pkg/runqueue ./pkg/tokengate`

**Final:** `node scripts/cdp/final-verify.mjs settings-pages settings-keepawake settings-vault-sync settings-telegram tray-settings-row route-picker-flat route-picker-refused jarvis-pet`

The canvas `.superpowers/design/settings-reorg/` decides placement only and takes drawing shortcuts the spec rules out
(theme chips without swatches, Storage drawn as one card), so it is not this plan's Prototype.

## Global Constraints

- No setting's key, store or default value changes, and none is removed. The defaults added to `defaultconfig/settings.json` (Task 1) equal what Go already does when the key is unset.
- Every existing row id stays as it is (they are the search index and the CDP hooks).
- No change to how a row, card, control, search, changed dot, revert or key pill look: reuse `SettingCard`, `SettingRow`, `Toggle`, `Stepper`, `Segmented` from `settingsui.tsx`. Colors only from `@theme` tokens.
- Copy (page names, blurbs, card labels, row titles and descriptions) is exactly the spec's.
- Testable logic lives in pure `.ts` with a `.test.ts` beside it; no render tests.
- `CHANGELOG.md`: one line under the top section's `Changed`.

## Review Focus

- A deep link or a pending section with a retired id (`memory`, `run`) must open the page that now holds the card, not General or Agents (test in Task 1).
- Search must still find a row that moved: "fold" finds the Folding rows on Jarvis & Office, "vault" finds Vault & sync on Storage & sync (test in Task 1).
- A new row left unset must show no changed dot, and its revert must clear the dot: every new config key needs a shipped default (test in Task 1).
- `jobs:mode: "slots"` with no `jobs:slots` (a hand-edited settings.json) must read as `1`, Go's own clamp default, not as a blank segment (test in Task 1).
- A stepper at a bound must stay there: active runs never below 0, a percentage never above 100 or below 0 (test in Task 1).

---

### Task 1: Settings model, new rows' helpers and defaults

**Depends on:** none
**Files:** `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/cockpit/jobqueue.ts`, `frontend/app/cockpit/jobqueue.test.ts`, `pkg/wconfig/defaultconfig/settings.json`

**Interfaces:**
- Produces, in `settingsmodel.ts`:
  - `SettingSectionDef` gains `foot?: boolean` (true only on `about`).
  - `settingsSections(flagRuntime)` returns nine sections in this order: `general`, `appearance`, `agents`, `runs`, `terminal`, `headless`, `jarvis`, `storage`, `about`.
  - Card ids: general `startup`, `menubar`, `notifications`; agents `claudeaccount`, `sleep`, `flags`; runs `runs`, `whilework`, `tokenburn`; jarvis `jarvis`, `folding`, `office`; storage `vault`, the five category cards, `autoclean`. Every other card keeps its id.
  - New row ids (all `config: true`, `scope: "synced"`): `runs.maxactive` (`runs:maxactive`), `runs.wakeorigin` (`runs:wakeorigin`), `runs.heavyjobs` (`jobs:mode`, no `morekeys`: picking Auto leaves `jobs:slots` behind, and keying only the mode keeps the dot off), `tokengate.enabled`, `tokengate.sharepct`, `tokengate.windowpct`, `tokengate.agents`, `tokengate.weekpct`, `tokengate.sessionpct` (each on its `tokengate:*` key).
  - `stepWithin(current: number, dir: -1 | 1, b: { step: number; min: number; max: number }): number`
  - `RUNS_MAX_ACTIVE = { step: 1, min: 0, max: 10, default: 3 }`, `TOKENGATE_PCT = { step: 5, min: 0, max: 100 }`, `TOKENGATE_AGENTS = { step: 1, min: 0, max: 10 }`, `TOKENGATE_DEFAULTS = { sharepct: 10, windowpct: 70, agents: 3, weekpct: 80, sessionpct: 25 }`.
- Produces, in `jobqueue.ts`: `paceOfSettings(mode: string | undefined, slots: number | undefined): string` returning a `PACE_CHOICES` value.

- [ ] **Step 1: Write the failing tests in `settingsmodel.test.ts`**

```ts
describe("page list", () => {
    it("lists nine pages, About last and at the foot", () => {
        expect(sections().map((s) => s.id)).toEqual(["general", "appearance", "agents", "runs", "terminal", "headless", "jarvis", "storage", "about"]);
        expect(sections().filter((s) => s.foot).map((s) => s.id)).toEqual(["about"]);
    });
    it("puts each moved card on its new page", () => {
        const cards = (id: string) => sections().find((s) => s.id === id)!.cards.map((c) => c.id);
        expect(cards("general")).toEqual(["startup", "menubar", "notifications"]);
        expect(cards("runs")).toEqual(["runs", "whilework", "tokenburn"]);
        expect(cards("jarvis")).toEqual(["jarvis", "folding", "office"]);
        expect(cards("storage")[0]).toBe("vault");
        expect(cards("agents")).toEqual(["claudeaccount", "sleep", "flags"]);
    });
    it("holds every row id exactly once", () => {
        const ids = sections().flatMap(sectionRows).map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
    it("sends retired ids to the page that now holds their card", () => {
        expect(resolveSectionId("memory")).toBe("storage");
        expect(resolveSectionId("run")).toBe("runs");
        expect(resolveSectionId("notifications")).toBe("general");
    });
    it("finds moved rows by search", () => {
        expect(filterSections(sections(), "fold").map((s) => s.id)).toContain("jarvis");
        expect(filterSections(sections(), "vault").map((s) => s.id)).toContain("storage");
    });
    it("ships a default for every new config key", () => {
        const shipped = JSON.parse(readFileSync("pkg/wconfig/defaultconfig/settings.json", "utf8"));
        expect(shipped).toMatchObject({
            "runs:maxactive": 3, "runs:wakeorigin": true, "jobs:mode": "auto", "tokengate:enabled": true,
            "tokengate:sharepct": 10, "tokengate:windowpct": 70, "tokengate:agents": 3, "tokengate:weekpct": 80, "tokengate:sessionpct": 25,
        });
    });
});
describe("stepWithin", () => {
    it("moves by the step and stops at the bounds", () => {
        expect(stepWithin(0, -1, RUNS_MAX_ACTIVE)).toBe(0);
        expect(stepWithin(3, 1, RUNS_MAX_ACTIVE)).toBe(4);
        expect(stepWithin(100, 1, TOKENGATE_PCT)).toBe(100);
        expect(stepWithin(5, -1, TOKENGATE_PCT)).toBe(0);
    });
});
```

Also update the existing "marks exactly the wconfig-backed rows as config rows" expectation to the new page order:
`app:tray, app:traymemory, notify:os, notify:toast, notify:reply, agents:sleepidle, agents:sleepaftermin, runs:maxactive, runs:wakeorigin, power:keepawake, jobs:mode, tokengate:enabled, tokengate:sharepct, tokengate:windowpct, tokengate:agents, tokengate:weekpct, tokengate:sessionpct, term:fontfamily, term:fontsize, term:cursor, term:cursorblink, term:scrollback, term:copyonselect, term:rightclickpaste, headless:runtime, headless:openroutercheapmodel, radar:auditruntime, radar:auditmodel, radar:classifymodel, window:minimize, window:autosprout, memory:vaultpath, storage:autoclean, storage:nudgegb, storage:canvasonship, harness:updatecheck`.

- [ ] **Step 2: Write the failing test in `jobqueue.test.ts`**

```ts
it("reads the pace from settings like the server does", () => {
    expect(paceOfSettings(undefined, undefined)).toBe("auto");
    expect(paceOfSettings("auto", 3)).toBe("auto");
    expect(paceOfSettings("off", 2)).toBe("off");
    expect(paceOfSettings("slots", 3)).toBe("3");
    expect(paceOfSettings("slots", undefined)).toBe("1");
    expect(paceOfSettings("slots", 9)).toBe("4");
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts frontend/app/cockpit/jobqueue.test.ts`
Expected: FAIL (`stepWithin`, `paceOfSettings` not exported; page list differs)

- [ ] **Step 4: Implement**

- `settingsmodel.ts`: restructure `settingsSections` to the spec's page list and blurbs; split today's `window` card into `menubar` (`app.tray`, `app.traymemory`, on general) and `folding` (`window.minimize`, `window.sproutcorner`, `window.autosprout`, on jarvis); split today's `runs` card into `runs` (`run.route` then the two new rows) and `whilework` (`runs.keepawake` then `runs.heavyjobs`); add the `tokenburn` card (label "Token burn") with the six rows in the spec's order and copy; move `vault` to the head of storage and name that page "Storage & sync"; set `foot: true` on about; in `RETIRED_SECTIONS` change `memory` to `"storage"` and `run` to `"runs"`; add `stepWithin` and the constants.
- `jobqueue.ts`: `paceOfSettings` — `"off"` → `"off"`, `"slots"` → the slot count clamped to 1–4 (unset is 1), anything else → `"auto"`.
- `pkg/wconfig/defaultconfig/settings.json`: add the nine keys with the values in the Step 1 test.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts frontend/app/cockpit/jobqueue.test.ts && go test ./pkg/wconfig`
Expected: PASS

- [ ] **Step 6: Commit**

`git commit -m "feat(settings): the model holds eight pages by feature, About at the foot, and rows for runs, heavy jobs and the token gate"`

### Task 2: The Runs & limits page

**Depends on:** Task 1
**Files:** `frontend/app/view/agents/settingspages/runs.tsx`, `frontend/app/view/agents/settingspages/agents.tsx`, `frontend/app/view/agents/settingssurface.tsx`

**Interfaces:**
- Consumes: the row ids, card ids, `stepWithin`, `RUNS_MAX_ACTIVE`, `TOKENGATE_PCT`, `TOKENGATE_AGENTS`, `TOKENGATE_DEFAULTS` (Task 1); `PACE_CHOICES`, `pacePatch`, `paceOfSettings` from `frontend/app/cockpit/jobqueue.ts`.
- Produces: `export function RunsPage(): JSX.Element` in `settingspages/runs.tsx`.

- [ ] **Step 1: Create `settingspages/runs.tsx` with `RunsPage`**

Three `SettingCard`s, ids `runs`, `whilework`, `tokenburn`, labels "Runs", "While work runs", "Token burn"; the Token burn card's `footer` is "0 turns a check off.". Move `RunRouteRow` and `KeepAwakeRow` here from `agents.tsx` unchanged. New rows follow `SleepRows`' pattern (`getSettingsKeyAtom` with a `??` fallback to the default, `writeConfig` on change):
- `runs.maxactive`: `Stepper`, fallback `RUNS_MAX_ACTIVE.default`, steps with `stepWithin`.
- `runs.wakeorigin`: `Toggle`, fallback `true`.
- `runs.heavyjobs`: `Segmented` over `PACE_CHOICES`, value `paceOfSettings(jobs:mode, jobs:slots)`, on change `writeConfig(pacePatch(value))`.
- `tokengate.enabled`: `Toggle`, fallback `true`; the five threshold rows: `Stepper`s, fallback from `TOKENGATE_DEFAULTS`, `TOKENGATE_PCT` for the four percentages (shown with `%`, as `SleepRows` shows `min`), `TOKENGATE_AGENTS` for agents; they dim like the sleep minutes (`opacity-50`) while the gate is off.

- [ ] **Step 2: Remove the Runs card from `AgentsPage` in `agents.tsx` (lines 66–69) and the two rows' code and imports that moved**

- [ ] **Step 3: Route `case "runs": return <RunsPage />;` in `settingssurface.tsx`'s page switch (beside `case "agents"`, line ~404)**

- [ ] **Step 4: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && npx vitest run frontend/app/view/agents`
Expected: exit 0, PASS

- [ ] **Step 5: See it in the dev app**

`task dev:browser`, then `task verify:ui -- settings-pages`: the `runs` page shot (Task 4 adds it) shows the three cards with the new rows. Until Task 4 merges, open Settings → Runs & limits by hand and check the same.

- [ ] **Step 6: Commit**

`git commit -m "feat(settings): a Runs & limits page holds the run route, active runs, heavy jobs, keeping the Mac awake and the token gate"`

### Task 3: Jarvis & Office, General, Storage & sync, and About at the foot

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/settingspages/jarvis.tsx`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingspages/general.tsx`, `frontend/app/view/agents/settingspages/storage.tsx`, `frontend/app/view/agents/settingssurface.tsx`

**Interfaces:**
- Consumes: card ids and `foot` (Task 1).
- Produces: `export function JarvisPage(): JSX.Element` in `settingspages/jarvis.tsx`; `export function VaultCard(): JSX.Element` from `general.tsx` (today a local function), imported by `storage.tsx`.

- [ ] **Step 1: Create `settingspages/jarvis.tsx` with `JarvisPage`**

Cards in order: `jarvis` ("Jarvis": `PetCharacterRow`, `PetOutfitRow`, `PetQuotesRow`, with `SpiderThemeOffer`), `folding` ("Folding": the Minimize, Fold to and Fold when you leave rows from `general.tsx`'s `WindowRows`), `office` ("Office": `OfficeAnimationRow`, `OfficeHoursRow`, `OfficeSoundRows`). Move the components unchanged; delete them and their now-unused imports from `appearance.tsx` (cards at lines 52–61) and `general.tsx`.

- [ ] **Step 2: Rework `GeneralPage`**

Cards: `startup`, then `menubar` ("Menu bar": the `app.tray` and `app.traymemory` rows left from `WindowRows`), then `notifications`. Export `VaultCard` and stop rendering it here.

- [ ] **Step 3: Put `VaultCard` first on `StoragePage` in `storage.tsx` (above the category cards, line ~267)**

- [ ] **Step 4: Route `case "jarvis": return <JarvisPage />;` and draw About at the index's foot in `settingssurface.tsx`**

In the index list (lines ~353–375), render the sections without `foot`, then a `border-t border-border pt-2.5` block holding the `foot` ones with the same item button. Filtering by search keeps applying to both parts.

- [ ] **Step 5: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && npx vitest run frontend/app/view/agents`
Expected: exit 0, PASS

- [ ] **Step 6: See it in the dev app**

`task dev:browser`, then `task verify:ui -- settings-pages`: the `general`, `jarvis` and `storage` page shots (Task 4) show the cards in the spec's order and About under the index's line. Until Task 4 merges, check them by hand.

- [ ] **Step 7: Commit**

`git commit -m "feat(settings): the pet's folding rows join Jarvis & Office, the vault joins Storage & sync, and About sits at the foot"`

### Task 4: Scenarios, guide and changelog

**Depends on:** Task 1
**Files:** `scripts/cdp/scenarios.mjs`, `docs/guide/settings.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: section ids, card ids and row ids (Task 1).

- [ ] **Step 1: Update `scripts/cdp/scenarios.mjs`**

- `SP_PAGES` (line ~36752) lists the nine pages and their card ids as in Task 1, so `settings-pages` shoots each; add a check there that `[data-section="about"]` sits after the index's foot line.
- Repoint the scenarios that reach a moved card: `route-picker-flat` (line ~11953, `agents` → `runs`), `route-picker-refused` (line ~12096, `run` → `runs`), `settings-keepawake` (`spOpen(h, "agents")` → `"runs"`; `KA_SWITCH` card `runs` → `whilework`), `settings-vault-sync` (line ~36614, `general` → `storage`), `jarvis-pet` (the `spOpen(h, "appearance")` calls at lines ~8540, ~8591, ~9220 → `"jarvis"`). `settings-telegram`, `notify-toast` and `tray-settings-row` stay on `general`.

- [ ] **Step 2: Rewrite `docs/guide/settings.md` to the nine pages and their cards, with the four new rows under Runs & limits**

- [ ] **Step 3: Add one line under the top section's `Changed` in `CHANGELOG.md`**

"Settings is sorted by what each setting changes: a Runs & limits page holds the run route, how many runs and heavy jobs go at once, keeping the Mac awake and when a costly spawn asks first; the pet's folding sits with Jarvis & Office; the vault with Storage & sync; About at the foot of the list. <!-- try: settings -->"

- [ ] **Step 4: Check the script parses**

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output, exit 0

- [ ] **Step 5: Commit**

`git commit -m "test(cdp): settings scenarios open the pages that now hold their cards; guide and changelog follow"`
