# Float Note and Translate — Design

In Float, the strip under the terminal (the ledge) gets two fixed tabs: **Note**, one global markdown scratch note, and **Translate**, a translate-shell terminal whose prompt names the target language. Agreed in chat on 2026-10-17 with the canvas `.superpowers/design/float-note-translate/` (boards below, gitignored), approved the same day; shipped by engine run 2f357374.

- **The note:** a markdown file in the vault (`<vault>/notes/scratch.md`). wavesrv reads and writes it over two wshrpc commands (`notescratchread`, `notescratchwrite`). In Float, a `FloatNote` overlay (`frontend/app/cockpit/float-note.tsx`) covers the terminal area; the terminal stack stays mounted under it, so the terminal never refits or replays. The state and the save are `frontend/app/view/agents/floatnotestore.ts`, the pure parts `floatnote.ts`.
- **Translate:** translate-shell is a built-in tool in `pkg/arctools`. It runs with an arcterm theme file that `wsh install-agent-hooks` writes to `~/.arc/translate-shell/arc.trans`, and rlwrap keeps its input history. The Translate tab shows the trans tool's terminal, or opens or installs it through the existing tool actions.
- **Checked by** the CDP scenario `float-note` (`scripts/cdp/scenarios.mjs`).

## Behavior

The canvas boards are the look; this section is the behavior. Each board, and what it shows:

| Board | State |
|---|---|
| Main | Note in Edit |
| NotePreview | Note in Preview |
| Terminal | Float on one agent |
| Translate | the trans terminal |
| TranslateInstall | the install terminal |
| NoteEmpty | an empty note |
| NoteError | a failed save |

- **The ledge's fixed tabs.**
  - In Float, the ledge (`frontend/app/cockpit/float-ledge.tsx`) shows two icon-only tabs at its left: Note (lucide `StickyNote`) and Translate (lucide `Languages`). A 1px `edge-mid` divider follows them, then the agent and terminal tabs.
  - A fixed tab is pressed as an agent tab is (`bg-surface-hover`, `ring-1 ring-edge-mid`, `text-primary`).
  - Because these tabs are always there, the agent and terminal tabs show even when only one agent floats (board Terminal), so there is always a way back.
  - The trans terminal is left out of the agent and terminal tabs, since its tab is Translate. It stays in the Ctrl+Tab switcher and the sidebar.
- **The Note overlay.**
  - Picking Note sets `floatNoteOpenAtom` and draws `FloatNote` over the terminal area, in `bg-surface` (one tone above the terminal's `bg-background`). It never changes `focusIdAtom`.
  - The note closes:
    - when focus changes by any route (a ledge tab, Ctrl+Tab, j/k…)
    - when an agent tab is clicked
    - on Escape in the editor
    - when Float ends
  - Re-entering Float shows the terminal, not the note.
  - When the note closes, keyboard focus goes into the focused terminal's xterm when it is showing, never `<body>` (approved 2026-10-17).
- **One global note.**
  - It is stored at `<vault>/notes/scratch.md` as raw markdown with no title heading.
  - `notestore.List` skips it, since `scratch` does not match the dated id, so it is not in the palette's Notes.
- **The editor.**
  - **Edit** (boards Main and NoteEmpty): a monospace textarea at 13px, 21px line height, `px-5 py-3.5`. Its placeholder is two lines: `Write markdown…`, a blank line, then `It saves as you type. Esc goes back to the terminal.`
  - **Preview** (board NotePreview): renders with `MarkdownMessage` (`frontend/app/view/agents/markdownmessage`), as the palette's notes do.
  - **Saving:** 500 ms after the last keystroke, and at once when the note closes. If two places edit at once, the last write wins.
  - **A failed save** (board NoteError) keeps the text and shows one line under it: an `error` circle icon, then `Couldn't save the note: <the error>. Your text stays here, and your next edit tries again.` The next save that works clears it.
- **The float bar while on Note** (board Main):
  - The left side shows the StickyNote icon and `Note`.
  - An **Edit | Preview** word switch sits before the pin: a 2px-padded `surface-raised` group with `edge-mid` border; the pressed half is `surface-hover`, `font-semibold`, `text-primary`. The group is `role="group"` with `aria-label="Note view"`; its buttons' titles are `Edit the note` and `Preview the note`.
  - The close button (X) is not rendered. Pin, Leave float and the Mac − stay.
- **The float bar on a terminal** (boards Translate and TranslateInstall): the left side shows lucide `SquareTerminal` (13px, `text-muted`) in place of the StatusDot, then the name from `toolTerminalName(terminal, tools)` (`frontend/app/view/agents/toolsmodel.ts`): `translate-shell` for the trans terminal, `Install translate-shell` for the install one. An agent keeps its StatusDot and name (board Terminal).
- **The `float-note` binding.**
  - It is global: `float-note`, `Mod:Shift:n`.
  - Outside Float, or in Float on a terminal, it opens Float straight on the Note. In Float on the Note, it goes back to the terminal.
- **The built-in tool.** translate-shell is added as a built-in tool:

  | Field | Value |
  |---|---|
  | id | `trans` |
  | name | `translate-shell` |
  | category | `Docs and data` |
  | purpose | `Translate: a word with its dictionary entry, or whole sentences` |
  | command | `trans` |
  | args | `-shell -theme ~/.arc/translate-shell/arc.trans :en+vi` |
  | opens in | `home` |
  | shows | `centre` |
  | Darwin install | `brew install translate-shell rlwrap` |
  | Windows install | none |

  - rlwrap is what gives the shell its ↑ and Ctrl+R history across sessions: trans uses it on its own whenever it is on PATH.
  - `:en+vi` translates into English and Vietnamese, as board Translate draws (approved 2026-10-17). With no target, trans would use the locale's language, which is English on this en_US Mac.
  - A user's `tools.json` overrides the args, for example to translate into Vietnamese alone with `:vi`.
- **The theme file** `cmd/wsh/cmd/trans-theme.trans`.
  - It holds trans's default theme (the `setDefaultTheme` values of translate-shell 0.9.7.1) with the prompt changed to `:fmt-prompt "%s → %t ❯ "`. The prompt then reads ` → English+Tiếng Việt ❯ ` with the built-in args (the source detected, so `%s` is empty), `English → Tiếng Việt ❯ ` with `en:vi`, and follows `:fr`, `en:vi` and `:swap` typed in the shell. Board Translate's prompt is this text, drawn without the leading space.
  - It must be a theme file passed with `-theme`: trans applies its theme after `init.trans`, which resets any prompt set there.
  - `wsh install-agent-hooks` writes it to `~/.arc/translate-shell/arc.trans` on every launch.
  - Without the file, trans prints no prompt at all, so the `float-note` scenario passes its own copy.
- **The Translate tab.**
  - If a terminal with `toolId === "trans"` exists, the tab focuses it (board Translate).
  - Otherwise, with `trans` on PATH, it opens the tool with `place: "centre"`.
  - Without `trans` on PATH, it runs the tool's install and shows that terminal, `Install translate-shell` (board TranslateInstall). The install terminal closes itself when the install succeeds, and the next press opens trans.
  - The tab is pressed while the trans terminal is in focus and the note is closed.
  - The install terminal carries no `tool:id`, so it is an ordinary ledge tab, pressed while it is in focus, and the Translate tab stays unpressed then (board TranslateInstall).
- **Not included:**
  - the Note outside Float
  - more than one global note
  - translating a selection
  - a list of past lookups to review (rlwrap's ↑ and Ctrl+R recall what you typed)
  - Google account features
  - Windows
