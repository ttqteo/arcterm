// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council Setup (board ReportSetup.dc.html, docs/superpowers/specs/2026-10-22-council-agent-team-design.md "UI"): one
// composer for the feature (its first line) and the question (the rest) with the files and screenshots as chips inside it,
// a bar with Attach, the group, the estimate and Start council, and Options for the panel rows with their models, Save as
// group and Pause after the first ideas. The form is the project's draft in councilSetupDraftAtom, so it survives
// switching away; councilsetupmodel.ts holds every rule (the composer's text is `joinAsk` of the draft, written back
// with `splitAsk`) and this file only draws them and calls the store.
//
// The coordinator's suggestion is one model call, asked once when the draft has a feature and a first file (or comes
// from Ask the council with a question), a moment after the last edit. It lives in askCoordinator below, outside the
// component, so leaving Setup while it runs still lets the answer land in the draft. A Run again draft arrives with its
// panel set and its group counted as picked: it is not asked (settleRerun), so opening a rerun spends nothing.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { createTempFileFromBlob } from "@/app/view/term/termutil";
import { cn } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { ChevronDown, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { showCouncil, showTerminal } from "./agentcenter";
import { councilProjectKey, estimateLabel, type CouncilSetupDraft } from "./councilmodel";
import {
    addFiles,
    addRole,
    addScreenshot,
    applyGroup,
    applySuggestion,
    askText,
    basename,
    beginSuggest,
    estimateKey,
    estimateRequest,
    expertInitial,
    expertsLine,
    expertTone,
    failSuggestion,
    groupFromDraft,
    groupName,
    initialPanel,
    MODEL_CHOICES,
    pendingRoles,
    readingLine,
    removeExpert,
    removeFile,
    removeScreenshot,
    retrySuggestion,
    setExpertModel,
    settleRerun,
    splitAsk,
    startBlocker,
    startData,
    suggestRequest,
    type ExpertTone,
    type RoleLibrary,
} from "./councilsetupmodel";
import {
    councilRoles,
    councilSetupDraftAtom,
    councilSetupProjectAtom,
    estimateCouncil,
    saveCouncilGroup,
    startCouncil,
    suggestCouncil,
} from "./councilstore";
import { imageFilesOf, imageRoom } from "./launcherimages";
import { projectsAtom } from "./projectsstore";
import { Toggle } from "./settingsui";
import { makeThumbnail } from "./uploadthumb";

// how long the draft sits unchanged before the coordinator is asked, so a feature typed letter by letter is asked once
const SUGGEST_DELAY_MS = 800;
const ESTIMATE_DELAY_MS = 250;

const NO_LIBRARY: RoleLibrary = { roles: [], groups: [] };

const LABEL = "text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted";
const INPUT =
    "h-8 w-full min-w-0 rounded-[6px] border border-edge-mid bg-surface px-[10px] text-[13px] text-primary outline-none placeholder:text-ink-faint focus:border-accent-700 focus-visible:ring-2 focus-visible:ring-accent";
const GHOST =
    "h-[26px] cursor-pointer rounded-[6px] border border-transparent bg-transparent px-[10px] text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40";
const SECONDARY =
    "flex h-[26px] cursor-pointer items-center gap-[6px] rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12px] text-primary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";
const ICON_BUTTON =
    "flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";

// the identity colors stay the same in every theme (the conn-* palette); spelled out so Tailwind sees the classes
const RING: Record<ExpertTone, string> = {
    "conn-1": "border-conn-1 text-conn-1",
    "conn-2": "border-conn-2 text-conn-2",
    "conn-3": "border-conn-3 text-conn-3",
    "conn-6": "border-conn-6 text-conn-6",
    "conn-7": "border-conn-7 text-conn-7",
    "conn-8": "border-conn-8 text-conn-8",
    coordinator: "border-primary text-primary",
};

// ---- the role library ----

const libraryAtom = atom<RoleLibrary | null>(null) as PrimitiveAtom<RoleLibrary | null>;

/** Reads the role library and the groups into libraryAtom; false when wavesrv would not answer. */
async function loadLibrary(): Promise<boolean> {
    const r = await councilRoles();
    if (!r.ok || r.value == null) {
        return false;
    }
    globalStore.set(libraryAtom, { roles: r.value.roles ?? [], groups: r.value.groups ?? [] });
    return true;
}

function useRoleLibrary(): { lib: RoleLibrary | null; failed: boolean; reload: () => void } {
    const lib = useAtomValue(libraryAtom);
    const [failed, setFailed] = useState(false);
    const reload = () => void loadLibrary().then((ok) => setFailed(!ok));
    // read on every open, so a hand edit of councilroles.json shows
    useEffect(reload, []);
    return { lib, failed: failed && lib == null, reload };
}

// ---- the draft ----

// The drafts Setup itself made. A draft that is not one of these came from outside, from showCouncilSetup (Run again,
// Ask the council, a New council row): the first time Setup sees one it can tell a rerun from a fresh form.
const madeHere = new WeakSet<CouncilSetupDraft>();

/** Changes a project's draft and records the result as Setup's own. Nothing happens to a draft that is gone. */
function editDraft(project: string, change: (d: CouncilSetupDraft) => CouncilSetupDraft): void {
    globalStore.set(councilSetupDraftAtom(project), (prev) => {
        if (prev == null) {
            return prev;
        }
        const next = change(prev);
        madeHere.add(next);
        return next;
    });
}

// ---- the coordinator's suggestion ----

// one ask at a time per project: a late answer to an earlier ask must not land on a draft that has moved on
const askSeq = new Map<string, number>();

/** Asks the coordinator for files and roles when the project's draft is due for it, and puts the answer in the draft. */
async function askCoordinator(project: string): Promise<void> {
    const before = globalStore.get(councilSetupDraftAtom(project));
    const request = before != null ? suggestRequest(before) : null;
    if (before == null || request == null) {
        return;
    }
    const key = councilProjectKey(project);
    const seq = (askSeq.get(key) ?? 0) + 1;
    askSeq.set(key, seq);
    editDraft(project, beginSuggest);
    const r = await suggestCouncil(request);
    if (askSeq.get(key) !== seq) {
        return;
    }
    editDraft(project, (prev) =>
        r.ok && r.value != null
            ? applySuggestion(prev, r.value, globalStore.get(libraryAtom) ?? NO_LIBRARY)
            : failSuggestion(prev)
    );
}

/** Drops the answer to an ask that is still out (Cancel, Start). */
function forgetAsk(project: string): void {
    const key = councilProjectKey(project);
    askSeq.set(key, (askSeq.get(key) ?? 0) + 1);
}

// ---- files and screenshots ----

// a pasted image's thumbnail, for this session only: a screenshot the draft was given as a path has none and shows an icon
const thumbs = new Map<string, string>();

let picking = false; // the native dialog takes a moment to appear; a second click must not open another

async function pickPaths(kind: "file" | "folder" | "image", project: string): Promise<string[]> {
    if (picking) {
        return [];
    }
    picking = true;
    try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({
            multiple: kind !== "folder",
            directory: kind === "folder",
            defaultPath: project,
            title: kind === "folder" ? "Add a folder" : kind === "image" ? "Add a screenshot" : "Add files",
            filters:
                kind === "image" ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] : undefined,
        });
        return Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    } catch (err) {
        console.error("council setup: file picker failed", err);
        pushToast({ title: "Couldn't open the file picker", message: String(err), level: "error" });
        return [];
    } finally {
        picking = false;
    }
}

