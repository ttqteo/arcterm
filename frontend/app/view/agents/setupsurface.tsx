// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Setup surface: the instructions and skills every harness reads. The Instructions tab edits the
// shared doc, which every save writes into each harness's file, and lists each harness file's state.
// The Skills tab views every harness's skills and moves them into the vault; it never creates or edits
// one. Logic lives in setupmodel.ts and skillsmatrix.ts, the RPCs and the atoms in setupstore.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Share2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo } from "./agentsviewmodel";
import { RuntimeMark } from "./runtimemark";
import { runtimeMeta } from "./runtimemeta";
import {
    changedLineCount,
    harnessRowLabel,
    harnessRowState,
    harnessRowTone,
    headerStatus,
    isDirty,
    lineCount,
    saveTargetCount,
    type DocEditor,
    type Tone,
} from "./setupmodel";
import {
    adoptSkills,
    discardShared,
    loadSetup,
    loadSkills,
    openSkillFile,
    reloadShared,
    saveShared,
    selectSkill,
    setSkillKeep,
    setupBusyAtom,
    setupErrorAtom,
    setupSharedAtom,
    setupSharedPathAtom,
    setupSkillKeepAtom,
    setupSkillsAtom,
    setupSkillSelectedAtom,
    setupStatusAtom,
    setupTabAtom,
    typeShared,
    type SetupTab,
} from "./setupstore";
import {
    adoptCount,
    copyDelta,
    manageLabel,
    skillFilePath,
    skillGroups,
    skillNote,
    skillsSummary,
    type SkillCell,
    type SkillGroup,
    type SkillRow,
} from "./skillsmatrix";

const SECTION_HEAD = cn(REGION_LABEL, "text-muted");
const BTN_SECONDARY =
    "h-[30px] cursor-pointer rounded border border-edge-mid bg-surface-raised px-3 text-[12.5px] font-semibold text-ink-mid hover:border-edge-strong hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:text-ink-faint disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
const BTN_PRIMARY =
    "h-8 cursor-pointer rounded border-0 bg-accent px-[14px] text-[13px] font-bold text-background shadow-inset-highlight hover:bg-accenthover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent";

const TONE_DOT: Record<Tone, string> = { ok: "bg-success", warn: "bg-warning", none: "bg-ink-faint" };
const TONE_TEXT: Record<Tone, string> = { ok: "text-ink-mid", warn: "text-warning-soft", none: "text-muted" };

const TABS: { key: SetupTab; label: string }[] = [
    { key: "instructions", label: "Instructions" },
    { key: "skills", label: "Skills" },
];

function useRows(): AgentSyncHarness[] {
    return useAtomValue(setupStatusAtom)?.harnesses ?? [];
}

function Dot({ tone, size = 6 }: { tone: Tone; size?: 6 | 7 }) {
    return (
        <span
            className={cn("flex-none rounded-full", TONE_DOT[tone], size === 7 ? "h-[7px] w-[7px]" : "h-1.5 w-1.5")}
        />
    );
}

function HarnessMark({ runtime }: { runtime: string }) {
    const meta = runtimeMeta(runtime);
    return (
        <span
            className={cn(
                "flex flex-none items-center justify-center rounded-[5px] border text-[10.5px] font-bold",
                meta.line,
                meta.text,
                "h-5 w-5"
            )}
        >
            <RuntimeMark runtime={runtime} imageClassName="h-3 w-3" />
        </span>
    );
}

// the folder truncates and the file name never does: every path here starts with the same home prefix,
// so a plain tail ellipsis hid the one part that tells two rows apart
function PathTail({ path }: { path: string }) {
    const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
    return (
        <span title={path} className="flex min-w-0 text-[10.5px] text-muted">
            <span className="truncate">{path.slice(0, cut)}</span>
            <span className="flex-none">{path.slice(cut)}</span>
        </span>
    );
}

