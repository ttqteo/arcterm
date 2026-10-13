# Arc's desktop popup for a waiting item

The approved design canvas is the visual and wording spec:
`.superpowers/design/attention-notification/project/Main.dc.html` in the main checkout (gitignored, never
committed). This file records the decisions made beyond it.

## Goal

When a new "needs you" item arrives while Arc is not focused, the avatar's bubble appears in a small window of
its own at the bottom right of the desktop, above the taskbar. It takes no focus. One click on it brings Arc's
main window forward and opens that item. It leaves by itself.

The canvas's agent names, run names and question are sample data; the Windows taskbar and the other app's
window in it are context, not something to build.

## Decisions (approved by the user)

- **Arc's own window, no new dependency.** No Windows toast, no `tauri-plugin-notification`, no new npm or cargo
  package.
- **One window, created once.** A second Tauri window labelled `attention-popup`, declared in
  `src-tauri/tauri.conf.json`, hidden at start, shown and hidden for each popup, never rebuilt. It loads its own
  page, `frontend/tauri/popup.html`. That page opens no wavesrv connection: it draws what the main window sends.
- **One decision, two effects.** The taskbar flash (commit 37cef7ab) and the popup fire on the same condition:
  an item that was not in the previous list, while the main window is unfocused. Both read one predicate in
  `frontend/app/view/agents/attentionstore.ts`, and `AttentionPoller` (always mounted) acts on both. The flash
  must keep working exactly as it does.
- **The bubble's look has one source.** The card markup is extracted from
  `frontend/app/view/jarvis/petbubble.tsx` and drawn by both the in-app bubble and the popup page. 268px wide,
  label line, name line, text clamped to three lines, Arc's `@theme` tokens only (no raw hex). `BUBBLE_MS` is
  defined once, beside the card, and is the popup's lifetime too.
- **Three lines.** Label: `Asking you` for an item of kind `ask`, else the item's `action` word (Review, Decide,
  Acknowledge, Triage) as the server sent it. Every kind gets the accent dot, as the canvas draws. Name: the
  item's `source`, alone (the canvas's `waveterm` project suffix is not drawn: an attention item carries no
  project). Text: the item's `text`.
- **Several new items in one poll:** one bubble, for the new item the server ranks first (the list is already
  in rank order), with `+N more waiting` under the text, where N is the number of the *other items new in that
  same poll*, not everything already waiting. N = 0 draws no such line.
- **No reply input, no buttons, no close button.** The whole bubble is one click target.
- **It leaves** after `BUBBLE_MS`, and earlier when the main window gains focus (which a click also causes). A
  newer popup replaces the one showing and restarts the timer.
- **Placement:** the primary screen only, 16px in from the right edge of its work area and 16px above the
  work area's bottom (the work area already excludes the taskbar). That is the visible card's edge. The window
  carries 24px of transparent room around the card for its shadow, which takes clicks while the popup shows
  (decided 2026-10-08: card at 16px, keep the shadow). As first shipped the 16px is applied to the window's
  edge, so the card sits 40px in; `docs/superpowers/plans/2026-10-08-attention-popup-followup.md` fixes it.
- **The popup's text is plain.** Markdown markers in an item's text show literally: the in-app bubble's
  `InlineMarkdown` imports the cockpit's store, which the popup page must not load.
- **The app exits when the main window is destroyed,** so the hidden popup window never keeps Arc and wavesrv
  alive.
- **It never takes focus** from the app the user is in.
- **Where a click lands,** in this order, always through the one router (`frontend/app/view/jarvis/openref.ts`):
  1. an `ask` whose agent is on the roster: that agent (`{ kind: "agent" }`), as the palette's needs list does;
  2. an item with an `oref` (radar triage): `parseAddress(item.oref)`, which is the Radar report;
  3. an item with a `runid`: `{ kind: "run", runId }`, the avatar's Open;
  4. an item with only a `channelid`: `{ kind: "channel", channelId }`;
  5. otherwise nothing to open: the click brings Arc forward and nothing more. In practice this is only an ask
     with no channel whose agent has left the roster.
- **Personal-use app:** no settings toggle, no off switch, no multi-monitor rules, no empty or error states
  beyond what is written here.

