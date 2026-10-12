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

**⌘X on a Mac is Ctrl+X on Windows, everywhere, inside a terminal too.** The app's chord wins over the shell, as
VS Code's own chords win in its terminal. The shell does not get Ctrl+P, Ctrl+G, Ctrl+N or Ctrl+M while arcterm is
open, which was already the case before this spec.

**A first version moved those chords to Ctrl+Shift+X in a Windows terminal and was reverted the same day:** having to
add Shift to keys already in the hands, only on one machine, was worse than giving the shell those four keys.

**`TMod` (Cmd on a Mac, Ctrl+Shift on Windows) is kept for close only:** `TMod`+`W`, since Ctrl+W deletes a word in a
terminal. Unchanged from before.

**What's waiting is plain `Mod`+`J` everywhere, terminal included.** On Windows that takes Ctrl+J, the newline, from
the terminal; arcterm's Shift+Enter (`term:shiftenternewline`) sends the same newline. A Ctrl+Shift+J version (with
Ctrl+J only outside a field) lasted a day: two keys for one action read as a clash.

**Clear the screen stays ⌘K on a Mac only.** A Ctrl+Shift+K for Windows was added and dropped the same day: rarely
needed, and one more key to remember.

**Unchanged:** `Mod`+`1`…`7`, `Ctrl`+`Tab`, zoom, the Code surface chords, and the `Alt` chords.

## Table

| Action | Mac | Windows (terminal included) |
|---|---|---|
| Search | ⌘P | Ctrl+P |
| Go-to leader | ⌘G | Ctrl+G |
| New agent | ⌘N | Ctrl+N |
| Fold into Sprout | ⌘M | Ctrl+M |
| What's waiting (peek) | ⌘J | Ctrl+J |
| Close agent or terminal | ⌘W | Ctrl+Shift+W |
| Clear terminal | ⌘K | — |
| New run | ⌘⇧R | Ctrl+Shift+R |
| Terminal fullscreen | ⌘⇧Enter | Ctrl+Shift+Enter (F11 kept) |
| Settings | ⌘, | Ctrl+, |
| Launch a Pi tab | removed | removed (the New dialog's Pi row starts one) |

## Implementation

- **A `TMod` token** in `keyutil.ts` `parseKeyDescription`: Command on a Mac, Ctrl+Shift elsewhere. `keysym.ts`
  `formatChord` draws it as ⌘ or as two keys (`ctrl`, `shift`).
- **`peekChordActive`** (`peekstore.ts`) drops its Windows gate.
- **Display.** The held-modifier bar (`footer-visible.ts heldHints`) counts `TMod` as the Ctrl / ⌘ key.
- **Close** (`agentactions.ts closeAgentChord`) is `TMod:w`; clear the terminal (`term-model.ts`) is `Mod:k` on a Mac only.

## VS Code defaults

The person comes from VS Code, so its default keys were checked against this table:

| VS Code (Windows / Mac) | Action | arcterm |
|---|---|---|
| Ctrl+P / ⌘P | Quick Open | Search, on Code it opens on Files |
| Ctrl+Shift+P / ⌘⇧P | Command palette | not bound; Search's Commands scope (`c:`) does the job |
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
| Ctrl+Shift+G / ⌃⇧G | Source control | not bound; the Diff surface is `Mod`+`G` `f` |

## Decisions

1. **Launch a Pi tab:** the chord is removed (the person does not use it); `launchPiTab` went with it.
2. **Ctrl+P, Ctrl+G, Ctrl+N, Ctrl+M stay plain on Windows, terminal included** (the Ctrl+Shift version was reverted).
3. **Alt chords in a Windows terminal** stay as they are.

## Later

- **Ctrl+B / ⌘B** for Code's sidebar, once the sidebar has state a binding can toggle.
