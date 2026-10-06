# Markdown Comments in the Agent Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Agent panel's File tab renders a `.md` file as a document (Preview, with a Source toggle) and takes Antigravity-style comments — a text selection, gutter `+` blocks with Shift+click ranges, or a whole image — that go to the panel's agent as one message in line review's shape.

**Architecture:** A rehype plugin stamps every rendered block with the file lines it came from (`data-src-start` / `data-src-end`). `MdDoc` reads those stamps off the DOM to turn gestures into line ranges and to measure where marks go; pure `mdcomments.ts` decides anchors, quotes, which block a card hangs after, and the message; `mdcommentstore.ts` keeps drafts per agent in jotai. Cards render through a slot that `Markdown` places after each stamped block, fed by a React context, so editing comments never re-renders the document. Sending reuses line review's `sendLineComments` (bracketed paste + Enter).

**Tech Stack:** React 19, jotai, Tailwind 4, react-markdown 9 / unified 11 (remark-rehype, rehype-raw, rehype-sanitize), lucide-react, vitest; the CDP scenario harness (`scripts/cdp/`).

**Spec:** `docs/superpowers/specs/2026-10-06-md-comments-design.md`
**Mockup:** `.superpowers/design/md-comments/project/` (gitignored; boards Main, Select, Compose, Cards, Range, Image, Source, TrayStates)

## Global Constraints

- Colors only from `@theme` tokens (`bg-surface-hover`, `bg-accent`, `bg-edge-strong`, `text-muted`, `bg-asking`, `text-success`, `text-error`, …); never raw hex/rgba in a component.
- Inter everywhere except code: the source-line quote (a file-content snippet) and `<kbd>` chips are `font-mono`; a path in a card or the tray is Inter (DESIGN.md Typography).
- UI copy is English, sentence case, and verbatim from the spec: "Add comment", "Cancel", "Copy", "Send N comments", "Select text and press c, or hover a block and click +, to comment.", "<agent> is waiting on a question — answer it first", "Add or cancel the open comment first", "<agent> has no terminal — copy the comments instead", "Sent N comments to <agent>", "Copied. The comments stay until you send or delete them.", "Couldn't reach <agent> — comments kept".
- Quotes: a selection is one line, whitespace collapsed, cut to 160 characters plus "…" (`QUOTE_MAX`, `proseanchor.ts`); a `+` range is up to 3 non-blank source lines, each cut to 120 characters plus "…", then `… (N more lines)` (`QUOTE_LINES`, `QUOTE_WIDTH`, `linecomments.ts`); an image has no quote.
- The Preview / Source choice is persisted as `agent.rail.mdMode` (`"preview"` default). Drafts are in memory only.
- No jsdom render tests: pure logic gets vitest; rendered UI is checked in the dev app and by the CDP scenario.
- Typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (8 GB Mac; ~2 min — give the command a 5-minute timeout). Never `npx tsc`.
- Format-check only the files you touched (`npx prettier --check <files>`); never `--write` the tree; never run prettier on `scripts/**/*.mjs`.
- Stop a dev app by PID, never by image name: the packaged arcterm shares its process names.
- CDP (`task verify:ui`) needs WebView2, so it runs only on the Windows dev machine; on macOS check the UI by hand in `task dev`.

## Review Focus

- A file with CRLF line endings, or one that opens with frontmatter: every stamp, comment line and `:line` mark matches the file's own numbering. → Task 1 test "CRLF line endings" and Task 2 test "bodyOffset counts a CRLF frontmatter block".
- A comment that ends in a table row: its card hangs after the table, never between rows (a `div` in a `tbody` is invalid and React would warn). → Task 2 test "a table row gives way to its table".
- Opening another comment while the box holds a typed note: the note stays and takes focus, never lost. → Task 3 test "keeps a box that holds text".
- An agent that is asking, or has no terminal (an ended worker): Send is disabled with the reason, Copy still works. → Task 3 test "blocks while the agent asks…" and Task 6 step 8.
- A selection made inside a card or the comment box (copying your own note): no floating Comment button, no anchor. → Task 4 Step 6 manual check, Task 6 step 3.

**Verify:** `node scripts/verify.mjs ./pkg/util/keyedmutex`
**Check:** `NODE_OPTIONS=--max-old-space-size=4096 node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Prototype:** .superpowers/design/md-comments/project/Main.dc.html

No Go changes: the Verify pattern names one small package so that the final stage runs the whole vitest suite. There is no Final line: on macOS `final-verify` waits for CDP, which WKWebView never answers. The UI is checked by hand after landing, and by `task verify:ui -- md-comments` on Windows.

---

### Task 1: Source-line stamps in the shared markdown renderer, and images in the Code preview

**Depends on:** none

**Files:**
- Create: `frontend/app/element/rehype-srclines.ts`
- Test: `frontend/app/element/rehype-srclines.test.ts`
- Modify: `frontend/app/element/markdown.tsx` (imports; `Heading` ~line 64; `CodeBlock` ~line 140; `MarkdownImg` ~line 290; `MarkdownProps` ~line 296; the `Markdown` body ~lines 315–470)
- Create: `frontend/app/view/code/frontmattercard.tsx`
- Modify: `frontend/app/view/code/codeviewer.tsx` (`FrontmatterCard` moves out; the preview passes `resolveOpts`)

**Interfaces:**
- Produces: `rehypeSrcLines(opts?: { offset?: number })` (a unified plugin), `withSrcLineAttributes<S>(schema: S): S`, `SRC_LINE_PROPS`.
- Produces: `Markdown` props `srcLineOffset?: number`, `contentBlocks?: boolean` (default `true`), `blockAfter?: (tag: string) => React.ReactNode`. Every stamped block element in the DOM carries `data-src-start` / `data-src-end`; a rendered `img` also carries `data-md-src` (its `src` as written). `blockAfter(tag)` is rendered right after a stamped `p` / `h1`–`h6` / `pre` / `hr` / `table` / `img`, and as the last child of a stamped `li`.
- Produces: `FrontmatterCard({ fields }: { fields: [string, string][] })` exported from `frontend/app/view/code/frontmattercard.tsx`.

- [ ] **Step 1: Write the failing test**

`frontend/app/element/rehype-srclines.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Element, Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { rehypeSrcLines, withSrcLineAttributes } from "./rehype-srclines";

// the pipeline markdown.tsx runs, stamps first: "tag start-end" for every stamped element, in document order
function stamps(md: string, offset = 0, schema: object = withSrcLineAttributes(defaultSchema)): string[] {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSrcLines, { offset })
        .use(rehypeRaw)
        .use(rehypeSanitize, schema);
    const tree = processor.runSync(processor.parse(md)) as Root;
    const out: string[] = [];
    // a block body: a visitor that returns a number makes visit() skip to that index
    visit(tree, "element", (node: Element) => {
        const p = node.properties ?? {};
        if (p.dataSrcStart != null) {
            out.push(`${node.tagName} ${p.dataSrcStart}-${p.dataSrcEnd}`);
        }
    });
    return out;
}

