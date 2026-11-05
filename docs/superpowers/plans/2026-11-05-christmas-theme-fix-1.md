# Christmas theme: final-stage fix, round 1

**Verify:** `node scripts/verify.mjs ./pkg/memgate`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs christmas-theme surface-smoke terminal-theme`

Spec: `docs/superpowers/specs/2026-11-05-christmas-theme-design.md`. Every `christmas-theme` and `surface-smoke` step
passed in round 1's Final. Only `terminal-theme` failed, with `xterm=null` and `blue=null` in its steps 1 to 4. That
failure is on the base too and is not caused by this run, but it holds the land, so this round fixes it.

Why it fails (checked in the source):

- The scenario reads `window.term`. Commit `09d18f149` ("remove dead debug globals", 2026-08-27) took
  `(window as any).term = termWrap` out of `frontend/app/view/term/term.tsx`, so every read is `null`. The comment
  above the agent-uploads scenario in `scripts/cdp/scenarios.mjs` already says "window.term is no longer set".
- The arrange step only reloads. Final's fresh store may have no terminal on the Agent surface, so even with the global
  restored there may be no xterm to read.
- Step 2 expects ANSI blue to equal `--color-accent`. `deriveAnsi` (`themes.ts`) gives `blue: palette.ansiBlue ??
  palette.accent`, and the default preset `claude` sets `ansiBlue: "#6a9bcc"`, so the step is stale as written.
  `buildThemeVars` writes the same value to `--ansi-blue`, which is the right thing to compare against.
- Teardown clicks `Midnight` to "restore the default", but the default preset is `claude` (`DEFAULT_THEME_PRESET`).
  It should put back whatever was stored before.

### Task 1: terminal-theme reads the live xterm again

**Depends on:** none
**Files:** `frontend/app/view/term/term.tsx`, `scripts/cdp/scenarios.mjs`

1. In `term.tsx`, where the `TermWrap` is built, add a dev-only registry keyed by block id. Under
   `import.meta.env.DEV` only, set `window.__arcTerms ??= {}` and `window.__arcTerms[blockId] = termWrap`. In the
   effect's cleanup, delete the entry only when it is still this `termWrap`. Declare the global type with
   `declare global { interface Window { __arcTerms?: Record<string, TermWrap> } }` in the same file, following the
   pattern in `view/agents/cockpitofficedevhooks.ts`. A production build must not have it, which is why the hook is
   keyed and gated rather than the old `window.term` that `09d18f149` removed. Keep a one-line comment that names the
   `terminal-theme` scenario as its reader.
2. In `scenarios.mjs`, rewrite `terminalTheme` (`name: "terminal-theme"`):
   - `arrange`: store the current `cockpit.theme.preset` value from localStorage on ctx. Find the workspace the way
     `christmasTheme.arrange` does (`workspacelist` plus the boot tab). Open one terminal with
     `openRailTerminal(h, ctx, "verify-terminal-theme")` (ctx gets `terminals: []`). Then `freshBoot(h)`,
     `h.goto("agent")`, wait with `polishWaitFor` for `[data-tree-terminal-row="<tabId>"]`, click it, and wait (15 s)
     for `window.__arcTerms?.["<blockId>"]?.terminal` to be set and a `.term-connectelem` to have width. Record
     `booted` and `termShown` on ctx. Wrap it in try/catch into `ctx.arrangeError`, as `christmasTheme` does.
   - `readTheme(field)` reads `window.__arcTerms?.[<blockId>]?.terminal?.options?.theme?.<field> ?? null`.
   - Step 0 asserts the fresh boot and the terminal shown, naming the block id.
   - Step 2 compares the xterm `blue` to `--ansi-blue`. Retitle it "xterm ANSI blue === --ansi-blue (the palette's
     ansiBlue, else its accent)".
   - Step 4: open Settings → Appearance with `spOpen(h, "appearance")` before `pickPreset("Monokai")`, as
     `christmasTheme` does. Back on Agent, click the terminal's tree row again, then read.
   - `teardown`: restore the stored preset value (`removeItem` when it was null), close the terminal tab with
     `waveService(h, "workspace", "CloseTab", [ctx.workspaceId, tabId, false])`, reload with `ahReload`, and leave on
     the Cockpit. Each step is wrapped so that one failure does not skip the rest, as in `christmasTheme.teardown`.
     Drop the `Midnight` click.
3. Update the agent-uploads comment ("window.term is no longer set") only if it now reads false. It stays true:
   `window.term` is still gone, so leave it.

Never run prettier on `scripts/*.mjs`, and keep its 4-space hand formatting. The change is to a scenario and a
dev-only hook, so it gets no CHANGELOG line.

**Acceptance:** `task verify:ui -- terminal-theme` passes steps 0 to 4 against a dev app (the Final runs it). In
production, `window.__arcTerms` is `undefined`: the hook sits behind `import.meta.env.DEV`. `task check:ts` is clean.
**Scenario:** `terminal-theme`, steps 0 to 4, which the Final names.
