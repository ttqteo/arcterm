# Reviewer verdict and plan handoff cards in Chat — fix round 1

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-12-chat-brainstorm-review-design.md` (lines 106–115, 170–185: a line Arc sent is
recognized by its send record; a `brainstorm:` line the user typed has no record and stays a bubble)

The final stage failed nine steps of the `chat-brainstorm-review` scenario (7, 9c, 10, 10b, 10c, 12b, 13, 16, 18), all ✓
rows and the typed-line bubble. They fail on the base too (t-5 found them on `d8cd79ab7`), but they hold the land.

Cause, read in source: `frontend/app/view/agents/chatmodel.ts` `readSent` runs `parseStreamPrompt`
(`claude/arc-view-mod/hooks/prompt-core.ts`), whose `brainstorm` parser (`BRAINSTORM = /^brainstorm: (.+)$/`) turns every
`brainstorm: …` line into a `kind: "sent"` item ("brainstorm · from the cockpit"). `chatbrainstormwire.ts`
`answerMessages` offers only `kind: "you"` items to `pairAnswers`, so such a line never pairs with its send record: no ✓
row draws in its place, and a typed line with no record draws as a sent card instead of a bubble.

### Task 1: A `brainstorm:` line stays your message in Chat, so it pairs with its send record

**Depends on:** none

Files: `frontend/app/view/agents/chatmodel.ts`, `frontend/app/view/agents/chatmodel.test.ts`.

- In `readSent`, a stream prompt whose card role is `"brainstorm"` is not a sent card: return null for it, so `chatItems`
  makes the line a plain `you` item (with its `uuid`), as it does for any text a person wrote. Every other stream prompt
  (`message`, `childRun`, `laterNote`) and every run prompt, pointer and wake reads as before.
- Do not edit `prompt-core.ts`: the view mod still draws the line as a card in Claude Code's own transcript, which is
  right there. The change is Chat's alone, because Chat has the send record to judge the line by (paired: hidden or a ✓
  row, by `pairedHidden`; unpaired: the user's own words, a bubble).
- Tests in `chatmodel.test.ts`: a `brainstorm: check` user entry makes a `you` item holding that text, not a `sent`
  item; a `[Message from agent …]` stream prompt and a `[jarvis] child …` line still make `sent` items. Add a test in
  `chatbrainstormwire.test.ts` only if `answerMessages(chatItems(entries))` needs one to show the line now reaches the
  pairing (one case: a `brainstorm: confirm every guess` entry is offered with its key).
- Acceptance: `npx vitest run frontend/app/view/agents/chatmodel.test.ts frontend/app/view/agents/chatbrainstormwire.test.ts`
  passes; `chat-brainstorm-review` steps 7, 9c, 10, 10b, 10c, 12b, 13, 16 and 18 pass, and its steps 14 and 15 (a live
  run's line draws neither a bubble nor a ✓ row) still pass. Run `task verify:ui -- chat-brainstorm-review` against a
  dev app if you can start one (AGENTS.md "Worktrees": `node scripts/cdp/final-verify.mjs chat-brainstorm-review` does
  it all); otherwise say so in Not verified, and the Final shows them.
