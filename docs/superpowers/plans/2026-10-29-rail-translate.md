# Quick translate on the nav rail — plan 1: the panel and Google on every OS

**Spec:** `docs/superpowers/specs/2026-10-29-rail-translate-design.md` (plan 1 of its Delivery; the Apple Translation path is plan 2, done later on a Mac)
**Verify:** `node scripts/verify.mjs ./pkg/translate ./pkg/wshrpc/... ./cmd/wsh/cmd`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-translate float-note surface-smoke agent-rail-tabs`

Shape: Task 1 lands the wshrpc interface (types and generated bindings) only. Task 2 (the Go client and the server
method) and Task 4 (the rail panel) both build on it and run side by side, with Task 3 (the pure frontend model)
running beside Tasks 1 and 2. Task 5 moves Float's Translate tab onto the panel.

Decisions the plan makes beyond the spec:

- The shared Go package is `pkg/translate`. Its answer also carries the source language Google detected (`top[2]` of
  the gtx array), which Swap needs when the source is "Detect language".
- The language list is the set Google Translate accepts (its codes, English names, sorted by name). "Detect language"
  (`auto`) is offered on the source select only.
- The rail's Translate button is not a surface. CDP's `goto` and `activeSurfaceLabel` (`scripts/cdp/attach.mjs`) and
  `agent-rail-tabs` step 10 match `nav button`, so the button carries `data-nav-translate` and those selectors skip it,
  as they skip `data-nav-app`.
- The CDP scenarios never reach Google (spec, Plan 1): in a dev build, `translateengine.ts` checks
  `window.__arcTranslateStub` (a function `(req) => TranslateResult`, read only when `import.meta.env.DEV`) before the
  native stub and the RPC. The error line is shown through the real RPC: text over 5,000 characters, which wavesrv
  refuses without a request.

### Task 1: the `translate` wshrpc interface
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_translate.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

The wire contract only, so the frontend can build on it while Task 2 writes the client.

- `pkg/wshrpc/wshrpctypes_translate.go`: `TranslateCommands` with
  `TranslateCommand(ctx context.Context, data CommandTranslateData) (*CommandTranslateRtnData, error)`;
  `CommandTranslateData{Source, Target, Text}` (json `source`, `target`, `text`; `source` may be `auto`);
  `CommandTranslateRtnData{Translation, Source, Phonetics, Classes []TranslateClass}` (json `translation`, `source` —
  the detected language when the request said `auto`, else the request's —, `phonetics,omitempty`,
  `classes,omitempty`); `TranslateClass{Pos, Words}` (json `pos`, `words`).
- Embed `TranslateCommands` in the interface list in `pkg/wshrpc/wshrpctypes.go`.
- Run `task generate` and commit the regenerated files listed above (never hand-edit them). The server method is
  Task 2's; until it lands the call answers "command not implemented" at run time.
- The frontend calls it as `RpcApi.TranslateCommand(TabRpcClient, { source, target, text })`.

Acceptance: `task generate` leaves no diff once committed; `go build ./pkg/wshrpc/... ./cmd/...` passes;
`frontend/app/store/wshclientapi.ts` has `TranslateCommand` and `frontend/types/gotypes.d.ts` has
`CommandTranslateData`, `CommandTranslateRtnData` and `TranslateClass`.

### Task 2: `pkg/translate`, the server method, and `wsh trans` on the shared parser
**Model:** sonnet
**Files:** `pkg/translate/translate.go`, `pkg/translate/translate_test.go`, `cmd/wsh/cmd/wshcmd-trans.go`, `cmd/wsh/cmd/wshcmd-trans_test.go`, `pkg/wshrpc/wshserver/wshserver_translate.go`

- `pkg/translate`: move `parseTransDump`, `dechunk`, `transAnswer` and `transClass` from `cmd/wsh/cmd/wshcmd-trans.go`
  as exported `Parse(raw []byte) (Answer, error)`, `Answer{Translation, Source, Phonetics, Classes}` and
  `Class{Pos, Words}`. `Parse` also fills `Source` from `top[2]` when it is a string (empty otherwise).
- `translate.Google(ctx, source, target, text string) (Answer, error)`: a GET to
  `https://translate.googleapis.com/translate_a/single` with `client=gtx`, `sl` (`auto` for Detect), `tl`, `q`, and
  `dt=t`, `dt=rm`, `dt=bd` (translation, phonetics, dictionary), a 10 s timeout, then `Parse`. The base URL is a
  package variable so tests point it at `httptest`. A non-200 status, a transport error or an unreadable body is an
  error naming what happened; text over 5,000 characters is refused before any request with an error saying so; empty
  text returns an empty `Answer` with no request.
