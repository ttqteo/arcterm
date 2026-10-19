# Image diff on the Diff surface

The Diff surface draws every binary file as a sentence: Review mode says "Binary file — no text to show"
(`frontend/app/view/agents/reviewlistview.tsx:66`), File mode shows the "Binary file" empty state
(`diffempty.ts:70`). A changed PNG or JPG reads +0 −0 with nothing to look at. This design shows the two
versions of an image side by side, in both modes.

**Shipped 2026-10-19 (a39a50869), Review mode only.** File mode and the `image-diff` CDP scenario were left out,
since the Diff surface sees little use: `docs/deferred.md` "(arcterm) Image diff in File mode" says how to add them.
The view is `imagediffview.tsx`, not `imagediff.tsx` (beside `imagediff.ts`, the import would be ambiguous). Before
and after show "Added" and "Deleted" for a missing side rather than naming the ref.

## Scope

- Images whose type `imageMime` knows: png, jpg/jpeg, gif, webp. SVG is text and already diffs as text.
- Every other binary keeps today's sentence.
- Side by side only: no swipe, onion skin or pixel diff. No line comments on an image.

## Data

### Backend: one opt-in field

`gitinfo.FileAtRef` reads the blob and then drops it when it is not UTF-8 (`pkg/gitinfo/gitinfo.go:1036`).

- `CommandGitFileAtRefData` gains `Raw bool` (`json:"raw,omitempty"`).
- `CommandGitFileAtRefRtnData` gains `Data64 string` (`json:"data64,omitempty"`).
- With `Raw`, a blob that is not valid UTF-8 comes back with `Binary: true` and its bytes in `Data64`, base64.
  The bytes are read with `git cat-file blob <ref>:./<path>`, which applies no filter or textconv. `run()`
  keeps stdout as raw bytes (`string(out)`), so nothing is decoded on the way.
- Without `Raw`, nothing changes. The `MaxBytes` cap applies before the read as today.
- Then `task generate`.

Base64 keeps NULs and invalid UTF-8 out of the JSON. That is the failure `asReviewFile`
(`reviewlistview.tsx:90-96`) works around for an untracked binary sent as text. The cost is +33% on the
wire: at most ~6.7 MB a side over the local websocket.

### Frontend: one loader

`imagediff.ts` (pure, with `imagediff.test.ts`):

- `imageMime` moves out of `docreviewload.ts` into `imagemime.ts` so both views import it; doc review's
  import follows it. The 5 MB cap is `IMAGE_MAX_BYTES`, the one doc review uses.
- `loadImageSides(cwd, path, oldPath, refs)` takes the `DiffPairRefs` from `pairRefsFor`
  (`diffcontent.ts:25`), so the before and after refs are the ones File mode already uses: the anchor
  against the working tree, `hash^` against `hash`, either side of a compare.
- The before side reads `oldPath` when the file was renamed.
- A ref side is `GitFileAtRefCommand({ raw: true, maxbytes: IMAGE_MAX_BYTES })`; the working-tree side is
  `FileInfoCommand` for the size, then `FileReadCommand`, whose `data64` is already base64.
- Each side resolves to one of:
  - `{ kind: "image", url, bytes }`, with `url` a `data:<mime>;base64,…` URL (the CSP allows
    `img-src 'self' data:` and nothing pointing at wavesrv)
  - `{ kind: "missing" }`: added on the other side, or deleted
  - `{ kind: "toolarge", bytes }`
  - `{ kind: "error" }`
- Pixel size is read from the loaded `<img>` (`naturalWidth`/`naturalHeight`), not parsed from the bytes.

### Loading cost

- Review loads an image section only once it scrolls into view (an IntersectionObserver on the section).
- The data URLs live in that section's state and go when it unmounts. There is no session cache.
- A working-tree side reloads when Review's `refreshKey` changes, like the text rows; a ref side loads once.
- File mode loads the two sides in `loadDiffPair` (`diffcontentstore.ts:72`) when the pair is binary and
  the path is an image, and puts them on the pair (`DiffPair.images`), so the poll's refresh and the
  token guard work as they do for text.

## View

`ImageDiff` (`imagediff.tsx`), one component for both modes.

- Two columns, **Before | After**, each:
  - the image fit inside the column (`object-contain`), at most its natural size, at most ~360px tall in
    Review and the pane's height in File mode
  - a checkerboard behind it, drawn from theme tokens (no raw colors), so transparency shows
  - a caption: `1200×630 · 84 KB`. When the two pixel sizes differ, the after caption is drawn in the
    accent so the change is noticed.
- Added file: the before column is a dashed placeholder, "Not in <ref>". Deleted file: the after column
  reads "Deleted".
- One side over the cap or unreadable: that column alone reads "Too large (7.2 MB)" or "Couldn't read";
  the other still shows its image.
- Below ~520px wide the columns stack.
- Loading: each column shows the pane's skeleton until its side resolves.

### Where it shows

- **Review:** a section whose `empty` is `"binary"` and whose path `imageMime` knows renders `ImageDiff`
  where the sentence was. The header (+0 −0) and collapse are unchanged.
- **File:** in `diffpane.tsx` (the `empty` branch at line 404), the `binary` empty state of an image path
  renders `ImageDiff` from `pair.images` instead of `EmptyState`. Diff navigation (Shift+N / Shift+P) stays
  off for it, as it is for a binary today.

## Testing

- `pkg/gitinfo`: `FileAtRef` with `Raw` returns a committed PNG's exact bytes in `Data64`; without `Raw`
  it returns no `Data64`.
- `imagediff.test.ts`: each side's state (image, missing, toolarge, error), the refs for each selection
  kind, and `oldPath` on a rename.
- CDP scenario `image-diff`: a temp repo, built the way `line-review` builds its fixture, with one PNG
  changed in the working tree (pixel size changed), one added and one deleted. It shots Review mode with the
  three sections and File mode on the changed PNG, and asserts two `<img>` with data URLs on the changed
  file, the "Not in" placeholder on the added one and "Deleted" on the deleted one.
