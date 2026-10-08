# Claude Account Settings UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Settings → Claude account into a quiet list (name, quota, a `⋯` menu per token account), one `+ Add account` dialog that holds both sign-in and paste, and English copy throughout, including the restart dialog.

**Architecture:** Frontend only. The pure pieces (the Default row's name, the quota line and its warning, the Add dialog's step reducer) go in `frontend/app/view/agents/claudeaccount.ts` with vitest beside it; `settingssurface.tsx` (the list), `frontend/app/cockpit/claude-signin-modal.tsx` (the Add dialog) and `claudeaccountrestart.tsx` (the restart dialog) draw them. No RPC or Go type changes: rename, set-email, add, remove and list RPCs already exist.

**Tech Stack:** React 19 + jotai + Tailwind 4, vitest, the CDP harness (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-08-claude-account-ux-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/blockcontroller`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: settings-claude-account needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs settings-claude-account`

## Global Constraints

- UI copy is English, exactly as the spec words it. No Vietnamese strings remain in the section, the Add dialog or the restart dialog.
- Colors only from `@theme` tokens (`text-primary`, `text-secondary`, `text-muted`, `text-warning`, `border-edge-mid`, `bg-surface-hover`…), never raw hex. Read `DESIGN.md` before styling.
- The token is never shown or returned; the existing RPCs are the only path (`ClaudeAccountAddCommand`, `ClaudeAccountRenameCommand`, `ClaudeAccountSetEmailCommand`, `ClaudeAccountRemoveCommand`, `ClaudeAccountListCommand`).
- The `⋯` menu goes through `ContextMenuModel.getInstance().showContextMenu(items, e)` (`frontend/app/store/contextmenu.ts`); a submenu is an item with `submenu: [...]`, a check is `checked: true` on a `type: "checkbox"` item.
- Keep these `data-*` hooks (the CDP scenario reads them): `data-section="claudeaccount"`, `data-claude-account-row`, `data-claude-account-remove` is replaced by the menu (see Task 5), `data-claude-signin-modal`, `data-claude-signin-term`, `data-claude-signin-label`, `data-claude-signin-cancel`, `data-claude-restart-dialog`, `data-restart-row`, `data-restart-error`. New hooks are named in each task.
- Never run prettier on `scripts/*.mjs` (it reindents them). Check only the files you touched with `npx prettier --check <paths>` and `npx eslint <paths>`.
- Typecheck with `task check:ts` (about 2 minutes; give it a longer timeout).

### Task 1: Pure model — row name, quota line, Add dialog steps

**Depends on:** none

**Files:** `frontend/app/view/agents/claudeaccount.ts`, `frontend/app/view/agents/claudeaccount.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `claudeaccount.test.ts`; import the new names alongside the existing imports)

```ts
describe("defaultAccountName", () => {
    it("names Default by its /login email, else Claude login", () => {
        expect(defaultAccountName("quang.tt@mozox.com")).toBe("quang.tt@mozox.com");
        expect(defaultAccountName(undefined)).toBe("Claude login");
        expect(defaultAccountName("  ")).toBe("Claude login");
    });
});

describe("quotaLine", () => {
    const now = 1_000_000;
    it("reads 5h, week and age, and warns at 90% or more in either window", () => {
        expect(quotaLine({ fivehourpct: 54, weekpct: 99, capturedAt: now - 60_000 }, now)).toEqual({
            text: "5h 54% · week 99% · 1m ago",
            warn: true,
        });
        expect(quotaLine({ fivehourpct: 36.4, weekpct: 58, capturedAt: now - 5_000 }, now)).toEqual({
            text: "5h 36% · week 58% · <1m ago",
            warn: false,
        });
    });
    it("says Not used yet without a snapshot, and — for a missing window", () => {
        expect(quotaLine(null, now)).toEqual({ text: "Not used yet", warn: false });
        expect(quotaLine({ fivehourpct: undefined, weekpct: 91, capturedAt: now }, now).text).toBe(
            "5h — · week 91% · <1m ago"
        );
    });
});

describe("addAccountStep", () => {
    const acct = { id: "a1", label: "Account 2" } as ClaudeAccountData;
    it("starts on sign-in, opens paste, and goes back", () => {
        let s = addAccountStep(undefined, { type: "init" });
        expect(s).toEqual({ kind: "signin" });
        s = addAccountStep(s, { type: "paste" });
        expect(s).toEqual({ kind: "paste", busy: false, error: null });
        expect(addAccountStep(s, { type: "back" })).toEqual({ kind: "signin" });
    });
    it("keeps a refused token on the paste screen with its reason, and names an accepted one", () => {
        let s = addAccountStep({ kind: "paste", busy: false, error: null }, { type: "saving" });
        expect(s).toEqual({ kind: "paste", busy: true, error: null });
        s = addAccountStep(s, { type: "refused", message: "token refused (401)" });
        expect(s).toEqual({ kind: "paste", busy: false, error: "token refused (401)" });
        expect(addAccountStep(s, { type: "added", account: acct })).toEqual({ kind: "name", account: acct });
    });
    it("goes from sign-in to name when the printed token is stored, or to error when storing fails", () => {
        expect(addAccountStep({ kind: "signin" }, { type: "added", account: acct })).toEqual({
            kind: "name",
            account: acct,
        });
        expect(addAccountStep({ kind: "signin" }, { type: "failed", message: "boom" })).toEqual({
            kind: "error",
            message: "boom",
        });
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run frontend/app/view/agents/claudeaccount.test.ts`
Expected: FAIL — `defaultAccountName` / `quotaLine` / `addAccountStep` are not exported.

- [ ] **Step 3: Implement** (in `claudeaccount.ts`, beside `RowQuota` and `rowQuota`; `formatAgeShort` is in `./agentsviewmodel` and already reads `<1m` under a minute)

```ts
/** The Default row's name: the /login account's email, else "Claude login". */
export function defaultAccountName(loginEmail: string | undefined): string {
    const email = loginEmail?.trim();
    return email ? email : "Claude login";
}

// a window at or past this is about to run out
export const QUOTA_WARN_PCT = 90;

function pctText(pct: number | undefined): string {
    return pct == null ? "—" : `${Math.round(pct)}%`;
}

/** A row's quota line, and whether either window is at QUOTA_WARN_PCT or more. */
export function quotaLine(q: RowQuota | null, now: number): { text: string; warn: boolean } {
    if (q == null) {
        return { text: "Not used yet", warn: false };
    }
    return {
        text: `5h ${pctText(q.fivehourpct)} · week ${pctText(q.weekpct)} · ${formatAgeShort(now - q.capturedAt)} ago`,
        warn: (q.fivehourpct ?? 0) >= QUOTA_WARN_PCT || (q.weekpct ?? 0) >= QUOTA_WARN_PCT,
    };
}

/** The Add account dialog's steps: sign-in (the live `claude setup-token`), paste, then naming the account. */
export type AddStep =
    | { kind: "signin" }
    | { kind: "paste"; busy: boolean; error: string | null }
    | { kind: "name"; account: ClaudeAccountData }
    | { kind: "error"; message: string };

export type AddAction =
    | { type: "init" }
    | { type: "paste" }
    | { type: "back" }
    | { type: "saving" }
    | { type: "refused"; message: string }
    | { type: "added"; account: ClaudeAccountData }
    | { type: "failed"; message: string };

export function addAccountStep(s: AddStep | undefined, a: AddAction): AddStep {
    switch (a.type) {
        case "init":
        case "back":
            return { kind: "signin" };
        case "paste":
            return { kind: "paste", busy: false, error: null };
        case "saving":
            return s?.kind === "paste" ? { ...s, busy: true, error: null } : (s ?? { kind: "signin" });
        case "refused":
            return { kind: "paste", busy: false, error: a.message };
        case "added":
            return { kind: "name", account: a.account };
        case "failed":
            return { kind: "error", message: a.message };
    }
}
```

Check what `formatAgeShort(60_000)` returns (it defers to `formatAge` from a minute up); if it is not `"1m"`, fix the test expectation to what it returns, not the function.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run frontend/app/view/agents/claudeaccount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/view/agents/claudeaccount.ts frontend/app/view/agents/claudeaccount.test.ts
git commit -m "feat(claude-account): pure row name, quota line and Add dialog steps"
```

### Task 2: The account list — names, quota line, `⋯` menu, one Add button

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1: Strip the old row editing and the paste form.** Remove from `ClaudeAccountSection`: the `pasteOpen` / `pasteLabel` / `pasteEmail` / `pasteError` state, `add`, the paste disclosure button and its form, both `CommitText` fields inside the rows, the `Remove` button, `KnownEmailsDatalist` and `EMAIL_LIST_ID`, and `quotaPct` if nothing else uses it. Keep `reload`, `select`, `rename`, `setEmail`, `remove`, the restart-dialog push, and the lazy `ClaudeSigninModal`.

- [ ] **Step 2: Draw each row.** Inside the radio row (keep `role="radio"`, `aria-checked`, `data-claude-account-row`, click/Enter/Space to `select(id)`):
  - Name: Default → `defaultAccountName(identity.loginEmail)` followed by a small tag `<span data-claude-account-login-tag className="rounded border border-edge-mid px-1 text-[10.5px] text-muted">/login</span>`; a token account → `account.label`, or, while it is being renamed, an input (see Step 4) with `data-claude-account-rename-input`.
  - Under the name, muted 11px: Default → nothing extra (its email is already its name); a token account → `account.email` when set, with `data-claude-account-email={id}`.
  - Right side: `quotaLine(rowQuota(saved, claudeQuotaKey(id, identity), now), now)` in `text-[11px] tabular-nums`, `text-warning` when `warn`, else `text-muted`; give it `data-claude-account-quota={id || "default"}`.
  - Token accounts only, at the far right: a `⋯` icon button (`MoreHorizontal` from `lucide-react`, size 14) with `data-claude-account-menu={id}` and `aria-label="Account actions"`; its click calls `e.stopPropagation()` then `showAccountMenu(account, e)`.

- [ ] **Step 3: The menu.** Add, inside the component:

```tsx
const [renaming, setRenaming] = useState<string | null>(null);
const [emailing, setEmailing] = useState<string | null>(null); // "Other email…" input open on this row
const known = useMemo(() => knownClaudeEmails(saved, identity), [saved, identity]);
const showAccountMenu = (a: ClaudeAccountData, e: React.MouseEvent) => {
    const current = (a.email ?? "").toLowerCase();
    const items: ContextMenuItem[] = [
        { label: "Rename", click: () => setRenaming(a.id) },
        {
            label: "Same account as…",
            type: "submenu",
            submenu: [
                ...known.map((email) => ({
                    label: email,
                    type: "checkbox" as const,
                    checked: email.toLowerCase() === current,
                    click: () => setEmail(a.id, email),
                })),
                ...(known.length > 0 ? [{ type: "separator" as const }] : []),
                { label: "Other email…", click: () => setEmailing(a.id) },
                { label: "None", type: "checkbox" as const, checked: current === "", click: () => setEmail(a.id, "") },
            ],
        },
        { type: "separator" },
        { label: "Remove", danger: true, click: () => remove(a) },
    ];
    ContextMenuModel.getInstance().showContextMenu(items, e);
};
```

Check that `ClaudeAccountSetEmailCommand` with `email: ""` clears the email (read `pkg/wshrpc/wshserver` for the handler); if it refuses an empty email, say so in your report instead of changing Go.

- [ ] **Step 4: In-place inputs.** While `renaming === id`, the name is an autofocused text input (`data-claude-account-rename-input`) seeded with `account.label`: Enter commits through `rename(id, value)` when the trimmed value is non-empty and changed, then `setRenaming(null)`; Esc or blur with an empty value cancels. While `emailing === id`, an input (`data-claude-account-email-input`, placeholder `name@example.com`) sits under the name: Enter commits through `setEmail(id, value.trim())`, Esc cancels. Clicks and keys inside either input call `stopPropagation()` so they never select the row.

- [ ] **Step 5: Reword Remove.** In `remove`, the confirm's message becomes `` `Remove "${a.label}" from this machine? Its token is deleted with it.${a.id === active ? " New agents will run on your /login account." : ""}` `` (title `Remove account`, confirm label `Remove` stay).

- [ ] **Step 6: One Add button.** Under the list, a single button `+ Add account` with `data-claude-account-add` that opens `ClaudeSigninModal` (`setSigninOpen(true)`). Remove `data-claude-account-signin` and `data-claude-account-paste`.

- [ ] **Step 7: Check**

Run: `npx eslint frontend/app/view/agents/settingssurface.tsx` and `npx prettier --check frontend/app/view/agents/settingssurface.tsx`, then `task check:ts`.
Expected: no new errors (prettier: if HEAD was already unclean for this file, check that only your lines are reported).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/view/agents/settingssurface.tsx
git commit -m "feat(claude-account): a quiet account list with a per-row menu and one Add button"
```

### Task 3: The Add account dialog — sign-in, paste, name

**Depends on:** Task 1

**Files:** `frontend/app/cockpit/claude-signin-modal.tsx`

- [ ] **Step 1: Drive the dialog by `addAccountStep`.** Replace the `Phase` union's top level with `const [step, dispatch] = useReducer(addAccountStep, undefined, () => addAccountStep(undefined, { type: "init" }))`. Keep the terminal's own sub-state (`starting` / `running {tabId, blockId}` / `saving`) as local state used only while `step.kind === "signin"`.

- [ ] **Step 2: Start and stop sign-in with the step.** The effect that creates the helper tab, runs `setupTokenCommand` and scans the output now runs while `step.kind === "signin"` and tears down (closing the helper tab, which kills the command and deletes its term file) when the step leaves sign-in or the dialog unmounts: its dependency list is `[step.kind === "signin" ? signinAttempt : -1]`, where `signinAttempt` is a counter bumped on every `back`. A found token dispatches `added` with the stored account, or `failed`.

- [ ] **Step 3: Sign-in screen copy.** Title `Add a Claude account`. One line above the terminal: `Sign in in the browser as the account to add. arcterm picks up the token itself.` Under the terminal box, a text button `Have a token already? Paste it` (`data-claude-signin-paste`) dispatching `paste`.

- [ ] **Step 4: Paste screen.** Title stays `Add a Claude account`. A line: `A token from claude setup-token (starts with sk-ant-oat).` A password-style input (`data-claude-signin-token`, placeholder `sk-ant-oat01-…`, autofocus) and a `Save` primary button; Enter saves. Save: dispatch `saving`, call `RpcApi.ClaudeAccountAddCommand(TabRpcClient, { label: "", token })`, then `added` with the result (and `onAdded()`), or `refused` with the error text, which renders under the field (`data-claude-signin-paste-error`) while the token stays in the field. A text button `Back to sign-in` (`data-claude-signin-back`) dispatches `back`.

- [ ] **Step 5: Name step.** Title `Name this account`. Line: `Token saved. Select it in Settings to run new agents on it.` The Name input (keep `data-claude-signin-label`, placeholder = the stored default label). Only when `knownClaudeEmails(saved, identity)` is non-empty: a label `Same account as` and a `<select data-claude-signin-same>` with `None` first, then each email. Done (primary, `⏎`): renames when the name changed, sets the email when one is picked, then `onAdded()` and `onClose()`. Esc closes keeping the default name. Remove the free-text email input and `KnownEmailsDatalist` from this file.

- [ ] **Step 6: Footer.** Sign-in and paste: `Cancel` (keep `data-claude-signin-cancel`). Error: `Close`. Name: `Done`.

- [ ] **Step 7: Check**

Run: `npx eslint frontend/app/cockpit/claude-signin-modal.tsx`, `npx prettier --check frontend/app/cockpit/claude-signin-modal.tsx`, `task check:ts`.
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/cockpit/claude-signin-modal.tsx
git commit -m "feat(claude-account): one Add account dialog for sign-in and paste"
```

### Task 4: The restart dialog in English

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/claudeaccountrestart.tsx`, `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1: Copy.** `NOTE.working` → `working — resume after this turn`; `NOTE.asking` → `asking — resuming drops the question`; the done note `đã restart` → `resumed`; the not-applied error → `arcterm has not switched to this account yet (is its token still valid?). No agent was resumed.`; body → `These agents still run on the previous account. Resuming continues each one's session on the new one.`; footer note → `Open terminals keep the previous account until they are reopened.`; buttons `Later` and `Resume selected`.

- [ ] **Step 2: Title with the account's name.** Add an `accountName: string` prop; the title is `` `Resume agents on ${accountName}?` ``. In `settingssurface.tsx`'s `select`, pass `accountName`: `defaultAccountName(identity.loginEmail)` for `""`, else the account's label from `list`. (Task 2 has already reworked this file: this is a one-line change in its `select`.)

- [ ] **Step 3: Check and commit**

Run: `npx eslint frontend/app/view/agents/claudeaccountrestart.tsx` and `task check:ts`.

```bash
git add frontend/app/view/agents/claudeaccountrestart.tsx frontend/app/view/agents/settingssurface.tsx
git commit -m "feat(claude-account): the restart dialog in English, named for the account"
```

### Task 5: CDP scenario and CHANGELOG

**Depends on:** Task 2, Task 3, Task 4

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1: Update the scenario's readers.** `CA_ROWS`'s `label` reads the row's name text, not an input: use the first child text of the row's name element (add `data-claude-account-name` on that element in Task 2's markup if it is missing — a one-attribute change to `settingssurface.tsx` is allowed here). The paste steps (6, 7) now go through `+ Add account` → `Have a token already? Paste it` → `[data-claude-signin-token]` → Save, and a refused token reads `[data-claude-signin-paste-error]`; on success the dialog shows the Name step, and the scenario presses Done. Renaming (8) opens the row's `⋯` menu (`[data-claude-account-menu="<id>"]`), clicks `Rename` in the context menu, sets `[data-claude-account-rename-input]` and presses Enter. Remove (9) goes through the same menu's `Remove`. Sign-in (12–14) opens through `[data-claude-account-add]`. The restart-dialog steps (2–4) click `Later` instead of `Để sau` and read the English notes.

- [ ] **Step 2: Add steps for the new UI.**
  - "15. rows hold no inputs: every name is text, and Default is named by its /login email or Claude login with a /login tag" — assert `document.querySelectorAll('[data-claude-account-row] input').length === 0` and the Default row's text.
  - "16. a row at 90% or more reads in the warning tone" — Fixture A's quota element (`[data-claude-account-quota="<A id>"]`) has class `text-warning`.
  - "17. Same account as… sets the email, and it shows under the name" — pick the first known email through the menu, then read `[data-claude-account-email="<id>"]`.
  - Shoot the list, the open `⋯` menu, the Add dialog's paste screen and its Name step.

- [ ] **Step 3: Run it** (only if a dev app is already running for you; do not start a build on the user's machine otherwise)

Run: `task verify:ui -- settings-claude-account`
Expected: every step PASS.

- [ ] **Step 4: CHANGELOG.** Under `## Unreleased` → `### Changed` add: `- Settings → Claude account is simpler: each account is one line with its 5-hour and weekly use (in the warning colour at 90% or more) and a ⋯ menu for Rename, Same account as… and Remove; + Add account holds both signing in and pasting a token; and the section and its dialogs are in English.`

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/scenarios.mjs CHANGELOG.md frontend/app/view/agents/settingssurface.tsx
git commit -m "test(cdp): settings-claude-account follows the reworked section"
```
