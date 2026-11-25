# GitHub accounts per folder

Date: 2026-11-25. Status: design, approved part by part in a brainstorm.

## Intent

The person uses two GitHub accounts on one machine: a personal one and a work one. To push as the account that is
not the machine's default, they have been putting a token into each repo's remote URL
(`https://<token>@github.com/...`) and setting `user.name` / `user.email` by hand in each repo. That leaks the token
(it shows in `git remote -v`, agent transcripts, copied config, and was committed once) and is easy to get wrong: a
repo where the identity was never set commits with the work email.

arcterm should own this: each account is tied to one or more root folders, and every repo under a root gets that
account's name, email and token, whether git runs in an arcterm agent, an arcterm terminal, another terminal or an IDE,
and whether arcterm is running or not.

## What runs today (recon, 2026-11-25)

- Windows machine: global identity is the work account; `credential.https://github.com.helper` is `gh auth
  git-credential` (one active account for the whole machine), and a global `credential.helper=store` keeps two
  github.com tokens in plain text in `~/.git-credentials`. Git Credential Manager 2.5.0 is installed but not used for
  github.com. Under the personal root, about 30 repos keep a personal token in their remote URL, and about 10 repos
  have no local identity, so they commit with the work email. git 2.45.1, gh 2.101.0.
- Mac: global identity is the personal account; work repos live under one folder; helper is `osxkeychain` (from the
  system gitconfig). Two repos keep a token in their remote URL. git 2.54.0 (Apple), no GCM, no gh.
- arcterm: `pkg/claudeaccount` keeps Claude accounts (list in a local file, tokens in `pkg/secretstore`) and ties an
  account to a project, injecting `CLAUDE_CODE_OAUTH_TOKEN` (`ProjectLaunchEnv`). Settings → Agents shows them in the
  Claude account card (`SettingCard id="claudeaccount"`, `frontend/app/view/agents/settingspages/agents.tsx`). Its
  add flow already has "Have a token already? Paste it" and checks a token before saving
  (`pkg/claudeaccount/checktoken.go`). Nothing in arcterm touches the person's git identity or git credentials today.

## Decisions

### Binding: by folder

Each account is tied to one or more root folders (for example the personal root → the personal account). A repo under
a root uses that account's name, email and token. Anywhere else, git uses the machine's global identity and helper as
it does today; the card shows that row as **Default**.

### Mechanism: git's own config, the OS credential store, plus scan and fix

- arcterm writes one marked block into the person's global `~/.gitconfig` with one
  `[includeIf "gitdir/i:<root>/"]` per root, each pointing at `~/.gitconfig-<account>`.
- `~/.gitconfig-<account>` holds `user.name`, `user.email`, and a `[credential "https://github.com"]` section with
  `username = <account>` and the OS helper. On Windows the section first resets the helper list with an empty
  `helper =` (the global config sets gh for github.com), then sets `helper = manager`. On the Mac it sets
  `helper = osxkeychain`.
- The token lives in the OS store (Keychain on the Mac, Windows Credential Manager through GCM), keyed by
  `username`, so several github.com accounts coexist. It is written with `git credential approve` and never kept by
  arcterm.
- Because a token in a remote URL beats every helper, the card also scans the roots and fixes those repos (below).
- A repo's own `user.name` / `user.email` still wins over the include (local config is read last), so a repo that sets
  its own identity on purpose keeps it.

### Where it lives: a GitHub accounts card on Settings → Agents

A **GitHub accounts** card right under the Claude account card, built the same way (a card with no setting rows, its
own RPCs, findable by keywords). It goes in its own file, not in `agents.tsx` (already 646 lines). The Agents page blurb
is reworded to cover GitHub too. Board: `.superpowers/design/git-accounts/project/A-agents-card.dc.html` (prototype).

Each account is a row: name, email, its root folders, token state, number of repos under its roots, and a ⋯ menu
(rename, add folder, remove folder, replace token, remove account). The Default row shows the global identity. A
warning strip shows when repos under a root keep a token in their remote URL, with the fix button. The footer has
**+ Add account** and **+ Add folder**.

### Adding an account: paste a token, check it, store it

**+ Add account** opens a dialog with a field for a fine-grained PAT. arcterm calls GitHub `GET /user` with it, and
refuses it if the call fails or the login does not match the account being added. It then asks for the email to
commit with and the first root folder, stores the token with `git credential approve`
(`protocol=https`, `host=github.com`, `username=<login>`), and writes the config above. Modeled on the Claude
paste-token check.