function Tabs() {
    const tab = useAtomValue(setupTabAtom);
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
            return;
        }
        e.preventDefault();
        const i = TABS.findIndex((t) => t.key === tab);
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        globalStore.set(setupTabAtom, next.key);
        document.getElementById(`setup-tab-${next.key}`)?.focus();
    };
    return (
        <div
            role="tablist"
            aria-label="Setup"
            onKeyDown={onKey}
            className="flex gap-0.5 rounded border border-border bg-surface p-[3px]"
        >
            {TABS.map((t) => (
                <button
                    key={t.key}
                    id={`setup-tab-${t.key}`}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    aria-controls="setup-tabpanel"
                    tabIndex={tab === t.key ? 0 : -1}
                    onClick={() => globalStore.set(setupTabAtom, t.key)}
                    className={cn(
                        "cursor-pointer rounded-md border-0 px-3 py-[5px] text-[13px]",
                        tab === t.key
                            ? "bg-surface-selected font-semibold text-primary"
                            : "bg-transparent font-medium text-ink-mid hover:text-primary"
                    )}
                >
                    {t.label}
                </button>
            ))}
        </div>
    );
}

function HeaderStatus() {
    const rows = useRows();
    const status = useAtomValue(setupStatusAtom);
    if (status == null) {
        return null;
    }
    const s = headerStatus(rows);
    return (
        <div
            className={cn(
                "flex items-center gap-2 text-[12px]",
                s.tone === "warn" ? "text-warning-soft" : "text-ink-mid"
            )}
        >
            <Dot tone={s.tone} size={7} />
            {s.text}
        </div>
    );
}

// ---- left list ----

function FileList({ rows }: { rows: AgentSyncHarness[] }) {
    const shared = useAtomValue(setupSharedAtom);
    const status = useAtomValue(setupStatusAtom);
    const rowClass = "flex w-full items-start gap-2.5 rounded px-2.5 py-[9px]";
    return (
        <aside
            aria-label="Instruction files"
            className="flex w-[264px] flex-none flex-col gap-1 overflow-y-auto border-r border-border bg-surface px-2.5 py-3.5"
        >
            <div className={cn(SECTION_HEAD, "px-2 pb-1.5")}>Shared</div>
            <div className={cn(rowClass, "bg-surface-selected text-primary ring-1 ring-edge-strong ring-inset")}>
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px] bg-accentbg text-accent-soft">
                    <Share2 size={12} strokeWidth={2.2} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                        For every harness
                        {isDirty(shared) ? (
                            <span
                                aria-label="Unsaved changes"
                                title="Unsaved changes"
                                className="ml-auto h-[7px] w-[7px] rounded-full bg-accent"
                            />
                        ) : null}
                    </span>
                    <span className="text-[10.5px] text-muted">vault/steering/AGENTS.md</span>
                </span>
            </div>

            <div className={cn(SECTION_HEAD, "px-2 pb-1.5 pt-4")}>Harness files</div>
            {status == null ? <div className="px-2 text-[12px] text-muted">Reading…</div> : null}
            {rows.map((r) => {
                const state = harnessRowState(r);
                const tone = harnessRowTone(state);
                return (
                    <div key={r.runtime} className={cn(rowClass, "text-secondary", !r.present && "opacity-50")}>
                        <HarnessMark runtime={r.runtime} />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-[13px] font-medium">{r.label}</span>
                            <PathTail path={r.path} />
                            <span className={cn("mt-[3px] flex items-center gap-1.5 text-[11px]", TONE_TEXT[tone])}>
                                <Dot tone={tone} />
                                {harnessRowLabel(state)}
                            </span>
                        </span>
                    </div>
                );
            })}
        </aside>
    );
}

// ---- shared doc ----

function ConflictNotice({
    onReload,
    onOverwrite,
    busy,
}: {
    onReload: () => void;
    onOverwrite: () => void;
    busy: boolean;
}) {
    return (
        <div
            role="alert"
            className="flex items-center gap-3 rounded border border-warning/30 bg-warning/10 px-3.5 py-2.5"
        >
            <TriangleAlert size={16} strokeWidth={2} className="flex-none text-warning" />
            <span className="min-w-0 flex-1 text-[12.5px] text-secondary">
                <span className="font-semibold text-warning-soft">Changed on disk since you opened it.</span> Reload to
                take the file as it is now and lose your edits, or overwrite it with yours.
            </span>
            <button type="button" disabled={busy} onClick={onReload} className={BTN_SECONDARY}>
                Reload
            </button>
            <button type="button" disabled={busy} onClick={onOverwrite} className={BTN_SECONDARY}>
                Overwrite
            </button>
        </div>
    );
}

