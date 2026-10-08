# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Settings surface becomes six pages of labelled cards with two-tier rows, a flat 240px index, keys shown only on hover, and one shape for every control, as the approved prototype draws it.

**Architecture:** `settingsmodel.ts` gains a card level (a section is cards, a card is a label plus rows) and maps retired section ids to their new page. The shared row, card and control primitives move out of the 1,800-line `settingssurface.tsx` into `settingsui.tsx`, and each page's body into its own file under `settingspages/`, so the four page tasks touch disjoint files. Values, stores, keys and commit behavior do not change.

**Tech Stack:** React 19 + jotai + Tailwind 4, vitest, the CDP harness (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-08-settings-redesign-design.md`

**Prototype:** D:/work/arcterm/.superpowers/design/settings-redesign/project

**Verify:** `node scripts/verify.mjs ./pkg/wconfig/...`

**Check:** `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: settings-pages needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs settings-pages settings-claude-account settings-radar-audit notify-toast harness-update agy-harness route-picker-flat`

## Global Constraints

- Page ids and order, exactly: `general`, `appearance`, `terminal`, `agents`, `headless`, `about`. Names: General, Appearance, Terminal, Agents, Background AI, About.
- Card membership (card id → row ids, in order) is the spec's Pages table:
  - general: `startup` (`general.startup`, `general.rail`), `notifications` (`notifications.os`, `notifications.toast`, `notifications.reply`), `vault` (`memory.vaultpath`, `memory.remote`)
  - appearance: `theme` (`appearance.theme`), `colors` (`appearance.accent`, `appearance.success`, `appearance.warning`, `appearance.error`), `fonts` (`fonts.sans`, `fonts.mono`), `jarvis` (`appearance.petoutfit`)
  - terminal: `text` (`fonts.term`, `terminal.fontsize`), `cursor` (`terminal.cursor`, `terminal.cursorblink`), `behavior` (`terminal.scrollback`, `terminal.copyonselect`)
  - agents: `claudeaccount` (no rows), `runs` (`run.route`), `flags` (`newagent.remember`, `newagent.runtime`, then the edited runtime's flag rows)
  - headless: `runtime` (`headless.runtime`), `openrouter` (`headless.apikey`, `headless.cheap`), `radar` (`headless.radaraudit`)
  - about: `versions` (`about.app`, `about.server`, `about.buildtime`, `about.platform`), `agents` (`about.harnesses`, `about.updatecheck`)
- Row ids, titles, descriptions, keys, scopes and `config` flags stay exactly as they are today. No setting is added or removed; no value moves store.
- Retired section ids resolve: `fonts` → `appearance`, `notifications` → `general`, `memory` → `general`, `newagent` → `agents`, `run` → `agents`, `claudeaccount` → `agents`.
- The index button keeps `data-section="<page id>"`; the page body keeps `data-settings-section="<page id>"`; every row keeps `data-setting-row="<row id>"`. Each card gets `data-setting-card="<card id>"`.
- Colors only from `@theme` tokens; never raw hex in `className`/`style`. Selection and hover are grey (`bg-surface-selected`, `bg-surface-hover`); the accent is for the changed dot, toggles that are on, focus and links.
- Card: label `text-[12px] font-semibold text-ink-mid` above `rounded border border-edge-mid bg-surface-raised overflow-hidden`; rows divided by `border-t border-edge-mid` (none on the first).
- Row: `px-4 py-3` (compact `py-[9px]`); title `text-[13px] font-medium text-primary`; description `mt-0.5 text-[12px] leading-[1.45] text-muted`; control at the card's right edge.
- Content column: `max-w-[720px]`, padding `px-10 pt-7 pb-12`, cards `gap-[22px]`. Page title `text-[18px] font-bold tracking-[-0.01em]`, blurb `text-[12.5px] text-muted`.
- Never hand-edit generated files. Never run prettier on `scripts/*.mjs`. `npx tsc` overflows: typecheck with the Check line (about 2 minutes). Commits carry no Co-Authored-By trailer.
- Scope inside shared files: Task 1 edits `settingssurface.tsx` only to keep it compiling. In `scripts/cdp/scenarios.mjs`, Tasks 3–6 edit only between their own step's `// --- <id> detail (Task N) ---` fences, plus the existing scenarios their steps name as theirs to fix.
- If a Storage section (from `docs/superpowers/plans/2026-10-08-storage-cleanup.md`) exists in `settingsSections` when a task starts, it becomes a seventh page placed before About, its rows in one card `storage`, built with the same primitives; do not drop it.

## Review Focus

1. **Search across merged pages:** "caret" must still find both cursor rows on Terminal, "claude account" must reach the Agents page through its card label though the card has no rows, and a query that empties the selected page moves the selection to the first page left. Pinned in Task 1 (`filterSections` tests).
2. **A retired section id from a deep link** (`pendingSettingsSectionAtom` holding `run`) opens Agents, never a blank pane. Pinned in Task 1 (`resolveSectionId`).
3. **Changed counts after the merge:** Terminal now holds `fonts.term`; its count and Reset section must include it, and Reset section still writes one settings.json patch for all of a page's config rows. Pinned in Task 1 (`changedCount`) and Task 2 (`resetSection` over `sectionRows`).
4. **The key pill copies the key without stealing the row's control focus**, and a row with no key shows no pill. Pinned in Task 2 (`keyPillTitle` tests) and the `settings-pages` hover step.

---

### Task 1: The model has six pages of cards

**Depends on:** none

**Files:** `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1: Write the failing tests.** In `settingsmodel.test.ts` replace the `groupSections`/`countLabel` imports and tests, and the `"settingsSections run route and groups"` block, with:

```ts
import { resolveSectionId, sectionRows } from "./settingsmodel";

describe("settings pages", () => {
    it("has six pages in order", () => {
        expect(sections().map((s) => s.id)).toEqual(["general", "appearance", "terminal", "agents", "headless", "about"]);
        expect(sections().map((s) => s.name)).toEqual(["General", "Appearance", "Terminal", "Agents", "Background AI", "About"]);
    });

    it("puts each row in the card the spec names", () => {
        const cards = Object.fromEntries(
            sections().flatMap((s) => s.cards.map((c) => [`${s.id}/${c.id}`, c.rows.map((r) => r.id)]))
        );
        expect(cards["general/startup"]).toEqual(["general.startup", "general.rail"]);
        expect(cards["general/notifications"]).toEqual(["notifications.os", "notifications.toast", "notifications.reply"]);
        expect(cards["general/vault"]).toEqual(["memory.vaultpath", "memory.remote"]);
        expect(cards["appearance/theme"]).toEqual(["appearance.theme"]);
        expect(cards["appearance/colors"]).toEqual(["appearance.accent", "appearance.success", "appearance.warning", "appearance.error"]);
        expect(cards["appearance/fonts"]).toEqual(["fonts.sans", "fonts.mono"]);
        expect(cards["appearance/jarvis"]).toEqual(["appearance.petoutfit"]);
        expect(cards["terminal/text"]).toEqual(["fonts.term", "terminal.fontsize"]);
        expect(cards["terminal/cursor"]).toEqual(["terminal.cursor", "terminal.cursorblink"]);
        expect(cards["terminal/behavior"]).toEqual(["terminal.scrollback", "terminal.copyonselect"]);
        expect(cards["agents/claudeaccount"]).toEqual([]);
        expect(cards["agents/runs"]).toEqual(["run.route"]);
        expect(cards["agents/flags"].slice(0, 2)).toEqual(["newagent.remember", "newagent.runtime"]);
        expect(cards["headless/runtime"]).toEqual(["headless.runtime"]);
        expect(cards["headless/openrouter"]).toEqual(["headless.apikey", "headless.cheap"]);
        expect(cards["headless/radar"]).toEqual(["headless.radaraudit"]);
        expect(cards["about/versions"]).toEqual(["about.app", "about.server", "about.buildtime", "about.platform"]);
        expect(cards["about/agents"]).toEqual(["about.harnesses", "about.updatecheck"]);
    });

    it("keeps every row exactly once", () => {
        const ids = sections().flatMap(sectionRows).map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(34 + RUNTIME_FLAGS.claude.length);
    });

    it("leaves the backend-authoritative run route off the config path", () => {
        const route = sections().flatMap(sectionRows).find((r) => r.id === "run.route")!;
        expect(route.scope).toBe("synced");
        expect(route.config).toBeUndefined();
    });
});

describe("resolveSectionId", () => {
    it("sends a retired id to the page that holds its rows", () => {
        expect(resolveSectionId("fonts")).toBe("appearance");
        expect(resolveSectionId("notifications")).toBe("general");
        expect(resolveSectionId("memory")).toBe("general");
        expect(resolveSectionId("newagent")).toBe("agents");
        expect(resolveSectionId("run")).toBe("agents");
        expect(resolveSectionId("claudeaccount")).toBe("agents");
    });

    it("passes a current id through", () => {
        expect(resolveSectionId("headless")).toBe("headless");
    });
});
```

Rewrite the existing tests that read `section.rows` to use `sectionRows(section)`, and update `filterSections`/`changedCount` tests to the card shape:

```ts
describe("filterSections", () => {
    it("returns the sections untouched for an empty query", () => {
        const all = sections();
        expect(filterSections(all, "")).toBe(all);
    });

    it("drops non-matching rows, then empty cards, then empty pages", () => {
        const found = filterSections(sections(), "scrollback");
        expect(found.map((s) => s.id)).toEqual(["terminal"]);
        expect(found[0].cards.map((c) => c.id)).toEqual(["behavior"]);
        expect(sectionRows(found[0]).map((r) => r.id)).toEqual(["terminal.scrollback"]);
    });

    it("reaches rows in pages the query does not name", () => {
        const found = filterSections(sections(), "caret");
        expect(sectionRows(found[0]).map((r) => r.id)).toEqual(["terminal.cursor", "terminal.cursorblink"]);
    });

    it("keeps a card whose label matches, rows and all, so a row-less card can be found", () => {
        const found = filterSections(sections(), "claude account");
        expect(found.map((s) => s.id)).toEqual(["agents"]);
        expect(found[0].cards.map((c) => c.id)).toEqual(["claudeaccount"]);
    });

    it("returns nothing when no row or card matches", () => {
        expect(filterSections(sections(), "zzzz")).toEqual([]);
    });
});

describe("changedCount", () => {
    const section: SettingSectionDef = {
        id: "terminal",
        name: "Terminal",
        blurb: "",
        cards: [
            { id: "x", label: "X", rows: [{ id: "a", title: "A", desc: "", key: "a" }] },
            { id: "y", label: "Y", rows: [{ id: "b", title: "B", desc: "", key: "b" }] },
        ],
    };

    it("counts this page's changed rows across its cards", () => {
        expect(changedCount(section, new Set(["a", "b", "elsewhere"]))).toBe(2);
        expect(changedCount(section, new Set())).toBe(0);
    });
});
```

- [ ] **Step 2: Run them to see them fail.** `npx vitest run frontend/app/view/agents/settingsmodel.test.ts` — expected FAIL (`resolveSectionId` is not exported, `cards` undefined).

- [ ] **Step 3: Implement.** In `settingsmodel.ts`:

```ts
export type SettingCardDef = {
    id: string;
    label: string;
    rows: SettingRowDef[];
};

export type SettingSectionDef = {
    id: string;
    name: string;
    blurb: string;
    cards: SettingCardDef[];
};

// Ids of the eleven pages the six replaced, for a deep link written before the merge.
const RETIRED_SECTIONS: Record<string, string> = {
    fonts: "appearance",
    notifications: "general",
    memory: "general",
    newagent: "agents",
    run: "agents",
    claudeaccount: "agents",
};

export function resolveSectionId(id: string): string {
    return RETIRED_SECTIONS[id] ?? id;
}

export function sectionRows(section: SettingSectionDef): SettingRowDef[] {
    return section.cards.flatMap((c) => c.rows);
}

// Cards keep the rows the query matches; a card whose label matches keeps all of its rows, which is how
// the Claude account card (no rows) is found. Empty cards drop, then empty pages. An empty query returns
// the sections unchanged (identity) so callers can skip the filtered path.
export function filterSections(sections: SettingSectionDef[], query: string): SettingSectionDef[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return sections;
    }
    return sections
        .map((s) => ({
            ...s,
            cards: s.cards
                .map((c) => (c.label.toLowerCase().includes(q) ? c : { ...c, rows: c.rows.filter((r) => rowMatches(r, q)) }))
                .filter((c) => c.rows.length > 0 || c.label.toLowerCase().includes(q)),
        }))
        .filter((s) => s.cards.length > 0);
}

export function changedCount(section: SettingSectionDef, changed: ReadonlySet<string>): number {
    return sectionRows(section).filter((r) => changed.has(r.id)).length;
}
```

Rebuild `settingsSections(flagRuntime)` as the six pages in the Global Constraints, moving each existing row object unchanged into its card. Card labels: Startup, Notifications, Vault & sync · Theme, Colors, Fonts, Jarvis · Text, Cursor, Behavior · Claude account, Runs, Launch flags · Runtime, OpenRouter, Radar · Versions, Coding agents. Page blurbs:
- General: "What opens at launch, when arcterm tells you about an agent, and where Jarvis keeps its vault."
- Appearance: "The palette every surface derives from, its role colors, and the faces the app is set in."
- Terminal: "Defaults for every agent and shell terminal."
- Agents: "The Claude subscription new agents run on, the route new runs take, and the flags every launch starts with."
- Background AI: keep Headless AI's blurb.
- About: "Versions of the shell, the backend it spawned, and the coding agents on this machine."

Delete `group`, `SettingGroup`, `GROUP_ORDER`, `groupSections` and `countLabel`.

In `settingssurface.tsx`, only enough to compile and render as before: `useRowBindings` and `resetSection` iterate `sectionRows(section)`; `ctx.visible` is built from `sectionRows(filtered)`; `setWanted(resolveSectionId(want))` for the pending deep link; the index renders `visibleSections` as one flat list (drop the group header and the `countLabel` span); `SectionBody` switches on the six ids and renders the old section components in card order (`general` → `<GeneralSection/><NotificationsSection/><MemorySection/>`, `appearance` → `<AppearanceSection/><FontsSection/>`, `terminal` → `<TerminalSection/>`, `agents` → `<ClaudeAccountSection/><RunRouteSection/><NewAgentSection/>`, `headless` → `<HeadlessAISection/>`, `about` → `<AboutSection/>`). `fonts.term` still renders inside `FontsSection` until Task 3 moves it — acceptable for this task.

- [ ] **Step 4: Run the tests.** `npx vitest run frontend/app/view/agents/settingsmodel.test.ts frontend/app/view/agents/settingsstore.test.ts` — expected PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(settings): six pages of cards in the settings model; retired page ids resolve to their new page"`

---

### Task 2: The frame, the shared primitives, one file per page

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/settingsui.tsx`, `frontend/app/view/agents/settingspages/general.tsx`, `frontend/app/view/agents/settingspages/appearance.tsx`, `frontend/app/view/agents/settingspages/terminal.tsx`, `frontend/app/view/agents/settingspages/agents.tsx`, `frontend/app/view/agents/settingspages/backgroundai.tsx`, `frontend/app/view/agents/settingspages/about.tsx`, `frontend/app/view/agents/settingssurface.tsx`, `frontend/app/view/agents/settingsmodel.ts`, `frontend/app/view/agents/settingsmodel.test.ts`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Failing test for the key pill's title.** Add to `settingsmodel.test.ts`:

```ts
import { keyPillTitle } from "./settingsmodel";

describe("keyPillTitle", () => {
    it("says what is copied and where the value lives", () => {
        expect(keyPillTitle({ id: "a", title: "", desc: "", key: "term:scrollback", scope: "synced" })).toBe(
            "Copy term:scrollback · synced in settings.json"
        );
        expect(keyPillTitle({ id: "b", title: "", desc: "", key: "cockpit.font.sans", scope: "local" })).toBe(
            "Copy cockpit.font.sans · stored on this machine only"
        );
        expect(keyPillTitle({ id: "c", title: "", desc: "", key: "radar:auditruntime", morekeys: ["radar:auditmodel"], scope: "synced" })).toBe(
            "Copy radar:auditruntime · radar:auditmodel · synced in settings.json"
        );
    });

    it("has no pill for a row that stores no setting", () => {
        expect(keyPillTitle({ id: "d", title: "", desc: "" })).toBeNull();
    });
});
```

Run `npx vitest run frontend/app/view/agents/settingsmodel.test.ts -t keyPillTitle` — expected FAIL.

- [ ] **Step 2: Implement `keyPillTitle`** in `settingsmodel.ts`:

```ts
// The key pill's tooltip: what a click copies, then where the value lives. A row without a scope (build
// info) says only what it copies.
export function keyPillTitle(row: SettingRowDef): string | null {
    const keys = rowKeys(row);
    if (keys.length === 0) {
        return null;
    }
    const where =
        row.scope === "synced" ? " · synced in settings.json" : row.scope === "local" ? " · stored on this machine only" : "";
    return `Copy ${keys.join(" · ")}${where}`;
}
```

Run the test again — expected PASS.

- [ ] **Step 3: Move the primitives into `settingsui.tsx`** and restyle them to the spec's Frame, Row and Controls sections. Export: `RowCtx`/`RowCtxValue` (add `visibleCards: Set<string> | null`), `SettingCard`, `SettingRow`, `CardFooter`, `CardWarning`, `Toggle`, `Segmented`, `Stepper`, `CommitText`, `SecretInput`, `Select`, `ChoiceRow`, `Value`.
  - `SettingCard({ id, label, children, header?, footer? })`: returns null when `ctx.visibleCards` is set and lacks `id`; renders the label, then the card box with `data-setting-card={id}`, `header` (a `CardWarning` or a tab strip) above the children and `footer` below.
  - `SettingRow({ id, compact?, inline?, children })`: two tiers (or one with `inline`, the description on the title line, used by flag rows); `group` class so `group-hover:`/`group-focus-within:` reveal the key pill; on hover/focus-within the row takes `bg-surface-hover`. Changed: a 5px `bg-accent` dot before the title (`title="Changed from the default"`) and after the control an icon button (`RotateCcw` 14px, `aria-label="Revert to default"`, `title="Revert to default"`). The key pill: `rounded bg-pill px-1.5 font-mono text-[10.5px] text-muted` with the keys and a `Copy` 11px icon, then the scope word (`synced` or `this machine`) in `text-[11px] text-ink-faint`; a `<button>` whose `title` is `keyPillTitle(def)` and whose click runs `navigator.clipboard.writeText(rowKeys(def).join(" "))`; hidden (`invisible`) until row hover or focus-within; absent when `keyPillTitle` is null. Keeps `data-setting-row={id}`.
  - `Toggle`: 32×18 track, `bg-accent` when on, `bg-edge-strong` off; knob 14px.
  - `Segmented`: `flex gap-0.5 p-0.5 rounded-sm border border-edge-mid bg-surface`; options `px-2.5 py-1 rounded-[4px] text-[12px] font-semibold`; selected `bg-surface-selected text-primary`, others `text-muted hover:text-primary`. Optional per-option `fontFamily` (style) for the font rows.
  - `Stepper`: one 28px box `rounded-sm border border-edge-mid bg-surface`, value `min-w-10 tabular-nums font-semibold`.
  - `CommitText`/`SecretInput`: 30px tall, `bg-surface border-edge-mid rounded-sm`, default width 260px.
  - `Select({ value, label, items, ariaLabel })`: a 28px button (`bg-surface border-edge-mid`, `ChevronDown` 12px) that opens `ContextMenuModel.getInstance().showContextMenu(items, e)`; `items` are `ContextMenuItem`s (radio items with `checked`, `sublabel`, separators).
  - `ChoiceRow({ selected, dim?, onPick, children })`: a card row button, `bg-surface-selected` plus a `Check` 14px when selected, `text-muted` name when `dim`.
  - `CardWarning`: `bg-askingbg` band, `TriangleAlert` 14px `text-warning`, `text-[12.5px] text-warning-soft`, `border-b border-edge-mid`.
  - `CardFooter({ dot?, children })`: `border-t border-edge-mid px-4 py-2.5 text-[12px]`; with `dot`, a 6px `bg-ink-faint` dot first.

- [ ] **Step 4: The frame in `settingssurface.tsx`.** Index: `w-[240px]`, `border-r border-border`, `px-3 py-4`; the search field at the top (30px, `bg-surface border-edge-mid rounded-sm`, `Search` 13px); then one flat list of buttons (`data-section`, 32px, `rounded-sm px-2.5 text-[13px] font-medium`, selected `bg-surface-selected text-primary`, others `text-ink-mid hover:bg-surface-hover`), each with a changed count when > 0 (a 5px `bg-accent` dot and the number in `text-[11px] font-semibold text-muted tabular-nums`). Remove `SurfaceHeader` from the index, the `Legend`/`ScopeDot` footer and the `CHANGED` badge. Content: the scroll container holds a `max-w-[720px]` column; the header (title, blurb, and Reset section as `rounded-sm border border-edge-mid px-2.5 py-1 text-[12px] font-semibold text-ink-mid` when the page has a changed row) scrolls with the page. Keep the motion fade on page change and `data-settings-section`. `ctx.visibleCards` is the set of card ids `filterSections` left on the selected page, null without a query.

- [ ] **Step 5: One file per page.** Move each old section component out of `settingssurface.tsx` into its page file, wrapped in `SettingCard`s by the card membership table (cards in order, each holding its rows' `SettingRow`s), using the `settingsui.tsx` primitives. Keep every control's behavior as it is today; Tasks 3–6 restyle inside their page. The page files export `GeneralPage`, `AppearancePage`, `TerminalPage`, `AgentsPage`, `BackgroundAIPage`, `AboutPage`; `SectionBody` renders them. `fonts.term` moves to `TerminalPage`'s `text` card here. Shared helpers the pages need (`writeConfig`, `FLAG_RUNTIMES`, `startupLabel`) move to `settingsui.tsx`.

- [ ] **Step 6: The `settings-pages` CDP scenario.** (Task 2 creates the page files listed above; `settingssurface.tsx` keeps the shell.) Add it to `scripts/cdp/scenarios.mjs` (4-space indent, no prettier), modelled on `settings-radar-audit`: arrange opens Settings (`surface:settings` via the nav button) at 1600×1000; one step per page, each clicking `[data-section="<id>"]`, asserting the page's card ids from `[data-setting-card]` in order, and taking `cdp-shots/settings-pages-<id>.png`. Add the steps `general-select` (placeholder, Task 3 fills it), `appearance-detail`, `terminal-detail`, `agents-detail`, `headless-detail`, `about-detail` (placeholders that pass, each between `// --- <id> detail (Task N) ---` comment fences so the page tasks edit disjoint lines), and `key-pill`: on Terminal, hover `[data-setting-row="terminal.scrollback"]` (CDP `Input.dispatchMouseEvent` mouseMoved over its rect), assert its key pill is visible and titled `Copy term:scrollback · synced in settings.json`, and assert `[data-setting-row="about.app"]` has no pill; shot `settings-pages-key-pill.png`. Move every `[data-section="…"]` click in other scenarios that names a retired id to its new id (`route-picker-flat` and `agy-harness` `run` → `agents`; `harness-update` `about` stays; `settings-claude-account` `claudeaccount` → `agents`; `notify-toast` `notifications` → `general`; `agy-harness` `newagent` → `agents`).

- [ ] **Step 7: Run.** `npx vitest run frontend/app/view/agents/settingsmodel.test.ts`, then the Check line — expected PASS, exit 0.

- [ ] **Step 8: Commit.** `git commit -m "feat(settings): cards, two-tier rows and keys on hover; the index is one flat list of six pages"`

---

### Task 3: General and Terminal pages

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/settingspages/general.tsx`, `frontend/app/view/agents/settingspages/terminal.tsx`, `frontend/app/view/agents/cockpitprefsstore.ts`, `frontend/app/view/agents/cockpitprefsstore.test.ts`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Failing test for the startup menu.** In `cockpitprefsstore.test.ts`:

```ts
import { startupMenuEntries } from "./cockpitprefsstore";

describe("startupMenuEntries", () => {
    it("puts Last opened above a divider, then every offered surface, checking the current one", () => {
        const items = startupMenuEntries("last");
        expect(items[0]).toEqual({ choice: "last", checked: true, hint: "the one you left" });
        expect(items[1]).toEqual({ divider: true });
        expect(items.slice(2).map((i) => ("choice" in i ? i.choice : null))).toEqual(
            startupSurfaceOptions().filter((k) => k !== "last")
        );
        expect(items.filter((i) => "checked" in i && i.checked)).toHaveLength(1);
    });

    it("checks a picked surface instead", () => {
        const items = startupMenuEntries("cockpit");
        expect(items.find((i) => "choice" in i && i.choice === "cockpit")).toMatchObject({ checked: true });
        expect(items[0]).toMatchObject({ checked: false });
    });
});
```

Run `npx vitest run frontend/app/view/agents/cockpitprefsstore.test.ts` — expected FAIL.

- [ ] **Step 2: Implement** in `cockpitprefsstore.ts`:

```ts
export type StartupMenuEntry = { choice: StartupSurface; checked: boolean; hint?: string } | { divider: true };

// The Startup surface select's menu: Last opened (what it does as its hint) above a divider, then the surfaces.
export function startupMenuEntries(current: StartupSurface): StartupMenuEntry[] {
    const [last, ...surfaces] = startupSurfaceOptions();
    return [
        { choice: last, checked: current === last, hint: "the one you left" },
        { divider: true },
        ...surfaces.map((k) => ({ choice: k, checked: current === k })),
    ];
}
```

Run the test — expected PASS.

- [ ] **Step 3: General page.** `general.startup` becomes a `Select` whose label is `startupLabel(startup)` and whose items map `startupMenuEntries(startup)` to `ContextMenuItem`s (`type: "radio"`, `checked`, `sublabel` from `hint`, `click` sets the atom; a divider is `{ type: "separator" }`). `general.rail` and the three notification rows are toggles. The vault card: `memory.vaultpath` a `CommitText` with the folder button inside (as today), `memory.remote` a `CommitText`; `vaultStatusLine` moves from under the field to the card's `CardFooter` with `dot`, and validation errors stay where they are today (under the field, `text-error`).

- [ ] **Step 4: Terminal page.** Three cards; `fonts.term` a `Segmented` with each option in its own face; font size and scrollback `Stepper`s; cursor style `Segmented`; blink and copy-on-select toggles.

- [ ] **Step 5: Scenario step `general-select`** (between its fences): on General, click the Startup surface select, assert the themed context menu lists "Last opened" first with the sublabel "the one you left", a separator next, and exactly one checked item; shot `settings-pages-general-select.png`; press Escape.

- [ ] **Step 6: Run** the vitest file above and the Check line — expected PASS.

- [ ] **Step 7: Commit.** `git commit -m "feat(settings): General and Terminal pages; Startup surface is a select"`

---

### Task 4: Appearance page

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/settingspages/appearance.tsx`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Theme card.** The theme picker becomes a `grid grid-cols-3 gap-1.5 p-3` of chips: 38px buttons, `rounded-sm border px-2.5 text-[12.5px] font-semibold`, a 2×2 grid of 10px swatches (the palette's background, raised surface, accent, success, from `THEMES`) then the name, then `Check` 13px on the selected one; selected `border-edge-strong bg-surface-selected`, others `border-edge-mid bg-surface`. The swatch colors are data, so they go in `style={{ background }}` from the palette (as the current picker does), not in classes. The row's title/description are not drawn above the grid (the card label says Theme); the changed dot and revert sit in the card label's line instead.

- [ ] **Step 2: Colors card.** Accent keeps its swatch row (18px swatches, the current one ringed) and custom picker; Working, Asking and Blocked are compact rows with the hex in `font-mono text-[11.5px] text-muted` and a 26×18 swatch that opens the color input as today.

- [ ] **Step 3: Fonts and Jarvis cards.** `fonts.sans`/`fonts.mono` `Segmented`s drawing each option in its own face; the pet outfit a `Segmented`.

- [ ] **Step 4: Scenario step `appearance-detail`:** assert seven theme chips with exactly one checked, the Fonts card's segmented options carry their own `font-family`; shot `settings-pages-appearance-detail.png`.

- [ ] **Step 5: Run** the Check line — expected exit 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(settings): Appearance page with theme chips and fonts drawn in their own face"`

---

### Task 5: Agents page

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/settingspages/agents.tsx`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Claude account card.** Each account is a card row: a `Check` column (the active account), the email `text-[13px] font-semibold`, the method tag (`/login` or `token`, `rounded bg-pill px-1.5 text-[11px] text-ink-mid`), "new agents use this" in `text-[11.5px] text-muted` on the active one; below, 5h and Week meters (a 64×4 `bg-edge-mid` track with a `bg-accent` fill, `bg-warning` from 80%, then the percent `tabular-nums text-secondary`) and the last-seen age, all from the existing `rowQuota`/`quotaLine` data; the ⋯ button opens the existing per-row menu. The active row has `bg-surface-selected`. "+ Add account" is the card's `CardFooter` button and opens the existing Add account dialog. Every existing behavior (switch, rename, remove, restart prompt) stays.

- [ ] **Step 2: Runs card.** `run.route` keeps its `RoutePicker`, restyled to the `Select` button look.

- [ ] **Step 3: Launch flags card.** The runtime `Segmented` becomes the card's header tab strip (`FLAG_RUNTIMES`, selected tab `bg-surface-selected`), with "per runtime" at its right in `text-[11.5px] text-muted`. `newagent.runtime`'s row is the tab strip itself (its `SettingRow` wraps the strip so search and `data-setting-row` keep working). Then `newagent.remember` as a normal row, then each flag as a compact `inline` row: the flag in `font-mono text-[12px] font-medium`, its description on the same line in `text-muted` (truncated), a toggle. Pi's empty catalog keeps its "no flags" line.

- [ ] **Step 4: Scenario step `agents-detail`:** assert the Claude account card is first, the active account row has a check, the flags card's header has five tabs and every flag row is one line tall (row height < 44px); shot `settings-pages-agents-detail.png`. Fix any `settings-claude-account` selector the new markup breaks, keeping what it asserts.

- [ ] **Step 5: Run** the Check line — expected exit 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(settings): Agents page — account list with meters, run route, launch flags under runtime tabs"`

---

### Task 6: Background AI and About pages

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/settingspages/backgroundai.tsx`, `frontend/app/view/agents/settingspages/about.tsx`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Runtime card.** The radio cards become `ChoiceRow`s: name, the command in `font-mono text-[11px] text-ink-faint`, then at the right a 6px dot and a word (`installed` `text-success`/`bg-success`, `not installed` `text-muted`/`bg-ink-faint`, `default · key missing` `text-warning`/`bg-warning`); a runtime that is not installed is `dim` and cannot be picked, as today.

- [ ] **Step 2: OpenRouter and Radar cards.** The "key not set" note moves from the bottom of the page to the OpenRouter card's `CardWarning` header, with today's condition and copy. API key `SecretInput`, cheap model `CommitText`; the Radar audit route keeps its picker in the `Select` look.

- [ ] **Step 3: About.** Versions card: four compact rows with the value at the right in `text-[13px] text-secondary tabular-nums`. Coding agents card: one row per harness (name, an "N available" pill `rounded-full bg-accentbg px-2 text-[11px] font-semibold text-accent-soft` when `harnessRowState` says a newer release is out, with today's update action, and the version `tabular-nums`), then `about.updatecheck` as a toggle row.

- [ ] **Step 4: Scenario steps `headless-detail` and `about-detail`:** six runtime rows with exactly one checked and the warning band first in the OpenRouter card when no key is stored; About's version values right-aligned; shots `settings-pages-headless-detail.png`, `settings-pages-about-detail.png`. Fix any `settings-radar-audit`/`harness-update` selector the new markup breaks, keeping what they assert.

- [ ] **Step 5: Run** the Check line — expected exit 0.

- [ ] **Step 6: Commit.** `git commit -m "feat(settings): Background AI and About pages as card lists"`

---

### Task 7: Changelog and the old surface's leftovers

**Depends on:** Task 3, Task 4, Task 5, Task 6

**Files:** `CHANGELOG.md`, `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1:** Delete anything in `settingssurface.tsx` no page uses any more (the old `Legend`, `ScopeDot`, `Note`, `countLabel` imports, the group code, unused imports). `settingssurface.tsx` keeps the surface shell, the index and `useRowBindings`.
- [ ] **Step 2:** Under `## Unreleased` → `Changed` in `CHANGELOG.md`: "Settings is six pages instead of eleven, laid out as cards: each setting is a title and one line of description, its config key appears when you hover it (click to copy), and Startup surface is a dropdown."
- [ ] **Step 3: Run** the Check line and `npx vitest run frontend/app/view/agents` — expected PASS.
- [ ] **Step 4: Commit.** `git commit -m "chore(settings): drop the old surface's leftovers; changelog"`
