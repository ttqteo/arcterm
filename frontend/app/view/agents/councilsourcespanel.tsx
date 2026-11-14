// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A council message's evidence as compact chips, one per cited file with its lines after it, two at most and the rest
// folded into `+N files`, and the Sources panel a click opens on the right of the chat, in place of the thread panel
// (A-links-panel.dc.html in the council-evidence-chips canvas; the rules are in councilsources.ts). The panel lists the message's files, reads the picked one from the council's
// project and shows the cited lines lit, a line of context each side; Open in Code opens it at the first cited line.
// Escape or the close button goes back to the thread the panel was opened from. A list with no council to open (Ideas so
// far) draws the same names, not as links. Each part carries a data-council-* attribute for the CDP scenario.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useBlobSrc } from "@/app/view/jarvis/localimage";
import { base64ToString, cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { FileText, Image as ImageIcon, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
    CHECK_TONE,
    CheckIcon,
    ClaimBadgeChip,
    WRONG_CITE_ICON,
    WRONG_CITE_TONE,
    WrongCiteChip,
} from "./councilchecks";
import type { CouncilLang } from "./councilmodel";
import { parseShotRef, shotName } from "./councilshots";
import {
    claimChips,
    claimSignals,
    filesSignal,
    foldSources,
    groupSources,
    hunkLabel,
    pastEndWords,
    regionBoxStyle,
    sourceDir,
    sourceExcerpt,
    sourceFilePath,
    type ClaimSignal,
    type RegionCrop,
    type SourceGroup,
} from "./councilsources";
import { councilSourcesAtom, openCouncilSources, type CouncilSourcesView } from "./councilstore";
import { streamFileUrl } from "./pdfframe";

const NO_SOURCES = atom<CouncilSourcesView | null>(null);

// a cited file as a small chip (the editor-tab look): its icon, its name cut short in a 260px chip, its lines after it
const CHIP =
    "inline-flex h-[24px] min-w-0 max-w-[260px] select-none items-center gap-[5px] rounded-[6px] border border-edge-mid bg-surface px-[7px] text-[12.5px]";

// a chip's file name keeps its width (up to a cap, then it cuts itself) and the cited lines after it are what gives way:
// a long list (`:41, 110, 423, 449, …`) ends in an ellipsis, and the title holds all of it
const NAME = "max-w-[190px] flex-none truncate";
const LINES = "min-w-0 truncate tabular-nums text-muted";

// the panel reads a cited file whole; past this it says so instead
const MAX_READ = 2 * 1024 * 1024;

const secondaryButton =
    "h-[26px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[13px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent";
const ghostButton =
    "h-[26px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[10px] text-[13px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent";

/** The message a row of evidence links belongs to, so a click opens the Sources panel on it. */
export interface SourceOwner {
    councilId: string;
    owner: string; // the idea, reply or draft id
    title: string; // what the panel's header names it by
}

/** A claim's evidence row: its check badge first (Ran, Disproved, Read code, Guess, with icon and word), then the references
 *  it cites, one link per file, a cite Go found wrong as its own Wrong cite chip with Go's note, and a claim marked weak as
 *  an amber chip. `evidence` is the items Go checked and `label` the label it gave the claim (claimChips). */
export function EvidenceChips({
    evidence,
    label = "",
    lang = "en",
    source,
}: {
    evidence?: CouncilEvidence[];
    label?: string;
    lang?: CouncilLang;
    source?: SourceOwner;
}) {
    const chips = useMemo(() => claimChips(evidence, label, lang), [evidence, label, lang]);
    const view = useMemo(() => groupSources(chips.refs), [chips.refs]);
    const shown = useAtomValue(source != null ? councilSourcesAtom(source.councilId) : NO_SOURCES);
    const weak = chips.weak;
    const crops = chips.crops;
    const row =
        view.groups.length > 0 ||
        view.others.length > 0 ||
        weak !== "" ||
        chips.wrong.length > 0 ||
        chips.badge != null;
    if (!row && crops.length === 0) {
        return null;
    }
    const mine = source != null && shown != null && shown.owner === source.owner;
    const picked = mine && shown.region == null ? shown.pick : -1;
    const fold = foldSources(view.groups);
    const open = (pick: number) =>
        source != null &&
        openCouncilSources(source.councilId, { owner: source.owner, title: source.title, refs: chips.refs, pick });
    const openRegion = (region: RegionCrop) =>
        source != null &&
        openCouncilSources(source.councilId, {
            owner: source.owner,
            title: source.title,
            refs: chips.refs,
            pick: 0,
            region,
        });
    const chipRow = (
        <div className="flex flex-wrap items-center gap-[6px]">
            {chips.badge != null && <ClaimBadgeChip badge={chips.badge} />}
            {fold.shown.map((g, i) =>
                source == null ? (
                    <SourceName key={g.path} group={g} />
                ) : (
                    <SourceLink key={g.path} group={g} picked={i === picked} onOpen={() => open(i)} />
                )
            )}
            {fold.more !== "" &&
                (source == null ? (
                    <span
                        data-council-evidence="more"
                        title={view.groups
                            .slice(fold.shown.length)
                            .map((g) => g.path + g.label)
                            .join("\n")}
                        className={cn(CHIP, "text-muted")}
                    >
                        {fold.more}
                    </span>
                ) : (
                    <button
                        type="button"
                        data-council-evidence="more"
                        data-picked={picked >= fold.shown.length ? "true" : undefined}
                        title={view.groups
                            .slice(fold.shown.length)
                            .map((g) => g.path + g.label)
                            .join("\n")}
                        onClick={() => open(fold.shown.length)}
                        className={cn(
                            CHIP,
                            "cursor-pointer text-muted outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent",
                            picked >= fold.shown.length
                                ? "border-edge-strong bg-surface-selected"
                                : "hover:bg-surface-hover"
                        )}
                    >
                        {fold.more}
                    </button>
                ))}
            {view.others.map((ref, i) => {
                // a screenshot ref or another non-file citation: one line, cut short like a file chip, whole on hover
                const shot = parseShotRef(ref) != null;
                const Icon = shot ? ImageIcon : FileText;
                return (
                    <span
                        key={`other-${i}`}
                        data-council-evidence="other"
                        title={ref}
                        className={cn(CHIP, "text-secondary")}
                    >
                        <Icon size={12} className="flex-none text-muted" aria-hidden />
                        <span className="min-w-0 truncate">{shot ? shotName(ref) : ref}</span>
                    </span>
                );
            })}
            {chips.wrong.map((cite, i) => (
                <WrongCiteChip key={`wrong-${i}`} cite={cite} />
            ))}
            {weak !== "" && (
                <span
                    data-council-evidence="weak"
                    data-weak="true"
                    className={cn(
                        CHIP,
                        // a weak claim is a sentence, not a file name: it wraps inside the chip instead of
                        // spilling out of CHIP's fixed 24px height onto the row below
                        "h-auto min-h-[24px] max-w-[520px] select-text py-[3px] leading-[1.4] border-warning/40 text-warning-soft"
                    )}
                >
                    {weak}
                </span>
            )}
        </div>
    );
    if (crops.length === 0) {
        return chipRow;
    }
    // each region Go drew shows under the words, before the chips, so the person sees which button without a click
    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <div data-council-crops className="flex flex-wrap gap-[8px]">
                {crops.map((crop) => (
                    <RegionCropImage
                        key={crop.region.crop}
                        crop={crop}
                        picked={mine && shown.region?.region.crop === crop.region.crop}
                        onOpen={source != null ? () => openRegion(crop) : undefined}
                    />
                ))}
            </div>
            {row && chipRow}
        </div>
    );
}

