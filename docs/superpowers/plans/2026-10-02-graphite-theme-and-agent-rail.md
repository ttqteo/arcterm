# Graphite theme, Vietnamese-safe fonts, sectioned agent rail — Implementation Plan

**Verify:** `node scripts/verify.mjs ./pkg/wconfig/...`
**Check:** `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`
**Final:** `node scripts/cdp/final-verify.mjs agent-tree-rail surface-smoke`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement your task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not spawn subagents or forks.

**Goal:** A neutral, Antigravity-like `graphite` preset becomes the default theme; Inter and a Vietnamese-capable
JetBrains Mono become the default fonts; the Agent surface's details rail becomes a stable list of counted,
collapsible sections, including a new Background tasks section derived from the transcript.

**Architecture:** Theme work is data only (a new `THEMES` entry, `@theme` literals, one new token). The rail gets
an optional `header` on `RailSection`; `CollapsibleRail` draws the header row and owns open state through a pure
helper (`railsections.ts`). Which sections the Agent rail shows, in what order and with which counts, is a pure
`planAgentRail` in `agentrailsections.ts`. Background tasks come from a pure `extractBackgroundTasks(lines)` fed
by the transcript tail `refreshSubagents` already reads.

**Tech Stack:** React 19, jotai, TypeScript, vitest, Tailwind 4, CDP scenarios (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-02-graphite-theme-and-agent-rail-design.md` — read it in full before
your task.

## Global Constraints

- Colors only from `@theme` tokens; no raw hex/rgba in components (`className`/`style`). Hex lives only in
  `frontend/tailwindsetup.css` and `themes.ts`.
- Testable logic in a pure `foo.ts` with `foo.test.ts` beside it; `.tsx` stays thin. No jsdom/render tests.
- No Go type or RPC change; no `task generate`.
- Typecheck with the Check command above, never `npx tsc`, never `task check:ts` inside a worktree.
- Visible text in the rail is never under 10.5px (`agent-tree-rail` step 5 enforces it).
- Prettier-check only the files you touched (`npx prettier --check <files>`); never `--write` the tree, never
  run prettier on `scripts/*.mjs`.

---

### Task 1: Graphite preset as the default theme

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/themes.ts` (THEMES head, new `DEFAULT_THEME_PRESET`)
- Modify: `frontend/app/view/agents/themestore.ts:13-15`
- Modify: `frontend/tailwindsetup.css` (`@theme` color literals, new token, scrollbar, `.agent-md code`)
- Modify: `frontend/app/element/markdown.scss:135-176`
- Test: `frontend/app/view/agents/themes.test.ts`

- [ ] **Step 1: Write the failing tests.** In `themes.test.ts`:

  Replace the whole `describe("buildThemeVars — Midnight parity", …)` block with a parity check that reads the
  CSS file, so the guard follows whichever preset is the default:

  ```ts
  import { readFileSync } from "node:fs";
  // (add DEFAULT_THEME_PRESET to the existing "./themes" import)

  const THEME_CSS = readFileSync(new URL("../../../tailwindsetup.css", import.meta.url), "utf8");
  function themeLiteral(name: string): string | undefined {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(THEME_CSS);
      return m ? m[1].replace(/\s+/g, " ").trim() : undefined;
  }

  describe("buildThemeVars — the default preset equals the @theme literals", () => {
      // first paint (before useApplyCockpitTheme) uses the literals; they must equal the default preset or the
      // app flashes another theme on boot
      const keys = [
          "--color-background", "--color-surface", "--color-surface-raised", "--color-surface-hover",
          "--color-surface-selected", "--color-surface-code", "--color-panel", "--color-modalbg",
          "--color-foreground", "--color-primary", "--color-white", "--color-secondary", "--color-muted",
          "--color-ink-faint", "--color-border", "--color-edge-mid", "--color-edge-strong", "--color-edge-faint",
          "--color-accent", "--color-error", "--color-warning", "--color-asking", "--color-success",
      ];
      const vars = buildThemeVars(activePalette(DEFAULT_THEME_PRESET), {});
      for (const k of keys) {
          it(`${k} matches tailwindsetup.css`, () => expect(vars[k]).toBe(themeLiteral(k)));
      }
  });

  describe("graphite — contrast floor (DESIGN.md)", () => {
      const p = activePalette("graphite");
      it("muted clears 4.5:1 on the background and on a hovered row", () => {
          expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(p.muted, p.surfaceHover)).toBeGreaterThanOrEqual(4.5);
      });
      it("ink-faint clears the 3:1 non-text minimum on the background", () => {
          expect(contrast(p.inkFaint, p.bg)).toBeGreaterThanOrEqual(3);
      });
  });
  ```

  (Format the `keys` array one per line; `contrast` is the function declared further down the file — function
  declarations are hoisted.) In the `helpers` block change:
  - `"activePalette falls back to midnight for unknown id"` → `"activePalette falls back to the default preset for
    an unknown id"`, asserting `expect(activePalette("nope")).toBe(activePalette(DEFAULT_THEME_PRESET))`;
  - `"THEMES ships the six dark presets…"` → seven, plus `expect(THEMES[0].id).toBe(DEFAULT_THEME_PRESET)`.

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run frontend/app/view/agents/themes.test.ts` → fails
  (`DEFAULT_THEME_PRESET` not exported from `./themes`, no `graphite`).

- [ ] **Step 3: Implement.**

  `themes.ts` — above `THEMES`:

  ```ts
  // The preset a user who never picked one sees. It must equal the @theme literals in tailwindsetup.css (first
  // paint) — guarded by themes.test.ts — and be THEMES[0], which activePalette falls back to.
  export const DEFAULT_THEME_PRESET = "graphite";
  ```

  and as the **first** `THEMES` entry (midnight stays, second; update its comment to "the previous default"):

  ```ts
  {
      id: "graphite",
      name: "Graphite",
      // Neutral greys after Antigravity's agent manager: regions separated by tone, not lines. muted and inkFaint
      // are lifted above Antigravity's #6e6e6e to the DESIGN.md contrast floor.
      palette: {
          bg: "#101010",
          surface: "#161616",
          surfaceRaised: "#1c1c1c",
          surfaceHover: "#252525",
          surfaceSelected: "#2d2d2d",
          code: "#0c0c0c",
          border: "#1f1f1f",
          edgeMid: "#2a2a2a",
          edgeStrong: "#3d3d3d",
          edgeFaint: "#1a1a1a",
          text: "#d6d6d6",
          secondary: "#cccccc",
          muted: "#8e8e8e",
          inkFaint: "#666666",
          accent: "#5e9cff",
          success: "#54c79a",
          warning: "#e6b450",
          error: "#e0726c",
      },
  },
  ```

  `themestore.ts` — delete the local constant and its comment; re-export instead (settingssurface imports it from
  here):

  ```ts
  import { activePalette, applyThemeVars, buildThemeVars, DEFAULT_THEME_PRESET, type OverrideRole } from "./themes";

  // Exported so the Settings surface can mark the row changed and revert it without restating the literal.
  export { DEFAULT_THEME_PRESET };
  ```

  `tailwindsetup.css` `@theme` — set these literals (leave every other token alone):

  | token | value |
  |---|---|
  | `--color-background` | `#101010` |
  | `--color-surface` | `#161616` |
  | `--color-surface-raised` | `#1c1c1c` |
  | `--color-surface-hover` | `#252525` |
  | `--color-surface-code` | `#0c0c0c` |
  | `--color-surface-selected` | `#2d2d2d` |
  | `--color-panel` | `rgba(28, 28, 28, 0.6)` |
  | `--color-modalbg` | `#1c1c1c` |
  | `--color-lane` | `#141414` |
  | `--color-foreground`, `--color-white`, `--color-primary` | `#d6d6d6` |
  | `--color-secondary` | `#cccccc` |
  | `--color-muted-foreground` | `#c9c9c9` |
  | `--color-ink-hi` | `#e3e3e3` |
  | `--color-ink-mid` | `#a2a2a2` |
  | `--color-muted` | `#8e8e8e` |
  | `--color-ink-faint` | `#666666` |
  | `--color-border` | `#1f1f1f` |
  | `--color-edge-mid` | `#2a2a2a` |
  | `--color-edge-strong` | `#3d3d3d` |
  | `--color-edge-faint` | `#1a1a1a` |
  | `--color-cacheread` | `#656565` |
  | `--color-feed-label` | `#7e7e7e` |
  | `--color-feed-summary` | `#a2a2a2` |
  | `--color-feed-time` | `#555555` |
  | `--color-feed-glyph` | `#4b4b4b` |

  The non-themed greys (`muted-foreground`, `ink-hi`, `ink-mid`, `lane`, `feed-*`, `cacheread`) are the
  same-luminance neutral of their old blue-grey. Rewrite the contrast comment above `--color-muted` with the new
  ratios against `#101010`: ink-faint 3.31 < muted 5.81 < secondary 11.85 < text 13.09; muted on a hovered row
  4.68. Add after the syntax tokens:

  ```css
  /* inline code in markdown + transcript narration (Antigravity's warm gold); theme-agnostic like syntax */
  --color-code-inline: #d7b981;
  ```

  Scrollbar thumb: `background: #262c34` → `var(--color-edge-mid)`, hover `#343c46` → `var(--color-edge-strong)`.

  `.agent-md code` gains `color: var(--color-code-inline);` and add right after it:

  ```css
  .agent-md pre code {
      color: inherit;
      background: transparent;
      padding: 0;
  }
  ```

  `markdown.scss`: in the inline `code { … }` rule (line ~171) change `color: var(--color-foreground)` to
  `color: var(--color-code-inline)`; in `pre.codeblock { code { … } }` add `color: var(--color-foreground);` so
  fenced blocks keep their color.

- [ ] **Step 4: Run, expect PASS.** `npx vitest run frontend/app/view/agents/ frontend/app/cockpit/` (palette
  commands list THEMES too). Fix any test that pinned the old default *only* by pointing it at
  `DEFAULT_THEME_PRESET`; tests that name `"midnight"` on purpose (ANSI golden set, deriveTermTheme) stay.

- [ ] **Step 5: Check + commit.** Run the Check command (exit 0), then
  `git commit -m "feat(theme): Graphite preset as the default theme"` with the touched files.

---

### Task 2: Inter + Vietnamese-capable JetBrains Mono as default fonts

**Depends on:** none

**Files:**
- Create: `public/fonts/jetbrains-mono-variable.woff2`
- Modify: `frontend/util/fontutil.ts:16-39`
- Modify: `frontend/app/view/agents/fonts.ts:15-29`
- Modify: `frontend/app/view/term/term.tsx:141`
- Modify: `frontend/tailwindsetup.css` (`--font-sans` only)
- Modify: `pkg/wconfig/defaultconfig/settings.json:12`
- Test: `frontend/app/view/agents/fonts.test.ts`

- [ ] **Step 1: Write the failing test** in `fonts.test.ts` (import `DEFAULT_TERM_FONT` too):

  ```ts
  describe("defaults", () => {
      // the bundled Hanken Grotesk, Hack and Fira Code have no Vietnamese; Inter and the variable JetBrains Mono do
      it("default faces are the Vietnamese-capable ones", () => {
          expect(DEFAULT_SANS).toBe("inter");
          expect(DEFAULT_MONO).toBe("jetbrains");
          expect(DEFAULT_TERM_FONT).toBe("jetbrains");
      });
      it("each list leads with its default, so stackOf's fallback is the default", () => {
          expect(SANS_FONTS[0].id).toBe(DEFAULT_SANS);
          expect(MONO_FONTS[0].id).toBe(DEFAULT_MONO);
      });
  });
  ```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run frontend/app/view/agents/fonts.test.ts`.

- [ ] **Step 3: Implement.**
  - Download the official variable webfont (OFL):
    `curl -sSL -o public/fonts/jetbrains-mono-variable.woff2 "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/webfonts/JetBrainsMono%5Bwght%5D.woff2"`
    (~113 KB, 1372 glyphs, wght 100–800). Keep the old `jetbrains-mono-v13-latin-*.woff2` files:
    `docs/prototype/*.html` still reference them.
  - `fontutil.ts` `loadJetBrainsMonoFont` body becomes one face:

    ```ts
    // variable font with the full charset (Vietnamese included); the v13 latin files it replaces had 222 glyphs
    const jbmFont = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-variable.woff2')", {
        style: "normal",
        weight: "100 800",
    });
    addToFontFaceSet(document.fonts, jbmFont);
    jbmFont.load();
    ```
  - `fonts.ts`: move the `inter` entry to the top of `SANS_FONTS`; `DEFAULT_SANS = "inter"`;
    `DEFAULT_TERM_FONT = "jetbrains"` (comment: "matches term.tsx's fallback and defaultconfig's
    term:fontfamily").
  - `term.tsx:141`: fallback `"Hack"` → `stackOf(MONO_FONTS, DEFAULT_TERM_FONT)` (import from
    `@/app/view/agents/fonts`).
  - `settings.json:12`: `"term:fontfamily": "\"JetBrains Mono\", monospace",` — the exact catalog stack, so the
    Settings control resolves it to an id (today `"Fira Code"` matches no stack and the control shows Hack while
    the terminal draws Fira Code).
  - `tailwindsetup.css`: `--font-sans: "Inter", system-ui, sans-serif;`

- [ ] **Step 4: Run, expect PASS.** `npx vitest run frontend/app/view/agents/fonts.test.ts` and
  `go test ./pkg/wconfig/...`.

- [ ] **Step 5: Check + commit.** Check command, then
  `git commit -m "feat(fonts): Inter and a Vietnamese-capable JetBrains Mono by default"`.

---

### Task 3: `extractBackgroundTasks` from the transcript

**Depends on:** none

**Files:**
- Modify: `frontend/app/view/agents/transcriptprojection.ts` (append after `extractSubagentSpawns`)
- Test: `frontend/app/view/agents/transcriptprojection.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append; add `extractBackgroundTasks` to the import):

  ```ts
  describe("extractBackgroundTasks", () => {
      const asst = (blocks: any[]) => JSON.stringify({ type: "assistant", message: { content: blocks } });
      const result = (id: string, text: string, extra: object = {}) =>
          JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] }, ...extra });
      const notify = (toolUseId: string, status: string) =>
          JSON.stringify({
              type: "user",
              message: {
                  content: `<task-notification>\n<task-id>x</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>s</summary>\n</task-notification>`,
              },
          });
      const bash = (id: string, input: object) => asst([{ type: "tool_use", id, name: "Bash", input }]);

      it("an explicit background command is running until its notification lands", () => {
          const start = [
              bash("t1", { command: "npm test", description: "Run tests", run_in_background: true }),
              result("t1", "Command running in background with ID: b1abc"),
          ];
          expect(extractBackgroundTasks(start)).toEqual([
              { toolUseId: "t1", taskId: "b1abc", label: "Run tests", command: "npm test", status: "running" },
          ]);
          expect(extractBackgroundTasks([...start, notify("t1", "completed")])[0].status).toBe("completed");
          expect(extractBackgroundTasks([...start, notify("t1", "failed")])[0].status).toBe("failed");
          expect(extractBackgroundTasks([...start, notify("t1", "killed")])[0].status).toBe("stopped");
      });

      it("a foreground command that timed out into the background is a task too", () => {
          const lines = [
              bash("t2", { command: "cargo build", description: "Build" }),
              result("t2", "", { toolUseResult: { backgroundTaskId: "b2", timedOutAfterMs: 120000 } }),
          ];
          expect(extractBackgroundTasks(lines)).toEqual([
              { toolUseId: "t2", taskId: "b2", label: "Build", command: "cargo build", status: "running" },
          ]);
      });

      it("a plain foreground command is not a task", () => {
          expect(extractBackgroundTasks([bash("t3", { command: "ls" }), result("t3", "a\nb")])).toEqual([]);
      });

      it("TaskStop on its id stops it", () => {
          const lines = [
              bash("t4", { command: "npm run dev", run_in_background: true }),
              result("t4", "", { toolUseResult: { backgroundTaskId: "b4" } }),
              asst([{ type: "tool_use", id: "s1", name: "TaskStop", input: { task_id: "b4" } }]),
          ];
          expect(extractBackgroundTasks(lines)[0]).toMatchObject({ label: "npm run dev", status: "stopped" });
      });

      it("a notification queued as a queue-operation record still resolves the task", () => {
          const lines = [
              bash("t5", { command: "go test ./...", run_in_background: true }),
              JSON.stringify({
                  type: "queue-operation",
                  content: "<task-notification><tool-use-id>t5</tool-use-id><status>completed</status></task-notification>",
              }),
          ];
          expect(extractBackgroundTasks(lines)[0].status).toBe("completed");
      });

      it("a start whose result is not in the tail stays running with no task id", () => {
          expect(extractBackgroundTasks([bash("t6", { command: "sleep 99", run_in_background: true })])).toEqual([
              { toolUseId: "t6", label: "sleep 99", command: "sleep 99", status: "running" },
          ]);
      });
  });
  ```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run frontend/app/view/agents/transcriptprojection.test.ts -t extractBackgroundTasks`.

- [ ] **Step 3: Implement** (append to `transcriptprojection.ts`):

  ```ts
  export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped";

  export interface BackgroundTask {
      toolUseId: string;
      taskId?: string;
      label: string;
      command?: string;
      status: BackgroundTaskStatus;
  }

  const BG_ID_TEXT = /running in background with ID: ([A-Za-z0-9_-]+)/;

  // <task-notification> status -> ours; "killed" and "stopped" are the same thing to the reader
  const NOTIFIED_STATUS: Record<string, BackgroundTaskStatus> = {
      running: "running",
      completed: "completed",
      failed: "failed",
      killed: "stopped",
      stopped: "stopped",
  };

  function toolResultText(block: any): string {
      const c = block?.content;
      if (typeof c === "string") {
          return c;
      }
      return Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "";
  }

  // A notification can arrive as a user message, a queue-operation's content or a queued-command attachment, so
  // every string in the record that carries the tag is read rather than one known field.
  function notificationTexts(rec: any): string[] {
      const out: string[] = [];
      const visit = (v: any, depth: number): void => {
          if (typeof v === "string") {
              if (v.includes("<task-notification>")) {
                  out.push(v);
              }
              return;
          }
          if (depth >= 5 || v == null || typeof v !== "object") {
              return;
          }
          for (const k of Object.keys(v)) {
              visit(v[k], depth + 1);
          }
      };
      visit(rec, 0);
      return out;
  }

  /** Pure: the Bash commands a Claude transcript ran in the background — started with run_in_background, or a
   *  foreground command auto-backgrounded at its timeout (its result carries a backgroundTaskId) — each with the
   *  status its <task-notification> (joined by tool-use-id) or a later TaskStop/KillShell gave it. Unresolved
   *  tasks stay "running"; the caller decides what that means for a session that is no longer live. First-seen
   *  order. Background subagents are left to extractSubagentSpawns. */
  export function extractBackgroundTasks(lines: string[]): BackgroundTask[] {
      const calls = new Map<string, { label: string; command?: string }>();
      const tasks = new Map<string, BackgroundTask>();
      const byTaskId = new Map<string, BackgroundTask>();
      const startTask = (toolUseId: string): BackgroundTask | undefined => {
          const existing = tasks.get(toolUseId);
          const call = calls.get(toolUseId);
          if (existing || !call) {
              return existing;
          }
          const t: BackgroundTask = { toolUseId, label: call.label, command: call.command, status: "running" };
          tasks.set(toolUseId, t);
          return t;
      };
      for (const line of lines) {
          let rec: any;
          try {
              rec = JSON.parse(line);
          } catch {
              continue;
          }
          const content = rec?.message?.content;
          if (Array.isArray(content)) {
              for (const block of content) {
                  if (block?.type === "tool_use" && typeof block.id === "string") {
                      const input = block.input ?? {};
                      if (block.name === "Bash") {
                          const command = typeof input.command === "string" ? input.command : undefined;
                          const desc = typeof input.description === "string" ? input.description.trim() : "";
                          calls.set(block.id, { label: desc || command || "background command", command });
                          if (input.run_in_background === true) {
                              startTask(block.id);
                          }
                      } else if (block.name === "TaskStop" || block.name === "KillShell") {
                          const id = typeof input.task_id === "string" ? input.task_id : input.shell_id;
                          const t = typeof id === "string" ? byTaskId.get(id) : undefined;
                          if (t) {
                              t.status = "stopped";
                          }
                      }
                  } else if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
                      if (!calls.has(block.tool_use_id)) {
                          continue;
                      }
                      const fromRecord = rec?.toolUseResult?.backgroundTaskId;
                      const taskId =
                          typeof fromRecord === "string" ? fromRecord : BG_ID_TEXT.exec(toolResultText(block))?.[1];
                      if (taskId) {
                          const t = startTask(block.tool_use_id)!;
                          t.taskId = taskId;
                          byTaskId.set(taskId, t);
                      }
                  }
              }
          }
          if (line.includes("<task-notification>")) {
              for (const text of notificationTexts(rec)) {
                  const toolUseId = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1]?.trim();
                  const status = NOTIFIED_STATUS[/<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim() ?? ""];
                  const t = toolUseId ? tasks.get(toolUseId) : undefined;
                  if (t && status) {
                      t.status = status;
                  }
              }
          }
      }
      return [...tasks.values()];
  }
  ```

  Note the expected objects in the tests: a task with no id has no `taskId` key, so never assign
  `taskId: undefined`.

- [ ] **Step 4: Run, expect PASS** (same command as Step 2, then the whole file).

- [ ] **Step 5: Commit.** `git commit -m "feat(agents): derive background tasks from the transcript"`.

---

### Task 4: Store background tasks per agent

**Depends on:** Task 3

**Files:**
- Modify: `frontend/app/view/agents/subagentsstore.ts`

The loader has no test of its own (it is RPC glue); its logic is Task 3's pure function.

- [ ] **Step 1: Implement.**
  - Add `import { extractBackgroundTasks, extractSubagentSpawns, type BackgroundTask } from "./transcriptprojection";`
  - Next to `subagentsByIdAtom`:

    ```ts
    // per parent-agent-id -> its background Bash tasks, from the same transcript tail as the subagent spawns
    export const backgroundTasksByIdAtom = atom<Record<string, BackgroundTask[]>>({}) as PrimitiveAtom<
        Record<string, BackgroundTask[]>
    >;
    ```
  - Generalize `setList` to `function setIn<T>(a: PrimitiveAtom<Record<string, T[]>>, id: string, list: T[] | null)`
    (same body, reading/writing `a`), and replace its calls with `setIn(subagentsByIdAtom, …)`.
  - In `refreshSubagents`: in the `!transcriptPath` branch and in `catch` also `setIn(backgroundTasksByIdAtom, id, null)`;
    right after the `loadSeq` staleness check, before `const files = …`:

    ```ts
    setIn(backgroundTasksByIdAtom, id, extractBackgroundTasks(tr.lines ?? []));
    ```

    (before the `files.length === 0` early return, so an agent with no subagents still gets its tasks).
  - In `dropSubagents` also `setIn(backgroundTasksByIdAtom, id, null)`.
  - Update the file's header comment: it also holds background tasks.

- [ ] **Step 2: Check + tests.** Check command; `npx vitest run frontend/app/view/agents/`.

- [ ] **Step 3: Commit.** `git commit -m "feat(agents): keep each agent's background tasks in a store"`.

---

### Task 5: Header rows on `CollapsibleRail` sections

**Depends on:** none

**Files:**
- Create: `frontend/app/element/railsections.ts`
- Test: `frontend/app/element/railsections.test.ts`
- Modify: `frontend/app/element/collapsiblerail.tsx`

- [ ] **Step 1: Write the failing test** `railsections.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { sectionExpandable, sectionOpen, toggleSection } from "./railsections";

  describe("rail section open state", () => {
      it("opens by default, or as the section's default says", () => {
          expect(sectionOpen({}, "files", { count: 2 })).toBe(true);
          expect(sectionOpen({}, "details", { defaultOpen: false })).toBe(false);
      });
      it("a stored choice beats the default", () => {
          expect(sectionOpen({ details: true }, "details", { defaultOpen: false })).toBe(true);
          expect(sectionOpen({ files: false }, "files", { count: 2 })).toBe(false);
      });
      it("an empty counted section never opens and is not expandable", () => {
          expect(sectionExpandable({ count: 0 })).toBe(false);
          expect(sectionOpen({ files: true }, "files", { count: 0 })).toBe(false);
          expect(sectionExpandable({})).toBe(true);
      });
      it("toggle flips the effective state and keeps other ids", () => {
          expect(toggleSection({ a: true }, "details", { defaultOpen: false })).toEqual({ a: true, details: true });
          expect(toggleSection({}, "files", { count: 3 })).toEqual({ files: false });
      });
  });
  ```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run frontend/app/element/railsections.test.ts`.