function LineEditor({
    ed,
    onChange,
    path,
    placeholder,
}: {
    ed: DocEditor;
    onChange: (v: string) => void;
    path: string;
    placeholder: string;
}) {
    const gutter = useRef<HTMLDivElement>(null);
    const n = Math.max(1, ed.draft.split("\n").length);
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge-mid bg-surface-code focus-within:ring-2 focus-within:ring-accent/25">
            <div className="flex h-[30px] flex-none items-center gap-2.5 border-b border-edge-faint px-3 text-[11px] tabular-nums text-muted">
                <span title={path} className="min-w-0 truncate">
                    {path}
                </span>
                <span className="flex-1" />
                <span>Markdown</span>
                <span className="text-muted">·</span>
                <span>
                    {lineCount(ed.draft)} {lineCount(ed.draft) === 1 ? "line" : "lines"}
                </span>
            </div>
            <div className="flex min-h-0 flex-1 font-mono text-[12.5px] leading-[21px]">
                {/* the gutter follows the textarea's scroll, so the numbers stay beside their lines */}
                <div
                    ref={gutter}
                    aria-hidden
                    className="w-10 flex-none overflow-hidden py-2 pr-3 text-right text-ink-faint select-none"
                >
                    {Array.from({ length: n }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
                <textarea
                    aria-label="Instructions for every harness"
                    value={ed.draft}
                    spellCheck={false}
                    wrap="off"
                    placeholder={placeholder}
                    onChange={(e) => onChange(e.target.value)}
                    onScroll={(e) => {
                        if (gutter.current) {
                            gutter.current.scrollTop = e.currentTarget.scrollTop;
                        }
                    }}
                    className="min-h-0 flex-1 resize-none border-0 bg-transparent py-2 pr-4 text-secondary outline-none placeholder:text-muted"
                />
            </div>
        </div>
    );
}

function SharedEditor({ rows }: { rows: AgentSyncHarness[] }) {
    const ed = useAtomValue(setupSharedAtom);
    const path = useAtomValue(setupSharedPathAtom);
    const busy = useAtomValue(setupBusyAtom);
    const dirty = isDirty(ed);
    const n = saveTargetCount(rows);
    const changed = changedLineCount(ed.base, ed.draft);
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
            <div className="flex items-center gap-3.5">
                <div className="flex min-w-0 flex-col gap-[3px]">
                    <div className="text-[15px] font-semibold text-primary">Instructions for every harness</div>
                    <div className="text-[12px] text-muted">Saving writes this into each harness file below.</div>
                </div>
                <div className="flex-1" />
                {dirty ? (
                    <span className="text-[12px] text-accent-soft">
                        {changed} {changed === 1 ? "line" : "lines"} changed
                    </span>
                ) : null}
                <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={discardShared}
                    className={cn(BTN_SECONDARY, "h-8 text-[13px]")}
                >
                    Discard
                </button>
                <button
                    type="button"
                    disabled={!dirty || busy || n === 0}
                    onClick={() => fireAndForget(() => saveShared(false))}
                    className={BTN_PRIMARY}
                >
                    {busy ? "Saving…" : `Save to ${n} ${n === 1 ? "harness" : "harnesses"}`}
                </button>
            </div>
            {ed.conflict ? (
                <ConflictNotice
                    busy={busy}
                    onReload={() => fireAndForget(reloadShared)}
                    onOverwrite={() => fireAndForget(() => saveShared(true))}
                />
            ) : null}
            <LineEditor
                ed={ed}
                path={path}
                onChange={typeShared}
                placeholder="The instructions every harness should follow. Saving writes them into each harness's file."
            />
        </div>
    );
}

