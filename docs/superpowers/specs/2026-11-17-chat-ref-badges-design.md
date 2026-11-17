# Chat: badges for agent, run and council references

Date: 2026-11-17. Mockup: `.superpowers/design/chat-ref-mentions/project/C-tinted.dc.html` (option C, tinted by
identity; options A and B are in `unchosen/`).

## Intent

A reference to an agent, a run or a council in Chat (`agent:7cd99627`, `run:071a8e3b`, `council:c41d9e02`) reads as
a badge with the thing's name, not as a hex id: in the message box while typing, and in your sent bubble. A click
opens what it names.

## Today

- The chat box's `@` picker lists live agents, the project's runs and its councils beside its files, and a pick writes
  `kind:<first 8 characters of the id>` into the text (`frontend/app/view/agents/refmention.ts` `refToken`,
  `REF_ID_LEN`; `refmentionstore.ts` `useRefItems` reads the roster, `projectRunsAtom(project)` and
  `councilListAtom(project)`). The arc mod tells the agent to read it with `wsh read`.
- `wsh read` takes `agent:` (alias `tab:`), `run:`, `council:`, `session:`, `effort:`, a full id or a unique prefix
  (`cmd/wsh/cmd/wshcmd-read.go` `parseReadRef`, `pickReadHits`).
- The text stays plain: the box and the bubble show `agent:7cd99627` as typed (the person's screenshot).
- `@path` file mentions already draw as pills, the model for this work: in the box a Lexical decorator node whose
  text is the mention (`chateditorpill.tsx` `FileMentionNode`, built from `chateditormodel.ts` `segmentsOf`); in the
  bubble a remark plugin (`remarkfilemention.ts`) plus `chatfilepill.tsx`, behind `MarkdownExtras.mentions`
  (`markdownmessage.tsx`).
- The router opens an agent by its full tab id only (`openref.ts` `loadAgent` matches `a.id === tabId`).

## Decisions

- **What gets a badge:** `agent:`, `tab:`, `run:` and `council:` followed by a hex id of 4+ characters (dashes
  allowed), standing as its own word, optionally after `@`. Not inside inline code or a code block. `session:` and
  `effort:` come in part 2, below.
- **Resolution:** the token's id is matched without case against the chat's sources: the roster (agents and
  background agents), the chat project's runs, its councils. Exact id first, else a unique prefix. Two or more hits,
  or none, is unresolved.
- **The text does not change.** The badge's text content is the token as written, so the agent receives
  `có gồm agent:7cd99627 không?` unchanged, and copy gives the same text.
- **Look (option C):** the file pill's frame (h-5, `rounded-[6px]`, 12.5px, `-top-[1.5px]` lift), filled and bordered
  in the kind's identity colour:
  - agent: its runtime's `rt-<runtime>-soft` fill, `rt-<runtime>-line` border, the runtime's mark (the logo the tree
    shows) at 12px; name = the agent's tab name.
  - run: `mark-run` rotated square (as History draws it), new `mark-run-soft` / `mark-run-line` tokens; name = the
    run's goal, one line.
  - council: `mark-council` dot, new `mark-council-soft` / `mark-council-line` tokens; name = the council's feature.
  - The name truncates at 240px max; the tooltip holds the full name, kind, 8-char id and state, ending "(click to
    open)" in the bubble only (in the box a click selects the badge, so its tooltip stops after the state).
- **Agent state** on a live agent's badge: working = a green dot pulsing through `pulsedriver.tsx`; asking = an amber
  ring (a hollow dot, so it differs by shape, not only colour), pulsing; idle and asleep = no dot. It follows the
  roster live.