describe("rehypeSrcLines", () => {
    it("stamps headings and paragraphs with their lines", () => {
        expect(stamps("# Title\n\nOne para\nstill para\n\n## Sub\n")).toEqual(["h1 1-1", "p 3-4", "h2 6-6"]);
    });

    it("adds the offset of a frontmatter block lifted off the top", () => {
        expect(stamps("# Title\n\nOne para\nstill para\n\n## Sub\n", 4)).toEqual(["h1 5-5", "p 7-8", "h2 10-10"]);
    });

    it("stamps a tight list's items, which render no p", () => {
        expect(stamps("- a\n- b\n")).toEqual(["li 1-1", "li 2-2"]);
    });

    it("stamps a loose list's items and their paragraphs on the same lines", () => {
        expect(stamps("- a\n\n- b\n")).toEqual(["li 1-1", "p 1-1", "li 3-3", "p 3-3"]);
    });

    it("gives an item holding a nested list the nested lines too", () => {
        expect(stamps("- a\n  - b\n  - c\n- d\n")).toEqual(["li 1-3", "li 2-2", "li 3-3", "li 4-4"]);
    });

    it("stamps a table and its rows, not the separator", () => {
        expect(stamps("| x | y |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n")).toEqual([
            "table 1-4",
            "tr 1-1",
            "tr 3-3",
            "tr 4-4",
        ]);
    });

    it("stamps a fenced code block on its pre, fences included", () => {
        expect(stamps("```js\nconst a = 1;\n```\n")).toEqual(["pre 1-3"]);
    });

    it("stamps an image inside its paragraph", () => {
        expect(stamps("See ![alt](img/a.png) here\n")).toEqual(["p 1-1", "img 1-1"]);
    });

    it("leaves raw HTML unstamped", () => {
        expect(stamps("<div>raw</div>\n\ntext\n")).toEqual(["p 3-3"]);
    });

    it("stamps a thematic break", () => {
        expect(stamps("a\n\n---\n\nb\n")).toEqual(["p 1-1", "hr 3-3", "p 5-5"]);
    });

    it("counts CRLF line endings as lines", () => {
        expect(stamps("one\r\n\r\ntwo\r\n")).toEqual(["p 1-1", "p 3-3"]);
    });

    it("is stripped by a schema that does not allow it", () => {
        expect(stamps("# Title\n", 0, defaultSchema)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/app/element/rehype-srclines.test.ts`
Expected: FAIL — `Failed to resolve import "./rehype-srclines"`.

- [ ] **Step 3: Write the plugin**

`frontend/app/element/rehype-srclines.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Stamps each block of rendered markdown with the file lines it came from (data-src-start / data-src-end), so a
// selection or a click in the view maps back to the source (docs/superpowers/specs/2026-10-06-md-comments-design.md).
// It works on the HTML tree, where a fenced code block's position is on its pre, and runs before rehype-raw: raw
// HTML, parsed later, has no stamp and cannot be commented on.

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

const STAMPED = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "hr", "table", "tr", "img"]);

// the hast property names rehype-sanitize must let through
export const SRC_LINE_PROPS = ["dataSrcStart", "dataSrcEnd"];

// offset: the file lines above the text that was parsed (a frontmatter block lifted off the top)
export function rehypeSrcLines(opts: { offset?: number } = {}) {
    const offset = opts.offset ?? 0;
    return (tree: Root) => {
        visit(tree, "element", (node: Element) => {
            const pos = node.position;
            if (pos == null || !STAMPED.has(node.tagName)) {
                return;
            }
            node.properties.dataSrcStart = pos.start.line + offset;
            node.properties.dataSrcEnd = pos.end.line + offset;
        });
    };
}

// a sanitize schema that keeps the stamps on every element
export function withSrcLineAttributes<S extends object>(schema: S): S {
    const attrs = ((schema as { attributes?: Record<string, unknown[]> }).attributes ?? {}) as Record<string, unknown[]>;
    return { ...schema, attributes: { ...attrs, "*": [...(attrs["*"] ?? []), ...SRC_LINE_PROPS] } } as S;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/app/element/rehype-srclines.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Wire the plugin and the block hook into `markdown.tsx`**

Add the import beside the other rehype imports:

```tsx
import { rehypeSrcLines, withSrcLineAttributes } from "@/app/element/rehype-srclines";
```

Below the imports, add the helper every overridden block uses:

```tsx
// the source-line stamp (rehype-srclines.ts) an overridden component must keep on the element it renders
function stampAttrs(props: object): Record<string, string> {
    const p = props as Record<string, unknown>;
    if (p["data-src-start"] == null) {
        return {};
    }
    return { "data-src-start": String(p["data-src-start"]), "data-src-end": String(p["data-src-end"]) };
}
```

`Heading` keeps the stamp:

```tsx
const Heading = ({ props, hnum }: { props: React.HTMLAttributes<HTMLHeadingElement>; hnum: number }) => {
    return (
        <div id={props.id} className={clsx("heading", `is-${hnum}`)} {...stampAttrs(props)}>
            {props.children}
        </div>
    );
};
```

`CodeBlock` takes the stamp for its `pre`:

```tsx
type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
    attrs?: Record<string, string>;
};

const CodeBlock = ({ children, onClickExecute, attrs }: CodeBlockProps) => {
```

and its return opens with `<pre className="codeblock" {...attrs}>` instead of `<pre className="codeblock">`.

`MarkdownImg` names the image's written `src` on the element it renders (the resolved `src` is a stream URL):

```tsx
    if (resolvedSrc != null) {
        return <img {...props} src={resolvedSrc} srcSet={resolvedSrcSet} data-md-src={props.src} />;
    }
```

Add to `MarkdownProps`, after `header`:

```tsx
    // turns on source-line stamps: the number of file lines above `text` (a frontmatter block lifted off the top)
    srcLineOffset?: number;
    // Wave's @@@start content blocks; off where line numbers must match the file, since the transform folds lines
    contentBlocks?: boolean;
    // rendered after every stamped block (inside an li, as its last child): the Agent panel's comment cards
    blockAfter?: (tag: string) => React.ReactNode;
```

Destructure them in `Markdown`'s parameter list (`srcLineOffset, contentBlocks = true, blockAfter,`) and replace

```tsx
    const transformedOutput = transformBlocks(text);
```

with

```tsx
    const transformedOutput = contentBlocks
        ? transformBlocks(text)
        : { content: text, blocks: new Map<string, MarkdownContentBlockType>() };
```

Replace the `markdownComponents` object's entries from `p` through `pre` with these (`a`, `source` and `code` stay as they are; `node` is dropped so it never reaches the DOM):

```tsx
    const after = (tag: string, props: object) =>
        blockAfter != null && (props as Record<string, unknown>)["data-src-start"] != null ? blockAfter(tag) : null;
    const markdownComponents: Partial<Components> = {
        a: (props: React.HTMLAttributes<HTMLAnchorElement>) => (
            <Link props={props} setFocusedHeading={setFocusedHeading} onClickLink={onClickLink} />
        ),
        p: ({ node, ...props }: any) => (
            <>
                <div className="paragraph" {...props} />
                {after("p", props)}
            </>
        ),
        h1: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={1} />
                {after("h1", props)}
            </>
        ),
        h2: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={2} />
                {after("h2", props)}
            </>
        ),
        h3: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={3} />
                {after("h3", props)}
            </>
        ),
        h4: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={4} />
                {after("h4", props)}
            </>
        ),
        h5: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={5} />
                {after("h5", props)}
            </>
        ),
        h6: ({ node, ...props }: any) => (
            <>
                <Heading props={props} hnum={6} />
                {after("h6", props)}
            </>
        ),
        li: ({ node, children, ...props }: any) => (
            <li {...props}>
                {children}
                {after("li", props)}
            </li>
        ),
        hr: ({ node, ...props }: any) => (
            <>
                <hr {...props} />
                {after("hr", props)}
            </>
        ),
        table: ({ node, children, ...props }: any) => (
            <>
                <table {...props}>{children}</table>
                {after("table", props)}
            </>
        ),
        img: ({ node, ...props }: any) => (
            <>
                <MarkdownImg props={props} resolveOpts={resolveOpts} />
                {after("img", props)}
            </>
        ),
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
            <MarkdownSource props={props} resolveOpts={resolveOpts} />
        ),
        code: Code,
        pre: ({ node, ...props }: any) => (
            <>
                <CodeBlock children={props.children} onClickExecute={onClickExecute} attrs={stampAttrs(props)} />
                {after("pre", props)}
            </>
        ),
    };
```

In the `rehypePlugins` block, stamp first and let the stamps through sanitize:

```tsx
        rehypePlugins = [
            ...(srcLineOffset != null ? [[rehypeSrcLines, { offset: srcLineOffset }]] : []),
            rehypeRaw,
            rehypeHighlight,
            () =>
                rehypeSanitize(
                    withSrcLineAttributes({
                        ...defaultSchema,
                        attributes: {
                            ...defaultSchema.attributes,
                            span: [
                                ...(defaultSchema.attributes?.span || []),
                                // Allow all class names starting with `hljs-`.
                                ["className", /^hljs-./],
                                ["srcset"],
                                ["media"],
                                ["type"],
                            ],
                            waveblock: [["blockkey"]],
                        },
                        tagNames: [
                            ...(defaultSchema.tagNames || []),
                            "span",
                            "waveblock",
                            "picture",
                            "source",
                            "mermaidblock",
                        ],
                    })
                ),
            () => rehypeSlug({ prefix: idPrefix }),
        ];
```

(The two commented-out lines about `hljs` class names that sat in the `span` list can go with this edit: they were an alternative never used.)

- [ ] **Step 6: Move `FrontmatterCard` out, and give the Code preview its images**

Create `frontend/app/view/code/frontmattercard.tsx` with the component cut from `codeviewer.tsx` (its comment comes along):

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A skill's or note's frontmatter as a quiet card above the document, so the fields that steer an agent
// (name, description) stay readable without passing for the document's title. Shared by the Code preview and the
// Agent panel's File tab.
export function FrontmatterCard({ fields }: { fields: [string, string][] }) {
    return (
        <dl className="mb-7 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 rounded-md border border-edge-mid bg-surface-raised px-4 py-3 text-[13px] leading-[1.55]">
            {fields.map(([key, value]) => (
                <div key={key} className="contents">
                    <dt className="pt-px font-mono text-[11.5px] text-muted">{key}</dt>
                    <dd className="min-w-0 break-words text-secondary">{value === "" ? "—" : value}</dd>
                </div>
            ))}
        </dl>
    );
}
```

In `codeviewer.tsx`: delete the local `FrontmatterCard` and its comment, add `import { FrontmatterCard } from "./frontmattercard";`, and pass `resolveOpts` to the preview's `<Markdown>` (after `fontSizeOverride={DOC_FONT_SIZE}`), so relative images resolve against the file's directory instead of rendering as `[img:…]`:

```tsx
                        resolveOpts={{
                            connName: "local",
                            baseDir: (project != null ? joinRepoPath(project.path, file.path) : file.path).replace(
                                /[\\/][^\\/]*$/,
                                ""
                            ),
                        }}
```

(`"local"` is what `formatRemoteUri` defaults an undefined connection to; `""` would build `wsh:///…`.)

- [ ] **Step 7: Typecheck and run the frontend tests**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (5-minute timeout)
Expected: exit 0.
Run: `npx vitest run frontend/app/element frontend/app/view/code`
Expected: PASS.
Run: `npx prettier --check frontend/app/element/rehype-srclines.ts frontend/app/element/rehype-srclines.test.ts frontend/app/element/markdown.tsx frontend/app/view/code/frontmattercard.tsx frontend/app/view/code/codeviewer.tsx`
Expected: no warnings on lines you changed. HEAD is not formatter-clean: if prettier flags lines you did not touch, leave them.

- [ ] **Step 8: Check the Code preview by hand**

Run `task dev`, open the Code surface on `docs/orchestrator-guide.md`, Preview mode. Expected: the "New project modal" screenshot renders as an image (not `[img:images/…]`), tables and code blocks look as before, and the frontmatter card still shows on a skill file (e.g. `skills/cockpit-ui/SKILL.md`). Stop the dev app by its PID.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/element/rehype-srclines.ts frontend/app/element/rehype-srclines.test.ts frontend/app/element/markdown.tsx frontend/app/view/code/frontmattercard.tsx frontend/app/view/code/codeviewer.tsx
git commit -m "feat(markdown): stamp rendered blocks with their source lines; images in the Code preview"
```

---

### Task 2: `mdcomments.ts` — anchors, quotes, hosts and the message

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/mdcomments.ts`
- Test: `frontend/app/view/agents/mdcomments.test.ts`

**Interfaces:**
- Consumes: `isUnderRoot`, `toRel` (`@/app/cockpit/openfileroute`); `resolveDocLink` (`@/app/view/code/codelink`); `isMarkdownPath` (`@/app/view/code/codeclassify`); `QUOTE_LINES`, `QUOTE_WIDTH` (`./linecomments`); `QUOTE_MAX` (`./proseanchor`).
- Produces (all exported):
  - `type QuoteKind = "selection" | "source" | "none"`; `type BlockKind = "block" | "tr" | "table" | "img"`
  - `interface MdBlock { kind: BlockKind; start: number; end: number; src?: string }`
  - `interface MdComment { id: string; seq: number; file: string; root: string | null; startLine: number; endLine: number; quoteKind: QuoteKind; quote: string[]; image?: string; note: string }`
  - `blockKind(tagName: string): BlockKind`
  - `bodyOffset(text: string, body: string): number`
  - `selectionQuote(text: string): string[]`; `sourceQuote(fileLines: string[], start: number, end: number): string[]`
  - `spanOf(lines: { start: number; end: number }[]): { start: number; end: number } | null`
  - `blockForLine(blocks: MdBlock[], line: number): number`; `hostIndex(blocks: MdBlock[], c: { endLine: number; image?: string }): number`; `coveredIndexes(blocks: MdBlock[], start: number, end: number): number[]`
  - `lineRef(c: { startLine: number; endLine: number }): string`; `refPath(file: string, root: string | null): string`; `imageName(src: string): string`; `commentRefLabel(c: Pick<MdComment, "file" | "root" | "startLine" | "endLine" | "image">): string`
  - `orderMdComments(comments: MdComment[]): MdComment[]`; `cardNumbers(comments: MdComment[]): Map<string, number>`; `countLine(comments: MdComment[]): string`; `formatMdComments(comments: MdComment[]): string`
  - `panelLink(fileAbs: string, href: string): { abs: string; line: number | null; markdown: boolean } | null`

- [ ] **Step 1: Write the failing test**

`frontend/app/view/agents/mdcomments.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    blockForLine,
    blockKind,
    bodyOffset,
    cardNumbers,
    commentRefLabel,
    countLine,
    coveredIndexes,
    formatMdComments,
    hostIndex,
    orderMdComments,
    panelLink,
    refPath,
    selectionQuote,
    sourceQuote,
    spanOf,
    type MdBlock,
    type MdComment,
} from "./mdcomments";

// docs/guide.md as the DOM lists its stamped blocks (the CDP scenario's fixture): frontmatter on lines 1-3
const B: MdBlock[] = [
    { kind: "block", start: 4, end: 4 }, // 0 h1
    { kind: "block", start: 6, end: 7 }, // 1 p
    { kind: "block", start: 9, end: 9 }, // 2 p
    { kind: "table", start: 11, end: 15 }, // 3
    { kind: "tr", start: 11, end: 11 }, // 4 header row
    { kind: "tr", start: 13, end: 13 }, // 5
    { kind: "tr", start: 14, end: 14 }, // 6
    { kind: "tr", start: 15, end: 15 }, // 7
    { kind: "block", start: 17, end: 17 }, // 8 p holding the image
    { kind: "img", start: 17, end: 17, src: "images/shot.png" }, // 9
    { kind: "block", start: 19, end: 19 }, // 10 p
];

// a loose list: an item with its paragraph and a nested list, then an item with its paragraph
const L: MdBlock[] = [
    { kind: "block", start: 1, end: 3 }, // 0 li
    { kind: "block", start: 1, end: 1 }, // 1 its p
    { kind: "block", start: 2, end: 2 }, // 2 nested li
    { kind: "block", start: 3, end: 3 }, // 3 nested li
    { kind: "block", start: 5, end: 5 }, // 4 li
    { kind: "block", start: 5, end: 5 }, // 5 its p
];

const mk = (o: Partial<MdComment> & Pick<MdComment, "id" | "seq" | "startLine" | "endLine">): MdComment => ({
    file: "/repo/docs/guide.md",
    root: "/repo",
    quoteKind: "none",
    quote: [],
    note: "",
    ...o,
});
const SEL = mk({
    id: "a",
    seq: 1,
    startLine: 9,
    endLine: 9,
    quoteKind: "selection",
    quote: ["the one the link names"],
    note: "Name the link's target.",
});
const RANGE = mk({
    id: "b",
    seq: 2,
    startLine: 13,
    endLine: 15,
    quoteKind: "source",
    quote: ["| Quick | one worker |", "| Goal | a lead |", "| Plan | the engine |"],
    note: "Add a column for cost.",
});
const IMG = mk({ id: "c", seq: 3, startLine: 17, endLine: 17, image: "images/shot.png", note: "Retake this shot." });
const OTHER = mk({
    id: "d",
    seq: 4,
    file: "/repo/docs/other.md",
    startLine: 3,
    endLine: 3,
    quoteKind: "selection",
    quote: ["only paragraph"],
    note: "Say more here.",
});

describe("blockKind", () => {
    it("names rows, tables and images, and calls the rest blocks", () => {
        expect([blockKind("TR"), blockKind("table"), blockKind("IMG"), blockKind("DIV"), blockKind("li")]).toEqual([
            "tr",
            "table",
            "img",
            "block",
            "block",
        ]);
    });
});

describe("bodyOffset", () => {
    it("counts the lines a frontmatter block took off the top", () => {
        expect(bodyOffset("---\ntitle: x\n---\n# H\n", "# H\n")).toBe(3);
    });
    it("bodyOffset counts a CRLF frontmatter block", () => {
        expect(bodyOffset("---\r\ntitle: x\r\n---\r\n# H\r\n", "# H\r\n")).toBe(3);
    });
    it("is 0 without one", () => {
        expect(bodyOffset("# H\n", "# H\n")).toBe(0);
    });
});

describe("quotes", () => {
    it("collapses a selection's whitespace", () => {
        expect(selectionQuote("  the one\n  the link\tnames ")).toEqual(["the one the link names"]);
    });
    it("cuts a selection at 160 characters", () => {
        const q = selectionQuote("x".repeat(200));
        expect(q[0]).toBe("x".repeat(160) + "…");
    });
    it("quotes nothing for an empty selection", () => {
        expect(selectionQuote(" \n ")).toEqual([]);
    });
    it("quotes a range's first 3 non-blank lines and counts the rest", () => {
        const lines = ["a", "", "b", "c", "d", "e"];
        expect(sourceQuote(lines, 1, 6)).toEqual(["a", "b", "c", "… (2 more lines)"]);
        expect(sourceQuote(lines, 1, 5)).toEqual(["a", "b", "c", "… (1 more line)"]);
        expect(sourceQuote(lines, 3, 4)).toEqual(["b", "c"]);
    });
    it("cuts a source line at 120 characters", () => {
        expect(sourceQuote(["y".repeat(130)], 1, 1)).toEqual(["y".repeat(120) + "…"]);
    });
});

describe("spanOf", () => {
    it("runs from the earliest start to the latest end", () => {
        expect(spanOf([{ start: 9, end: 9 }, { start: 6, end: 7 }])).toEqual({ start: 6, end: 9 });
        expect(spanOf([])).toBeNull();
    });
});

describe("blockForLine", () => {
    it("marks the innermost block holding the line", () => {
        expect(blockForLine(B, 9)).toBe(2);
        expect(blockForLine(B, 7)).toBe(1);
        expect(blockForLine(B, 14)).toBe(6);
    });
    it("marks the table on its separator row", () => {
        expect(blockForLine(B, 12)).toBe(3);
    });
    it("marks the next block after a blank line", () => {
        expect(blockForLine(B, 8)).toBe(2);
    });
    it("marks the paragraph, not the image, on an image's line", () => {
        expect(blockForLine(B, 17)).toBe(8);
    });
    it("prefers the later of two blocks on the same lines (the child)", () => {
        expect(blockForLine(L, 5)).toBe(5);
        expect(blockForLine(L, 1)).toBe(1);
    });
    it("is -1 past the last block", () => {
        expect(blockForLine(B, 25)).toBe(-1);
    });
});

describe("hostIndex", () => {
    it("hangs a card after the innermost block holding its last line", () => {
        expect(hostIndex(B, { endLine: 9 })).toBe(2);
        expect(hostIndex(L, { endLine: 3 })).toBe(3);
        expect(hostIndex(L, { endLine: 5 })).toBe(5);
    });
    it("a table row gives way to its table", () => {
        expect(hostIndex(B, { endLine: 15 })).toBe(3);
        expect(hostIndex(B, { endLine: 13 })).toBe(3);
    });
    it("hangs an image comment after its image", () => {
        expect(hostIndex(B, { endLine: 17, image: "images/shot.png" })).toBe(9);
        expect(hostIndex(B, { endLine: 17 })).toBe(8);
    });
    it("falls back to the last block before a line between blocks", () => {
        expect(hostIndex(B, { endLine: 10 })).toBe(2);
        expect(hostIndex(B, { endLine: 1 })).toBe(-1);
    });
});

describe("coveredIndexes", () => {
    it("marks the innermost blocks a range covers whole", () => {
        expect(coveredIndexes(B, 13, 15)).toEqual([5, 6, 7]);
        expect(coveredIndexes(B, 6, 9)).toEqual([1, 2]);
        expect(coveredIndexes(B, 11, 15)).toEqual([4, 5, 6, 7]);
        expect(coveredIndexes(L, 1, 3)).toEqual([1, 2, 3]);
        expect(coveredIndexes(L, 5, 5)).toEqual([5]);
    });
    it("falls back to the block of the first line", () => {
        expect(coveredIndexes(B, 12, 12)).toEqual([3]);
    });
});

describe("paths and labels", () => {
    it("is relative under the root, absolute elsewhere, always with /", () => {
        expect(refPath("/repo/docs/a.md", "/repo")).toBe("docs/a.md");
        expect(refPath("/elsewhere/x.md", "/repo")).toBe("/elsewhere/x.md");
        expect(refPath("C:\\repo\\docs\\a.md", "C:\\repo")).toBe("docs/a.md");
        expect(refPath("C:\\repo\\docs\\a.md", null)).toBe("C:/repo/docs/a.md");
    });
    it("labels a card", () => {
        expect(commentRefLabel(RANGE)).toBe("docs/guide.md:13-15");
        expect(commentRefLabel(IMG)).toBe("docs/guide.md:17 · image shot.png");
    });
});

describe("the message", () => {
    it("orders by file first commented, then line", () => {
        expect(orderMdComments([OTHER, IMG, SEL, RANGE]).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
        expect([...cardNumbers([OTHER, IMG, SEL, RANGE])]).toEqual([
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
        ]);
    });
    it("counts comments and files", () => {
        expect(countLine([SEL, RANGE, IMG, OTHER])).toBe("4 comments on 2 files");
        expect(countLine([SEL])).toBe("1 comment on 1 file");
    });
    it("formats several files", () => {
        expect(formatMdComments([OTHER, IMG, SEL, RANGE])).toBe(
            [
                "Comments on 2 files (4):",
                "",
                "1. docs/guide.md:9",
                "   > the one the link names",
                "   Name the link's target.",
                "",
                "2. docs/guide.md:13-15",
                "   > | Quick | one worker |",
                "   > | Goal | a lead |",
                "   > | Plan | the engine |",
                "   Add a column for cost.",
                "",
                "3. docs/guide.md:17 (image images/shot.png)",
                "   Retake this shot.",
                "",
                "4. docs/other.md:3",
                "   > only paragraph",
                "   Say more here.",
            ].join("\n")
        );
    });
    it("names the file in the header when there is one", () => {
        expect(formatMdComments([SEL])).toBe(
            [
                "Comments on docs/guide.md (1):",
                "",
                "1. docs/guide.md:9",
                "   > the one the link names",
                "   Name the link's target.",
            ].join("\n")
        );
    });
    it("keeps a note's blank lines blank", () => {
        const c = mk({ id: "n", seq: 1, startLine: 4, endLine: 4, note: "one\n\nthree" });
        expect(formatMdComments([c]).split("\n").slice(-3)).toEqual(["   one", "", "   three"]);
    });
    it("is empty without comments", () => {
        expect(formatMdComments([])).toBe("");
    });
});

describe("panelLink", () => {
    it("resolves a relative link against the file's directory", () => {
        expect(panelLink("/repo/docs/a.md", "other.md")).toEqual({
            abs: "/repo/docs/other.md",
            line: null,
            markdown: true,
        });
        expect(panelLink("/repo/docs/a.md", "../pkg/x.go#L12")).toEqual({
            abs: "/repo/pkg/x.go",
            line: 12,
            markdown: false,
        });
        expect(panelLink("C:\\repo\\docs\\a.md", "b.md")).toEqual({
            abs: "C:/repo/docs/b.md",
            line: null,
            markdown: true,
        });
    });
    it("leaves web links, anchors and root-relative links alone", () => {
        expect(panelLink("/repo/docs/a.md", "https://example.com")).toBeNull();
        expect(panelLink("/repo/docs/a.md", "#top")).toBeNull();
        expect(panelLink("/repo/docs/a.md", "/abs.md")).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/mdcomments.test.ts`
Expected: FAIL — `Failed to resolve import "./mdcomments"`.

- [ ] **Step 3: Write `mdcomments.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: comments on a rendered markdown file in the Agent panel's File tab, and the one message that sends them
// (docs/superpowers/specs/2026-10-06-md-comments-design.md). A comment is anchored to file lines. Blocks come from
// the rendered DOM's data-src-start / data-src-end stamps (rehype-srclines.ts), in document order, where a parent
// is listed before its children. No React.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { isMarkdownPath } from "@/app/view/code/codeclassify";
import { resolveDocLink } from "@/app/view/code/codelink";
import { QUOTE_LINES, QUOTE_WIDTH } from "./linecomments";
import { QUOTE_MAX } from "./proseanchor";

export type QuoteKind = "selection" | "source" | "none";
export type BlockKind = "block" | "tr" | "table" | "img";

export interface MdBlock {
    kind: BlockKind;
    start: number;
    end: number;
    src?: string; // an image's src as written in the file
}

export interface MdComment {
    id: string;
    seq: number; // creation order: a tiebreak within a line, and the order files are listed in
    file: string; // absolute, as the panel opened it
    root: string | null; // FileRef.root: what the message's path is relative to
    startLine: number;
    endLine: number; // >= startLine
    quoteKind: QuoteKind;
    quote: string[]; // what the card and the message show after "> ", already cut
    image?: string; // an image comment: its src as written
    note: string;
}

export function blockKind(tagName: string): BlockKind {
    const t = tagName.toLowerCase();
    return t === "tr" || t === "table" || t === "img" ? t : "block";
}

// the file lines a frontmatter split took off the top: the rendered body's line 1 is the file's line 1 + this
export function bodyOffset(text: string, body: string): number {
    return text.slice(0, text.length - body.length).split("\n").length - 1;
}

function cutChars(s: string, max: number): string {
    const chars = Array.from(s);
    return chars.length <= max ? s : chars.slice(0, max).join("").trimEnd() + "…";
}

export function selectionQuote(text: string): string[] {
    const q = text.replace(/\s+/g, " ").trim();
    return q === "" ? [] : [cutChars(q, QUOTE_MAX)];
}

// the range's non-blank source lines, up to QUOTE_LINES, each cut to QUOTE_WIDTH, then how many were left out
export function sourceQuote(fileLines: string[], start: number, end: number): string[] {
    const lines = fileLines.slice(start - 1, end).filter((l) => l.trim() !== "");
    const shown = lines.slice(0, QUOTE_LINES).map((l) => cutChars(l.trimEnd(), QUOTE_WIDTH));
    const more = lines.length - shown.length;
    return more > 0 ? [...shown, `… (${more} more ${more === 1 ? "line" : "lines"})`] : shown;
}

export function spanOf(lines: { start: number; end: number }[]): { start: number; end: number } | null {
    if (lines.length === 0) {
        return null;
    }
    return { start: Math.min(...lines.map((l) => l.start)), end: Math.max(...lines.map((l) => l.end)) };
}

// a holds b: b's lines sit inside a's; of two blocks on the same lines the earlier is the parent
function holds(blocks: MdBlock[], a: number, b: number): boolean {
    const x = blocks[a];
    const y = blocks[b];
    if (a === b || x.start > y.start || y.end > x.end) {
        return false;
    }
    return x.start !== y.start || x.end !== y.end || a < b;
}

// those of idxs that hold none of the others
function innermost(blocks: MdBlock[], idxs: number[]): number[] {
    return idxs.filter((i) => !idxs.some((j) => holds(blocks, i, j)));
}

function holding(blocks: MdBlock[], line: number): number[] {
    const out: number[] = [];
    blocks.forEach((b, i) => {
        if (b.kind !== "img" && b.start <= line && line <= b.end) {
            out.push(i);
        }
    });
    return out;
}

// the block a link's line marks: the innermost one holding it, else the first after it; -1 when there is none
export function blockForLine(blocks: MdBlock[], line: number): number {
    const inner = innermost(blocks, holding(blocks, line));
    if (inner.length > 0) {
        return inner[inner.length - 1];
    }
    return blocks.findIndex((b) => b.kind !== "img" && b.start > line);
}

// the block a comment's card hangs after: an image comment's image; else the innermost block holding its last line,
// where a table row gives way to its table (a card cannot sit between rows); a line between blocks takes the last
// block before it
export function hostIndex(blocks: MdBlock[], c: { endLine: number; image?: string }): number {
    if (c.image != null) {
        const img = blocks.findIndex(
            (b) => b.kind === "img" && b.src === c.image && b.start <= c.endLine && c.endLine <= b.end
        );
        if (img >= 0) {
            return img;
        }
    }
    const inner = innermost(blocks, holding(blocks, c.endLine));
    if (inner.length === 0) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].kind !== "img" && blocks[i].kind !== "tr" && blocks[i].end <= c.endLine) {
                return i;
            }
        }
        return -1;
    }
    const host = inner[inner.length - 1];
    if (blocks[host].kind === "tr") {
        for (let i = host - 1; i >= 0; i--) {
            if (blocks[i].kind === "table" && holds(blocks, i, host)) {
                return i;
            }
        }
    }
    return host;
}

// the blocks a range marks: those it covers whole that hold no other covered block; else the block of its first line
export function coveredIndexes(blocks: MdBlock[], start: number, end: number): number[] {
    const inside: number[] = [];
    blocks.forEach((b, i) => {
        if (b.kind !== "img" && b.start >= start && b.end <= end) {
            inside.push(i);
        }
    });
    const inner = innermost(blocks, inside);
    if (inner.length > 0) {
        return inner;
    }
    const one = blockForLine(blocks, start);
    return one >= 0 ? [one] : [];
}

export function lineRef(c: { startLine: number; endLine: number }): string {
    return c.endLine > c.startLine ? `${c.startLine}-${c.endLine}` : `${c.startLine}`;
}

// the path the agent reads: relative to the panel file's root when the file is under it, else absolute; always "/"
export function refPath(file: string, root: string | null): string {
    if (root != null && isUnderRoot(root, file)) {
        return toRel(root, file);
    }
    return file.replace(/\\/g, "/");
}

export function imageName(src: string): string {
    return src.split(/[\\/]/).pop() ?? src;
}

export function commentRefLabel(c: Pick<MdComment, "file" | "root" | "startLine" | "endLine" | "image">): string {
    const ref = `${refPath(c.file, c.root)}:${lineRef(c)}`;
    return c.image != null ? `${ref} · image ${imageName(c.image)}` : ref;
}

// files in the order they were first commented on; in a file, by start line, then by when each was added
export function orderMdComments(comments: MdComment[]): MdComment[] {
    const first = new Map<string, number>();
    for (const c of comments) {
        first.set(c.file, Math.min(first.get(c.file) ?? Infinity, c.seq));
    }
    return [...comments].sort(
        (a, b) => first.get(a.file) - first.get(b.file) || a.startLine - b.startLine || a.seq - b.seq
    );
}

// a card's number is its item's number in the message
export function cardNumbers(comments: MdComment[]): Map<string, number> {
    return new Map(orderMdComments(comments).map((c, i) => [c.id, i + 1]));
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function countLine(comments: MdComment[]): string {
    const files = new Set(comments.map((c) => c.file)).size;
    return `${plural(comments.length, "comment")} on ${plural(files, "file")}`;
}

// line review's shape (linecomments.ts formatLineComments), so the agent reads one format for a diff and a document
export function formatMdComments(comments: MdComment[]): string {
    if (comments.length === 0) {
        return "";
    }
    const ordered = orderMdComments(comments);
    const files = new Set(ordered.map((c) => c.file));
    const header =
        files.size === 1
            ? `Comments on ${refPath(ordered[0].file, ordered[0].root)} (${ordered.length}):`
            : `Comments on ${files.size} files (${ordered.length}):`;
    const items = ordered.map((c, i) => {
        const image = c.image != null ? ` (image ${c.image})` : "";
        const out = [`${i + 1}. ${refPath(c.file, c.root)}:${lineRef(c)}${image}`];
        for (const q of c.quote) {
            out.push(`   > ${q}`);
        }
        const note = c.note.trimEnd();
        if (note !== "") {
            for (const line of note.split(/\r?\n/)) {
                out.push(line === "" ? "" : `   ${line}`);
            }
        }
        return out.join("\n");
    });
    return [header, "", items.join("\n\n")].join("\n");
}

// a link inside the Preview: a relative path becomes a file beside this one; a web link, an in-page anchor and a
// root-relative path (ambiguous outside a repository) are left to the default handling
export function panelLink(fileAbs: string, href: string): { abs: string; line: number | null; markdown: boolean } | null {
    if (href.startsWith("/")) {
        return null;
    }
    const target = resolveDocLink(fileAbs.replace(/\\/g, "/"), href);
    if (target == null) {
        return null;
    }
    return { abs: target.rel, line: target.line, markdown: isMarkdownPath(target.rel) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run frontend/app/view/agents/mdcomments.test.ts`
Expected: PASS.

- [ ] **Step 5: Format-check and commit**

Run: `npx prettier --check frontend/app/view/agents/mdcomments.ts frontend/app/view/agents/mdcomments.test.ts`
Expected: clean.

```bash
git add frontend/app/view/agents/mdcomments.ts frontend/app/view/agents/mdcomments.test.ts
git commit -m "feat(agents): anchors, hosts and the message for markdown comments"
```

---

### Task 3: `mdcommentstore.ts` — drafts per agent, and the Preview / Source preference

**Depends on:** Task 2

**Files:**
- Create: `frontend/app/view/agents/mdcommentstore.ts`
- Test: `frontend/app/view/agents/mdcommentstore.test.ts`
- Modify: `frontend/app/view/agents/agentrailstore.ts` (add `railMdModeAtom` after `railWideWidthAtom`)

**Interfaces:**
- Consumes: `MdComment`, `QuoteKind` (Task 2); `AgentVM` (`./agentsviewmodel`: `name`, `state`, `blockId`).
- Produces:
  - `interface MdBox { file: string; root: string | null; startLine: number; endLine: number; quoteKind: QuoteKind; quote: string[]; image?: string; anchor?: { start: number; end: number }; text: string; editingId?: string }`
  - `type MdSendResult = { ok: true; kind: "sent"; agent: string; count: number } | { ok: true; kind: "copied" } | { ok: false; agent: string; error: string }`
  - `interface MdCommentState { comments: MdComment[]; box?: MdBox; lastSend?: MdSendResult; seq: number }`
  - `type MdSendBlock = { kind: "asking"; agent: string } | { kind: "draft" } | { kind: "noterm"; agent: string } | null`
  - `mdCommentsAtom`, `mdCommentAtom(agentId)`; `openBox(agentId, box: Omit<MdBox, "text">): "opened" | "kept"`; `setBoxRange(agentId, startLine, endLine, quote)`; `setBoxText(agentId, text)`; `cancelBox(agentId)`; `addComment(agentId): MdComment | null`; `editComment(agentId, id): "opened" | "kept"`; `deleteComment(agentId, id)`; `sendBlock(state, agent: AgentVM | null): MdSendBlock`; `recordSend(agentId, result: MdSendResult)`
  - `railMdModeAtom: PrimitiveAtom<"preview" | "source">` in `agentrailstore.ts`

- [ ] **Step 1: Write the failing test**

`frontend/app/view/agents/mdcommentstore.test.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    addComment,
    cancelBox,
    deleteComment,
    editComment,
    mdCommentAtom,
    mdCommentsAtom,
    openBox,
    recordSend,
    sendBlock,
    setBoxRange,
    setBoxText,
} from "./mdcommentstore";

const A = "agent-1";
const AT = {
    file: "/repo/docs/guide.md",
    root: "/repo",
    startLine: 9,
    endLine: 9,
    quoteKind: "selection" as const,
    quote: ["the one the link names"],
};
const state = () => globalStore.get(mdCommentAtom(A));
const agent = (o: Partial<AgentVM> = {}) => ({ id: A, name: "writer", state: "working", blockId: "blk", ...o }) as AgentVM;
const add = (note: string, at: Partial<typeof AT> = {}) => {
    openBox(A, { ...AT, ...at });
    setBoxText(A, note);
    return addComment(A);
};

beforeEach(() => {
    globalStore.set(mdCommentsAtom, {});
});

describe("the box", () => {
    it("adds the box's comment with the next seq and closes the box", () => {
        expect(openBox(A, AT)).toBe("opened");
        setBoxText(A, "  Name the link's target.  ");
        expect(addComment(A)).toMatchObject({ seq: 1, note: "Name the link's target.", startLine: 9, file: AT.file });
        expect(state().box).toBeUndefined();
        expect(state().seq).toBe(2);
    });

    it("keeps a box that holds text", () => {
        openBox(A, AT);
        setBoxText(A, "half a thought");
        expect(openBox(A, { ...AT, startLine: 1, endLine: 1 })).toBe("kept");
        expect(state().box).toMatchObject({ startLine: 9, text: "half a thought" });
    });

    it("moves an empty box", () => {
        openBox(A, AT);
        expect(openBox(A, { ...AT, startLine: 1, endLine: 1 })).toBe("opened");
        expect(state().box?.startLine).toBe(1);
    });

    it("adds nothing from an empty box", () => {
        openBox(A, AT);
        expect(addComment(A)).toBeNull();
        expect(state().comments).toEqual([]);
    });

    it("extends a range and keeps the text", () => {
        openBox(A, { ...AT, startLine: 13, endLine: 13, quoteKind: "source", anchor: { start: 13, end: 13 } });
        setBoxText(A, "cost");
        setBoxRange(A, 13, 15, ["a", "b", "c"]);
        expect(state().box).toMatchObject({ startLine: 13, endLine: 15, quote: ["a", "b", "c"], text: "cost" });
    });

    it("cancels", () => {
        openBox(A, AT);
        cancelBox(A);
        expect(state().box).toBeUndefined();
    });
});

describe("editing", () => {
    it("replaces the comment in place and keeps its seq", () => {
        const c = add("first");
        expect(editComment(A, c.id)).toBe("opened");
        expect(state().box).toMatchObject({ text: "first", editingId: c.id });
        setBoxText(A, "second");
        addComment(A);
        expect(state().comments).toHaveLength(1);
        expect(state().comments[0]).toMatchObject({ id: c.id, seq: 1, note: "second" });
        expect(state().seq).toBe(2);
    });

    it("deletes", () => {
        const c = add("gone");
        deleteComment(A, c.id);
        expect(state().comments).toEqual([]);
    });

    it("keeps drafts apart per agent", () => {
        add("mine");
        expect(globalStore.get(mdCommentAtom("agent-2")).comments).toEqual([]);
    });
});

describe("sending", () => {
    it("a send clears the comments; a copy and a failure keep them", () => {
        add("one");
        recordSend(A, { ok: true, kind: "copied" });
        expect(state().comments).toHaveLength(1);
        recordSend(A, { ok: false, agent: "writer", error: "gone" });
        expect(state().comments).toHaveLength(1);
        recordSend(A, { ok: true, kind: "sent", agent: "writer", count: 1 });
        expect(state().comments).toEqual([]);
        expect(state().lastSend).toEqual({ ok: true, kind: "sent", agent: "writer", count: 1 });
    });

    it("a new comment clears the last send's line", () => {
        add("one");
        recordSend(A, { ok: true, kind: "copied" });
        add("two", { startLine: 4, endLine: 4 });
        expect(state().lastSend).toBeUndefined();
    });

    it("blocks while the agent asks, while a box holds text, and without a terminal", () => {
        add("one");
        expect(sendBlock(state(), agent())).toBeNull();
        expect(sendBlock(state(), agent({ state: "asking" }))).toEqual({ kind: "asking", agent: "writer" });
        expect(sendBlock(state(), agent({ blockId: "" }))).toEqual({ kind: "noterm", agent: "writer" });
        expect(sendBlock(state(), null)).toEqual({ kind: "noterm", agent: "" });
        openBox(A, AT);
        setBoxText(A, "half");
        expect(sendBlock(state(), agent())).toEqual({ kind: "draft" });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run frontend/app/view/agents/mdcommentstore.test.ts`
Expected: FAIL — `Failed to resolve import "./mdcommentstore"`.

- [ ] **Step 3: Write `mdcommentstore.ts`**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's markdown comment drafts, per agent and across every file its panel opens: the comments, the one
// comment box, and what the last send or copy did (docs/superpowers/specs/2026-10-06-md-comments-design.md). Keyed by
// agent, unlike line review's per-repository drafts: the panel belongs to one agent and only sends to it. In memory
// only: drafts survive switching surfaces, not a restart.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom, type WritableAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentVM } from "./agentsviewmodel";
import type { MdComment, QuoteKind } from "./mdcomments";

export interface MdBox {
    file: string;
    root: string | null;
    startLine: number;
    endLine: number;
    quoteKind: QuoteKind;
    quote: string[];
    image?: string;
    anchor?: { start: number; end: number }; // the block a "+" opened on: Shift+click extends the range from it
    text: string;
    editingId?: string; // the comment the box edits; adding replaces it
}

export type MdSendResult =
    | { ok: true; kind: "sent"; agent: string; count: number }
    | { ok: true; kind: "copied" }
    | { ok: false; agent: string; error: string };

export interface MdCommentState {
    comments: MdComment[];
    box?: MdBox;
    lastSend?: MdSendResult;
    seq: number; // the next comment's seq
}

export type MdSendBlock = { kind: "asking"; agent: string } | { kind: "draft" } | { kind: "noterm"; agent: string } | null;

const EMPTY: MdCommentState = { comments: [], seq: 1 };

// casts because these pick jotai's read-only overload under the non-strict tsconfig
export const mdCommentsAtom = atom<Record<string, MdCommentState>>({}) as PrimitiveAtom<
    Record<string, MdCommentState>
>;

export const mdCommentAtom = atomFamily(
    (agentId: string): WritableAtom<MdCommentState, [MdCommentState], void> =>
        atom(
            (get) => get(mdCommentsAtom)[agentId] ?? EMPTY,
            (get, set, next: MdCommentState) => set(mdCommentsAtom, { ...get(mdCommentsAtom), [agentId]: next })
        )
);

function get(agentId: string): MdCommentState {
    return globalStore.get(mdCommentsAtom)[agentId] ?? EMPTY;
}

function update(agentId: string, fn: (s: MdCommentState) => MdCommentState): void {
    globalStore.set(mdCommentAtom(agentId), fn(get(agentId)));
}

function hasText(box: MdBox | undefined): boolean {
    return box != null && box.text.trim() !== "";
}

function newId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `md${Date.now()}${Math.random()}`;
}

// One box at a time, and a typed note is never lost: a box that holds text stays (the view focuses it); an empty one
// moves.
export function openBox(agentId: string, box: Omit<MdBox, "text">): "opened" | "kept" {
    if (hasText(get(agentId).box)) {
        return "kept";
    }
    update(agentId, (s) => ({ ...s, box: { ...box, text: "" } }));
    return "opened";
}

// Shift+click on another block's +: the open box takes the wider range and its quote, and keeps its text
export function setBoxRange(agentId: string, startLine: number, endLine: number, quote: string[]): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: { ...s.box, startLine, endLine, quote } }));
}

