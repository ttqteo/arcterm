# Agent chat: document view, composer chips, transitions

**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep`
**Prototype:** D:/work/arcterm/.superpowers/design/agent-chat-doc/project/

The prototype is the spec: read all three boards before starting (`Main.dc.html` live, `Sleeping.dc.html` asleep,
`Transitions.dc.html` the Chat ⇄ Terminal and live ⇄ asleep changes, playable with its header's buttons). The boards
use raw hex; the code uses the `@theme` tokens they were copied from (`frontend/tailwindsetup.css`), never raw colors
(`DESIGN.md`). Motion comes only from `frontend/app/element/motiontokens.ts`.

What changes, in one line each:

1. The agent's prose is no longer a bubble and has no avatar: it reads as a document column. Only your messages are
   bubbles.
2. Chat gets the pinned prompt the live feed already has (`PinnedPromptBar`): once your message scrolls off the top,
   it pins there, and a click scrolls back to it.
3. The composer's footer becomes chips: a model chip that opens a menu (picking sends `/model <alias>`), a
   permission-mode chip that opens a menu of the modes (picking presses Shift+Tab until Claude Code shows that mode),
   and the context as a small ring with its percent. Attach is a `+`. Asleep: the model as a plain label and the
   context ring dimmed, no mode chip.
4. One chat for awake and asleep: a sleeping Claude agent shows the same `ChatPane` as an awake one (no separate
   sleeping overlay), so the box stays one instance and its parts fold in place when the agent sleeps or wakes.
5. Transitions: the chat layer fades over the terminal and back; the composer's parts fold between live and asleep;
   the Chat | Terminal control's selected fill slides between its options.

Decisions made beyond the boards (the lead's calls, each with why):

- **No time on your bubble's hover.** `AgentEntry` of kind `user` carries no timestamp
  (`frontend/app/view/agents/agentsviewmodel.ts:48`), so the copy button stays where `BubbleCopy` puts it today.
- **No effort in the model chip or menu.** arcterm reads no effort level for an agent; the chip shows `agent.model`
  as the footer does today.
- **Model menu choices are the three aliases `opus`, `sonnet`, `haiku`.** Claude Code's `/model <alias>` switches
  without opening its own menu, so the send stays in Chat (`opensTui` in `slashcommands.ts` only flips to the
  terminal for a bare `/model`). The current one is the choice whose alias appears in `agent.model`, lowercased.
- **Picking a mode presses Shift+Tab and re-reads**, up to 6 presses, 250 ms apart, stopping when `tuiMode` reads
  the target, or when a mode already seen comes back (the target is not in this session's cycle: Bypass appears only
  when enabled). The order of the cycle is not assumed.
- **Asleep, the model is a label, not a menu.** Wake takes no model today; changing it is done once awake.
- **Sleeping and Chat are one pane** (the person's call). Today `agentsurface.tsx:833-837` swaps a
  `SleepingTranscript` overlay (which, for a Claude agent, already draws `ChatConversation` + `ChatComposer`) for
  `ChatLayer`. After this plan a Claude agent always gets `ChatLayer`, shown while it sleeps whatever its stored chat
  mode; `ChatPane` reads `agent.sleeping` for the few differences (no live stream, the wake placeholder, the
  `data-sleeping-*` attributes the scenarios read). `SleepingTranscript` keeps only the other harnesses' compact
  transcript. Because the `ChatComposer` (keyed by agent id) is never remounted, Task 2's folds play when the agent
  sleeps or wakes.
- **The sliding fill is opt-in on `Segmented`** (`slide` prop), turned on for the agent header's view control and
  built into `ChatSwitch`, so no other segmented control in the app changes.
- **`CHANGELOG.md` and `docs/hand-checks.md` are written once, in Task 4**, so the parallel tasks never conflict in
  them.

### Task 1: Agent prose as a document, and the pinned prompt in Chat

**Depends on:** none

**Files:** `frontend/app/view/agents/chatconversation.tsx`

Today (`chatconversation.tsx:459-470`) a prose part is a `bg-surface-raised` bubble, and an agent item
(`:503-517`) puts a `CouncilAvatar` beside its parts.

**Step 1: Prose without a bubble.** In `drawPart`'s `"prose"` case, keep `data-chat-prose`, `onContextMenu`,
`group relative` and `BubbleCopy`, and drop the bubble: no `bg-surface-raised`, no `rounded-lg`, no padding,
`self-stretch` instead of `self-start`. The text: `<CouncilText text={part.text} className="text-[14px]
leading-[1.65] text-ink-hi" />` (marks stay on: the skim highlight must still draw). Keep `mb-3` so the copy button
sits in the gap under it. Update the comment above the case.

