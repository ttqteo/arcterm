# Agent rail tabs (Overview, File), file path links, and a regrouped nav rail — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md`. Read it in full before your task.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** The Agent surface's right rail becomes a tab strip (Overview, and File while a file is open). A file path in
a terminal, a transcript, a Cockpit card or the palette opens beside the agent. The nav rail groups Cockpit, Jarvis,
Agent and Usage above the tools (Code, Diff, Radar).

**Architecture:**
- Pure models with a `.test.ts` beside each:
  - `pathlinks.ts`: tokenizer and resolution.
  - `agentrailtabs.ts`: tab selection, file history and widths.
  - `pathlinkroute.ts`: which panel a link goes to.
- A small store (`agentrailstore.ts`) holds the per-agent panel state.
- Thin React wiring on top:
  - `CollapsibleRail` gains optional `width`, `tabs`, `body`, `stripTabs` and `edge` props.
  - `AgentDetailsRail` passes them.
  - `filetab.tsx` renders a read-only Monaco editor.
  - The terminal gets an xterm link provider.
  - Transcripts get a `PathLinkContext`.

**Tech Stack:** React 19, jotai (`atomWithStorage`), TypeScript, vitest, Tailwind 4, xterm.js `registerLinkProvider`,
Monaco (`MonacoCodeEditor`), react-markdown components, CDP scenarios (`scripts/cdp/scenarios.mjs`). No Go changes, so
no `task generate`.

## How to work this plan

- **Work on the current branch, `feat/agent-sessions-merge`.** That is where the user wants this work, and other
  sessions commit there too.
  - Stage exact paths only (`git add <file>…`), never `git add -A` or `.`. Other sessions leave uncommitted files in
    this checkout (`claude/arc-mod/…`, `pkg/claudequota/…`).
  - Each task ends with a commit step.
- **No builds while developing** (the machine lags).
  - Do not run `task build:*`, `cargo …`, the whole vitest suite, or `scripts/cdp/final-verify.mjs`.
  - Test one file at a time: `npx vitest run <file>`.
  - UI checks are CDP scenarios against the already-running `task dev` app (`task verify:ui -- <scenario>`). That is
    why this plan has no `**Verify:**`, `**Check:**` or `**Final:**` line: `Final` cold-builds its own dev app.
  - One `task check:ts` (about 2 minutes) is wanted at the very end. Ask the user first.
- **Other work lands here while this runs.**
  - Line review (`docs/superpowers/specs/2026-10-06-line-review-design.md`) edits the Diff surface.
  - The sessions work edits transcripts (`compacttranscript.tsx`).
  - So edits here are anchored by symbol or quoted text, not line numbers. Re-read a file right before editing it.
- **Formatting.**
  - Many files are not prettier-clean at HEAD, so never `prettier --write` a whole existing file. Format only what you
    add, by hand, in the file's style.
  - Run `npx prettier --check` only on files this plan creates.
  - Never run prettier on `scripts/*.mjs`.
  - Lint touched files: `npx eslint <paths>`.
- **The dev app's fixture.** `public/cockpit-fixtures/active.json` replaces the live roster. The user keeps one there.
  Back it up before any CDP run and restore it after (Task 9 and Task 10 say how).
- **Not in this plan:**
  - The **Review** tab. It reuses line review's `reviewlist.tsx` and tray, so it is a follow-up plan once line review
    has landed. Until then Files changed keeps opening the Diff surface.
  - The **Terminal** tab (phase 2 in the spec).

Tasks 1, 2 and 3 are independent. Task 4 needs 3. Task 5 needs 3 and 4. Task 6 needs 2 and 3. Tasks 7 and 8 need 6.
Task 9 needs all of 1–8. Task 10 is last.

---

### Task 1: Regroup the nav rail and the surface order

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/agents.tsx` (`SURFACE_ORDER` and its comment)
- Modify: `frontend/app/view/agents/navrail.tsx`
- Modify: `frontend/app/view/agents/surfaceorder.test.ts`, `frontend/app/view/agents/radarnav.test.ts`,
  `frontend/app/store/keybindings/bindings.test.ts`
- Modify: `scripts/cdp/scenarios.mjs` (the `agent-history` scenario's steps 12 and 14)
- Modify: `docs/keyboard-shortcuts.md`, `docs/diff-tab.md`, `docs/reference/architecture.md`, `docs/deferred.md`,
  `docs/open-issues.md`

- [ ] **Step 1: Change the order tests first**

In `surfaceorder.test.ts`:
- Replace the test `"puts Radar on Ctrl+6 and Usage on Ctrl+7"` with the first test below.
- Add the second test after `"matches the nav rail's order exactly…"`.
- Change the import to `import { CORE_ITEMS, ITEMS, TOOL_ITEMS } from "./navrail";`.

```ts
    it("puts Usage on Ctrl+4 and the tools Code, Diff, Radar on Ctrl+5..7", () => {
        expect(SURFACE_ORDER.indexOf("usage") + 1).toBe(4);
        expect(SURFACE_ORDER.slice(4)).toEqual(["code", "files", "radar"]);
    });
```

```ts
    it("groups the rail: the surfaces used all day, then the tools", () => {
        expect(CORE_ITEMS.map((i) => i.key)).toEqual(["cockpit", "jarvis", "agent", "usage"]);
        expect(TOOL_ITEMS.map((i) => i.key)).toEqual(["code", "files", "radar"]);
        expect(ITEMS).toEqual([...CORE_ITEMS, ...TOOL_ITEMS]);
    });
```

In `radarnav.test.ts`, replace `"places radar between diff and usage"` with:

```ts
    it("places radar last, after diff, in the tools group", () => {
        expect(SURFACE_ORDER.indexOf("radar")).toBe(SURFACE_ORDER.indexOf("files") + 1);
        expect(SURFACE_ORDER.indexOf("radar")).toBe(SURFACE_ORDER.length - 1);
    });
```

In `bindings.test.ts`, change the test `"binds Ctrl+1..7 to SURFACE_ORDER, so Radar is Ctrl+6 and Usage is Ctrl+7"`:
- Rename it to `"binds Ctrl+1..7 to SURFACE_ORDER, so Usage is Ctrl+4 and Radar is Ctrl+7"`.
- Replace its two run/expect pairs with:

```ts
        chords.find((b) => b.keys === "Ctrl:4")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("usage");
        chords.find((b) => b.keys === "Ctrl:7")!.run(ctx());
        expect(globalStore.get(model.surfaceAtom)).toBe("radar");
```

- [ ] **Step 2: Run them and watch them fail**

Run:
`npx vitest run frontend/app/view/agents/surfaceorder.test.ts frontend/app/view/agents/radarnav.test.ts frontend/app/store/keybindings/bindings.test.ts`

Expected: FAIL. `CORE_ITEMS` is not exported, and the order assertions do not hold.

- [ ] **Step 3: Change the order**

In `agents.tsx`, replace the comment and the `SURFACE_ORDER` line with:

```ts
// Ordered to match the NavRail (navrail.tsx: CORE_ITEMS, then TOOL_ITEMS) so Ctrl+1..7 line up with what the user
// sees: the surfaces used all day first, then the tools. All 7 entries are chorded. Conversation History is not a
// surface: it is a centre mode of "agent" (agentcenter.ts).
export const SURFACE_ORDER: SurfaceKey[] = ["cockpit", "jarvis", "agent", "usage", "code", "files", "radar"];
```

- [ ] **Step 4: Split the nav rail into two groups**

In `navrail.tsx`:
- Replace the lucide import, `iconProps`, `ICON` and `ITEMS` with the code below.
- Drop `type ReactNode` from the react import if nothing else uses it.

```tsx
import {
    Bot,
    Brain,
    FileCode2,
    FileCog,
    Gauge,
    GitCompare,
    LayoutDashboard,
    Radar,
    Settings,
    type LucideIcon,
} from "lucide-react";

// Cockpit navigation icons. Runtime logos stay as image assets; app controls use Lucide components.
const ICON: Record<SurfaceKey, LucideIcon> = {
    cockpit: LayoutDashboard,
    jarvis: Brain,
    agent: Bot,
    radar: Radar,
    files: GitCompare,
    usage: Gauge,
    code: FileCode2,
    setup: FileCog,
    settings: Settings,
};

// the surfaces used all day, then the tools reached for now and then; Ctrl+1..7 follow this order (SURFACE_ORDER)
export const CORE_ITEMS: { key: SurfaceKey; label: string }[] = [
    { key: "cockpit", label: "Cockpit" },
    { key: "jarvis", label: "Jarvis" },
    { key: "agent", label: "Agent" },
    { key: "usage", label: "Usage" },
];

export const TOOL_ITEMS: { key: SurfaceKey; label: string }[] = [
    { key: "code", label: "Code" },
    { key: "files", label: "Diff" },
    { key: "radar", label: "Radar" },
];

export const ITEMS = [...CORE_ITEMS, ...TOOL_ITEMS];
```

In `renderItem`:
- Change the signature to `(key: SurfaceKey, label: string, badge = 0, tool = false)`.
- In its button's `className`, replace `py-[11px]` with `tool ? "py-[8px]" : "py-[11px]"` (move it into the `cn(...)`
  arguments).
- Add `const Icon = ICON[key];` as its first line, and replace `{ICON[key]}` with
  `<Icon size={tool ? 16 : 20} strokeWidth={1.8} />`.

In the `<nav>`'s children, replace `{ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0))}` with:

```tsx
            {CORE_ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0))}
            {/* a div, not a button: CDP scenarios count the surfaces as `nav button` */}
            <div data-nav-divider aria-hidden="true" className="mx-auto my-1.5 h-px w-8 shrink-0 bg-edge-mid" />
            {TOOL_ITEMS.map(({ key, label }) => renderItem(key, label, badges[key] ?? 0, true))}
```

Leave the `flex-1` spacer and the Setup and Settings items as they are. The active item must keep the class
`text-accent-soft`, because `scripts/cdp/attach.mjs`'s `activeSurfaceLabel` finds it by that class.

- [ ] **Step 5: Run the tests and watch them pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Move the agent-history scenario to the new chord numbers**

In `scripts/cdp/scenarios.mjs`, in the agent-history scenario:
- In the comment above `const AH_LIVE_ID`, replace `(Radar on Ctrl+6)` with `(Radar on Ctrl+7)`.
- Change step 12 to read:

```js
            const nav = await h.ev(`[...document.querySelectorAll("nav button")].map((b) => b.getAttribute("aria-label"))`);
            await ahKey(h, "7", "Digit7", { ctrlKey: true });
            await ahNap(800);
            const afterChord = await h.activeSurfaceLabel();
            rec(
                "12. the rail has seven surfaces in two groups and no Sessions, and Ctrl+7 opens Radar",
                !nav.includes("Sessions") &&
                    JSON.stringify(nav.slice(0, 7)) === JSON.stringify(["Cockpit", "Jarvis", "Agent", "Usage", "Code", "Diff", "Radar"]) &&
                    afterChord === "Radar",
                JSON.stringify({ nav, afterChord })
            );
```

- In step 14 (the block using `AH_CURSOR_STEP`), change `await ahKey(h, "6", "Digit6", { ctrlKey: true });` to
  `await ahKey(h, "7", "Digit7", { ctrlKey: true });`. `elsewhere === "Radar"` stays.

- [ ] **Step 7: Update the docs**

- `docs/keyboard-shortcuts.md`:
  - Make the `Ctrl`+`1`…`7` row read `Jump to surface by position — in order: Cockpit, Jarvis, Agent, Usage, Code, Diff,
    Radar`.
  - Change "Verified against `bindings.ts` on …" (line 7) to 2026-10-06.
- `docs/diff-tab.md`:
  - "The fifth item in the rail" becomes "The sixth item in the rail, in its tools group".
  - The `Ctrl`+`5` row becomes `` `Ctrl`+`6` | Jump by position (`SURFACE_ORDER` index 5) ``.
  - "The Code surface (`Ctrl`+`4`, or `g` `b`)" becomes `Ctrl`+`5`.
- `docs/reference/architecture.md`:
  - "`SURFACE_ORDER` … is cockpit, jarvis, agent, code, files, radar, usage — ordered to match the NavRail" becomes
    "`SURFACE_ORDER` … is cockpit, jarvis, agent, usage, code, files, radar — ordered to match the NavRail, whose
    core group (Cockpit, Jarvis, Agent, Usage) sits above its tools (Code, Diff, Radar)".
- `docs/deferred.md`: add this entry at the top, right after the blockquote, in the file's format:

```markdown
## Code and Diff in the nav rail (deferred 2026-10-06)