export function setBoxText(agentId: string, text: string): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: { ...s.box, text } }));
}

export function cancelBox(agentId: string): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: undefined }));
}

// Adds the box's comment, or replaces the one it edits (keeping its seq, so its number holds). A new comment clears
// the last send's result line.
export function addComment(agentId: string): MdComment | null {
    const s = get(agentId);
    const box = s.box;
    if (box == null || !hasText(box)) {
        return null;
    }
    const old = box.editingId != null ? s.comments.find((c) => c.id === box.editingId) : undefined;
    const comment: MdComment = {
        id: old?.id ?? newId(),
        seq: old?.seq ?? s.seq,
        file: box.file,
        root: box.root,
        startLine: box.startLine,
        endLine: box.endLine,
        quoteKind: box.quoteKind,
        quote: box.quote,
        ...(box.image != null ? { image: box.image } : {}),
        note: box.text.trim(),
    };
    update(agentId, (st) => ({
        comments: old != null ? st.comments.map((c) => (c.id === comment.id ? comment : c)) : [...st.comments, comment],
        seq: old != null ? st.seq : st.seq + 1,
    }));
    return comment;
}

// Opens the box on the comment's text; a box that holds other text stays, as with openBox.
export function editComment(agentId: string, id: string): "opened" | "kept" {
    const s = get(agentId);
    const c = s.comments.find((x) => x.id === id);
    if (c == null || hasText(s.box)) {
        return "kept";
    }
    const { file, root, startLine, endLine, quoteKind, quote, image, note } = c;
    update(agentId, (st) => ({
        ...st,
        box: {
            file,
            root,
            startLine,
            endLine,
            quoteKind,
            quote,
            ...(image != null ? { image } : {}),
            text: note,
            editingId: id,
        },
    }));
    return "opened";
}