/** Saves pasted images as kept files (the council reads them days later, so not the temp dir a sweep empties) and adds
 *  them to the project's draft. Answers the first failure's message, or null. */
async function savePastedImages(project: string, files: File[]): Promise<string | null> {
    let failure: string | null = null;
    for (const file of files) {
        try {
            const path = await createTempFileFromBlob(file, true);
            const thumb = await makeThumbnail(file);
            if (thumb != null) {
                thumbs.set(path, thumb);
            }
            editDraft(project, (d) => addScreenshot(d, path));
        } catch (err) {
            failure ??= String((err as Error)?.message ?? err);
        }
    }
    return failure;
}

// ---- small parts ----

interface MenuItem {
    id: string;
    label: string;
    checked?: boolean; // a pick-one list (the check marks the current), else the item is an action
}

// A button that opens a short menu under it: a pick-one list (a group, a model) or the actions of Add a file or folder.
// Arrow keys move through the items, Escape closes and gives the focus back, a click outside closes.
function MenuButton({
    items,
    onPick,
    ariaLabel,
    className,
    align = "left",
    itemAttr,
    children,
    ...data
}: {
    items: MenuItem[];
    onPick: (id: string) => void;
    ariaLabel: string;
    className: string;
    align?: "left" | "right";
    itemAttr: `data-${string}`;
    children: ReactNode;
} & { [K in `data-${string}`]?: string | boolean }) {
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);
    useEffect(() => {
        if (open) {
            const all = wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
            (wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? all?.[0])?.focus();
        }
    }, [open]);
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!open) {
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const els = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
            if (els.length > 0) {
                const at = els.indexOf(document.activeElement as HTMLElement);
                const step = e.key === "ArrowDown" ? 1 : -1;
                els[(at + step + els.length) % els.length].focus();
            }
        }
    };
    return (
        <div ref={wrap} onKeyDown={onKeyDown} className="relative flex-none">
            <button
                ref={trigger}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={ariaLabel}
                onClick={() => setOpen((o) => !o)}
                className={className}
                {...data}
            >
                {children}
            </button>
            <PopoverReveal
                open={open}
                origin={align === "left" ? "top left" : "top right"}
                className={cn(
                    "absolute top-[calc(100%+6px)] z-30 min-w-[180px] rounded-[10px] border border-edge-mid bg-surface-raised p-[4px] shadow-popover-md",
                    align === "left" ? "left-0" : "right-0"
                )}
            >
                <div role="menu" aria-label={ariaLabel}>
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                            aria-checked={item.checked}
                            {...{ [itemAttr]: item.id }}
                            onClick={() => {
                                setOpen(false);
                                trigger.current?.focus();
                                onPick(item.id);
                            }}
                            className="flex h-[28px] w-full cursor-pointer items-center gap-[8px] rounded-[6px] border-0 bg-transparent px-[8px] text-left text-[12px] text-primary outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <span className="w-[12px] flex-none text-center text-[11px]" aria-hidden>
                                {item.checked ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </button>
                    ))}
                </div>
            </PopoverReveal>
        </div>
    );
}