type EvidenceProps = { evidence?: CouncilEvidence[]; label?: string; lang?: CouncilLang; source?: SourceOwner };

/** The regions Go drew for a claim, as an idea shows them under its words; its signal line carries the rest of its
 *  evidence (ClaimSignalWords, EvidenceFiles). Nothing when Go drew none. */
export function EvidenceCrops({ evidence, label = "", lang = "en", source }: EvidenceProps) {
    const chips = useMemo(() => claimChips(evidence, label, lang), [evidence, label, lang]);
    const shown = useAtomValue(source != null ? councilSourcesAtom(source.councilId) : NO_SOURCES);
    if (chips.crops.length === 0) {
        return null;
    }
    const mine = source != null && shown != null && shown.owner === source.owner;
    return (
        <div data-council-crops className="flex flex-wrap gap-[8px]">
            {chips.crops.map((crop) => (
                <RegionCropImage
                    key={crop.region.crop}
                    crop={crop}
                    picked={mine && shown.region?.region.crop === crop.region.crop}
                    onOpen={
                        source == null
                            ? undefined
                            : () =>
                                  openCouncilSources(source.councilId, {
                                      owner: source.owner,
                                      title: source.title,
                                      refs: chips.refs,
                                      pick: 0,
                                      region: crop,
                                  })
                    }
                />
            ))}
        </div>
    );
}

