# One chord rule for Windows and macOS

Status: built 2026-10-12 (the `TMod` token in `keyutil.ts` / `keysym.ts`, `withWinCtrlAliases` in `bindings.ts`).

## Problem

The person uses arcterm on Windows by day and on a Mac at night, and the shortcuts don't carry over cleanly between
the two.

The root cause is that the keybinding dispatcher (`frontend/app/store/keybindings/dispatcher.ts`) listens on window
capture, ahead of xterm, so a chord the app binds never reaches a focused terminal. `Mod` is `Cmd` on a Mac and `Ctrl`
on Windows (`frontend/util/keyutil.ts` `parseKeyDescription`):

- **On a Mac,** no terminal uses `Cmd`, so the app's chords never collide with anything.
- **On Windows,** `Ctrl`+letter is a terminal control key, so the app takes it away from the shell or TUI.

Each collision has been patched on its own terms, and each patch has a different shape:

| Chord | Mac | Windows today | Patch |
|---|---|---|---|
| Close agent | ⌘W | Ctrl+Shift+W | Shift added (Ctrl+W deletes a word) |
| New run | ⌘⇧R | Ctrl+Shift+R | Shifted on both (Ctrl+R is reverse search) |
| Jarvis peek | ⌘J, also in a terminal | Ctrl+J, **not** in a terminal | Gated off (Ctrl+J is the newline) |
| Search | ⌘P | Ctrl+P, taken from the terminal | none: the shell loses previous-history |
| New agent | ⌘N | Ctrl+N, taken from the terminal | none: the shell loses next-history |
| Go-to leader | ⌘G | Ctrl+G, taken from the terminal | none: Claude Code loses Ctrl+G (edit the prompt in an editor) |
| Fold into Sprout | ⌘M | Ctrl+M, taken from the terminal | none: Ctrl+M is Enter |
| Clear terminal | ⌘K | — | `Cmd:k` reads as the Windows key there, which the system owns |

So the person has to remember, chord by chord, which platform does what.

## Rule

**A chord that works from inside a terminal is ⌘X on a Mac and Ctrl+Shift+X on Windows.**

This is the shape Windows Terminal and the VS Code terminal already use (Ctrl+Shift+P, Ctrl+Shift+W, Ctrl+Shift+C/V),
and close already follows it. Translating a chord from one platform to the other becomes one step: ⌘ ↔ Ctrl+Shift.

**Windows keeps the plain Ctrl+X too, but only outside a terminal.** Habit from the Mac (⌘P becomes Ctrl+P) still works
on a list, a field or the Code editor. Inside a terminal, Ctrl+X goes to the shell as it would in any other terminal.

**Exceptions, kept as they are:**