- [ ] **Step 3: Implement** `railsections.ts`:

  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // Open state of a rail's headed sections (collapsiblerail.tsx). A section with a header is a "Label  n  ›" row
  // that opens and closes; a counted section with nothing in it stays listed, dimmed, so the rail keeps one shape.

  import { atomWithStorage } from "jotai/utils";

  export interface RailSectionHeader {
      count?: number; // shown beside the label; 0 makes the row inert
      defaultOpen?: boolean; // open state before the user has toggled it; default true
  }

  // per section id; ids are unique across the rails that use headers
  export const railSectionOpenAtom = atomWithStorage<Record<string, boolean>>("cockpit.rail.sections", {});

  export function sectionExpandable(h: RailSectionHeader): boolean {
      return h.count !== 0;
  }

  export function sectionOpen(stored: Record<string, boolean>, id: string, h: RailSectionHeader): boolean {
      if (!sectionExpandable(h)) {
          return false;
      }
      return stored[id] ?? h.defaultOpen ?? true;
  }

  export function toggleSection(
      stored: Record<string, boolean>,
      id: string,
      h: RailSectionHeader
  ): Record<string, boolean> {
      return { ...stored, [id]: !sectionOpen(stored, id, h) };
  }
  ```

  `collapsiblerail.tsx`:
  - `RailSection` gains `header?: RailSectionHeader;` with the comment "when set, the rail draws the section's
    header row and owns open/closed; the caller's content then carries no heading of its own".
  - Add the component (imports: `useAtom` already there, `railSectionOpenAtom`, `sectionExpandable`,
    `sectionOpen`, `toggleSection`, `type RailSectionHeader` from `./railsections`):

    ```tsx
    function HeadedSection({ section, header }: { section: RailSection; header: RailSectionHeader }) {
        const [stored, setStored] = useAtom(railSectionOpenAtom);
        const expandable = sectionExpandable(header);
        const open = sectionOpen(stored, section.id, header);
        return (
            <section data-rail-section={section.id} data-open={open ? "true" : "false"}>
                <button
                    type="button"
                    disabled={!expandable}
                    aria-expanded={expandable ? open : undefined}
                    onClick={() => setStored(toggleSection(stored, section.id, header))}
                    className={cn(
                        "group flex w-full items-center gap-[8px] rounded-[6px] py-[5px] text-left",
                        expandable ? "cursor-pointer" : "cursor-default opacity-60"
                    )}
                >
                    <h3 className="text-[12px] font-medium text-muted group-hover:text-secondary">{section.label}</h3>
                    {header.count != null ? (
                        <span className="font-mono text-[11px] text-ink-faint">{header.count}</span>
                    ) : null}
                    <ChevronRight
                        size={12}
                        aria-hidden
                        className={cn(
                            "text-ink-faint transition-transform",
                            open && "rotate-90",
                            !expandable && "invisible"
                        )}
                    />
                </button>
                {open ? <div className="pb-[10px] pt-[8px]">{section.content}</div> : null}
            </section>
        );
    }
    ```
  - In the panel's scroll body: `const headed = sections.some((s) => s.header != null);` and use
    `cn("flex min-h-0 flex-1 flex-col overflow-y-auto px-[18px] pb-[40px] pt-[8px]", headed ? "gap-[4px]" : "gap-[24px]")`;
    map each section to `s.header ? <HeadedSection key={s.id} section={s} header={s.header} /> : <div key={s.id}>{s.content}</div>`.
    Sections without `header` render exactly as before (the Cockpit Events rail is unchanged).

- [ ] **Step 4: Run, expect PASS**; Check command.

- [ ] **Step 5: Commit.** `git commit -m "feat(rail): counted, collapsible section headers"`.

---

### Task 6: `planAgentRail` — which sections, in what order

**Depends on:** Task 3, Task 5

**Files:**
- Create: `frontend/app/view/agents/agentrailsections.ts`
- Test: `frontend/app/view/agents/agentrailsections.test.ts`

- [ ] **Step 1: Write the failing test:**

  ```ts
  import { describe, expect, it } from "vitest";
  import { bgTaskStatusLabel, planAgentRail, type AgentRailInput } from "./agentrailsections";

  const base: AgentRailInput = {
      inSubagent: false,
      needsYou: 0,
      subagents: 0,
      files: 3,
      bgTasks: 1,
      tools: 4,
      hasRun: false,
  };
  const ids = (i: AgentRailInput) => planAgentRail(i).map((s) => s.id);

  describe("planAgentRail", () => {
      it("lists attention first and the facts last, keeping empty counted sections", () => {
          expect(ids(base)).toEqual(["subagents", "files", "bgtasks", "tools", "details", "usage"]);
          expect(planAgentRail(base).find((s) => s.id === "subagents")?.header).toEqual({ count: 0 });
      });
      it("needs-you leads, uncounted, only when something waits", () => {
          expect(ids({ ...base, needsYou: 2 })[0]).toBe("needs");
          expect(planAgentRail({ ...base, needsYou: 2 })[0].header).toBeUndefined();
      });
      it("the run section sits after the counted ones", () => {
          expect(ids({ ...base, hasRun: true })).toEqual([
              "subagents", "files", "bgtasks", "tools", "run", "details", "usage",
          ]);
      });
      it("details and token usage start closed", () => {
          const plan = planAgentRail(base);
          expect(plan.find((s) => s.id === "details")?.header).toEqual({ defaultOpen: false });
          expect(plan.find((s) => s.id === "usage")?.header).toEqual({ defaultOpen: false });
      });
      it("files with no count (loading, not a repo) has a header but no number", () => {
          expect(planAgentRail({ ...base, files: null }).find((s) => s.id === "files")?.header).toEqual({});
      });
      it("a subagent interior shows its head, tools, details and usage only", () => {
          expect(ids({ ...base, inSubagent: true, needsYou: 1, hasRun: true })).toEqual([
              "subagent", "tools", "details", "usage",
          ]);
      });
  });

  describe("bgTaskStatusLabel", () => {
      it("a running task of a session that is no longer live is unknown", () => {
          expect(bgTaskStatusLabel("running", true)).toBe("running");
          expect(bgTaskStatusLabel("running", false)).toBe("unknown");
          expect(bgTaskStatusLabel("completed", false)).toBe("completed");
      });
  });
  ```

  (Format the arrays one item per line if prettier asks.)

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run frontend/app/view/agents/agentrailsections.test.ts`.

