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
- A picked session is honored only while it is among the current choices (derived with `pickedResume`), so switching runtime or project drops it without any reset code.
- Images: at most 8 (`MAX_TASK_IMAGES`); a paste is written with `createTempFileFromBlob`, a drop with `createTempFileFromFile` (both `frontend/app/view/term/termutil.ts`, 3.5 MB cap). Only `image/*` files are taken.
- At launch: codex starting fresh gets `--image <p1>,<p2>` after the prompt (via `extraArgs`); every other case (claude, agy, a codex resume, a path with a comma) appends to the task:
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
3. **A session picked, then the project switched:** the launch must start fresh in the new project, not resume the old session. Pinned in Task 1 (`pickedResume returns null for an id not among the choices`).
4. **Codex resume with images:** `codex resume <id>` may not take `--image`, so the images go in the text block. Pinned in Task 2 (`codex resuming uses the text block`).
5. **A plain-text paste into Task:** unchanged — no temp file, the text lands at the caret. Pinned in Task 4 (scenario step 2).
6. **Launch while an image is still writing:** the primary button is disabled until every image has a path or an error. Pinned in Task 4 (`imagesPending`).

---

### Task 1: Resume model (pure)

**Depends on:** none

**Files:**
- Create: `frontend/app/view/agents/launcherresume.ts`
- Test: `frontend/app/view/agents/launcherresume.test.ts`

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

// A pick outlives a runtime or project switch in the store; it counts only while it is still on offer.
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

**Files:**
- Create: `frontend/app/view/agents/launcherimages.ts`
- Test: `frontend/app/view/agents/launcherimages.test.ts`
- Modify: `frontend/app/view/agents/launch.ts` (`LaunchMetaSpec`, `buildLaunchMeta`)
- Modify: `frontend/app/view/agents/launch.test.ts`
- Modify: `frontend/app/cockpit/cockpit-actions.ts` (`LaunchAgentOpts` gains `extraArgs?: string[]`, passed to `buildLaunchMeta`; find the type with `grep -n "LaunchAgentOpts" -r frontend/app/cockpit`)

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

**Files:**
- Modify: `frontend/app/view/agents/launcherstore.ts`
- Modify: `frontend/app/view/agents/launcherstore.test.ts`
- Modify: `frontend/app/view/agents/launcher.ts` (`footerLine`, `primaryLabel`)
- Modify: `frontend/app/view/agents/launcher.test.ts`
- Create: `frontend/app/view/agents/launcherresumelist.tsx`
- Modify: `frontend/app/view/agents/launcheragentfields.tsx`
- Modify: `frontend/app/view/agents/launchermodal.tsx`
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `launcher-resume`, registered wherever `launcherScenario` is)

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

`clearLauncherDraft` sets `launcherResumeAtom` to null. Add a `launcherstore.test.ts` case: after setting a resume id, `clearLauncherDraft()` leaves it null.

- [ ] **Step 2: Footer and label.** In `launcher.ts`: `primaryLabel(kind, runtime, resuming = false)` returns `"Resume agent"` for an agent with `resuming`; `FooterInput` gains `resume?: { title: string; branch: string } | null`, and for `kind === "agent"` with a resume, `footerLine` returns `{ lead: "Resumes ", strong: title, tail: branch ? \` · ${branch}\` : "", blocked: false }`. Title is `session.task || "(untitled session)"`. Test both in `launcher.test.ts` (write the tests first, see them fail, then implement).