- `pkg/wshrpc/wshserver/wshserver_translate.go`: `(*WshServer).TranslateCommand` calls `translate.Google` and maps
  `Answer` onto Task 1's `CommandTranslateRtnData`; when the request's source is not `auto` and Google returned none,
  `source` is the request's.
- `wsh trans` keeps fetching through translate-shell (`trans -dump`) and parses with `translate.Parse`; its formatting
  (`formatTransAnswer`) and prompt stay in `cmd/wsh`.

Acceptance, by focused tests:

- `go test ./pkg/translate -run 'TestParse|TestGoogle'`: the word and sentence fixtures moved from
  `wshcmd-trans_test.go` parse as before, their expectations gaining `Source: "en"` (both fixtures carry `"en"` at
  `top[2]`); the unreadable case still errors; `TestGoogle_query` (httptest) sees `client=gtx`, `sl`, `tl`, `q` and
  the three `dt` values and returns the parsed answer; `TestGoogle_httpError` turns a 429 into an error naming the
  status; `TestGoogle_tooLong` refuses 5,001 characters without a request; `TestGoogle_empty` makes no request.
- `go test ./cmd/wsh/cmd -run 'TestFormatTransAnswer|TestTransLangLine'` still passes.

### Task 3: the pure translate model
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/translatemodel.ts`, `frontend/app/view/agents/translatemodel.test.ts`

Everything about the panel decidable without React or an RPC (the repo's `foo.ts` + `foo.test.ts` pattern). Tasks 4
and 5 rely on these exports exactly:

```ts
export type Pair = { source: string; target: string };
export type TranslateResult = {
    translation: string;
    source: string;
    phonetics?: string;
    classes?: { pos: string; words: string[] }[];
}; // field for field Task 1's CommandTranslateRtnData, so the RPC answer passes straight in
export type TranslateRequest = { source: string; target: string; text: string };
export type SwapState = { pair: Pair; input: string; result: TranslateResult | null };
export const LANGUAGES: { code: string; name: string }[]; // Google's codes, English names, sorted by name
export const DETECT = "auto";
export const DEFAULT_PAIR: Pair; // en -> vi
export const PAIR_KEY = "translate.pair";
export const TRANSLATE_DEBOUNCE_MS: number; // ~400
export const MAX_CHARS = 5000;
export function langName(code: string): string;
export function parsePair(raw: string | null): Pair;
export function swap(s: SwapState): SwapState;
export function requestFor(text: string, pair: Pair): TranslateRequest | null;
export function isCurrent(seq: number, latest: number): boolean;
export function wordDetails(input: string, result: TranslateResult | null): string[] | null;
export function translateErrorLine(err: unknown): string;
```

- `parsePair` reads the persisted pair (JSON), falling back to `DEFAULT_PAIR` for anything missing, malformed or naming
  an unknown code; the target is never `auto`.
- `swap` (spec **Look**, confirmed by the user): the pair flips and `input` becomes the current translation, `result`
  becomes `null`; with no translation the input stays. With source `auto`, the new source is the old target and the new
  target the detected language (`result.source`); with nothing detected, the state comes back unchanged.
- `requestFor`: `null` for blank text; otherwise the request (text over `MAX_CHARS` is still sent, so wavesrv's refusal
  reaches the panel as the error line).
- `isCurrent(seq, latest)`: true only when `seq === latest`. The store bumps `latest` for every request, every clear
  and every blank input.
- `wordDetails`: when the trimmed input is one word and the result has phonetics or classes, `[word, phonetic?, …the
  classes' pos capitalised]` (`["compaction", "kəmˈpakSHən", "Noun"]`); otherwise `null`.
- `translateErrorLine`: one line for a failure, saying the text stays and editing it tries again (worded like
  `scratchErrorLine` in `floatnote.ts`).

Acceptance: `npx vitest run frontend/app/view/agents/translatemodel.test.ts` covers each export, including swap with a
translation, without one, from Detect with and without a detected language; `isCurrent` on stale and current;
`requestFor` on blank and long text; `parsePair` on null, garbage, an unknown code and an `auto` target; `wordDetails`
on one word, a sentence and a result with no details.

### Task 4: the Translate panel on the rail, and Ctrl+Shift+D
**Depends on:** Task 1 (calls the generated `RpcApi.TranslateCommand`), Task 3 (uses the model and its types)
**Model:** sonnet
**Files:** `frontend/app/view/agents/translateengine.ts`, `frontend/app/view/agents/translatestore.ts`, `frontend/app/view/agents/translatestore.test.ts`, `frontend/app/view/agents/translatepanel.tsx`, `frontend/app/view/agents/navrail.tsx`, `frontend/app/view/agents/cockpitshell.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `docs/guide/agent.md`, `CHANGELOG.md`, `scripts/cdp/attach.mjs`, `scripts/cdp/scenarios.mjs`

The spec's **Placement**, **Shortcut**, **Look** and **State**, outside Float. Read `DESIGN.md` first; colours from the
`@theme` tokens only.

- `translateengine.ts`: `translate(req: TranslateRequest): Promise<TranslateResult>` asks, in order, the dev-only
  `window.__arcTranslateStub` (decision above), `nativeTranslate(req)` — a stub returning `null` ("native
  unavailable") with a comment pointing at plan 2 —, then `RpcApi.TranslateCommand`. Plan 2 fills in only
  `nativeTranslate`.
- `translatestore.ts` (module-level jotai atoms, like `floatnotestore.ts`): `translateOpenAtom`, the input, the last
  result, the error line, the pair (read with `parsePair` from localStorage `PAIR_KEY`, written on change, each access
  in try/catch). Actions: `openTranslate`, `closeTranslate`, `toggleTranslate`, `setTranslateText` (debounced by
  `TRANSLATE_DEBOUNCE_MS`), `clearTranslate`, `swapTranslate`, `setPair` (re-translates the current text at once).
  Every request, clear and blank input bumps the sequence, and a reply is applied only when `isCurrent`. A failure sets
  the error line and keeps the text; the next answer clears it. Text and result survive close and surface switches.
- `translatepanel.tsx`: the narrow single column — language row (source select with Detect language, ⇄, target
  select), a multi-line input with a clear ×, the word-details row when `wordDetails` gives one, the translation on a
  background one step darker with a copy button (briefly showing it copied), the error line in its place on failure.
  Opening focuses the input; Esc or a click outside closes it. Export the body separately from the rail's floating
  frame so Task 5 can show the same body in Float. CDP hooks: `data-translate-panel`, `data-translate-source`,
  `data-translate-target`, `data-translate-swap`, `data-translate-input`, `data-translate-clear`,
  `data-translate-details`, `data-translate-output`, `data-translate-copy` (with `data-copied` while it shows copied),
  `data-translate-error`.
- `navrail.tsx`: a Translate button (lucide `Languages`, aria-label "Translate") after the flex spacer and above Setup,
  `aria-pressed` while the panel is open, carrying `data-nav-translate`, never the surfaces' `text-accent-soft`.
- `cockpitshell.tsx`: render the panel when not floating, in the content area at its left edge, so it slides out to
  the right of the rail over the current surface (not inside `<nav>`, whose `isolate` would put it under the content).
- `bindings.ts`: a global binding `id: "translate"`, `keys: "Mod:Shift:d"`, group Global, label "Translate",
  `when: (ctx) => !ctx.modalOpen`, running `toggleTranslate`; it fires from a focused terminal like the other
  Mod+Shift globals. `docs/keyboard-shortcuts.md` gets its row; `docs/guide/agent.md` gets a sentence on the rail's
  Translate button and `Ctrl+Shift+D` (⌘⇧D).
- `CHANGELOG.md`: one line under Unreleased → Added, for the user, ending `<!-- try: translate -->`.
- `scripts/cdp/attach.mjs` (`goto`, `activeSurfaceLabel`) and `agent-rail-tabs` step 10 in `scenarios.mjs`: skip
  `[data-nav-translate]` alongside `[data-nav-app]`.
- `scripts/cdp/scenarios.mjs`: a new `rail-translate` scenario, added to the `SCENARIOS` array so Final runs it.
  Arrange sets `window.__arcTranslateStub` to return a fixed answer: for one word, a translation with phonetics and a
  noun class; for anything else, a translation alone; it records each request. Steps:
  (a) click the rail's Translate: the panel shows, the button is pressed, the input focused — shot
  `rail-translate-open.png`; (b) type `compaction`: the translation and the details row show — shot
  `rail-translate-word.png`; (c) type a sentence: a translation, no details row; (d) swap: the pair flips and the
  translation became the input; (e) change the target select: the current text is re-translated into it (the stub saw
  that target) and `localStorage["translate.pair"]` holds the new pair; (f) copy: the button shows copied;
  (g) clear ×: input and translation empty; (h) the error, through the real RPC: clear the stub, put 5,001 characters
  in the input: the error line shows and the text stays — shot `rail-translate-error.png`; set the stub again and
  shorten the text: the line goes; (i) Esc closes, reopening keeps the text; (j) Ctrl+Shift+D with a terminal focused
  opens it, again closes it — shot `rail-translate-shortcut.png`; (k) a click on the surface outside closes it.
  Teardown clears the stub and restores the pair the scenario found.

Acceptance: `npx vitest run frontend/app/view/agents/translatestore.test.ts frontend/app/cockpit/whatsnew.test.ts`
— the store tests: one request after the debounce pause; a stale reply never overwrites a newer one; a reply after a
clear or a blank input is dropped; `setPair` re-translates at once; the native stub falls through to the RPC; an RPC
error sets the error line and keeps the text; the pair round-trips through localStorage. `whatsnew.test.ts` passes with
the new `translate` try id. In Final: `rail-translate` (a)–(k) with their screenshots, `surface-smoke` (every surface
still navigable) and `agent-rail-tabs` step 10.

### Task 5: Float's Translate tab shows the panel
**Model:** sonnet
**Files:** `frontend/app/cockpit/float-ledge.tsx`, `frontend/app/cockpit/cockpit-root.tsx`, `frontend/app/view/agents/translatepanel.tsx`, `frontend/app/view/agents/translatestore.ts`, `frontend/app/view/agents/translatestore.test.ts`, `frontend/app/view/agents/floatnotestore.ts`, `frontend/app/view/agents/floatnotestore.test.ts`, `frontend/app/view/agents/floatnote.ts`, `frontend/app/view/agents/floatnote.test.ts`, `frontend/app/view/agents/sproutroster.ts`, `frontend/app/view/agents/sproutroster.test.ts`, `docs/keyboard-shortcuts.md`, `docs/guide/agent.md`, `scripts/cdp/scenarios.mjs`

The spec's **Float** section.

- `cockpit-root.tsx`: when floating and the panel is open, render Task 4's panel body over the terminal area
  (absolute, inset-0, beside `FloatNote`).
- Esc in the Float panel closes it and gives the keyboard back to the focused terminal, as `FloatNote` does on leaving.
- `float-ledge.tsx`: the Translate tab toggles the panel and is pressed while it is open; opening it closes the note;
  opening the note or picking any agent or terminal tab closes it. Ctrl+Shift+D in Float does what the tab does.
- Entering or leaving Float closes the panel (in `translatestore.ts`, following `floatModeAtom`).
- Remove what only the old tab used: `showTranslate` (`floatnotestore.ts`) and `translateStep` with its tests
  (`floatnote.ts`), and the `isTranslateTerminal` filter in `sproutroster.ts` `floatTabs`, so a trans terminal opened
  from Setup → Tools is an ordinary tab (update its tests); drop `isTranslateTerminal` / `TRANSLATE_TOOL_ID` if nothing
  else imports them (grep first). The `trans` tool, `wsh trans` and Setup → Tools stay.
- `docs/keyboard-shortcuts.md` and `docs/guide/agent.md` (the Float row, which says the tab opens translate-shell):
  the Translate tab opens the panel.
- `scripts/cdp/scenarios.mjs` `float-note`: replace steps 7–8 (translate-shell's install and terminal) with steps that
  use the same `window.__arcTranslateStub` as `rail-translate`: 7. the Translate tab shows the panel over the terminal,
  pressed, the input focused — shot `float-note-translate.png`; 8a. typing a word shows its translation; 8b. Note over
  Translate shows the note and unpresses Translate; 8c. Translate again shows the panel with the same text; 8d. Esc
  closes it and the terminal has the keyboard; 8e. an agent or terminal tab closes it; 8f. Ctrl+Shift+D opens and
  closes it; 8g. with the rail panel open, floating hides it, and with the Float panel open, leaving Float hides it (as
  step 6d does). Drop the `toolssetuser` trans setup and its teardown restore if nothing else needs them.

Acceptance: `npx vitest run frontend/app/view/agents/floatnote.test.ts frontend/app/view/agents/floatnotestore.test.ts frontend/app/view/agents/sproutroster.test.ts frontend/app/view/agents/translatestore.test.ts`
(including entering and leaving Float closing the panel). In Final: `float-note` steps 7–8g with their screenshot, and
its steps 1–6 still pass.