const SIGNAL_TONE: Record<ClaimSignal["kind"], string> = {
    badge: "",
    wrong: WRONG_CITE_TONE.text,
    weak: "text-warning-soft",
};

/** The words on an idea's signal line that say its claim needs a second look (claimSignals): a label that warns, the
 *  wrong cites, the weak claims, each an icon and a word with the details in its hover. */
export function ClaimSignalWords({ evidence, label = "", lang = "en" }: Omit<EvidenceProps, "source">) {
    const signals = useMemo(() => claimSignals(claimChips(evidence, label, lang), lang), [evidence, label, lang]);
    return (
        <>
            {signals.map((s) => {
                const Icon = s.kind === "wrong" ? WRONG_CITE_ICON : TriangleAlert;
                return (
                    <span
                        key={s.kind}
                        tabIndex={0}
                        data-council-evidence={s.kind}
                        data-check={s.check === "" ? undefined : s.check}
                        title={s.title}
                        aria-label={s.title === "" ? s.word : `${s.word}: ${s.title}`}
                        className={cn(
                            "inline-flex min-w-0 items-center gap-[4px] rounded-[4px] text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            s.check === "" ? SIGNAL_TONE[s.kind] : CHECK_TONE[s.check].text
                        )}
                    >
                        {s.check === "" ? (
                            <Icon size={12} strokeWidth={2} aria-hidden className="flex-none" />
                        ) : (
                            <CheckIcon label={s.check} />
                        )}
                        {s.word}
                    </span>
                );
            })}
        </>
    );
}

// how long the pointer rests on the files icon before its list opens, and how long the list outlasts the pointer leaving,
// so a pointer passing over the line opens nothing and one crossing the gap to the list does not close it
const FILES_OPEN_MS = 200;
const FILES_CLOSE_MS = 180;
// the room the list wants under the icon; with less before the window's foot it opens above
const FILES_LIST_ROOM = 240;

/** The files icon at the end of an idea's signal line: a page and how many sources the claim cites. Resting on it (or
 *  focusing it) opens their list, a link per file that opens the Sources panel; a click keeps the list open until a
 *  click outside or Escape. The list stays mounted, hidden while closed, so the links are in the page as the chips
 *  were. Nothing when the claim cites no source. */
