# Agent chat: document view, composer chips, transitions

**Verify:** `node scripts/verify.mjs ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher-resume`
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
   the Chat | Terminal control's selected fill slides between its options, and asleep the control shows dimmed.

Decisions made beyond the boards (the lead's calls, each with why):

- **No time on your bubble's hover.** `AgentEntry` of kind `user` carries no timestamp
  (`frontend/app/view/agents/agentsviewmodel.ts:48`), so the copy button stays where `BubbleCopy` puts it today.
- **No effort in the model chip or menu.** arcterm reads no effort level for an agent; the chip shows `agent.model`
  as the footer does today.
- **Model menu choices are the three aliases `opus`, `sonnet`, `haiku`.** Claude Code's `/model <alias>` switches
  without opening its own menu, so the send stays in Chat (`opensTui` in `slashcommands.ts` only flips to the
  terminal for a bare `/model`). The current one is the choice whose alias appears in `agent.model`, lowercased.
- **Picking a mode presses Shift+Tab and re-reads**, at most 6 presses and 12 reads, 250 ms apart, stopping when
  `tuiMode` reads the target, or when a mode seen earlier comes back (the target is not in this session's cycle:
  Bypass appears only when enabled). A read equal to the one before it means the TUI has not redrawn yet: read again
  without pressing. A read that finds no footer (a permission dialog or a menu covers it) stops the loop with a toast
  and presses nothing more: Shift+Tab under a permission dialog answers it. The order of the cycle is not assumed.
- **Asleep, the model is a label, not a menu.** Wake takes no model today; changing it is done once awake.
- **Sleeping and Chat are one pane** (the person's call). Today `agentsurface.tsx:833-837` swaps a
  `SleepingTranscript` overlay (which, for a Claude agent, already draws `ChatConversation` + `ChatComposer`) for
  `ChatLayer`. After this plan a Claude agent always gets `ChatLayer`, shown while it sleeps whatever its stored chat
  mode; `ChatPane` reads `agent.sleeping` for the few differences (no live stream, the wake placeholder, the
  `data-sleeping-*` attributes the scenarios read). `SleepingTranscript` keeps only the other harnesses' compact
  transcript. Because the `ChatComposer` (keyed by agent id) is never remounted, Task 3's folds play when the agent
  sleeps or wakes (Task 3 and Task 4 run side by side; the folds show once both have landed).
- **Asleep, the Chat | Terminal control stays and is dimmed** (`Transitions.dc.html`): both `ChatSwitch` and the
  header's view control are drawn for a sleeping Claude agent, disabled, `opacity-40`, Chat selected.
- **New motion variants, not edits to old ones.** `viewFade` has no exit by design (`motiontokens.ts:98`, asserted by
  `motiontokens.test.ts:56`) and eight views use it inside `AnimatePresence`; the chat layer gets its own `layerFade`.
- **The sliding fill is opt-in on `Segmented`** (`slide` prop), turned on for the agent header's view control and
  built into `ChatSwitch`, so no other segmented control in the app changes.
- **`CHANGELOG.md` and `docs/hand-checks.md` are written once, in Task 5**, so the parallel tasks never conflict in
  them.

### Task 1: The motion variants: `foldX` and `layerFade`

**Depends on:** none

**Files:** `frontend/app/element/motiontokens.ts`, `frontend/app/element/motiontokens.test.ts`

Read `motiontokens.ts` whole first (`composerReveal` at `:51`, `viewFade` at `:98`, `microFade`, `indicatorSlide`)
and the way `motiontokens.test.ts` tests each variant.

**Step 1: Write the failing tests** in `motiontokens.test.ts`, beside the others:

- `foldX`: initial `{ opacity: 0, scale: 0.96, width: 0 }`, animate `{ opacity: 1, scale: 1, width: "auto" }` on
  `durMicro`, exit back to the initial values on `durMicro`, `easeFluid` both ways; it never animates `x`, `y` or
  `height`.
- `layerFade`: initial `{ opacity: 0 }`, animate `{ opacity: 1 }` on `durMacro`, exit `{ opacity: 0 }` on `durExit`,
  `easeFluid`, and the exit target carries `pointerEvents: "none"` (a fading layer never takes a click or a key).
- Keep the `viewFade` test's `not.toHaveProperty("exit")` as it is.

**Step 2:** `npx vitest run frontend/app/element/motiontokens.test.ts` → FAIL (exports missing).

**Step 3: Implement** both after `composerReveal` / `viewFade` respectively, each with a comment in the file's style:
`foldX` is `composerReveal`'s signature on the horizontal axis plus the 0.96 scale (a composer part folding in or out
of a row); `layerFade` is a whole layer fading over another one that stays mounted under it (the chat over the
terminal), so unlike `viewFade` it has an exit, and the exit stops taking pointer events at once.

**Step 4:** `npx vitest run frontend/app/element/motiontokens.test.ts` → PASS; `npx eslint` and `npx prettier --check`
on both files → clean.

**Step 5:** Commit: `git commit -m "feat(motion): foldX and layerFade variants" --
frontend/app/element/motiontokens.ts frontend/app/element/motiontokens.test.ts`

### Task 2: Agent prose as a document, and the pinned prompt in Chat

**Depends on:** none

**Files:** `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/pinnedpromptbar.tsx`

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
<PinnedPromptBar rootRef={rootRef} index={pinned} text={prompts[pinned]} bg="bg-background" className="-mb-4" />
```

Only `YouBubble`'s prompt branch carries `data-user-prompt`; keep `prompts` in step with exactly those elements (the
command bubble has none).

The root is `flex flex-col gap-4` (`:528`) and the bar returns null until a prompt pins, so as a flex child its
zero-height row would add a 16px gap the moment it appears and shift the transcript. Give `PinnedPromptBar` an
optional `className?: string` merged with `cn` onto its sticky root (`pinnedpromptbar.tsx:98`; its other callers pass
none and draw as today) and pass `-mb-4` here, which cancels the gap. Do not wrap the bar in another element: the
sticky element's parent must be the conversation root, or it stops pinning. The bar is sticky at the scroller's
padding edge: the chat scroller (`chatpane.tsx:119`) has no top padding already; keep it so.

**Step 5:** `npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/pinnedprompt.test.ts`
→ PASS. `npx eslint` and `npx prettier --check` on both files → clean.

**Step 6:** Commit: `git commit -m "feat(chat): agent prose reads as a document, and chat pins your prompt" --
frontend/app/view/agents/chatconversation.tsx frontend/app/view/agents/pinnedpromptbar.tsx`

**Acceptance (Task 5 adds the steps):** `agent-chat-27-pinned` and `agent-chat-31-prose`.

### Task 3: The composer's chips: model, mode, context ring, attach, and their folds

**Depends on:** Task 1 (folds the composer's parts with the `foldX` variant it adds)

**Files:** `frontend/app/view/agents/chatfootermodel.ts`, `frontend/app/view/agents/chatfootermodel.test.ts`, `frontend/app/view/agents/chatfooter.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/attachmenttray.tsx`

(`attachmenttray.tsx` for the `AttachButton` icon; `chatcomposer.tsx:307` is its only user. `chatcomposer.tsx` gets
the spacer move of Step 5 and the folds of Step 7: the attach button, the "Asleep" word and the Send button.)

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
        expect(modeStep(["default", "acceptEdits"], "acceptEdits", 1, 2)).toBe("done");
    });
    it("presses again while the target is not reached", () => {
        expect(modeStep(["default"], "plan", 0, 1)).toBe("press");
        expect(modeStep(["default", "acceptEdits"], "plan", 1, 2)).toBe("press");
    });
    it("reads again without pressing while the screen still shows the mode before the press", () => {
        expect(modeStep(["default", "default"], "plan", 1, 2)).toBe("wait");
    });
    it("gives up when an earlier mode comes back before the target", () => {
        expect(modeStep(["default", "acceptEdits", "plan", "default"], "bypassPermissions", 3, 4)).toBe("give-up");
    });
    it("stops without pressing when a read finds no footer", () => {
        expect(modeStep([null], "plan", 0, 1)).toBe("no-footer");
        expect(modeStep(["default", null], "plan", 1, 2)).toBe("no-footer");
    });
    it("caps the presses", () => {
        expect(modeStep(["default", "acceptEdits"], "plan", 5, 6)).toBe("press");
        expect(modeStep(["default", "acceptEdits"], "plan", 6, 7)).toBe("give-up");
    });
    it("caps the reads when the screen never redraws", () => {
        expect(modeStep(["default", "default"], "plan", 1, 12)).toBe("give-up");
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
const MODE_READS_MAX = 12;

/**
 * What to do next while pressing Shift+Tab toward `target`. `seen` is what each read found, the first before any
 * press, null for a read with no footer; `presses` the Shift+Tabs sent; `reads` every read made.
 */
export function modeStep(
    seen: (ClaudeMode | null)[],
    target: ClaudeMode,
    presses: number,
    reads: number
): "done" | "press" | "wait" | "give-up" | "no-footer" {
    const last = seen[seen.length - 1];
    if (last === target) {
        return "done";
    }
    if (last == null) {
        return "no-footer"; // a dialog or menu covers it, and Shift+Tab there would answer it
    }
    if (presses >= MODE_PRESSES_MAX || reads >= MODE_READS_MAX) {
        return "give-up";
    }
    if (seen.length >= 2 && last === seen[seen.length - 2]) {
        return "wait"; // the TUI has not redrawn since the press
    }
    if (seen.indexOf(last) < seen.length - 1) {
        return "give-up"; // an earlier mode came back: the target is not in this session's cycle
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

**Step 4:** `npx vitest run frontend/app/view/agents/chatfootermodel.test.ts` → PASS.

**Step 5: The chips** in `chatfooter.tsx`. Keep `useTuiMode` and the file's polling. Render, left to right, after the
attach button the composer already places (`chatcomposer.tsx:306-308` puts `<ChatFooter>` right after it):

- **Model chip** (live): a `<button data-chat-model aria-haspopup="menu" aria-expanded>` drawn as the board's chip
  (`h-[28px] rounded-[8px] border border-edge-mid px-[9px] text-[12px] text-primary`, open:
  `border-edge-strong bg-surface-hover`, a `ChevronUp` 11px), its label `agent.model`. Its menu (`role="menu"`) opens
  upward (`absolute bottom-[calc(100%+8px)] left-0`) inside `PopoverReveal` (`element/popoverreveal.tsx`,
  `origin="bottom left"`): a "Model" caption, one `role="menuitemradio"` row per `MODEL_CHOICES` with `aria-checked`
  and a check on `currentModelAlias(agent.model)`, and the line "Sends /model to Claude Code" in `text-ink-faint`.
  Picking types `modelCommand(alias) + "\r"` into the block (`RpcApi.ControllerInputCommand`, as `cycle` does today)
  and closes. Escape and a click outside close it; ↑/↓ move between rows.
- **Mode chip** (live, once a mode is read): `data-chat-mode={mode}`, a `Lock` icon 12px, `modeLabel(mode)`, a
  `ChevronUp`. Its menu (`role="menu"`): a "Permission mode" caption, a `menuitemradio` row per `MODE_CHOICES` (label
  from `modeLabel`, its note under it in `text-muted`, a check on the current mode), and "Shift+Tab in the box cycles
  them too" in `text-ink-faint`. Picking runs the loop: read once (`readTermLines` + `tuiMode`; `reads = 1`, push the
  mode, or null when no footer was found), then while `modeStep(seen, target, presses, reads)` is `"press"` or
  `"wait"`: on `"press"` send Shift+Tab and `presses++`; on `"wait"` send nothing; then wait 250 ms, read (`reads++`),
  push the mode or null. On `"give-up"` push a toast (`pushToast` from `@/app/cockpit/notificationstore`, as
  `chatcomposer.tsx` uses it): "Claude Code did not offer <label> in this session"; on `"no-footer"` the toast "Claude
  Code's mode line is covered: answer what it shows, then pick again". Stop the loop if the component
  unmounts or the agent falls asleep. The old click-to-cycle is gone: the chip now opens the menu. Keep
  `data-chat-mode` on the chip (the `agent-chat` scenario reads it).
- **Spacer**, then the **context ring** at the right (`data-chat-context`): a 14px SVG ring (track `stroke-edge-
  strong`, value `stroke-secondary`, or `stroke-warning` when `contextWarn`), `ringDash(pct, 88)` as the dash, then
  `Math.round(pct)%` in `text-[11.5px] text-muted tabular-nums`, `title="Context N%"`. Drawn only when a percent
  exists. The footer therefore renders as a `flex-1` row: read `chatcomposer.tsx:306-338` and move the composer's
  `<div className="flex-1" />` so Stop and Send stay at the far right after the ring.
- **Asleep** (today `ChatFooter` returns null): render the model as a plain label (`data-chat-model-label`,
  `h-[28px] rounded-[8px] border border-border px-[9px] text-[12px] text-muted`, no menu, `title="The model it ran
  on"`) and the context ring with its value stroke `stroke-muted` when a percent exists. No mode chip.

Colors only through token utilities. Every icon-only control gets an `aria-label`; the chips get a `title`.

**Step 6: Attach is a `+`.** In `attachmenttray.tsx`, `AttachButton` draws `Plus` (size 16, `strokeWidth={1.8}`)
instead of `Paperclip`; keep its title and aria-label, and give it `data-chat-attach`. Remove `Paperclip` from the
import if unused.

**Step 7: The parts fold between live and asleep** (`Transitions.dc.html`, played with its Sleep / Wake button).
After Task 4 the same `ChatComposer` instance lives through a sleep and a wake, so when `agent.sleeping` flips:
the attach button, the mode chip and the "Asleep" word (a `Moon` 13px + "Asleep" in `text-[12px] text-muted`, shown
asleep only, `data-chat-asleep`) enter and leave inside `AnimatePresence initial={false}`, each wrapped in a
`motion.span` (or `div`) with Task 1's `foldX` variants and `overflow-hidden` while it moves. The model chip turns
into the label in place (`microFade` crossfade). The Send button (`data-chat-send`, in `chatcomposer.tsx`) animates
its width between fixed widths, as the board draws them: 30px for the arrow (live), 58px for "Send" and 78px for
"Waking…" (asleep), the arrow and the word crossfading (a CSS `transition` on width with `easeFluidCss` and
`MOTION.durMicro` from `motiontokens.ts`, plus `motion-reduce:transition-none`; CSS cannot transition to `auto`, so
the widths are explicit). Today `chatcomposer.tsx:307` drops the attach button with `asleep ? null :`; it becomes the
presence-wrapped fold. Reduced motion snaps all of it: the app root has no `MotionConfig`, so wrap the composer's
folding row in `MotionConfig reducedMotion="user"` as `collapsiblerail.tsx:215` does.

**Step 8:** `npx vitest run frontend/app/view/agents/chatfootermodel.test.ts` → PASS; `npx eslint` and
`npx prettier --check` on the five files → clean.

**Step 9:** Commit: `git commit -m "feat(chat): the composer's model and mode are chips with menus, the context a
ring" -- frontend/app/view/agents/chatfootermodel.ts frontend/app/view/agents/chatfootermodel.test.ts
frontend/app/view/agents/chatfooter.tsx frontend/app/view/agents/chatcomposer.tsx
frontend/app/view/agents/attachmenttray.tsx`

**Acceptance (Task 5 adds or changes the steps):** `agent-chat-24-footer`, `agent-chat-28-model-menu`,
`agent-chat-29-mode-menu`, `agent-chat-30-context`, `agent-chat-14-asleep` and `agent-chat-32-woken`.

### Task 4: One chat for awake and asleep, and the transitions around it

**Depends on:** Task 1 (fades the chat layer with the `layerFade` variant it adds)

**Files:** `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/agentsurface.tsx`, `frontend/app/view/agents/sleepingtranscript.tsx`, `frontend/app/element/segmented.tsx`, `frontend/app/view/agents/agentheader.tsx`, `frontend/app/view/agents/chatswitch.tsx`, `frontend/app/view/agents/gridcellbar.tsx`

(`chatpane.tsx`: `ChatLayer`, `ChatPane`, `PendingBubble`, the placeholder at `:180`; `agentsurface.tsx:829-837`;
`sleepingtranscript.tsx` drops its chat branch; `agentheader.tsx:419` and `:746`; `gridcellbar.tsx:32`.)

**Step 0: One pane.** Read `sleepingtranscript.tsx` whole: for a Claude agent (`chatCapable`) it already draws
`ChatConversation` and `ChatComposer` (wake placeholder `` `message ${agent.name} to wake it… (Enter)` ``,
`dataAttrs={{ "data-sleeping-composer": agent.id }}`), reads the transcript once (`useTranscriptRead`) and keeps its
place under `sleeping:<id>:<since>`.
- `agentsurface.tsx:833-837` becomes: a cell whose agent sleeps and is not `chatCapable` gets `SleepingTranscript`;
  every other cell gets `ChatLayer` (keep `ChatLayer` in one JSX position so waking or sleeping never remounts it).
  Update the comment above it. Nothing else in the file moves: the cell wrappers, the terminal stack and
  `CockpitFocusPane` must not re-parent (AGENTS.md, "The Agent surface's terminal stack").
- `ChatLayer` shows the pane when `useChatMode(agent) === "chat"` **or** (`agent.sleeping != null &&
  chatCapable(agent)`): a sleeping Claude cell always draws the conversation; its terminal holds only the kill.
- `ChatPane`, when `agent.sleeping != null`: no live stream (add `asleep` to the stream effect's guard and deps, and
  read once on entering sleep with `requestAppend()` so the last turn is there); root also carries
  `data-sleeping-transcript={agent.id}`; the composer gets the wake placeholder and the `data-sleeping-composer`
  attribute (the `agent-sleep` and `agent-chat` scenarios select on both). The place key stays
  `chat:<id>:<path>` for both states. Keep the composer `key={agent.id}` so it never remounts.
- `sleepingtranscript.tsx`: keep only the compact branch (`CompactTranscript` + `AgentComposer`); drop the
  `ChatConversation`/`ChatComposer` imports and the `chat` flag; rewrite its header comment (a Claude agent's
  sleeping conversation is `ChatPane`'s now). Grep for other imports of anything removed.
- **The Chat | Terminal control asleep.** Today both hide it for a sleeping agent: `gridcellbar.tsx:32` renders
  `ChatSwitch` only when `agent.sleeping == null`, and `agentheader.tsx:419`'s `chatShown` requires it, so the header
  drops Chat. Make both draw it for every `chatCapable` agent: `gridcellbar.tsx` passes the agent as before and
  `ChatSwitch` reads `agent.sleeping` itself; in `agentheader.tsx` `chatShown` is `chatCapable(agent)` and, while the
  agent sleeps, `shownView` is the chat option (the pane shows whatever the stored mode). Asleep, only the Chat and
  Terminal options are disabled: in `ChatSwitch` (which has only those two) the whole control is `opacity-40`, its
  buttons `disabled`, `cursor-default`; in the header, `Segmented` gets an optional per-option `disabled?: boolean`
  (each disabled option `disabled`, `opacity-40`, `cursor-default`, its own `title`; options without it draw as
  today), so a sleeping agent's Canvas, Review or Brainstorm option stays usable. Both disabled options are titled
  "Wake the agent to show its terminal", with Chat selected. The dimmed `ChatSwitch` root and each dimmed header
  option carry `data-chat-view-asleep`, for the scenario.
- `PendingBubble` (`chatpane.tsx:38-49`) matches Task 2's `YouBubble`: `max-w-[75%]`, `rounded-[12px]`,
  `text-[13.5px]`, keeping its `opacity-60` and its Sending… / Queued line.

**Step 1: Chat fades over the terminal.** `ChatLayer` (`chatpane.tsx:53-55`) returns the pane or null. With `shown`
the Step 0 condition, computed with the hooks before the JSX:

```tsx
const shown = useChatMode(agent) === "chat" || (agent.sleeping != null && chatCapable(agent));
return (
    <AnimatePresence initial={false}>
        {shown ? (
            <motion.div key="chat" variants={layerFade} initial="initial" animate="animate" exit="exit">
                <ChatPane model={model} agent={agent} barred={barred} />
            </motion.div>
        ) : null}
    </AnimatePresence>
);
```

`layerFade` is Task 1's. The wrapper takes no position or size: `ChatPane` is `absolute` against the cell, and the
wrapper's opacity still applies to it. Leaving Chat keeps the pane mounted for the exit (`durExit`); the terminal under
it must take keys and clicks at once: the exit sets `pointer-events: none` on the wrapper, which `pointer-events` on
`ChatPane`'s own root would override, so check `ChatPane`'s root sets none (or give the wrapper's child
`pointer-events: inherit` while exiting via `useIsPresent`). Wrap the `AnimatePresence` in `MotionConfig
reducedMotion="user"` (the app root has none), so reduced motion snaps the fade. Focus must not stay in the fading box: the existing
switch already moves focus to the xterm; keep it so.

**Step 2: Sleep and wake keep the pane.** With Step 0 a Claude agent's chat stays mounted through a sleep and a wake
(no fade: nothing leaves), and only the composer's parts fold (Task 3). The compact `SleepingTranscript` of other
harnesses stays as it is.

**Step 3: The sliding fill.** `Segmented` gets an optional `slide?: boolean`. With it, the selected option's fill is
a `motion.span` with `layoutId` from `useId()` (unique per control) and `transition={indicatorSlide}`, absolutely
behind the label (`absolute inset-0 rounded-[inherit]` in the selected fill's token, `data-slide-fill`, the label
`relative`); without it, the control draws exactly as today. Pass `slide` from `agentheader.tsx:746`. In
`ChatSwitch`, draw the same: the `bg-accentbg` moves to a `motion.span layoutId` (`data-slide-fill`) inside the
pressed button. Reduced motion must snap both: the app root has no `MotionConfig`, so wrap each control's buttons in
`MotionConfig reducedMotion="user"` as `collapsiblerail.tsx:215` does.

**Step 4: Placeholder.** `chatpane.tsx:180`: `` `Reply to ${agent.name}, @ to mention, / for commands` ``.

**Step 5:** `npx eslint` and `npx prettier --check` on the changed files → clean;
`npx vitest run frontend/app/view/agents` → PASS (no test file changes here; the agents tests must still pass).

**Step 6:** Commit with every changed path: `git commit -m "feat(chat): one chat pane awake and asleep, chat fades
over the terminal, the view control's fill slides" -- <paths>`

**Acceptance (Task 5 adds or changes the steps):** `agent-chat-6`, `agent-chat-14-asleep`, `agent-chat-32-woken`,
`agent-chat-33-transitions`, `agent-sleep` steps 2 and 4b, and `launcher-resume` step 6b.

### Task 5: Scenario steps, changelog, hand checks

**Depends on:** Task 2 (asserts the prose and the pinned prompt bar it builds), Task 3 (asserts the chips' `data-chat-model`, `data-chat-context`, `data-chat-asleep`, `data-chat-attach` and `data-chat-send` attributes it adds), Task 4 (asserts the one pane's `data-sleeping-transcript` on the chat root, the dimmed `data-chat-view-asleep` control and the `data-slide-fill` it adds)

**Files:** `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

(`scenarios.mjs`: the `agent-chat` scenario, from line ~42443, its roster helper `acRoster` at ~42127; the
`agent-sleep` scenario, from line ~41703.)

**Step 1: Fix what the new look breaks.** Run both scenarios against the merged tree the way Final does
(`node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher-resume`) and read each failed assert. Expect:
- `agent-chat-1-bubbles`: asserts on the prose bubble's look or on an avatar.
- `agent-chat-24-footer`: model · ctx words and the mode chip's click-to-cycle.
- `agent-chat-14-asleep`: `send` reads the box's first `button`, which is now the folded attach or a chip; read
  `[data-chat-send]` instead.
- `agent-chat-6`: the layer now leaves after `durExit`, not at once; its `polishWaitFor` already waits up to 3 s, so
  only a check made before that wait needs changing.
- `agent-sleep` step 2: the sleeping cell is now `ChatPane`, which with no transcript reads "No messages yet", not
  "No transcript found"; assert the new words and that the cover carries `data-agent-chat` too.
- `agent-sleep` step 4b: reads `[data-sleeping-composer] button` for "Waking…"; read `[data-chat-send]` inside it.
- `launcher-resume` step 6b (`scenarios.mjs:~26280`): reads the sleeping cover (`data-sleeping-transcript`, its
  `[data-chat-you]` bubble, the `data-sleeping-composer` placeholder) that Task 4 moves onto `ChatPane`; it should
  still pass, so fix only what fails.
Change the asserts to the new facts; keep each step's screenshot name.

**Step 2: Add a step per new view**, each with its shot (all unconditional):
- `agent-chat-27-pinned`: scroll the chat until the first prompt is above the top → `[data-pinned-prompt]` shows that
  prompt's text, and the first `[data-chat-item]`'s top did not move when the bar appeared (compare its
  `getBoundingClientRect().top` minus the scroller's `scrollTop` before and after); click it → the prompt bubble is
  back in view.
- `agent-chat-28-model-menu`: click `[data-chat-model]` → a `role=menu` with three `menuitemradio` rows, one
  `aria-checked="true"`; Escape closes it. Open it again and pick Sonnet → the scenario's mock records a
  `controllerinput` (`scenarios.mjs:~42255`) whose data is `/model sonnet` for A's block, and the menu closes.
- `agent-chat-29-mode-menu`: click the mode chip → four rows with their notes, the current one checked; Escape. Open
  it again and pick a mode other than the current one (Accept edits, or Plan if that is current): the fixture's
  screen never redraws, so the mock records exactly one Shift+Tab (`[Z`) `controllerinput`, then within ~4 s a
  toast reads "did not offer".
- `agent-chat-30-context`: `[data-chat-context]` shows the fixture's percent (seed `usage.contextpct` the way the
  footer step does, if it does not already).
- In `agent-chat-14-asleep`, assert `[data-chat-model-label]` and `[data-chat-asleep]` show, no `[data-chat-mode]`
  and no `[data-chat-attach]` are in the box, the root carries both `data-agent-chat` and `data-sleeping-transcript`
  (one pane), and the header's view control (`acHeader`) shows Chat selected with its Chat and Terminal options
  carrying `data-chat-view-asleep`, disabled, computed opacity about 0.4. A single cell draws no `GridCellBar`
  (`agentsurface.tsx`: only with a split), so check `ChatSwitch` asleep inside a split: `G.openInSplit` F beside A
  (as `scenarios.mjs:~42686` does), assert F's cell bar `ChatSwitch` carries `data-chat-view-asleep` with its buttons
  disabled, then `G.endSplit`.
- `agent-chat-32-woken`: set a marker attribute on F's `[data-sleeping-composer]` element, then call
  `AC.setRoster(h, …)` with F's `sleeping` cleared (give `acRoster` a per-row patch option if it has none) → the same
  element (marker still on it) no longer carries `data-sleeping-composer` and shows the mode chip once a mode is read
  (or at least `[data-chat-attach]` and `[data-chat-model]`), and `[data-chat-asleep]` is gone. Restore the roster
  after.
- `agent-chat-33-transitions` (`Transitions.dc.html`): on the awake agent A in Chat (no split), the header's view
  control has one `[data-slide-fill]`, inside the Chat option. Pick Terminal (`acHeaderClick`) → at once there is one
  `[data-slide-fill]`, inside the Terminal option (framer mounts a new node there, so compare places, not elements),
  and its rect read ~80 ms after the click differs from its rect once settled (~500 ms): it slid. Within the exit
  (poll at once after the click) the exiting `[data-agent-chat]` layer's wrapper computes `pointer-events: none`, and
  `document.activeElement` is inside the cell's `.xterm`. Pick Chat again and wait for the layer. Then the same slide
  check on `ChatSwitch` inside a split (`G.openInSplit` B beside A, pick Terminal on A's cell bar, back to Chat,
  `G.endSplit`). Shot mid-exit and after.
- `agent-chat-31-prose`: `[data-chat-prose]` has no background fill (computed `background-color` is transparent) and
  no `[data-chat-agent] [aria-hidden="true"]` avatar.

**Step 3:** `node scripts/cdp/final-verify.mjs agent-chat agent-sleep launcher-resume` → every step PASS.

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
chip switches Claude Code's model (its footer shows it); picking each mode lands on it in a real session; Sleep then Wake a Claude agent in Chat → the conversation never blinks, the chips fold out and back
in, Send shows "Waking…"; the chat fade and the slide play, and with the OS's reduce-motion on all of it snaps.

**Step 6:** Commit: `git commit -m "test(chat): scenario steps for the document view, the chips and the pinned
prompt" -- scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md`
