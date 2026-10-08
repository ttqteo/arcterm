# Claude account settings, reworked — design

Status: design settled 2026-10-08. Supersedes the "Settings UI" section of
`2026-10-07-claude-account-switch-design.md`; that spec's decisions 1–10 (tokens, env, quota keying) stand.

## Problem

The Claude account section reads like a form. Every token account row holds two always-open inputs (label, and
an email placeholder "chưa gắn email"), adding has two entry points side by side ("+ Đăng nhập account", "▸ Dán
token") with the paste form expanding under the list, and the strings mix English and Vietnamese ("Remove" next
to "đo 1m trước"). The email field also asks for something without saying why: arcterm cannot read a
setup-token's email (the token is inference-only), and the email only serves to carry an account's quota
history over from its `/login` days (decision 8).

Separately, resuming agents after a switch closed them instead of resuming them: the restart destroyed the
block's controller, and the old process's close-on-exit deleted the agent block 2 s later, under the resumed
process. Fixed in `pkg/blockcontroller` (`stoppedOnPurpose`: an exit whose controller was replaced or removed
does not close the block); listed here because the restart dialog's wording assumes it.

## Decisions

1. **English throughout** the section, the Add account dialog and the restart dialog, like the rest of
   Settings.
2. **The email moves into a row menu.** It stays (decision 8 needs it) but is never an open field.
3. **One entry point to add an account.** `+ Add account` opens the sign-in dialog; pasting a token is a
   screen inside it. The settings page has no paste form.

## The list

- Each row: a radio, the name, a quota line, and (token accounts only) a `⋯` button at the right edge.
  - Default: the `/login` email is the name (`quang.tt@mozox.com`) with a small `/login` tag; "Claude login"
    when the email is not known.
  - A token account: its label is the name; its email, when set, sits under it in muted text.
- Quota line: `5h 54% · week 99% · 1m ago`. A window at 90% or more is warning-toned. "Not used yet" without
  a snapshot.
- Clicking a row switches, as today, and opens the restart dialog when agents are still on the old account.
- `⋯` opens the shared context menu:
  - **Rename** turns the name into an input in place; Enter saves, Esc cancels, empty cancels.
  - **Same account as…** is a submenu: each email arcterm has seen (the known-emails list the datalist uses
    today), a check on the current one, "Other email…" (an in-place input like Rename), and "None" to clear.
  - **Remove** opens the existing confirm, reworded: `Remove "<label>" from this machine? Its token is deleted
    with it.` plus ` New agents will run on your /login account.` when it is the active one.
- Under the list, one button: `+ Add account`.

## Add account dialog

- Opens on sign-in, as today: the live `claude setup-token` terminal, with one line above it: "Sign in in the
  browser as the account to add. arcterm picks up the token itself."
- Under the terminal: "Have a token already? Paste it". It swaps the terminal for a token field
  (`sk-ant-oat01-…`) and Save, with "Back to sign-in". Leaving sign-in closes the helper tab (killing the
  command) exactly as closing the dialog does; going back starts a fresh one. A refused token stays in the
  field with the reason under it; the checks are today's (`sk-ant-oat` shape, then `CheckToken`).
- Both paths end on the same **Name it** step: a Name field (default "Account N") and, only when arcterm has
  seen an email, a "Same account as" select (None first). Done saves; Esc keeps the default name.

## Restart dialog

Same rules as today (idle pre-checked; working and asking unchecked), in English:

- Title: `Resume agents on <account name>?`
- Body: `These agents still run on the previous account. Resuming continues each one's session on the new one.`
- Notes: `working — resume after this turn`, `asking — resuming drops the question`; after a resume, `resumed`.
- Footer note: `Open terminals keep the previous account until they are reopened.`
- Buttons: `Later`, `Resume selected`.
- The not-applied error: `arcterm has not switched to this account yet (is its token still valid?). No agent
  was resumed.`

## Testing

- vitest: the Add account dialog's steps as a pure model (sign-in → name; paste → refused stays / accepted →
  name; back to sign-in), and the Default row's name (email, else "Claude login").
- CDP: update `settings-claude-account` to the new list (no inputs in rows), the `⋯` menu, the dialog's paste
  screen and its Name step.
