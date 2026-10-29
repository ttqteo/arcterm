# Quick translate on the nav rail

Status: design, from the brainstorm `.superpowers/brainstorm/rail-translate/brainstorm.json` (2026-10-29).

## Intent

Sometimes the user needs a quick translation. Translation should work like Google Translate: you type or paste text
into one box and the translation shows below it. Translating a selection on screen is out of scope.

## What runs today

- Float has two fixed ledge tabs, Note and Translate (`docs/superpowers/specs/2026-10-17-float-note-translate-design.md`;
  `frontend/app/cockpit/float-ledge.tsx`, `frontend/app/view/agents/floatnotestore.ts` `showTranslate`). Translate
  opens the `trans` tool from `pkg/arctools/catalog.go`, which runs `wsh trans :vi` (`cmd/wsh/cmd/wshcmd-trans.go`).
  That command feeds each line to translate-shell (`trans -no-warn -dump :<target> -- text`), and `parseTransDump`
  reads the JSON Google returns: the translation, the phonetics, and the word classes with their meanings.
- The catalog has an install line only for Darwin (`brew install translate-shell rlwrap`). On Windows there is no
  package, so Translate does not work there. This Windows machine has no `trans` on PATH.
- The nav rail (`frontend/app/view/agents/navrail.tsx`) runs top to bottom: the core items, a divider, the tool items,
  up to three pinned services (`railapps.ts`), a flex spacer, then Setup and Settings. The rail is not rendered in Float
  (`cockpitshell.tsx`: `{floating ? null : <NavRail .../>}`).

## Native translators per OS

