# New agent launcher: resume a session, paste images — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent half of the New launcher can resume one of the picked agent's recent sessions in the picked project, and takes images pasted or dropped into the Task box.

**Architecture:** Two pure modules carry the rules: `launcherresume.ts` (which sessions to offer, how a resume launches) and `launcherimages.ts` (which files are images, how image paths ride the launch). `buildLaunchMeta` gains `extraArgs`, placed after the task. The launcher store holds the loaded sessions, the picked session id and the task images; `launcheragentfields.tsx` draws a Resume list and a thumbnail row; `launchermodal.tsx` composes the launch. Frontend only: no Go change, no `task generate`.

**Tech Stack:** React 19 + jotai + Tailwind 4, vitest, the CDP harness (`scripts/cdp/scenarios.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md`

**Verify:** `node scripts/verify.mjs ./pkg/agentsessions/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: launcher, launcher-resume and launcher-images need CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs launcher launcher-resume launcher-images`

## Global Constraints

- Sessions come from `RpcApi.GetRecentSessionsCommand(TabRpcClient, { windowdays: 14, limit: 50 })`, loaded once per dialog open. The list shows at most 5 (`RESUME_LIST_MAX`).
- Resume commands are the backend's `SessionInfo.resumecommand`: `claude --resume <id>`, `codex resume <id>`, `opencode -s <id>`, `agy --conversation <id>`, and for pi `startupArgs: resumeargs` plus `resumePath: transcriptpath` (exactly as `agentlaunchhero.tsx` resumes). The catalog flag with id `continue` is never added to a resume.
- The picked session (`launcherResumeAtom`) resets to null whenever the runtime or the project changes (`pickLauncherRuntime` / `pickLauncherProject` in `launcherstore.ts`), as the spec says, so leaving a project and coming back starts on "New session". As a guard, a pick is also honored only while it is among the current choices (`pickedResume`).
- Images: at most 8 (`MAX_TASK_IMAGES`); a paste is written with `createTempFileFromBlob`, a drop with `createTempFileFromFile` (both `frontend/app/view/term/termutil.ts`, 3.5 MB cap). Only `image/*` files are taken.
- Images are taken for every runtime that shows the Task box (`runtimeShowsTask`: every runtime but Terminal — claude, codex, agy, opencode and pi). At launch: codex starting fresh gets `--image <p1>,<p2>` after the prompt (via `extraArgs`); every other case (claude, agy, opencode, pi, a codex resume, a path with a comma) appends to the task:
  ```
  Attached images:
  - <path>
  ```
  An empty task with images sends only that block. `agent:baseargs` never includes `extraArgs` (resume-on-reopen must not replay images).
- UI copy is English. Colors only from `@theme` tokens (`text-muted`, `text-warning`, `bg-surface`, `border-edge-mid`, `bg-accentbg`, `text-accent-soft`…), never raw hex.
- A CDP scenario never presses Launch/Resume: that would start a real agent.
- Never run prettier on `scripts/*.mjs`. `npx tsc` overflows: typecheck with `NODE_OPTIONS=--max-old-space-size=4096 task check:ts` (about 2 minutes). Check only the files you touched with `npx eslint <paths>` / `npx prettier --check <paths>`.
- Commits carry no Co-Authored-By trailer. Commit with a pathspec (`git commit -- <paths>`), never a bare `git commit`.

## Review Focus

1. **Resume with the `continue` flag left on:** the resume command must not carry `--continue`/`-c`, which would pick a different session. Pinned in Task 1 (`resumeLaunchSpec drops the continue flag`).
2. **A project path written differently** (`D:\x\proj` vs `d:/x/proj/`): its sessions still list. Pinned in Task 1 (`resumeChoices matches a path across separators, case and a trailing slash`).
3. **A session picked, then the project or runtime switched:** the launch must start fresh in the new project, not resume the old session, and coming back must not bring the old pick back. Pinned in Task 3 (`launcherstore.test.ts`: `pickLauncherProject resets the resume pick`, `pickLauncherRuntime resets the resume pick`; scenario step 4) and Task 1 (`pickedResume returns null for an id not among the choices`).
4. **Codex resume with images:** `codex resume <id>` may not take `--image`, so the images go in the text block. Pinned in Task 2 (`codex resuming uses the text block`).
5. **A plain-text paste into Task:** unchanged — `onPaste` neither prevents the default nor adds a tile, so the browser pastes as usual. Pinned in Task 4 (scenario step 2).
6. **Launch while an image is still writing:** the primary button is disabled until every image has a path or an error. Pinned in Task 2 (`imagesPending`) and Task 4 (scenario step 5).
7. **Enter on a Resume row launches** rather than doing nothing. Pinned in Task 3 (`launcher.test.ts`: `Enter in the resume zone launches`).

---

### Task 1: Resume model (pure)

**Depends on:** none

**Files:** `frontend/app/view/agents/launcherresume.ts`, `frontend/app/view/agents/launcherresume.test.ts`

- [ ] **Step 1: Write the failing tests** in `launcherresume.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickedResume, resumeChoices, resumeLaunchSpec, RESUME_LIST_MAX } from "./launcherresume";

function s(over: Partial<SessionInfo>): SessionInfo {
    return {
        id: "a",
        runtime: "claude",
        projectpath: "D:\\x\\proj",
        projectname: "proj",
        branch: "main",
        task: "t",
        model: "",
        tokenstotal: 0,
        lastactivets: 1,
        resumecommand: "claude --resume a",
        transcriptpath: "",
        ...over,
    };
}

describe("resumeChoices", () => {
    it("keeps the picked runtime's sessions in the picked project, newest first", () => {
        const list = [
            s({ id: "old", lastactivets: 1 }),
            s({ id: "new", lastactivets: 9 }),
            s({ id: "codex", runtime: "codex" }),
            s({ id: "other", projectpath: "D:\\x\\other" }),
        ];
        expect(resumeChoices(list, "claude", "D:\\x\\proj").map((x) => x.id)).toEqual(["new", "old"]);
    });
    it("matches a path across separators, case and a trailing slash", () => {
        expect(resumeChoices([s({})], "claude", "d:/x/proj/").map((x) => x.id)).toEqual(["a"]);
    });
    it("caps the list", () => {
        const list = Array.from({ length: 9 }, (_, i) => s({ id: `s${i}`, lastactivets: i }));
        expect(resumeChoices(list, "claude", "D:\\x\\proj")).toHaveLength(RESUME_LIST_MAX);
    });
    it("offers nothing for a terminal, no project, or sessions not loaded", () => {
        expect(resumeChoices([s({})], "terminal", "D:\\x\\proj")).toEqual([]);
        expect(resumeChoices([s({})], "claude", "")).toEqual([]);
        expect(resumeChoices(null, "claude", "D:\\x\\proj")).toEqual([]);
    });
});

describe("pickedResume", () => {
    it("returns the picked session while it is a choice", () => {
        expect(pickedResume([s({})], "a")?.id).toBe("a");
    });
    it("returns null for an id not among the choices", () => {
        expect(pickedResume([s({})], "gone")).toBeNull();
        expect(pickedResume([s({})], null)).toBeNull();
    });
});

describe("resumeLaunchSpec", () => {
    it("adds the enabled flags to the resume command", () => {
        expect(resumeLaunchSpec(s({}), "claude", { "skip-permissions": true })).toEqual({
            startupCommand: "claude --resume a --dangerously-skip-permissions",
        });
    });
    it("drops the continue flag", () => {
        expect(resumeLaunchSpec(s({}), "claude", { continue: true }).startupCommand).toBe("claude --resume a");
    });
    it("resumes pi by its exact argv and transcript path", () => {
        const pi = s({
            runtime: "pi",
            resumecommand: "pi --session C:\\a b\\t.jsonl",
            resumeargs: ["--session", "C:\\a b\\t.jsonl"],
            transcriptpath: "C:\\a b\\t.jsonl",
        });
        expect(resumeLaunchSpec(pi, "pi", {})).toEqual({
            startupCommand: "pi --session C:\\a b\\t.jsonl",
            startupArgs: ["--session", "C:\\a b\\t.jsonl"],
            resumePath: "C:\\a b\\t.jsonl",
        });
    });
});
```

- [ ] **Step 2: Run to see them fail:** `npx vitest run frontend/app/view/agents/launcherresume.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement** `launcherresume.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which recent sessions the New launcher offers to resume, and how a picked one launches
// (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Pure; launcherresume.test.ts covers it.

import { composeStartupCommand, type Runtime } from "./launch";

export const RESUME_LIST_MAX = 5;

// a path as the comparison sees it: Windows paths reach the roster and the transcripts written two ways
function normPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function resumeChoices(sessions: SessionInfo[] | null, runtime: Runtime, projectPath: string): SessionInfo[] {
    if (sessions == null || runtime === "terminal" || !projectPath) {
        return [];
    }
    const want = normPath(projectPath);
    return sessions
        .filter((x) => x.runtime === runtime && normPath(x.projectpath) === want)
        .sort((a, b) => b.lastactivets - a.lastactivets)
        .slice(0, RESUME_LIST_MAX);
}

// The store resets the pick on a runtime or project switch; this guard keeps a pick that is no longer on offer (a
// rescan dropped it) from launching.
export function pickedResume(choices: SessionInfo[], id: string | null): SessionInfo | null {
    return id == null ? null : (choices.find((x) => x.id === id) ?? null);
}

export interface ResumeLaunch {
    startupCommand: string;
    startupArgs?: string[];
    resumePath?: string;
}

export function resumeLaunchSpec(session: SessionInfo, runtime: Runtime, flags: Record<string, boolean>): ResumeLaunch {
    if (runtime === "pi" && session.resumeargs?.length) {
        // pi's --session takes a path that can hold spaces: its argv is used verbatim, never re-split
        return {
            startupCommand: session.resumecommand,
            startupArgs: session.resumeargs,
            resumePath: session.transcriptpath,
        };
    }
    // the catalog's continue flag resumes the last session, which may not be the picked one
    return { startupCommand: composeStartupCommand(session.resumecommand, runtime, { ...flags, continue: false }) };
}
```

- [ ] **Step 4: Run to see them pass:** `npx vitest run frontend/app/view/agents/launcherresume.test.ts` — PASS.

- [ ] **Step 5: Commit:** `git add frontend/app/view/agents/launcherresume.ts frontend/app/view/agents/launcherresume.test.ts && git commit -m "feat(launcher): the rules for which sessions to resume and how" -- frontend/app/view/agents/launcherresume.ts frontend/app/view/agents/launcherresume.test.ts`

### Task 2: Images model (pure) and launch extraArgs

**Depends on:** none

**Files:** `frontend/app/view/agents/launcherimages.ts`, `frontend/app/view/agents/launcherimages.test.ts`, `frontend/app/view/agents/launch.ts`, `frontend/app/view/agents/launch.test.ts`, `frontend/app/cockpit/cockpit-actions.ts`

- [ ] **Step 1: Write the failing tests.** `launcherimages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { composeTaskWithImages, imageFilesOf, imagesPending, imageRoom, MAX_TASK_IMAGES } from "./launcherimages";

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("imageFilesOf", () => {
    it("keeps only images", () => {
        const got = imageFilesOf([file("a.png", "image/png"), file("b.txt", "text/plain")]);
        expect(got.map((f) => f.name)).toEqual(["a.png"]);
    });
    it("reads nothing from a missing list", () => {
        expect(imageFilesOf(null)).toEqual([]);
    });
});

describe("imageRoom", () => {
    it("takes what fits under the cap", () => {
        expect(imageRoom(MAX_TASK_IMAGES - 1, 3)).toBe(1);
        expect(imageRoom(MAX_TASK_IMAGES, 3)).toBe(0);
        expect(imageRoom(0, 2)).toBe(2);
    });
});

describe("imagesPending", () => {
    it("is true while an image has neither a path nor an error", () => {
        expect(imagesPending([{ id: "1", previewUrl: "" }])).toBe(true);
        expect(imagesPending([{ id: "1", previewUrl: "", path: "p" }, { id: "2", previewUrl: "", error: "e" }])).toBe(false);
    });
});

describe("composeTaskWithImages", () => {
    it("leaves a task with no images alone", () => {
        expect(composeTaskWithImages("claude", " fix it ", [], false)).toEqual({ task: "fix it", extraArgs: [] });
    });
    it("appends a block for claude", () => {
        expect(composeTaskWithImages("claude", "fix it", ["C:\\t\\a.png", "C:\\t\\b.png"], false)).toEqual({
            task: "fix it\n\nAttached images:\n- C:\\t\\a.png\n- C:\\t\\b.png",
            extraArgs: [],
        });
    });
    it("sends only the block for an empty task", () => {
        expect(composeTaskWithImages("agy", "", ["C:\\t\\a.png"], false).task).toBe("Attached images:\n- C:\\t\\a.png");
    });
    it("gives a fresh codex its own --image after the prompt", () => {
        expect(composeTaskWithImages("codex", "fix it", ["C:\\t\\a.png", "C:\\t\\b.png"], false)).toEqual({
            task: "fix it",
            extraArgs: ["--image", "C:\\t\\a.png,C:\\t\\b.png"],
        });
    });
    it("codex resuming uses the text block", () => {
        expect(composeTaskWithImages("codex", "x", ["C:\\t\\a.png"], true).extraArgs).toEqual([]);
    });
    it("codex with a comma in a path uses the text block", () => {
        expect(composeTaskWithImages("codex", "x", ["C:\\t\\a,b.png"], false).extraArgs).toEqual([]);
    });
});
```

And in `launch.test.ts`, beside the existing `buildLaunchMeta` tests:

```ts
it("puts extraArgs after the task and keeps them out of agent:baseargs", () => {
    const meta = buildLaunchMeta({
        runtime: "codex",
        startupCommand: "codex --full-auto",
        task: "fix it",
        extraArgs: ["--image", "a.png"],
        cwd: "/p",
    });
    expect(meta["cmd:args"]).toEqual(["--full-auto", "fix it", "--image", "a.png"]);
    expect(meta["agent:baseargs"]).toEqual(["--full-auto"]);
});
```

- [ ] **Step 2: Run to see them fail:** `npx vitest run frontend/app/view/agents/launcherimages.test.ts frontend/app/view/agents/launch.test.ts` — FAIL.

- [ ] **Step 3: Implement** `launcherimages.ts`:

```ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Images pasted or dropped into the New launcher's Task box: which files count, how many fit, and how their temp
// paths ride the launch (docs/superpowers/specs/2026-10-09-launcher-resume-and-images-design.md). Pure; the temp
// writes are launcherstore.ts's.

import type { Runtime } from "./launch";

export const MAX_TASK_IMAGES = 8;

export interface TaskImage {
    id: string;
    previewUrl: string;
    // set once the temp file is written
    path?: string;
    // set when the write failed; the image stays on show until removed
    error?: string;
}

export function imageFilesOf(files: ArrayLike<File> | null | undefined): File[] {
    return Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
}

export function imageRoom(existing: number, incoming: number): number {
    return Math.max(0, Math.min(incoming, MAX_TASK_IMAGES - existing));
}

export function imagesPending(images: TaskImage[]): boolean {
    return images.some((i) => i.path == null && i.error == null);
}

export interface TaskWithImages {
    task: string;
    // argv after the prompt
    extraArgs: string[];
}

export function composeTaskWithImages(runtime: Runtime, task: string, paths: string[], resuming: boolean): TaskWithImages {
    const trimmed = task.trim();
    if (paths.length === 0) {
        return { task: trimmed, extraArgs: [] };
    }
    // codex's --image takes a comma list and is variadic, so it goes after the prompt it would otherwise swallow;
    // `codex resume` is not known to take it
    if (runtime === "codex" && !resuming && paths.every((p) => !p.includes(","))) {
        return { task: trimmed, extraArgs: ["--image", paths.join(",")] };
    }
    const block = ["Attached images:", ...paths.map((p) => `- ${p}`)].join("\n");
    return { task: trimmed ? `${trimmed}\n\n${block}` : block, extraArgs: [] };
}
```

In `launch.ts`, add to `LaunchMetaSpec`:

```ts
    extraArgs?: string[]; // argv after the task (codex --image); never part of agent:baseargs
```

and in `buildLaunchMeta`, after the `if (task) { … }` block: `args.push(...(spec.extraArgs ?? []));`. In `cockpit-actions.ts`, add `extraArgs?: string[]` to `LaunchAgentOpts` and pass `extraArgs: opts.extraArgs` into the `buildLaunchMeta` call in `launchAgent`.

- [ ] **Step 4: Run to see them pass:** same command — PASS.

- [ ] **Step 5: Commit** the five files with a pathspec: `feat(launcher): the rules for task images, and launch args after the prompt`.

### Task 3: Resume list in the launcher

**Depends on:** Task 1

**Files:** `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/launcherresumelist.tsx`, `frontend/app/view/agents/launcheragentfields.tsx`, `frontend/app/view/agents/launchermodal.tsx`, `scripts/cdp/scenarios.mjs`

- [ ] **Step 1: Store.** In `launcherstore.ts` add:

```ts
// the recent sessions the agent half offers to resume; null until this open's load lands
export const launcherSessionsAtom = atom<SessionInfo[] | null>(null) as PrimitiveAtom<SessionInfo[] | null>;
// the session to resume, by id; honored only while it is among the choices (launcherresume.ts pickedResume)
export const launcherResumeAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export async function loadLauncherSessions(): Promise<void> {
    try {
        const rtn = await RpcApi.GetRecentSessionsCommand(TabRpcClient, { windowdays: 14, limit: 50 });
        globalStore.set(launcherSessionsAtom, rtn.sessions ?? []);
    } catch {
        globalStore.set(launcherSessionsAtom, []); // a failed scan offers no resume, never breaks the dialog
    }
}
```

`clearLauncherDraft` sets `launcherResumeAtom` to null. `pickLauncherProject` also sets `launcherResumeAtom` to null when the project changes (beside its branch reset). Add `pickLauncherRuntime(runtime: Runtime)`: when `runtime` differs from `launcherRuntimeAtom`, it sets the runtime and resets `launcherResumeAtom` to null (the spec: the pick resets when the runtime or project changes). Write these `launcherstore.test.ts` cases first and see them fail: `clearLauncherDraft clears the resume pick` (after setting a resume id, `clearLauncherDraft()` leaves it null); `pickLauncherProject resets the resume pick` (pick "b" while on "a" with a resume id set → null; picking the project already on show keeps it); `pickLauncherRuntime resets the resume pick` (switch claude → codex with a resume id set → null and the runtime is codex; picking the same runtime keeps it).

- [ ] **Step 2: Footer and label.** In `launcher.ts`: `primaryLabel(kind, runtime, resuming = false)` returns `"Resume agent"` for an agent with `resuming`; `FooterInput` gains `resume?: { title: string; branch: string } | null`, and for `kind === "agent"` with a resume, `footerLine` returns `{ lead: "Resumes ", strong: title, tail: branch ? \` · ${branch}\` : "", blocked: false }`. Title is `session.task || "(untitled session)"`. Add `"resume"` to `FocusZone`, and in `launcherKey` make Enter in the `"resume"` zone return `{ kind: "launch" }` (beside start, project and input); every other key in that zone stays `none` (the list handles its own arrows). Test all three in `launcher.test.ts` — `primaryLabel` with resuming, `footerLine` with a resume, and `Enter in the resume zone launches` (plus ArrowDown there returns none) — writing the tests first, seeing them fail, then implementing.

- [ ] **Step 3: The list.** `launcherresumelist.tsx` exports `ResumeList({ choices, pickedId })`. Render nothing when `choices` is empty. Otherwise a `LAUNCHER_LABEL` "Resume" heading and a `role="radiogroup"` with `data-launcher-resume` holding a first row "New session" (`pickedId` null) and one row per session (`data-resume-id={s.id}`): radio dot (`bg-accent` when picked, else `bg-muted`), title (`s.task || "(untitled session)"`, `text-[12.5px] font-semibold text-primary`, truncated), and a meta line `{s.branch || "—"} · {formatAge(now - s.lastactivets)} · {formatTokens(s.tokenstotal)} tok` (`formatAge`/`formatTokens` from `./agentsviewmodel`). Picked row `bg-accentbg`, others `hover:bg-surface-hover`. A click sets `launcherResumeAtom`. Keyboard: the group's `onKeyDown` handles ArrowUp/ArrowDown (move the pick and focus with `stepIndex` from `./launcher`, then `e.stopPropagation()` and `preventDefault()` so the dialog's column navigation does not see them); on Enter, `preventDefault()` on the row (no button click) and let it bubble to the dialog's `onKeyDown`, which launches because `zoneOf` names the zone `"resume"` (Step 5).

- [ ] **Step 4: Fields.** In `AgentFields`, take new props `resumeChoices: SessionInfo[]` and `resume: SessionInfo | null`. Render `<ResumeList>` between Task and Command when `runtimeShowsTask(runtime)`. With `resume` set: the Task hint reads "optional · sent as the next message"; the Command input shows `resumeLaunchSpec(resume, runtime, runtimeFlags).startupCommand`, `readOnly`, and the flag chips stay; the worktree block is not rendered.

- [ ] **Step 5: Modal.** In `launchermodal.tsx`: the Start-row pick (around line 388, `globalStore.set(launcherRuntimeAtom, row.id as Runtime)`) calls `pickLauncherRuntime(row.id as Runtime)` instead. `zoneOf` returns `"resume"` for a target inside `[data-launcher-resume]` (check it before the input/textarea cases: `target instanceof Element && target.closest("[data-launcher-resume]")`). Call `fireAndForget(loadLauncherSessions)` in an effect when the dialog opens (`open` true) with sessions reset to null first. Derive `const choices = resumeChoices(sessions, runtime, projectPath)` and `const resume = isRun ? null : pickedResume(choices, resumeId)`. Pass both to `AgentFields`. `primaryLabel(kind, runtime, resume != null)`; `footerLine({ …, resume: resume && { title: resume.task || "(untitled session)", branch: resume.branch } })`. In `launchAgentRow`, when `resume` is set, skip the worktree branch logic and spread `resumeLaunchSpec(resume, runtime, naFlags[runtime] ?? {})` over `startupCommand` (keep `task`, `projectPath: p.path`, `projectName: p.name`; `branch` undefined).

- [ ] **Step 6: Scenario `launcher-resume`** in `scripts/cdp/scenarios.mjs`, modeled on `launcherScenario` (same project setup via `createproject` and the recent-projects localStorage). Arrange also seeds one Claude transcript the backend scan will read as a session of that project: a directory `verify-launcher-resume-<random>` under `~/.claude/projects` holding `<uuid>.jsonl`. Read `claudeSessionFrom` / `parseClaudeLines` in `pkg/agentsessions/agentsessions.go` and their tests for the minimal records (a `cwd` equal to the project dir, a user prompt whose text is `verify resume session`, timestamps now). Teardown removes that directory, the projects and restores localStorage. Assert steps, each `rec(...)`:
  1. New agent opened with the verify project and Claude picked shows `[data-launcher-resume]` with a row whose text contains `verify resume session`; shot `cdp-shots/launcher-resume-1-list.png`.
  2. Clicking that row: the primary button reads `Resume agent`, the footer starts `Resumes`, `#launcher-cmd` value is `claude --resume <uuid>`, the Task hint contains `optional · sent as the next message`, and no `Isolated git worktree` switch is on screen; shot `cdp-shots/launcher-resume-2-picked.png`.
  3. Picking the second project: the Resume section is gone and the button reads `Launch agent`.
  4. Back on the first project: the Resume list is back with "New session" picked (the session row is not picked) and the button reads `Launch agent` — the pick did not survive the round trip. ArrowDown inside the list moves the pick to the session (button `Resume agent`), ArrowUp moves it back to "New session".
  5. Picking Terminal in the Start column: no `[data-launcher-resume]` on screen. Pick Claude again, then Escape the dialog. Never press Launch.

  Register the scenario: add `launcherResume` (the scenario object's variable) to the scenarios array at the bottom of `scenarios.mjs`, after `launcherScenario` (around line 25156); `task verify:ui` runs only what that array lists. Run it on the dev app: `task verify:ui -- launcher-resume launcher` (the dev app must be running; `task dev`).

- [ ] **Step 7: Check and commit.** `npx vitest run frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/launcherstore.test.ts frontend/app/view/agents/launcherresume.test.ts`, `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, `npx eslint` on the touched `.ts`/`.tsx`. Commit the files above with a pathspec: `feat(launcher): resume a recent session of the picked agent and project`.

### Task 4: Paste and drop images into Task

**Depends on:** Task 2, Task 3

**Files:** `frontend/app/view/agents/launcherstore.ts`, `frontend/app/view/agents/launcherstore.test.ts`, `frontend/app/view/agents/launcher.ts`, `frontend/app/view/agents/launcher.test.ts`, `frontend/app/view/agents/launcheragentfields.tsx`, `frontend/app/view/agents/launchermodal.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

- [ ] **Step 1: Store.** In `launcherstore.ts`:

```ts
export const launcherImagesAtom = atom<TaskImage[]>([]) as PrimitiveAtom<TaskImage[]>;

function patchImage(id: string, patch: Partial<TaskImage>): void {
    globalStore.set(launcherImagesAtom, (prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

// A paste is a bare blob (createTempFileFromBlob names it); a drop keeps its file name (createTempFileFromFile).
export function addTaskImages(files: File[], from: "paste" | "drop"): void {
    const room = imageRoom(globalStore.get(launcherImagesAtom).length, files.length);
    for (const f of files.slice(0, room)) {
        const id = crypto.randomUUID();
        globalStore.set(launcherImagesAtom, (prev) => [...prev, { id, previewUrl: URL.createObjectURL(f) }]);
        const write = from === "paste" ? createTempFileFromBlob(f) : createTempFileFromFile(f);
        write.then(
            (path) => patchImage(id, { path }),
            (e) => patchImage(id, { error: String(e?.message ?? e) })
        );
    }
}

export function removeTaskImage(id: string): void {
    const img = globalStore.get(launcherImagesAtom).find((i) => i.id === id);
    if (img != null) {
        URL.revokeObjectURL(img.previewUrl);
    }
    globalStore.set(launcherImagesAtom, (prev) => prev.filter((i) => i.id !== id));
}
```

`clearLauncherDraft` revokes every preview URL and empties the atom. A draft with only images counts as restored: in `launcher.ts`, `LauncherDraft` gains `images: number` and `draftShown` also returns true when `draft.images > 0` (update its comment, which lists what a close keeps); `keptDraft` in `launcherstore.ts` passes `images: globalStore.get(launcherImagesAtom).length`. Tests, written first: in `launcher.test.ts`, `draftShown counts images` (`{ ...empty, images: 1 }` → true; the existing `empty` gains `images: 0`); in `launcherstore.test.ts`, `clearLauncherDraft()` empties the images (stub `URL.revokeObjectURL` with `vi.fn()`), and `removeTaskImage` drops only its id.

- [ ] **Step 2: Fields.** In `AgentFields`, on the Task textarea:
  - `onPaste`: `const files = imageFilesOf(e.clipboardData?.files)`; if none, return (the browser pastes text as usual). Otherwise `e.preventDefault()`, `addTaskImages(files, "paste")`, and if `e.clipboardData.getData("text/plain")` is non-empty insert it at the caret with `setRangeText(text, start, end, "end")` and write the new value to `launcherTaskAtom`.
  - `onDragOver`: `preventDefault()` when the drag carries files. `onDrop`: `imageFilesOf(e.dataTransfer.files)`; with any, `preventDefault()` and `addTaskImages(files, "drop")`.
  - Under the textarea, when `launcherImagesAtom` is non-empty, a `flex flex-wrap gap-2` row of 48px tiles (`data-task-image`, plus `data-task-image-state="pending|ready|error"`): an `<img src={previewUrl}>` `object-cover rounded-[8px] border border-edge-mid`, a spinner overlay while pending, `border-warning` on error, and an ✕ button (`aria-label="Remove image"`) calling `removeTaskImage`. Below it, one `text-[12px] text-warning` line per failed image: `<error>`. Update the Task hint to `optional · sent as the first prompt · paste or drop images` (and `… next message …` when resuming).

- [ ] **Step 3: Modal.** In `launchermodal.tsx`, read `launcherImagesAtom`. `primaryDisabled` also holds while `!isRun && imagesPending(images)`. In `launchAgentRow`, compute `const { task: fullTask, extraArgs } = composeTaskWithImages(runtime, runtimeShowsTask(runtime) ? task : "", images.flatMap((i) => (i.path ? [i.path] : [])), resume != null)` and pass `task: fullTask, extraArgs` to `launchAgent`. `endLauncherDraft` already clears the images through `clearLauncherDraft`.

- [ ] **Step 4: Scenario `launcher-images`** in `scripts/cdp/scenarios.mjs`, modeled on `launcherScenario`. A page helper makes a PNG `File` from a 32×32 canvas (`canvas.toBlob`) and dispatches on `#launcher-task` a `new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })` with a `DataTransfer` holding it; a second helper dispatches `new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })` the same way. Assert steps, each `rec(...)`:
  1. One paste: one `[data-task-image]` reaching `data-task-image-state="ready"` within 10 s; shot `cdp-shots/launcher-images-1-one.png`.
  2. A paste whose `DataTransfer` carries only `text/plain` `hello`: the dispatched event's `defaultPrevented` is false (`dispatchEvent` returns true) and there is still exactly one tile. (A synthetic paste has no default action, so the textarea's value is not asserted.)
  3. A second image paste: two tiles; removing the first with its ✕ (`aria-label="Remove image"`) leaves one; shot `cdp-shots/launcher-images-2-row.png`.
  4. A drop of a PNG on `#launcher-task`: its `defaultPrevented` is true and a new tile reaches `ready` (two tiles).
  5. Pending: in one evaluate, paste a large noise PNG (a 900×900 canvas filled with random pixels, about 3 MB, under the 3.5 MB cap), wait one `requestAnimationFrame`, then read: a tile with `data-task-image-state="pending"` is on screen and the dialog's primary button is `disabled`. Then wait (within 15 s) for it to leave `pending` and the button to be enabled again; shot `cdp-shots/launcher-images-3-pending.png` is taken while pending if the timing allows, else after.
  6. Error: paste a `File` of type `image/x-none` (`createTempFileFromBlob` refuses an unknown image type): its tile reaches `data-task-image-state="error"` and a `text-warning` line naming the error is under the box; shot `cdp-shots/launcher-images-4-error.png`. The primary button is enabled (an error does not hold the launch).
  7. Survives a close: Escape the dialog, reopen New agent: the same number of tiles is on screen and `[data-launcher-restored]` ("draft restored") shows; shot `cdp-shots/launcher-images-5-reopen.png`.
  8. Teardown removes every tile, clears the task (the dialog's Clear, which runs `clearLauncherDraft`) and closes the dialog. Never press Launch.

  Register the scenario: add `launcherImages` (the scenario object's variable) to the scenarios array at the bottom of `scenarios.mjs`, after `launcherResume` (around line 25156); `task verify:ui` runs only what that array lists. Run it on the dev app: `task verify:ui -- launcher-images launcher`.

- [ ] **Step 5: Changelog.** Under `Added` in the top `CHANGELOG.md` section (open `## Unreleased` above a dated one): `- New agent: paste or drop images into the task, and resume a recent session of the picked agent and project.`

- [ ] **Step 6: Check and commit.** `npx vitest run frontend/app/view/agents/`, `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, `npx eslint` on the touched `.ts`/`.tsx`. Commit the files above with a pathspec: `feat(launcher): paste or drop images into the task`.