export function EvidenceFiles({ evidence, label = "", lang = "en", source }: EvidenceProps) {
    const chips = useMemo(() => claimChips(evidence, label, lang), [evidence, label, lang]);
    const view = useMemo(() => groupSources(chips.refs), [chips.refs]);
    const shown = useAtomValue(source != null ? councilSourcesAtom(source.councilId) : NO_SOURCES);
    const [open, setOpen] = useState<"" | "peek" | "kept">("");
    const [up, setUp] = useState(false);
    const wrap = useRef<HTMLSpanElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const timer = useRef<number | undefined>(undefined);
    // set while a pick hands the focus back to the icon, so that focus does not open the list again
    const quiet = useRef(false);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    useEffect(() => {
        if (open !== "kept") {
            return;
        }
        const onDown = (e: MouseEvent) => {
            if (!wrap.current?.contains(e.target as Node)) {
                setOpen("");
            }
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);
    const files = filesSignal(view, chips.badge, lang);
    if (files == null) {
        return null;
    }
    const later = (run: () => void, ms: number) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(run, ms);
    };
    const place = () => {
        const r = trigger.current?.getBoundingClientRect();
        setUp(r != null && r.bottom + FILES_LIST_ROOM > window.innerHeight);
    };
    const peek = () =>
        later(() => {
            place();
            setOpen((o) => (o === "" ? "peek" : o));
        }, FILES_OPEN_MS);
    const unpeek = () => later(() => setOpen((o) => (o === "peek" ? "" : o)), FILES_CLOSE_MS);
    const onKeyDown = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
        if (e.key === "Escape" && open !== "") {
            e.preventDefault();
            e.stopPropagation();
            setOpen("");
            trigger.current?.focus();
        }
    };
    const mine = source != null && shown != null && shown.owner === source.owner;
    const picked = mine && shown.region == null ? shown.pick : -1;
    // a picked row hides with the list, so the focus goes back to the icon (as it stayed on a chip), where Escape still
    // reaches the Sources panel the pick opened
    const pick = (i: number) => {
        setOpen("");
        quiet.current = true;
        trigger.current?.focus();
        quiet.current = false;
        if (source != null) {
            openCouncilSources(source.councilId, {
                owner: source.owner,
                title: source.title,
                refs: chips.refs,
                pick: i,
            });
        }
    };
    const isOpen = open !== "";
    return (
        <span
            ref={wrap}
            data-council-files={source?.owner}
            onMouseEnter={peek}
            onMouseLeave={unpeek}
            onKeyDown={onKeyDown}
            onBlur={(e) => {
                if (!wrap.current?.contains(e.relatedTarget as Node | null)) {
                    setOpen((o) => (o === "peek" ? "" : o));
                }
            }}
            className="relative inline-flex"
        >
            <button
                ref={trigger}
                type="button"
                data-council-files-open
                aria-label={files.label}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                onFocus={() => {
                    if (quiet.current) {
                        return;
                    }
                    place();
                    setOpen((o) => (o === "" ? "peek" : o));
                }}
                onClick={() => {
                    place();
                    setOpen((o) => (o === "kept" ? "" : "kept"));
                }}
                className={cn(
                    "inline-flex h-[24px] cursor-pointer items-center gap-[4px] rounded-[6px] border-0 px-[6px] text-[12px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isOpen
                        ? "bg-surface-selected text-primary"
                        : "bg-transparent text-muted hover:bg-surface-hover hover:text-secondary"
                )}
            >
                <FileText size={13} strokeWidth={2} aria-hidden />
                {files.count}
            </button>
            <div
                role="dialog"
                aria-label={files.label}
                data-council-files-list
                data-open={isOpen ? "true" : undefined}
                className={cn(
                    "absolute right-0 z-30 w-[300px] max-w-[80vw] flex-col gap-[2px] rounded-[8px] border border-edge-mid frost p-[6px] shadow-popover-sm",
                    up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
                    isOpen ? "flex" : "hidden"
                )}
            >
                {view.groups.map((g, i) =>
                    source == null ? (
                        <SourceName key={g.path} group={g} row />
                    ) : (
                        <SourceLink key={g.path} group={g} picked={i === picked} onOpen={() => pick(i)} row />
                    )
                )}
                {view.others.map((ref, i) => {
                    const shot = parseShotRef(ref) != null;
                    const Icon = shot ? ImageIcon : FileText;
                    return (
                        <span
                            key={`other-${i}`}
                            data-council-evidence="other"
                            title={ref}
                            className={cn(ROW, "text-secondary")}
                        >
                            <Icon size={12} className="flex-none text-muted" aria-hidden />
                            <span className="min-w-0 truncate">{shot ? shotName(ref) : ref}</span>
                        </span>
                    );
                })}
            </div>
        </span>
    );
}

// the width a region's crop is drawn at under a message: wide enough to see the button, narrow enough for the 380px
// thread panel
const CROP_W = "w-[240px]";

/** A region Go drew, as the message shows it: the crop PNG with its red box, a click opening the whole screenshot in
 *  the Sources panel. A crop that will not load draws nothing: the cite's chip still names it. */
