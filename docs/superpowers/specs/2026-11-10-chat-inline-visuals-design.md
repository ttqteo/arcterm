# Chat: inline visuals an agent draws, with buttons that send a prompt

Shipped by run b539a1af (2026-11-10). The plan is deleted; git history keeps it.

Claude Desktop draws a "visual" inside the conversation: a small HTML page (a chart, a diagram, an illustration, a
widget with sliders, a quiz, a UI sketch) whose buttons send a prompt back into the chat as if the person typed it.
Claude Code has no such tool. arcterm gives its agents one: the agent writes one HTML file under `~/.arc/visuals/` and
names it in a one-line fenced block in its reply; Chat draws the page inline, as tall as it is, themed with the app's
colours, and a button in it calling `arc.sendPrompt(text)` sends that text from the chat box.

What it builds on:

- **Mermaid already renders in Chat.** Agent prose goes through `CouncilText` (`ProseText` in `chatconversation.tsx`),
  which passes `diagrams` to `MarkdownMessage`, so a ```` ```mermaid ```` block draws as its diagram. Flowcharts,
  sequences, pie and xy charts need no visual; the skill sends the agent to mermaid first.
- **Serving an HTML file to an iframe.** `pkg/htmlserve` registers a file's folder under an unguessable token
  (`HtmlPreviewServeCommand`), serves it at wavesrv's web origin with its own CSP (fetches reach only the folder and
  the CDNs, forms post nowhere) and appends its scripts to every HTML page. The packaged app's CSP allows frames only
  from `http://127.0.0.1:*`, which this origin is; a `srcdoc` frame would inherit the app's policy and run no inline
  script, so it is not an option.
- **One send path.** `ChatComposer.submit` (wake, holds, pending bubble, scroll to the end); `chatinsert.ts` is the
  registry other code reaches the chat box through.

## Decisions

- **A file plus a one-line block, not inline HTML in the reply.** The agent writes the page to
  `~/.arc/visuals/<YYYY-MM-DD>-<slug>.html` and puts ```` ```arc-visual ```` / the absolute path / ```` ``` ```` in its
  reply. The terminal view shows three lines, not 200 lines of HTML; the page is served by `htmlserve` with its CSP;
  and the File tab can open the same file. `~/.arc/visuals/` sits outside every repo, so there is no gitignore question.
- **Chat draws only a file inside `~/.arc/visuals/`.** A reply is text an agent wrote, maybe under a prompt injection;
  drawing any `.html` path it names would serve that file's whole folder. Any other path, a relative one, or one with a
  `..` segment shows as the code block it is, with a line saying why. In DEV a `window.__chatVisualsDir` override
  points the check at a scenario's temp dir.
- **The bridge is a script `htmlserve` appends** (`bridgeScript`, after `scrollScript`): it reports the page's height
  (`arc-html-height`, the root's laid-out height, not `scrollHeight`, which never drops below the frame and so would
  never let a frame shrink), defines `window.arc.sendPrompt(text)` (posts `arc-visual-prompt`), takes the app's colours
  (`arc-visual-theme` sets `--arc-*` custom properties on the page's root) and says `arc-html-ready` once. Every HTML
  page `htmlserve` serves gets it; only Chat's visual frame listens for `arc-visual-prompt`, and only from its own
  frame, so a page in the File tab that calls it does nothing.
- **A prompt is taken only once the person has clicked in the visual.** The chat takes `arc-visual-prompt` from its
  own frame's window only, with non-empty text of at most 4,000 characters, and only while that iframe is the
  document's active element; otherwise it is dropped. This is a focus check, not a per-click one: after a click the
  iframe stays the active element, so a page's timer can still send until focus leaves it; the 1.5 s gap bounds that
  to one send, and a burst goes into the box. While the box holds a draft, or within 1.5 s of the last prompt that
  frame sent, the text is appended at the end of the box (after the draft, on a new line; never at the caret) instead
  of being sent. A sent prompt goes through `ChatComposer.submit`, so it wakes a sleeping agent, waits behind a
  permission card and shows the pending bubble like a typed one.
- **The frame mounts when it nears the view and then stays.** An iframe is a document: a long conversation of visuals
  mounts only those within 600 px of the scroller's view (IntersectionObserver), and the last height each path
  reported is kept in a module map, so a remount keeps its place. The frame grows to the page's height up to 640 px,
  then offers Show all. Its RAM is not yet measured (`docs/open-issues.md` "RAM watch").
- **The agent learns it from a skill**, `skills/visual/SKILL.md` (Claude sees it as `arc:visual`), not a system
  prompt section: it costs nothing until a visual helps, as `arc:design` does.
- **Only a Claude agent's Chat draws it.** Councils draw agent text through the same `MarkdownMessage` but provide no
  visual host, so a block there stays code; pi has no Chat.

## Where it lives

`pkg/htmlserve/htmlserve.go` (`bridgeScript`), `frontend/app/view/agents/chatvisual.ts` (the pure model: which paths
draw, when a prompt sends, the frame's height, the theme vars), `chatvisualview.tsx` (the host, the block, the frame),
`chatinsert.ts` (`registerChatBox`), `markdownmessage.tsx` (routes an `arc-visual` block), `skills/visual/SKILL.md`, and
`agent-chat` steps 40-44 in `scripts/cdp/scenarios.mjs`.