function Avatar({ expert, tone, dashed }: { expert: CouncilExpert; tone: ExpertTone; dashed?: boolean }) {
    return (
        <span
            aria-hidden
            className={cn(
                "flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 text-[10px] font-bold",
                dashed ? "border-dashed border-muted text-muted" : RING[tone]
            )}
        >
            {expertInitial(expert)}
        </span>
    );
}

function SaveGroupForm({
    draft,
    lib,
    onSaved,
}: {
    draft: CouncilSetupDraft;
    lib: RoleLibrary;
    onSaved: (groupId: string, note: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [problem, setProblem] = useState("");
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (open) {
            input.current?.focus();
        }
    }, [open]);
    const save = async () => {
        const saved = groupFromDraft(draft, lib, name);
        if (saved == null) {
            setProblem(name.trim() === "" ? "Name the group" : "Keep a role from the library to save");
            return;
        }
        const r = await saveCouncilGroup(saved.group);
        // === false: the tsconfig is not strict, where !r.ok does not narrow a CouncilCall to its failure
        if (r.ok === false) {
            setProblem(r.error);
            return;
        }
        await loadLibrary();
        setOpen(false);
        setName("");
        setProblem("");
        onSaved(
            saved.group.id,
            saved.left.length > 0
                ? `Saved as ${saved.group.name}. ${saved.left.join(", ")} stays out: a group keeps library roles only.`
                : `Saved as ${saved.group.name}.`
        );
    };
    if (!open) {
        return (
            <button type="button" data-council-save-group onClick={() => setOpen(true)} className={GHOST}>
                Save as group
            </button>
        );
    }
    return (
        <div className="flex items-center gap-[6px]">
            <input
                ref={input}
                data-council-group-name
                aria-label="Group name"
                value={name}
                placeholder="Name this group"
                onChange={(e) => {
                    setName(e.target.value);
                    setProblem("");
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void save();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpen(false);
                    }
                }}
                className={cn(INPUT, "h-[26px] w-[160px] text-[12px]")}
            />
            <button type="button" data-council-save-group-confirm onClick={() => void save()} className={SECONDARY}>
                Save
            </button>
            <button
                type="button"
                aria-label="Cancel saving the group"
                onClick={() => setOpen(false)}
                className={ICON_BUTTON}
            >
                <X size={13} strokeWidth={1.8} aria-hidden />
            </button>
            {problem !== "" ? (
                <span data-council-group-problem className="text-[11.5px] text-error">
                    {problem}
                </span>
            ) : null}
        </div>
    );
}