**Step 2: No avatar.** In `drawItem`'s `"agent"` case, drop `CouncilAvatar` and the `gap-[10px]` row: the item is
`<div data-chat-agent className="flex min-w-0 flex-col gap-2">{parts}</div>`. Remove the `CouncilAvatar` import if
nothing else in the file uses it (keep `CouncilText`). Update the file's header comment (lines 4-9): the prose is
Markdown in a document column, not a bubble behind an avatar.

**Step 3: Your bubble.** `YouBubble` (`:85-96`): `max-w-[75%]`, `rounded-[12px]`, `text-[13.5px]`. Same for the
command bubble (`:77`) and `SentCard` (`:108`, `max-w-[75%]`, `rounded-[12px]`).

**Step 4: Pinned prompt.** `ChatConversation` already has `rootRef` on its root (`:525`) and every prompt bubble
carries `data-user-prompt` (`:88`). Follow `narrationtimeline.tsx:785-812`:

```tsx
import { PinnedPromptBar, usePinnedPrompt } from "./pinnedpromptbar";
// …inside ChatConversation, after `visible` is known:
const pinned = usePinnedPrompt(rootRef);
// the text of each data-user-prompt bubble, in document order: what the bar shows for the pinned index
const prompts = visible.flatMap((item) =>
    item.kind === "you" && !("command" in item) ? [splitAttachedImages(item.text).text || "(picture)"] : []
);
// …first child of the root div:
<PinnedPromptBar rootRef={rootRef} index={pinned} text={prompts[pinned]} bg="bg-background" />
```

Only `YouBubble`'s prompt branch carries `data-user-prompt`; keep `prompts` in step with exactly those elements (the
command bubble has none). The bar is sticky at the scroller's padding edge, so the root's `pt-4` must not push it:
the chat scroller (`chatpane.tsx:119`) has no top padding already; keep it so. Check the bar sits above the first
item and does not shift the transcript when it appears (it is a zero-height sticky row).

**Step 5:** `npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/pinnedprompt.test.ts`
→ PASS. `npx eslint frontend/app/view/agents/chatconversation.tsx` and `npx prettier --check` on it → clean.

**Step 6:** Commit: `git commit -m "feat(chat): agent prose reads as a document, and chat pins your prompt" --
frontend/app/view/agents/chatconversation.tsx`

### Task 2: The composer's chips: model, mode, context ring, attach

**Depends on:** none

**Files:** `frontend/app/view/agents/chatfootermodel.ts`, `frontend/app/view/agents/chatfootermodel.test.ts`, `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/attachmenttray.tsx`, `frontend/app/element/motiontokens.ts`, `frontend/app/element/motiontokens.test.ts`

(`attachmenttray.tsx` for the `AttachButton` icon; `chatcomposer.tsx:307` is its only user. `motiontokens.ts` only if
Step 6b needs a variant.)

**Step 1: Write the failing tests** in `chatfootermodel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currentModelAlias, MODE_CHOICES, MODEL_CHOICES, modeStep, modelCommand, ringDash } from "./chatfootermodel";

describe("model choices", () => {
    it("finds the current alias in the model name", () => {
        expect(currentModelAlias("Opus 5.5")).toBe("opus");
        expect(currentModelAlias("claude-sonnet-5-5")).toBe("sonnet");
        expect(currentModelAlias("Haiku 5.5")).toBe("haiku");
        expect(currentModelAlias(undefined)).toBeNull();
        expect(currentModelAlias("gpt-6")).toBeNull();
    });
    it("lists the three aliases in order", () => {
        expect(MODEL_CHOICES.map((c) => c.alias)).toEqual(["opus", "sonnet", "haiku"]);
    });
    it("types /model with the alias", () => {
        expect(modelCommand("sonnet")).toBe("/model sonnet");
    });
});

describe("modeStep", () => {
    it("stops when the screen shows the target", () => {
        expect(modeStep(["default", "acceptEdits"], "acceptEdits")).toBe("done");
    });
    it("presses again while the target is not reached", () => {
        expect(modeStep(["default"], "plan")).toBe("press");
        expect(modeStep(["default", "acceptEdits"], "plan")).toBe("press");
    });
    it("gives up when a mode comes back before the target", () => {
        expect(modeStep(["default", "acceptEdits", "plan", "default"], "bypassPermissions")).toBe("give-up");
    });
    it("gives up after six presses", () => {
        const seen = ["default", "acceptEdits", "plan", "auto", "acceptEdits", "plan", "auto"] as const;
        expect(modeStep([...seen], "bypassPermissions")).toBe("give-up");
    });
    it("lists the four modes the menu offers, each with a line", () => {
        expect(MODE_CHOICES.map((m) => m.mode)).toEqual(["default", "acceptEdits", "plan", "auto"]);
        expect(MODE_CHOICES.every((m) => m.note !== "")).toBe(true);
    });
});

describe("ringDash", () => {
    it("is the share of the circle the percent fills", () => {
        expect(ringDash(0, 88)).toBe(0);
        expect(ringDash(50, 88)).toBe(44);
        expect(ringDash(120, 88)).toBe(88);
        expect(ringDash(undefined, 88)).toBeNull();
    });
});
```