- **Deferred:** taking Code and Diff out of the nav rail. The rail now groups them with Radar as tools, under Cockpit,
  Jarvis, Agent and Usage (`docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md`).
- **Why:** the Agent panel's File tab (and later its Review tab) covers reading a file and an agent's changes, not
  browsing, searching or editing a project, nor history or compare. Whether the nav items still earn their place is
  only known after using the panel for a while.
- **Revive when** around 2026-10-20, after the 2026-10-15 re-measure of Code's "Send to agent": if Code and Diff are
  reached almost only through the panel's "Open in…" buttons, the palette and `g b` / `g f`, drop them from
  `TOOL_ITEMS` in `navrail.tsx` and from `SURFACE_ORDER` in `agents.tsx` (Radar becomes Ctrl+5).
```

- `docs/open-issues.md`: read the table this kind of row belongs to, then add one row in its format pointing at the new
  `docs/deferred.md` entry ("Code and Diff in the nav rail: re-measure ~2026-10-20").

- [ ] **Step 8: Lint and commit**

Run: `npx eslint frontend/app/view/agents/navrail.tsx frontend/app/view/agents/agents.tsx`. Expected: no errors.

```bash
git add frontend/app/view/agents/agents.tsx frontend/app/view/agents/navrail.tsx \
  frontend/app/view/agents/surfaceorder.test.ts frontend/app/view/agents/radarnav.test.ts \
  frontend/app/store/keybindings/bindings.test.ts scripts/cdp/scenarios.mjs \
  docs/keyboard-shortcuts.md docs/diff-tab.md docs/reference/architecture.md docs/deferred.md docs/open-issues.md
git commit -m "feat(nav): group Cockpit, Jarvis, Agent, Usage above the tools (Code, Diff, Radar)"
```

---

### Task 2: The path tokenizer

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/pathlinks.ts`
- Test: `frontend/app/view/agents/pathlinks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { findPathCandidates, inlinePathOf, resolvePath } from "./pathlinks";

const paths = (line: string) => findPathCandidates(line).map((c) => [c.path, c.line, c.col]);

describe("findPathCandidates", () => {
    it("reads tsc's file(line,col)", () => {
        expect(paths("src/app.ts(12,5): error TS2304: Cannot find name 'x'.")).toEqual([["src/app.ts", 12, 5]]);
    });

    it("reads go test and go vet's file:line and file:line:col", () => {
        expect(paths("    foo_test.go:12: expected 1, got 2")).toEqual([["foo_test.go", 12, undefined]]);
        expect(paths("pkg/x/y.go:12:5: undefined: z")).toEqual([["pkg/x/y.go", 12, 5]]);
    });

    it("reads vitest's file lines without taking its counts for a line number", () => {
        expect(paths(" ✓ frontend/util/fontutil.test.ts (12 tests) 41ms")).toEqual([
            ["frontend/util/fontutil.test.ts", undefined, undefined],
        ]);
        expect(paths(" ❯ frontend/x.test.ts:12:5")).toEqual([["frontend/x.test.ts", 12, 5]]);
    });

    it("reads eslint's absolute Windows path line", () => {
        expect(paths("D:\\projects\\arcterm\\frontend\\x.tsx")).toEqual([
            ["D:\\projects\\arcterm\\frontend\\x.tsx", undefined, undefined],
        ]);
        expect(paths("  12:5  error  'x' is defined but never used")).toEqual([]);
    });

    it("reads Claude Code's tool lines and git status", () => {
        expect(paths("● Update(frontend/util/fontutil.ts)")).toEqual([["frontend/util/fontutil.ts", undefined, undefined]]);
        expect(paths(" M frontend/tailwindsetup.css")).toEqual([["frontend/tailwindsetup.css", undefined, undefined]]);
    });

    it("takes a bare file name with an extension, and a suffix right after it", () => {
        expect(paths("echo a.txt:2")).toEqual([["a.txt", 2, undefined]]);
        expect(paths("see package.json.")).toEqual([["package.json", undefined, undefined]]);
    });

    it("leaves out URLs, flags, numbers, versions and abbreviations", () => {
        expect(paths("open http://localhost:5174/src/main.ts now")).toEqual([]);
        expect(paths("--config=x 1.32s v3.2.4 e.g. i.e. 0.4s 2026/10/06 localhost:5174")).toEqual([]);
    });

    it("gives the text the link covers, with its offsets", () => {
        const [c] = findPathCandidates("at src/a.ts:3:1 here");
        expect(c).toMatchObject({ text: "src/a.ts:3:1", start: 3, end: 15 });
    });
});

describe("resolvePath", () => {
    it("joins a relative path to the cwd and folds . and ..", () => {
        expect(resolvePath("D:/repo", "./src/../src/a.ts")).toBe("D:/repo/src/a.ts");
        expect(resolvePath("D:\\repo\\sub", "..\\a.ts")).toBe("D:/repo/a.ts");
        expect(resolvePath("/home/u/repo", "a.ts")).toBe("/home/u/repo/a.ts");
    });

    it("keeps an absolute path, whatever the cwd", () => {
        expect(resolvePath(null, "C:\\x\\y.go")).toBe("C:/x/y.go");
        expect(resolvePath("~", "/etc/hosts")).toBe("/etc/hosts");
    });

    it("cannot resolve a relative path without an absolute cwd, nor a ~ path", () => {
        expect(resolvePath("~", "a.ts")).toBeNull();
        expect(resolvePath(null, "a.ts")).toBeNull();
        expect(resolvePath("D:/repo", "~/a.ts")).toBeNull();
    });
});

describe("inlinePathOf", () => {
    it("accepts inline code that is one path, with a separator, a suffix or a source extension", () => {
        expect(inlinePathOf("frontend/util/fontutil.ts")?.path).toBe("frontend/util/fontutil.ts");
        expect(inlinePathOf("fontutil.ts:40")).toMatchObject({ path: "fontutil.ts", line: 40 });
        expect(inlinePathOf("package.json")?.path).toBe("package.json");
    });

    it("refuses code that is not only a path, or a name that is not a source file", () => {
        expect(inlinePathOf("console.log")).toBeNull();
        expect(inlinePathOf("npm run dev")).toBeNull();
        expect(inlinePathOf("const x = 1")).toBeNull();
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/app/view/agents/pathlinks.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// File paths in plain text: what the terminal's path links, the transcript's inline-code links and the File tab
// resolve. Pure: no React, no Wave runtime.

export interface PathCandidate {
    text: string; // what the link covers, suffix included: "src/a.ts:12:5"
    start: number; // offset of text in the line
    end: number; // exclusive
    path: string; // the path alone: "src/a.ts"
    line?: number;
    col?: number;
}

// a URL is never a path; it is blanked to spaces so offsets hold
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
// an optional root (a drive, ~, ./, ../ or a separator), then segments of path characters joined by separators
const PATH_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?[\w@+-][\w.@+-]*(?:[\\/][\w.@+-]+)*/g;
// what may follow a path: :12, :12:5, (12) or (12,5)
const SUFFIX_RE = /^(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))/;
// a file name's extension: a letter then 1–9 letters or digits, so ".ts" and ".go" but not "e.g" or "0.4s"
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{1,9}$/;
const SEP_RE = /[\\/]/;
// inline code without a separator or a line is a path only when it names a source file
const INLINE_EXTS = new Set(
    "ts tsx js jsx mjs cjs json md mdx go rs py css scss html yml yaml toml sql sh ps1 txt tex lock mod sum java kt c h cpp cs rb php swift vue svelte".split(
        " "
    )
);

function isPathToken(token: string): boolean {
    if (token.startsWith("-") || !/[A-Za-z]/.test(token)) {
        return false;
    }
    if (SEP_RE.test(token)) {
        return true;
    }
    return EXT_RE.test(token);
}

export function findPathCandidates(line: string): PathCandidate[] {
    const masked = line.replace(URL_RE, (m) => " ".repeat(m.length));
    const out: PathCandidate[] = [];
    for (const m of masked.matchAll(PATH_RE)) {
        const start = m.index ?? 0;
        // a sentence's full stop is not part of the name
        const token = m[0].replace(/\.+$/, "");
        if (token === "" || !isPathToken(token)) {
            continue;
        }
        const after = token.length === m[0].length ? masked.slice(start + token.length) : "";
        const s = SUFFIX_RE.exec(after);
        const lineNo = s ? Number(s[1] ?? s[3]) : undefined;
        const colStr = s ? (s[2] ?? s[4]) : undefined;
        const end = start + token.length + (s ? s[0].length : 0);
        out.push({
            text: line.slice(start, end),
            start,
            end,
            path: token,
            ...(lineNo != null ? { line: lineNo } : {}),
            ...(colStr != null ? { col: Number(colStr) } : {}),
        });
    }
    return out;
}

export function isAbsolutePath(p: string): boolean {
    return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p);
}

// an absolute path with forward slashes and . / .. folded, or null when it cannot be known here
export function resolvePath(cwd: string | null | undefined, p: string): string | null {
    if (p.startsWith("~")) {
        return null; // the shell's home is not known here
    }
    let joined: string;
    if (isAbsolutePath(p)) {
        joined = p;
    } else if (cwd != null && isAbsolutePath(cwd)) {
        joined = `${cwd}/${p}`;
    } else {
        return null;
    }
    const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? "";
    const segs: string[] = [];
    for (const seg of joined.slice(drive.length).split(/[\\/]+/)) {
        if (seg === "" || seg === ".") {
            continue;
        }
        if (seg === "..") {
            segs.pop();
            continue;
        }
        segs.push(seg);
    }
    return `${drive}/${segs.join("/")}`;
}

// inline code that is exactly one path: with a separator, a line, or a source file's extension
export function inlinePathOf(code: string): PathCandidate | null {
    const text = code.trim();
    const all = findPathCandidates(text);
    if (all.length !== 1 || all[0].start !== 0 || all[0].end !== text.length) {
        return null;
    }
    const c = all[0];
    const ext = /\.([A-Za-z0-9]+)$/.exec(c.path)?.[1]?.toLowerCase() ?? "";
    return SEP_RE.test(c.path) || c.line != null || INLINE_EXTS.has(ext) ? c : null;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run frontend/app/view/agents/pathlinks.test.ts`. Expected: PASS.

