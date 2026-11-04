# Council: show the screenshot region a seat cites

## Why

A council seat cites part of a screenshot as `screenshot:<file>#<region>`, and the region is a free name
(`#price-line`, `#header`) with no position. When a seat proposes "make the button always visible" and three others
agree, the person cannot tell which button any of them means. Each cited region should show as an image with a red
box around it, next to the claim.

## What runs today

- `evidenceRule` (`pkg/council/prompts.go:228`) is the one line that tells every seat the cite format.
- The screenshots attached at setup are absolute paths in `Council.Screenshots` (`pkg/council/types.go:390`), listed
  to the seats by `writeFiles` (`prompts.go:638`). The seats open them with Read. Images the person pastes into the
  discussion are `CouncilReply.Attachments` (`types.go:266-268`), files under `~/.arc/attachments`.
- `CheckEvidence` (`pkg/council/cites.go:85`) marks every `path:line` cite ok or wrong; `checkable` (`cites.go:68`)
  skips screenshot refs, so they are never checked.
- The frontend draws a screenshot cite as a plain chip with an image icon and the name
  (`frontend/app/view/agents/councilsourcespanel.tsx:133-147`); clicking it does nothing. `councilsummarymodel.ts:173`
  and `:337` treat it as unchecked. `imageframe.tsx` already draws a local image streamed from `/wave/stream-file`.

## Design

### 1. The cite names a box

A seat cites a region as

```
screenshot:<file>#<name>@x,y,w,h
```

`x,y` is the box's top-left corner and `w,h` its size, each a fraction (0..1) of the image's width or height. Fractions
do not depend on the image's size, so a seat that sees a scaled-down copy through Read still writes a box that lands in
the right place. `<name>` stays, so the cite reads well as text. `evidenceRule` is rewritten to ask for the box with
every screenshot cite, with one example.

### 2. Go checks the box

`checkable` stops skipping screenshot refs that carry a box, and `CheckEvidence` gets a screenshot branch. A screenshot
cite is wrong (`CiteWrong`, with a note) when:

- `<file>` matches no image the council was given, or matches two (section 4);
- the box does not parse as four numbers;
- the box is not inside the image: any of `x`, `y`, `w`, `h` negative, `w` or `h` zero, `x+w > 1` or `y+h > 1`
  (a small tolerance, e.g. 0.01, is clamped instead of failing).

A wrong screenshot cite shows as the existing Wrong cite chip (`WrongCiteChip`), with no image.

Go cannot tell whether the box sits on the right button, only that it lies in the image.

Agent's call (builder question 1): the check above runs where cites are checked today (`ApplyChecks`: sent proposals
and stance replies, never a Brainstorm). Locating and cropping is its own pass that runs on every message in every mode,
plain replies and Brainstorm councils included, and labels nothing: in a message that is not checked, a boxed cite
that cannot be drawn shows as the plain chip it is today. The person hit the problem on plain replies in the thread
panel, so they need crops too.

### 3. Go draws the PNG

For each screenshot cite with a valid box (section 2's parse, file and bounds rules), Go crops the image around the box, draws a red rectangle on the box, and saves the result
as a PNG beside the council's store (under `CouncilsDir`, e.g. `councils/<id>/regions/`). It uses the standard
`image`, `image/png`, `image/jpeg`, `image/gif` and `image/draw` packages only. Agent's call (builder question 2):
a box on an image those cannot decode (WebP, which the setup picker accepts) is a wrong cite in a checked message, noted
"can't read <format> images", and a plain chip elsewhere; no new decoder dependency. The PNG's path goes on the evidence (a new
`CouncilEvidence` field, e.g. `Crop`), so the frontend never computes a crop. A PNG is made once per distinct
file + box and reused; a re-run of `CheckEvidence` on an unchanged cite does not redraw it.

The PNG is a real file: the person can copy it into Slack or a document.

Agent's call (builder question 3): once a crop PNG exists, it stands. A re-check that no longer finds the source image
(a pasted image cleaned from `~/.arc/attachments`, a moved screenshot) keeps the cite's ok verdict and its crop, and
does not redraw. Clicking the crop then opens the crop alone in Sources, with a line saying the full screenshot is no
longer on disk.

### 4. Which images a seat may box

A box may point at any image the council was given: the screenshots attached at setup (`Council.Screenshots`) and the
images the person pasted into the discussion (`Attachments` on the person's replies). Go resolves `<file>` by base name
against that list; an absolute path that is in the list also matches. A name that matches none, or two, is a wrong
cite.

### 5. Where the image shows

An idea or a reply that cites a screenshot region shows the boxed crop under its text, before the evidence chips, about
240px wide, so the person sees which button without a click. This holds on the board's idea card, in the Discussion
and in the thread panel (380px wide). Clicking the crop opens the whole screenshot with the same box in the Sources
panel. A card citing several regions shows one crop for each. Agent's call (builder question 4): every message shows the crops
of its own boxed cites, whatever its stance, so an agree or a disagree reply that boxes a region shows it; a reply that
cites nothing new shows nothing, and the idea it answers keeps its own crop.

### 5b. In the saved council document

When a finished council saves its document into the project (`Document`, `pkg/council/markdown.go:222`), the crop PNGs
are copied into a folder next to it (`<doc name>-regions/`), and each message embeds its crops under its evidence line
with a relative Markdown image link. The document then stands alone and survives deleting the council. A crop whose PNG
is missing is left as the text ref.

### 6. A screenshot cite with no box

A screenshot cite with only a name (`screenshot:<file>#<name>`, no `@x,y,w,h`) counts as no evidence: the claim is drawn
weak, as a claim with no cite is, and the chip says the region has no box. This holds for councils that already ran.

Agent's call: in a Brainstorm, which asks for no evidence and draws nothing weak, a name-only screenshot cite stays a
plain chip, as today.

## Left to the builder

- How much margin the crop keeps around the box: enough to see the button's neighbours, e.g. the box plus half its size
  on each side, at least 160px on the long side, clamped to the image.
- Where exactly the PNG is saved and how it is named (one per distinct file + box, reused).
- The wording of `evidenceRule` and of the cite notes for a box outside the image or an unknown file.
- The red rectangle's thickness relative to the image (it should read at 240px wide).
- When the council is deleted, its region PNGs go with it (the copies beside a saved document stay).

## Testing

- Go: `cites_test.go` cases for a boxed cite that is ok, a box outside the image, a box that does not parse, an unknown
  file, a file name matching two images, and a name-only cite (weak); a test that the PNG is drawn once and has the
  crop's size; `parse_test.go` keeps reading the new ref unchanged.
- Frontend: the pure models (`councilsources.ts`, `councilsummarymodel.ts`) unit-tested for a boxed cite, a wrong one
  and a name-only one.
- CDP: a council scenario in `scripts/cdp/councilscenarios.mjs` with a fixture idea citing a boxed region, which shows
  the crop under the claim on the idea card and in the thread panel, and the boxed screenshot in Sources after a click.