Agent's call: the dialog takes any token GitHub accepts, classic or fine-grained, one per account. Under the field it
says a fine-grained token covers one owner (the user or one org), so an account that pushes to org repos needs a classic
token or a token made for that org.

Agent's call: the card checks each account's token when it opens: it reads the token back with `git credential fill`
with prompts off (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`), calls `GET /user`, holds the token only for that
call, and shows **Token saved**, **Token refused by GitHub** or **No token saved**. There is no background check.

### Scan and fix: one pass with a preview

- The scan walks two levels under each root (skipping `node_modules`) and reads each `.git/config`: a remote URL with
  credentials in it, and the identity the repo would commit with.
- The fix button is enabled only when the account already has its token in the store, so removing the token from a
  URL never breaks the next push. Agent's call: when pressed it checks that token is still accepted (read back, `GET
  /user`) before changing anything.
- It opens a list of every repo it would fix (path, remote with the token masked), each with a tick that can be
  cleared. One press removes the credentials from the URL of every ticked repo, after saving a copy of each config.
- Agent's call: the list also shows repos under the root whose own `user.name` / `user.email` differ from the
  account, unticked, with their current identity beside them (a repo may set its identity on purpose). Ticking one
  unsets its local identity after a backup.
- The list has one more ticked row on a machine whose `~/.git-credentials` holds github.com lines: delete those lines
  (after a backup). So they stay gone, arcterm's marked block in `~/.gitconfig` resets the helper list for
  `https://github.com` and then sets back the helper that was in use there (gh on the Windows machine): a global
  `store` helper then no longer runs for github.com, and a token arcterm approves is not copied into the plain-text
  file. `store` stays for other hosts. The block saves the github.com helpers it found, so removing the block puts them
  back.

### Default account and two machines

arcterm never changes the global `user.name` or `user.email`; besides the include lines, its block holds only the
default username and the github.com helper reset (Fix). Its marked block in `~/.gitconfig` does set
`credential.https://github.com.username = <default login>`, ahead of the `includeIf` lines (which override it under a
root), so a repo outside every root asks the store for the default account's token: with two github.com tokens in the
Mac Keychain, a lookup with no username could hand out either. The first account added asks for the default account's
login, and the Default row shows it. Each machine keeps its own list of accounts and
roots; nothing syncs through the vault, because roots differ between machines and tokens must not go through git.

### Not in scope

- Rewriting old commits that went out with the wrong email.
- SSH keys.
- Changing which account gh is logged in as.
- Syncing tokens between machines.
- Hosts other than github.com.

## Left to the builder

- The begin/end markers of arcterm's block in `~/.gitconfig`, and removing the block's lines when an account or a root
  is removed.
- Where backups go (`.gitconfig`, each `.git/config`, `.git-credentials`).
- The wshrpc commands: list, add and remove account, add and remove root, scan, fix. Run `task generate` after.
- The card's states: no account yet, token refused by GitHub, token missing from the store, scan failed, nothing to fix,
  a fix that failed on some repos.
- Motion per DESIGN.md: a new row on `springReveal`; the fix list in a modal.
- A CDP scenario that shows the card and the fix list.
- A CHANGELOG line under Added.

## Approaches considered

- **Binding:** by folder (picked: matches how repos are already laid out on both machines and covers repos cloned
  outside arcterm); per project (misses repos never registered in arcterm, ~50 picks on one machine); folder with a
  per-project override (two places decide the account).
- **Mechanism** (weighed by the judge): includeIf + OS store + scan and fix (picked: works wherever git runs, even with
  arcterm closed); includeIf + an SSH key per account (each key pasted into GitHub by hand, a new file to manage);
  env vars only in arcterm (other terminals and IDEs keep the wrong account). Dropped: arcterm as the credential helper
  (tokens unreadable when wavesrv is not running), switching gh's account per folder (one active account per machine,
  two agents would fight over it).
- **Where:** the Agents page card (picked: sits beside the Claude account card, no move of that card, docs or
  screenshots); a new Accounts page (moves the Claude card and its docs for no visible gain); Storage & sync (roots
  and tokens do not sync anyway). Dropped: on the project folder row (a project row is one repo, a root holds many),
  only `wsh` commands (the person picked a page that fixes), the Diff commit bar (shows an account, cannot add one).