function RegionCropImage({ crop, picked, onOpen }: { crop: RegionCrop; picked: boolean; onOpen?: () => void }) {
    const blob = useBlobSrc(streamFileUrl(crop.region.crop));
    if (blob.failed) {
        return null;
    }
    const img =
        blob.src == null ? (
            <span className={cn("block aspect-[3/2]", CROP_W)} />
        ) : (
            <img
                src={blob.src}
                alt={`Screenshot ${crop.name}`}
                draggable={false}
                className={cn("block h-auto max-w-full", CROP_W)}
            />
        );
    const frame = "max-w-full overflow-hidden rounded-[6px] border bg-surface-code";
    if (onOpen == null) {
        return (
            <span data-council-crop={crop.region.crop} title={crop.name} className={cn(frame, "border-edge-mid")}>
                {img}
            </span>
        );
    }
    return (
        <button
            type="button"
            data-council-crop={crop.region.crop}
            data-picked={picked ? "true" : undefined}
            title={`${crop.name}: open the whole screenshot`}
            aria-label={`Open ${crop.name} in the whole screenshot`}
            onClick={onOpen}
            className={cn(
                frame,
                "cursor-zoom-in p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent",
                picked ? "border-edge-strong ring-1 ring-edge-strong" : "border-edge-mid hover:border-edge-strong"
            )}
        >
            {img}
        </button>
    );
}

// a cited file as a row of the files list an idea's signal line opens (EvidenceFiles), the chip's parts with no box
const ROW =
    "flex h-[26px] w-full min-w-0 select-none items-center gap-[6px] rounded-[6px] border border-transparent bg-transparent px-[6px] text-left text-[12.5px]";

function SourceLink({
    group,
    picked,
    onOpen,
    row,
}: {
    group: SourceGroup;
    picked: boolean;
    onOpen: () => void;
    row?: boolean;
}) {
    return (
        <button
            type="button"
            data-council-evidence="ref"
            data-council-source={group.path}
            data-picked={picked ? "true" : undefined}
            title={`${group.path}${group.label}`}
            onClick={onOpen}
            className={cn(
                row ? ROW : CHIP,
                "group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent",
                picked ? "border-edge-strong bg-surface-selected" : "hover:bg-surface-hover"
            )}
        >
            <FileText size={12} className="flex-none text-muted" aria-hidden />
            <span
                data-council-source-name
                className={cn(NAME, "font-medium text-link underline-offset-2 group-hover:underline")}
            >
                {group.name}
            </span>
            {group.label !== "" && (
                <span data-council-source-lines className={LINES}>
                    {group.label}
                </span>
            )}
        </button>
    );
}

function SourceName({ group, row }: { group: SourceGroup; row?: boolean }) {
    return (
        <span data-council-evidence="ref" title={`${group.path}${group.label}`} className={row ? ROW : CHIP}>
            <FileText size={12} className="flex-none text-muted" aria-hidden />
            <span data-council-source-name className={cn(NAME, "font-medium text-secondary")}>
                {group.name}
            </span>
            {group.label !== "" && (
                <span data-council-source-lines className={LINES}>
                    {group.label}
                </span>
            )}
        </span>
    );
}

// a file's text; null when it is missing, a folder, too big or unreadable
async function readSourceText(path: string): Promise<string | null> {
    if (path === "") {
        return null;
    }
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
        if (info == null || info.notfound || info.isdir || (info.size ?? 0) > MAX_READ) {
            return null;
        }
        const data = await RpcApi.FileReadCommand(TabRpcClient, { info: { path } });
        return data?.data64 != null ? base64ToString(data.data64) : null;
    } catch {
        return null;
    }
}

type SourceText = { state: "loading" } | { state: "unreadable" } | { state: "ok"; text: string };

// the file at `path`, read again each time the panel picks it
function useSourceText(path: string): SourceText {
    const [got, setGot] = useState<{ path: string; text: string | null } | null>(null);
    useEffect(() => {
        let live = true;
        fireAndForget(async () => {
            const text = await readSourceText(path);
            if (live) {
                setGot({ path, text });
            }
        });
        return () => {
            live = false;
        };
    }, [path]);
    if (got == null || got.path !== path) {
        return { state: "loading" };
    }
    return got.text == null ? { state: "unreadable" } : { state: "ok", text: got.text };
}