If a case fails, fix the tokenizer, not the test. The test lines are real tool output.

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --check frontend/app/view/agents/pathlinks.ts frontend/app/view/agents/pathlinks.test.ts
npx eslint frontend/app/view/agents/pathlinks.ts
git add frontend/app/view/agents/pathlinks.ts frontend/app/view/agents/pathlinks.test.ts
git commit -m "feat(agents): a tokenizer for file paths in terminal and transcript text"
```

---

### Task 3: The panel's model and store

**Depends on:** none

**Files:**
- Modify: `frontend/app/cockpit/openfileroute.ts` (export `isUnderRoot` and `toRel`)
- Create: `frontend/app/view/agents/agentrailtabs.ts`, `frontend/app/view/agents/agentrailtabs.test.ts`
- Create: `frontend/app/view/agents/agentrailstore.ts`

- [ ] **Step 1: Export the path helpers**

In `openfileroute.ts`, change `function isUnderRoot(` to `export function isUnderRoot(` and `function toRel(` to
`export function toRel(`. Nothing else changes.

- [ ] **Step 2: Write the failing model tests**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clampWideWidth,
    closeFile,
    fileLabel,
    goBack,
    goForward,
    nextTab,
    openFile,
    panelFor,
    RAIL_WIDE_DEFAULT_PX,
    RAIL_WIDE_MIN_PX,
    selectTab,
    visibleTabs,
    wideWidthMax,
} from "./agentrailtabs";

const a = { abs: "D:/repo/src/a.ts", root: "D:/repo", line: 4 };
const b = { abs: "D:/repo/src/b.ts", root: "D:/repo" };

describe("panelFor", () => {
    it("starts an unseen agent on the default tab, never on File", () => {
        expect(panelFor({}, "x", "overview").tab).toBe("overview");
        expect(panelFor({}, "x", "file").tab).toBe("overview");
    });
});

describe("the File tab", () => {
    it("opens a file on the File tab and remembers the tab it came from", () => {
        const p = openFile(panelFor({}, "x", "overview"), a);
        expect(p).toMatchObject({ tab: "file", prevTab: "overview" });
        expect(p.file.current).toEqual(a);
        expect(visibleTabs(p)).toEqual(["overview", "file"]);
    });

    it("pushes the open file onto Back and clears Forward when another opens", () => {
        let p = openFile(openFile(panelFor({}, "x", "overview"), a), b);
        expect(p.file.back).toEqual([a]);
        p = goBack(p);
        expect(p.file.current).toEqual(a);
        expect(p.file.forward).toEqual([b]);
        p = goForward(p);
        expect(p.file.current).toEqual(b);
        expect(openFile(goBack(p), b).file.forward).toEqual([]);
    });

    it("moves to a new line in the same file without a Back entry", () => {
        const p = openFile(openFile(panelFor({}, "x", "overview"), a), { ...a, abs: "d:\\repo\\src\\a.ts", line: 9 });
        expect(p.file.back).toEqual([]);
        expect(p.file.current?.line).toBe(9);
    });

    it("closes back to the tab it came from and forgets the history", () => {
        const p = closeFile(openFile(panelFor({}, "x", "overview"), a));
        expect(p.tab).toBe("overview");
        expect(p.file).toEqual({ back: [], current: null, forward: [] });
        expect(visibleTabs(p)).toEqual(["overview"]);
    });

    it("does not select File while no file is open", () => {
        const p = panelFor({}, "x", "overview");
        expect(selectTab(p, "file")).toBe(p);
    });

    it("labels a file by its path under the root, else by its absolute path", () => {
        expect(fileLabel(a)).toEqual({ dir: "src/", name: "a.ts" });
        expect(fileLabel({ abs: "C:/elsewhere/x.go", root: "D:/repo" })).toEqual({ dir: "C:/elsewhere/", name: "x.go" });
    });
});

describe("widths", () => {
    it("leaves the centre 640px beside the nav, the tree and the panel", () => {
        expect(wideWidthMax(1920, 78)).toBe(1920 - 78 - 248 - 640);
        expect(wideWidthMax(1000, 78)).toBe(RAIL_WIDE_MIN_PX);
    });

    it("clamps a dragged width between the minimum and the maximum", () => {
        expect(clampWideWidth(200, 900)).toBe(RAIL_WIDE_MIN_PX);
        expect(clampWideWidth(2000, 900)).toBe(900);
        expect(clampWideWidth(Number.NaN, 900)).toBe(RAIL_WIDE_DEFAULT_PX);
    });
});

describe("nextTab", () => {
    it("moves with the arrows, wrapping, and jumps with Home and End", () => {
        const tabs = ["overview", "file"] as const;
        expect(nextTab([...tabs], "overview", "ArrowRight")).toBe("file");
        expect(nextTab([...tabs], "file", "ArrowRight")).toBe("overview");
        expect(nextTab([...tabs], "overview", "ArrowLeft")).toBe("file");
        expect(nextTab([...tabs], "file", "Home")).toBe("overview");
        expect(nextTab([...tabs], "overview", "End")).toBe("file");
    });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement the model**

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's right panel: which tab an agent's panel shows, the file open in its File tab with Back/Forward,
// and the panel's widths (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). Pure: no React, no Wave
// runtime.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { normalizeRepoPath } from "@/util/paths";

export type RailTab = "overview" | "file";

// a file opened into the panel: its absolute path, the directory it was resolved against, and the line to show
export interface FileRef {
    abs: string;
    root: string | null;
    line?: number;
}

export interface FileHistory {
    back: FileRef[];
    current: FileRef | null;
    forward: FileRef[];
}

export interface PanelState {
    tab: RailTab;
    prevTab: RailTab; // where closing the file returns to
    file: FileHistory;
}

export const RAIL_OVERVIEW_PX = 300;
export const RAIL_WIDE_DEFAULT_PX = 520;
export const RAIL_WIDE_MIN_PX = 360;
const CENTRE_MIN_PX = 640; // DESIGN.md's stage-min
const AGENT_TREE_PX = 248; // agenttree.tsx's column

export const EMPTY_HISTORY: FileHistory = { back: [], current: null, forward: [] };

export function panelFor(panels: Record<string, PanelState>, agentId: string, defaultTab: RailTab): PanelState {
    // File is never a default: an unseen agent has no file open
    return panels[agentId] ?? { tab: defaultTab === "file" ? "overview" : defaultTab, prevTab: "overview", file: EMPTY_HISTORY };
}

export function visibleTabs(p: PanelState): RailTab[] {
    return p.file.current != null ? ["overview", "file"] : ["overview"];
}

export function selectTab(p: PanelState, tab: RailTab): PanelState {
    if (p.tab === tab || !visibleTabs(p).includes(tab)) {
        return p;
    }
    return { ...p, tab, prevTab: p.tab };
}

function samePath(x: string, y: string): boolean {
    return normalizeRepoPath(x) === normalizeRepoPath(y);
}

export function openFile(p: PanelState, ref: FileRef): PanelState {
    const cur = p.file.current;
    const file =
        cur != null && samePath(cur.abs, ref.abs)
            ? { ...p.file, current: ref }
            : { back: cur != null ? [...p.file.back, cur] : p.file.back, current: ref, forward: [] };
    return { tab: "file", prevTab: p.tab === "file" ? p.prevTab : p.tab, file };
}

export function goBack(p: PanelState): PanelState {
    const { back, current, forward } = p.file;
    if (back.length === 0 || current == null) {
        return p;
    }
    return { ...p, file: { back: back.slice(0, -1), current: back[back.length - 1], forward: [current, ...forward] } };
}

export function goForward(p: PanelState): PanelState {
    const { back, current, forward } = p.file;
    if (forward.length === 0 || current == null) {
        return p;
    }
    return { ...p, file: { back: [...back, current], current: forward[0], forward: forward.slice(1) } };
}

export function closeFile(p: PanelState): PanelState {
    return { tab: p.tab === "file" ? p.prevTab : p.tab, prevTab: "overview", file: EMPTY_HISTORY };
}

// the widest a wide tab may be: what leaves the centre its minimum beside the nav rail and the tree
export function wideWidthMax(windowWidth: number, navWidth: number): number {
    return Math.max(RAIL_WIDE_MIN_PX, windowWidth - navWidth - AGENT_TREE_PX - CENTRE_MIN_PX);
}

export function clampWideWidth(value: number, max: number): number {
    const hi = Math.max(RAIL_WIDE_MIN_PX, max);
    if (!Number.isFinite(value)) {
        return Math.min(RAIL_WIDE_DEFAULT_PX, hi);
    }
    return Math.min(hi, Math.max(RAIL_WIDE_MIN_PX, value));
}

export function nextTab(tabs: RailTab[], current: RailTab, key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): RailTab {
    if (key === "Home") {
        return tabs[0];
    }
    if (key === "End") {
        return tabs[tabs.length - 1];
    }
    const i = Math.max(0, tabs.indexOf(current));
    const step = key === "ArrowRight" ? 1 : -1;
    return tabs[(i + step + tabs.length) % tabs.length];
}

// how the header names a file: its directory and name, relative to the root when it is under it
export function fileLabel(ref: FileRef): { dir: string; name: string } {
    const shown = ref.root != null && isUnderRoot(ref.root, ref.abs) ? toRel(ref.root, ref.abs) : ref.abs.replace(/\\/g, "/");
    const i = shown.lastIndexOf("/");
    return i < 0 ? { dir: "", name: shown } : { dir: shown.slice(0, i + 1), name: shown.slice(i + 1) };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run frontend/app/view/agents/agentrailtabs.test.ts`. Expected: PASS.

- [ ] **Step 6: Add the store**

`agentrailstore.ts` (no test: it only writes atoms through the tested model):

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's state: per agent and in memory (the selected tab, the open file with its history), plus the two
// persisted preferences (the tab an unseen agent opens on, the wide tabs' width).

import { openFileInCode } from "@/app/cockpit/openfilestore";
import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { globalStore } from "@/app/store/jotaiStore";
import { openInCode } from "@/app/view/code/codestore";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { AgentsViewModel } from "./agents";
import {
    closeFile,
    goBack,
    goForward,
    openFile,
    panelFor,
    RAIL_WIDE_DEFAULT_PX,
    selectTab,
    type FileRef,
    type PanelState,
    type RailTab,
} from "./agentrailtabs";
import { jumpToAgent } from "./channelsprimitives";
import { railVisibleAtom } from "./railstore";

// the tab an agent not seen yet opens on: the last one chosen. File is never stored (it is not restored)
export const railTabDefaultAtom = atomWithStorage<RailTab>("agent.rail.tab", "overview", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<RailTab>;

export const railWideWidthAtom = atomWithStorage<number>("agent.rail.wideWidth", RAIL_WIDE_DEFAULT_PX, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<number>;

// the width while the grip is dragged: committed to railWideWidthAtom on release
export const railWideDragAtom = atom<number | null>(null) as PrimitiveAtom<number | null>;

export const railPanelsAtom = atom<Record<string, PanelState>>({}) as PrimitiveAtom<Record<string, PanelState>>;

function update(agentId: string, fn: (p: PanelState) => PanelState): void {
    const panels = globalStore.get(railPanelsAtom);
    const next = fn(panelFor(panels, agentId, globalStore.get(railTabDefaultAtom)));
    globalStore.set(railPanelsAtom, { ...panels, [agentId]: next });
}

export function selectRailTab(agentId: string, tab: RailTab): void {
    update(agentId, (p) => selectTab(p, tab));
    if (tab !== "file") {
        globalStore.set(railTabDefaultAtom, tab);
    }
}

// shows the agent on the Agent surface with its panel open on the file
export function openFileInPanel(model: AgentsViewModel, agentId: string, ref: FileRef): void {
    update(agentId, (p) => openFile(p, ref));
    globalStore.set(railVisibleAtom, true);
    jumpToAgent(model, agentId);
}

export const closeRailFile = (agentId: string) => update(agentId, closeFile);
export const railFileBack = (agentId: string) => update(agentId, goBack);
export const railFileForward = (agentId: string) => update(agentId, goForward);

// "Open in Code", and where a link goes when there is no panel: a file under its root opens in that project
export async function openRefInCode(model: AgentsViewModel, ref: FileRef): Promise<void> {
    if (ref.root != null && isUnderRoot(ref.root, ref.abs)) {
        await openInCode(model, { projectPath: ref.root, rel: toRel(ref.root, ref.abs), line: ref.line });
        return;
    }
    await openFileInCode(model, ref.abs, false);
}
```

- [ ] **Step 7: Lint and commit**

```bash
npx prettier --check frontend/app/view/agents/agentrailtabs.ts frontend/app/view/agents/agentrailtabs.test.ts frontend/app/view/agents/agentrailstore.ts
npx eslint frontend/app/view/agents/agentrailtabs.ts frontend/app/view/agents/agentrailstore.ts frontend/app/cockpit/openfileroute.ts
git add frontend/app/cockpit/openfileroute.ts frontend/app/view/agents/agentrailtabs.ts \
  frontend/app/view/agents/agentrailtabs.test.ts frontend/app/view/agents/agentrailstore.ts
git commit -m "feat(agents): the Agent panel's tab and file model, and its store"
```

---

### Task 4: The File tab

**Depends on:** Task 3

**Files:**
- Create: `frontend/app/view/agents/filetabload.ts`
- Create: `frontend/app/view/agents/filetab.tsx`

- [ ] **Step 1: The reader**

`filetabload.ts` does what the Code surface's `openPath` does (`codestore.ts`), for one absolute path:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads one file for the Agent panel's File tab, classified the way the Code surface classifies (codeclassify.ts).

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { classifyFile, hasNulByte } from "@/app/view/code/codeclassify";
import { base64ToString } from "@/util/util";

export type PanelFile =
    | { kind: "loading" }
    | { kind: "text"; text: string }
    | { kind: "binary"; size: number }
    | { kind: "toolarge"; size: number }
    | { kind: "missing" }
    | { kind: "error"; message: string };

export async function readPanelFile(abs: string): Promise<PanelFile> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        if (info == null || info.notfound || info.isdir) {
            return { kind: "missing" };
        }
        const size = info.size ?? 0;
        const klass = classifyFile(size, info.mimetype ?? "");
        if (klass !== "text") {
            return { kind: klass, size };
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: abs } });
        const text = base64ToString(data?.data64 ?? "");
        return hasNulByte(text) ? { kind: "binary", size } : { kind: "text", text };
    } catch (e) {
        return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
}

export function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
```

- [ ] **Step 2: The tab**

`filetab.tsx`:
- A header (Back, Forward, the path, Open in Code).
- A body that is a read-only `MonacoCodeEditor` scrolled to the line, with the line marked.
- The non-text states from the spec's table.

The editor is keyed by path and line, so a new line re-runs `onMount`, which reveals and marks it.

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's File tab: one file, read-only, at a line (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md).
// Editing is the Code surface's job, one click away.

import { SkeletonLine } from "@/app/element/skeleton";
import { cn, fireAndForget } from "@/util/util";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type * as MonacoTypes from "monaco-editor";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { fileLabel, type FileHistory } from "./agentrailtabs";
import { closeRailFile, openRefInCode, railFileBack, railFileForward } from "./agentrailstore";
import { formatSize, readPanelFile, type PanelFile } from "./filetabload";

const MonacoCodeEditor = lazy(() => import("@/app/monaco/monaco-react").then((m) => ({ default: m.MonacoCodeEditor })));

const OPTIONS: MonacoTypes.editor.IEditorOptions = {
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    folding: false,
    lineNumbersMinChars: 3,
    renderLineHighlight: "none",
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
};
// the line a link named: a grey fill (selection is grey, DESIGN.md) and an accent mark in the gutter
const HIT_LINE = "bg-surface-hover";
const HIT_MARK = "border-l-2 border-accent";
const ICON_BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";
const BTN =
    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-transparent px-2 text-[11.5px] font-medium text-secondary hover:border-edge-strong";

export function FileTab({ model, agentId, file }: { model: AgentsViewModel; agentId: string; file: FileHistory }) {
    const ref = file.current;
    const [state, setState] = useState<PanelFile>({ kind: "loading" });
    useEffect(() => {
        if (ref == null) {
            return;
        }
        let live = true;
        setState({ kind: "loading" });
        fireAndForget(async () => {
            const next = await readPanelFile(ref.abs);
            if (live) {
                setState(next);
            }
        });
        return () => {
            live = false;
        };
    }, [ref?.abs]);
    if (ref == null) {
        return null;
    }
    const { dir, name } = fileLabel(ref);
    const openCode = () => fireAndForget(() => openRefInCode(model, ref));
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            closeRailFile(agentId);
        }
    };

    let body: ReactNode;
    if (state.kind === "loading") {
        body = (
            <div aria-hidden="true" className="flex flex-col gap-2.5 px-3.5 py-3">
                {["w-[46%]", "w-[80%]", "w-[64%]", "w-[72%]", "w-[58%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[10px]", w)} />
                ))}
            </div>
        );
    } else if (state.kind === "text") {
        const line = ref.line;
        body = (
            <Suspense fallback={null}>
                <MonacoCodeEditor
                    key={`${ref.abs}:${line ?? ""}`}
                    // "file/" keeps these models apart from the Code and Diff surfaces'; the extension stays last so
                    // Monaco still picks the language
                    path={`file/${ref.abs}`}
                    text={state.text}
                    readonly
                    options={OPTIONS}
                    onMount={(editor, monacoApi) => {
                        if (line == null) {
                            return () => {};
                        }
                        editor.revealLineInCenter(line);
                        editor.setPosition({ lineNumber: line, column: 1 });
                        const hit = editor.createDecorationsCollection([
                            {
                                range: new monacoApi.Range(line, 1, line, 1),
                                options: { isWholeLine: true, className: HIT_LINE, linesDecorationsClassName: HIT_MARK },
                            },
                        ]);
                        return () => hit.clear();
                    }}
                />
            </Suspense>
        );
    } else {
        const msg =
            state.kind === "missing"
                ? { title: "This file no longer exists", body: `${dir}${name} was deleted or moved.`, close: true }
                : state.kind === "error"
                  ? { title: "Cannot read this file", body: state.message, close: false }
                  : {
                        title: `${state.kind === "binary" ? "Binary file" : "Large file"}, ${formatSize(state.size)}`,
                        body: "The panel shows text files up to 2 MB.",
                        close: false,
                    };
        body = (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
                <div className="text-[13px] font-semibold text-ink-hi">{msg.title}</div>
                <div className="text-[12px] leading-[1.5] text-ink-mid">{msg.body}</div>
                <button
                    type="button"
                    onClick={msg.close ? () => closeRailFile(agentId) : openCode}
                    className={cn(BTN, "mt-1.5")}
                >
                    {msg.close ? "Close" : "Open in Code"}
                </button>
            </div>
        );
    }

    return (
        <div data-rail-file={ref.abs} onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
                <button
                    type="button"
                    aria-label="Back"
                    disabled={file.back.length === 0}
                    onClick={() => railFileBack(agentId)}
                    className={ICON_BTN}
                >
                    <ChevronLeft size={14} aria-hidden />
                </button>
                <button
                    type="button"
                    aria-label="Forward"
                    disabled={file.forward.length === 0}
                    onClick={() => railFileForward(agentId)}
                    className={ICON_BTN}
                >
                    <ChevronRight size={14} aria-hidden />
                </button>
                <span title={ref.abs} className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                    <span className="text-muted">{dir}</span>
                    <span className="text-ink-hi">{name}</span>
                    {ref.line != null ? <span className="text-muted">:{ref.line}</span> : null}
                </span>
                <button type="button" onClick={openCode} className={BTN}>
                    Open in Code
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            <div className="min-h-0 flex-1 bg-surface-code">{body}</div>
        </div>
    );
}
```

Check before moving on:
- **The `onMount` signature.** `MonacoCodeEditor`'s `onMount` returns a cleanup function (`monaco-react.tsx`,
  `CodeEditorProps`). If its parameter types differ from the above, follow the file.
- **Its props.** Confirm in `monaco-react.tsx` that `MonacoCodeEditor` takes `text`, `readonly`, `path`, `options` and
  `onMount`, and adjust the JSX to match.

- [ ] **Step 3: Lint and commit**

```bash
npx prettier --check frontend/app/view/agents/filetabload.ts frontend/app/view/agents/filetab.tsx
npx eslint frontend/app/view/agents/filetabload.ts frontend/app/view/agents/filetab.tsx
git add frontend/app/view/agents/filetabload.ts frontend/app/view/agents/filetab.tsx
git commit -m "feat(agents): the Agent panel's File tab, one read-only file at a line"
```

The tab is seen working in Task 9's scenario.

---

### Task 5: The tab strip, the wide width and the collapsed strip

**Depends on:** Task 3, Task 4

**Files:**
- Modify: `frontend/app/element/collapsiblerail.tsx`
- Create: `frontend/app/view/agents/agentrailpanel.tsx`
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx`

- [ ] **Step 1: Give `CollapsibleRail` the optional props**

`CollapsibleRail` has two other callers (`TerminalRail`, `CockpitRail`). Every new prop is optional, and with none of
them passed the rail renders exactly as before.

Add to the exported types and the props:

```tsx
// one control per tab on the collapsed strip, above the strip's own content
export interface RailStripTab {
    key: string;
    icon: ReactNode;
    ariaLabel: string;
    onClick: () => void;
    badge?: number;
}
```

```tsx
    // the open width; 300 when absent
    width?: number;
    // a tab strip in place of the bare collapse row: the 44px band and rule of a titled header, the collapse chevron
    // at its end
    tabs?: ReactNode;
    // replaces the sections' scroll column, for a tab that owns the whole panel body
    body?: ReactNode;
    stripTabs?: RailStripTab[];
    // laid over the panel's left edge while it is open (a resize grip)
    edge?: ReactNode;
```

Then make these changes:

1. **Width and its transition.** A width change while the rail stays open is instant. Only opening and collapsing
   slide, because one layout commit is one PTY resize for the centre's terminal:

```tsx
    const railWidth = forceCollapsed ? 0 : open ? (width ?? RAIL_EXPANDED_PX) : collapsedWidth;
    const prevMode = useRef({ open, forceCollapsed });
    const slide = prevMode.current.open !== open || prevMode.current.forceCollapsed !== forceCollapsed;
    useEffect(() => {
        prevMode.current = { open, forceCollapsed };
    });
```

   This replaces the old `const width = …` local, which would shadow the new `width` prop. Use `railWidth` where the
   old local was used (`animate={{ width: railWidth }}` and the border condition). Set the aside's `transition` to
   `slide ? { duration: MOTION.durMacro, ease: MOTION.easeFluid } : { duration: 0 }`.

2. **The aside.** Add `relative` to the aside's classes. As its first child, render
   `{open && !forceCollapsed && edge != null ? edge : null}`.

3. **The header.** In the open panel, when `tabs != null`, replace the header `<div>` with:

```tsx
                            <div className="flex h-11 shrink-0 items-stretch border-b border-border bg-surface pl-2 pr-1.5">
                                {tabs}
                                <div className="flex-1" />
                                <div className="flex items-center gap-0.5">
                                    {extraIcons?.map((ei) => (
                                        <ExtraIcon key={ei.key} ei={ei} />
                                    ))}
                                    {/* the same collapse button as the header below */}
                                </div>
                            </div>
```

   - Factor the existing collapse `<button>` into a local `const collapseButton = (…)` so both headers render the same
     element.
   - Keep the existing `title` and bare branches for `tabs == null`.

4. **The body.** When `body != null`, render `<div className="flex min-h-0 flex-1 flex-col">{body}</div>` instead of the
   sections' scroll column. The footer still renders below either.

5. **The strip.** In the collapsed strip (the `key="strip"` branch), render the `stripTabs` before the existing `strip`
   button:

```tsx
                        {stripTabs?.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                aria-label={t.ariaLabel}
                                title={t.ariaLabel}
                                onClick={t.onClick}
                                className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] text-muted hover:bg-surface-hover hover:text-secondary"
                            >
                                {t.icon}
                                {t.badge ? (
                                    <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-surface bg-surface-selected px-[3px] text-[9.5px] font-bold tabular-nums leading-none text-primary">
                                        {t.badge}
                                    </span>
                                ) : null}
                            </button>
                        ))}
```

Add `useEffect` and `useRef` to the react import.

- [ ] **Step 2: The strip and the grip**

`agentrailpanel.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's tab strip (icons, plus an editor-style tab while a file is open) and the grip that sizes the wide
// tabs. The panel itself is AgentDetailsRail, through CollapsibleRail's tabs/body/width props.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { FileText, LayoutList, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
    clampWideWidth,
    fileLabel,
    nextTab,
    RAIL_WIDE_MIN_PX,
    visibleTabs,
    wideWidthMax,
    type PanelState,
    type RailTab,
} from "./agentrailtabs";
import { closeRailFile, railWideDragAtom, railWideWidthAtom, selectRailTab } from "./agentrailstore";
import { navRailCollapsed } from "./navrailwidth";

const TAB =
    "flex min-w-[40px] cursor-pointer items-center justify-center gap-[5px] border-0 border-b-2 bg-transparent px-[9px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "border-primary text-primary";
const TAB_OFF = "border-transparent text-muted hover:text-secondary";

export function RailTabStrip({ agentId, panel }: { agentId: string; panel: PanelState }) {
    const tabs = visibleTabs(panel);
    const ref = useRef<HTMLDivElement>(null);
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const next = nextTab(tabs, panel.tab, e.key);
        selectRailTab(agentId, next);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-rail-tab="${next}"]`)?.focus());
    };
    const tabProps = (tab: RailTab) => ({
        role: "tab" as const,
        "aria-selected": panel.tab === tab,
        tabIndex: panel.tab === tab ? 0 : -1,
        "data-rail-tab": tab,
        onClick: () => selectRailTab(agentId, tab),
    });
    const file = panel.file.current;
    return (
        <div ref={ref} role="tablist" aria-label="Agent panel" onKeyDown={onKeyDown} className="flex items-stretch">
            <button
                type="button"
                {...tabProps("overview")}
                aria-label="Overview"
                title="Overview"
                className={cn(TAB, panel.tab === "overview" ? TAB_ON : TAB_OFF)}
            >
                <LayoutList size={16} strokeWidth={1.8} aria-hidden />
            </button>
            {file != null ? (
                <div
                    className={cn(
                        "ml-0.5 flex min-w-0 max-w-[190px] items-center border-b-2",
                        panel.tab === "file" ? TAB_ON : TAB_OFF
                    )}
                >
                    <button
                        type="button"
                        {...tabProps("file")}
                        aria-label={`File ${fileLabel(file).name}`}
                        title={file.abs}
                        className="flex min-w-0 cursor-pointer items-center gap-[7px] border-0 bg-transparent py-0 pl-2.5 pr-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                        <FileText size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                        <span className="min-w-0 truncate font-mono text-[11.5px]">{fileLabel(file).name}</span>
                    </button>
                    <button
                        type="button"
                        aria-label="Close file"
                        onClick={() => closeRailFile(agentId)}
                        className="mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                    >
                        <X size={12} strokeWidth={2} aria-hidden />
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function useWindowWidth(): number {
    const [w, setW] = useState(() => window.innerWidth);
    useEffect(() => {
        const on = () => setW(window.innerWidth);
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);
    return w;
}

// the wide tabs' width now: the drag in progress, else the stored width, clamped to what the window leaves
export function useWideWidth(): { width: number; max: number } {
    const stored = useAtomValue(railWideWidthAtom);
    const drag = useAtomValue(railWideDragAtom);
    const win = useWindowWidth();
    const max = wideWidthMax(win, navRailCollapsed(win) ? 56 : 78);
    return { width: clampWideWidth(drag ?? stored, max), max };
}

// a separator on the panel's left edge: dragging left widens it; arrows step 16px (64 with Shift)
export function RailResizeGrip({ width, max }: { width: number; max: number }) {
    const drag = useRef<{ id: number; startX: number; start: number } | null>(null);
    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        drag.current = { id: e.pointerId, startX: e.clientX, start: width };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        globalStore.set(railWideDragAtom, clampWideWidth(d.start + (d.startX - e.clientX), max));
    };
    const end = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
        const d = drag.current;
        if (d == null || d.id !== e.pointerId) {
            return;
        }
        drag.current = null;
        const live = globalStore.get(railWideDragAtom);
        globalStore.set(railWideDragAtom, null);
        if (commit && live != null) {
            globalStore.set(railWideWidthAtom, live);
        }
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 64 : 16;
        const next =
            e.key === "ArrowLeft"
                ? width + step
                : e.key === "ArrowRight"
                  ? width - step
                  : e.key === "Home"
                    ? RAIL_WIDE_MIN_PX
                    : e.key === "End"
                      ? max
                      : null;
        if (next == null) {
            return;
        }
        e.preventDefault();
        globalStore.set(railWideWidthAtom, clampWideWidth(next, max));
    };
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuemin={RAIL_WIDE_MIN_PX}
            aria-valuemax={max}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => end(e, true)}
            onPointerCancel={(e) => end(e, false)}
            onLostPointerCapture={(e) => end(e, false)}
            onKeyDown={onKeyDown}
            className="group absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize justify-start outline-none"
        >
            <span className="h-full w-px bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
    );
}
```

- [ ] **Step 3: Wire it into `AgentDetailsRail`**

In `agentdetailsrail.tsx`, inside `AgentDetailsRail`, before the `return`:

```tsx
    const panels = useAtomValue(railPanelsAtom);
    const defaultTab = useAtomValue(railTabDefaultAtom);
    const panel = panelFor(panels, agent.id, defaultTab);
    const wide = useWideWidth();
    const fileRef = panel.file.current;
    const showRail = () => globalStore.set(railVisibleAtom, true);