function SharedRail({ rows }: { rows: AgentSyncHarness[] }) {
    const ed = useAtomValue(setupSharedAtom);
    return (
        <aside
            aria-label="Where this goes"
            className="flex w-[300px] flex-none flex-col gap-[18px] overflow-y-auto border-l border-border bg-surface px-4 py-[18px]"
        >
            <div className="flex flex-col gap-2">
                <div className={SECTION_HEAD}>How saving works</div>
                <p className="m-0 text-[12px] leading-[1.45] text-ink-mid">
                    Each harness file gets this doc between two arcterm marker lines. Anything outside them is left alone.
                </p>
            </div>
            <div className="flex flex-col gap-2">
                <div className={SECTION_HEAD}>Saving writes to</div>
                {rows
                    .filter((r) => r.present)
                    .map((r) => (
                        <div
                            key={r.runtime}
                            className="flex flex-col gap-[3px] rounded border border-border px-2.5 py-2"
                        >
                            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                {r.label}
                            </span>
                            <PathTail path={r.path} />
                        </div>
                    ))}
            </div>
            <div className="flex-1" />
            <div className="text-[11.5px] leading-[1.5] text-muted">
                {ed.mtime > 0 ? `Last saved ${formatAgo(Math.max(0, Date.now() - ed.mtime))}.` : "Not saved yet."} arcterm
                also re-applies this on every launch.
            </div>
        </aside>
    );
}

// ---- tabs ----

