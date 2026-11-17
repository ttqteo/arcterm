# Chat focus read: one block at a time

Date: 2026-11-17 · Status: approved design, not built

## Why

When you read a long reply in Chat, every block of it shows at once, so your eye keeps jumping between paragraphs. You read one block while seeing the next. Focus read brings forward the block you are reading and dims everything else. Skim highlights and fold (`chatskim.ts`, `chatskimstore.ts`) help you skim a reply. Focus read is for reading it closely.

**Prototype:** `D:\projects\arcterm\.superpowers\design\chat-focus-read\project\A-vach-doc-phim-buoc.dc.html`.
**Live spike:** `D:\projects\arcterm\.superpowers\design\chat-focus-read\spike\focus.html`. Use mode A with "Cuộn chuột: Hít vào khối khi dừng". The spike is a reference for how it should feel, not code to copy.

## Decisions

### Reading line and stepping

- **Reading line.** A fixed reading line sits about one third of the way down Chat's scroller.
  - The block that crosses the line is lit. Every other block is dimmed.
  - When the line falls in a gap between blocks, the next block below it is lit.
  - A short accent tick in the left gutter marks where the line is.
- **Stepping with the keyboard.** With focus in Chat's conversation, these keys scroll the next or previous block onto the line:
  - `J` / `K`
  - `Space` / `Shift+Space`
  - A block taller than the room under the line is shown from its top.
  - Stepping scrolls smoothly. Under reduced motion it scrolls instantly.
- **Wheel and trackpad.** Scrolling stays free. Once a scroll stops, the block nearest the line settles onto it with a short smooth scroll. That scroll counts as programmatic, so it does not trigger another settle. There is no settle when the scroller is at its end.
- **Turning it on.** A new toggle sits beside the Skim toggle in Chat's top-right corner (`SkimToggle`, `chatpane.tsx:486`). One global binding also toggles it.
  - The state is global across agents and remembered in localStorage, the way `chat.skim` is.
  - The same key or the button turns it off.
  - Don't use `Esc`: in Chat it stops the agent's turn (`agent:chat-interrupt`).
  - Don't use `[` or `]`: Telex rewrites them (DESIGN.md).
- **Quoting the lit block.** `Q` puts the lit block into the agent's chat box as a markdown quote, with the box's caret on a fresh line under it. Reuse `withQuote` (`chatquote.ts:38`) and the chat box registry in `chatinsert.ts`.
- **Focus after `Q`** (Agent's call, builder question 2). Focus stays in the conversation, so you can go on stepping with `J`/`K` and quote another block. `Tab` (`agent:chat-focus-box`) takes you into the box to type your question.
  - `ChatBox` needs a method that writes the text and places the caret without taking focus. `replaceChatBox` takes focus, so it cannot be used here.
- **What `Q` quotes** (Agent's call, builder question 4). It depends on the kind of block:
  - A paragraph, list item, heading or your bubble: its text as rendered, the way Reply on a selection takes it.
  - A code block: a fenced block inside the quote, its language read from the `code` element's `language-*` class.
  - A table: rebuilt as a markdown table from its cells.
  - A step list or a card: `Q` does nothing.

### What is lit and what is dimmed

- **What counts as a block.** Every block of the conversation is one unit:
  - a paragraph
  - a leaf list item
  - a heading
  - a code block
  - a table
  - your own bubble
- **Non-prose items** (Agent's call, builder question 3). Tool calls draw as step lists (`chatsteplist.ts`, `chatstepsview.tsx`):
  - A step list is one block, open or closed.
  - Each card is one block: `CommandCard`, `BtwCard`, `SentCard`, the run, council and verdict cards, and an asleep `!` row.
  - A skim-folded reply's Show more button belongs to that reply's last block. It is not a block of its own.
- **Never dimmed** (Agent's call, builder question 3). An item that waits on you is never dimmed and never picked, so a question cannot fade to 32% and be missed:
  - an ask
  - a brainstorm, commit or handoff card
  - the pending bubbles and local cards in `data-chat-tail`
- **Dimming.** Blocks off the line drop to about 32% opacity.
  - Opacity changes on the Fluid ease at `durMicro` (140 ms).
  - Under reduced motion, opacity changes with no transition.
  - Skim highlights stay as they are inside a block.
- **A reply still being written** (`LiveProseText`, `chatconversation.tsx:240`) is never dimmed and never picked. The line, `J`/`K`, `Q` and the settle consider only finished blocks. Focus read does not change how Chat follows the tail while you sit at the bottom (`useStickToBottom`).
- **At the end of the conversation** (builder question 1). The conversation gets no extra room, so `useStickToBottom`, `atBottom`, jump-to-latest and `useDockPadding` (`chatpane.tsx:449`) stay as they are.
  - When the scroller is at its end, `J`/`K` keep stepping through the last blocks. The lit block sits below the line, since it cannot scroll up to it.
  - At the end, the settle does nothing, so it never pulls the scroller off the bottom or stops Chat following the tail.
  - While you follow a live reply, Chat looks as it does today.

## Left to the builder

- Which binding toggles focus read. Define it in `frontend/app/store/keybindings/bindings.ts` beside `agent:chat-jump-latest` (`bindings.ts:1981`), and mirror it in `docs/keyboard-shortcuts.md`.
- Where `J`/`K`/`Space`/`Q` act. They act only while focus read is on and focus is in Chat's conversation. They must not act in the chat box, in the Agent tree (where `J`/`K` step agents, `bindings.ts:1220`) or in the terminal.
- Exact values to tune: the line's position, the dim level, when a scroll counts as stopped (`scrollend`, or a short idle where it is missing) and the settle's duration.
- The pure model goes in a `.ts` file with a `.test.ts` beside it, following the frontend convention:
  - picking the block on the line from block rects
  - the step target
  - the settle target, with none at the end
- A CDP scenario in `scripts/cdp/scenarios.mjs`. It turns focus read on over a long reply, presses `J` and shoots the lit block. It then presses `Q` and asserts the box holds the quote. The existing `chat-quote` and `chat-scroll-keep` scenarios show how to arrange a Chat with a long reply.
- A `CHANGELOG.md` line under `Added`, ending with `<!-- try: <the binding id> -->`.
