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
- The UI each of Tasks 2–4 builds is shown by the `settings-claude-account` CDP scenario (`scripts/cdp/scenarios.mjs`), which Task 5 updates once all three have landed; each task's **Shown by** line names the scenario steps that show it, and Task 5 must add or keep every step so named. The step numbers are the ones Task 5 lists.
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

- [ ] **Step 1: Strip the old row editing and the paste form.** Remove from `ClaudeAccountSection`: the `pasteOpen` / `pasteLabel` / `pasteEmail` / `pasteError` state, `add`, the paste disclosure button and its form, both `CommitText` fields inside the rows, the `Remove` button, `KnownEmailsDatalist` (its import too) and `EMAIL_LIST_ID`, and `quotaPct` if nothing else uses it. Leave `frontend/app/view/agents/claudeemails.tsx` itself in place: Task 3 still imports it until it lands, and Task 5 deletes it. Keep `reload`, `select`, `rename`, `setEmail`, `remove`, the restart-dialog push, and the lazy `ClaudeSigninModal`.

- [ ] **Step 2: Draw each row.** Inside the radio row (keep `role="radio"`, `aria-checked`, `data-claude-account-row`, click/Enter/Space to `select(id)`):
  - Name: an element with `data-claude-account-name={id || "default"}` whose first text node is the name (the CDP scenario reads the row's name from it). Default → `defaultAccountName(identity.loginEmail)` followed by a small tag `<span data-claude-account-login-tag className="rounded border border-edge-mid px-1 text-[10.5px] text-muted">/login</span>`; a token account → `account.label`, or, while it is being renamed, an input (see Step 4) with `data-claude-account-rename-input`.
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

**Shown by:** `settings-claude-account` steps 1 (names and quota lines), 8 (Rename in place), 9–10 (Remove through the menu, its confirm wording), 15 (no inputs in rows, Default's name and `/login` tag), 16 (warning tone), 17 (Same account as… sets the email), 18 (Other email… and None), 19 (Rename: Esc and empty cancel), 20 (one `+ Add account` button), and the shots of the list and the open `⋯` menu. This task does not edit the scenario; Task 5 does.

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

**Shown by:** `settings-claude-account` steps 6–7 (paste: refused stays with its reason, accepted goes to the Name step), 12 (the sign-in line and title), 13 (Cancel), 14 (the printed token reaches the Name step), 21 (Back to sign-in closes the old helper tab and starts a fresh one), 22 (the Name step's `Same account as` select), and the shots of the paste screen and the Name step. This task does not edit the scenario; Task 5 does.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/cockpit/claude-signin-modal.tsx
git commit -m "feat(claude-account): one Add account dialog for sign-in and paste"
```

### Task 4: The restart dialog in English

**Depends on:** Task 2

**Files:** `frontend/app/view/agents/claudeaccountrestart.tsx`, `frontend/app/view/agents/settingssurface.tsx`

- [ ] **Step 1: Copy.** `NOTE.working` → `working — resume after this turn`; `NOTE.asking` → `asking — resuming drops the question`; the done note `đã restart` → `resumed`; the not-applied error → `arcterm has not switched to this account yet (is its token still valid?). No agent was resumed.`; body → `These agents still run on the previous account. Resuming continues each one's session on the new one.`; footer note → `Open terminals keep the previous account until they are reopened.`; buttons `Later` and `Resume selected`. In the file's header comment, `"Để sau" leaves them as they are.` becomes `"Later" leaves them as they are.`; no Vietnamese remains in the file.

- [ ] **Step 2: Title with the account's name.** Add an `accountName: string` prop; the title is `` `Resume agents on ${accountName}?` ``. In `settingssurface.tsx`'s `select`, pass `accountName`: `defaultAccountName(identity.loginEmail)` for `""`, else the account's label from `list`. (Task 2 has already reworked this file: this is a one-line change in its `select`.)

- [ ] **Step 3: Check and commit**

Run: `npx eslint frontend/app/view/agents/claudeaccountrestart.tsx` and `task check:ts`.

**Shown by:** `settings-claude-account` steps 2 (title `Resume agents on Fixture A?`, body, footer note, `Resume selected`), 3 (the English notes on working and asking) and 4 (`Later`). This task does not edit the scenario; Task 5 does.

```bash
git add frontend/app/view/agents/claudeaccountrestart.tsx frontend/app/view/agents/settingssurface.tsx
git commit -m "feat(claude-account): the restart dialog in English, named for the account"
```

### Task 5: CDP scenario, the dead email datalist, and CHANGELOG

**Depends on:** Task 2, Task 3, Task 4

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `frontend/app/view/agents/claudeemails.tsx`

The scenario is `settings-claude-account` (`const CA`, around `scripts/cdp/scenarios.mjs:20072`). Its arrange seeds Fixture A (97% / 64%) and Fixture B (no snapshot) and three roster agents; its steps are numbered 1–14 today. Keep that numbering for the steps that stay, and add 15–22 below. The `⋯` menu is the DOM context menu (`frontend/app/element/contextmenu.tsx`, rendered by `ContextMenuHost`): its rows carry no `data-*` hooks, so find a row by its text inside the open menu panel, click it, and open the `Same account as…` submenu by hovering its row with a real `Input.dispatchMouseEvent` `mouseMoved` at the row's centre (React's `onMouseEnter`), not a synthetic event.

- [ ] **Step 1: Delete the dead datalist.** Tasks 2 and 3 removed every use of `KnownEmailsDatalist`. Run `git grep -n "claudeemails\|KnownEmailsDatalist" frontend`; when it finds nothing, `git rm frontend/app/view/agents/claudeemails.tsx`. If a use remains, report it rather than deleting.

- [ ] **Step 2: Reword the checks the English copy breaks.** Each of these reads Vietnamese today:
  - arrange/teardown path near line 20268: `caClickButton(CA_RESTART, "Để sau")` → `"Later"`.
  - step 1 (near line 20314): `rowB.text.includes("chưa dùng")` → `"Not used yet"`.
  - step 3 (near lines 20349–20351): the notes `"đang làm việc"` / `"đang hỏi"` → `"working — resume after this turn"` / `"asking — resuming drops the question"`.
  - step 4 (near line 20355): click `"Later"`, and retitle the step `4. Later closes the dialog and leaves A selected`.
  - step 12 (near line 20483): retitle it `12. + Add account opens a live terminal in a helper tab the session sidebar leaves out`.
  - step 14 (near line 20509): the Name step's button is `Done`, not `"Lưu"`.
  After this step, `grep -nP "[À-ỹ]"` over the `CA` scenario's lines finds nothing.

- [ ] **Step 3: Update the scenario's readers to the new markup.**
  - `CA_ROWS`'s `label` reads `[data-claude-account-name]`'s first text node (trimmed), not an input's value.
  - Paste (6, 7): click `[data-claude-account-add]`, wait for `[data-claude-signin-modal]`, click `[data-claude-signin-paste]`, set `[data-claude-signin-token]` and press Enter. Step 6's refused reason reads `[data-claude-signin-paste-error]`, and asserts the token is still in the field. Step 7: after the good token, wait for `input[data-claude-signin-label]` (the Name step), set it to `Fixture C` with `caSetInput`, then click `Done`; then the existing `r6` / `idC` lookups by `"Fixture C"` hold. Add to step 7's check that the dialog is gone after Done.
  - Rename (8): click `[data-claude-account-menu="<idC>"]`, click `Rename` in the menu, set `[data-claude-account-rename-input]` to `Fixture C2`, press Enter.
  - Remove (9, 10): open the row's `⋯` menu and click `Remove` instead of `[data-claude-account-remove]`. Step 9 also asserts the confirm reads `Remove "Fixture C2" from this machine? Its token is deleted with it.` with no `/login` sentence (C is not active); step 10 asserts B's confirm ends with ` New agents will run on your /login account.` (B is active then).
  - Sign-in (12, 14): open through `[data-claude-account-add]` instead of `[data-claude-account-signin]`. Step 12 also asserts the dialog's title `Add a Claude account` and the line `Sign in in the browser as the account to add. arcterm picks up the token itself.`
  - Restart (2): also assert the title `Resume agents on Fixture A?`, the body `These agents still run on the previous account. Resuming continues each one's session on the new one.`, the footer note `Open terminals keep the previous account until they are reopened.` and a `Resume selected` button.

- [ ] **Step 4: Add steps for the new UI.** In the arrange's `rate` object add a snapshot keyed `claude:fixture@example.com` so `knownClaudeEmails` offers one email.
  - "15. rows hold no inputs: every name is text, and Default is named by its /login email or Claude login with a /login tag" — `document.querySelectorAll('[data-claude-account-row] input').length === 0`; `[data-claude-account-name="default"]` reads `defaultAccountName` of the live login email (the identity's email, else `Claude login`) and holds `[data-claude-account-login-tag]`.
  - "16. a row at 90% or more reads in the warning tone" — `[data-claude-account-quota="<A id>"]` has class `text-warning`; Default's (12%) does not.
  - "17. Same account as… sets the email, and it shows under the name" — on B's menu, hover `Same account as…`, click `fixture@example.com`; `[data-claude-account-email="<B id>"]` reads it and `claudeaccountlist` stores it; reopen the menu and the submenu shows that email checked.
  - "18. Other email… takes a typed email, and None clears it" — B's menu → `Same account as…` → `Other email…`; set `[data-claude-account-email-input]` to `other@example.com`, Enter; the email line reads it. Then `Same account as…` → `None`; `[data-claude-account-email="<B id>"]` is gone and the stored email is empty.
  - "19. Rename cancels on Esc and on an empty name" — B's menu → `Rename`; type `Nope`, press Esc: the label stays `Fixture B`. Again: set the input to empty, press Enter (and blur): the label stays `Fixture B`, and the row holds no input after.
  - "20. one + Add account button, no paste form on the page" — exactly one `[data-claude-account-add]` reading `+ Add account`; no `[data-claude-account-signin]`, `[data-claude-account-paste]` or `[data-claude-account-paste-token]`.
  - "21. Back to sign-in closes the old helper tab and starts a fresh one" — with `CA_IDLE_CMD`, open `+ Add account`, wait for the terminal, note the helper tab id; click `Have a token already? Paste it`: the helper tab is gone (`caTabIds`); click `[data-claude-signin-back]`: a terminal again, in a new helper tab whose id differs; Cancel, and the tabs are back to `ctx.tabIds`.
  - "22. the Name step offers Same account as, None first" — on step 7's Name step (before Done), `select[data-claude-signin-same]` exists, its first option is `None`, and it lists `fixture@example.com`. Run steps 15–22 in an order that keeps B for 17–19 before step 10 removes it.
  - Shoot the list, the open `⋯` menu (with the submenu open), the Add dialog's paste screen and its Name step to `cdp-shots/${CA}-*.png`.

- [ ] **Step 5: Run it** (only if a dev app is already running for you; do not start a build on the user's machine otherwise)

Run: `task verify:ui -- settings-claude-account`
Expected: every step PASS. Otherwise check the file with `node --check scripts/cdp/scenarios.mjs` and `npx eslint scripts/cdp/scenarios.mjs` (never prettier on it), and say it was not run.

- [ ] **Step 6: CHANGELOG.** Under `## Unreleased` → `### Changed` add: `- Settings → Claude account is simpler: each account is one line with its 5-hour and weekly use (in the warning colour at 90% or more) and a ⋯ menu for Rename, Same account as… and Remove; + Add account holds both signing in and pasting a token; and the section and its dialogs are in English.`

- [ ] **Step 7: Commit**

```bash
git add scripts/cdp/scenarios.mjs CHANGELOG.md
git commit -m "test(cdp): settings-claude-account follows the reworked section"
```
(`git rm` in Step 1 already staged the deletion.)