// ---- the estimate ----

function useEstimate(draft: CouncilSetupDraft | null): { est: CouncilEstimateRtnData | null; failed: boolean } {
    const [state, setState] = useState<{ est: CouncilEstimateRtnData | null; failed: boolean }>({
        est: null,
        failed: false,
    });
    const latest = useRef(draft);
    latest.current = draft;
    const key = draft != null ? estimateKey(draft) : "";
    const hasPanel = draft != null && draft.experts.some((e) => !e.coordinator);
    useEffect(() => {
        if (!hasPanel) {
            setState({ est: null, failed: false });
            return;
        }
        let live = true;
        const timer = setTimeout(async () => {
            const current = latest.current;
            if (current == null) {
                return;
            }
            const r = await estimateCouncil(estimateRequest(current));
            if (live) {
                setState(r.ok && r.value != null ? { est: r.value, failed: false } : { est: null, failed: true });
            }
        }, ESTIMATE_DELAY_MS);
        return () => {
            live = false;
            clearTimeout(timer);
        };
    }, [key, hasPanel]);
    return state;
}

// ---- the view ----

export function CouncilSetup() {
    const project = useAtomValue(councilSetupProjectAtom);
    if (project == null) {
        return (
            <div
                data-council-setup
                className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-[13px] text-muted"
            >
                Pick New council in a project to set one up.
            </div>
        );
    }
    return <SetupForm key={councilProjectKey(project)} project={project} />;
}

// a file or screenshot chip inside the composer
const CHIP =
    "inline-flex h-[24px] max-w-full items-center gap-[6px] rounded-[6px] border border-edge-mid bg-surface-raised pl-[8px] pr-[4px] text-[12px] text-secondary";
const CHIP_REMOVE =
    "flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent text-muted outline-none hover:bg-surface-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-accent";