- [ ] **Step 3: The list.** `launcherresumelist.tsx` exports `ResumeList({ choices, pickedId })`. Render nothing when `choices` is empty. Otherwise a `LAUNCHER_LABEL` "Resume" heading and a `role="radiogroup"` with `data-launcher-resume` holding a first row "New session" (`pickedId` null) and one row per session (`data-resume-id={s.id}`): radio dot (`bg-accent` when picked, else `bg-muted`), title (`s.task || "(untitled session)"`, `text-[12.5px] font-semibold text-primary`, truncated), and a meta line `{s.branch || "—"} · {formatAge(now - s.lastactivets)} · {formatTokens(s.tokenstotal)} tok` (`formatAge`/`formatTokens` from `./agentsviewmodel`). Picked row `bg-accentbg`, others `hover:bg-surface-hover`. A click sets `launcherResumeAtom`. Keyboard: the group's `onKeyDown` handles ArrowUp/ArrowDown (move the pick and focus with `stepIndex` from `./launcher`, then `e.stopPropagation()` and `preventDefault()` so the dialog's column navigation does not see them); on Enter, `preventDefault()` on the row (no click) and let it bubble so the dialog launches — read the dialog's `onKeyDown` (`launchermodal.tsx`, around line 500) first and confirm Enter in this zone launches; adjust `zoneOf` if it does not.

- [ ] **Step 4: Fields.** In `AgentFields`, take new props `resumeChoices: SessionInfo[]` and `resume: SessionInfo | null`. Render `<ResumeList>` between Task and Command when `runtimeShowsTask(runtime)`. With `resume` set: the Task hint reads "optional · sent as the next message"; the Command input shows `resumeLaunchSpec(resume, runtime, runtimeFlags).startupCommand`, `readOnly`, and the flag chips stay; the worktree block is not rendered.

- [ ] **Step 5: Modal.** In `launchermodal.tsx`: call `fireAndForget(loadLauncherSessions)` in an effect when the dialog opens (`open` true) with sessions reset to null first. Derive `const choices = resumeChoices(sessions, runtime, projectPath)` and `const resume = isRun ? null : pickedResume(choices, resumeId)`. Pass both to `AgentFields`. `primaryLabel(kind, runtime, resume != null)`; `footerLine({ …, resume: resume && { title: resume.task || "(untitled session)", branch: resume.branch } })`. In `launchAgentRow`, when `resume` is set, skip the worktree branch logic and spread `resumeLaunchSpec(resume, runtime, naFlags[runtime] ?? {})` over `startupCommand` (keep `task`, `projectPath: p.path`, `projectName: p.name`; `branch` undefined).

- [ ] **Step 6: Scenario `launcher-resume`** in `scripts/cdp/scenarios.mjs`, modeled on `launcherScenario` (same project setup via `createproject` and the recent-projects localStorage). Arrange also seeds one Claude transcript the backend scan will read as a session of that project: a directory `verify-launcher-resume-<random>` under `~/.claude/projects` holding `<uuid>.jsonl`. Read `claudeSessionFrom` / `parseClaudeLines` in `pkg/agentsessions/agentsessions.go` and their tests for the minimal records (a `cwd` equal to the project dir, a user prompt whose text is `verify resume session`, timestamps now). Teardown removes that directory, the projects and restores localStorage. Assert steps, each `rec(...)`:
  1. New agent opened with the verify project and Claude picked shows `[data-launcher-resume]` with a row whose text contains `verify resume session`; shot `cdp-shots/launcher-resume-1-list.png`.
  2. Clicking that row: the primary button reads `Resume agent`, the footer starts `Resumes`, `#launcher-cmd` value is `claude --resume <uuid>`, and no `Isolated git worktree` switch is on screen; shot `cdp-shots/launcher-resume-2-picked.png`.
  3. Picking the second project: the Resume section is gone and the button reads `Launch agent`.
  4. Back on the first project, ArrowDown/ArrowUp inside the list moves the pick; then pick "New session" and Escape the dialog. Never press Launch.

  Run it on the dev app: `task verify:ui -- launcher-resume launcher` (the dev app must be running; `task dev`).

