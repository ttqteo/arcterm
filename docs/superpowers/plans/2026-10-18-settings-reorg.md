# Settings Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Settings card to the page named for what it changes (eight pages, About at the index's foot) and give four settings that had no row a home.

**Architecture:** `settingsmodel.ts` is the single source of the page list, cards and row prose; the page components in `settingspages/` render it and `settingssurface.tsx` routes a section id to its page. Two pages are new (`runs`, `jarvis`); cards move whole between page components; the new rows are config rows like their neighbours. The CDP scenarios are written first, to the target state, so each UI task proves itself with named scenario steps.

**Tech Stack:** React 19 + jotai + Tailwind 4 (frontend), vitest, CDP scenarios (`scripts/cdp/scenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-18-settings-reorg-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/wconfig ./pkg/jobqueue ./pkg/runqueue ./pkg/tokengate`

**Final:** `node scripts/cdp/final-verify.mjs settings-pages settings-runs settings-keepawake settings-vault-sync settings-storage settings-telegram tray-settings-row route-picker-flat route-picker-refused agy-harness jarvis-pet office-sound cockpit-office`

The canvas `.superpowers/design/settings-reorg/` decides placement only and takes drawing shortcuts the spec rules out
(theme chips without swatches, Storage drawn as one card), so it is not this plan's Prototype.

## Global Constraints

- No setting's key, store or default value changes, and none is removed. The defaults added to `defaultconfig/settings.json` (Task 1) equal what Go already does when the key is unset.
- Every existing row id stays as it is (they are the search index and the CDP hooks).
- No change to how a row, card, control, search, changed dot, revert or key pill look: reuse `SettingCard`, `SettingRow`, `Toggle`, `Stepper`, `Segmented`, `CardFooter` from `settingsui.tsx`. Colors only from `@theme` tokens.
- Copy (page names, blurbs, card labels, row titles and descriptions) is exactly the spec's.
- Testable logic lives in pure `.ts` with a `.test.ts` beside it; no render tests.
- `CHANGELOG.md`: one line under the top section's `Changed`.
- A scenario check in a task runs in its own app: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs <scenario...>` from the task's worktree (on a Mac it starts `task dev:browser` with its own ports and store; it never touches the person's arcterm).

## Review Focus

- A deep link or a pending section with a retired id (`memory`, `run`) must open the page that now holds the card, not General or Agents (test in Task 1).
- Search must still find a row that moved: "fold" finds the Folding rows on Jarvis & Office, "vault" finds Vault & sync on Storage & sync (test in Task 1).
- A new row left unset must show no changed dot, and its revert must clear the dot: every new config key needs a shipped default (test in Task 1, `settings-runs` steps 1 and 2).
- `jobs:mode: "slots"` with no `jobs:slots` (a hand-edited settings.json) must read as `1`, Go's own clamp default, not as a blank segment (test in Task 1).
- A stepper at a bound must stay there: active runs never below 0 or above 10, a percentage never above 100 or below 0 (test in Task 1, `settings-runs` step 3).

---

### Task 1: Settings model, new rows' helpers and defaults

**Depends on:** none
**Files:** `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/cockpit/jobqueue.ts`, `frontend/app/cockpit/jobqueue.test.ts`, `pkg/wconfig/defaultconfig/settings.json`

**Interfaces:**
- Produces, in `settingsmodel.ts`:
  - `SettingSectionDef` gains `foot?: boolean` (true only on `about`).
  - `settingsSections(flagRuntime)` returns nine sections in this order: `general` "General", `appearance` "Appearance", `agents` "Agents", `runs` "Runs & limits", `terminal` "Terminal", `headless` "Background AI", `jarvis` "Jarvis & Office", `storage` "Storage & sync", `about` "About".
  - Card ids per page, in order: general `startup`, `menubar`, `notifications`; appearance `theme`, `colors`, `fonts`, `agentrows`; agents `claudeaccount`, `sleep`, `flags`; runs `runs`, `whilework`, `tokenburn`; terminal, headless and about as today; jarvis `jarvis`, `folding`, `office`; storage `vault`, the five category cards, `autoclean`.
  - New row ids (all `config: true`, `scope: "synced"`): `runs.maxactive` (`runs:maxactive`), `runs.wakeorigin` (`runs:wakeorigin`), `runs.heavyjobs` (`jobs:mode`, no `morekeys`: picking Auto leaves `jobs:slots` behind, and keying only the mode keeps the dot off), `tokengate.enabled`, `tokengate.sharepct`, `tokengate.windowpct`, `tokengate.agents`, `tokengate.weekpct`, `tokengate.sessionpct` (each on its `tokengate:*` key). Nine rows.
  - `stepWithin(current: number, dir: -1 | 1, b: { step: number; min: number; max: number }): number`
  - `RUNS_MAX_ACTIVE = { step: 1, min: 0, max: 10, default: 3 }`, `TOKENGATE_PCT = { step: 5, min: 0, max: 100 }`, `TOKENGATE_AGENTS = { step: 1, min: 0, max: 10 }`, `TOKENGATE_DEFAULTS = { sharepct: 10, windowpct: 70, agents: 3, weekpct: 80, sessionpct: 25 }`.
- Produces, in `jobqueue.ts`: `paceOfSettings(mode: string | undefined, slots: number | undefined): string` returning a `PACE_CHOICES` value.

- [ ] **Step 1: Rewrite and add the tests in `settingsmodel.test.ts`**

Add `import { readFileSync } from "node:fs";` and add `RUNS_MAX_ACTIVE`, `stepWithin`, `TOKENGATE_AGENTS`, `TOKENGATE_PCT` to the `./settingsmodel` import list.

Replace the whole existing `describe("settings pages", …)` block (its "has seven pages in order", "puts each row in the card the spec names" and "keeps every row exactly once" tests) with this one; keep its "leaves the backend-authoritative run route off the config path" test inside it unchanged:

```ts
describe("settings pages", () => {
    it("has nine pages in order, About last and at the foot", () => {
        expect(sections().map((s) => s.id)).toEqual([
            "general", "appearance", "agents", "runs", "terminal", "headless", "jarvis", "storage", "about",
        ]);
        expect(sections().map((s) => s.name)).toEqual([
            "General", "Appearance", "Agents", "Runs & limits", "Terminal", "Background AI", "Jarvis & Office", "Storage & sync", "About",
        ]);
        expect(sections().filter((s) => s.foot).map((s) => s.id)).toEqual(["about"]);
    });

    it("puts each card on its page and each row in the card the spec names", () => {
        const cards = Object.fromEntries(
            sections().flatMap((s) => s.cards.map((c) => [`${s.id}/${c.id}`, c.rows.map((r) => r.id)]))
        );
        expect(Object.keys(cards)).toEqual([
            "general/startup", "general/menubar", "general/notifications",
            "appearance/theme", "appearance/colors", "appearance/fonts", "appearance/agentrows",
            "agents/claudeaccount", "agents/sleep", "agents/flags",
            "runs/runs", "runs/whilework", "runs/tokenburn",
            "terminal/text", "terminal/cursor", "terminal/behavior",
            "headless/runtime", "headless/openrouter", "headless/radar",
            "jarvis/jarvis", "jarvis/folding", "jarvis/office",
            "storage/vault", "storage/runworktrees", "storage/sessions", "storage/housekeeping", "storage/buildoutput",
            "storage/canvases", "storage/autoclean",
            "about/versions", "about/agents",
        ]);
        expect(cards["general/startup"]).toEqual(["general.startup", "general.rail"]);
        expect(cards["general/menubar"]).toEqual(["app.tray", "app.traymemory"]);
        expect(cards["general/notifications"]).toEqual([
            "notifications.os", "notifications.toast", "notifications.reply", "notifications.telegram",
        ]);
        expect(cards["appearance/theme"]).toEqual(["appearance.theme"]);
        expect(cards["appearance/colors"]).toEqual([
            "appearance.accent", "appearance.success", "appearance.warning", "appearance.error",
        ]);
        expect(cards["appearance/fonts"]).toEqual(["fonts.sans", "fonts.mono"]);
        expect(cards["appearance/agentrows"]).toEqual([
            "appearance.rowmodel", "appearance.rowbranch", "appearance.rowtokens", "appearance.rowage",
        ]);
        expect(cards["agents/claudeaccount"]).toEqual([]);
        expect(cards["agents/sleep"]).toEqual(["agents.sleepidle", "agents.sleepaftermin"]);
        expect(cards["agents/flags"].slice(0, 2)).toEqual(["newagent.remember", "newagent.runtime"]);
        expect(cards["runs/runs"]).toEqual(["run.route", "runs.maxactive", "runs.wakeorigin"]);
        expect(cards["runs/whilework"]).toEqual(["runs.keepawake", "runs.heavyjobs"]);
        expect(cards["runs/tokenburn"]).toEqual([
            "tokengate.enabled", "tokengate.sharepct", "tokengate.windowpct", "tokengate.agents", "tokengate.weekpct", "tokengate.sessionpct",
        ]);
        expect(cards["terminal/text"]).toEqual(["fonts.term", "terminal.fontsize"]);
        expect(cards["terminal/cursor"]).toEqual(["terminal.cursor", "terminal.cursorblink"]);
        expect(cards["terminal/behavior"]).toEqual([
            "terminal.scrollback", "terminal.copyonselect", "terminal.rightclickpaste",
        ]);
        expect(cards["headless/runtime"]).toEqual(["headless.runtime"]);
        expect(cards["headless/openrouter"]).toEqual(["headless.apikey", "headless.cheap"]);
        expect(cards["headless/radar"]).toEqual(["headless.radaraudit", "headless.radarclassify"]);
        expect(cards["jarvis/jarvis"]).toEqual(["appearance.petcharacter", "appearance.petoutfit", "appearance.petquotes"]);
        expect(cards["jarvis/folding"]).toEqual(["window.minimize", "window.sproutcorner", "window.autosprout"]);
        expect(cards["jarvis/office"]).toEqual([
            "appearance.officeanimation", "appearance.officehours", "appearance.officesoundevents",
            "appearance.officesoundui", "appearance.officesoundmusic", "appearance.officesoundvolume",
        ]);
        expect(cards["storage/vault"]).toEqual(["memory.vaultpath", "memory.remote"]);
        for (const cat of ["runworktrees", "sessions", "housekeeping", "buildoutput", "canvases"]) {
            expect(cards[`storage/${cat}`]).toEqual([]);
        }
        expect(cards["storage/autoclean"]).toEqual(["storage.autoclean", "storage.nudge", "storage.canvasonship"]);
        expect(cards["about/versions"]).toEqual(["about.app", "about.server", "about.buildtime", "about.platform"]);
        expect(cards["about/agents"]).toEqual(["about.harnesses", "about.updatecheck"]);
    });

    it("keeps every row exactly once", () => {
        const ids = sections()
            .flatMap(sectionRows)
            .map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        // today's 60 plus the nine new rows
        expect(ids).toHaveLength(69 + RUNTIME_FLAGS.claude.length);
    });

    it("finds moved rows by search", () => {
        expect(filterSections(sections(), "fold").map((s) => s.id)).toContain("jarvis");
        expect(filterSections(sections(), "vault").map((s) => s.id)).toContain("storage");
    });

    it("ships a default for every new config key", () => {
        const shipped = JSON.parse(
            readFileSync(new URL("../../../../pkg/wconfig/defaultconfig/settings.json", import.meta.url), "utf8")
        );
        expect(shipped).toMatchObject({
            "runs:maxactive": 3, "runs:wakeorigin": true, "jobs:mode": "auto", "tokengate:enabled": true,
            "tokengate:sharepct": 10, "tokengate:windowpct": 70, "tokengate:agents": 3, "tokengate:weekpct": 80,
            "tokengate:sessionpct": 25,
        });
    });

    // keep "leaves the backend-authoritative run route off the config path" here, unchanged
});

describe("stepWithin", () => {
    it("moves by the step and stops at the bounds", () => {
        expect(stepWithin(0, -1, RUNS_MAX_ACTIVE)).toBe(0);
        expect(stepWithin(3, 1, RUNS_MAX_ACTIVE)).toBe(4);
        expect(stepWithin(10, 1, RUNS_MAX_ACTIVE)).toBe(10);
        expect(stepWithin(100, 1, TOKENGATE_PCT)).toBe(100);
        expect(stepWithin(5, -1, TOKENGATE_PCT)).toBe(0);
        expect(stepWithin(0, -1, TOKENGATE_PCT)).toBe(0);
        expect(stepWithin(10, 1, TOKENGATE_AGENTS)).toBe(10);
    });
});
```

In `describe("resolveSectionId")`, change the two expectations that moved: `resolveSectionId("memory")` is `"storage"` and `resolveSectionId("run")` is `"runs"`; `fonts`, `notifications`, `newagent` and `claudeaccount` keep theirs.

In "marks exactly the wconfig-backed rows as config rows", replace the expected list with the new page order:
`app:tray, app:traymemory, notify:os, notify:toast, notify:reply, agents:sleepidle, agents:sleepaftermin, runs:maxactive, runs:wakeorigin, power:keepawake, jobs:mode, tokengate:enabled, tokengate:sharepct, tokengate:windowpct, tokengate:agents, tokengate:weekpct, tokengate:sessionpct, term:fontfamily, term:fontsize, term:cursor, term:cursorblink, term:scrollback, term:copyonselect, term:rightclickpaste, headless:runtime, headless:openroutercheapmodel, radar:auditruntime, radar:auditmodel, radar:classifymodel, window:minimize, window:autosprout, memory:vaultpath, storage:autoclean, storage:nudgegb, storage:canvasonship, harness:updatecheck`.

- [ ] **Step 2: Write the failing test in `jobqueue.test.ts`**

Add `paceOfSettings` to the `./jobqueue` import list, then:

```ts
it("reads the pace from settings like the server does", () => {
    expect(paceOfSettings(undefined, undefined)).toBe("auto");
    expect(paceOfSettings("auto", 3)).toBe("auto");
    expect(paceOfSettings("off", 2)).toBe("off");
    expect(paceOfSettings("slots", 3)).toBe("3");
    expect(paceOfSettings("slots", undefined)).toBe("1");
    expect(paceOfSettings("slots", 0)).toBe("1");
    expect(paceOfSettings("slots", 9)).toBe("4");
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts frontend/app/cockpit/jobqueue.test.ts`
Expected: FAIL (`stepWithin`, `paceOfSettings` not exported; page list differs)

- [ ] **Step 4: Implement**

- `settingsmodel.ts`: restructure `settingsSections` to the page list above; split today's `window` card into `menubar` (label "Menu bar": `app.tray`, `app.traymemory`, on general) and `folding` (label "Folding": `window.minimize`, `window.sproutcorner`, `window.autosprout`, on jarvis); move the `jarvis` and `office` cards from appearance to jarvis; split today's `runs` card into `runs` (label "Runs": `run.route` then `runs.maxactive`, `runs.wakeorigin`) and `whilework` (label "While work runs": `runs.keepawake` then `runs.heavyjobs`); add the `tokenburn` card (label "Token burn") with the six rows in the spec's order and copy; move `vault` to the head of storage. Blurbs: General, Appearance, Agents and Storage & sync take the spec's new blurbs word for word, as do the new Runs & limits and Jarvis & Office; Terminal ("Defaults for every agent and shell terminal."), Background AI and About keep today's word for word, since none of them names a card that moved. Set `foot: true` on about; in `RETIRED_SECTIONS` change `memory` to `"storage"` and `run` to `"runs"`; add `stepWithin` and the constants.
- `jobqueue.ts`: `paceOfSettings` — `"off"` → `"off"`, `"slots"` → the slot count clamped to 1–4 (unset or below 1 is 1, as `clampSlots` in `pkg/jobqueue/jobqueue.go` reads it), anything else → `"auto"`.
- `pkg/wconfig/defaultconfig/settings.json`: add the nine keys with the values in the Step 1 test.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run frontend/app/view/agents/settingsmodel.test.ts frontend/app/cockpit/jobqueue.test.ts && go test ./pkg/wconfig`
Expected: PASS

- [ ] **Step 6: Commit**

`git commit -m "feat(settings): the model holds eight pages by feature, About at the foot, and rows for runs, heavy jobs and the token gate"`

### Task 2: Scenarios, guide and changelog

**Depends on:** none
**Files:** `scripts/cdp/scenarios.mjs`, `scripts/cdp/cockpitofficescenarios.mjs`, `docs/guide/settings.md`, `CHANGELOG.md`

This task writes the scenarios to the target state before the pages exist: Tasks 3 and 4 run them. It reads no ids from code; they are the ones Task 1's Interfaces name.

**Interfaces:**
- Consumes: section ids, card ids and row ids (Task 1's Interfaces).
- Produces: the scenario `settings-runs` (steps 1–5 below) and, in `settings-pages`, the steps `index`, one `<page>:` step per page, `runs-detail` and `jarvis-detail`.

- [ ] **Step 1: `settings-pages` follows the nine pages**

- `SP_PAGES` (line ~36752) becomes, in order: `general` `["startup", "menubar", "notifications"]`, `appearance` `["theme", "colors", "fonts", "agentrows"]`, `agents` `["claudeaccount", "sleep", "flags"]`, `runs` `["runs", "whilework", "tokenburn"]`, `terminal` `["text", "cursor", "behavior"]`, `headless` `["runtime", "openrouter", "radar"]`, `jarvis` `["jarvis", "folding", "office"]`, `storage` `["vault", "runworktrees", "sessions", "housekeeping", "buildoutput", "canvases", "autoclean"]`, `about` `["versions", "agents"]`. The header comment and the `index` step's text say nine pages, About at the foot.
- The `index` step also asserts the foot: `[data-settings-foot]` (the hook Task 4 puts on the foot's wrapper) holds exactly one `button[data-section]`, `about`; its computed `border-top-width` is `1px` and its `margin-top` is `10px`.
- Add `runs-detail` (after `agents-detail`): on `runs`, the rows `runs.maxactive`, `runs.wakeorigin`, `runs.heavyjobs` and the six `tokengate.*` rows exist; the `runs.heavyjobs` row holds six buttons reading Auto, 1, 2, 3, 4, Off; the `tokenburn` card's text includes "0 turns a check off."; a shot `settings-pages-runs-detail.png`.
- Add `jarvis-detail`: on `jarvis`, the `folding` card's rows are `window.minimize`, `window.sproutcorner`, `window.autosprout` and the `office` card's are the six `appearance.office*` rows; back on `general`, the `menubar` card's rows are exactly `app.tray`, `app.traymemory`; a shot `settings-pages-jarvis-detail.png`.

- [ ] **Step 2: Add the `settings-runs` scenario** (beside `settings-keepawake`, registered with the others)

Arrange reads `getfullconfig` and keeps the person's values of `runs:maxactive`, `runs:wakeorigin`, `jobs:mode`, `jobs:slots`, `tokengate:enabled` and the five `tokengate:*` thresholds, then unsets all ten with `setconfig` (`null` deletes, as `settings-keepawake` does). Teardown puts each back, retried three times like `spRestoreFontSize`. Steps, each with a shot:
1. "1. Runs & limits holds Runs, While work runs and Token burn; unset, the nine new rows read their defaults with no changed dot": the page's cards are `runs`, `whilework`, `tokenburn`; Active runs shows 3, Tell the session is on, the Heavy jobs segment selected (`bg-surface-selected`) is Auto, Ask before a costly spawn is on, the thresholds show 10%, 70%, 3, 80%, 25%; none of the nine rows holds `[title="Changed from the default"]`; the Token burn card's text includes "0 turns a check off.".
2. "2. Heavy jobs writes what the Jobs popover writes": clicking 2 stores `jobs:mode` `"slots"` and `jobs:slots` 2 and the row shows the dot; clicking Auto stores `jobs:mode` `"auto"` and the dot goes; clicking 3, then the row's `Revert to default`, leaves `jobs:mode` unset, the segment on Auto and no dot.
3. "3. Active runs stops at its bounds": with `runs:maxactive` set to 0, the row's `Decrease` button leaves it 0; set to 10, `Increase` leaves it 10.
4. "4. Turning off Ask before a costly spawn stores tokengate:enabled false and dims the five thresholds": each threshold row then holds an `.opacity-50` control; turning it on again stores `true` and none does.
5. "5. A percentage steps by 5": `Increase` on `tokengate.sharepct` stores 15.

- [ ] **Step 3: Repoint every scenario that reaches a moved card**

- `route-picker-flat` (line ~11953): `[data-section="agents"]` → `"runs"`.
- `route-picker-refused` (line ~12096): `[data-section="run"]` → `"runs"`.
- `settings-keepawake` (lines ~35890–35933): `spOpen(h, "agents")` → `"runs"`; `KA_SWITCH`'s card and the `scrollIntoView` card `runs` → `whilework`; step 1's text "Settings > Agents' Runs card" → "Settings > Runs & limits' While work runs card".
- `settings-vault-sync` (`openVaultSection`, line ~36614): `[data-section="general"]` → `"storage"`.
- `settings-storage` (lines ~39053–39235): `SS_CARDS` gains `"vault"` first; step 1 asserts `index.indexOf("storage") === index.indexOf("jarvis") + 1`, and its text says Storage & sync follows Jarvis & Office and holds Vault & sync, then the five category cards, then Auto-clean.
- `agy-harness` step 11 (line ~37632, the run route picker): `[data-section="agents"]` → `"runs"`. Step 8 (line ~37615, launch flags) stays on `agents`.
- `jarvis-pet` steps 14 and 15 (lines ~8540, ~8591, the pet character row): `spOpen(h, "appearance")` → `"jarvis"`, and their comments' "Settings → Appearance → Jarvis" → "Settings → Jarvis & Office → Jarvis". Step 23 (line ~9220, the Spider theme chip on Appearance → Theme) stays on `appearance`.
- `cockpitofficescenarios.mjs`: `cockpit-office` step 17 (line ~1205) `button[data-section="appearance"]` → `"jarvis"`, its comment "Settings → Appearance → Office" → "Settings → Jarvis & Office → Office"; `office-sound` step 7 (line ~2866) `fx.spOpen(h, "appearance")` → `"jarvis"`, its comment and step text "Settings → Appearance" → "Settings → Jarvis & Office".
- Checked and left as they are: `notify-toast`, `settings-telegram` and `tray-settings-row` open `general`, whose Notifications and Menu bar cards stay there; the sleep and Claude account scenarios open `agents`, which keeps those cards; `canvas-gallery` reads only the storage page's last two cards. No scenario reaches the Fold rows (`window.minimize`, `window.sproutcorner`, `window.autosprout`); `jarvis-detail` covers them.

- [ ] **Step 4: Rewrite `docs/guide/settings.md` to the nine pages and their cards, with the nine new rows under Runs & limits**

- [ ] **Step 5: Add one line under the top section's `Changed` in `CHANGELOG.md`**

"Settings is sorted by what each setting changes: a Runs & limits page holds the run route, how many runs and heavy jobs go at once, keeping the Mac awake and when a costly spawn asks first; the pet's folding sits with Jarvis & Office; the vault with Storage & sync; About at the foot of the list. <!-- try: settings -->"

- [ ] **Step 6: Check both scripts parse and the scenario is listed**

Run: `node --check scripts/cdp/scenarios.mjs && node --check scripts/cdp/cockpitofficescenarios.mjs && grep -n 'name: "settings-runs"' scripts/cdp/scenarios.mjs`
Expected: exit 0, one match. The scenarios themselves pass only once Tasks 3 and 4 have built the pages; those tasks run them.

- [ ] **Step 7: Commit**

`git commit -m "test(cdp): settings scenarios open the pages that now hold their cards, and settings-runs drives the new rows; guide and changelog follow"`

### Task 3: The Runs & limits page

**Depends on:** Task 1, Task 2
**Files:** `frontend/app/view/agents/settingspages/runs.tsx`, `frontend/app/view/agents/settingspages/agents.tsx`, `frontend/app/view/agents/settingssurface.tsx`

**Interfaces:**
- Consumes: the row ids, card ids, `stepWithin`, `RUNS_MAX_ACTIVE`, `TOKENGATE_PCT`, `TOKENGATE_AGENTS`, `TOKENGATE_DEFAULTS` (Task 1); `PACE_CHOICES`, `pacePatch`, `paceOfSettings` from `frontend/app/cockpit/jobqueue.ts`; the scenario steps Task 2 wrote.
- Produces: `export function RunsPage(): JSX.Element` in `settingspages/runs.tsx`.

- [ ] **Step 1: Create `settingspages/runs.tsx` with `RunsPage`**

Three `SettingCard`s, ids `runs`, `whilework`, `tokenburn`, labels "Runs", "While work runs", "Token burn"; the Token burn card ends with a `CardFooter` reading "0 turns a check off.". Move `RunRouteRow` and `KeepAwakeRow` here from `agents.tsx` unchanged. New rows follow `SleepRows`' pattern (`getSettingsKeyAtom` with a `??` fallback to the default, `writeConfig` on change):
- `runs.maxactive`: `Stepper`, fallback `RUNS_MAX_ACTIVE.default`, steps with `stepWithin`.
- `runs.wakeorigin`: `Toggle`, fallback `true`.
- `runs.heavyjobs`: `Segmented` over `PACE_CHOICES` (mapped to `{ id, label }`), value `paceOfSettings(jobs:mode, jobs:slots)`, on change `writeConfig(pacePatch(value))`.
- `tokengate.enabled`: `Toggle`, fallback `true`; the five threshold rows: `Stepper`s, fallback from `TOKENGATE_DEFAULTS`, `TOKENGATE_PCT` for the four percentages (shown with `%`, as `SleepRows` shows `min`), `TOKENGATE_AGENTS` for agents; while the gate is off each wraps its control in `opacity-50`, as `SleepRows` dims the minutes.

- [ ] **Step 2: Remove the Runs card from `AgentsPage` in `agents.tsx` (lines 66–69) and the two rows' code and imports that moved**

- [ ] **Step 3: Route `case "runs": return <RunsPage />;` in `settingssurface.tsx`'s `SectionBody` switch (beside `case "agents"`, line ~404)**

- [ ] **Step 4: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && npx vitest run frontend/app/view/agents frontend/app/cockpit`
Expected: exit 0, PASS

- [ ] **Step 5: Run the scenarios that show it**

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs settings-runs settings-keepawake route-picker-flat route-picker-refused agy-harness settings-pages`
Expected: `settings-runs` steps 1–5, `settings-keepawake`, `route-picker-flat`, `route-picker-refused` and `agy-harness` pass; in `settings-pages` the `agents:`, `runs:`, `agents-detail` and `runs-detail` steps pass. `settings-pages`' `index`, `general:`, `appearance:`, `jarvis:`, `storage:` and `jarvis-detail` steps still fail here: Task 4 builds those pages and the foot. Look at the `settings-runs` shots and `settings-pages-runs.png`: the three cards, the new rows, Token burn's footer.

- [ ] **Step 6: Commit**

`git commit -m "feat(settings): a Runs & limits page holds the run route, active runs, heavy jobs, keeping the Mac awake and the token gate"`

### Task 4: Jarvis & Office, General, Storage & sync, and About at the foot

**Depends on:** Task 3
**Files:** `frontend/app/view/agents/settingspages/jarvis.tsx`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingspages/general.tsx`, `frontend/app/view/agents/settingspages/storage.tsx`, `frontend/app/view/agents/settingssurface.tsx`

**Interfaces:**
- Consumes: card ids and `foot` (Task 1); the scenario steps Task 2 wrote.
- Produces: `export function JarvisPage(): JSX.Element` in `settingspages/jarvis.tsx`; `export function VaultCard(): JSX.Element` from `general.tsx` (today a local function), imported by `storage.tsx`; the `data-settings-foot` hook on the index's foot.

- [ ] **Step 1: Create `settingspages/jarvis.tsx` with `JarvisPage`**

Cards in order: `jarvis` ("Jarvis": `PetCharacterRow`, `PetOutfitRow`, `PetQuotesRow`, with `SpiderThemeOffer`), `folding` ("Folding": the Minimize, Fold to and Fold when you leave rows from `general.tsx`'s `WindowRows`), `office` ("Office": `OfficeAnimationRow`, `OfficeHoursRow`, `OfficeSoundRows`). Move the components unchanged; delete them and their now-unused imports from `appearance.tsx` (cards at lines 52–61) and `general.tsx`. Appearance keeps `theme`, `colors`, `fonts`, `agentrows`.

- [ ] **Step 2: Rework `GeneralPage`**

Cards: `startup`, then `menubar` ("Menu bar": the `app.tray` and `app.traymemory` rows left from `WindowRows`), then `notifications`. Export `VaultCard` and stop rendering it here.

- [ ] **Step 3: Put `VaultCard` first on `StoragePage` in `storage.tsx` (above the category cards, line ~267)**

- [ ] **Step 4: Route `case "jarvis": return <JarvisPage />;` and draw About at the index's foot in `settingssurface.tsx`**

In the index list (lines ~353–375), render the sections without `foot`, then a `<div data-settings-foot className="mt-2.5 flex flex-col gap-px border-t border-border pt-px">` holding the `foot` ones: the line has the spec's 10px above it. Both parts draw the same item button (pull today's button into one local component rather than copying it). Filtering by search keeps applying to both parts; when no foot section matches, the foot is not drawn.

- [ ] **Step 5: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts && npx vitest run frontend/app/view/agents`
Expected: exit 0, PASS

- [ ] **Step 6: Run the scenarios that show it**

Run: `ARC_FINAL_OUT=$(mktemp -d) node scripts/cdp/final-verify.mjs settings-pages settings-vault-sync settings-storage settings-telegram tray-settings-row jarvis-pet office-sound cockpit-office`
Expected: all pass, `settings-pages` every step (the `index` step with the foot, the nine `<page>:` steps, `runs-detail`, `jarvis-detail`). Look at `settings-pages-general.png`, `settings-pages-jarvis.png`, `settings-pages-storage.png` and `settings-pages-jarvis-detail.png`: the cards in the spec's order, About under the index's line.

- [ ] **Step 7: Commit**

`git commit -m "feat(settings): the pet's folding rows join Jarvis & Office, the vault joins Storage & sync, and About sits at the foot"`