- [ ] **Step 3: Implement** `agentrailsections.ts`:

  ```ts
  // Copyright 2026, Command Line Inc.
  // SPDX-License-Identifier: Apache-2.0
  //
  // The Agent details rail's sections: which show, in what order, with which counts. Attention first (needs you,
  // subagents, changed files, background tasks), then what the agent did (tools), its run, and the facts last,
  // closed by default. Counted sections stay listed at 0 so the rail keeps one shape from agent to agent.
  // Rendered by agentdetailsrail.tsx.

  import type { RailSectionHeader } from "@/app/element/railsections";
  import type { BackgroundTaskStatus } from "./transcriptprojection";

  export type AgentRailSectionId =
      | "subagent"
      | "needs"
      | "subagents"
      | "files"
      | "bgtasks"
      | "tools"
      | "run"
      | "details"
      | "usage";

  export interface AgentRailInput {
      inSubagent: boolean; // a subagent's interior is open in place of the parent
      needsYou: number; // the lead's asks owned by the user
      subagents: number;
      files: number | null; // null: not known (loading, or not a git repo)
      bgTasks: number;
      tools: number;
      hasRun: boolean; // the agent leads or works a run
  }

  export interface AgentRailSectionPlan {
      id: AgentRailSectionId;
      header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
  }

  export function planAgentRail(i: AgentRailInput): AgentRailSectionPlan[] {
      const out: AgentRailSectionPlan[] = [];
      if (i.inSubagent) {
          out.push({ id: "subagent" });
      } else {
          if (i.needsYou > 0) {
              out.push({ id: "needs" });
          }
          out.push({ id: "subagents", header: { count: i.subagents } });
          out.push({ id: "files", header: i.files == null ? {} : { count: i.files } });
          out.push({ id: "bgtasks", header: { count: i.bgTasks } });
      }
      out.push({ id: "tools", header: { count: i.tools } });
      if (!i.inSubagent && i.hasRun) {
          out.push({ id: "run" });
      }
      out.push({ id: "details", header: { defaultOpen: false } });
      out.push({ id: "usage", header: { defaultOpen: false } });
      return out;
  }

  export type BgTaskLabel = BackgroundTaskStatus | "unknown";

  // a task the transcript never resolved is only known to be running while its session is
  export function bgTaskStatusLabel(status: BackgroundTaskStatus, live: boolean): BgTaskLabel {
      return status === "running" && !live ? "unknown" : status;
  }
  ```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit.** `git commit -m "feat(agents): plan the details rail's sections"`.