```

Pass these to the `CollapsibleRail` call. Keep every existing prop:

```tsx
            width={panel.tab === "overview" ? RAIL_OVERVIEW_PX : wide.width}
            tabs={<RailTabStrip agentId={agent.id} panel={panel} />}
            body={
                panel.tab === "file" && fileRef != null ? (
                    <FileTab model={model} agentId={agent.id} file={panel.file} />
                ) : undefined
            }
            edge={panel.tab !== "overview" ? <RailResizeGrip width={wide.width} max={wide.max} /> : undefined}
            stripTabs={[
                {
                    key: "overview",
                    icon: <LayoutList size={17} strokeWidth={1.8} aria-hidden />,
                    ariaLabel: "Overview",
                    onClick: () => {
                        selectRailTab(agent.id, "overview");
                        showRail();
                    },
                },
                ...(fileRef != null
                    ? [
                          {
                              key: "file",
                              icon: <FileText size={17} strokeWidth={1.8} aria-hidden />,
                              ariaLabel: `File ${fileLabel(fileRef).name}`,
                              onClick: () => {
                                  selectRailTab(agent.id, "file");
                                  showRail();
                              },
                          },
                      ]
                    : []),
            ]}
```

Imports:
- `useAtomValue` from jotai, if it is not already imported.
- `LayoutList` and `FileText` from lucide-react.
- `panelFor`, `fileLabel` and `RAIL_OVERVIEW_PX` from `./agentrailtabs`.
- `railPanelsAtom`, `railTabDefaultAtom` and `selectRailTab` from `./agentrailstore`.
- `RailTabStrip`, `RailResizeGrip` and `useWideWidth` from `./agentrailpanel`.
- `FileTab` from `./filetab`.
- `globalStore` and `railVisibleAtom`, if they are not already imported.

- [ ] **Step 4: Typecheck the touched files cheaply, lint, commit**

A full `task check:ts` waits for Task 10. For now:

```bash
npx eslint frontend/app/element/collapsiblerail.tsx frontend/app/view/agents/agentrailpanel.tsx frontend/app/view/agents/agentdetailsrail.tsx
npx prettier --check frontend/app/view/agents/agentrailpanel.tsx
```

Then check the dev app by eye: `node scripts/cdp-shot.mjs cdp-shots/rail-tabs.png` after opening the Agent surface. The
rail's header must now be the tab strip (one Overview icon and the chevron), with today's sections under it.

```bash
git add frontend/app/element/collapsiblerail.tsx frontend/app/view/agents/agentrailpanel.tsx frontend/app/view/agents/agentdetailsrail.tsx
git commit -m "feat(agents): the Agent rail becomes a tab strip, Overview plus the open file"
```

---

### Task 6: Link routing and the terminal's path links

**Depends on:** Task 2, Task 3

**Files:**
- Create: `frontend/app/view/agents/pathlinkroute.ts`, `frontend/app/view/agents/pathlinkroute.test.ts`
- Create: `frontend/app/view/term/termpathlinks.ts`
- Modify: `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term-tooltip.tsx`
- Modify: `frontend/app/cockpit/cockpit-root.tsx`

- [ ] **Step 1: Write the failing routing tests**

The pure decisions are which roster entry owns a terminal block, and which agent's panel a palette pick may use:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { focusedPanelAgent, panelOwnerOf } from "./pathlinkroute";

const roster = [
    { id: "t-agent", name: "a", task: "", state: "working", blockId: "b-agent" },
    { id: "t-term", name: "sh", task: "", state: "idle", kind: "terminal", blockId: "b-term" },
] as any[];

describe("panelOwnerOf", () => {
    it("gives the agent whose TUI the block is", () => {
        expect(panelOwnerOf(roster, "b-agent")?.id).toBe("t-agent");
    });

    it("gives nothing for a plain terminal or an unknown block: they have no panel", () => {
        expect(panelOwnerOf(roster, "b-term")).toBeUndefined();
        expect(panelOwnerOf(roster, "nope")).toBeUndefined();
    });
});

describe("focusedPanelAgent", () => {
    const base = { surface: "agent", focusId: "t-agent", roster, cwd: "D:/repo", abs: "D:\\repo\\src\\a.ts" };

    it("takes the focused agent when the Agent surface shows and its directory holds the file", () => {
        expect(focusedPanelAgent(base)).toBe("t-agent");
    });

    it("declines on another surface, for a terminal, without a cwd, or for a file outside it", () => {
        expect(focusedPanelAgent({ ...base, surface: "code" })).toBeNull();
        expect(focusedPanelAgent({ ...base, focusId: "t-term" })).toBeNull();
        expect(focusedPanelAgent({ ...base, cwd: null })).toBeNull();
        expect(focusedPanelAgent({ ...base, abs: "C:/elsewhere/a.ts" })).toBeNull();
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run frontend/app/view/agents/pathlinkroute.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement the routing**

`pathlinkroute.ts`. The model is bound at boot, like `setupOpenFileSubscription`, because the terminal's link provider
lives outside React:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a file path link goes (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): an agent's terminal or
// transcript opens it in that agent's panel, a plain terminal in the Code surface. The model is bound at boot,
// because the terminal's link provider lives outside React.

import { pushToast } from "@/app/cockpit/notificationstore";
import { isUnderRoot } from "@/app/cockpit/openfileroute";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import type { FileRef } from "./agentrailtabs";
import { openFileInPanel, openRefInCode } from "./agentrailstore";
import { resolveCwd } from "./agentcwdresolve";
import type { AgentVM } from "./agentsviewmodel";
import { resolvePath } from "./pathlinks";
import { railStateAtom } from "./railstore";

let boundModel: AgentsViewModel | null = null;

export function setPathLinkModel(model: AgentsViewModel | null): void {
    boundModel = model;
}

// the roster entry with a panel that a terminal block belongs to: an agent's TUI, never a plain terminal
export function panelOwnerOf(roster: AgentVM[], blockId: string): AgentVM | undefined {
    const owner = roster.find((a) => a.blockId === blockId);
    return owner != null && owner.kind !== "terminal" ? owner : undefined;
}

// the agent whose panel a palette pick opens in, or null for the Code surface
export function focusedPanelAgent(input: {
    surface: SurfaceKey;
    focusId: string | null | undefined;
    roster: AgentVM[];
    cwd: string | null | undefined;
    abs: string;
}): string | null {
    if (input.surface !== "agent" || input.focusId == null || input.cwd == null) {
        return null;
    }
    const agent = input.roster.find((a) => a.id === input.focusId);
    if (agent == null || agent.kind === "terminal") {
        return null;
    }
    return isUnderRoot(input.cwd, input.abs) ? agent.id : null;
}

function roster(model: AgentsViewModel): AgentVM[] {
    return [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
}

export function openPathFromTerminal(blockId: string, ref: FileRef): void {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const owner = panelOwnerOf(roster(model), blockId);
    if (owner != null) {
        openFileInPanel(model, owner.id, ref);
        return;
    }
    fireAndForget(() => openRefInCode(model, ref));
}

export async function fileExists(abs: string): Promise<boolean> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        return info != null && !info.notfound && !info.isdir;
    } catch {
        return false;
    }
}

// a transcript's link: resolved against the agent's working directory, checked, then opened in its panel
export async function openAgentPath(agent: AgentVM, path: string, line?: number): Promise<void> {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const cwd = await resolveCwd(agent.transcriptPath, agent.blockId);
    const abs = resolvePath(cwd, path);
    if (abs == null || !(await fileExists(abs))) {
        pushToast({ title: `File not found: ${path}`, message: "", level: "warn" });
        return;
    }
    openFileInPanel(model, agent.id, { abs, root: cwd, ...(line != null ? { line } : {}) });
}

// a palette pick: the focused agent's panel when the Agent surface shows it and the file is under its directory
export function openInFocusedPanel(model: AgentsViewModel, abs: string, line?: number): boolean {
    const cwd = globalStore.get(railStateAtom)?.cwd ?? null;
    const agentId = focusedPanelAgent({
        surface: globalStore.get(model.surfaceAtom),
        focusId: globalStore.get(model.focusIdAtom),
        roster: globalStore.get(model.agentsAtom),
        cwd,
        abs,
    });
    if (agentId == null) {
        return false;
    }
    openFileInPanel(model, agentId, { abs, root: cwd, ...(line != null ? { line } : {}) });
    return true;
}
```