export function deleteComment(agentId: string, id: string): void {
    update(agentId, (s) => ({ ...s, comments: s.comments.filter((c) => c.id !== id) }));
}

// Why Send is disabled: no terminal to paste into (an ended worker), an open ask that would take the paste as its
// answer, or a note typed but not added.
export function sendBlock(state: MdCommentState, agent: AgentVM | null): MdSendBlock {
    if (agent == null || !agent.blockId) {
        return { kind: "noterm", agent: agent?.name ?? "" };
    }
    if (agent.state === "asking") {
        return { kind: "asking", agent: agent.name };
    }
    if (hasText(state.box)) {
        return { kind: "draft" };
    }
    return null;
}

// a send clears the comments; a copy or a failure keeps them for the next try
export function recordSend(agentId: string, result: MdSendResult): void {
    update(agentId, (s) => ({
        ...s,
        comments: result.ok && result.kind === "sent" ? [] : s.comments,
        lastSend: result,
    }));
}
```

- [ ] **Step 4: Add the Preview / Source preference**

In `frontend/app/view/agents/agentrailstore.ts`, after `railWideWidthAtom`:

```ts
// how the File tab shows a markdown file: rendered (Preview, where comments are made) or Monaco (Source); one choice
// for every agent
export const railMdModeAtom = atomWithStorage<"preview" | "source">("agent.rail.mdMode", "preview", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<"preview" | "source">;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run frontend/app/view/agents/mdcommentstore.test.ts frontend/app/view/agents/mdcomments.test.ts`
Expected: PASS.

- [ ] **Step 6: Format-check and commit**

Run: `npx prettier --check frontend/app/view/agents/mdcommentstore.ts frontend/app/view/agents/mdcommentstore.test.ts frontend/app/view/agents/agentrailstore.ts`
Expected: clean.

```bash
git add frontend/app/view/agents/mdcommentstore.ts frontend/app/view/agents/mdcommentstore.test.ts frontend/app/view/agents/agentrailstore.ts
git commit -m "feat(agents): per-agent drafts for markdown comments, and the Preview/Source preference"
```

---

### Task 4: The Preview in the File tab, with cards and the three gestures

**Depends on:** Task 1, Task 2, Task 3

**Files:**
- Create: `frontend/app/view/agents/mdcommentcards.tsx`
- Create: `frontend/app/view/agents/mddoc.tsx`
- Modify: `frontend/app/view/agents/filetab.tsx` (props, header toggle, body)
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx:650` (pass the agent)

**Interfaces:**
- Consumes: `Markdown` props from Task 1 (`srcLineOffset`, `contentBlocks`, `blockAfter`, `resolveOpts`, `header`, `onClickLink`) and the DOM attributes `data-src-start`, `data-src-end`, `data-md-src`; `FrontmatterCard` (Task 1); everything Task 2 and Task 3 produce; `openFileInPanel`, `openRefInCode`, `railMdModeAtom` (`./agentrailstore`); `FileRef` (`./agentrailtabs`).
- Produces: `MdDoc({ model, agent, fileRef, text })`; `CardSlot({ inside })`, `MdDocContext`, `MdDocCtx`; `FileTab({ model, agent, file })` — note `agent: AgentVM` replaces `agentId`. DOM hooks the scenario uses: `[data-md-doc]` (the focusable Preview body), `[data-md-mark="hit"|"target"]` and `[data-md-bar]` (each with `data-lines="s-e"`), `[data-md-plus]`, `[data-md-image-comment]`, `[data-md-comment]` (the floating selection button), `[data-md-slot]`, `[data-md-card="<id>"]`, `[data-md-box]`, `[data-md-mode="preview"|"source"]`.

- [ ] **Step 1: Write the cards, the box and the slot**

`frontend/app/view/agents/mdcommentcards.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cards and the comment box that hang off a block of the File tab's markdown Preview
// (docs/superpowers/specs/2026-10-06-md-comments-design.md). Markdown renders a CardSlot after every stamped block (as
// an li's last child); the slot finds the block it follows and shows what MdDoc hosts there, through MdDocContext, so
// a card change never re-renders the document.

import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { Pencil, X } from "lucide-react";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { commentRefLabel, type MdComment, type QuoteKind } from "./mdcomments";
import { addComment, cancelBox, deleteComment, editComment, setBoxText, type MdBox } from "./mdcommentstore";

export interface MdDocCtx {
    agentId: string;
    hosts: Map<Element, MdComment[]>; // block element → the comments whose cards hang after it, in order
    box: MdBox | undefined; // the open box, when it belongs to this file
    boxHost: Element | null;
    numbers: Map<string, number>; // comment id → its number in the message
    focusBox: () => void; // a box that holds text was kept: put the caret in it
    done: () => void; // a box closed: focus goes back to the document
}

export const MdDocContext = createContext<MdDocCtx | null>(null);

const META = "text-[10.5px] text-muted";
const CHIP =
    "inline-flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold leading-none text-background";
const ICON_BTN = "flex cursor-pointer border-0 bg-transparent p-[2px] text-muted hover:text-primary";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

function Quote({ kind, lines }: { kind: QuoteKind; lines: string[] }) {
    if (kind === "none" || lines.length === 0) {
        return null;
    }
    if (kind === "selection") {
        return <div className="text-[11px] leading-[1.45] text-muted">“{lines[0]}”</div>;
    }
    return (
        <div className="flex min-w-0 flex-col font-mono text-[11px] leading-[1.45] text-muted">
            {lines.map((l, i) => (
                <span key={i} className="truncate whitespace-pre">
                    {l}
                </span>
            ))}
        </div>
    );
}

function MdCommentCard({ comment, n, ctx }: { comment: MdComment; n: number; ctx: MdDocCtx }) {
    return (
        <div
            data-md-card={comment.id}
            className="flex flex-col gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[10px] leading-[1.5]"
        >
            <div className="flex items-center gap-2">
                <span className={CHIP}>{n}</span>
                <span className={cn(META, "min-w-0 flex-1 truncate")}>{commentRefLabel(comment)}</span>
                <button
                    type="button"
                    aria-label={`Edit comment ${n}`}
                    onClick={() => {
                        if (editComment(ctx.agentId, comment.id) === "kept") {
                            ctx.focusBox();
                        }
                    }}
                    className={ICON_BTN}
                >
                    <Pencil size={13} strokeWidth={2} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label={`Delete comment ${n}`}
                    onClick={() => deleteComment(ctx.agentId, comment.id)}
                    className={ICON_BTN}
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            </div>
            <Quote kind={comment.quoteKind} lines={comment.quote} />
            <div className="whitespace-pre-wrap text-[13px] text-primary">{comment.note}</div>
        </div>
    );
}

function MdCommentBox({ box, ctx }: { box: MdBox; ctx: MdDocCtx }) {
    const blank = box.text.trim() === "";
    const add = () => {
        if (addComment(ctx.agentId) != null) {
            ctx.done();
        }
    };
    const cancel = () => {
        cancelBox(ctx.agentId);
        ctx.done();
    };
    return (
        <div
            data-md-box
            className="flex flex-col gap-2 rounded-[8px] border border-accent bg-surface-raised px-3 py-[10px] leading-[1.5]"
        >
            <span className={META}>{commentRefLabel(box)}</span>
            <Quote kind={box.quoteKind} lines={box.quote} />
            <textarea
                rows={3}
                autoFocus
                value={box.text}
                placeholder="Leave a comment"
                aria-label="Your comment"
                onChange={(e) => setBoxText(ctx.agentId, e.target.value)}
                // the box owns its keys: Esc must not reach the File tab, which closes the file on it
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        add();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        cancel();
                    }
                }}
                className="resize-none rounded-[7px] border border-edge-mid bg-background px-[9px] py-[7px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent"
            />
            <div className="flex justify-end gap-2">
                <button type="button" title="Cancel (Esc)" onClick={cancel} className={SECONDARY_BTN}>
                    Cancel
                </button>
                <button type="button" disabled={blank} onClick={add} className={ACCENT_BTN}>
                    Add comment
                    <span className={KBD}>{formatChordString("Ctrl:Enter")}</span>
                </button>
            </div>
        </div>
    );
}

// After a stamped block: the cards MdDoc hosts on that block, and the open box when it hangs there. The block is the
// slot's parent for a list item (the slot is the item's last child), else the element before it; read after every
// render, because an image appears only once its src resolves.
export function CardSlot({ inside }: { inside: boolean }) {
    const ctx = useContext(MdDocContext);
    const ref = useRef<HTMLDivElement>(null);
    const [block, setBlock] = useState<Element | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        const next = el == null ? null : inside ? el.parentElement : el.previousElementSibling;
        setBlock((prev) => (prev === next ? prev : next));
    });
    const comments = ctx != null && block != null ? (ctx.hosts.get(block) ?? []) : [];
    const box = ctx?.box != null && block != null && ctx.boxHost === block ? ctx.box : undefined;
    const shown = ctx != null && (comments.length > 0 || box != null);
    return (
        <div ref={ref} data-md-slot className={shown ? "my-2.5 flex flex-col gap-2.5" : "hidden"}>
            {shown
                ? comments.map((c) =>
                      box?.editingId === c.id ? (
                          <MdCommentBox key={c.id} box={box} ctx={ctx} />
                      ) : (
                          <MdCommentCard key={c.id} comment={c} n={ctx.numbers.get(c.id) ?? 0} ctx={ctx} />
                      )
                  )
                : null}
            {shown && box != null && box.editingId == null ? <MdCommentBox box={box} ctx={ctx} /> : null}
        </div>
    );
}
```

- [ ] **Step 2: Write the Preview body**

`frontend/app/view/agents/mddoc.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's Preview of a markdown file and the gestures that comment on it
// (docs/superpowers/specs/2026-10-06-md-comments-design.md): a selection's floating Comment (or c), the gutter + with
// Shift+click for a range, and an image's Comment. It reads the rendered blocks' line stamps (rehype-srclines.ts),
// measures them for the marks and buttons, and hosts cards through MdDocContext; which lines a gesture means and
// which block a card hangs after is mdcomments.ts.

import { Markdown } from "@/app/element/markdown";
import { splitFrontmatter } from "@/app/view/code/codefrontmatter";
import { FrontmatterCard } from "@/app/view/code/frontmattercard";
import { formatChordString } from "@/util/keysym";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { MessageSquarePlus, Plus } from "lucide-react";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import { openFileInPanel, openRefInCode } from "./agentrailstore";
import type { FileRef } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { CardSlot, MdDocContext, type MdDocCtx } from "./mdcommentcards";
import {
    blockForLine,
    blockKind,
    bodyOffset,
    cardNumbers,
    coveredIndexes,
    hostIndex,
    orderMdComments,
    panelLink,
    selectionQuote,
    sourceQuote,
    spanOf,
    type MdBlock,
    type MdComment,
} from "./mdcomments";
import { mdCommentAtom, openBox, setBoxRange } from "./mdcommentstore";

// the text column's left inset: room for the gutter +
const GUTTER = 36;
const FLOAT_BTN =
    "absolute z-10 flex cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border-0 bg-accent px-[10px] py-[5px] text-[12.5px] font-semibold leading-[1.2] text-background shadow-popover-sm hover:bg-accenthover";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

interface Overlay {
    top: number;
    height: number;
    lines: string;
}

function lineOf(el: Element): { start: number; end: number } {
    return { start: Number(el.getAttribute("data-src-start")), end: Number(el.getAttribute("data-src-end")) };
}

function toBlock(el: Element): MdBlock {
    const src = el.getAttribute("data-md-src");
    return { kind: blockKind(el.tagName), ...lineOf(el), ...(src != null ? { src } : {}) };
}

export function MdDoc({
    model,
    agent,
    fileRef,
    text,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    fileRef: FileRef;
    text: string;
}) {
    const agentId = agent.id;
    const state = useAtomValue(mdCommentAtom(agentId));
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const doc = useMemo(() => splitFrontmatter(text), [text]);
    const offset = useMemo(() => bodyOffset(text, doc.body), [text, doc]);
    const fileLines = useMemo(() => text.split(/\r?\n/), [text]);
    // memoized: Markdown is memo'd, and a new header element would re-render the whole document
    const header = useMemo(() => (doc.fields.length > 0 ? <FrontmatterCard fields={doc.fields} /> : null), [doc]);
    const resolveOpts = useMemo(
        () => ({ connName: "local", baseDir: fileRef.abs.replace(/[\\/][^\\/]*$/, "") }),
        [fileRef.abs]
    );
    const [els, setEls] = useState<Element[]>([]);
    const blocks = useMemo(() => els.map(toBlock), [els]);
    const [hover, setHover] = useState<{ index: number; top: number } | null>(null);
    const [imgHover, setImgHover] = useState<{ index: number; top: number; right: number } | null>(null);
    const [sel, setSel] = useState<{ start: number; end: number; text: string; top: number; left: number } | null>(
        null
    );
    const [geo, setGeo] = useState<{ marks: (Overlay & { kind: string })[]; bars: Overlay[] }>({
        marks: [],
        bars: [],
    });

    const fileComments = useMemo(
        () => orderMdComments(state.comments.filter((c) => c.file === fileRef.abs)),
        [state.comments, fileRef.abs]
    );
    const box = state.box?.file === fileRef.abs ? state.box : undefined;
    const line = fileRef.line;
    const hitIndex = line != null ? blockForLine(blocks, line) : -1;

    // the stamped blocks in document order; again whenever the rendered DOM changes (an image resolves late), but not
    // for our own cards and buttons
    useLayoutEffect(() => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        let raf = 0;
        const collect = () => {
            raf = 0;
            const next = [...root.querySelectorAll("[data-src-start]")];
            setEls((prev) => (prev.length === next.length && prev.every((e, i) => e === next[i]) ? prev : next));
        };
        collect();
        const mo = new MutationObserver((records) => {
            if (records.every((r) => (r.target as Element).closest?.("[data-md-slot],[data-md-overlay]") != null)) {
                return;
            }
            if (raf === 0) {
                raf = requestAnimationFrame(collect);
            }
        });
        mo.observe(root, { childList: true, subtree: true });
        return () => {
            mo.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [text]);

    // opened at a line: centre its block once per file and line, not on every later DOM change
    const scrolledTo = useRef("");
    useLayoutEffect(() => {
        const key = `${fileRef.abs}:${line ?? ""}`;
        if (line == null || hitIndex < 0 || scrolledTo.current === key) {
            return;
        }
        els[hitIndex]?.scrollIntoView({ block: "center" });
        scrolledTo.current = key;
    }, [hitIndex, els, fileRef.abs, line]);

    // the marks (the :line block, the open box's blocks) and each comment's gutter bar, in content coordinates
    useLayoutEffect(() => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        const measure = () => {
            const base = root.getBoundingClientRect();
            const span = (idxs: number[], lines: string): Overlay | null => {
                const rects = idxs.filter((i) => i >= 0 && els[i] != null).map((i) => els[i].getBoundingClientRect());
                if (rects.length === 0) {
                    return null;
                }
                const top = Math.min(...rects.map((r) => r.top)) - base.top;
                const bottom = Math.max(...rects.map((r) => r.bottom)) - base.top;
                return { top, height: bottom - top, lines };
            };
            const covered = (c: { startLine: number; endLine: number; image?: string }) =>
                c.image != null ? [hostIndex(blocks, c)] : coveredIndexes(blocks, c.startLine, c.endLine);
            const marks: (Overlay & { kind: string })[] = [];
            const hit = hitIndex >= 0 ? span([hitIndex], `${blocks[hitIndex].start}-${blocks[hitIndex].end}`) : null;
            if (hit != null) {
                marks.push({ ...hit, kind: "hit" });
            }
            const target = box != null ? span(covered(box), `${box.startLine}-${box.endLine}`) : null;
            if (target != null) {
                marks.push({ ...target, kind: "target" });
            }
            const bars = fileComments
                .map((c) => span(covered(c), `${c.startLine}-${c.endLine}`))
                .filter((o): o is Overlay => o != null);
            setGeo({ marks, bars });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(root);
        return () => ro.disconnect();
    }, [els, blocks, hitIndex, box, fileComments]);

    // the selection, reduced to the innermost stamped blocks it touches, and where its Comment button floats. A
    // selection inside a card or the box (copying your own note) is not one.
    useEffect(() => {
        const update = () => {
            const s = window.getSelection();
            const root = contentRef.current;
            if (s == null || s.isCollapsed || s.rangeCount === 0 || root == null) {
                setSel(null);
                return;
            }
            const range = s.getRangeAt(0);
            const common = range.commonAncestorContainer;
            const commonEl = common instanceof Element ? common : common.parentElement;
            if (!range.intersectsNode(root) || commonEl?.closest("[data-md-slot],[data-md-overlay]") != null) {
                setSel(null);
                return;
            }
            const hits = els.filter((el) => range.intersectsNode(el));
            const inner = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
            const span = spanOf(inner.map(lineOf));
            if (span == null) {
                setSel(null);
                return;
            }
            const r = range.getBoundingClientRect();
            const base = root.getBoundingClientRect();
            setSel({
                ...span,
                text: s.toString(),
                top: r.bottom - base.top + 6,
                left: Math.min(Math.max(r.right - base.left - 120, 8), base.width - 150),
            });
        };
        document.addEventListener("selectionchange", update);
        return () => document.removeEventListener("selectionchange", update);
    }, [els]);

    const focusBox = useCallback(() => {
        contentRef.current?.querySelector<HTMLTextAreaElement>("[data-md-box] textarea")?.focus();
    }, []);
    const done = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);
    const opened = (r: "opened" | "kept") => {
        if (r === "kept") {
            focusBox();
        }
    };
    const at = { file: fileRef.abs, root: fileRef.root };

    const commentSelection = () => {
        if (sel == null) {
            return;
        }
        opened(
            openBox(agentId, {
                ...at,
                startLine: sel.start,
                endLine: sel.end,
                quoteKind: "selection",
                quote: selectionQuote(sel.text),
            })
        );
        window.getSelection()?.removeAllRanges();
        setSel(null);
    };

    const plus = (index: number, shift: boolean) => {
        const b = blocks[index];
        if (b == null) {
            return;
        }
        const cur = state.box;
        if (shift && cur?.anchor != null && cur.file === fileRef.abs) {
            const start = Math.min(cur.anchor.start, b.start);
            const end = Math.max(cur.anchor.end, b.end);
            setBoxRange(agentId, start, end, sourceQuote(fileLines, start, end));
            return;
        }
        opened(
            openBox(agentId, {
                ...at,
                startLine: b.start,
                endLine: b.end,
                quoteKind: "source",
                quote: sourceQuote(fileLines, b.start, b.end),
                anchor: { start: b.start, end: b.end },
            })
        );
    };

    const commentImage = (index: number) => {
        const b = blocks[index];
        if (b?.src == null) {
            return;
        }
        opened(
            openBox(agentId, { ...at, startLine: b.start, endLine: b.end, quoteKind: "none", quote: [], image: b.src })
        );
    };

    // the block under the pointer's row, probed at the text column so the gutter + stays reachable; between blocks
    // or over a button the last one stays
    const onMove = (e: MouseEvent<HTMLDivElement>) => {
        const root = contentRef.current;
        if (root == null) {
            return;
        }
        const base = root.getBoundingClientRect();
        const probe = document.elementFromPoint(Math.max(e.clientX, base.left + GUTTER + 2), e.clientY);
        if (probe == null || probe.closest("[data-md-slot],[data-md-overlay]") != null) {
            return;
        }
        const el = probe.closest("[data-src-start]");
        const index = el != null && root.contains(el) ? els.indexOf(el) : -1;
        if (index < 0) {
            return;
        }
        const r = el.getBoundingClientRect();
        if (el.tagName === "IMG") {
            setImgHover({ index, top: r.top - base.top + 10, right: base.right - r.right + 10 });
            setHover(null);
        } else {
            setHover({ index, top: r.top - base.top + 2 });
            setImgHover(null);
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (
            e.key === "c" &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.altKey &&
            sel != null &&
            !(e.target instanceof HTMLTextAreaElement)
        ) {
            e.preventDefault();
            e.stopPropagation();
            commentSelection();
        }
    };

    const onClickLink = useCallback(
        (href: string) => {
            const t = panelLink(fileRef.abs, href);
            if (t == null) {
                return false;
            }
            const ref: FileRef = { abs: t.abs, root: fileRef.root, ...(t.line != null ? { line: t.line } : {}) };
            if (t.markdown) {
                openFileInPanel(model, agentId, ref);
            } else {
                fireAndForget(() => openRefInCode(model, ref));
            }
            return true;
        },
        [fileRef.abs, fileRef.root, model, agentId]
    );

    const blockAfter = useCallback((tag: string) => <CardSlot inside={tag === "li"} />, []);

    const hosts = useMemo(() => {
        const m = new Map<Element, MdComment[]>();
        for (const c of fileComments) {
            const el = els[hostIndex(blocks, c)];
            if (el != null) {
                m.set(el, [...(m.get(el) ?? []), c]);
            }
        }
        return m;
    }, [fileComments, blocks, els]);
    const boxHost = box != null ? (els[hostIndex(blocks, box)] ?? null) : null;
    const numbers = useMemo(() => cardNumbers(state.comments), [state.comments]);
    const ctx = useMemo<MdDocCtx>(
        () => ({ agentId, hosts, box, boxHost, numbers, focusBox, done }),
        [agentId, hosts, box, boxHost, numbers, focusBox, done]
    );

    return (
        <div
            ref={scrollRef}
            tabIndex={-1}
            data-md-doc
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 overflow-y-auto bg-background outline-none focus:ring-1 focus:ring-inset focus:ring-accent/40"
        >
            <div
                ref={contentRef}
                onMouseMove={onMove}
                onMouseLeave={() => {
                    setHover(null);
                    setImgHover(null);
                }}
                className="relative pb-10 pr-[22px] pt-[18px]"
                style={{ paddingLeft: GUTTER }}
            >
                <div data-md-overlay aria-hidden className="pointer-events-none absolute inset-0">
                    {geo.marks.map((m) => (
                        <div
                            key={m.kind}
                            data-md-mark={m.kind}
                            data-lines={m.lines}
                            className="absolute left-5 right-3 rounded-r-[4px] bg-surface-hover"
                            style={{ top: m.top - 4, height: m.height + 8 }}
                        >
                            <div className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
                        </div>
                    ))}
                    {geo.bars.map((b, i) => (
                        <div
                            key={i}
                            data-md-bar
                            data-lines={b.lines}
                            className="absolute left-5 w-0.5 rounded-[1px] bg-edge-strong"
                            style={{ top: b.top + 2, height: Math.max(b.height - 4, 4) }}
                        />
                    ))}
                </div>
                {/* positioned, and after the overlay, so the text paints over the marks' fill */}
                <div className="relative">
                    <MdDocContext.Provider value={ctx}>
                        <Markdown
                            text={doc.body}
                            header={header}
                            scrollable={false}
                            className="markdown-doc"
                            contentClassName="p-0"
                            fontSizeOverride={14}
                            resolveOpts={resolveOpts}
                            srcLineOffset={offset}
                            contentBlocks={false}
                            blockAfter={blockAfter}
                            onClickLink={onClickLink}
                        />
                    </MdDocContext.Provider>
                </div>
                {hover != null && sel == null ? (
                    <button
                        type="button"
                        data-md-overlay
                        data-md-plus
                        title="Comment on this block (Shift+click another for a range)"
                        aria-label="Comment on this block"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => plus(hover.index, e.shiftKey)}
                        className="absolute left-2 flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[5px] border-0 bg-accent p-0 text-background hover:bg-accenthover"
                        style={{ top: hover.top }}
                    >
                        <Plus size={12} strokeWidth={2.6} aria-hidden />
                    </button>
                ) : null}
                {imgHover != null && sel == null ? (
                    <button
                        type="button"
                        data-md-overlay
                        data-md-image-comment
                        title="Comment on this image"
                        onClick={() => commentImage(imgHover.index)}
                        className={FLOAT_BTN}
                        style={{ top: imgHover.top, right: imgHover.right }}
                    >
                        <MessageSquarePlus size={13} strokeWidth={2.2} aria-hidden />
                        Comment
                    </button>
                ) : null}
                {sel != null ? (
                    <button
                        type="button"
                        data-md-overlay
                        data-md-comment
                        title={`Comment on the selection (${formatChordString("c")})`}
                        // keep the selection: a press would otherwise collapse it before the click
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={commentSelection}
                        className={FLOAT_BTN}
                        style={{ top: sel.top, left: sel.left }}
                    >
                        <MessageSquarePlus size={13} strokeWidth={2.2} aria-hidden />
                        Comment
                        <span className={KBD}>{formatChordString("c")}</span>
                    </button>
                ) : null}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Give the File tab the agent, the toggle and the Preview**

Replace `frontend/app/view/agents/filetab.tsx`'s imports, component signature and the parts named below (the loading/error branches, the Monaco branch and its options, and the header's Back/Forward/path/Open-in-Code markup stay as they are):

Header comment and imports:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's File tab: one file, read-only, at a line (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md).
// A markdown file renders as a document that takes comments (docs/superpowers/specs/2026-10-06-md-comments-design.md);
// Source is the Monaco view. Editing is the Code surface's job, one click away.

import { SkeletonLine } from "@/app/element/skeleton";
import { isMarkdownPath } from "@/app/view/code/codeclassify";
import { cn, fireAndForget } from "@/util/util";
import { useAtom } from "jotai";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { closeRailFile, openRefInCode, railFileBack, railFileForward, railMdModeAtom } from "./agentrailstore";
import { fileLabel, type FileHistory } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { formatSize, readPanelFile, type PanelFile } from "./filetabload";
import { MdDoc } from "./mddoc";
```

Signature and the new state:

```tsx
export function FileTab({ model, agent, file }: { model: AgentsViewModel; agent: AgentVM; file: FileHistory }) {
    const agentId = agent.id;
    const ref = file.current;
    const [state, setState] = useState<PanelFile>({ kind: "loading" });
    const [mdMode, setMdMode] = useAtom(railMdModeAtom);
```

After `if (ref == null) { return null; }`:

```tsx
    const markdown = isMarkdownPath(ref.abs);
    const preview = markdown && mdMode === "preview";
```

The text branch picks the Preview for markdown:

```tsx
    } else if (state.kind === "text" && preview) {
        body = <MdDoc model={model} agent={agent} fileRef={ref} text={state.text} />;
    } else if (state.kind === "text") {
```

(the existing Monaco branch follows unchanged).

In the header, between the path `<span>` and the "Open in Code" button:

```tsx
                {markdown ? (
                    <div
                        role="group"
                        aria-label="View"
                        className="flex flex-none items-center gap-0.5 rounded-[6px] border border-border p-[2px]"
                    >
                        {(["preview", "source"] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                data-md-mode={m}
                                aria-pressed={mdMode === m}
                                onClick={() => setMdMode(m)}
                                className={cn(
                                    "cursor-pointer rounded-[4px] border-0 px-2 py-[2px] text-[11px] capitalize",
                                    mdMode === m
                                        ? "bg-accent/10 text-accent-soft"
                                        : "bg-transparent text-muted hover:text-primary"
                                )}
                            >
                                {m}
                            </button>
                        ))}
                    </div>
                ) : null}
```

The body container takes the Preview's ground and lays it out as a column:

```tsx
            <div className={cn("flex min-h-0 flex-1 flex-col", preview ? "bg-background" : "bg-surface-code")}>
                {body}
            </div>
```

Every remaining `agentId` use in the file (`closeRailFile(agentId)`, `railFileBack(agentId)`, `railFileForward(agentId)`) keeps working through the new `agentId` constant.

In `frontend/app/view/agents/agentdetailsrail.tsx`, the mount becomes:

```tsx
                    <FileTab model={model} agent={agent} file={panel.file} />
```

- [ ] **Step 4: Typecheck**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (5-minute timeout)
Expected: exit 0.

- [ ] **Step 5: Run the frontend tests**

Run: `npx vitest run frontend/app/view/agents frontend/app/element`
Expected: PASS.

- [ ] **Step 6: Check it in the dev app**

Run `task dev`. In an agent's terminal print a path such as `docs/orchestrator-guide.md:10` and Ctrl/Cmd+click it (or click such a path in a transcript). Expected, matching the mockup boards Main, Select, Compose, Cards, Range and Image:
- the File tab opens in **Preview**; the paragraph at line 10 is centred with a grey fill and an accent bar; tables, code blocks and the "New project modal" image render;
- `Preview | Source` switches to Monaco at line 10 and back; the choice survives a reload;
- selecting "A reviewer checks the plan before any worker starts" shows the floating **Comment c**; `c` opens the box under the paragraph with the reference `docs/orchestrator-guide.md:10-14` and the quote; Ctrl/Cmd+Enter adds a card numbered 1; the paragraph keeps a grey gutter bar;
- selecting text inside that card, or inside an open box's textarea, shows no Comment button;
- hovering "Everything else in this guide…" shows `+` in the gutter; `+` on the first table row then Shift+click on the third opens one box after the table, `:20-22`, quoting the three source rows;
- hovering the image shows **Comment** in its corner; it opens a box after the image with `· image 01-new-project.png` and no quote;
- with a box holding text, `+` elsewhere does not move it: the box's textarea takes focus; Esc in the textarea cancels it without closing the file;
- a link to another `.md` opens in the panel (Back returns, cards still there).

Stop the dev app by its PID.

- [ ] **Step 7: Format-check and commit**

Run: `npx prettier --check frontend/app/view/agents/mdcommentcards.tsx frontend/app/view/agents/mddoc.tsx frontend/app/view/agents/filetab.tsx frontend/app/view/agents/agentdetailsrail.tsx`
Expected: clean for the lines you changed.

```bash
git add frontend/app/view/agents/mdcommentcards.tsx frontend/app/view/agents/mddoc.tsx frontend/app/view/agents/filetab.tsx frontend/app/view/agents/agentdetailsrail.tsx
git commit -m "feat(agents): the File tab renders markdown and takes comments on text, blocks and images"
```

---

### Task 5: The tray, Ctrl+Enter, and the docs

**Depends on:** Task 4

**Files:**
- Create: `frontend/app/view/agents/mdcommenttray.tsx`
- Modify: `frontend/app/view/agents/filetab.tsx` (tray, Ctrl+Enter)
- Modify: `docs/keyboard-shortcuts.md` (the Agent table, ~line 128)
- Modify: `docs/deferred.md` (a new entry before "## Code and Diff in the nav rail")

**Interfaces:**
- Consumes: `mdCommentAtom`, `sendBlock`, `recordSend`, `MdSendResult`, `MdSendBlock` (Task 3); `countLine`, `formatMdComments` (Task 2); `sendLineComments(agent, text): Promise<{ ok: true } | { ok: false; error: string }>` (`./linereviewsend`, with its DEV sink `window.__lineReviewSink`).
- Produces: `MdCommentTray({ agent })`; DOM hooks `[data-md-tray]`, `[data-md-send]`, `[data-md-copy]`, `[data-md-tray-line]`.

- [ ] **Step 1: Write the tray**

`frontend/app/view/agents/mdcommenttray.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The File tab's comment tray (docs/superpowers/specs/2026-10-06-md-comments-design.md): how many comments wait
// across the agent's files, Copy, and the one Send that pastes them into this agent's terminal as one message. The
// File tab's Ctrl+Enter presses data-md-send, so every check lives here.

import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { sendLineComments } from "./linereviewsend";
import { countLine, formatMdComments } from "./mdcomments";
import { mdCommentAtom, recordSend, sendBlock, type MdSendBlock, type MdSendResult } from "./mdcommentstore";

const TRAY = "flex flex-none border-t border-border bg-surface px-[18px] text-[12.5px]";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[6px] text-[12.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const KBD = "rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px]";

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// the second line: why Send is disabled, else what the last copy or failure did
function statusLine(block: MdSendBlock, last: MdSendResult | undefined): ReactNode {
    const line = (tone: string, body: ReactNode, title?: string) => (
        <span data-md-tray-line title={title} className={cn("flex min-w-0 items-center gap-[6px] text-[12px]", tone)}>
            {body}
        </span>
    );
    if (block?.kind === "asking") {
        return line(
            "text-muted",
            <>
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-asking" aria-hidden />
                {block.agent} is waiting on a question — answer it first
            </>
        );
    }
    if (block?.kind === "draft") {
        return line("text-muted", "Add or cancel the open comment first");
    }
    if (block?.kind === "noterm") {
        return line("text-muted", `${block.agent} has no terminal — copy the comments instead`);
    }
    if (last?.ok === false) {
        const text = last.agent ? `Couldn't reach ${last.agent} — comments kept` : "Couldn't copy — comments kept";
        return line("text-error", text, last.error);
    }
    if (last?.ok === true && last.kind === "copied") {
        return line(
            "text-success",
            <>
                <Check size={13} strokeWidth={2.2} className="flex-none" aria-hidden />
                Copied. The comments stay until you send or delete them.
            </>
        );
    }
    return null;
}

