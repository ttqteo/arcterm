// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    closeContextMenu,
    closeSubmenu,
    firstActionable,
    focusedItem,
    hasLeadingColumn,
    initialPath,
    type MenuPath,
    moveHighlight,
    openSubmenu,
    visibleItems,
    type ContextMenuState,
} from "@/app/store/contextmenu";
import { cn } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KeyCap } from "./keycap";

const PANEL = "z-[1000] min-w-[200px] rounded-[8px] border border-edge-mid bg-surface-raised p-1 shadow-lg";
const ITEM =
    "relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-secondary";
const ITEM_ACTIVE = "bg-accent/12 text-primary";
const ITEM_DANGER = "text-error";
const ITEM_DANGER_ACTIVE = "bg-error/10 text-error";
const ITEM_DISABLED = "cursor-default opacity-50";
const LEAD = "flex w-[16px] shrink-0 items-center justify-center";

function runClick(item: ContextMenuItem) {
    if (item.enabled === false) {
        return;
    }
    item.click?.();
    closeContextMenu();
}

// The leading column: icon for normal rows; a check for a ticked checkbox; a dot for radio-on.
// Rendered only when the menu reserves the column (hasLeadingColumn).
function Leading({ item, highlighted, danger }: { item: ContextMenuItem; highlighted: boolean; danger: boolean }) {
    let content: React.ReactNode = null;
    if (item.type === "checkbox") {
        content = item.checked ? <Check size={13} className="text-accent" /> : null;
    } else if (item.type === "radio") {
        content = item.checked ? <span className="h-[6px] w-[6px] rounded-full bg-accent" /> : null;
    } else if (item.icon != null) {
        content = item.icon;
    }
    const color = danger ? "text-error" : highlighted ? "text-accent-soft" : "text-muted";
    return <span className={cn(LEAD, "[&_svg]:h-[15px] [&_svg]:w-[15px]", color)}>{content}</span>;
}

// One menu level. `basePath` is the path prefix that reaches this level's parent
// (empty at root). `active` is the whole highlight path. A row is highlighted when
// active[level] === its index; its submenu is open when the active path goes deeper.
function MenuLevel({
    items,
    basePath,
    active,
    setActive,
}: {
    items: ContextMenuItem[];
    basePath: MenuPath;
    active: MenuPath;
    setActive: (p: MenuPath) => void;
}) {
    const level = basePath.length;
    const vis = visibleItems(items);
    const hasLead = hasLeadingColumn(items);
    return (
        <>
            {vis.map((item, i) => {
                if (item.type === "separator") {
                    return <div key={i} className="mx-2 my-1.5 h-px bg-edge-mid" />;
                }
                if (item.type === "header") {
                    return (
                        <div
                            key={i}
                            className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.06em] text-muted"
                        >
                            {item.label}
                        </div>
                    );
                }
                const rowPath = [...basePath, i];
                const onPath = active[level] === i;
                const submenuOpen = onPath && item.submenu != null && active.length > level + 1;
                return (
                    <MenuRow
                        key={i}
                        item={item}
                        rowPath={rowPath}
                        highlighted={onPath}
                        submenuOpen={submenuOpen}
                        disabled={item.enabled === false}
                        danger={item.danger === true}
                        hasLead={hasLead}
                        active={active}
                        setActive={setActive}
                    />
                );
            })}
        </>
    );
}

function MenuRow({
    item,
    rowPath,
    highlighted,
    submenuOpen,
    disabled,
    danger,
    hasLead,
    active,
    setActive,
}: {
    item: ContextMenuItem;
    rowPath: MenuPath;
    highlighted: boolean;
    submenuOpen: boolean;
    disabled: boolean;
    danger: boolean;
    hasLead: boolean;
    active: MenuPath;
    setActive: (p: MenuPath) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [flipLeft, setFlipLeft] = useState(false);
    const hasSub = item.submenu != null;

    const onEnter = () => {
        if (disabled) {
            return;
        }
        if (hasSub) {
            const r = ref.current?.getBoundingClientRect();
            if (r) {
                setFlipLeft(r.right + 200 > window.innerWidth);
            }
            // hovering a submenu row opens it (parity with prior behavior); index into the
            // VISIBLE children via firstActionable so the path stays aligned with MenuLevel
            const first = firstActionable(item.submenu!);
            setActive(first < 0 ? rowPath : [...rowPath, first]);
        } else {
            setActive(rowPath);
        }
    };

    const activeCls = danger ? ITEM_DANGER_ACTIVE : ITEM_ACTIVE;
    return (
        <div
            ref={ref}
            className={cn(ITEM, danger && !highlighted && ITEM_DANGER, highlighted && activeCls, disabled && ITEM_DISABLED)}
            onMouseEnter={onEnter}
            onClick={() => (hasSub ? undefined : runClick(item))}
        >
            {hasLead ? <Leading item={item} highlighted={highlighted} danger={danger} /> : null}
            <span className="flex-1 whitespace-nowrap">{item.label}</span>
            {hasSub ? (
                <ChevronRight size={13} className="ml-auto text-muted" />
            ) : item.accel ? (
                <KeyCap chord={item.accel} variant="inline" className="ml-auto" />
            ) : item.sublabel ? (
                <span className="ml-auto text-muted">{item.sublabel}</span>
            ) : null}
            {submenuOpen ? (
                <div className={cn(PANEL, "absolute top-[-5px]", flipLeft ? "right-full mr-1" : "left-full ml-1")}>
                    <MenuLevel items={item.submenu!} basePath={rowPath} active={active} setActive={setActive} />
                </div>
            ) : null}
        </div>
    );
}

export function ContextMenu({ state }: { state: ContextMenuState }) {
    const { items, x, y } = state;
    const [active, setActive] = useState<MenuPath>(() => initialPath(items));
    const { refs, floatingStyles, context } = useFloating({
        open: true,
        onOpenChange: (o) => {
            if (!o) {
                closeContextMenu();
            }
        },
        placement: "bottom-start",
        middleware: [offset({ mainAxis: 4 }), flip(), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    useEffect(() => {
        refs.setPositionReference({
            getBoundingClientRect: () => ({ width: 0, height: 0, x, y, top: y, left: x, right: x, bottom: y }),
        });
    }, [x, y, refs]);
    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    // grab focus so the menu receives keydown immediately
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        panelRef.current?.focus();
    }, []);

    const descendOrActivate = () => {
        const item = focusedItem(items, active);
        if (item == null) {
            return;
        }
        if (item.submenu != null) {
            const opened = openSubmenu(items, active);
            if (opened) {
                setActive(opened);
            }
        } else {
            runClick(item);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setActive(moveHighlight(items, active, 1));
                break;
            case "ArrowUp":
                e.preventDefault();
                setActive(moveHighlight(items, active, -1));
                break;
            case "ArrowRight":
            case "Enter":
                e.preventDefault();
                descendOrActivate();
                break;
            case "ArrowLeft": {
                e.preventDefault();
                const closed = closeSubmenu(active);
                if (closed) {
                    setActive(closed);
                } else {
                    closeContextMenu();
                }
                break;
            }
            case "Escape":
                e.preventDefault();
                closeContextMenu();
                break;
        }
    };

    return (
        <FloatingPortal>
            <div
                ref={(node) => {
                    refs.setFloating(node);
                    panelRef.current = node;
                }}
                tabIndex={-1}
                style={floatingStyles}
                className={cn(PANEL, "outline-none")}
                onKeyDown={onKeyDown}
                {...getFloatingProps()}
            >
                <MenuLevel items={items} basePath={[]} active={active} setActive={setActive} />
            </div>
        </FloatingPortal>
    );
}