Before relying on these, confirm three things:
- `model.focusIdAtom` holds a `string` (or `string | undefined`). Adapt the `focusId` type to it.
- `AgentVM.kind` is `"terminal"` for a plain terminal (`deriveTerminalVMs`).
- `pushToast`'s `ToastNotification` accepts `{ title, message, level }`. It does in `notificationstore.ts`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run frontend/app/view/agents/pathlinkroute.test.ts`. Expected: PASS.

- [ ] **Step 5: Bind the model at boot**

In `cockpit-root.tsx`, next to the `setupOpenFileSubscription` effect:

```tsx
    useEffect(() => {
        setPathLinkModel(model);
        return () => setPathLinkModel(null);
    }, [model]);
```

Add the import: `import { setPathLinkModel } from "@/app/view/agents/pathlinkroute";`.

- [ ] **Step 6: The link provider**

`termpathlinks.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// File paths in terminal output as links (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): candidates
// from pathlinks.ts, resolved against the block's cwd, underlined only once the file is known to exist. Ctrl+click
// (Cmd on macOS) opens one, the way a URL opens.

import { fileExists } from "@/app/view/agents/pathlinkroute";
import type { FileRef } from "@/app/view/agents/agentrailtabs";
import { findPathCandidates, resolvePath } from "@/app/view/agents/pathlinks";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

export interface PathLinkHooks {
    cwd: () => string | null;
    activate: (ref: FileRef) => void;
    hover: (e: MouseEvent, ref: FileRef) => void;
    leave: () => void;
}

// a file comes into being while the terminal shows its name, so a miss is only trusted for a while
const CACHE_MS = 10_000;
const known = new Map<string, { ok: boolean; at: number }>();

async function exists(abs: string): Promise<boolean> {
    const hit = known.get(abs);
    if (hit != null && Date.now() - hit.at < CACHE_MS) {
        return hit.ok;
    }
    const ok = await fileExists(abs);
    known.set(abs, { ok, at: Date.now() });
    return ok;
}

export function isOpenGesture(e: MouseEvent): boolean {
    return PLATFORM === PlatformMacOS ? e.metaKey : e.ctrlKey;
}

export function hintFor(ref: FileRef): string {
    const name = ref.abs.split(/[\\/]/).pop() ?? ref.abs;
    return `open ${name}${ref.line != null ? ` at line ${ref.line}` : ""}`;
}

// the existing files a line names, as references
async function refsForLine(text: string, cwd: string | null) {
    const out: { text: string; start: number; end: number; ref: FileRef }[] = [];
    for (const c of findPathCandidates(text)) {
        const abs = resolvePath(cwd, c.path);
        if (abs == null || !(await exists(abs))) {
            continue;
        }
        out.push({ text: c.text, start: c.start, end: c.end, ref: { abs, root: cwd, ...(c.line != null ? { line: c.line } : {}) } });
    }
    return out;
}

export function makePathLinkProvider(term: Terminal, hooks: PathLinkHooks): ILinkProvider {
    return {
        provideLinks(y, callback) {
            const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
            if (text.trim() === "") {
                callback(undefined);
                return;
            }
            void refsForLine(text, hooks.cwd()).then((found) => {
                const links: ILink[] = found.map((f) => ({
                    // xterm ranges are 1-based and inclusive
                    range: { start: { x: f.start + 1, y }, end: { x: f.end, y } },
                    text: f.text,
                    decorations: { underline: true, pointerCursor: true },
                    activate: (e) => {
                        if (isOpenGesture(e)) {
                            hooks.activate(f.ref);
                        }
                    },
                    hover: (e) => hooks.hover(e, f.ref),
                    leave: () => hooks.leave(),
                }));
                callback(links.length > 0 ? links : undefined);
            });
        },
    };
}

// DEV only: lets a CDP scenario read a terminal's path links and follow one without aiming a mouse at a canvas
const devTerms = new Map<string, { term: Terminal; hooks: PathLinkHooks }>();

export function trackForDev(blockId: string, term: Terminal, hooks: PathLinkHooks): IDisposable {
    if (!import.meta.env.DEV) {
        return { dispose: () => {} };
    }
    devTerms.set(blockId, { term, hooks });
    (window as any).__arcTermPathLinks ??= {
        scan: async (id: string) => {
            const t = devTerms.get(id);
            if (t == null) {
                return null;
            }
            const buf = t.term.buffer.active;
            const found = [];
            for (let i = 0; i < buf.length; i++) {
                const text = buf.getLine(i)?.translateToString(true) ?? "";
                for (const f of await refsForLine(text, t.hooks.cwd())) {
                    found.push({ text: f.text, abs: f.ref.abs, line: f.ref.line ?? null });
                }
            }
            return found;
        },
        open: async (id: string, linkText: string) => {
            const t = devTerms.get(id);
            if (t == null) {
                return false;
            }
            const buf = t.term.buffer.active;
            for (let i = buf.length - 1; i >= 0; i--) {
                const text = buf.getLine(i)?.translateToString(true) ?? "";
                const hit = (await refsForLine(text, t.hooks.cwd())).find((f) => f.text === linkText);
                if (hit != null) {
                    t.hooks.activate(hit.ref);
                    return true;
                }
            }
            return false;
        },
    };
    return { dispose: () => devTerms.delete(blockId) };
}
```