- **macOS:** Apple Translation runs on the device. It is free and works offline once a language pack is downloaded.
  On macOS 15, a `TranslationSession` can only be obtained through the SwiftUI `.translationTask` modifier on a view
  inside a window. The direct initializer `TranslationSession(installedSource:target:)` needs no UI, works only for
  installed language packs, and throws when one is missing; it arrived in macOS 26 (builder question 1, checked
  against Apple's docs). arcterm supports macOS 13 and later (`src-tauri/tauri.macos.conf.json`). It is a Swift API,
  so the Rust Tauri host needs a Swift bridge.
- **Windows:** ordinary apps have no public on-device translation API. The Windows AI APIs need Copilot+ hardware with
  an NPU.

## Google without translate-shell

translate-shell is only an HTTP client for Google's unofficial free endpoint (`client=gtx`), which needs no key.
`parseTransDump` already reads that endpoint's JSON array. The endpoint has no contract: if Google changes or blocks it,
the fallback breaks.

## Design

### Placement

- A Translate icon (lucide `Languages`, the icon Float's Translate tab already uses) sits at the bottom of the nav rail,
  just above Setup and Settings, under the flex spacer.
- Clicking it slides a narrow floating panel out to the right of the rail, over the current view. It is not a surface:
  it lives in the always-mounted shell, so the current surface stays as it is underneath.
- Esc or a click outside the panel closes it. The text stays for the next open (see **State**).
- The icon shows as pressed while the panel is open.

### Shortcut

- Ctrl+Shift+D (⌘⇧D on a Mac) is a global binding in `frontend/app/store/keybindings/bindings.ts`. It toggles the
  panel: it opens it, and pressing it again closes it.
- It works while typing in a terminal, like the other Mod+Shift globals. D was free among the Mod+Shift letters.
- It works in Float too, where it opens the panel the way Float's Translate tab does (below).
- `docs/keyboard-shortcuts.md` lists it.

### Look

A single column, like a narrow Google Translate:

1. **Language row.** A source select, a ⇄ swap button, and a target select. The default is English → Vietnamese. The
   source select also offers "Detect language". Swap works as Google Translate's does: the pair flips and the current
   translation, when there is one, moves into the input box, which then translates back (plan review, confirmed by the
   user). Swapping when the source is "Detect language" uses the detected language as the new target, or does nothing
   when nothing has been detected yet. Changing either select re-translates the current text at once. The last pair
   chosen is remembered across launches.
2. **Input box.** A multi-line text box with a clear (×) button. It translates as you type, after a short pause
   (debounced). Enter is not needed. Opening the panel focuses the box. Text over 5,000 characters (Google's limit) is
   not sent: the panel shows the error line instead.
3. **Word details.** When the input is a single word and the engine returns them, the phonetic and the word classes
   show under the input (for example `compaction · kəmˈpakSHən · Noun`). Google returns them; Apple Translation may
   not, and then this row is absent.
4. **Translation.** The translation sits on a background one step darker, with a copy button.

There is no microphone, speaker, History, or Saved. Colours come from the `@theme` tokens, and the layout follows
`DESIGN.md`.

### Languages

The user chooses source and target freely from a list of languages, with English → Vietnamese as the default.

### Engine

- **The OS's native on-device translator first.** On a Mac with macOS 26 or later, translation goes through Apple
  Translation via a new Tauri command backed by a small headless Swift helper that uses
  `TranslationSession(installedSource:target:)` (builder question 1). No SwiftUI view is attached to the Tauri window,
  so macOS never shows its own download sheet over arcterm: a missing language pack throws, and the request falls back.
- **Fallback: Google, called directly from wavesrv.** Where the OS has no native translator (Windows, macOS 13–25), or
  when Apple Translation cannot translate the pair (for example, the language pack is not downloaded), wavesrv calls
  Google's free `gtx` endpoint directly over HTTP, as translate-shell does. Nothing needs to be installed. This goes
  through a new wshrpc command.
- "Detect language" maps to `sl=auto` on Google. On Apple Translation, the source language is unknown until the
  translator detects it, or the bridge guesses it with `NLLanguageRecognizer`.

### Float

Float's Translate ledge tab shows the new panel in place of the translate-shell terminal. The panel's body shows the
way the Note tab's body does, over the terminal, since the rail is hidden in Float. Esc closes it and gives the
keyboard back to the terminal, as the Note does; so do the Translate tab or Ctrl+Shift+D again, and opening the Note or
any agent or terminal tab. Entering or leaving Float closes the panel, so neither variant reappears over the other. The
translate-shell tool stays in the catalog and in Setup → Tools for anyone who wants the shell; a trans terminal opened
from there is an ordinary ledge tab.

### State

- The input text and the last result live in a jotai atom in the shell. They survive closing the panel and switching
  surfaces within the session, and are not persisted across launches.
- The language pair is persisted (in localStorage, like other per-viewer UI conveniences such as `apps.rail`).
- A request that returns after a newer one has started is dropped, so a slow reply never overwrites a newer
  translation. Emptying the box or pressing × counts as newer too, so a late reply never refills a cleared result.

## Delivery

Two plans (builder question 2):

1. **This plan: the panel and Google on every OS.** It runs on the engine from Windows and is verified by CDP. The
   frontend's engine switch has only a stub for "native unavailable", so every OS, Macs included, translates through
   Google until plan 2 lands.
2. **A follow-up plan, done on a Mac: the Apple Translation path.** The Swift bridge compiles only on macOS, WKWebView
   answers no CDP, and `task dev:browser` has no Tauri host, so this part needs a Mac to build and a hand check there.
   It covers the Swift helper, the Tauri command, the availability check, and the Tauri command list in
   `docs/reference/architecture.md`.

## Left to the builder

Plan 2 (on a Mac):

- The Swift bridge from the Tauri host to Apple Translation: a small headless Swift helper (or `swift-rs` call),
  plus the new Tauri command. The Tauri command list in `docs/reference/architecture.md` must be updated.
- Runtime detection of whether Apple Translation is available (macOS 26 or later, whether the language pack is
  downloaded), falling back to Google when it is not.

Plan 1:

- An engine switch in the frontend with a stub for the native path, so plan 2 only fills it in.
- Move `parseTransDump` from `cmd/wsh` into a shared Go package used by the new wavesrv wshrpc command. `wsh trans`
  keeps working through translate-shell. Run `task generate` after adding the command.
- The language list, and the wording shown when Google does not answer or returns an error.
- The panel component and its jotai state; a pure model (`foo.ts` with `foo.test.ts`) for the debounce, request
  ordering, swap, and result shaping; a CDP scenario in `scripts/cdp/scenarios.mjs` that opens the panel from the rail
  and from Float's Translate tab, and screenshots each. The existing `float-note` scenario, which opens Float's
  Translate tab, needs updating, and so does `agent-rail-tabs`, which lists the rail's buttons.
- The CDP scenarios do not depend on Google answering: a dev-only seam in the frontend engine switch lets a scenario
  return a fixed answer, and the error line is shown through the real RPC by text over 5,000 characters, which wavesrv
  refuses without a request. The Google client itself is tested against a local HTTP server in Go.
- A `CHANGELOG.md` line under Added, ending with `<!-- try: <binding id> -->`.
- `docs/guide/agent.md` (the Vietnamese guide) describes Float's Translate tab as opening translate-shell; it describes
  the panel instead, and mentions the rail's Translate button and Ctrl+Shift+D.

## Out of scope

- Translating a selection in a terminal or transcript.
- Speech input or output, translation history, and saved phrases.
- LLM translation (pkg/consult, LM Studio): it was considered and not chosen.
- Removing translate-shell, the `trans` tool, or `wsh trans`.