**Step 2:** `npx vitest run frontend/app/view/agents/chatfootermodel.test.ts` → FAIL (exports missing).

**Step 3: Implement** in `chatfootermodel.ts`, keeping `modeLabel`, `contextLabel`, `contextWarn` and `footerParts`
(other code may import them; grep before removing any):

```ts
export const MODEL_CHOICES: { alias: string; label: string }[] = [
    { alias: "opus", label: "Opus" },
    { alias: "sonnet", label: "Sonnet" },
    { alias: "haiku", label: "Haiku" },
];

/** The alias of the model the agent runs, read off its model name, or null when none matches. */
export function currentModelAlias(model: string | undefined): string | null {
    const m = (model ?? "").toLowerCase();
    return MODEL_CHOICES.find((c) => m.includes(c.alias))?.alias ?? null;
}

export function modelCommand(alias: string): string {
    return `/model ${alias}`;
}

export const MODE_CHOICES: { mode: ClaudeMode; note: string }[] = [
    { mode: "default", note: "Asks before edits and commands" },
    { mode: "acceptEdits", note: "Edits files without asking" },
    { mode: "plan", note: "Reads and plans, changes nothing" },
    { mode: "auto", note: "Decides what needs asking" },
];

const MODE_PRESSES_MAX = 6;

/** What to do after a Shift+Tab: `seen` is each mode read, the first before any press. */
export function modeStep(seen: ClaudeMode[], target: ClaudeMode): "done" | "press" | "give-up" {
    const last = seen[seen.length - 1];
    if (last === target) {
        return "done";
    }
    if (seen.length - 1 >= MODE_PRESSES_MAX || seen.indexOf(last) < seen.length - 1) {
        return "give-up";
    }
    return "press";
}

/** The stroke length of a context ring of circumference `circ` at `pct`, or null with no percent. */
export function ringDash(pct: number | undefined, circ: number): number | null {
    if (pct == null || !Number.isFinite(pct)) {
        return null;
    }
    return Math.round((Math.min(Math.max(pct, 0), 100) / 100) * circ);
}
```

Check the `modeStep` tests against this before going on (the "six presses" case: seven reads, a repeat at index 4
gives up first, which is also right).

**Step 4:** `npx vitest run frontend/app/view/agents/chatfootermodel.test.ts` → PASS.

**Step 5: The chips** in `chatfooter.tsx`. Keep `useTuiMode` and the file's polling. Render, left to right, after the
attach button the composer already places (`chatcomposer.tsx:306-308` puts `<ChatFooter>` right after it):

- **Model chip** (live): a `<button data-chat-model aria-haspopup="menu" aria-expanded>` drawn as the board's chip
  (`h-[28px] rounded-[8px] border border-edge-mid px-[9px] text-[12px] text-primary`, open:
  `border-edge-strong bg-surface-hover`, a `ChevronUp` 11px), its label `agent.model`. Its menu opens upward
  (`absolute bottom-[calc(100%+8px)] left-0`) inside `PopoverReveal` (`element/popoverreveal.tsx`, `origin="bottom
  left"`): a "Model" caption, one `role="menuitemradio"` row per `MODEL_CHOICES` with a check on
  `currentModelAlias(agent.model)`, and the line "Sends /model to Claude Code" in `text-ink-faint`. Picking types
  `modelCommand(alias) + "\r"` into the block (`RpcApi.ControllerInputCommand`, as `cycle` does today) and closes.
  Escape and a click outside close it; ↑/↓ move between rows.
