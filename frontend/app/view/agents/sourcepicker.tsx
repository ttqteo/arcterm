// frontend/app/view/agents/sourcepicker.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The panel's source dropdown: one button naming what the Diff surface is showing (a branch icon, the project or agent,
// the branch), and a popover that holds the source tree (worktreesidebarview.tsx) to pick another. It replaces the
// worktree sidebar column, so choosing a source costs no width while you read a diff.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { ChevronDown, GitBranch } from "lucide-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { panelFoldedAtom, sourceTitle } from "./difflayout";
import { sourcePickerOpenAtom } from "./worktreesidebarstore";
import { SourceTree } from "./worktreesidebarview";

// The not-a-repository panel's "Choose a source": unfold the panel if it is folded away, then open the dropdown. Its
// filter takes focus as it mounts.
export function revealSourcePicker(): void {
    globalStore.set(panelFoldedAtom, false);
    globalStore.set(sourcePickerOpenAtom, true);
}

type SourceTreeProps = Omit<ComponentProps<typeof SourceTree>, "onPicked">;

export function SourcePicker(props: SourceTreeProps) {
    const [open, setOpen] = useAtom(sourcePickerOpenAtom);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const title = sourceTitle(props.scope, props.filesState?.branch ?? "");

    // closes on a click anywhere else; the trigger toggles on its own click, so it is not "outside"
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node | null;
            if (t != null && (popRef.current?.contains(t) || triggerRef.current?.contains(t))) {
                return;
            }
            setOpen(false);
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);

    // a picker that unmounts (the panel folds) must not come back open
    useEffect(() => () => globalStore.set(sourcePickerOpenAtom, false), []);

    const close = () => {
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <div className="relative min-w-0 flex-1">
            <button
                ref={triggerRef}
                data-source-picker-trigger
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                title="Choose a project, worktree or agent"
                className={cn(
                    "flex h-[28px] w-full min-w-0 items-center gap-[7px] rounded-[7px] px-[8px] text-left hover:bg-surface-hover",
                    open && "bg-surface-hover"
                )}
            >
                <GitBranch size={14} className="flex-none text-ink-mid" />
                <span className="max-w-[65%] flex-none truncate text-[12.5px] font-semibold text-ink-hi">
                    {title.name}
                </span>
                {title.branch ? (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{title.branch}</span>
                ) : null}
                <ChevronDown size={12} className="ml-auto flex-none text-muted" />
            </button>
            {open ? (
                <div
                    ref={popRef}
                    data-source-picker="open"
                    // the popover keeps its keys: Escape closes it instead of leaving the surface
                    data-owns-keys
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            close();
                        }
                    }}
                    className="absolute left-0 top-[calc(100%+6px)] z-30 w-[328px] rounded-[10px] border border-edge-mid bg-surface-raised p-[6px] shadow-popover-md"
                >
                    <SourceTree {...props} onPicked={close} />
                </div>
            ) : null}
        </div>
    );
}