Confirm `@xterm/xterm` exports the `ILinkProvider`, `ILink` and `IDisposable` types (it does in v5). If
`import.meta.env` is not typed in this tsconfig, follow how `devmock.ts` reads the DEV flag.

Watch for a circular import. `termwrap.ts` now reaches `pathlinkroute.ts`, which reaches the agents and Code stores.
Everything here is used at call time, so a cycle should not bite. But if the dev app logs an import that is
`undefined` at startup, break the chain at its weakest point:
- move `fileExists` into `termpathlinks.ts`, and
- have `termwrap.ts` call the route through `await import("@/app/view/agents/pathlinkroute")` inside `activate`.

- [ ] **Step 7: Register it in `TermWrap`**

In `termwrap.ts`:

1. Change the `onLinkHover` field's type to
   `onLinkHover?: (uri: string | null, mouseX: number, mouseY: number, hint?: string) => void;`.
2. Right after the `this.terminal.loadAddon(new WebLinksAddon(…))` statement, add the block below.
3. Import `makePathLinkProvider`, `trackForDev` and `hintFor` from `./termpathlinks`, and `openPathFromTerminal` from
   `@/app/view/agents/pathlinkroute`. `WOS` and `Block` may already be imported (line ~538 uses
   `WOS.getObjectValue<Block>`); add whatever is missing.

```ts
        // file paths in the output: Ctrl+click opens one beside its agent (termpathlinks.ts). hoveredLinkUri stays a
        // URL's alone: the context menu offers "Open URL" for it, and a Windows path parses as a URL
        const pathHooks = {
            cwd: () => {
                const cwd = WOS.getObjectValue<Block>(WOS.makeORef("block", this.blockId))?.meta?.["cmd:cwd"];
                return typeof cwd === "string" && cwd !== "" ? cwd : null;
            },
            activate: (ref: FileRef) => openPathFromTerminal(this.blockId, ref),
            hover: (e: MouseEvent, ref: FileRef) => this.onLinkHover?.(ref.abs, e.clientX, e.clientY, hintFor(ref)),
            leave: () => this.onLinkHover?.(null, 0, 0),
        };
        this.toDispose.push(this.terminal.registerLinkProvider(makePathLinkProvider(this.terminal, pathHooks)));
        this.toDispose.push(trackForDev(this.blockId, this.terminal, pathHooks));
```

Import `type FileRef` from `@/app/view/agents/agentrailtabs`. If `this.toDispose` is filled before this point in the
constructor, this placement is fine. If it is declared after, move these lines below its initialization.

- [ ] **Step 8: Name the file in the hover tooltip**

In `term-tooltip.tsx`'s `TermLinkTooltip`:
- Add `const [hint, setHint] = React.useState<string | null>(null);`.
- Make the handler `(uri, mouseX, mouseY, hint) => …`.
- Call `setHint(hint ?? null)` right before `setMousePos({ x: mouseX, y: mouseY })`.
- Render `content={<span>{modKey}-click to {hint ?? "open link"}</span>}`.

- [ ] **Step 9: Lint and commit**

```bash
npx prettier --check frontend/app/view/agents/pathlinkroute.ts frontend/app/view/agents/pathlinkroute.test.ts frontend/app/view/term/termpathlinks.ts
npx eslint frontend/app/view/agents/pathlinkroute.ts frontend/app/view/term/termpathlinks.ts frontend/app/view/term/termwrap.ts frontend/app/view/term/term-tooltip.tsx frontend/app/cockpit/cockpit-root.tsx
git add frontend/app/view/agents/pathlinkroute.ts frontend/app/view/agents/pathlinkroute.test.ts \
  frontend/app/view/term/termpathlinks.ts frontend/app/view/term/termwrap.ts frontend/app/view/term/term-tooltip.tsx \
  frontend/app/cockpit/cockpit-root.tsx
git commit -m "feat(term): file paths in terminal output open beside their agent on Ctrl+click"
```

Check it by hand in the dev app, in an agent's terminal: print a path that exists, hover it, Ctrl+click it. The
scenario in Task 9 checks it too.

---

### Task 7: Path links in transcripts and Cockpit cards

**Depends on:** Task 6

**Files:**
- Modify: `frontend/app/view/agents/agentsviewmodel.ts` (the `action` entry gets `path?`)
- Modify: `frontend/app/view/agents/transcriptprojection.ts`, `pitranscriptprojection.ts`,
  `opencodetranscriptprojection.ts`, and their `.test.ts`
- Create: `frontend/app/view/agents/pathlinkcontext.tsx`
- Modify: `frontend/app/view/agents/narrationtimeline.tsx` (`ToolLine`), `frontend/app/view/agents/markdownmessage.tsx`
- Modify: `frontend/app/view/agents/agentrow.tsx`, `leadcard.tsx`, `runworkercard.tsx`, `endedtranscript.tsx`

- [ ] **Step 1: Write the failing projector tests**

A tool row shows a file's base name. Its link needs the full path, so the action entry carries it.

In `transcriptprojection.test.ts`:
- In `"projects messages, actions, and outcomes in order"`, the edited entry becomes
  `{ kind: "action", verb: "edited", target: "sessionmodel.go", path: "/home/u/proj/sessionmodel.go" }`.
- Add:

```ts
    it("keeps the full path of a file tool beside its base name", () => {
        const out = projectTranscript([
            JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r", name: "Read", input: { file_path: "D:\\repo\\src\\a.ts" } }] } }),
        ]);
        expect(out[0]).toMatchObject({ kind: "action", target: "a.ts", path: "D:\\repo\\src\\a.ts" });
    });
```

In `pitranscriptprojection.test.ts`, inside `describe("projectPiTranscript", …)`:

```ts
    it("keeps the full path of a file tool beside its base name", () => {
        const out = projectPiTranscript([session, user("u", "go"), toolCall("1", "read", { path: "/repo/src/a.ts" })]);
        expect(out.find((e) => e.kind === "action")).toMatchObject({ target: "a.ts", path: "/repo/src/a.ts" });
    });
```

In `opencodetranscriptprojection.test.ts`, add next to `"maps edit/write/read tool targets to a file name"`:

```ts
    it("keeps the full path of a file tool beside its base name", () => {
        const entries = projectOpencodeTranscript([
            `{"type":"tool","name":"edit","state":"completed","input":"{\\"filePath\\":\\"/a/b/auth.go\\"}","ts":1}`,
        ]);
        expect(entries[0]).toMatchObject({ target: "auth.go", path: "/a/b/auth.go" });
    });
```

- [ ] **Step 2: Run them and watch them fail**

Run:
`npx vitest run frontend/app/view/agents/transcriptprojection.test.ts frontend/app/view/agents/pitranscriptprojection.test.ts frontend/app/view/agents/opencodetranscriptprojection.test.ts`

Expected: the new tests FAIL (no `path`), and the edited order test FAILS.

- [ ] **Step 3: Carry the path**

In `agentsviewmodel.ts`, add to the `kind: "action"` member of `AgentEntry`, after `target: string;`:

```ts
          path?: string; // the file the tool touched, in full, when it names one; target keeps the base name
```

- **Claude** (`transcriptprojection.ts`): right after
  `const action: ActionEntry = { kind: "action", verb: verbFor(block.name), target: targetFor(block.input) };`, add:

```ts
                    if (typeof block.input?.file_path === "string" && block.input.file_path !== "") {
                        action.path = block.input.file_path;
                    }
```

- **pi** (`pitranscriptprojection.ts`): right after its `const action: ActionEntry = { … targetFor(b.name, args) };`,
  add:

```ts
        const p = args != null && typeof args === "object" ? (args as Record<string, unknown>).path : undefined;
        if (typeof p === "string" && p !== "") {
            action.path = p;
        }
```

