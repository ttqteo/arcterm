# Chat: inline visuals an agent draws, with buttons that send a prompt

**Verify:** `node scripts/verify.mjs ./pkg/htmlserve/... ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

Runs after run dc14b0a6 (skim highlights in Chat, scroll after a send) has landed: it edits `chatcomposer.tsx` and
`chatpane.tsx` too.

Claude Desktop draws a "visual" inside the conversation: a small HTML page (a chart, a diagram, an illustration, a
widget with sliders, a quiz, a UI sketch) whose buttons send a prompt back into the chat as if the person typed it.
Claude Code has no such tool, so an agent in arcterm never makes one, and Chat could not draw one anyway. This plan
gives arcterm its own: the agent writes one HTML file under `~/.arc/visuals/` and names it in a one-line fenced block
in its reply; Chat draws the page inline, as tall as it is, themed with the app's colours, and a button in it calling
`arc.sendPrompt(text)` sends that text from the chat box.

What is already there, and stays:

- **Mermaid already renders in Chat.** Since run 009fc1e8, Chat draws agent prose through `CouncilText`
  (`chatconversation.tsx:477`), which passes `marks` and `diagrams` to `MarkdownMessage` (`councilchat.tsx:344-356`),
  so a ```` ```mermaid ```` block is drawn as its diagram (`markdownmessage.tsx` `DIAGRAM_COMPONENT`). Flowcharts,
  sequences, pie and xy charts need nothing new; the skill below sends the agent to mermaid first.
- **Serving an HTML file to an iframe is solved.** `pkg/htmlserve` registers a file's folder under an unguessable token
  (`HtmlPreviewServeCommand`, `wshserver_files.go:50`), serves it at wavesrv's web origin with its own CSP (`CSP`,
  `htmlserve.go`: fetches reach only the folder and the CDNs, forms post nowhere) and appends `scrollScript` to every
  HTML page. The File tab's `HtmlFrame` (`htmlframe.tsx`) frames it with `sandbox="allow-scripts allow-same-origin"`,
  `src = getWebServerEndpoint() + path`. The packaged app's CSP allows frames only from `http://127.0.0.1:*`
  (`src-tauri/tauri.conf.json:30`), which this origin is; a `srcdoc` frame would inherit the app's policy and run no
  inline script, so it is not an option.
- **Putting text into the chat box from outside is solved** (`chatinsert.ts`, `registerChatInsert` /
  `insertIntoChatBox`), and `ChatComposer.submit` (`chatcomposer.tsx:147`) is the one send path (wake, holds, pending
  bubble, and after run dc14b0a6 the scroll to the end).

