---
name: visual
description: Use in a Claude Code agent inside arcterm when a chart, an illustration, an interactive widget, a quiz or a small UI sketch would explain better than text — write one HTML file under ~/.arc/visuals and name it in an arc-visual block, and arcterm's Chat draws it inline.
---

# Drawing a visual in Chat

When a picture or a widget would explain better than text, write a small HTML page and name it in your reply.
arcterm's Chat draws the page inline, inside the conversation, as tall as it is. A button in it can send a
prompt back to you as if the person typed it.

## Mermaid first

A flowchart, sequence, state, pie or xy chart is a ```` ```mermaid ```` block. Chat already draws it, so write that
and stop. A visual is for what mermaid cannot do: a custom chart, an illustration, sliders with live numbers, a
quiz, buttons.

## Where and how

1. Write the page to `~/.arc/visuals/<YYYY-MM-DD>-<slug>.html` with the Write tool, making the folder if it is
   missing. One self-contained page: inline CSS and JS, at most about 300 lines.
2. Libraries only from `cdnjs.cloudflare.com`, `cdn.jsdelivr.net` or `unpkg.com`, with an exact version. Make no
   fetches of your own: the page's policy blocks every other host.
3. In your reply, one line saying what the visual shows, then the block: the first line is ```` ```arc-visual ````,
   the second the absolute path with forward slashes (the home folder spelled out, not `~`), the third ```` ``` ````.

````
A slider for the retry budget, with the p99 it implies.

```arc-visual
C:/Users/me/.arc/visuals/2026-11-10-retry-budget.html
```
````

Chat draws only a file inside `~/.arc/visuals/`. Any other path, a relative one, or one with a `..` in it stays a
code block.

## Look

Use the app's colours. The page receives them as CSS custom properties on `:root`: `--arc-background`,
`--arc-surface`, `--arc-surface-raised`, `--arc-edge`, `--arc-ink`, `--arc-ink-mid`, `--arc-muted`, `--arc-accent`,
`--arc-success`, `--arc-warning`, `--arc-error`, `--arc-font-sans`, `--arc-font-mono`. Give each a fallback,
`color: var(--arc-ink, #e6e6e6)`, so the page still reads when opened on its own, and leave the page background
transparent so it sits in the chat.

Size to content. The frame grows to the page's height up to 640 px, then offers Show all.

Never set `html` or `body` to `height: 100%`, `100vh` or a `min-height` of either. The page then fills the frame, so
the frame never shrinks below the height it loaded at. Let the content set the height.

## Buttons that ask

`arc.sendPrompt("…")` sends that text from the chat box as if the person typed it, to you. Keep each prompt short
and specific: "Explain why p99 rises past 4 retries", not "tell me more".

- Call it from a click handler only. A call made before the person has clicked in the page is dropped.
- While the person has a draft in the box, or within 1.5 s of the last prompt the page sent, the text goes into the
  box instead of being sent, and the person sends it.
- It is a button for the person, not a way to talk to yourself: never call it from a timer or on load.

## Where it shows

Only a Claude agent's Chat view in arcterm draws it. The terminal view, councils and other harnesses show the block
as three lines of code, which is why the line before it says what it shows. For a full screen to design and
review, use `arc:design` instead.