- **opencode** (`opencodetranscriptprojection.ts`): right after its
  `const action: any = { kind: "action", verb: verbFor(rec.name), target: targetFor(rec.name, input) };`, add:

```ts
            const p = filePathOf(input);
            if (p != null) {
                action.path = p;
            }
```

  Also add, next to its `targetFor`:

```ts
// the full path a file tool's JSON input names, if any
function filePathOf(input: string): string | null {
    try {
        const args = JSON.parse(input);
        for (const key of ["filePath", "file_path"]) {
            if (typeof args?.[key] === "string" && args[key] !== "") {
                return args[key];
            }
        }
    } catch {
        // not JSON: a bash command or a bare name
    }
    return null;
}
```

- [ ] **Step 4: Run the projector tests and watch them pass**

Run the command from Step 2. Expected: PASS.

If another test in those three files now fails because it pins an action with `toEqual`, add the `path` it now carries
to that expectation. Do not drop the field.

Also run `npx vitest run frontend/app/view/agents/agentsviewmodel.test.ts frontend/app/view/agents/codextranscriptprojection.test.ts`,
which pin `edited` actions too. Expected: PASS. Codex does not set `path`, and `groupTimeline` copies entries as they
are.

- [ ] **Step 5: The context and the link**

`pathlinkcontext.tsx`:

```tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agent a transcript belongs to, for its file path links. A transcript with no agent around it (a session read
// from disk on its own) has no provider, and its paths stay plain text.

import { cn, fireAndForget } from "@/util/util";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentVM } from "./agentsviewmodel";
import { openAgentPath } from "./pathlinkroute";

export interface PathOpener {
    open: (path: string, line?: number) => void;
}

const PathLinkContext = createContext<PathOpener | null>(null);

export function AgentPathLinks({ agent, children }: { agent: AgentVM; children: ReactNode }) {
    const opener = useMemo<PathOpener>(
        () => ({ open: (path, line) => fireAndForget(() => openAgentPath(agent, path, line)) }),
        [agent]
    );
    return <PathLinkContext.Provider value={opener}>{children}</PathLinkContext.Provider>;
}

// a path as a link when an agent is in context, else its children as they are
export function PathLink({
    path,
    line,
    className,
    children,
}: {
    path: string;
    line?: number;
    className?: string;
    children: ReactNode;
}) {
    const opener = useContext(PathLinkContext);
    if (opener == null) {
        return <span className={className}>{children}</span>;
    }
    return (
        <button
            type="button"
            data-path-link={path}
            title={`Open ${path}${line != null ? `:${line}` : ""} beside the agent`}
            onClick={(e) => {
                // the row around it opens the tool detail
                e.stopPropagation();
                opener.open(path, line);
            }}
            className={cn(
                "min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left hover:text-accent-soft hover:underline",
                className
            )}
        >
            {children}
        </button>
    );
}
```

- [ ] **Step 6: Tool rows**

In `narrationtimeline.tsx`'s `ToolLine`, replace the target span
`<span className={cn(TARGET, detail?.kind === "bash" && "font-mono")}>{action.target}</span>` with:

```tsx
                {action.path != null ? (
                    <PathLink path={action.path} className={TARGET}>
                        {action.target}
                    </PathLink>
                ) : (
                    <span className={cn(TARGET, detail?.kind === "bash" && "font-mono")}>{action.target}</span>
                )}
```

Then add `import { PathLink } from "./pathlinkcontext";`.

- [ ] **Step 7: Inline code**

In `markdownmessage.tsx`, add a `code` entry to `MD_COMPONENTS`. Fenced code still goes through the `pre` override,
which reads this element's `className` and `children` props, so those must pass through unchanged:

```tsx
    code: ({ className, children }) => {
        const text = typeof children === "string" ? children : null;
        const found = className == null && text != null ? inlinePathOf(text) : null;
        if (found == null) {
            return <code className={className}>{children}</code>;
        }
        return (
            <PathLink path={found.path} line={found.line}>
                <code>{children}</code>
            </PathLink>
        );
    },
```

Then add `import { PathLink } from "./pathlinkcontext";` and `import { inlinePathOf } from "./pathlinks";`.

- [ ] **Step 8: Give the transcripts their agent**

Wrap each of these in `<AgentPathLinks agent={…}>…</AgentPathLinks>`, importing it from `./pathlinkcontext`:

- `agentrow.tsx`: the `<NarrationTimeline … />` element inside `AgentRow`, with `agent={agent}`.
- `leadcard.tsx`: the `<NarrationTimeline … />` element inside `LeadTranscript`, with `agent={lead}`.
- `runworkercard.tsx`: both `<NarrationTimeline … />` elements, with the card's `agent`.
- `endedtranscript.tsx`: the `<CompactTranscript … />` element, with the component's `agent`.

Leave `sessionsdetail.tsx`'s `CompactTranscript` and `subagentinterior.tsx` unwrapped. A session read from disk has no
live agent and no panel, and a subagent's paths would open in its parent's panel without saying so.

- [ ] **Step 9: Lint, commit**

```bash
npx prettier --check frontend/app/view/agents/pathlinkcontext.tsx
npx eslint frontend/app/view/agents/pathlinkcontext.tsx frontend/app/view/agents/narrationtimeline.tsx \
  frontend/app/view/agents/markdownmessage.tsx frontend/app/view/agents/transcriptprojection.ts \
  frontend/app/view/agents/pitranscriptprojection.ts frontend/app/view/agents/opencodetranscriptprojection.ts \
  frontend/app/view/agents/agentrow.tsx frontend/app/view/agents/leadcard.tsx frontend/app/view/agents/runworkercard.tsx \
  frontend/app/view/agents/endedtranscript.tsx frontend/app/view/agents/agentsviewmodel.ts
git add frontend/app/view/agents/agentsviewmodel.ts frontend/app/view/agents/transcriptprojection.ts \
  frontend/app/view/agents/transcriptprojection.test.ts frontend/app/view/agents/pitranscriptprojection.ts \
  frontend/app/view/agents/pitranscriptprojection.test.ts frontend/app/view/agents/opencodetranscriptprojection.ts \
  frontend/app/view/agents/opencodetranscriptprojection.test.ts frontend/app/view/agents/pathlinkcontext.tsx \
  frontend/app/view/agents/narrationtimeline.tsx frontend/app/view/agents/markdownmessage.tsx \
  frontend/app/view/agents/agentrow.tsx frontend/app/view/agents/leadcard.tsx \
  frontend/app/view/agents/runworkercard.tsx frontend/app/view/agents/endedtranscript.tsx
git commit -m "feat(agents): file paths in transcripts and Cockpit cards open beside their agent"
```

---

### Task 8: The palette's file pick

**Depends on:** Task 6

**Files:**
- Modify: `frontend/app/cockpit/command-palette.tsx`

- [ ] **Step 1: Route the pick**

In the file item's `run` (the one calling
`openInCode(model, { projectPath: fileTarget.path, rel: f.path, line: fg.line })`), replace the body with:

```ts
                run: () => {
                    close();
                    // on the Agent surface, a file under the focused agent's directory opens in its panel
                    if (openInFocusedPanel(model, joinRepoPath(fileTarget.path, f.path), fg.line ?? undefined)) {
                        return;
                    }
                    fireAndForget(() =>
                        openInCode(model, { projectPath: fileTarget.path, rel: f.path, line: fg.line })
                    );
                },
```

Then add `import { openInFocusedPanel } from "@/app/view/agents/pathlinkroute";` and, if missing,
`import { joinRepoPath } from "@/util/paths";`. If `fg.line` is typed `number | undefined` already, drop the
`?? undefined`.

- [ ] **Step 2: Lint, commit**

```bash
npx eslint frontend/app/cockpit/command-palette.tsx
git add frontend/app/cockpit/command-palette.tsx
git commit -m "feat(palette): a file picked on the Agent surface opens in the focused agent's panel"
```

The decision itself is unit-tested in Task 6 (`focusedPanelAgent`).

---

### Task 9: The `agent-rail-tabs` CDP scenario

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7, Task 8

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (a new scenario, registered in `SCENARIOS`; `readFileSync` added to the `node:fs`
  import)

The scenario covers four things:
- **Overview:** the tab strip, and the fixture agent's Files changed listing `a.txt`.
- **A Cockpit card's tool row:** clicking `a.txt` opens the File tab, at 520px.
- **A plain terminal:** a printed `…\a.txt:2` is a link, and following it opens the Code surface on `a.txt`.
- **The nav:** its two groups, and Ctrl+4 opening Usage.

It uses the file's existing helpers: `ahReload`, `polishWaitFor`, `waveService`, `openRailTerminal`, `uploadsShellUp`,
`uploadsTermHas`, `UI_ROUTE`, `TREE_RAIL_FIXTURE` and `RAIL_VISIBLE_KEY`. Read each before using it.

- [ ] **Step 1: Write the scenario**

Add next to `agentRailSections`:

```js
// The Agent panel's tabs and file path links (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md). A fixture
// agent works in a temp repo where a.txt is modified; its transcript edited a.txt. A plain terminal (started in ~: a
// shell in the temp dir would lock it until the app exits) prints a.txt's absolute path with :2. The user's fixture
// roster and the panel's keys are put back in teardown.
const RAIL_TABS_AGENT = "fx-rail-tabs";
const RAIL_TABS_BLOCK = "fx-blk-rail-tabs";
const RAIL_TABS_PROJECT = "rail-tabs";
const RAIL_TABS_KEYS = [RAIL_VISIBLE_KEY, "agent.rail.tab", "agent.rail.wideWidth", "code.project.last"];
const RAIL_TABS_ASIDE = `document.querySelector('aside[aria-label="Agent details"]')`;
const railTabLabels = `[...(${RAIL_TABS_ASIDE}?.querySelectorAll('[role="tab"]') ?? [])].map((t) => t.getAttribute("aria-label") + (t.getAttribute("aria-selected") === "true" ? "*" : ""))`;
const railTabsWidth = `Math.round(${RAIL_TABS_ASIDE}?.getBoundingClientRect().width ?? 0)`;

function railTabsRepo(base) {
    const repo = join(base, "repo");
    mkdirSync(repo);
    const git = (...args) =>
        execFileSync("git", ["-C", repo, "-c", "user.email=v@v", "-c", "user.name=v", ...args], { stdio: "pipe" });
    git("init", "-q", "--initial-branch=main");
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    git("add", ".");
    git("commit", "-qm", "seed");
    writeFileSync(join(repo, "a.txt"), "one\nTWO\nthree\n");
    // outside the repo, so it is not one of the repo's changes; cwd on every record is how the rail finds the repo
    const transcript = join(base, "agent.jsonl");
    const rec = (o) => JSON.stringify({ cwd: repo, ...o }) + "\n";
    writeFileSync(
        transcript,
        rec({ type: "user", message: { role: "user", content: [{ type: "text", text: "capitalise line two" }] } }) +
            rec({
                type: "assistant",
                message: {
                    role: "assistant",
                    content: [
                        { type: "tool_use", id: "e1", name: "Edit", input: { file_path: join(repo, "a.txt"), old_string: "two", new_string: "TWO" } },
                    ],
                },
            }) +
            rec({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "e1", is_error: false }] } })
    );
    return { repo, transcript };
}

async function railTabsCtrlKey(h, digit) {
    const key = { key: digit, code: `Digit${digit}`, windowsVirtualKeyCode: 48 + Number(digit), modifiers: 2 };
    await h.cdp("Input.dispatchKeyEvent", { type: "keyDown", ...key });
    await h.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

const agentRailTabs = {
    name: "agent-rail-tabs",
    surface: "agent",
    async arrange(h) {
        const base = mkdtempSync(join(tmpdir(), "verify-rail-tabs-"));
        const ctx = {
            base,
            terminals: [],
            prevFixture: existsSync(TREE_RAIL_FIXTURE) ? readFileSync(TREE_RAIL_FIXTURE, "utf8") : null,
            prevKeys: {},
        };
        try {
            for (const k of RAIL_TABS_KEYS) {
                ctx.prevKeys[k] = await h.ev(`localStorage.getItem(${JSON.stringify(k)})`);
            }
            const { repo, transcript } = railTabsRepo(base);
            ctx.repo = repo;
            const bootTab = String(await h.ev("window.TabRpcClient.routeId")).replace(/^tab:/, "");
            const wslist = await h.rpc("workspacelist", null);
            const ws = wslist.find((w) => (w.workspacedata?.tabids ?? []).includes(bootTab)) ?? wslist[0];
            ctx.workspaceId = ws.workspacedata.oid;
            await openRailTerminal(h, ctx, RAIL_TABS_PROJECT);
            mkdirSync(new URL(".", TREE_RAIL_FIXTURE), { recursive: true });
            writeFileSync(
                TREE_RAIL_FIXTURE,
                JSON.stringify(
                    [
                        {
                            id: RAIL_TABS_AGENT,
                            name: "rail tabs agent",
                            project: RAIL_TABS_PROJECT,
                            task: "capitalise line two",
                            state: "working",
                            agent: "claude",
                            model: "opus",
                            activeMs: 60_000,
                            blockId: RAIL_TABS_BLOCK,
                            transcriptPath: transcript,
                        },
                    ],
                    null,
                    2
                )
            );
            ctx.wroteFixture = true;
            await h.ev(
                `localStorage.setItem(${JSON.stringify(RAIL_VISIBLE_KEY)}, "true"); localStorage.removeItem("agent.rail.tab"); localStorage.removeItem("agent.rail.wideWidth")`
            );
            if (!(await ahReload(h))) throw new Error("the page did not come back after the reload");
            await h.goto("agent");
            ctx.inRoster = await polishWaitFor(h, `!!document.querySelector('[data-agent-terminal="${RAIL_TABS_AGENT}"]')`, 15000);
            if (!ctx.inRoster) return ctx;
            // the Agent surface mounts every terminal's pane, which starts its shell
            const term = ctx.terminals[0];
            ctx.shellUp = await uploadsShellUp(h, term.blockId);
            const line = `echo ${join(repo, "a.txt")}:2\r`;
            await h.rpc("controllerinput", { blockid: term.blockId, inputdata64: Buffer.from(line).toString("base64") });
            ctx.printed = await uploadsTermHas(h, term.blockId, "a.txt:2");
            await h.rpc("uireveal", { address: `agent:${RAIL_TABS_AGENT}` }, UI_ROUTE);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const ready = ctx.arrangeError == null && ctx.inRoster === true;
        const strip = ready && (await polishWaitFor(h, `!!${RAIL_TABS_ASIDE}?.querySelector('[role="tablist"]')`, 8000));
        rec("0. the fixture agent is focused and its rail is a tab strip", strip, ctx.arrangeError ?? JSON.stringify({ inRoster: ctx.inRoster, strip }));
        if (!strip) return steps;

        const listed = await polishWaitFor(h, `(${RAIL_TABS_ASIDE}?.querySelector('[data-rail-section="files"]')?.textContent ?? "").includes("a.txt")`, 10000);
        const tabs1 = await h.ev(railTabLabels);
        const w1 = await h.ev(railTabsWidth);
        await h.shot("cdp-shots/agent-rail-tabs-overview.png");
        rec(
            "1. Overview is the only tab, selected, 300px wide, and Files changed lists a.txt",
            JSON.stringify(tabs1) === JSON.stringify(["Overview*"]) && Math.abs(w1 - 300) <= 2 && listed,
            JSON.stringify({ tabs1, w1, listed })
        );

        await h.goto("cockpit");
        const linkSel = `document.querySelector('[data-cockpit-surface] [data-agent-id="${RAIL_TABS_AGENT}"] [data-path-link]')`;
        const linked = await polishWaitFor(h, `!!${linkSel}`, 15000);
        if (linked) await h.ev(`${linkSel}.click()`);
        const opened = linked && (await polishWaitFor(h, `!!${RAIL_TABS_ASIDE}?.querySelector('[data-rail-file] .monaco-editor')`, 10000));
        const surface2 = await h.activeSurfaceLabel();
        const tabs2 = await h.ev(railTabLabels);
        const w2 = await h.ev(railTabsWidth);
        // 520, unless the window leaves less: the centre keeps 640 beside the nav (56 below 900px) and the tree
        const wide = await h.ev(`Math.max(360, Math.min(520, window.innerWidth - (window.innerWidth < 900 ? 56 : 78) - 248 - 640))`);
        await h.shot("cdp-shots/agent-rail-tabs-file.png");
        rec(
            "2. a.txt in the Cockpit card's tool row opens the Agent surface with a.txt on the File tab, at the wide width",
            linked && opened && surface2 === "Agent" && JSON.stringify(tabs2) === JSON.stringify(["Overview", "File a.txt*"]) && Math.abs(w2 - wide) <= 2,
            JSON.stringify({ linked, opened, surface2, tabs2, w2, wide })
        );

        await h.ev(`${RAIL_TABS_ASIDE}?.querySelector('[data-rail-tab="overview"]')?.click()`);
        await new Promise((r) => setTimeout(r, 300));
        const w3 = await h.ev(railTabsWidth);
        await h.ev(`${RAIL_TABS_ASIDE}?.querySelector('[aria-label="Close file"]')?.click()`);
        await new Promise((r) => setTimeout(r, 300));
        const tabs3 = await h.ev(railTabLabels);
        rec(
            "3. Overview is back to 300px, and closing the file leaves Overview alone",
            Math.abs(w3 - 300) <= 2 && JSON.stringify(tabs3) === JSON.stringify(["Overview*"]),
            JSON.stringify({ w3, tabs3 })
        );

        const term = ctx.terminals[0];
        const scan = ctx.printed ? await h.ev(`window.__arcTermPathLinks?.scan(${JSON.stringify(term.blockId)})`) : null;
        const hit = (scan ?? []).find((l) => /a\.txt:2$/.test(l.text) && /\/a\.txt$/i.test(l.abs) && l.line === 2);
        if (hit) await h.ev(`window.__arcTermPathLinks.open(${JSON.stringify(term.blockId)}, ${JSON.stringify(hit.text)})`);
        const onCode = hit != null && (await polishWaitFor(h, `(() => { try { return (JSON.parse(localStorage.getItem("code.project.last") ?? "null")?.path ?? "").toLowerCase().replace(/\\\\/g, "/").endsWith("/repo"); } catch { return false; } })()`, 8000));
        const surface4 = await h.activeSurfaceLabel();
        rec(
            "4. the plain terminal's printed a.txt:2 is a link, and following it opens the Code surface on the repo",
            ctx.shellUp === true && ctx.printed === true && hit != null && onCode && surface4 === "Code",
            JSON.stringify({ shellUp: ctx.shellUp, printed: ctx.printed, scan, onCode, surface4 })
        );

        const nav = await h.ev(`[...document.querySelectorAll("nav button")].map((b) => b.getAttribute("aria-label"))`);
        const divider = await h.ev(`!!document.querySelector("nav [data-nav-divider]")`);
        // out of the Code surface's editor, which would take the key
        await h.ev(`document.activeElement?.blur?.()`);
        await railTabsCtrlKey(h, "4");
        await new Promise((r) => setTimeout(r, 800));
        const afterChord = await h.activeSurfaceLabel();
        await h.shot("cdp-shots/agent-rail-tabs-nav.png");
        rec(
            "5. the nav lists the core surfaces, a divider, then the tools, and Ctrl+4 opens Usage",
            JSON.stringify(nav) === JSON.stringify(["Cockpit", "Jarvis", "Agent", "Usage", "Code", "Diff", "Radar", "Setup", "Settings"]) &&
                divider &&
                afterChord === "Usage",
            JSON.stringify({ nav, divider, afterChord })
        );
        return steps;
    },
    async teardown(h, ctx) {
        const step = async (what, fn) => {
            try {
                await fn();
            } catch (e) {
                console.error(`agent-rail-tabs teardown: ${what} failed: ${e?.message ?? e}`);
            }
        };
        for (const t of ctx.terminals ?? []) {
            await step("close the terminal", () => waveService(h, "workspace", "CloseTab", [ctx.workspaceId, t.tabId, false]));
        }
        if (ctx.wroteFixture) {
            await step("restore the fixture roster", () =>
                ctx.prevFixture != null ? writeFileSync(TREE_RAIL_FIXTURE, ctx.prevFixture) : rmSync(TREE_RAIL_FIXTURE, { force: true })
            );
        }
        await step("restore the panel's keys", async () => {
            for (const [k, v] of Object.entries(ctx.prevKeys ?? {})) {
                await h.ev(v == null ? `localStorage.removeItem(${JSON.stringify(k)})` : `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
            }
        });
        await step("reload onto the restored roster", () => ahReload(h));
        await step("remove the temp dir", () => rmSync(ctx.base, { recursive: true, force: true }));
    },
};
```

Then:
- Add `agentRailTabs,` at the end of the `SCENARIOS` array.
- Add `readFileSync` to the `node:fs` import at the top of the file.

Before relying on the helpers, check three things:
- **`uploadsShellUp` and `uploadsTermHas` return booleans.** If either returns something else, adapt the two `ctx`
  fields.
- **`code.project.last` holds the project as JSON with a `path`** (`lastCodeProjectAtom` in `codestore.ts`). If not,
  assert the Code surface's open file another way. Read `codepathbar.tsx` for an element that names it.
- **`openRailTerminal` sets the shell's cwd to `~`.** That is why the echo prints an absolute path: a relative one has
  nothing to resolve against.

- [ ] **Step 2: Run it against the dev app**

The dev app must be running (`task dev`) with this branch's frontend loaded through HMR. Back up the user's fixture
first, run the scenario, then put the fixture back:

```bash
cp public/cockpit-fixtures/active.json cdp-shots/active.json.bak 2>/dev/null; true
node scripts/cdp/verify.mjs agent-rail-tabs
cp cdp-shots/active.json.bak public/cockpit-fixtures/active.json 2>/dev/null; true
```

Expected: steps 0–5 PASS. Open `cdp-shots/agent-rail-tabs-*.png` and look at each:
- **overview:** the strip with one icon, and the sections under it.
- **file:** a.txt at 520px, with the grip on the left edge.
- **nav:** the divider between Usage and Code.

A step that fails is a bug in the code or in the scenario's assumption. Find which before changing either.

- [ ] **Step 3: Commit**

```bash
git add scripts/cdp/scenarios.mjs
git commit -m "test(cdp): agent-rail-tabs, the panel's tabs and the file path links"
```

---

### Task 10: Check the whole and hand over

**Depends on:** Task 9

- [ ] **Step 1: The touched tests, once more**

```bash
npx vitest run frontend/app/view/agents/pathlinks.test.ts frontend/app/view/agents/agentrailtabs.test.ts \
  frontend/app/view/agents/pathlinkroute.test.ts frontend/app/view/agents/transcriptprojection.test.ts \
  frontend/app/view/agents/pitranscriptprojection.test.ts frontend/app/view/agents/opencodetranscriptprojection.test.ts \
  frontend/app/view/agents/surfaceorder.test.ts frontend/app/view/agents/radarnav.test.ts \
  frontend/app/store/keybindings/bindings.test.ts frontend/app/view/agents/agentsviewmodel.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Typecheck (ask the user first: about 2 minutes, and the machine lags)**

Run: `task check:ts` with a timeout above 2 minutes. Expected: exit 0. The baseline is clean, so any error is this
plan's.

- [ ] **Step 3: The neighbouring scenarios**

Back up the fixture as in Task 9 (`cdp-shots/active.json.bak`), then run:

```bash
node scripts/cdp/verify.mjs agent-rail-tabs agent-rail-sections agent-history surface-smoke
```

Restore the fixture afterwards. `agent-rail-sections` and `agent-history` delete it in their teardown, so the restore is
not optional.

Expected: all PASS. `agent-rail-sections` still finds every section under the strip, and `agent-history` runs with the
new chord numbers.

- [ ] **Step 4: Shortcuts doc**

In `docs/keyboard-shortcuts.md`'s Agent surface section, add two rows:
- the panel's tab strip: `←` / `→` / `Home` / `End` while it has focus;
- `Esc` in the File tab closes the file.

```bash
git add docs/keyboard-shortcuts.md
git commit -m "docs: the Agent panel's tab keys"
```

- [ ] **Step 5: Hand over**

Tell the user:
- what changed;
- the scenario's screenshots (`cdp-shots/agent-rail-tabs-*.png`);
- that the Review tab waits for line review, and the Terminal tab is phase 2.

Keep the mockup folder `.superpowers/design/agent-rail-tabs/` until the Review tab ships, because its Review board is
that plan's reference.