function InstructionsTab() {
    const rows = useRows();
    const error = useAtomValue(setupErrorAtom);
    const status = useAtomValue(setupStatusAtom);
    return (
        <div className="flex min-h-0 flex-1">
            <FileList rows={rows} />
            <div className="flex min-w-0 flex-1 flex-col">
                {error ? (
                    <div
                        role="alert"
                        className="flex-none border-b border-error/30 bg-error/10 px-5 py-2 text-[12.5px] text-error-soft"
                    >
                        {error}
                    </div>
                ) : null}
                <div className="flex min-h-0 flex-1">
                    {status == null ? (
                        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                    ) : (
                        <>
                            <SharedEditor rows={rows} />
                            <SharedRail rows={rows} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---- skills ----

const SKILL_COLUMN_WIDTH = "118px";

function useSkillGroups(): { data: CommandAgentSyncSkillsRtnData | null; groups: SkillGroup[] } {
    const data = useAtomValue(setupSkillsAtom);
    const keep = useAtomValue(setupSkillKeepAtom);
    return { data, groups: data == null ? [] : skillGroups(data, keep) };
}

function SkillsHeader() {
    const data = useAtomValue(setupSkillsAtom);
    const keep = useAtomValue(setupSkillKeepAtom);
    const busy = useAtomValue(setupBusyAtom);
    if (data == null) {
        return null;
    }
    const n = adoptCount(data, keep);
    return (
        <>
            <span className="text-[12px] text-ink-mid">{skillsSummary(data)}</span>
            <button
                type="button"
                disabled={busy || n === 0}
                onClick={() => fireAndForget(adoptSkills)}
                className={BTN_PRIMARY}
            >
                {manageLabel(n)}
            </button>
        </>
    );
}

function SkillCellView({ cell }: { cell: SkillCell }) {
    return (
        <span
            role="cell"
            title={cell.title}
            className={cn(
                "flex min-w-0 items-center gap-1.5 text-[11.5px]",
                cell.tone == null ? "text-muted" : TONE_TEXT[cell.tone]
            )}
        >
            {cell.tone != null ? <Dot tone={cell.tone} /> : null}
            <span className="truncate">{cell.label}</span>
        </span>
    );
}

function SkillsMatrix({
    columns,
    groups,
    selected,
}: {
    columns: AgentSyncSkillColumn[];
    groups: SkillGroup[];
    selected: string | null;
}) {
    // the column count comes from the backend, so the template cannot be a static utility
    const grid = { gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, ${SKILL_COLUMN_WIDTH})` };
    const onKey = (e: KeyboardEvent, name: string) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectSkill(name);
        }
    };
    return (
        <div
            role="table"
            aria-label="Skills by harness"
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-edge-mid bg-surface"
        >
            <div
                role="row"
                style={grid}
                className="grid min-h-9 flex-none items-center border-b border-edge-mid bg-surface-raised px-3 py-1 text-[11px] font-bold tracking-[0.04em] text-ink-mid"
            >
                <span role="columnheader">Skill</span>
                {columns.map((c) => (
                    <span key={c.runtime} role="columnheader" className="flex min-w-0 flex-col gap-px">
                        <span className="flex items-center gap-1.5">
                            <HarnessMark runtime={c.runtime} />
                            <span className="truncate">{c.label}</span>
                        </span>
                        {c.present ? null : (
                            <span className="text-[10.5px] font-semibold tracking-normal text-warning">not set up</span>
                        )}
                    </span>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {groups.length === 0 ? (
                    <div className="px-3 py-6 text-center text-[12.5px] text-muted">No skills in any harness.</div>
                ) : null}
                {groups.map((g) => (
                    <div key={g.key} role="rowgroup" aria-label={g.title}>
                        <div
                            className={cn(
                                REGION_LABEL,
                                "flex h-[26px] items-center gap-2 border-b border-edge-faint bg-background px-3 text-muted"
                            )}
                        >
                            {g.title}
                            <span className="font-medium normal-case tracking-normal text-muted">
                                · {g.rows.length}
                            </span>
                        </div>
                        {g.rows.map((r) => (
                            <div
                                key={r.name}
                                role="row"
                                tabIndex={0}
                                aria-selected={r.name === selected}
                                onClick={() => selectSkill(r.name)}
                                onKeyDown={(e) => onKey(e, r.name)}
                                style={grid}
                                className={cn(
                                    "grid h-7 cursor-pointer items-center border-b border-edge-faint px-3 outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset",
                                    r.name === selected
                                        ? "bg-surface-selected shadow-[inset_2px_0_0_var(--color-accent)]"
                                        : "hover:bg-surface-hover"
                                )}
                            >
                                <span role="cell" className="truncate text-[12px] text-ink-hi">
                                    {r.name}
                                </span>
                                {r.cells.map((c) => (
                                    <SkillCellView key={c.runtime} cell={c} />
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function KeepChoice({ row }: { row: SkillRow }) {
    const keep = useAtomValue(setupSkillKeepAtom);
    const chosen = keep[row.name] ?? null;
    const option = (runtime: string | null, title: string, hint: string) => (
        <label
            key={runtime ?? ""}
            className={cn(
                "flex cursor-pointer items-start gap-2 rounded px-2.5 py-2 text-[12.5px] text-secondary",
                chosen === runtime ? "bg-surface-selected ring-1 ring-edge-strong ring-inset" : "hover:bg-surface-hover"
            )}
        >
            <input
                type="radio"
                name={`skill-keep-${row.name}`}
                checked={chosen === runtime}
                onChange={() => setSkillKeep(row.name, runtime)}
                className="mt-0.5 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{title}</span>
                <span className="text-[11.5px] text-muted">{hint}</span>
            </span>
        </label>
    );
    return (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={cn(SECTION_HEAD, "pb-1.5")}>When arcterm manages it</legend>
            {row.copies.map((c) =>
                option(c.runtime, `Keep ${c.label}'s copy`, "Every harness gets it. The other copies are set aside.")
            )}
            {option(null, "Leave these copies alone", "arcterm skips this skill; each harness keeps its own file.")}
        </fieldset>
    );
}

function SkillRail({ model, row, skillsroot }: { model: AgentsViewModel; row: SkillRow; skillsroot: string }) {
    const keep = useAtomValue(setupSkillKeepAtom);
    const busy = useAtomValue(setupBusyAtom);
    const differs = row.kind === "decide" || row.kind === "differs";
    const card = "flex flex-col gap-[5px] rounded border border-border px-2.5 py-[9px]";
    return (
        <aside
            aria-label="Skill detail"
            className="flex w-[360px] flex-none flex-col gap-3.5 overflow-y-auto border-l border-border bg-surface p-4"
        >
            <div className="flex flex-col gap-1.5">
                <div className="text-[14px] font-medium text-primary">{row.name}</div>
                <div className="text-[12.5px] leading-[1.5] text-ink-mid">{skillNote(row)}</div>
            </div>
            <div className="flex flex-col gap-2">
                <div className={SECTION_HEAD}>{differs ? "What differs" : "Where it lives"}</div>
                {row.kind === "managed" ? (
                    <>
                        <div className={card}>
                            <span className="text-[12.5px] font-semibold text-secondary">arcterm vault</span>
                            <span className="truncate text-[10.5px] text-muted">
                                {skillFilePath(row, skillsroot, keep)}
                            </span>
                        </div>
                        {Object.entries(row.deltas).map(([runtime, over]) => (
                            <div key={runtime} className={card}>
                                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                    <HarnessMark runtime={runtime} />
                                    {runtimeMeta(runtime).label}
                                </span>
                                <span className="text-[10.5px] text-muted">Overrides {over.join(", ")}</span>
                            </div>
                        ))}
                    </>
                ) : (
                    row.copies.map((c) => (
                        <div key={c.runtime} className={card}>
                            <span className="flex items-center gap-2 text-[12.5px] font-semibold text-secondary">
                                <HarnessMark runtime={c.runtime} />
                                {c.label}
                                {differs ? (
                                    <span className="ml-auto text-[11px] font-normal text-muted">{copyDelta(c)}</span>
                                ) : null}
                            </span>
                            <PathTail path={c.path} />
                        </div>
                    ))
                )}
            </div>
            {row.needsKeep ? <KeepChoice row={row} /> : null}
            <div className="flex-1" />
            <div className="flex gap-2">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => fireAndForget(() => openSkillFile(model, skillFilePath(row, skillsroot, keep)))}
                    className={BTN_SECONDARY}
                >
                    Open SKILL.md
                </button>
            </div>
        </aside>
    );
}

