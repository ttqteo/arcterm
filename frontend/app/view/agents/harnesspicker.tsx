// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The shared harness picker: a fixed-width chip naming the current selection, opening an
// Autonomy-style popover of one descriptive row per harness. Its one host is Pet Errand (consult
// operation, no disclosure); the run-worker operation and its unattended-authority disclosure remain
// for a run composer.
// The pure derivation functions live here too so the picker and the composer dispatch share one module.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
    type Placement,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { harnessesAtom, harnessPreferenceAtom, setPreferredHarness } from "./harnessstore";
import { RuntimeMark } from "./runtimemark";

export type HarnessOperation = "consult" | "run-worker";

export function supportsOperation(h: HarnessInfo, operation: HarnessOperation): boolean {
    return operation === "consult" ? h.consultcapable : h.runworkercapable;
}

export interface HarnessPickerItem {
    runtime: string;
    label: string;
    selected: boolean;
    selectable: boolean;
    unavailableReason?: "unsupported" | "not-installed";
    disclosure?: string;
}

export function harnessPickerItems(
    harnesses: HarnessInfo[],
    runtime: string,
    operation: HarnessOperation
): HarnessPickerItem[] {
    return harnesses.map((h) => {
        const supported = supportsOperation(h, operation);
        return {
            runtime: h.runtime,
            label: h.label,
            selected: h.runtime === runtime,
            selectable: h.installed && supported,
            unavailableReason: !supported
                ? ("unsupported" as const)
                : !h.installed
                  ? ("not-installed" as const)
                  : undefined,
            disclosure: operation === "run-worker" ? "Can edit files and run commands without approval." : undefined,
        };
    });
}

export interface HarnessPickerFace {
    label: string;
    valid: boolean;
}

// harnessPickerFace derives the chip's face from the current runtime. An empty runtime means no
// preference exists; an unknown runtime renders its id so the operator sees exactly what is saved.
export function harnessPickerFace(
    runtime: string,
    harnesses: HarnessInfo[],
    operation: HarnessOperation
): HarnessPickerFace {
    if (runtime === "") {
        return { label: "Choose harness", valid: false };
    }
    const item = harnesses.find((h) => h.runtime === runtime);
    if (item == null) {
        return { label: `Unknown: ${runtime}`, valid: false };
    }
    if (!item.installed || !supportsOperation(item, operation)) {
        return { label: item.label, valid: false };
    }
    return { label: item.label, valid: true };
}

interface HarnessPickerProps {
    operation: HarnessOperation;
    placement?: Placement;
    className?: string;
    // bumped by a blocked composer submission to focus and open the picker
    openRequest?: number;
}

export function HarnessPicker({ operation, placement = "top-start", className, openRequest = 0 }: HarnessPickerProps) {
    const pref = useAtomValue(harnessPreferenceAtom);
    const harnesses = useAtomValue(harnessesAtom);
    const [open, setOpen] = useState(false);
    useEffect(() => () => setOpen(false), []);
    useEffect(() => {
        if (openRequest > 0) {
            setOpen(true);
        }
    }, [openRequest]);

    const runtime = pref.route?.runtime ?? "";
    const face = harnessPickerFace(runtime, harnesses, operation);
    const items = harnessPickerItems(harnesses, runtime, operation);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement,
        strategy: "fixed",
        // portaled, so no host's overflow-hidden clips it (the avatar popup's panel did at 440x420); flip
        // opens it below when there is no room above, and shift keeps it off the viewport edges
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);

    return (
        <div className={cn("relative flex-none", className)}>
            <button
                ref={refs.setReference}
                {...getReferenceProps()}
                type="button"
                data-testid="harness-picker"
                data-harness-operation={operation}
                data-harness-runtime={runtime || ""}
                aria-expanded={open}
                title="Harness — which coding agent runs this"
                className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-[7px] border bg-surface px-2.5 py-1 text-[11px] font-semibold",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    open ? "border-accent-700 text-primary" : "border-border text-secondary hover:text-primary"
                )}
            >
                <span className="min-w-0 flex-1 truncate text-left">{face.label}</span>
                {pref.saving ? (
                    <span className="text-[10.5px] font-normal text-muted">saving</span>
                ) : (
                    <ChevronDown size={12} className={cn("flex-none text-muted", open && "rotate-180")} />
                )}
            </button>
            <FloatingPortal>
                {/* above the avatar popup's z-[65] and ModalShell's z-[70] */}
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[80]">
                    <PopoverReveal
                        open={open}
                        origin="bottom left"
                        className="w-[300px] rounded-[11px] border border-border bg-surface p-[5px] shadow-popover-md"
                    >
                        <div>
                            <div className={cn(REGION_LABEL, "px-[9px] pb-1.5 pt-1 text-muted")}>Harness</div>
                            {items.map((item) => (
                                <button
                                    key={item.runtime}
                                    type="button"
                                    aria-pressed={item.selected}
                                    disabled={!item.selectable}
                                    data-testid={`harness-option-${item.runtime}`}
                                    onClick={() => {
                                        setPreferredHarness(item.runtime);
                                        // the option unmounts with the menu, and focus would fall to the body,
                                        // out of a host dialog that owns the keys
                                        setOpen(false);
                                        (refs.domReference.current as HTMLElement | null)?.focus();
                                    }}
                                    className={cn(
                                        "flex w-full items-start gap-2.5 rounded px-[9px] py-2 text-left",
                                        item.selectable
                                            ? "cursor-pointer hover:bg-surface-hover"
                                            : "cursor-default opacity-70",
                                        item.selected ? "bg-surface-raised" : "bg-transparent"
                                    )}
                                >
                                    <RuntimeMark runtime={item.runtime} className="mt-[2px] h-4 w-4 flex-none" />
                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={cn(
                                                "block text-[12.5px] font-semibold",
                                                item.selected ? "text-accent" : "text-primary"
                                            )}
                                        >
                                            {item.label}
                                        </span>
                                        {item.unavailableReason != null ? (
                                            <span className="mt-[3px] block text-[11px] leading-[1.45] text-muted">
                                                {item.unavailableReason === "not-installed"
                                                    ? "not installed"
                                                    : "unsupported for this action"}
                                            </span>
                                        ) : item.disclosure != null ? (
                                            <span className="mt-[3px] block text-[11px] leading-[1.45] text-muted">
                                                {item.disclosure}
                                            </span>
                                        ) : null}
                                    </span>
                                    {item.selected ? (
                                        <Check size={12} className="mt-[3px] flex-none text-accent" />
                                    ) : null}
                                </button>
                            ))}
                            {pref.error != null ? (
                                <div className="mt-1 border-t border-border px-[9px] pb-1 pt-2 text-[10.5px] text-error">
                                    saving failed: {pref.error}
                                </div>
                            ) : null}
                        </div>
                    </PopoverReveal>
                </div>
            </FloatingPortal>
        </div>
    );
}