- **Mode chip** (live, once a mode is read): `data-chat-mode={mode}`, a `Lock` icon 12px, `modeLabel(mode)`, a
  `ChevronUp`. Its menu: a "Permission mode" caption, a row per `MODE_CHOICES` (label from `modeLabel`, its note
  under it in `text-muted`, a check on the current mode), and "Shift+Tab in the box cycles them too" in
  `text-ink-faint`. Picking runs the loop: read, then while `modeStep(seen, target) === "press"` send Shift+Tab, wait
  250 ms, read again (`readTermLines` + `tuiMode`, push the result; a read that finds no footer pushes nothing and
  counts as a press). On `"give-up"` push a toast (`pushToast` from `@/app/cockpit/notificationstore`, as
  `chatcomposer.tsx` uses it): "Claude Code did not offer <label> in this session". Keep the old click-to-cycle
  nowhere: the chip now opens the menu. Keep `data-chat-mode` on the chip (the `agent-chat` scenario reads it).
- **Spacer**, then the **context ring** at the right (`data-chat-context`): a 14px SVG ring (track `stroke-edge-
  strong`, value `stroke-secondary`, or `stroke-warning` when `contextWarn`), `ringDash(pct, 88)` as the dash, then
  `Math.round(pct)%` in `text-[11.5px] text-muted tabular-nums`, `title="Context N%"`. Drawn only when a percent
  exists. The footer must therefore render as a `flex-1` row that the composer's own spacer no longer needs: read
  `chatcomposer.tsx:306-338` and move the composer's `<div className="flex-1" />` so Stop and Send stay at the far
  right after the ring (this is the one edit in `chatcomposer.tsx`; keep it to that line).
- **Asleep** (today `ChatFooter` returns null): render the model as a plain label (`data-chat-model-label`,
  `h-[28px] rounded-[8px] border border-border px-[9px] text-[12px] text-muted`, no menu, `title="The model it ran
  on"`) and the context ring with its value stroke `stroke-muted` when a percent exists. No mode chip.

Colors only through token utilities. Every icon-only control gets an `aria-label`; the chips get a `title`.

**Step 6: Attach is a `+`.** In `attachmenttray.tsx`, `AttachButton` draws `Plus` (size 16, `strokeWidth={1.8}`)
instead of `Paperclip`; keep its title and aria-label. Remove `Paperclip` from the import if unused.

**Step 6b: The parts fold between live and asleep** (`Transitions.dc.html`, played with its Sleep / Wake button).
After Task 3 the same `ChatComposer` instance lives through a sleep and a wake, so when `agent.sleeping` flips:
the attach button, the mode chip and the "Asleep" word (a `Moon` 13px + "Asleep" in `text-[12px] text-muted`, shown
asleep only, `data-chat-asleep`) enter and leave inside `AnimatePresence initial={false}` with a fold: opacity, scale
0.96 → 1 and width (`composerReveal`'s signature on the horizontal axis; add a `foldX` variant beside it in
`motiontokens.ts` if none fits, durMicro, and test it as the file tests the others). The model chip turns into the
label in place (crossfade). The Send button's width animates between the 30px arrow and its word ("Send",
"Waking…"), the arrow and the word crossfading (CSS `transition` with `easeFluidCss` from `motiontokens.ts` is fine
for the width). Today `chatcomposer.tsx:307` drops the attach button with `asleep ? null :`; it becomes the
presence-wrapped fold. Reduced motion snaps all of it.

**Step 7:** `npx vitest run frontend/app/view/agents/chatfootermodel.test.ts` → PASS; eslint and prettier on the
four files → clean.

**Step 8:** Commit: `git commit -m "feat(chat): the composer's model and mode are chips with menus, the context a
ring" -- frontend/app/view/agents/chatfootermodel.ts frontend/app/view/agents/chatfootermodel.test.ts
frontend/app/view/agents/chatfooter.tsx frontend/app/view/agents/chatcomposer.tsx
frontend/app/view/agents/attachmenttray.tsx` (plus `motiontokens.ts` and its test if Step 6b added a variant)

### Task 3: One chat for awake and asleep, and the transitions around it

**Depends on:** Task 2