export function MdCommentTray({ agent }: { agent: AgentVM }) {
    const state = useAtomValue(mdCommentAtom(agent.id));
    const [busy, setBusy] = useState(false);
    const n = state.comments.length;
    const last = state.lastSend;

    if (n === 0) {
        if (last?.ok === true && last.kind === "sent") {
            return (
                <div data-md-tray className={cn(TRAY, "items-center gap-2 py-[13px] text-success")}>
                    <Check size={14} strokeWidth={2.2} aria-hidden />
                    <span className="font-semibold">Sent {plural(last.count, "comment")}</span>
                    <span className="min-w-0 truncate text-muted">to {last.agent}</span>
                </div>
            );
        }
        return (
            <div data-md-tray className={cn(TRAY, "flex-wrap items-center gap-[6px] py-[11px] text-[12px] text-muted")}>
                Select text and press
                <kbd className="rounded-[4px] border border-edge-mid px-[5px] font-mono text-[10.5px] text-secondary">c</kbd>
                , or hover a block and click
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] bg-accent text-background">
                    <Plus size={10} strokeWidth={3} aria-hidden />
                </span>
                , to comment.
            </div>
        );
    }

    const block = sendBlock(state, agent);
    const run = (work: () => Promise<MdSendResult>) => {
        setBusy(true);
        fireAndForget(async () => {
            try {
                recordSend(agent.id, await work());
            } finally {
                setBusy(false);
            }
        });
    };
    const send = () =>
        run(async () => {
            const r = await sendLineComments(agent, formatMdComments(state.comments));
            if (r.ok === false) {
                console.error(`md comments: couldn't send to ${agent.name}:`, r.error);
                return { ok: false, agent: agent.name, error: r.error };
            }
            return { ok: true, kind: "sent", agent: agent.name, count: n };
        });
    const copy = () =>
        run(async () => {
            try {
                await navigator.clipboard.writeText(formatMdComments(state.comments));
                return { ok: true, kind: "copied" };
            } catch (e) {
                console.error("md comments: couldn't copy:", e);
                return { ok: false, agent: "", error: String((e as Error)?.message ?? e) };
            }
        });
    const chord = formatChordString("Ctrl:Enter");

    return (
        <div data-md-tray className={cn(TRAY, "flex-col gap-[6px] py-[10px]")}>
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-hi">{countLine(state.comments)}</span>
                <button type="button" data-md-copy disabled={busy} onClick={copy} className={SECONDARY_BTN}>
                    Copy
                </button>
                <button
                    type="button"
                    data-md-send
                    disabled={block != null || busy}
                    title={`Send to ${agent.name} (${chord})`}
                    onClick={send}
                    className={ACCENT_BTN}
                >
                    Send {plural(n, "comment")}
                    <span className={KBD}>{chord}</span>
                </button>
            </div>
            {statusLine(block, last)}
        </div>
    );
}
```

- [ ] **Step 2: Put the tray in the File tab, and give Ctrl+Enter to Send**

In `filetab.tsx`, import the tray and the drafts:

```tsx
import { useAtom, useAtomValue } from "jotai";
import { mdCommentAtom } from "./mdcommentstore";
import { MdCommentTray } from "./mdcommenttray";
```

After the `mdMode` line:

```tsx
    const drafts = useAtomValue(mdCommentAtom(agentId));