- **Unresolved** (gone, another project's run, ambiguous): the token in `font-mono` 11.5px, `text-muted`, a dashed
  `edge-strong` border, no fill and no mark. Not a link (the router needs a full id). Its tooltip says why: "No agent
  7cd99627 is open", "No run 071a8e3b in this project", "agent:7cd9 names 2 agents".
- **In the box** a resolved or unresolved token becomes a Lexical decorator node as `@path` does: a click selects it,
  Backspace beside it selects it (accent ring, `border-accent bg-accent/12`), Backspace again deletes the whole token.
  It forms when the box's value is set from outside (a pick from `@`, a draft or prompt brought back), and, from part
  2, when a typed or pasted token is followed by a space or punctuation (a `TextNode` transform), so a half-typed id
  is not boxed; a typed or pasted `@path` (a file or a folder) becomes a file pill the same way. Deleting a badge or a file pill takes one of the two gap spaces
  around it with it, so `đọc agent:… ` reads `đọc `, not two spaces. No motion: it is a keyboard action seen often.
- **In the bubble** a resolved badge is a button that opens its target through `openTarget` with the full id
  (`openref.ts`: agent → its terminal on the Agent surface, run → Jarvis, council → its discussion); Ctrl-click
  peeks, as other router links do. Hover brightens the badge (`hover:brightness-125`, `transition-[filter]`), so one class lifts every
  kind's tint.
- **Scope:** your bubbles and the message box. An agent's prose keeps `agent:…` as text in v1 (open question).
- An agent that ended after the message was sent shows as unresolved; mapping a closed tab to its conversation is
  out of scope (the mockup's "đã đóng" and initiative / conversation cells are not built in v1).

## Pieces

- `frontend/tailwindsetup.css`: `--color-mark-run-soft`, `--color-mark-run-line`, `--color-mark-council-soft`,
  `--color-mark-council-line`, theme-agnostic like `mark-run`, with a why comment.
- `refbadge.ts` (pure, tested): `refSpans(text)` finds the tokens; `resolveRef(kind, id, sources)` gives
  `{ status: "resolved", kind, id, name, runtime?, state? } | { status: "unresolved", reason }`; `badgeLook(...)`
  gives the class names, mark and dot.
- `remarkrefmention.ts` (tested), added under `MarkdownExtras.mentions` beside the file one, making a `refmention`
  node; `chatrefbadge.tsx` draws it, reading the sources from a `RefSourcesContext` that Chat provides (project and
  its own id, as `useRefItems` takes them).
- `chateditormodel.ts` `segmentsOf` yields `ref` segments; `chateditorrefpill.tsx` is the `RefMentionNode`, drawn by
  the same badge with the selected ring; `chateditor.tsx` registers it and keeps the gap rule (`$gapAroundPills`).
- CDP scenario `chat-ref-badges`: a chat whose box holds a resolved agent badge and an unresolved one, and a sent
  bubble with an agent (asking), a run and a council badge; the steps check each badge's name, the dot and ring,
  the unresolved look, and that the box's text is unchanged.
- `CHANGELOG.md` `Added`: references to agents, runs and councils in Chat show as badges with their name.

## Part 2: `session:` and `effort:` (approved 2026-11-17)

Mockup: board `Session-effort.dc.html` of the same canvas. Built after part 1 lands, on its pieces.

- **Tokens:** `session:` and `effort:` join the kinds, same id rule.
- **Sources:** a session resolves against the conversation archive's loaded pages (`sessionsArchiveAtom`, the first
  page loaded on demand with `loadSessionsArchive`), by id prefix; an initiative against the initiative list
  (`EffortListCommand` with archived ones, as the palette loads it), by the oid in its `effort:<oid>` oref. Neither
  depends on the chat's project.
- **Look:** neither kind has an identity colour, so both keep the neutral chip (`border-edge-mid bg-surface`) and
  tell apart by icon: lucide `History` for a conversation, `Flag` for an initiative, 12px in `text-muted`. After the
  name, one muted detail in 11.5px `tabular-nums`: a conversation's age (`formatAge` of now − `lastactivets`: `2h`,
  `3d`), an initiative's `done/total` chunks, in `text-success` when all are done.
- **Name:** a conversation's `task` (first line), else its project name; an initiative's `title`.
- **Open:** a conversation reopens through the router's `session` target (`{ kind: "session", sessionId }`), an
  initiative through `{ kind: "effort", effortId }`.
- **Tooltip:** `Fix CDP fails · conversation 9f31d0b4 · claude · arcterm · 3d ago (click to open)`;
  `Chat polish · initiative e9b20f17 · 4 of 9 chunks done (click to open)`.
- **Unresolved:** as part 1 ("No conversation 77aa01fe in the loaded history", "No initiative e9b20f17").
- **Picker:** the `@` list also offers conversations (the newest 20 of the loaded archive that the command palette
  lists, `paletteSessions`' rule: resumable, not an engine run's worker, reviewer or stage; the chat's project first)
  and initiatives (not archived, the chat's project first); `@session`, `@conv`, `@hội thoại`, `@effort`,
  `@initiative` narrow to a kind; a pick writes `session:<8>` / `effort:<8>`.

## Open questions

- Badges in an agent's own replies too (agents often write `run:…`)? Out of scope unless asked.