(Task 2 first: both edit `motiontokens.ts` possibly, and Task 2's folds only play once this task keeps the box
mounted; serial keeps the merge clean.)

**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/sleepingtranscript.tsx`, `frontend/app/element/segmented.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/chatswitch.tsx`, `frontend/app/element/motiontokens.ts`, `frontend/app/element/motiontokens.test.ts`

(`chatpane.tsx`: `ChatLayer`, `ChatPane`, the placeholder at `:180`; `agentsurface.tsx:829-837`;
`sleepingtranscript.tsx` drops its chat branch; `agentheader.tsx:746`; `motiontokens.ts` only if `viewFade` has no
exit.)

Read `motiontokens.ts` first: `viewFade` (enter at `durMacro`), `microFade`, `indicatorSlide`. If `viewFade` has no
`exit`, add `exit: { opacity: 0, transition: { duration: MOTION.durExit, ease: MOTION.easeFluid } }` and extend
`motiontokens.test.ts` the way its other variants are tested.

**Step 0: One pane.** Read `sleepingtranscript.tsx` whole: for a Claude agent (`chatCapable`) it already draws
`ChatConversation` and `ChatComposer` (wake placeholder `` `message ${agent.name} to wake it… (Enter)` ``,
`dataAttrs={{ "data-sleeping-composer": agent.id }}`), reads the transcript once (`useTranscriptRead`) and keeps its
place under `sleeping:<id>:<since>`.
- `agentsurface.tsx:833-837` becomes: a cell whose agent sleeps and is not `chatCapable` gets `SleepingTranscript`;
  every other cell gets `ChatLayer` (keep `ChatLayer` in one JSX position so waking or sleeping never remounts it).
  Update the comment above it. Nothing else in the file moves: the cell wrappers, the terminal stack and
  `CockpitFocusPane` must not re-parent (AGENTS.md, "The Agent surface's terminal stack").
- `ChatLayer` shows the pane when `useChatMode(agent) === "chat"` **or** the agent sleeps and is `chatCapable` (a
  sleeping cell always draws the conversation; its terminal holds only the kill).
- `ChatPane`, when `agent.sleeping != null`: no live stream (add `asleep` to the stream effect's guard and deps, and
  read once on entering sleep with `requestAppend()` so the last turn is there); root also carries
  `data-sleeping-transcript={agent.id}`; the composer gets the wake placeholder and the `data-sleeping-composer`
  attribute (the `agent-sleep` and `agent-chat` scenarios select on both). The place key stays
  `chat:<id>:<path>` for both states. Keep the composer `key={agent.id}` so it never remounts.
- `sleepingtranscript.tsx`: keep only the compact branch (`CompactTranscript` + `AgentComposer`); drop the
  `ChatConversation`/`ChatComposer` imports and the `chat` flag; rewrite its header comment (a Claude agent's
  sleeping conversation is `ChatPane`'s now). Grep for other imports of anything removed.
- While the agent sleeps, the Chat | Terminal controls (`ChatSwitch`, and the header's `Segmented` at
  `agentheader.tsx:746` if it is shown for a sleeping agent) are disabled and dimmed (`opacity-40`, not clickable,
  `title` "Wake the agent to show its terminal"), as `Transitions.dc.html` dims them.

**Step 1: Chat fades over the terminal.** `ChatLayer` (`chatpane.tsx:53-55`) returns the pane or null. Make it:

```tsx
<AnimatePresence initial={false}>
    {useChatMode(agent) === "chat" ? (
        <motion.div key="chat" variants={viewFade} initial="initial" animate="animate" exit="exit">
            <ChatPane model={model} agent={agent} barred={barred} />
        </motion.div>
    ) : null}