```

Replace `onKeyDown` with:

```tsx
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closeRailFile(agentId);
            return;
        }
        // Ctrl+Enter sends from anywhere in the tab but a comment box, which takes it to add the comment
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !(e.target instanceof HTMLTextAreaElement)) {
            const send = e.currentTarget.querySelector<HTMLButtonElement>("[data-md-send]");
            if (send != null && !send.disabled) {
                e.preventDefault();
                e.stopPropagation();
                send.click();
            }
        }
    };
```

After the body container, as the root's last child — shown for a markdown file, and for any file while this agent has drafts or a send result, so Back to a code file does not hide pending comments:

```tsx
            {markdown || drafts.comments.length > 0 || drafts.lastSend != null ? <MdCommentTray agent={agent} /> : null}
```

- [ ] **Step 3: Document the keys**

In `docs/keyboard-shortcuts.md`, replace the row

```markdown
| `Esc` | In the panel's File tab, close the file |
```

with

```markdown
| `Esc` | In the panel's File tab: cancel the comment being written, else close the file |
| `c` | In the File tab's Preview of a markdown file, comment on the selected text |
| `Ctrl`+`Enter` | In the File tab: add the comment being written; outside a comment box, send the comments to the agent |
```

- [ ] **Step 4: Record the re-measure**

In `docs/deferred.md`, insert before `## Code and Diff in the nav rail (deferred 2026-10-06)`:

```markdown
## Markdown comments in the Agent panel — re-measure their use (deferred 2026-10-06)

- **Deferred:** deciding whether the File tab's markdown comments stay
  (`docs/superpowers/specs/2026-10-06-md-comments-design.md`).
- **Why:** the 2026-10-01 brief counted the earlier send-to-agent features: 2 uses of Code's "Send to agent" since
  August, 0 of canvas send-marks. These sit where the reading happens, but that is a bet.
- **Revive when** around 2026-10-20: count the sends (agent transcripts holding a `Comments on … (N):` message).
  Near zero: remove the comment gestures and the tray, and keep the Preview.

```

- [ ] **Step 5: Typecheck and test**

Run: `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (5-minute timeout)
Expected: exit 0.
Run: `npx vitest run frontend/app/view/agents`
Expected: PASS.

- [ ] **Step 6: Check it in the dev app**

Run `task dev` with an agent whose terminal is a shell you can watch (start a plain `claude` agent, or any agent). Open a `.md` in its panel and add two comments on it and one on a second `.md`. Expected, matching boards Source and TrayStates:
- with no comments the tray shows the hint line; with three, `3 comments on 2 files`, Copy and **Send 3 comments ⌃↵**;
- Copy puts the exact `formatMdComments` text on the clipboard and shows "Copied. The comments stay until you send or delete them."; the cards stay;
- Ctrl/Cmd+Enter with focus in the document (not in a box) sends: the message lands in the agent's terminal as one paste and is submitted; the tray reads "✓ Sent 3 comments to <agent>" and the cards are gone;
- with a box holding text, Send is disabled with "Add or cancel the open comment first";
- in Source view the tray is still there; Back to a non-markdown file keeps the tray while comments wait.

Stop the dev app by its PID.

- [ ] **Step 7: Format-check and commit**

Run: `npx prettier --check frontend/app/view/agents/mdcommenttray.tsx frontend/app/view/agents/filetab.tsx docs/keyboard-shortcuts.md docs/deferred.md`
Expected: clean for the lines you changed.

```bash
git add frontend/app/view/agents/mdcommenttray.tsx frontend/app/view/agents/filetab.tsx docs/keyboard-shortcuts.md docs/deferred.md
git commit -m "feat(agents): send markdown comments to the panel's agent as one message"
```

---

### Task 6: The `md-comments` CDP scenario

**Depends on:** Task 5

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (new constants, fixture and scenario after `agentRailTabs`; register in `SCENARIOS`)

**Interfaces:**
- Consumes: the DOM hooks from Task 4 and Task 5; scenario helpers already in `scenarios.mjs`: `polishWaitFor(h, expr, ms)`, `ahReload(h)`, `waitForProjectInConfig(h, name)`, `UI_ROUTE`, `TREE_RAIL_FIXTURE`, `RAIL_VISIBLE_KEY`, `RAIL_SECTIONS_KEY`, `railTabsKey(h, key, code, keyCode, modifiers)`, `railTabsMouse(h, type, x, y, extra)`, `railTabsNap(ms)`.
- Produces: scenario `md-comments` (`task verify:ui -- md-comments`, Windows only).

Do not run prettier on this file.

- [ ] **Step 1: Add the fixture and helpers**

After the `agentRailTabs` object in `scripts/cdp/scenarios.mjs`:

```js
// md-comments (docs/superpowers/specs/2026-10-06-md-comments-design.md): an agent whose transcript names
// docs/guide.md:9; guide.md has frontmatter (lines 1-3), a table (11-15) and an image (17) and links docs/other.md.
const MDC_AGENT = "fx-md-comments";
const MDC_BLOCK = "fx-blk-md-comments";
const MDC_PROJECT = "verify-md-comments";
const MDC_KEYS = [RAIL_VISIBLE_KEY, RAIL_SECTIONS_KEY, "agent.rail.tab", "agent.rail.wideWidth", "agent.rail.mdMode"];
const MDC_ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const MDC_CARD = `document.querySelector('[data-cockpit-surface] [data-agent-id="${MDC_AGENT}"]')`;
const MDC_DOC = `${MDC_ASIDE}?.querySelector("[data-md-doc]")`;
const MDC_GUIDE = [
    "---",
    "title: Guide",
    "---",
    "# Guide",
    "",
    "First paragraph line one,",
    "still the first paragraph.",
    "",
    "Second paragraph, the one the link names.",
    "",
    "| Flow | Use |",
    "|---|---|",
    "| Quick | one worker |",
    "| Goal | a lead |",
    "| Plan | the engine |",
    "",
    "![Shot](images/shot.png)",
    "",
    "See [the other doc](other.md).",
    "",
].join("\n");
const MDC_OTHER = "# Other\n\nThe other doc's only paragraph.\n";
// a 1x1 PNG
const MDC_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
);
const MDC_EXPECTED = [
    "Comments on 2 files (4):",
    "",
    "1. docs/guide.md:9",
    "   > the one the link names",
    "   Name the link's target.",
    "",
    "2. docs/guide.md:13-15",
    "   > | Quick | one worker |",
    "   > | Goal | a lead |",
    "   > | Plan | the engine |",
    "   Add a column for cost.",
    "",
    "3. docs/guide.md:17 (image images/shot.png)",
    "   Retake this shot.",
    "",
    "4. docs/other.md:3",
    "   > only paragraph",
    "   Say more here.",
].join("\n");