function SetupForm({ project }: { project: string }) {
    const draftAtom = councilSetupDraftAtom(project);
    const draft = useAtomValue(draftAtom);
    const projects = useAtomValue(projectsAtom);
    const { lib, failed: libFailed, reload } = useRoleLibrary();
    const root = useRef<HTMLDivElement>(null);
    const askInput = useRef<HTMLTextAreaElement>(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState("");
    const [pasteError, setPasteError] = useState("");
    const [groupNote, setGroupNote] = useState("");
    const [optionsOpen, setOptionsOpen] = useState(false);
    // what the person last typed in the composer, kept while the draft still reads from it (askText)
    const [typed, setTyped] = useState<string | null>(null);
    const { est, failed: estimateFailed } = useEstimate(draft);

    const update = (fn: (d: CouncilSetupDraft) => CouncilSetupDraft) => editDraft(project, fn);

    // a draft that came from outside is looked at once: a rerun (Run again) must not ask the coordinator on opening
    useEffect(() => {
        if (draft != null && !madeHere.has(draft)) {
            update(settleRerun);
        }
    }, [draft]);

    // a draft with no panel starts on the library's first group
    const needsPanel = draft != null && draft.experts.length === 0;
    useEffect(() => {
        if (lib != null && needsPanel) {
            update((d) => initialPanel(d, lib));
        }
    }, [lib, needsPanel]);

    // an error is about the last Start council: the next edit clears it. A draft made again from a prefill (Ask the
    // council, a reopened Setup) is a new form, so the notes of the old one go.
    useEffect(() => setStartError(""), [draft]);
    useEffect(() => {
        if (needsPanel) {
            setPasteError("");
            setGroupNote("");
        }
    }, [needsPanel]);

    // the person lands on the composer, once, when Setup opens
    useEffect(() => {
        if (draft != null && draft.feature === "") {
            askInput.current?.focus();
        }
    }, []);

    // ask the coordinator once the draft is due for it and has sat unchanged for a moment
    const suggestKey = useMemo(() => JSON.stringify(draft != null ? suggestRequest(draft) : null), [draft]);
    useEffect(() => {
        if (suggestKey === "null") {
            return;
        }
        const timer = setTimeout(() => void askCoordinator(project), SUGGEST_DELAY_MS);
        return () => clearTimeout(timer);
    }, [project, suggestKey]);

    // a pasted image is a screenshot, wherever the focus is in Setup (or nowhere); not while another surface shows
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const el = root.current;
            const target = e.target as Node | null;
            if (
                el == null ||
                !el.checkVisibility() ||
                !(target === document.body || (target != null && el.contains(target)))
            ) {
                return;
            }
            const files = imageFilesOf(e.clipboardData?.files);
            if (files.length === 0) {
                return;
            }
            e.preventDefault();
            const room = imageRoom(globalStore.get(draftAtom)?.screenshots.length ?? 0, files.length);
            void savePastedImages(project, files.slice(0, room)).then((err) => setPasteError(err ?? ""));
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [project, draftAtom]);

    if (draft == null) {
        return (
            <div
                data-council-setup
                className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-[13px] text-muted"
            >
                This draft is gone. Pick New council to start another.
            </div>
        );
    }

    const projectLabel =
        Object.entries(projects).find(
            ([, p]) => p?.path != null && councilProjectKey(p.path) === councilProjectKey(project)
        )?.[0] ?? basename(project);
    const blocker = startBlocker(draft);
    const reading = readingLine(draft);
    const pending = pendingRoles(draft);
    const libraryOrEmpty = lib ?? NO_LIBRARY;
    const who = expertsLine(draft, libraryOrEmpty);

    const cancel = () => {
        forgetAsk(project);
        globalStore.set(draftAtom, null);
        showTerminal();
    };

    const start = async () => {
        if (blocker !== "" || starting) {
            return;
        }
        setStarting(true);
        setStartError("");
        const r = await startCouncil(startData(draft));
        if (r.ok === false) {
            setStarting(false);
            setStartError(r.error);
            return;
        }
        const id = r.value?.id;
        if (!id) {
            setStarting(false);
            setStartError("wavesrv started no council. Try again.");
            return;
        }
        forgetAsk(project);
        // the view first: Setup is gone before its draft is, so nothing draws a missing draft
        showCouncil(id);
        globalStore.set(draftAtom, null);
    };

    const addPicked = async (kind: "file" | "folder") => {
        const paths = await pickPaths(kind, project);
        if (paths.length > 0) {
            update((d) => addFiles(d, paths));
        }
    };

    const pickImage = async () => {
        const paths = await pickPaths("image", project);
        if (paths.length > 0) {
            update((d) => paths.reduce(addScreenshot, d));
        }
    };

    const estimateText = est != null ? estimateLabel(est) : estimateFailed ? "Estimate unavailable" : "Estimating…";
    const hasChips = draft.files.length > 0 || draft.screenshots.length > 0;

    return (
        <div
            ref={root}
            data-council-setup
            data-owns-keys
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-primary"
        >
            <div className="flex flex-none items-center gap-[10px] border-b border-edge-faint px-8 pb-[14px] pt-[18px]">
                <h1 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">New council</h1>
                <span className="min-w-0 truncate text-[12px] text-muted">{projectLabel}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
                <div className="flex max-w-[780px] flex-col gap-[14px]">
                    <p className="m-0 text-[13px] leading-[1.5] text-secondary">
                        A few AI experts read your project, argue over each other's ideas, and give you a ranked answer.
                        They never edit anything.
                    </p>

                    <div
                        data-council-composer
                        className="flex flex-col rounded-[10px] border border-edge-mid bg-surface focus-within:border-accent-700"
                    >
                        <textarea
                            ref={askInput}
                            data-council-input="ask"
                            aria-label="What should the council review?"
                            rows={4}
                            value={askText(draft, typed)}
                            placeholder="What should the council review? The first line names it; ask a question under it."
                            onChange={(e) => {
                                const text = e.target.value;
                                setTyped(text);
                                update((d) => ({ ...d, ...splitAsk(text) }));
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    void start();
                                }
                            }}
                            className="min-h-[96px] w-full min-w-0 resize-none rounded-t-[10px] border-0 bg-transparent px-3 pb-1 pt-[10px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-ink-faint"
                        />
                        {hasChips ? (
                            <div data-council-files className="flex flex-wrap gap-[6px] px-3 pb-2">
                                {draft.files.map((f) => (
                                    <span key={f} data-council-file={f} data-council-file-chip className={CHIP}>
                                        <span className="min-w-0 truncate" title={f}>
                                            {f}
                                        </span>
                                        <button
                                            type="button"
                                            data-council-file-remove={f}
                                            aria-label={`Remove ${f}`}
                                            onClick={() => update((d) => removeFile(d, f))}
                                            className={CHIP_REMOVE}
                                        >
                                            <X size={12} strokeWidth={1.8} aria-hidden />
                                        </button>
                                    </span>
                                ))}
                                {draft.screenshots.map((path) => {
                                    const name = basename(path);
                                    const thumb = thumbs.get(path);
                                    return (
                                        <span
                                            key={path}
                                            data-council-screenshot={path}
                                            data-council-file-chip
                                            className={cn(CHIP, "pl-[4px]")}
                                        >
                                            {thumb != null ? (
                                                <img
                                                    src={thumb}
                                                    alt={`Screenshot ${name}`}
                                                    className="h-[16px] w-[16px] flex-none rounded-[3px] object-cover"
                                                />
                                            ) : (
                                                <ImageIcon
                                                    size={14}
                                                    strokeWidth={1.5}
                                                    className="ml-[2px]"
                                                    aria-hidden
                                                />
                                            )}
                                            <span className="min-w-0 truncate" title={path}>
                                                {name}
                                            </span>
                                            <button
                                                type="button"
                                                data-council-screenshot-remove={path}
                                                aria-label={`Remove ${name}`}
                                                onClick={() => update((d) => removeScreenshot(d, path))}
                                                className={CHIP_REMOVE}
                                            >
                                                <X size={12} strokeWidth={1.8} aria-hidden />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        ) : null}
                        <div
                            data-council-composer-bar
                            className="flex items-center gap-2 rounded-b-[10px] border-t border-edge-faint px-2 py-[6px]"
                        >
                            <MenuButton
                                ariaLabel="Add a file, folder or screenshot"
                                itemAttr="data-council-add-item"
                                data-council-attach
                                data-council-add
                                items={[
                                    { id: "file", label: "File…" },
                                    { id: "folder", label: "Folder…" },
                                    { id: "image", label: "Screenshot…" },
                                ]}
                                onPick={(id) =>
                                    id === "image"
                                        ? void pickImage()
                                        : void addPicked(id === "folder" ? "folder" : "file")
                                }
                                className="flex h-[26px] cursor-pointer items-center gap-[5px] rounded-[6px] border border-transparent bg-transparent px-[8px] text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <Paperclip size={13} strokeWidth={1.8} aria-hidden />
                                Attach
                            </MenuButton>
                            <MenuButton
                                ariaLabel="Group of experts"
                                itemAttr="data-council-group-item"
                                data-council-group
                                items={libraryOrEmpty.groups.map((g) => ({
                                    id: g.id,
                                    label: g.name,
                                    checked: g.id === draft.group,
                                }))}
                                onPick={(id) => {
                                    setGroupNote("");
                                    update((d) => applyGroup(d, libraryOrEmpty, id, true));
                                }}
                                className={SECONDARY}
                            >
                                {draft.experts.length === 0 ? "Pick a group" : groupName(libraryOrEmpty, draft.group)}
                                <ChevronDown size={12} strokeWidth={2} className="text-muted" aria-hidden />
                            </MenuButton>
                            <div className="flex-1" />
                            <span data-council-estimate className="flex-none text-[12px] tabular-nums text-secondary">
                                {estimateText}
                            </span>
                            <button
                                type="button"
                                data-council-cancel
                                onClick={cancel}
                                className="h-[30px] cursor-pointer rounded-[6px] border border-transparent bg-transparent px-3 text-[12.5px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                data-council-start
                                disabled={blocker !== "" || starting}
                                title={blocker !== "" ? blocker : "Start the council. The estimate is what it will use"}
                                onClick={() => void start()}
                                className="h-[30px] cursor-pointer rounded-[6px] border-0 bg-accent px-[14px] text-[12.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-default disabled:opacity-40 disabled:hover:bg-accent"
                            >
                                {starting ? "Starting…" : "Start council"}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-[6px]">
                        <span
                            data-council-footnote={blocker !== "" ? "blocked" : "reading"}
                            className="min-w-0 text-[11.5px] text-muted"
                        >
                            {blocker !== "" ? blocker : reading}
                        </span>
                        {startError !== "" ? (
                            <span data-council-error role="alert" className="min-w-0 text-[11.5px] text-error">
                                {startError}
                            </span>
                        ) : null}
                        {pasteError !== "" ? (
                            <span data-council-paste-error className="text-[11.5px] text-error">
                                {pasteError}
                            </span>
                        ) : null}
                        {draft.experts.length === 0 ? (
                            <div className="flex items-center gap-2 text-[12px] text-muted">
                                {libFailed ? (
                                    <>
                                        <span>Couldn't load the experts.</span>
                                        <button type="button" onClick={reload} className={GHOST}>
                                            Try again
                                        </button>
                                    </>
                                ) : lib == null ? (
                                    <span>Loading experts…</span>
                                ) : (
                                    <span>Pick a group to choose the experts.</span>
                                )}
                            </div>
                        ) : (
                            <span data-council-experts-line className="text-[12.5px] leading-[1.5] text-secondary">
                                {who}
                            </span>
                        )}
                        {groupNote !== "" ? (
                            <span data-council-group-note role="status" className="text-[11.5px] text-muted">
                                {groupNote}
                            </span>
                        ) : null}
                        {draft.suggestState === "asking" ? (
                            <span data-council-suggesting role="status" className="text-[11.5px] text-muted">
                                Suggesting…
                            </span>
                        ) : null}
                        {draft.suggestState === "failed" ? (
                            <div
                                data-council-suggest-failed
                                role="status"
                                className="flex items-center gap-2 text-[11.5px] text-muted"
                            >
                                <span>The coordinator's suggestion failed. The group's experts are unchanged.</span>
                                <button
                                    type="button"
                                    data-council-suggest-retry
                                    onClick={() => {
                                        update(retrySuggestion);
                                        void askCoordinator(project);
                                    }}
                                    className={GHOST}
                                >
                                    Try again
                                </button>
                            </div>
                        ) : null}
                        {pending.length > 0 ? (
                            <div data-council-suggestions className="flex flex-col gap-[6px]">
                                <span className="text-[11.5px] text-muted">
                                    The coordinator suggests, for this feature
                                </span>
                                {pending.map((r) => (
                                    <div
                                        key={r.id}
                                        data-council-suggested={r.id}
                                        className="flex items-center gap-[10px] rounded-[8px] border border-dashed border-edge-strong py-2 pl-3 pr-[10px]"
                                    >
                                        <Avatar expert={r} tone="conn-1" dashed />
                                        <div className="w-[110px] flex-none truncate text-[12.5px] font-semibold text-secondary">
                                            {r.name}
                                        </div>
                                        <div className="min-w-0 flex-1 truncate text-[12px] text-muted" title={r.why}>
                                            {r.why}
                                        </div>
                                        <button
                                            type="button"
                                            data-council-suggested-add={r.id}
                                            onClick={() => update((d) => addRole(d, r))}
                                            className={SECONDARY}
                                        >
                                            Add
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            data-council-options
                            aria-expanded={optionsOpen}
                            onClick={() => setOptionsOpen((o) => !o)}
                            className="flex h-[26px] w-fit cursor-pointer items-center gap-[5px] rounded-[6px] border-0 bg-transparent px-[6px] text-[12px] text-muted outline-none hover:bg-surface-hover hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <ChevronDown
                                size={12}
                                strokeWidth={2}
                                className={cn("transition-transform", !optionsOpen && "-rotate-90")}
                                aria-hidden
                            />
                            Options
                        </button>
                        {optionsOpen ? (
                            <div data-council-options-body className="flex flex-col gap-5">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className={LABEL}>What the experts read</span>
                                        <span className="text-[11px] text-muted">
                                            the coordinator adds more from your question; paste an image anywhere here
                                            to add a screenshot
                                        </span>
                                    </div>
                                    <span className="text-[12px] text-secondary">
                                        Files and screenshots sit in the box above; Attach adds more, × takes one away.
                                    </span>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className={LABEL}>Experts</span>
                                        <div className="flex-1" />
                                        {lib != null && draft.experts.length > 0 ? (
                                            <SaveGroupForm
                                                draft={draft}
                                                lib={lib}
                                                onSaved={(id, note) => {
                                                    setGroupNote(note);
                                                    update((d) => ({ ...d, group: id }));
                                                }}
                                            />
                                        ) : null}
                                    </div>
                                    <div
                                        data-council-experts
                                        className="flex flex-col rounded-[10px] border border-border bg-surface"
                                    >
                                        {draft.experts.length === 0 ? (
                                            <div className="px-3 py-[10px] text-[12px] text-muted">
                                                Pick a group to choose the experts.
                                            </div>
                                        ) : (
                                            draft.experts.map((e, i) => (
                                                <div
                                                    key={e.id}
                                                    data-council-expert={e.id}
                                                    data-council-coordinator={e.coordinator ? "" : undefined}
                                                    className={cn(
                                                        "flex items-center gap-[10px] py-[9px] pl-3 pr-[10px]",
                                                        i > 0 && "border-t border-border"
                                                    )}
                                                >
                                                    <Avatar expert={e} tone={expertTone(draft.experts, i)} />
                                                    <div className="w-[110px] flex-none truncate text-[12.5px] font-semibold">
                                                        {e.name}
                                                    </div>
                                                    <div
                                                        className="min-w-0 flex-1 truncate text-[12px] text-secondary"
                                                        title={e.brief}
                                                    >
                                                        {e.brief}
                                                    </div>
                                                    <MenuButton
                                                        ariaLabel={`Model for ${e.name}`}
                                                        itemAttr="data-council-model-item"
                                                        data-council-model={e.id}
                                                        align="right"
                                                        items={MODEL_CHOICES.map((m) => ({
                                                            id: m,
                                                            label: m,
                                                            checked: m === e.model,
                                                        }))}
                                                        onPick={(m) => update((d) => setExpertModel(d, e.id, m))}
                                                        className="flex h-6 cursor-pointer items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface-raised px-2 text-[11.5px] text-secondary outline-none hover:border-edge-strong focus-visible:ring-2 focus-visible:ring-accent"
                                                    >
                                                        {e.model}
                                                        <ChevronDown
                                                            size={10}
                                                            strokeWidth={2}
                                                            className="text-muted"
                                                            aria-hidden
                                                        />
                                                    </MenuButton>
                                                    {e.coordinator ? (
                                                        <span className="h-6 w-6 flex-none" aria-hidden />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            data-council-expert-remove={e.id}
                                                            aria-label={`Remove ${e.name}`}
                                                            onClick={() => update((d) => removeExpert(d, e.id))}
                                                            className={ICON_BUTTON}
                                                        >
                                                            <X size={14} strokeWidth={1.8} aria-hidden />
                                                        </button>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-[10px]">
                                    <Toggle
                                        on={draft.pause}
                                        onToggle={() => update((d) => ({ ...d, pause: !d.pause }))}
                                        label="Pause after the first ideas"
                                        data-council-pause
                                    />
                                    <span
                                        onClick={() => update((d) => ({ ...d, pause: !d.pause }))}
                                        className="flex min-w-0 cursor-pointer items-baseline gap-[10px]"
                                    >
                                        <span className="flex-none text-[12.5px]">Pause after the first ideas</span>
                                        <span className="min-w-0 text-[11.5px] text-muted">
                                            so you can cut ideas or ask the experts something before they argue
                                        </span>
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