- `Mod`+`1`…`7`: digits are not terminal control keys, and Ctrl+Shift+digit reads as a symbol (`!`, `@`) on most layouts.
- `Ctrl`+`Tab`: Control on both platforms, as the system's own switchers are.
- Zoom (`Mod`+`=`, `-`, `0`).
- Code surface chords (`Mod`+`S`, `Mod`+`\`, `Mod`+`Shift`+`F`): they act in Monaco, not in a terminal.
- `Alt` chords (`Alt`+`1`…`9`, `Alt`+`C`, `Alt`+`W`): Option on a Mac, Alt on Windows, matched by key position. On
  Windows they shadow readline's meta keys (`Alt`+`C` capitalises a word, `Alt`+digit is a count), which are rarely used.

## Table

| Action | Mac | Windows, in a terminal | Windows, elsewhere |
|---|---|---|---|
| Search | ⌘P | Ctrl+Shift+P | Ctrl+P or Ctrl+Shift+P |
| Go-to leader | ⌘G | Ctrl+Shift+G | Ctrl+G or Ctrl+Shift+G |
| New agent | ⌘N | Ctrl+Shift+N | Ctrl+N or Ctrl+Shift+N |
| What's waiting (peek) | ⌘J | Ctrl+Shift+J | Ctrl+J or Ctrl+Shift+J |
| Fold into Sprout | ⌘M | Ctrl+Shift+M | Ctrl+M or Ctrl+Shift+M |
| Close agent or terminal | ⌘W | Ctrl+Shift+W | Ctrl+Shift+W (unchanged) |
| Clear terminal | ⌘K | Ctrl+Shift+K | — |
| New run | ⌘⇧R | Ctrl+Shift+R | Ctrl+Shift+R (unchanged) |
| Terminal fullscreen | ⌘⇧Enter | Ctrl+Shift+Enter | Ctrl+Shift+Enter (shipped 2026-10-12; F11 kept) |
| Settings | ⌘, | Ctrl+, | Ctrl+, (a comma is no terminal key) |
| Launch a Pi tab | removed | removed | removed (the New dialog's Pi row starts one) |

## Implementation

- **A `TMod` token** in `keyutil.ts` `parseKeyDescription`: Command on a Mac, Ctrl+Shift elsewhere. `keysym.ts`
  `formatChord` draws it as ⌘ or as two keys (`ctrl`, `shift`). Bindings name it statically (`TMod:p`), so nothing
  reads the platform at module load.
- **Windows aliases.** `withWinCtrlAliases` in `bindings.ts` adds a `Ctrl:<key>` binding (`id` + `:ctrl`,
  `alias: true`, `paletteHidden`) beside each TMod chord listed in `WIN_CTRL_ALIAS_GATES`. Its `when` adds the gate:
  "not in a terminal", or for the peek's Ctrl+J "not in a field".
- **`ctx.terminal`** (`types.ts`, set by `dispatcher.ts deriveKeyContext` from `closest(".xterm")`). `ctx.editable` is
  not enough: it is also true in plain text fields, where Ctrl+P is harmless.
- **The leader door.** `LEADER_ALIASES` in `matcher.ts` is `TMod:g`. Off a Mac, `Ctrl:g` opens it too, outside a
  terminal only.
- **`peekChordActive`** (`peekstore.ts`) drops its Windows gate.
- **Display.** The held-modifier bar (`footer-visible.ts heldHints`) counts `TMod` as the Ctrl / ⌘ key and skips
  aliases. The footer chips name `TMod`. The cheat sheet draws an alias on its action's row ("or ctrl+p outside a
  terminal").
- **Clear terminal** (`term-model.ts`) and close (`agentactions.ts closeAgentChord`) are `TMod:k` and `TMod:w`.

## VS Code defaults

The person comes from VS Code, so its default keys were checked against this table:

| VS Code (Windows / Mac) | Action | arcterm |
|---|---|---|
| Ctrl+P / ⌘P | Quick Open | Search; Ctrl+P stays on Windows outside a terminal, Code opens on Files |
| Ctrl+Shift+P / ⌘⇧P | Command palette | Search from inside a terminal on Windows: the same key |
| Ctrl+, / ⌘, | Settings | **added**: Settings |
| Ctrl+Shift+E / ⌘⇧E | Explorer | **added** on Code: focus the file tree (Alt+T kept) |
| Ctrl+Shift+F / ⌘⇧F | Search in files | already the same on Code |
| Ctrl+\ / ⌘\ | Split editor | already the same: Code's side column |
| Alt+Z / ⌥Z | Word wrap | already the same |
| Ctrl+S / ⌘S | Save | already the same |
| Ctrl+= / ⌘= (and - / 0) | Zoom | already the same, ⌘ on a Mac since 2026-10-12 |
| Ctrl+Tab | Switch editor | already the same: the tab switcher, Control on both |
| Alt+← / Alt+→ (Mac ⌃- / ⌃⇧-) | Back / forward | Alt+← / Alt+→ on both; the Mac keys were not added |
| Ctrl+G / ⌃G | Go to line | **kept as the go-to leader**: on Code, type `:123` in Search instead |
| Ctrl+B / ⌘B | Toggle sidebar | not added: Code's sidebar opens and closes through its own button (later) |
| Ctrl+Shift+G / ⌃⇧G | Source control | taken by the leader on Windows in a terminal; the Diff surface is `TMod`+`G` `f` |

## Decisions

1. **Launch a Pi tab:** the chord is removed (the person does not use it); `launchPiTab` went with it.
2. **Ctrl+P in Code on Windows** stays, since Monaco is not a terminal.
3. **Alt chords in a Windows terminal** stay as they are.

## Later

- **Ctrl+B / ⌘B** for Code's sidebar, once the sidebar has state a binding can toggle.