function mdcFixture(base) {
    const repo = join(base, "repo");
    mkdirSync(join(repo, "docs", "images"), { recursive: true });
    writeFileSync(join(repo, "docs", "guide.md"), MDC_GUIDE);
    writeFileSync(join(repo, "docs", "other.md"), MDC_OTHER);
    writeFileSync(join(repo, "docs", "images", "shot.png"), MDC_PNG);
    const transcript = join(base, "agent.jsonl");
    const rec = (o) => JSON.stringify({ cwd: repo, ...o }) + "\n";
    writeFileSync(
        transcript,
        rec({ type: "user", message: { role: "user", content: [{ type: "text", text: "tidy the guide" }] } }) +
            rec({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Read `docs/guide.md:9` next." }] } })
    );
    return { repo, transcript };
}

function mdcRoster(ctx, state) {
    writeFileSync(
        TREE_RAIL_FIXTURE,
        JSON.stringify(
            [
                {
                    id: MDC_AGENT,
                    name: "md writer",
                    project: MDC_PROJECT,
                    task: "tidy the guide",
                    state,
                    agent: "claude",
                    model: "opus",
                    activeMs: 60_000,
                    blockId: MDC_BLOCK,
                    transcriptPath: ctx.transcript,
                },
            ],
            null,
            2
        )
    );
}

// clicks the Cockpit card's inline `docs/guide.md:9` (its data-path-link is the path alone), which opens the File tab
// at line 9
async function mdcOpenGuide(h) {
    await h.goto("cockpit");
    const found = await polishWaitFor(
        h,
        `[...(${MDC_CARD}?.querySelectorAll("[data-path-link]") ?? [])].some((b) => b.dataset.pathLink.endsWith("guide.md"))`,
        15000
    );
    if (!found) return false;
    await h.ev(`[...${MDC_CARD}.querySelectorAll("[data-path-link]")].find((b) => b.dataset.pathLink.endsWith("guide.md")).click()`);
    return polishWaitFor(h, `!!${MDC_DOC}?.querySelector('[data-md-mark="hit"]')`, 10000);
}

// selects `words` inside the first stamped block whose text holds them, as a real drag would
async function mdcSelect(h, words) {
    return h.ev(`(() => {
        const doc = ${MDC_DOC};
        const el = [...(doc?.querySelectorAll("[data-src-start]") ?? [])].reverse().find((e) => e.textContent.includes(${JSON.stringify(words)}));
        if (!el) return false;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf(${JSON.stringify(words)});
            if (i >= 0) {
                doc.focus();
                const r = document.createRange();
                r.setStart(n, i);
                r.setEnd(n, i + ${words.length});
                const s = getSelection();
                s.removeAllRanges();
                s.addRange(r);
                return true;
            }
        }
        return false;
    })()`);
}

// types a note into the open box and adds it with Ctrl+Enter
async function mdcNote(h, note) {
    await h.ev(`${MDC_DOC}?.querySelector("[data-md-box] textarea")?.focus()`);
    await h.cdp("Input.insertText", { text: note });
    await railTabsKey(h, "Enter", "Enter", 13, 2);
}

// the centre of the stamped block (as a selector over it) in viewport coordinates
async function mdcCenter(h, expr) {
    return h.ev(`(() => { const r = (${expr})?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
}

// hovers the stamped block found by `expr` and clicks the gutter + (Shift with shift)
async function mdcPlus(h, expr, shift) {
    const c = await mdcCenter(h, expr);
    if (c == null) return false;
    await railTabsMouse(h, "mouseMoved", c.x, c.y, { button: "none" });
    await railTabsNap(200);
    const p = await mdcCenter(h, `${MDC_DOC}?.querySelector("[data-md-plus]")`);
    if (p == null) return false;
    await railTabsMouse(h, "mouseMoved", p.x, p.y, { button: "none" });
    const modifiers = shift ? 8 : 0;
    await railTabsMouse(h, "mousePressed", p.x, p.y, { modifiers });
    await railTabsMouse(h, "mouseReleased", p.x, p.y, { modifiers });
    await railTabsNap(300);
    return true;
}

const mdcRow = (text) => `[...${MDC_DOC}.querySelectorAll("tr")].find((r) => r.textContent.includes(${JSON.stringify(text)}))`;
const mdcTray = `(${MDC_ASIDE}?.querySelector("[data-md-tray]")?.innerText ?? "")`;
```

- [ ] **Step 2: Add the scenario**

```js
const mdComments = {
    name: "md-comments",
    surface: "agent",
    async arrange(h) {
        const base = mkdtempSync(join(tmpdir(), "verify-md-comments-"));
        const ctx = { base, prevFixture: existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null, prevKeys: {} };
        try {
            for (const k of MDC_KEYS) {
                ctx.prevKeys[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
            }
            Object.assign(ctx, mdcFixture(base));
            await h.rpc("createproject", { name: MDC_PROJECT, path: ctx.repo });
            ctx.project = MDC_PROJECT;
            await waitForProjectInConfig(h, MDC_PROJECT);
            mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
            mdcRoster(ctx, "working");
            ctx.wroteFixture = true;
            await h.ev(`(() => {
                localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true");
                for (const k of ${JSON.stringify(["agent.rail.tab", "agent.rail.wideWidth", "agent.rail.mdMode"])}) localStorage.removeItem(k);
            })()`);
            if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
            await h.goto("agent");
            ctx.inRoster = await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${MDC_AGENT}"]')`, 15000);
            await h.rpc("uireveal", { address: `agent:${MDC_AGENT}` }, UI_ROUTE);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        if (ctx.arrangeError != null || ctx.inRoster !== true) {
            rec("0. the fixture agent is in the roster", false, ctx.arrangeError ?? "not in the roster");
            return steps;
        }

        // 1. opened at a line
        const opened = await mdcOpenGuide(h);
        const hit = await h.ev(`${MDC_DOC}?.querySelector('[data-md-mark="hit"]')?.dataset.lines ?? null`);
        const img = await polishWaitFor(h, `!!${MDC_DOC}?.querySelector('img[data-md-src="images/shot.png"]')`, 8000);
        const front = await h.ev(`(${MDC_DOC}?.innerText ?? "").includes("Guide") && !(${MDC_DOC}?.innerText ?? "").includes("title: Guide\\n---")`);
        await h.shot("cdp-shots/md-comments-open.png");
        rec("1. docs/guide.md:9 opens in Preview with line 9's block marked and the image rendered", opened && hit === "9-9" && img && front, JSON.stringify({ opened, hit, img, front }));

        // 2. a selection, c, a note
        await mdcSelect(h, "the one the link names");
        const floated = await polishWaitFor(h, `!!${MDC_DOC}?.querySelector("[data-md-comment]")`, 5000);
        await h.shot("cdp-shots/md-comments-select.png");
        await railTabsKey(h, "c", "KeyC", 67);
        const boxRef = await h.ev(`${MDC_DOC}?.querySelector("[data-md-box]")?.innerText ?? ""`);
        await h.shot("cdp-shots/md-comments-compose.png");
        await mdcNote(h, "Name the link's target.");
        const card1 = await polishWaitFor(h, `${MDC_DOC}?.querySelectorAll("[data-md-card]").length === 1`, 5000);
        const bar1 = await h.ev(`[...(${MDC_DOC}?.querySelectorAll("[data-md-bar]") ?? [])].map((b) => b.dataset.lines)`);
        rec("2. a selection floats Comment; c opens the box at :9; Ctrl+Enter adds card 1 with a gutter bar", floated && boxRef.includes("docs/guide.md:9") && card1 && JSON.stringify(bar1) === JSON.stringify(["9-9"]), JSON.stringify({ floated, boxRef, card1, bar1 }));

        // 3. a selection inside the card is not a comment target
        await h.ev(`(() => { const n = ${MDC_DOC}.querySelector("[data-md-card] .whitespace-pre-wrap").firstChild; const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 4); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`);
        await railTabsNap(300);
        const noFloat = await h.ev(`!${MDC_DOC}?.querySelector("[data-md-comment]")`);
        await h.ev(`getSelection().removeAllRanges()`);
        rec("3. selecting a card's own text floats no Comment button", noFloat, JSON.stringify({ noFloat }));

        // 4. + on the first body row, Shift+click on the last: one box after the table
        const plus1 = await mdcPlus(h, mdcRow("Quick"), false);
        const plus2 = await mdcPlus(h, mdcRow("Plan"), true);
        const box4 = await h.ev(`${MDC_DOC}?.querySelector("[data-md-box]")?.innerText ?? ""`);
        const afterTable = await h.ev(`${MDC_DOC}?.querySelector("[data-md-box]")?.closest("[data-md-slot]")?.previousElementSibling?.tagName ?? ""`);
        const target = await h.ev(`${MDC_DOC}?.querySelector('[data-md-mark="target"]')?.dataset.lines ?? null`);
        await h.shot("cdp-shots/md-comments-range.png");
        await mdcNote(h, "Add a column for cost.");
        rec("4. + then Shift+click covers rows 13-15, the box hangs after the table and quotes the rows", plus1 && plus2 && box4.includes("docs/guide.md:13-15") && box4.includes("| Plan | the engine |") && afterTable === "TABLE" && target === "13-15", JSON.stringify({ plus1, plus2, box4, afterTable, target }));

        // 5. the image
        const ic = await mdcCenter(h, `${MDC_DOC}?.querySelector('img[data-md-src="images/shot.png"]')`);
        await railTabsMouse(h, "mouseMoved", ic.x, ic.y, { button: "none" });
        const imgBtn = await polishWaitFor(h, `!!${MDC_DOC}?.querySelector("[data-md-image-comment]")`, 5000);
        await h.shot("cdp-shots/md-comments-image.png");
        await h.ev(`${MDC_DOC}.querySelector("[data-md-image-comment]").click()`);
        const box5 = await h.ev(`${MDC_DOC}?.querySelector("[data-md-box]")?.innerText ?? ""`);
        await mdcNote(h, "Retake this shot.");
        rec("5. an image's Comment opens a box labelled with the image and no quote", imgBtn && box5.includes("docs/guide.md:17 · image shot.png"), JSON.stringify({ imgBtn, box5 }));

        // 6. a link to other.md opens in the panel; a comment there; Back keeps guide.md's cards
        await h.ev(`[...${MDC_DOC}.querySelectorAll("a")].find((a) => a.textContent === "the other doc").click()`);
        const other = await polishWaitFor(h, `(${MDC_DOC}?.innerText ?? "").includes("The other doc's only paragraph.")`, 8000);
        await mdcSelect(h, "only paragraph");
        await polishWaitFor(h, `!!${MDC_DOC}?.querySelector("[data-md-comment]")`, 5000);
        await railTabsKey(h, "c", "KeyC", 67);
        await mdcNote(h, "Say more here.");
        await h.ev(`${MDC_ASIDE}?.querySelector('[data-rail-file] button[aria-label="Back"]')?.click()`);
        const back = await polishWaitFor(h, `${MDC_DOC}?.querySelectorAll("[data-md-card]").length === 3`, 8000);
        const tray6 = await h.ev(mdcTray);
        await h.shot("cdp-shots/md-comments-cards.png");
        rec("6. other.md opens in the panel, takes a comment, and Back returns to guide.md's 3 cards; the tray counts 4 on 2 files", other && back && tray6.includes("4 comments on 2 files"), JSON.stringify({ other, back, tray6 }));

        // 7. Send through the DEV sink: the exact message, then the sent line
        await h.ev(`(() => { window.__mdSent = []; window.__lineReviewSink = (t) => { window.__mdSent.push(t); }; return true; })()`);
        await h.ev(`${MDC_DOC}?.focus()`);
        await railTabsKey(h, "Enter", "Enter", 13, 2);
        const sent = await polishWaitFor(h, `(window.__mdSent ?? []).length === 1`, 5000);
        const text = await h.ev(`(window.__mdSent ?? [])[0] ?? ""`);
        const tray7 = await h.ev(mdcTray);
        await h.shot("cdp-shots/md-comments-sent.png");
        rec("7. Ctrl+Enter sends the exact message once and the tray reads Sent 4 comments", sent && text === MDC_EXPECTED && tray7.includes("Sent 4 comments"), JSON.stringify({ sent, text, tray7 }));

        // 8. an asking agent: Send disabled with its reason, Copy still enabled
        mdcRoster(ctx, "asking");
        await ahReload(h);
        await h.goto("agent");
        await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${MDC_AGENT}"]')`, 15000);
        await mdcOpenGuide(h);
        await mdcSelect(h, "the one the link names");
        await polishWaitFor(h, `!!${MDC_DOC}?.querySelector("[data-md-comment]")`, 5000);
        await railTabsKey(h, "c", "KeyC", 67);
        await mdcNote(h, "Again.");
        const disabled = await h.ev(`!!${MDC_ASIDE}?.querySelector("[data-md-send]")?.disabled`);
        const copyOk = await h.ev(`${MDC_ASIDE}?.querySelector("[data-md-copy]")?.disabled === false`);
        const tray8 = await h.ev(mdcTray);
        await h.shot("cdp-shots/md-comments-asking.png");
        rec("8. while the agent asks, Send is disabled with the reason and Copy stays enabled", disabled && copyOk && tray8.includes("is waiting on a question"), JSON.stringify({ disabled, copyOk, tray8 }));

        // 9. Source keeps the tray
        await h.ev(`${MDC_ASIDE}?.querySelector('[data-md-mode="source"]')?.click()`);
        const monaco = await polishWaitFor(h, `!!${MDC_ASIDE}?.querySelector("[data-rail-file] .monaco-editor")`, 8000);
        const tray9 = await h.ev(mdcTray);
        await h.shot("cdp-shots/md-comments-source.png");
        await h.ev(`${MDC_ASIDE}?.querySelector('[data-md-mode="preview"]')?.click()`);
        rec("9. Source shows Monaco and keeps the tray", monaco && tray9.includes("1 comment on 1 file"), JSON.stringify({ monaco, tray9 }));

        // 10. the Code preview renders the image too
        await h.ev(`[...(${MDC_ASIDE}?.querySelectorAll("[data-rail-file] button") ?? [])].find((b) => b.textContent.includes("Open in Code"))?.click()`);
        // the Agent surface stays mounted while hidden, so the panel's own image must not count
        const codeImg = await polishWaitFor(h, `[...document.querySelectorAll('img[data-md-src="images/shot.png"]')].some((i) => !i.closest("aside") && i.checkVisibility())`, 10000);
        const surface10 = await h.activeSurfaceLabel();
        await h.shot("cdp-shots/md-comments-code-preview.png");
        rec("10. the Code surface's preview of guide.md renders the image", surface10 === "Code" && codeImg, JSON.stringify({ surface10, codeImg }));
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`md-comments teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        await step("clear the DEV hooks", () => h.ev(`(delete window.__lineReviewSink, delete window.__mdSent, true)`));
        if (ctx.project) {
            await step("remove the project", async () => {
                await h.rpc("deleteproject", { name: ctx.project });
                const norm = (p) => (p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
                const channels = (await h.rpc("getchannels", null))?.channels ?? [];
                for (const c of channels.filter((c) => norm(c.projectpath) === norm(ctx.repo))) {
                    await h.rpc("deletechannel", { channelid: c.oid });
                }
            });
        }
        if (ctx.wroteFixture) {
            await step("restore the fixture roster", () =>
                ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
            );
        }
        await step("restore the keys", async () => {
            for (const [k, v] of Object.entries(ctx.prevKeys ?? {})) {
                await h.ev(v == null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
            }
        });
        await step("reload onto the restored roster", () => ahReload(h));
        await step("remove the temp dir", () => rmSync(ctx.base, { recursive: true, force: true }));
    },
};
```

Then add `mdComments,` to the `SCENARIOS` array right after `agentRailTabs,`.

- [ ] **Step 3: Check the file parses**

Run: `node --check scripts/cdp/scenarios.mjs`
Expected: no output, exit 0.
Run: `node -e "import('./scripts/cdp/scenarios.mjs').then((m) => console.log(m.SCENARIOS.some((s) => s.name === 'md-comments')))"`
Expected: `true`.

- [ ] **Step 4: Run it (Windows dev machine only)**

On Windows with `task dev` running: `task verify:ui -- md-comments`
Expected: steps 1–10 PASS; `cdp-shots/index.html` shows open, select, compose, range, image, cards, sent, asking, source and code-preview shots that match the mockup boards. On macOS skip this step and say so in the task report.

- [ ] **Step 5: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): md-comments scenario for the File tab's markdown comments"
```