</AnimatePresence>
```

(hooks before the JSX, not inside it). The wrapper takes no position or size: `ChatPane` is `absolute` against the
cell, and the wrapper's opacity still applies to it. Leaving Chat keeps the pane mounted for the exit's 280 ms; check
the terminal under it takes keys at once (the chat layer must not hold focus or pointer events while it fades out:
give the exiting wrapper `pointer-events: none`, e.g. a `style` from the exit variant or a class while `!isPresent`).

**Step 2: Sleep and wake keep the pane.** With Step 0 a Claude agent's chat stays mounted through a sleep and a wake
(no fade: nothing leaves), and only the composer's parts fold (Task 2). The compact `SleepingTranscript` of other
harnesses stays as it is.

**Step 3: The sliding fill.** `Segmented` gets an optional `slide?: boolean`. With it, the selected option's fill is
a `motion.span` with `layoutId` from `useId()` (unique per control) and `transition={indicatorSlide}`, absolutely
behind the label (`absolute inset-0 rounded-[inherit]` in the selected fill's token, the label `relative`); without
it, the control draws exactly as today. Pass `slide` from `agentheader.tsx:746`. In `ChatSwitch`, draw the same:
the `bg-accentbg` moves to a `motion.span layoutId` inside the pressed button. `MotionConfig reducedMotion="user"`
must cover both (check the app root has it; `PopoverReveal` wraps its own).

**Step 4: Placeholder.** `chatpane.tsx:180`: `` `Reply to ${agent.name}, @ to mention, / for commands` ``.

**Step 5:** `npx vitest run frontend/app/element/motiontokens.test.ts` → PASS; eslint and prettier on the changed
files → clean.

**Step 6:** Commit with every changed path: `git commit -m "feat(chat): one chat pane awake and asleep, chat fades
over the terminal, the view control's fill slides" -- <paths>`

### Task 4: Scenario steps, changelog, hand checks

**Depends on:** Task 1, Task 2, Task 3

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

(`scenarios.mjs`: the `agent-chat` scenario, from line ~42443.)

**Step 1: Fix what the new look breaks.** Run the scenario against the merged tree the way Final does
(`node scripts/cdp/final-verify.mjs agent-chat`) and read each failed assert. Expect: asserts on the prose bubble's
look or on an avatar (step `agent-chat-1-bubbles`), on the footer's words (`agent-chat-24-footer`: model · ctx and
the mode chip's click-to-cycle), and on the asleep composer (`agent-chat-14-asleep`). Change the asserts to the new
facts; keep each step's screenshot name.

**Step 2: Add a step per new view**, each with its shot:
- `agent-chat-27-pinned`: scroll the chat until the first prompt is above the top → `[data-pinned-prompt]` shows that
  prompt's text; click it → the prompt bubble is back in view.
- `agent-chat-28-model-menu`: click `[data-chat-model]` → a `role=menu` with three `menuitemradio` rows, one
  checked; Escape closes it. Do not pick (that types into the fixture's terminal).
- `agent-chat-29-mode-menu`: click the mode chip → four rows with their notes, the current one checked; Escape.
- `agent-chat-30-context`: `[data-chat-context]` shows the fixture's percent (seed `usage.contextpct` the way the
  footer step does, if it does not already).
- In `agent-chat-14-asleep`, assert `[data-chat-model-label]` and `[data-chat-asleep]` show, no `[data-chat-mode]`
  and no attach button are in the box, and the root carries both `data-agent-chat` and `data-sleeping-transcript`
  (one pane). If the scenario can wake the fixture agent, add `agent-chat-32-woken`: the same composer element
  (compare an id set on it before the wake) now shows the mode chip and the attach button.
- `agent-chat-31-prose`: `[data-chat-prose]` has no background fill (computed `background-color` is transparent) and
  no `[data-chat-agent] [aria-hidden="true"]` avatar.

**Step 3:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep` → every step PASS.

**Step 4: Changelog** (`CHANGELOG.md`, top section `Unreleased`, under `Changed`; read the file's header first):

```
- An agent's replies in Chat read as a page instead of bubbles beside an avatar, and your message pins to the top
  of the chat once you scroll past it; click it to go back.
- The Chat message box shows the model and the permission mode as chips: click either to pick another from a menu.
  The context shows as a small ring.
- A sleeping agent keeps the same chat as an awake one: putting it to sleep or waking it only folds the message
  box's chips in or out. Chat fades over the terminal and back, and the Chat | Terminal control slides between its
  two sides.
```

**Step 5: Hand checks** (`docs/hand-checks.md`, at the top of the list, `(arcterm)` titles): picking a model from the
chip switches Claude Code's model (its footer shows it); picking each mode lands on it, and a mode not in the cycle
gives the toast; Sleep then Wake a Claude agent in Chat → the conversation never blinks, the chips fold out and back
in, Send shows "Waking…"; the chat fade and the slide play, and with the OS's reduce-motion on all of it snaps.

**Step 6:** Commit: `git commit -m "test(chat): scenario steps for the document view, the chips and the pinned
prompt" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