Decisions (the lead's calls, each with why):

- **A file plus a one-line block, not inline HTML in the reply.** The agent writes the page to
  `~/.arc/visuals/<YYYY-MM-DD>-<slug>.html` and puts ```` ```arc-visual ```` / the absolute path / ```` ``` ```` in its
  reply. The terminal view shows three lines, not 200 lines of HTML; the page is served by `htmlserve` with its CSP;
  and the File tab can open the same file. `~/.arc/visuals/` sits outside every repo, so there is no gitignore question.
- **Chat draws only a file inside `~/.arc/visuals/`.** A reply is text an agent wrote, maybe under a prompt injection;
  drawing any `.html` path it names would serve that file's whole folder. Any other path, a relative one, or one with a
  `..` segment shows as the code block it is, with a line saying why. In DEV a `window.__chatVisualsDir` override
  points the check at a scenario's temp dir (the `window.__lineReviewSink` pattern, `linereviewsend.ts:19-26`).
- **The bridge is a script `htmlserve` appends**, as it appends `scrollScript`: it reports the page's height
  (`arc-html-height`), defines `window.arc.sendPrompt(text)` (posts `arc-visual-prompt`), takes the app's colours
  (`arc-visual-theme` sets `--arc-*` custom properties on the page's root) and says `arc-html-ready` once. Every
  HTML page `htmlserve` serves gets it; only Chat's visual frame listens for `arc-visual-prompt`, and only from its own
  frame, so a page in the File tab that calls it does nothing.
- **A prompt is sent only after a click in the visual.** The chat takes `arc-visual-prompt` from its own frame's
  window only, with non-empty text of at most 4,000 characters, and only while that iframe is the document's
  active element (the person clicked in it); otherwise it is dropped. While the box holds a draft, or within 1.5 s of
  the last prompt that frame sent, the text goes into the box after the draft instead of being sent. A sent prompt goes
  through `ChatComposer.submit`, so it wakes a sleeping agent, waits behind a permission card and shows the pending
  bubble like a typed one.
- **The frame mounts when it nears the view and then stays.** An iframe is a document: a long conversation of visuals
  mounts only those within 600 px of the scroller's view (IntersectionObserver), and the last height each path
  reported is kept in a module map, so a remount keeps its place. Task 5 measures the RAM of a few live visuals and logs
  it in `docs/open-issues.md` "RAM watch".
- **The agent learns it from a skill**, `skills/visual/SKILL.md` (Claude sees it as `arc:visual`), not a system
  prompt section: it costs nothing until a visual helps, as `arc:design` does.
- **Only a Claude agent's Chat draws it.** Councils draw agent text through the same `MarkdownMessage` but provide no
  visual host, so a block there stays code; pi has no Chat. The skill says so.

### Task 1: htmlserve's bridge script

**Depends on:** none

**Files:** `pkg/htmlserve/htmlserve.go`, `pkg/htmlserve/htmlserve_test.go`

**Step 1: Write the failing test** in `htmlserve_test.go`, beside `TestHandlerAddsTheScrollScriptToPagesOnly`
(read it first and follow its setup): `TestHandlerAddsTheBridgeToPagesOnly` serves a registered `page.html` and a
`style.css` from the same folder; the page's body ends with `scrollScript + bridgeScript`, and contains
`arc-visual-prompt`, `arc-html-height`, `arc-visual-theme` and `arc-html-ready`; the CSS is served byte for byte.
Extend the scroll-script test only if it asserted the body ends with `scrollScript` alone.

**Step 2:** `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/htmlserve -run 'Bridge'` → FAIL.

**Step 3: Implement.** In `htmlserve.go`, a `bridgeScript` const after `scrollScript`, with a comment in the file's
style saying what it is for (Chat's inline visuals, `frontend/app/view/agents/chatvisual.tsx`) and that every page gets
it but only Chat listens. Classic JS in an IIFE, `var p = window.parent; if (p === window) return;`:

- height: the `heightScript` logic of `pkg/canvasserve/canvasserve.go:148-169` (load, ResizeObserver on root and
  body, rAF-throttled, only on change), posting `{ type: "arc-html-height", h }`;
- `window.arc = window.arc || {}; window.arc.sendPrompt = function (text) { p.postMessage({ type:
  "arc-visual-prompt", text: String(text == null ? "" : text) }, "*"); };`
- a `message` listener: when `e.source === p` and `e.data.type === "arc-visual-theme"`, for each own key of
  `e.data.vars` matching `/^[a-z0-9-]{1,40}$/` with a string value of at most 200 characters, set
  `document.documentElement.style.setProperty("--arc-" + key, value)`;
- last, `p.postMessage({ type: "arc-html-ready" }, "*")`.

The handler appends `scrollScript + bridgeScript` where it appends `scrollScript` today (`WithSuffix(f, info.Size(),
scrollScript + bridgeScript)`). Update the package comment's mention of what is appended.

**Step 4:** the Step 2 command, then `go test ./pkg/htmlserve ./pkg/canvasserve` (same env) → PASS. `gofmt -l
pkg/htmlserve` → nothing.

**Step 5:** Commit: `git commit -m "feat(htmlserve): a served page reports its height, takes the app's colours and can
send a prompt to Chat" -- pkg/htmlserve/htmlserve.go pkg/htmlserve/htmlserve_test.go`

### Task 2: The visual's pure model

**Depends on:** none

**Files:** `frontend/app/view/agents/chatvisual.ts`, `frontend/app/view/agents/chatvisual.test.ts`

**Step 1: Write the failing tests** (`chatvisual.test.ts`, vitest) for each export below: `visualPathOf` accepts
`C:/Users/me/.arc/visuals/a.html` and `C:\Users\me\.arc\visuals\b.htm` (dir `C:/Users/me/.arc/visuals`, drive
letter case-insensitive) and `/home/me/.arc/visuals/c.html`; refuses with a reason an empty block, two lines, a
relative path, `.svg`, a path in another folder, a `..` segment, and a subfolder path only when it escapes the dir
(a subfolder inside is fine); `promptAction` covers each branch; `frameHeight` clamps; `themeVars` maps names and drops
empty values.

**Step 2:** `npx vitest run frontend/app/view/agents/chatvisual.test.ts` → FAIL (module missing).

**Step 3: Implement** `chatvisual.ts` (pure, no imports from React or the store; header comment saying what it is):

```ts
export const VISUAL_LANG = "arc-visual";
export const PROMPT_MAX = 4000;
export const PROMPT_GAP_MS = 1500;
export const FRAME_MIN = 120;
export const FRAME_MAX = 640;
export const FRAME_EXPANDED_MAX = 4000;

// `${home}/.arc/visuals`, slashes forward, no trailing slash
export function visualsDirOf(home: string): string;
// the block's one line as an absolute .html/.htm path inside dir, slashes forward; else why it is shown as code
export function visualPathOf(raw: string, dir: string): { path: string } | { refused: string };
export type PromptAction = "send" | "fill" | "drop";
export function promptAction(i: {
    fromFrame: boolean; // e.source is this visual's iframe window
    frameFocused: boolean; // document.activeElement is this iframe
    text: unknown;
    draft: string; // the chat box's current text
    sinceLastMs: number; // since this frame's last accepted prompt (Infinity when none)
}): PromptAction; // drop: not from the frame, not focused, not a string, empty after trim, over PROMPT_MAX;
//                   fill: draft non-blank or sinceLastMs < PROMPT_GAP_MS; else send
export function frameHeight(reported: number | undefined, expanded: boolean): number; // undefined → 160
// the app colours a visual gets, as the bridge's --arc-<key>: key → the app's CSS custom property
export const THEME_VARS: Record<string, string>; // background, surface, surface-raised, edge, ink, ink-mid,
//   muted, accent, success, warning, error → --color-background, --color-surface, --color-surface-raised,
//   --color-edge-mid, --color-ink-hi, --color-ink-mid, --color-muted, --color-accent, --color-success,
//   --color-warning, --color-error; font-sans, font-mono → --font-sans, --font-mono
export function themeVars(read: (cssVar: string) => string): Record<string, string>; // trimmed, empty dropped
```

Refusal reasons are the user's words, shown under the code block: `"a visual must be one absolute path"`,
`"a visual must be an .html file"`, `"a visual must sit in ~/.arc/visuals"`.

**Step 4:** the Step 2 command → PASS; `npx eslint` and `npx prettier --check` on both files → clean.

**Step 5:** Commit: `git commit -m "feat(chat): the inline visual's model: which paths draw, when a prompt sends, the
frame's height" -- frontend/app/view/agents/chatvisual.ts frontend/app/view/agents/chatvisual.test.ts`

### Task 3: Chat draws the visual, and its prompts send

**Depends on:** Task 2 (imports `chatvisual.ts`)

**Files:** `frontend/app/view/agents/chatvisualview.tsx`, `frontend/app/view/agents/markdownmessage.tsx`, `frontend/app/view/agents/chatinsert.ts`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatpane.tsx`

Read `DESIGN.md` (tokens, the card and button rules, motion) and `htmlframe.tsx` (the frame's src and sandbox) first.

**Step 1: The registries** (`chatinsert.ts`): beside `registerChatInsert`, `registerChatSubmit(agentId, submit:
(text: string) => boolean)` with `submitIntoChatBox(agentId, text)`, and `registerChatText(agentId, read: () =>
string)` with `chatBoxText(agentId): string` (`""` when no box is mounted); same map pattern and unregister rule, no
imports.

**Step 2: The composer registers them** (`chatcomposer.tsx`, next to the `registerChatInsert` effect): the text
reader returns `latest.current.text`; the submit returns `false` when the box is read-only, else `setText(text)`, sets
a `submitNext` ref and returns `true`; a `useEffect` on `[text]` that sees `submitNext` clears it and calls
`submit()`. A submit that is held (permission card, upload) leaves the text in the box, which is right.

**Step 3: The view** (`chatvisualview.tsx`, header comment saying what it draws and pointing at the plan's rules):

- `VisualHostContext` (React context, default `null`) of `{ agentId: string; visualsDir: string | null }`, and
  `ChatVisualHost` providing it: `ChatPane` wraps its conversation in it. `visualsDir` is `visualsDirOf(await
  homeDir())` (`pathlinkroute.ts:75`), or in DEV `window.__chatVisualsDir` when it is a string (declare it in a
  `declare global` block as `linereviewsend.ts:52-57` does); `null` while unknown.
- `VisualBlock({ raw })`: no host → `<CodeBlock code={raw} lang="arc-visual" />` as today. With a host, while
  `visualsDir` is `null` draw nothing taller than the loading card; `visualPathOf` refused → the CodeBlock plus
  `<div data-chat-visual-refused className="mt-1 text-[11.5px] text-muted">Shown as code: {reason}</div>`; else
  `<ChatVisual path agentId />`.
- `ChatVisual`: `<figure data-chat-visual={path} className="my-2 overflow-hidden rounded-[10px] border
  border-edge-mid bg-surface">`. Header `flex h-8 items-center gap-2 border-b border-edge-faint px-3 text-[11.5px]
  text-muted`: lucide `Shapes` 12px `aria-hidden`, the word `Visual`, the file name in `font-mono text-ink-mid
  truncate` inside a `PathLink` to the file (it opens in the File tab), a `flex-1` spacer, and, only when the reported
  height is over `FRAME_MAX`, an icon button (lucide `Maximize2` / `Minimize2` 12px, 24×24, `rounded-[6px]
  hover:bg-surface-hover`, `aria-label` and `title` "Show all of the visual" / "Show less", `data-chat-visual-expand`).
  Body: until the serve answers, a `bg-surface-raised` box `frameHeight(undefined)` tall with "Loading visual…" centred
  in `text-[12px] text-muted`; when `HtmlPreviewServeCommand` fails, `<div data-chat-visual-missing
  className="px-3 py-2.5 text-[12.5px] text-muted">Visual not found: <code>{path}</code></div>`; else the iframe:
  `className="block w-full border-0"`, `style={{ height }}` (`frameHeight(reported, expanded)`), `sandbox="allow-scripts
  allow-same-origin"`, `title={"Visual " + fileName}`, `src = getWebServerEndpoint() + servedPath`, mounted only once
  an IntersectionObserver (root the chat scroller, found with `closest` on the figure's scroll parent or `null`,
  `rootMargin: "600px 0px"`) has seen it, then kept; the last height per path in a module `Map` seeds `reported`.
- Messages (one `window` listener per mounted frame, removed on unmount; ignore any whose `e.source` is not
  `frameRef.current?.contentWindow`): `arc-html-height` → `reported`; `arc-html-ready` → post `{ type:
  "arc-visual-theme", vars: themeVars((v) => getComputedStyle(document.documentElement).getPropertyValue(v)) }` to the
  frame (target origin `"*"`; the frame's origin is wavesrv's); `arc-visual-prompt` → `promptAction({ fromFrame: true,
  frameFocused: document.activeElement === frameRef.current, text, draft: chatBoxText(agentId), sinceLastMs })`;
  `send` → `submitIntoChatBox(agentId, text)`; `fill` → `insertIntoChatBox(agentId, (draft.trim() ? "\n" : "") +
  text)`; `drop` → nothing. Record the time of each `send` or `fill`.

**Step 4: Route the block** (`markdownmessage.tsx`): widen `fencedOf`'s language match to `/language-([\w+-]+)/` so
`arc-visual` (and `objective-c`) survive whole; in `DIAGRAM_COMPONENT.pre`, `lang === VISUAL_LANG` → `<VisualBlock
raw={raw} />`. Update the `MarkdownExtras` comment: `diagrams` also draws an `arc-visual` block where a visual host
provides one (Chat), and as code elsewhere.

**Step 5: Provide the host** (`chatpane.tsx`): wrap the conversation (not the composer) in `<ChatVisualHost
agentId={agent.id}>`, leaving run dc14b0a6's skim toggle, refresh and `onSent` as they are.

**Step 6:** `npx vitest run frontend/app/view/agents/chatvisual.test.ts frontend/app/view/agents/chatinsert.test.ts`
→ PASS; `npx eslint` and `npx prettier --check` on the five files → clean apart from what HEAD already fails
(compare with `git show HEAD:<file> | npx prettier --stdin-filepath <file>`).

**Step 7:** Commit: `git commit -m "feat(chat): an agent's visual draws inline in Chat, and its buttons send a prompt"
-- <the five paths>`

### Task 4: The skill that teaches it

**Depends on:** none

**Files:** `skills/visual/SKILL.md`, `skills/skills.go`, `skills/skills_test.go`, `AGENTS.md`

**Step 1: Write the failing test** (`skills_test.go`, beside `TestDesignSkillVersions`): `TestVisualSkill` reads
`visual/SKILL.md` from `FS`, checks `frontmatterName` is `visual`, and that the body mentions `arc-visual`,
`~/.arc/visuals`, `arc.sendPrompt`, `mermaid` and `--arc-`.

**Step 2:** `go test ./skills -run 'Visual'` (same env as Task 1) → FAIL.

**Step 3: Write the skill.** Frontmatter `name: visual`, `description: Use in a Claude Code agent inside arcterm when
a chart, an illustration, an interactive widget, a quiz or a small UI sketch would explain better than text — write
one HTML file under ~/.arc/visuals and name it in an arc-visual block, and arcterm's Chat draws it inline.` Body,
short and in the house style of `skills/doc-review/SKILL.md`:

- **Mermaid first.** A flowchart, sequence, state, pie or xy chart is a ```` ```mermaid ```` block; Chat already draws
  it. A visual is for what mermaid cannot do: custom charts, illustrations, sliders and live numbers, quizzes, buttons.
- **Where and how.** Write `~/.arc/visuals/<YYYY-MM-DD>-<slug>.html` (make the folder) with the Write tool: one
  self-contained page, inline CSS and JS, at most ~300 lines; libraries only from cdnjs.cloudflare.com,
  cdn.jsdelivr.net or unpkg.com with an exact version; no fetches of your own (the page's policy blocks other hosts).
  Then in the reply, one line saying what it shows, and the block: ```` ```arc-visual ```` / the absolute path with
  forward slashes / ```` ``` ````.
- **Look.** Use the app's colours, which the page receives as CSS custom properties on `:root`: `--arc-background`,
  `--arc-surface`, `--arc-surface-raised`, `--arc-edge`, `--arc-ink`, `--arc-ink-mid`, `--arc-muted`, `--arc-accent`,
  `--arc-success`, `--arc-warning`, `--arc-error`, `--arc-font-sans`, `--arc-font-mono`; give each a fallback
  (`var(--arc-ink, #e6e6e6)`) and a transparent page background so it sits in the chat. Size to content; the frame
  grows to the page's height up to 640 px, then offers Show all.
- **Buttons that ask.** `arc.sendPrompt("…")` from a click handler sends that text from the chat box as if the
  person typed it (to you). Only from a click: a call that is not right after a click in the page is dropped, and one
  made while the person has a draft goes into the box instead. Keep each prompt short and specific.
- **Where it shows.** Only a Claude agent's Chat view in arcterm draws it; the terminal view, councils and other
  harnesses show the block as three lines of code, which is why the line before it says what it shows. For a full
  screen to design and review, use `arc:design` instead.

**Step 4:** add `visual` to the `//go:embed` list in `skills/skills.go`; add it to the skills list in `AGENTS.md`
("arcterm's own skills live in `skills/` (runs, cockpit, …)").

**Step 5:** the Step 2 command, then `go test ./skills` → PASS; `gofmt -l skills` → nothing.

**Step 6:** Commit: `git commit -m "feat(skills): arc:visual teaches an agent to draw an inline visual in Chat" --
skills/visual/SKILL.md skills/skills.go skills/skills_test.go AGENTS.md`

### Task 5: Scenario steps, RAM, changelog, hand checks

**Depends on:** Task 1 (the bridge the frame's height and prompts come from), Task 3 (the view the steps assert), Task 4 (the changelog line names the skill)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`, `docs/open-issues.md`

**Step 1: Scenario steps** in `agent-chat` (`scripts/cdp/scenarios.mjs`; read the scenario's header comment at
`// --- agent-chat:` and its fixture transcript writer first; never run prettier on this file). Step numbers 40-43,
leaving room for run dc14b0a6's. Arrange: in the scenario's temp dir, a `visuals/` folder with
`chart.html` (body margin 0, a `300px`-tall `div`, a `button#ask` at `position:absolute; left:16px; top:16px;
width:120px; height:36px` whose click calls `arc.sendPrompt("Explain the retry policy")`) and `auto.html` (calls
`arc.sendPrompt("unasked")` from a `setTimeout` of 300 ms, 120 px tall); set `window.__chatVisualsDir` to that folder
(forward slashes) before the page draws the chat; append one assistant entry to the main agent's fixture transcript
whose text holds an `arc-visual` block naming `chart.html`, one naming `auto.html`, one naming a missing
`gone.html` in the folder, and one naming a path outside it. Each step takes its shot:

- `agent-chat-40-visual`: `[data-chat-visual$="chart.html"] iframe` has a `src` containing `/html-preview/`, and
  within 8 s its height is 290-320 px; the header names `chart.html`.
- `agent-chat-41-visual-send`: CDP mouse press and release at the iframe's rect + (76, 34) → the mock records
  `Explain the retry policy` typed into the main agent's block and then `\r` (the chat's own send path), and the
  pending bubble shows it; a second click at once → the text lands in the chat box and nothing more is typed.
- `agent-chat-42-visual-unasked`: 1.5 s after `auto.html` loads, nothing new was typed and the box holds no
  "unasked".
- `agent-chat-43-visual-refused`: `[data-chat-visual-missing]` names `gone.html`; `[data-chat-visual-refused]`
  reads "Shown as code: a visual must sit in ~/.arc/visuals" under a code block holding the outside path.

Teardown deletes `window.__chatVisualsDir`, clears the box, and leaves the temp dir to the scenario's own removal.

**Step 2:** `node scripts/cdp/final-verify.mjs agent-chat` → every step PASS.

**Step 3: RAM.** In the dev app, open a chat with three visuals mounted and read the WebView2 processes' working set
before and after (Task Manager, or `Get-Process msedgewebview2 | Measure-Object WorkingSet64 -Sum`); add one line
with the figures to `docs/open-issues.md` under "(arcterm) RAM watch" (section 5), saying whether the lazy mount
holds it down.

**Step 4: Changelog** (`CHANGELOG.md`, top `Unreleased` section; read its header first), under `Added`: `- Claude
agents can draw a visual right in Chat: a chart, an illustration, a widget or a quiz, in the app's colours, whose
buttons ask Claude the next question for you. <!-- big -->`

**Step 5: Hand checks** (`docs/hand-checks.md`, at the top, `(arcterm)` titles): (a) in a live Claude agent's Chat,
ask "draw me a visual of …" → Claude writes a file in `~/.arc/visuals`, the visual shows inline in the app's colours
(switch the theme: it follows on the next load), its height fits, and a button in it sends its prompt; (b) the same
reply in the Terminal view reads as one line plus a three-line block; (c) a visual in a sleeping agent's Chat: a
button wakes it with that prompt.

**Step 6:** Commit: `git commit -m "test(chat): scenario steps for inline visuals; changelog and hand checks" --
scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md docs/open-issues.md`