- **Getting a token in:** paste, check, store (picked: the one path that works the same on both machines with what is
  installed); paste plus moving the old URL tokens into the store (those tokens are already leaked); GCM browser
  sign-in on Windows with paste on the Mac (two flows); arcterm's own OAuth device flow (needs a registered OAuth app).
- **Fix:** one pass with a preview (picked); a Fix button per repo (30 presses for the same change); fixing
  automatically when a root is added (changes repo config without asking).

## Builder decisions (2026-11-26, autonomous run)

The "Left to the builder" items, and the calls the build needed beyond them. Each says why.

### Data and files

- **One source of truth.** `pkg/gitaccount` keeps the list in `<wave data dir>/git-accounts.json`:
  `{ "defaultlogin": "...", "accounts": [{ "login", "name", "email", "roots": [...] }], "githubhelpers": [...] | null }`.
  Every change rewrites the JSON, then renders arcterm's block in `~/.gitconfig` and each `~/.gitconfig-<login>`
  from it. Nothing is edited line by line, so removing an account or a root needs no special removal code: the next
  render simply leaves those lines out. Why: one render path, and the files on disk can never drift from the list.
- **Markers.** `# >>> arcterm git accounts: managed by arcterm, edits here are overwritten >>>` and
  `# <<< arcterm git accounts <<<`. The block goes at the end of `~/.gitconfig` (it must come after any global
  github.com helper for the reset to work). When the list has no accounts, the block and every arcterm-written
  `~/.gitconfig-<login>` are removed, and with them the helper reset, so git goes back to what it did before.
- **Block contents, in order:** `[credential "https://github.com"]` with, only once the `.git-credentials` fix has run,
  `helper =` followed by one `helper = <h>` per saved helper, then `username = <default login>`; then one
  `[includeIf "gitdir/i:<root>/"]` + `path = <absolute path of ~/.gitconfig-<login>>` per root. A root is written
  with forward slashes and resolved through symlinks (macOS temp dirs and `/tmp` are symlinks; git matches the
  resolved `.git` path).
- **Account file.** `~/.gitconfig-<login>` begins with a one-line `# managed by arcterm` header and holds `[user]`
  name and email and `[credential "https://github.com"]` with `helper =`, `helper = <OS helper>` and
  `username = <login>`. The OS helper is `osxkeychain` on macOS and `manager` on Windows (a package variable that tests
  swap for `store --file=<tmp>`). A file of that name without the header is backed up before it is replaced.
- **Commit name.** The add dialog fills the commit name from GitHub's `name` (else the login); the ⋯ menu's
  **Rename** edits it (it renames what commits carry: the login cannot change). The menu also has **Change email**,
  since a typo would otherwise need remove + re-add + a new token.
- **Backups** go to `<wave data dir>/git-accounts-backup/<YYYYMMDD-HHMMSS>/`, one folder per operation that writes
  outside arcterm's own files: `gitconfig` before every rewrite of `~/.gitconfig`, `git-credentials`, and
  `repos/<path with separators replaced>.config` for each repo config a fix changes. The newest 20 folders are kept.
  Why: off the person's home, beside the rest of arcterm's data, and capped so a long-lived machine does not grow
  them without end.