function SkillsTab({ model }: { model: AgentsViewModel }) {
    const { data, groups } = useSkillGroups();
    const selectedName = useAtomValue(setupSkillSelectedAtom);
    const error = useAtomValue(setupErrorAtom);
    // re-read on every visit: an agent may have written a skill since
    useEffect(() => {
        fireAndForget(loadSkills);
    }, []);
    const rows = groups.flatMap((g) => g.rows);
    const selected = rows.find((r) => r.name === selectedName) ?? rows[0] ?? null;
    return (
        <div className="flex min-w-0 flex-1 flex-col">
            {error ? (
                <div
                    role="alert"
                    className="flex-none border-b border-error/30 bg-error/10 px-5 py-2 text-[12.5px] text-error-soft"
                >
                    {error}
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1">
                {data == null ? (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Reading…</div>
                ) : (
                    <>
                        <div className="flex min-w-0 flex-1 flex-col px-5 pb-4 pt-3.5">
                            <SkillsMatrix
                                columns={data.columns ?? []}
                                groups={groups}
                                selected={selected?.name ?? null}
                            />
                        </div>
                        {selected != null ? (
                            <SkillRail model={model} row={selected} skillsroot={data.skillsroot} />
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}

export function SetupSurface({ model }: { model: AgentsViewModel }) {
    const tab = useAtomValue(setupTabAtom);
    // re-read on every visit: a harness file edited outside arcterm must not show stale
    useEffect(() => {
        fireAndForget(loadSetup);
    }, []);
    return (
        <div className="flex h-full min-h-0 flex-col bg-background">
            <div className="flex h-[52px] flex-none items-center gap-5 border-b border-border px-5">
                <div className="text-[15px] font-semibold text-primary">Setup</div>
                <Tabs />
                <div className="flex-1" />
                {tab === "instructions" ? <HeaderStatus /> : <SkillsHeader />}
            </div>
            <div
                id="setup-tabpanel"
                role="tabpanel"
                aria-labelledby={`setup-tab-${tab}`}
                className="flex min-h-0 flex-1"
            >
                {tab === "instructions" ? <InstructionsTab /> : <SkillsTab model={model} />}
            </div>
        </div>
    );
}
