// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size as floatingSize,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
    type Placement,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, Plus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import {
    allowPickerSections,
    buildPickerSections,
    filterPickerSections,
    modelFace,
    pickerRowMeta,
    pickerTitleFor,
    scopePickerSections,
} from "./route";
import type { PickerSection } from "./route";
import { harnessesAtom, harnessesLoadingAtom, loadHarnesses, refreshHarnessCatalog } from "./harnessstore";
import { SubLabel } from "./sectionlabel";

// The panel is portalled to the body so this is measured against the viewport. Rendered in place it was
// clipped to the gap between the trigger and the bottom of whatever scroll container held it — inside the
// + Run modal that left a 37px window onto a 28,000px list.
const ROUTE_PICKER_MAX_HEIGHT = 480;
// flip measures the menu after size has capped it, so a menu allowed to shrink into a thin gap always
// "fits" there and never flips to the roomy side; below this floor it overflows and flip moves it
const ROUTE_PICKER_MIN_HEIGHT = 240;

export function RoutePicker({
    value,
    onChange,
    canInherit = false,
    inheritedLabel = "Inherit route",
    placement = "top-start",
    openRequest = 0,
    title,
    size = "default",
    disabled = false,
    extraOption,
    runtimes,
}: {
    value: RoutePin | null;
    onChange: (route: RoutePin | null) => void;
    canInherit?: boolean;
    inheritedLabel?: string;
    placement?: Placement;
    openRequest?: number;
    title?: string;
    size?: "default" | "compact" | "select";
    disabled?: boolean;
    // an answer that is not a route (Reviewer picks), so it has no RoutePin for value to hold
    extraOption?: { label: string; selected: boolean; onSelect: () => void };
    // the only runtimes offered; unset offers every runtime with a model
    runtimes?: readonly string[];
}): JSX.Element {
    const harnesses = useAtomValue(harnessesAtom);
    const loading = useAtomValue(harnessesLoadingAtom);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [scope, setScope] = useState<string | null>(null);
    const [customId, setCustomId] = useState<{ runtime: string; draft: string } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const rowRefs = useRef(new Map<string, HTMLButtonElement>());
    useEffect(() => {
        if (openRequest > 0) {
            setOpen(true);
        }
    }, [openRequest]);
    // custom/free-form ids may be namespace-valid without catalog presence, so the face never
    // claims "unavailable" — resolution happens server-side at dispatch.
    const harness = value == null ? undefined : harnesses.find((h) => h.runtime === value.runtime);
    const extraSelected = extraOption?.selected ?? false;
    const inheritedSelected = value == null && !extraSelected;
    const face = extraSelected
        ? extraOption.label
        : value == null
          ? inheritedLabel
          : `${harness?.label ?? value.runtime} · ${modelFace(value)}`;
    const catalog = useMemo(
        () => allowPickerSections(buildPickerSections(harnesses), runtimes),
        [harnesses, runtimes]
    );
    const matched = useMemo(() => filterPickerSections(catalog, query), [catalog, query]);
    const sections = useMemo(() => scopePickerSections(matched, scope), [matched, scope]);
    const rowKeys = useMemo(
        () => sections.flatMap((section) => section.rows.map((row) => `${row.runtime}:${row.model}`)),
        [sections]
    );
    useEffect(() => {
        if (!open) {
            return;
        }
        // start on the harness already in use: the chip strip then reads as "you are here, and there are
        // others", where an unscoped list just looks like one harness is everything there is
        setScope(value?.runtime ?? null);
        const frame = requestAnimationFrame(() => searchRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [open, value?.runtime]);
    // the catalog is loaded once at boot and a failed load is not cached server-side, so an empty
    // picker retries instead of saying "no routes" for the rest of the session
    useEffect(() => {
        if (open && catalog.length === 0 && !loading) {
            void loadHarnesses();
        }
    }, [open]);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange(next, _event, reason) {
            setOpen(next);
            if (!next && reason === "escape-key") {
                requestAnimationFrame(() => triggerRef.current?.focus());
            }
        },
        placement,
        strategy: "fixed",
        middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            floatingSize({
                padding: 8,
                apply({ availableHeight, elements }) {
                    const maxHeight = Math.min(
                        ROUTE_PICKER_MAX_HEIGHT,
                        Math.max(ROUTE_PICKER_MIN_HEIGHT, availableHeight)
                    );
                    elements.floating.style.setProperty("--route-picker-max-height", `${maxHeight}px`);
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

    const close = () => {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const choose = (route: RoutePin | null) => {
        onChange(route);
        close();
    };
    const focusRow = (index: number) => {
        if (rowKeys.length === 0) {
            return;
        }
        const wrapped = (index + rowKeys.length) % rowKeys.length;
        rowRefs.current.get(rowKeys[wrapped])?.focus();
    };
    const navigateRow = (event: KeyboardEvent<HTMLElement>, index: number) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
            return;
        }
        event.preventDefault();
        focusRow(index + (event.key === "ArrowDown" ? 1 : -1));
    };

    return (
        <div className="relative flex-none">
            <button
                ref={(node) => {
                    triggerRef.current = node;
                    refs.setReference(node);
                }}
                {...getReferenceProps()}
                type="button"
                data-testid="route-picker"
                disabled={disabled}
                aria-expanded={open}
                aria-label={pickerTitleFor(title)}
                className={cn(
                    "flex cursor-pointer items-center gap-1.5 rounded-[6px] border bg-surface text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40",
                    size === "compact"
                        ? "max-w-[200px] px-2 py-[3px] text-[10.5px]"
                        : size === "select"
                          ? // the Settings page's Select button (settingsui.tsx): same height, radius, border and type size
                            "h-7 max-w-[300px] rounded-sm px-2.5 text-[12px] font-medium"
                          : "max-w-[300px] px-2.5 py-1 text-[11px]",
                    open
                        ? "border-accent-700 text-primary"
                        : size === "select"
                          ? "border-edge-mid text-primary hover:bg-surface-hover"
                          : "border-border text-secondary hover:text-primary"
                )}
            >
                <span className="min-w-0 truncate">{face}</span>
                <ChevronDown size={12} className={cn("flex-none text-muted", open && "rotate-180")} />
            </button>
            <FloatingPortal>
                {/* above ModalShell's z-[70] backdrop: the launcher's pickers live inside a modal */}
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                <PopoverReveal
                    open={open}
                    origin="bottom left"
                    className="flex max-h-[var(--route-picker-max-height)] w-[320px] flex-col overflow-hidden rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                >
                    <div role="group" aria-label="Available routes" className="flex min-h-0 flex-1 flex-col">
                        <div className="flex items-center justify-between px-[9px] pb-1.5 pt-1">
                            <SubLabel>{pickerTitleFor(title)}</SubLabel>
                            <button
                                type="button"
                                onClick={() => void refreshHarnessCatalog()}
                                aria-label="Refresh model catalog"
                                title="Refresh model catalog"
                                className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <RotateCw size={12} />
                            </button>
                        </div>
                        <input
                            ref={searchRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                    event.preventDefault();
                                    focusRow(event.key === "ArrowDown" ? 0 : rowKeys.length - 1);
                                }
                            }}
                            placeholder="filter models…"
                            aria-label="Filter models"
                            className="mb-1 w-full rounded-[7px] border border-edge-mid bg-surface px-2 py-1 text-[11.5px] text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        />
                        <HarnessChips sections={matched} scope={scope} onScope={setScope} />
                        {canInherit ? (
                            <button
                                type="button"
                                aria-pressed={inheritedSelected}
                                data-testid="route-option-inherit"
                                onClick={() => choose(null)}
                                className={cn(
                                    "flex w-full cursor-pointer items-start rounded px-[9px] py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    inheritedSelected ? "bg-surface-raised text-accent" : "text-primary hover:bg-surface-hover"
                                )}
                            >
                                <span className="min-w-0 flex-1 text-[12.5px] font-semibold">{inheritedLabel}</span>
                                {inheritedSelected ? <Check size={12} className="mt-[3px] flex-none text-accent" /> : null}
                            </button>
                        ) : null}
                        {extraOption != null ? (
                            <button
                                type="button"
                                aria-pressed={extraSelected}
                                data-testid="route-option-extra"
                                onClick={() => {
                                    extraOption.onSelect();
                                    close();
                                }}
                                className={cn(
                                    "flex w-full cursor-pointer items-start rounded px-[9px] py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    extraSelected ? "bg-surface-raised text-accent" : "text-primary hover:bg-surface-hover"
                                )}
                            >
                                <span className="min-w-0 flex-1 text-[12.5px] font-semibold">{extraOption.label}</span>
                                {extraSelected ? <Check size={12} className="mt-[3px] flex-none text-accent" /> : null}
                            </button>
                        ) : null}
                        <div data-testid="route-picker-scroll" className="min-h-0 overflow-y-auto overscroll-contain">
                        {sections.map((section) => (
                            <div key={section.runtime} className="mt-1 border-t border-border pt-1">
                                <div className="px-[9px] py-1 text-[11px] font-semibold text-secondary">{section.label}</div>
                                {section.rows.map((row) => {
                                    const selectedRow = value?.runtime === row.runtime && value.model === row.model;
                                    const key = `${row.runtime}:${row.model}`;
                                    const index = rowKeys.indexOf(key);
                                    return (
                                        <button
                                            key={row.model}
                                            ref={(node) => {
                                                if (node == null) {
                                                    rowRefs.current.delete(key);
                                                } else {
                                                    rowRefs.current.set(key, node);
                                                }
                                            }}
                                            type="button"
                                            onKeyDown={(event) => navigateRow(event, index)}
                                            aria-pressed={selectedRow}
                                            data-testid={`route-option-${row.runtime}-${row.model}`}
                                            onClick={() => choose({ runtime: row.runtime, model:row.model })}
                                            className={cn(
                                                "flex w-full cursor-pointer items-start gap-2 rounded px-[9px] py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                                selectedRow ? "bg-surface-raised" : "hover:bg-surface-hover"
                                            )}
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className={cn("block text-[11.5px]", selectedRow ? "text-accent" : "text-primary")}>{row.model}</span>
                                                <span className="mt-[2px] block text-[10.5px] text-muted">
                                                    {pickerRowMeta(row)}
                                                </span>
                                            </span>
                                            {selectedRow ? <Check size={12} className="mt-[3px] flex-none text-accent" /> : null}
                                        </button>
                                    );
                                })}
                                {customId?.runtime === section.runtime ? (
                                    <div className="flex items-center gap-1.5 px-[9px] py-1.5">
                                        <input
                                            autoFocus
                                            value={customId.draft}
                                            onChange={(e) => setCustomId({ runtime: section.runtime, draft: e.target.value })}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && customId.draft.trim()) {
                                                    choose({ runtime: section.runtime, model:customId.draft.trim() });
                                                }
                                            }}
                                            aria-label={`Custom model id for ${section.label}`}
                                            className="min-w-0 flex-1 rounded-[7px] border border-edge-mid bg-surface px-2 py-1 text-[11px] text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => customId.draft.trim() && choose({ runtime: section.runtime, model:customId.draft.trim() })}
                                            aria-label="Use custom model"
                                            className="cursor-pointer rounded-md border border-edge-mid px-2 py-1 text-[10.5px] font-semibold text-secondary hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                        >
                                            Use
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setCustomId({ runtime: section.runtime, draft: "" })}
                                        className="flex w-full cursor-pointer items-center gap-2 rounded px-[9px] py-1.5 text-left text-[11px] text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    >
                                        <Plus size={12} className="flex-none" />
                                        custom model id…
                                    </button>
                                )}
                            </div>
                        ))}
                        {sections.length === 0 && !query ? (
                            <div className="px-[9px] py-2 text-[11px] text-muted">{loading ? "Loading models…" : "No run routes available."}</div>
                        ) : null}
                        </div>
                    </div>
                </PopoverReveal>
                </div>
            </FloatingPortal>
        </div>
    );
}

// One chip per harness that still has rows under the current query, so a harness with three models is one
// click away instead of ~490 rows down the list. Hidden when there is nothing to choose between.
function HarnessChips({ sections, scope, onScope }: { sections: PickerSection[]; scope: string | null; onScope: (runtime: string | null) => void }) {
    if (sections.length < 2) {
        return null;
    }
    const active = sections.some((s) => s.runtime === scope) ? scope : null;
    const chips = [{ runtime: null as string | null, label: "All" }, ...sections.map((s) => ({ runtime: s.runtime, label: s.label }))];
    return (
        <div className="mb-1 flex flex-wrap gap-1 px-[1px]">
            {chips.map((chip) => (
                <button
                    key={chip.runtime ?? "all"}
                    type="button"
                    aria-pressed={active === chip.runtime}
                    data-testid={`route-harness-${chip.runtime ?? "all"}`}
                    onClick={() => onScope(chip.runtime)}
                    className={cn(
                        "cursor-pointer rounded-full border px-2 py-[2px] text-[10.5px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active === chip.runtime ? "border-accent-700 bg-surface-raised text-accent" : "border-border text-muted hover:text-secondary"
                    )}
                >
                    {chip.label}
                </button>
            ))}
        </div>
    );
}
