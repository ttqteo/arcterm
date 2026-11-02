# Council rows as chat-list rows

Date: 2026-11-02 · Brainstorm: `.superpowers/brainstorm/council-chat-rows/brainstorm.json`
Prototype: `.superpowers/design/council-chat-rows/project/A-seat-pair.dc.html` (gitignored; absolute path in a run's plan)

## Intent

Each council row in the Agent sidebar looks like a group chat in a chat list (a Messenger conversation row): the seats
as circles, the title, and a second line under it. The council discussion view stays as it is.

## What runs today

`CouncilRow` (`frontend/app/view/agents/agenttree.tsx:2690`) draws one line: a 6px tone dot, the feature, an unread dot
and a state word (`meta`). Its view model, `CouncilRowVM` (`frontend/app/view/agents/agentsidebarmodel.ts:319`), built by
`councilRowsByProject`, holds no seats and no time. The discussion (`councilchat.tsx`) already has `CouncilAvatar`: a
circle in the seat's tone with its letters and a working/failed corner dot. `avatarTone` and `seatInitials` live in
`councildiscussionmodel.ts`; `panel(c)` (the experts without the coordinator) in `councilmodel.ts`.

## The row

Two lines beside a 32px picture:

```
[pic]  Sleep after a run starts            •(unread)
       Waiting on you · 14m
```

- **Line 1:** the feature (13px, `text-secondary`, `text-primary` when selected), truncated; the unread dot (primary ink)
  stays at its end.
- **Line 2:** the state word the row shows today (`treeMeta` / `queuedLine`: Running, Answering, Waiting on you,
  `2 drafts wait for you`, Failed, Done, `Queued · after …`) in its tone token, then ` · <time>` in `text-muted`.
  The time is since the council's newest message: the latest of its ideas' and replies' `ts` and its summary's `at`;
  before any message, its `started` time, else `created` (builder question 1). Not `Council.updated`, which every save of
  the council file stamps (`writeLocked`, `pkg/council/store.go:159`), so a running council would always read "just now"
  and Close or Reopen would reset it. A failure or stop with no new message does not move the clock. Frontend only: no
  Go field. It reads in the tree's short form (`formatAgeShort`: <1m, 2m, 3h, 1d; Agent's call: the tree's other rows
  read `<1m`, not "just now").
  A queued council shows no time and keeps its word wrapping to three lines at most, as today.
- The leading 6px tone dot goes: the state word carries the state.

## The seat picture

- Two seat avatars (seat colour, its letters, as `CouncilAvatar` draws them) of 22px overlapped in a 32px square: one
  top right, one bottom left in front, the front one ringed 2px in the row's background, so the overlap reads. The
  discs are opaque (the seat tone's faint fill over the row's ground), not translucent.
- **Which seats:** always the council's first two panel seats (`panel(c)`, in order), so each council keeps one picture
  that never changes.
- **Corner dot** on the front circle: green (`bg-working`, pulsing) while any seat writes, red (`bg-error`) when a seat's
  call failed, none otherwise. The avatar's title says it in words, so colour never stands alone.
- **Odd cases:** a council with one panel seat takes the coordinator as the second circle; a council with a single seat
  draws one 26px circle centred in the square.
- On a selected or hovered row, the front circle's ring takes the row's fill (`surface-selected` / `surface-hover`).

## Size and the rest of the row

- About 44px tall, keeping today's `px-[10px] py-[6px]`, `rounded-[6px]`, `gap`, and the grey hover/selected fills.
- The hover Close / Reopen / Remove-from-queue button stays at the right edge, over the row, as today; the context menu
  is unchanged.
- Closed councils in the Closed councils fold look the same.

## Build notes

- `councilRowsByProject` adds to `CouncilRowVM`: the two seats (`{ name, initials, tone }`, from `panel`,
  `seatInitials`, `avatarTone`), the corner dot (`"working" | "failed" | null`) and `lastAt` (the newest message's time, as Line 2 says). Tests in
  `agentsidebarmodel.test.ts` cover 1, 2 and 5 seats, the coordinator fill-in, the dot, and `lastAt` with no message,
  with ideas and replies, and with a summary.
- `CouncilRow` renders a `CouncilSeatPair` built on `CouncilAvatar`; colours stay `@theme` tokens (`conn-*` identity
  tones, the ring from the row's background token). No raw hex.
- The CDP scenario `council-tree` (`scripts/cdp/councilscenarios.mjs`) gains a step and a screenshot showing the two
  circles and the two-line row.
- `CHANGELOG.md` gets a `Changed` line.