/** The Sources panel: the message's files, then the picked one's cited lines. */
export function CouncilSourcesPanel(props: {
    c: Council;
    view: CouncilSourcesView;
    onClose: () => void;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    // a clicked region shows its screenshot; anything else the message's files. Two components, so each keeps its own hooks
    return props.view.region != null ? (
        <RegionSources view={props.view} region={props.view.region} onClose={props.onClose} />
    ) : (
        <FileSources {...props} />
    );
}

const PANEL = "flex min-h-0 w-[440px] flex-none flex-col border-l border-edge-faint bg-surface outline-none";

// the panel's header: Sources, what the message is, and the close button (back to the thread it was opened from)
function SourcesHeader({ view, onClose }: { view: CouncilSourcesView; onClose: () => void }) {
    const closeLabel = view.thread != null ? "Back to the thread (Esc)" : "Close the sources (Esc)";
    return (
        <div className="flex flex-none items-center gap-[8px] border-b border-edge-faint py-[12px] pl-4 pr-3">
            <span className="text-[14px] font-semibold">Sources</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{view.title}</span>
            <button
                type="button"
                data-council-sources-close
                aria-label={closeLabel}
                title={closeLabel}
                onClick={onClose}
                className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <X size={14} strokeWidth={2} aria-hidden />
            </button>
        </div>
    );
}

// a screenshot region in the panel: the whole image with the box outlined on it, at the box Go checked; when the image is
// no longer on disk, the crop Go drew stands in for it, with a line that says so
function RegionSources({
    view,
    region,
    onClose,
}: {
    view: CouncilSourcesView;
    region: RegionCrop;
    onClose: () => void;
}) {
    const full = useBlobSrc(streamFileUrl(region.region.image));
    const crop = useBlobSrc(full.failed ? streamFileUrl(region.region.crop) : null);
    const [copied, setCopied] = useState(false);
    useEffect(() => setCopied(false), [region.region.crop]);
    const state = full.failed ? "crop-only" : full.src == null ? "loading" : "full";
    const copy = () =>
        fireAndForget(async () => {
            await navigator.clipboard.writeText(region.region.crop);
            setCopied(true);
        });
    return (
        <aside data-council-sources tabIndex={-1} aria-label="Sources" className={PANEL}>
            <SourcesHeader view={view} onClose={onClose} />
            <div
                data-council-sources-body
                data-council-sources-region={region.region.crop}
                data-state={state}
                className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-[14px]"
            >
                <div className="flex items-center gap-[6px] break-all text-[16px] font-semibold leading-[1.35] text-primary">
                    <ImageIcon size={14} className="flex-none text-muted" aria-hidden />
                    {region.name}
                </div>
                <div className="mt-[2px] break-all text-[12.5px] text-muted">{region.region.image}</div>
                {state === "loading" && <div className="mt-[14px] text-[13px] text-muted">Reading the image…</div>}
                {state === "full" && (
                    <div className="relative mt-[14px] w-fit max-w-full overflow-hidden rounded-[8px] border border-edge-faint">
                        <img
                            src={full.src}
                            alt={`Screenshot ${region.name}`}
                            draggable={false}
                            className="block h-auto max-w-full"
                        />
                        <span
                            data-council-region-box
                            aria-hidden
                            style={regionBoxStyle(region.region)}
                            className="pointer-events-none absolute rounded-[2px] border-2 border-error"
                        />
                    </div>
                )}
                {state === "crop-only" && (
                    <>
                        <div data-council-sources-error className="mt-[14px] text-[13px] leading-[1.5] text-secondary">
                            The full screenshot is no longer on disk; this is the region as it was drawn.
                        </div>
                        {crop.src != null && (
                            <img
                                src={crop.src}
                                alt={`Screenshot ${region.name}`}
                                draggable={false}
                                className="mt-[10px] block h-auto max-w-full rounded-[8px] border border-edge-faint"
                            />
                        )}
                    </>
                )}
            </div>
            <div className="flex flex-none gap-2 border-t border-edge-faint px-4 py-3">
                <button
                    type="button"
                    data-council-sources-copy
                    title={region.region.crop}
                    onClick={copy}
                    className={ghostButton}
                >
                    {copied ? "Copied" : "Copy the region's path"}
                </button>
            </div>
        </aside>
    );
}

function FileSources({
    c,
    view,
    onClose,
    onOpenFile,
}: {
    c: Council;
    view: CouncilSourcesView;
    onClose: () => void;
    onOpenFile?: (path: string, line?: number) => void;
}) {
    const groups = useMemo(() => groupSources(view.refs).groups, [view.refs]);
    const group: SourceGroup | undefined = groups[Math.min(view.pick, groups.length - 1)];
    const abs = group == null ? "" : sourceFilePath(c.project, group.path);
    const file = useSourceText(abs);
    const text = file.state === "ok" ? file.text : null;
    const excerpt = useMemo(
        () => (text != null && group != null ? sourceExcerpt(text, group.lines) : null),
        [text, group]
    );
    const [copied, setCopied] = useState(false);
    useEffect(() => setCopied(false), [abs]);
    if (group == null) {
        return null;
    }
    const dir = sourceDir(group.path);
    const past = excerpt == null ? "" : pastEndWords(excerpt);
    const copy = () =>
        fireAndForget(async () => {
            await navigator.clipboard.writeText(abs);
            setCopied(true);
        });
    return (
        <aside data-council-sources tabIndex={-1} aria-label="Sources" className={PANEL}>
            <SourcesHeader view={view} onClose={onClose} />
            {groups.length > 1 && (
                <div role="list" aria-label="Files" className="flex flex-none flex-col gap-[2px] p-2">
                    {groups.map((g, i) => {
                        const on = g === group;
                        return (
                            <button
                                key={g.path}
                                type="button"
                                role="listitem"
                                data-council-sources-file={g.path}
                                data-picked={on ? "true" : undefined}
                                aria-current={on ? "true" : undefined}
                                title={`${g.path}${g.label}`}
                                onClick={() => openCouncilSources(c.id, { ...view, pick: i })}
                                className={cn(
                                    "flex h-[28px] min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] border-0 px-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    on ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
                                )}
                            >
                                <FileText size={12} className="flex-none text-muted" aria-hidden />
                                <span className={cn("min-w-0 truncate", on ? "text-primary" : "text-link")}>
                                    {g.name}
                                </span>
                                {g.label !== "" && <span className="flex-none tabular-nums text-muted">{g.label}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
            <div
                data-council-sources-body
                data-state={file.state}
                className={cn(
                    "min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-[14px]",
                    groups.length > 1 && "border-t border-edge-faint"
                )}
            >
                <div className="break-all text-[16px] font-semibold leading-[1.35] text-primary">
                    {group.path.slice(dir.length)}
                </div>
                {dir !== "" && <div className="mt-[2px] break-all text-[12.5px] text-muted">{dir}</div>}
                {file.state === "loading" && <div className="mt-[14px] text-[13px] text-muted">Reading the file…</div>}
                {file.state === "unreadable" && (
                    <div data-council-sources-error className="mt-[14px] text-[13px] leading-[1.5] text-secondary">
                        Can't show this file: it is not in the project any more, it is a folder, or it is over 2 MB.
                    </div>
                )}
                {excerpt?.hunks.map((h) => (
                    <div key={h.start}>
                        <div className="mb-[6px] mt-[14px] text-[12px] text-muted">
                            {hunkLabel(h)}
                            {h.cut && " · cut short"}
                        </div>
                        <div
                            data-council-sources-hunk={h.start}
                            className="overflow-hidden rounded-[8px] border border-edge-faint bg-surface-code py-[6px]"
                        >
                            {h.rows.map((r) => (
                                <div
                                    key={r.n}
                                    data-cited={r.cited ? "true" : undefined}
                                    className={cn("flex gap-[10px] pr-[10px]", r.cited && "bg-surface-selected")}
                                >
                                    <span
                                        className={cn(
                                            "w-[34px] flex-none select-none text-right font-mono text-[12px] leading-[1.65]",
                                            r.cited ? "font-semibold text-primary" : "text-ink-faint"
                                        )}
                                    >
                                        {r.n}
                                    </span>
                                    <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-secondary [overflow-wrap:anywhere]">
                                        {r.text === "" ? " " : r.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
                {past !== "" && <div className="mt-[14px] text-[13px] leading-[1.5] text-secondary">{past}</div>}
            </div>
            <div className="flex flex-none gap-2 border-t border-edge-faint px-4 py-3">
                {onOpenFile != null && file.state === "ok" && (
                    <button
                        type="button"
                        data-council-sources-open
                        onClick={() => onOpenFile(abs, group.lines[0]?.start)}
                        className={secondaryButton}
                    >
                        Open in Code
                    </button>
                )}
                <button type="button" data-council-sources-copy onClick={copy} className={ghostButton}>
                    {copied ? "Copied" : "Copy path"}
                </button>
            </div>
        </aside>
    );
}