---

### Task 7: Render the Agent rail from the plan

**Depends on:** Task 4, Task 6

**Files:**
- Modify: `frontend/app/view/agents/agentdetailsrail.tsx`
- Modify: `frontend/app/view/agents/tokenusagesection.tsx`
- Modify: `frontend/app/view/agents/railicons.tsx`

- [ ] **Step 1: `railicons.tsx`:** import `SquareTerminal` from lucide-react; add
  `terminal: <SquareTerminal {...iconProps} />`.

- [ ] **Step 2: `tokenusagesection.tsx`:** the rail now draws the heading. Delete every
  `<SectionLabel>Token usage</SectionLabel>` (four places). In the full view delete the whole heading row
  (`<div className="flex items-baseline justify-between">…</div>` with the label and the accent total) — the
  headline pair under it already shows the total. Drop the unused `SectionLabel` import; the empty-state texts
  lose their `mt-[10px]`, the skeleton's first line its `mt-[12px]`.

- [ ] **Step 3: `agentdetailsrail.tsx`.**
  - Imports: `planAgentRail`, `bgTaskStatusLabel`, `type AgentRailSectionId`, `type BgTaskLabel` from
    `./agentrailsections`; `backgroundTasksByIdAtom` from `./subagentsstore`; `type BackgroundTask` from
    `./transcriptprojection`.
  - Read `const bgTasks = useAtomValue(backgroundTasksByIdAtom)[agent.id] ?? [];`
  - Add a row component beside `FileRow`:

    ```tsx
    const BG_DOT: Record<BgTaskLabel, string> = {
        running: "bg-accent",
        completed: "bg-success",
        failed: "bg-error",
        stopped: "bg-muted",
        unknown: "bg-muted",
    };

    function BackgroundTaskRow({ task, live }: { task: BackgroundTask; live: boolean }) {
        const label = bgTaskStatusLabel(task.status, live);
        return (
            <div title={task.command} className="flex items-center gap-[10px] rounded-[8px] bg-surface-raised px-[11px] py-[8px]">
                <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", BG_DOT[label])} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-secondary">{task.label}</span>
                <span className="whitespace-nowrap font-mono text-[10.5px] text-muted">{label}</span>
            </div>
        );
    }
    ```
  - **Details content:** remove the `NeedsYouSection` it heads and its `<SectionLabel>Details</SectionLabel>`
    wrapper div; keep the `DetailLine`s and `ContextLine`.
  - **Subagents content:** remove the heading row (label + accent count pill); keep the list.
  - **Tools used / Files touched content:** remove their `SectionLabel` wrapper divs. Keep the files branches
    (sealed / skeleton / not a repo / no changes / list + View diff).
  - Build a content map and the sections from the plan, replacing the hand-built `sections` array (keep
    `subHead`'s content as the `subagent` entry, and `details` as `details`):

    ```tsx
    const fileCount = ended ? ended.files.length : railState?.isRepo ? changes.length : null;
    const plan = planAgentRail({
        inSubagent: sub != null,
        needsYou: !sub && roleRun && role?.kind === "lead" ? yours.length : 0,
        subagents: subs.length,
        files: fileCount,
        bgTasks: bgTasks.length,
        tools: tools.length,
        hasRun: role != null && roleRun != null,
    });
    const LABEL: Record<AgentRailSectionId, string> = {
        subagent: "Subagent",
        needs: "Needs you",
        subagents: "Subagents",
        files: "Files changed",
        bgtasks: "Background tasks",
        tools: "Tools used",
        run: role?.kind === "worker" ? "Task" : "Run",
        details: "Details",
        usage: "Token usage",
    };
    const ICON: Record<AgentRailSectionId, ReactNode> = {
        subagent: RAIL_ICON.subagents,
        needs: RAIL_ICON.bell,
        subagents: RAIL_ICON.subagents,
        files: RAIL_ICON.files,
        bgtasks: RAIL_ICON.terminal,
        tools: RAIL_ICON.tools,
        run: RAIL_ICON.autonomy,
        details: RAIL_ICON.info,
        usage: RAIL_ICON.usage,
    };
    const CONTENT: Record<AgentRailSectionId, () => ReactNode> = {
        subagent: () => /* subHead's content JSX */,
        needs: () => <NeedsYouSection key={agent.id} model={model} run={roleRun!} asks={yours} />,
        subagents: () => /* the subagent list */,
        files: () => /* the files branches */,
        bgtasks: () => (
            <div className="flex flex-col gap-[7px]">
                {bgTasks.map((t) => (
                    <BackgroundTaskRow key={t.toolUseId} task={t} live={live} />
                ))}
            </div>
        ),
        tools: () => /* the tool chips */,
        run: () => /* the existing TaskSection / RunSection switch */,
        details: () => /* details content */,
        usage: () => <TokenUsageSection />,
    };
    const sections: RailSection[] = plan.map((p) => ({
        id: p.id,
        label: LABEL[p.id],
        icon: ICON[p.id],
        header: p.header,
        content: CONTENT[p.id](),
    }));
    ```

    Content thunks keep sections that are not in the plan from rendering (the `run` thunk would otherwise touch
    `roleRun` when there is none). Delete the `details: RailSection` const and the old `sections` array; drop
    `SectionLabel` from the imports if nothing else uses it (`SubLabel` stays for the subagent head). Import
    `type ReactNode` from react.
  - The rail order changes for a worker's Task section (it moves below Tools used); that is intended (spec 7).

- [ ] **Step 4: Check + tests.** Check command; `npx vitest run frontend/app/view/agents/ frontend/app/element/`.

- [ ] **Step 5: Commit.** `git commit -m "feat(agents): sectioned details rail with background tasks"`.

---

### Task 8: CDP — the rail's sections in `agent-tree-rail`

**Depends on:** Task 1, Task 7

**Files:**
- Modify: `scripts/cdp/scenarios.mjs` (the `agent-tree-rail` scenario, ~line 6596; `arrangeTreeRail` ~6560)

Hand-format this file (4-space, as it is); never run prettier on it.

- [ ] **Step 1: Arrange.** Beside `RAIL_VISIBLE_KEY` add `const RAIL_SECTIONS_KEY = "cockpit.rail.sections";`. In
  `agentTreeRail.arrange`, record `prevSections: await h.ev(\`localStorage.getItem(${JSON.stringify(RAIL_SECTIONS_KEY)})\`)`
  in `ctx`; in `arrangeTreeRail`, next to the `RAIL_VISIBLE_KEY` setItem and before the reload, add
  `localStorage.removeItem(RAIL_SECTIONS_KEY)` so the defaults are what is measured. In `teardown`, restore it the
  way `prevRail` is restored (a second entry in the same `fn`).

- [ ] **Step 2: Step 4 of the scenario.** The rail's Details heading is now a header row: change step 4 to
  require only `labels.Run` at 10.5px/700 (`"4. the rail's Run heading is 10.5px bold"`).

- [ ] **Step 3: New steps** appended before `return steps;`:

  ```js
  const sections = await h.ev(`(() => {
      const rail = ${RAIL};
      if (!rail) return null;
      return [...rail.querySelectorAll("[data-rail-section]")].map((s) => ({
          id: s.dataset.railSection,
          open: s.dataset.open === "true",
          label: s.querySelector("h3")?.textContent.trim() ?? null,
          size: s.querySelector("h3") ? getComputedStyle(s.querySelector("h3")).fontSize : null,
      }));
  })()`);
  const order = ["subagents", "files", "bgtasks", "tools", "details", "usage"];
  const seen = (sections ?? []).map((s) => s.id).filter((id) => order.includes(id));
  rec(
      "10. the lead's rail lists Subagents, Files changed, Background tasks, Tools used, Details, Token usage in order",
      JSON.stringify(seen) === JSON.stringify(order),
      JSON.stringify(sections)
  );
  const byId = Object.fromEntries((sections ?? []).map((s) => [s.id, s]));
  rec(
      "11. Details and Token usage start closed; the header labels are 12px",
      byId.details?.open === false && byId.usage?.open === false && byId.details?.size === "12px",
      JSON.stringify({ details: byId.details, usage: byId.usage })
  );
  const theme = await h.ev(`(() => ({
      preset: localStorage.getItem("cockpit.theme.preset"),
      bg: getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim(),
  }))()`);
  steps.push(
      theme.preset == null || theme.preset === '"graphite"'
          ? { step: "12. with no preset picked the cockpit is Graphite", ok: theme.bg === "#101010", detail: JSON.stringify(theme) }
          : skipStep("12. with no preset picked the cockpit is Graphite", `this profile picked ${theme.preset}`)
  );
  ```

  (`atomWithStorage` stores JSON, hence the quoted `'"graphite"'`. `skipStep` is already defined in the file.)

- [ ] **Step 4: Run** against a live dev app (`task dev` in an attached terminal; see the spec's Testing note on
  the detached-launch boot failure): `task verify:ui -- agent-tree-rail surface-smoke`. Expect PASS (step 12 may
  SKIP on a profile with a picked theme). Look at `cdp-shots/` for the rail and the surfaces under Graphite.

- [ ] **Step 5: Commit.** `git commit -m "test(cdp): agent rail sections and the Graphite default"`.

---

### Task 9: DESIGN.md

**Depends on:** Task 1, Task 2

**Files:**
- Modify: `DESIGN.md`

- [ ] **Step 1: Front matter.** `name`/`description`: tokens mirror the Graphite default. Update the `colors:` values
  for every token Task 1 changed (same table), add `code-inline: "#d7b981"`, and `font-sans` →
  `"Inter, system-ui, sans-serif"`.

- [ ] **Step 2: Prose.**
  - Overview: "midnight ink + periwinkle accent" → neutral graphite greys, regions separated by tone rather than
    lines, accent used sparingly (primary CTA, focus, links); Inter + JetBrains Mono.
  - Colors: surface/ink/edge values and the contrast ratios from Task 1; `code-inline` under Syntax.
  - Runtime theming: `THEMES` is graphite (default), midnight, slate, carbon, nocturne, onedark, monokai;
    `DEFAULT_THEME_PRESET` in `themes.ts` must equal the `@theme` literals (guarded by `themes.test.ts`); an
    unknown preset falls back to the default.
  - Typography: Inter default (Hanken Grotesk selectable); JetBrains Mono is the variable full-charset file;
    terminal default is JetBrains Mono. Add one line: bundled faces must cover Vietnamese — Hanken Grotesk, Hack
    and Fira Code as bundled do not.

- [ ] **Step 3: Commit.** `git commit -m "docs(design): Graphite and Inter as the defaults"`.