- **Roots** must be absolute, existing directories. A root inside, or containing, another account's root is refused
  (git's last matching include would decide silently). Each machine keeps its own list (spec).

### Tokens

- **Check:** `GET https://api.github.com/user` with `Authorization: Bearer <token>` and a 10 s timeout. 200 gives
  `login`, `name`, `email`; 401 is **refused**; anything else (offline, 5xx, rate limit) is **unreachable**. Adding or
  replacing a token needs a 200 whose login matches (case-insensitive) the login typed in the dialog. Why a login
  field first: the spec refuses a token whose login does not match "the account being added".
- **Store calls** always name the helper themselves:
  `git -c credential.helper= -c credential.helper=<OS helper> credential approve|fill|reject` with
  `protocol=https`, `host=github.com`, `username=<login>`, and `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`. So a
  token arcterm stores never reaches a global `store` helper or gh, whatever the global config says.
- **Token states** the card shows: **Token saved** (store has it, GitHub accepts it), **Token refused by GitHub**
  (401), **No token saved** (fill returns nothing), and one more the spec did not name, **Couldn't reach GitHub**
  (unreachable), so an offline machine never reads as a refused token. Checked once each time the card mounts.
- **Remove account** rejects its token from the store and deletes its file. It is refused while that login is the
  default login ("Change the default login first"): the block's `username` line would otherwise name a login whose token
  was just rejected, and every push outside the roots would fail. Removing an account's last root is allowed: the
  account stays with its token and file, its row reads **No folder**, and no include points at it. **Replace token** re-runs the check
  (same login) and approves the new token.
- **Default row:** shows the default login, the global `user.name` / `user.email` (read, never written) and the helper
  git uses for github.com outside every root (`gh`, `osxkeychain`, `manager`, …). Its ⋯ menu has
  **Change default login**. The first add requires the default login.

### Scan and fix

- **Scan** walks each root and two levels below it (`root/x`, `root/x/y`), skipping `node_modules` and dot
  directories; a directory with a `.git` **directory** is a repo (a `.git` file, a worktree or submodule, shares its
  main repo's config and is skipped). It reads `.git/config` with `git config --file`.
- **A leaked token** is an `https` `remote.*.url` or `remote.*.pushurl` on `github.com` whose userinfo has a password
  or a username shaped like a GitHub token (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`). A plain
  `https://user@github.com` is not a leak and is left alone. The list shows it masked as `https://•••@github.com/<path>`.
- **Identity rows:** a repo whose local `user.name` or `user.email` is set and differs from the account's.
- **Credentials row:** the github.com lines in `~/.git-credentials`, with their count.
- **Fix** (one RPC): refuses before touching anything unless the account's token reads back from the store and GitHub
  returns 200 for it. Then per ticked row, after backing up: rewrite the URL without userinfo; unset local `user.name`
  and `user.email`; drop the github.com lines from `~/.git-credentials` and save the github.com helpers in effect
  outside arcterm's block, minus the `store` family, into the JSON (`githubhelpers`), which turns the block's helper
  reset on. Helpers in effect come from `git config --show-origin --get-regexp` over `credential.helper` and
  `credential.https://github.com.helper`, applying empty-value resets in order. Each row reports its own result; one
  failure does not stop the rest.

### RPC and UI

- **wshrpc commands:** `GitAccountList`, `GitAccountCheckToken`, `GitAccountAdd`, `GitAccountUpdate`,
  `GitAccountSetToken`, `GitAccountRemove`, `GitAccountAddRoot`, `GitAccountRemoveRoot`, `GitAccountSetDefault`,
  `GitAccountTokenState`, `GitAccountScan`, `GitAccountFix`. List is local and fast; token state, scan and fix are
  separate calls the card makes after it draws, with a 30 s RPC timeout (the default 5 s is too short for a network
  check or a walk of 50 repos). No token ever crosses the wire back to the frontend.
- **Card:** label **GitHub accounts**, id `gitaccounts`, row-less with keywords (github, git, push, commit email,
  token, credential, identity), right under Claude account in its own file. The page blurb becomes the board's: "The
  Claude account agents run on, the git account they commit with, sleep and launch flags."
- **States:** no account yet (one line saying what the card does, + Add account); a token state per row; scan
  running (counts show a dash); scan failed (a Note with the error, rows stay); nothing to fix (no strip); a fix that
  failed on some repos (the modal stays open with a result per row, failures in the error tone).
- **Motion:** a new account row enters on `springReveal`; the add dialog and the fix list are `ModalShell` modals.
- **Folder entry:** a path field with a **Browse…** button that opens the Tauri folder picker
  (`@tauri-apps/plugin-dialog`), as Storage's vault row does; the browser build has no picker, so the field is what the
  scenario types into.
- **Verification:** the CDP scenario `settings-git-accounts` mocks every `gitaccount*` RPC in the page, so it never
  writes the person's `~/.gitconfig`, Keychain or repos, and never calls GitHub. The real git behaviour is proven by Go
  tests that run real `git` against a temp `HOME` with `GIT_CONFIG_NOSYSTEM=1` and a `store --file` helper, and a
  `httptest` GitHub. A real push under a root, and the Windows GCM path, are hand checks.
- **CHANGELOG:** one big line under Added with `<!-- shot: none -->`; the scenario calls
  `h.whatsnewShot("git-accounts", …)` so the Final run leaves the picture, to be named on the line afterwards (as the
  boards line did). Why: run workers have no CDP, and a shot named before its file exists fails `whatsnew.test.ts`.