- [ ] **Step 7: Check and commit.** `npx vitest run frontend/app/view/agents/launcher.test.ts frontend/app/view/agents/launcherstore.test.ts frontend/app/view/agents/launcherresume.test.ts`, `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, `npx eslint` on the touched `.ts`/`.tsx`. Commit the files above with a pathspec: `feat(launcher): resume a recent session of the picked agent and project`.

### Task 4: Paste and drop images into Task

**Depends on:** Task 2, Task 3

**Files:**
- Modify: `frontend/app/view/agents/launcherstore.ts`
- Modify: `frontend/app/view/agents/launcherstore.test.ts`
- Modify: `frontend/app/view/agents/launcheragentfields.tsx`
- Modify: `frontend/app/view/agents/launchermodal.tsx`
- Modify: `scripts/cdp/scenarios.mjs` (new scenario `launcher-images`)
- Modify: `CHANGELOG.md`

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

`clearLauncherDraft` revokes every preview URL and empties the atom. `draftShown`'s draft (`keptDraft` here, `draftShown` in `launcher.ts`) counts images too, so a draft with only images is reported as restored. Test in `launcherstore.test.ts`: `clearLauncherDraft()` empties the images (stub `URL.revokeObjectURL` with `vi.fn()`); `removeTaskImage` drops only its id.

- [ ] **Step 2: Fields.** In `AgentFields`, on the Task textarea:
  - `onPaste`: `const files = imageFilesOf(e.clipboardData?.files)`; if none, return (the browser pastes text as usual). Otherwise `e.preventDefault()`, `addTaskImages(files, "paste")`, and if `e.clipboardData.getData("text/plain")` is non-empty insert it at the caret with `setRangeText(text, start, end, "end")` and write the new value to `launcherTaskAtom`.
  - `onDragOver`: `preventDefault()` when the drag carries files. `onDrop`: `imageFilesOf(e.dataTransfer.files)`; with any, `preventDefault()` and `addTaskImages(files, "drop")`.
  - Under the textarea, when `launcherImagesAtom` is non-empty, a `flex flex-wrap gap-2` row of 48px tiles (`data-task-image`, plus `data-task-image-state="pending|ready|error"`): an `<img src={previewUrl}>` `object-cover rounded-[8px] border border-edge-mid`, a spinner overlay while pending, `border-warning` on error, and an ✕ button (`aria-label="Remove image"`) calling `removeTaskImage`. Below it, one `text-[12px] text-warning` line per failed image: `<error>`. Update the Task hint to `optional · sent as the first prompt · paste or drop images` (and `… next message …` when resuming).

- [ ] **Step 3: Modal.** In `launchermodal.tsx`, read `launcherImagesAtom`. `primaryDisabled` also holds while `!isRun && imagesPending(images)`. In `launchAgentRow`, compute `const { task: fullTask, extraArgs } = composeTaskWithImages(runtime, runtimeShowsTask(runtime) ? task : "", images.flatMap((i) => (i.path ? [i.path] : [])), resume != null)` and pass `task: fullTask, extraArgs` to `launchAgent`. `endLauncherDraft` already clears the images through `clearLauncherDraft`.

- [ ] **Step 4: Scenario `launcher-images`** in `scripts/cdp/scenarios.mjs`, modeled on `launcherScenario`. A page helper makes a PNG `File` from a 32×32 canvas (`canvas.toBlob`) and dispatches on `#launcher-task` a `new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })` with a `DataTransfer` holding it. Assert steps:
  1. One paste: one `[data-task-image]` reaching `ready` within 10 s; shot `cdp-shots/launcher-images-1-one.png`.
  2. A paste carrying only `text/plain` `hello`: still one tile, and the task value ends with `hello`.
  3. A second image paste: two tiles; removing the first with its ✕ leaves one; shot `cdp-shots/launcher-images-2-row.png`.
  4. Teardown removes every tile, clears the task (the store's `clearLauncherDraft` through the dialog's Clear, or by emptying the textarea) and closes the dialog. Never press Launch.

  Run it on the dev app: `task verify:ui -- launcher-images launcher`.

- [ ] **Step 5: Changelog.** Under `Added` in the top `CHANGELOG.md` section (open `## Unreleased` above a dated one): `- New agent: paste or drop images into the task, and resume a recent session of the picked agent and project.`

- [ ] **Step 6: Check and commit.** `npx vitest run frontend/app/view/agents/`, `NODE_OPTIONS=--max-old-space-size=4096 task check:ts`, `npx eslint` on the touched `.ts`/`.tsx`. Commit the files above with a pathspec: `feat(launcher): paste or drop images into the task`.
