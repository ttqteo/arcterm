// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Settings surface's shared primitives: the card and the two-tier row, the controls every page draws
// its values with, and the few helpers more than one page needs. settingssurface.tsx owns the frame and
// where each value lives; settingspages/ owns one page's body each. Nothing here knows a setting's key —
// a row reads its prose, key and scope from RowCtx, which the surface fills from settingsmodel.ts.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { Check, ChevronDown, Copy, RotateCcw, TriangleAlert } from "lucide-react";
import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type CSSProperties,
    type ReactNode,
} from "react";
import type { SurfaceKey } from "./agents";
import type { StartupSurface } from "./cockpitprefsstore";
import { createCommitGate } from "./commitgate";
import type { Runtime } from "./launch";
import { ITEMS } from "./navrail";
import { keyPillTitle, rowKeys, type SettingRowDef } from "./settingsmodel";

export type RowCtxValue = {
    defs: Map<string, SettingRowDef>;
    // Row ids the active search left standing on the selected page, or null when there is no search.
    visible: Set<string> | null;
    // Card ids the active search left standing on the selected page, or null when there is no search.
    visibleCards: Set<string> | null;
    changed: ReadonlySet<string>;
    revert: (id: string) => void;
};

export const RowCtx = createContext<RowCtxValue>({
    defs: new Map(),
    visible: null,
    visibleCards: null,
    changed: new Set(),
    revert: () => {},
});

const SURFACE_LABEL: Record<SurfaceKey, string> = Object.fromEntries(ITEMS.map((i) => [i.key, i.label])) as Record<
    SurfaceKey,
    string
>;

// a startup choice's label: a surface by its nav name, "last" by what it does
export const startupLabel = (k: StartupSurface) => (k === "last" ? "Last opened" : (SURFACE_LABEL[k] ?? k));

// Runtimes the flag editor lists. Terminal stays out (it isn't an agent); pi is included even though
// its catalog is empty so its no-flags state renders in the editor instead of the row vanishing.
export const FLAG_RUNTIMES: { id: Runtime; name: string }[] = [
    { id: "claude", name: "Claude" },
    { id: "codex", name: "Codex" },
    { id: "opencode", name: "OpenCode" },
    { id: "pi", name: "Pi" },
    { id: "agy", name: "Antigravity" },
];

// SetConfigCommand's data param is a typed settings map; a dynamic-key patch needs the cast. A null
// value deletes the key from settings.json (wconfig.SetBaseConfigValue), which is how Revert works —
// dropping the override lets the shipped default take over again.
export function writeConfig(patch: Record<string, unknown>) {
    void RpcApi.SetConfigCommand(TabRpcClient, patch as Parameters<typeof RpcApi.SetConfigCommand>[1]);
}

// The changed mark and the revert button are drawn by a row and by a card that stands in for its one row
// (the theme grid), so both come from here and cannot drift.
function ChangedDot() {
    return <span title="Changed from the default" className="h-[5px] w-[5px] flex-none rounded-full bg-accent" />;
}

function RevertButton({ id, className }: { id: string; className?: string }) {
    const ctx = useContext(RowCtx);
    return (
        <button
            type="button"
            aria-label="Revert to default"
            title="Revert to default"
            onClick={() => ctx.revert(id)}
            className={cn(
                "flex h-[26px] w-[26px] flex-none cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-selected hover:text-primary",
                className
            )}
        >
            <RotateCcw size={14} aria-hidden />
        </button>
    );
}

// What a hovered row shows after its title: the key in a pill that copies it, then where the value lives.
// Hidden until the row is hovered or holds focus. The pill takes no focus on press, so copying a key
// leaves the row's own control where it was.
function KeyPill({ def }: { def: SettingRowDef }) {
    const title = keyPillTitle(def);
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
        () => () => {
            if (timer.current != null) {
                clearTimeout(timer.current);
            }
        },
        []
    );
    if (title == null) {
        return null;
    }
    const copy = () => {
        fireAndForget(() => navigator.clipboard.writeText(rowKeys(def).join(" ")));
        setCopied(true);
        if (timer.current != null) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(false), 1200);
    };
    return (
        <span className="invisible flex flex-none items-center gap-1.5 group-focus-within:visible group-hover:visible">
            <button
                type="button"
                data-key-pill
                title={title}
                aria-label={title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={copy}
                className="flex cursor-pointer items-center gap-[5px] rounded bg-pill px-1.5 py-px font-mono text-[10.5px] text-muted transition-colors hover:text-primary"
            >
                {rowKeys(def).join(" · ")}
                {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
            </button>
            <span className="text-[11px] text-ink-faint">{def.scope === "synced" ? "synced" : "this machine"}</span>
        </span>
    );
}

// A labelled group of rows. `rowId` is for a card that draws its one row without a title line of its own
// (the theme grid): the label line then carries that row's changed state. `header` sits above the rows
// (a CardWarning, or a tab strip) and `footer` below them. Returns nothing when a search left the card out.
export function SettingCard({
    id,
    label,
    rowId,
    header,
    footer,
    children,
}: {
    id: string;
    label: string;
    rowId?: string;
    header?: ReactNode;
    footer?: ReactNode;
    children?: ReactNode;
}) {
    const ctx = useContext(RowCtx);
    if (ctx.visibleCards != null && !ctx.visibleCards.has(id)) {
        return null;
    }
    const changedRow = rowId != null && ctx.changed.has(rowId) ? rowId : null;
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-[18px] items-center gap-[7px] pl-0.5 text-[12px] font-semibold text-ink-mid">
                {changedRow != null ? <ChangedDot /> : null}
                <span>{label}</span>
                {changedRow != null ? (
                    <>
                        <span className="flex-1" />
                        <RevertButton id={changedRow} className="-my-1" />
                    </>
                ) : null}
            </div>
            <div data-setting-card={id} className="overflow-hidden rounded border border-edge-mid bg-surface-raised">
                {header}
                <div>{children}</div>
                {footer}
            </div>
        </section>
    );
}

// One setting: the title and, under it, the description; the control at the card's right edge. `inline`
// is the one-line form a launch flag takes — the title in mono, the description after it on the same line.
// `compact` only tightens the padding. `stacked` drops the control onto its own line for a control that
// cannot sit at the right (a list, a grid). The row reads everything else from the surface's context.
export function SettingRow({
    id,
    compact,
    inline,
    stacked,
    children,
}: {
    id: string;
    compact?: boolean;
    inline?: boolean;
    stacked?: boolean;
    children?: ReactNode;
}) {
    const ctx = useContext(RowCtx);
    const def = ctx.defs.get(id);
    if (def == null || (ctx.visible != null && !ctx.visible.has(id))) {
        return null;
    }
    const changed = ctx.changed.has(id);
    const header = (
        <div className="min-w-0 flex-1">
            <div className="flex min-h-[18px] items-center gap-[7px]">
                {changed ? <ChangedDot /> : null}
                <span
                    className={cn(
                        "flex-none whitespace-nowrap font-medium text-primary",
                        inline ? "font-mono text-[12px]" : "text-[13px]"
                    )}
                >
                    {def.title}
                </span>
                {inline ? (
                    <span title={def.desc} className="min-w-0 truncate text-[12px] text-muted">
                        {def.desc}
                    </span>
                ) : null}
                <KeyPill def={def} />
            </div>
            {!inline && def.desc !== "" ? (
                <div className="mt-0.5 text-[12px] leading-[1.45] text-muted">{def.desc}</div>
            ) : null}
        </div>
    );
    return (
        <div
            data-setting-row={id}
            className={cn(
                "group border-t border-edge-mid transition-colors first:border-t-0 focus-within:bg-surface-hover hover:bg-surface-hover",
                compact ? "px-4 py-[9px]" : "px-4 py-3"
            )}
        >
            {stacked ? (
                <>
                    <div className="flex items-center gap-4">
                        {header}
                        {changed ? <RevertButton id={id} /> : null}
                    </div>
                    <div className="mt-3">{children}</div>
                </>
            ) : (
                <div className="flex items-center gap-4">
                    {header}
                    <div className="flex flex-none items-center gap-2.5">{children}</div>
                    {changed ? <RevertButton id={id} /> : null}
                </div>
            )}
        </div>
    );
}

// A card's last line: a status or an action the rows above it share. With `dot`, a quiet marker leads.
export function CardFooter({ dot, children }: { dot?: boolean; children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 border-t border-edge-mid px-4 py-2.5 text-[12px] text-muted">
            {dot ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-ink-faint" /> : null}
            {children}
        </div>
    );
}

// A card's leading band: what has to be true for the rows below to do anything.
export function CardWarning({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-2.5 border-b border-edge-mid bg-askingbg px-4 py-2.5 text-[12.5px] leading-[1.5] text-warning-soft">
            <TriangleAlert size={14} className="mt-[2px] flex-none text-warning" aria-hidden />
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function Note({ tone = "warning", children }: { tone?: "warning" | "error"; children: ReactNode }) {
    return (
        <div
            className={cn(
                "mt-4 flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[12.5px] leading-[1.55]",
                tone === "warning"
                    ? "border-warning/35 bg-warning/[0.08] text-warning-soft"
                    : "border-error/40 bg-error/[0.08] text-error"
            )}
        >
            {children}
        </div>
    );
}

export function Value({ children, warn }: { children: ReactNode; warn?: boolean }) {
    return <span className={cn("text-[12.5px]", warn ? "text-warning" : "text-secondary")}>{children}</span>;
}

export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            onClick={onToggle}
            className={cn(
                "relative h-[18px] w-8 shrink-0 cursor-pointer rounded-full transition-colors",
                on ? "bg-accent" : "bg-edge-strong"
            )}
        >
            <span
                className={cn(
                    "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
                    on ? "left-4 bg-background" : "left-0.5 bg-ink-mid"
                )}
            />
        </button>
    );
}

// Pick-one group. The selected option is a grey fill, never an accent tint. `fontFamily` draws an option in
// its own face (the font rows).
export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { id: T; label: string; fontFamily?: CSSProperties["fontFamily"] }[];
    value: T;
    onChange: (id: T) => void;
}) {
    return (
        <div className="flex gap-0.5 rounded-sm border border-edge-mid bg-surface p-0.5">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange(o.id)}
                    style={o.fontFamily != null ? { fontFamily: o.fontFamily } : undefined}
                    className={cn(
                        "cursor-pointer whitespace-nowrap rounded-[4px] px-2.5 py-1 text-[12px] font-semibold transition-colors",
                        value === o.id ? "bg-surface-selected text-primary" : "text-muted hover:text-primary"
                    )}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

// +/- stepper. onStep receives -1 or 1; the caller applies its own step size.
export function Stepper({
    value,
    onStep,
    ariaLabel,
}: {
    value: number;
    onStep: (dir: -1 | 1) => void;
    ariaLabel: string;
}) {
    return (
        <div className="flex h-7 items-center rounded-sm border border-edge-mid bg-surface text-[12.5px]">
            <button
                type="button"
                aria-label={`Decrease ${ariaLabel}`}
                onClick={() => onStep(-1)}
                className="h-full w-[26px] cursor-pointer text-[15px] text-muted transition-colors hover:text-primary"
            >
                −
            </button>
            <div className="min-w-10 text-center font-semibold tabular-nums text-primary">{value}</div>
            <button
                type="button"
                aria-label={`Increase ${ariaLabel}`}
                onClick={() => onStep(1)}
                className="h-full w-[26px] cursor-pointer text-[15px] text-muted transition-colors hover:text-primary"
            >
                +
            </button>
        </div>
    );
}

// A text field that commits on blur or Enter and abandons on Escape — the page's one commit model,
// minus a settings.json write per keystroke. The stored value only overwrites the draft when it moves
// on its own (a Revert, or another window's write), so committing never flashes the old text back.
export function CommitText({
    value,
    placeholder,
    disabled,
    width = "w-[260px]",
    list,
    onCommit,
    children,
}: {
    value: string;
    placeholder: string;
    disabled?: boolean;
    width?: string;
    list?: string; // id of a <datalist> offering values
    onCommit: (v: string) => void;
    children?: ReactNode;
}) {
    const [draft, setDraft] = useState(value);
    const external = useRef(value);
    useEffect(() => {
        if (value !== external.current) {
            external.current = value;
            setDraft(value);
        }
    }, [value]);
    const commit = () => {
        const next = draft.trim();
        external.current = next;
        if (next !== value) {
            onCommit(next);
        }
    };
    return (
        <div className={cn("relative", width)}>
            <input
                type="text"
                value={draft}
                placeholder={placeholder}
                disabled={disabled}
                list={list}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        commit();
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        setDraft(value);
                        e.currentTarget.blur();
                    }
                }}
                className={cn(
                    "h-[30px] w-full rounded-sm border border-edge-mid bg-surface pl-2.5 text-[12.5px] text-primary outline-none placeholder:text-ink-faint focus:border-accent-700",
                    children != null ? "pr-9" : "pr-2.5",
                    disabled && "cursor-not-allowed opacity-40"
                )}
            />
            {children}
        </div>
    );
}

// Write-only key field. There is nothing to sync down from, so it keeps its own draft and clears only
// once the key actually lands — a failed write leaves what you pasted in place. Enter blurs the field, so
// Enter and the blur both commit; the gate drops the second while the first is in flight.
export function SecretInput({
    placeholder,
    onCommit,
}: {
    placeholder: string;
    onCommit: (v: string) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState("");
    const [gate] = useState(createCommitGate);
    const commit = () => {
        const v = draft.trim();
        if (v === "") {
            return;
        }
        const pending = gate.commit(v, onCommit);
        if (pending == null) {
            return;
        }
        fireAndForget(async () => {
            if (await pending) {
                setDraft("");
            }
        });
    };
    return (
        <input
            type="password"
            value={draft}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    commit();
                    e.currentTarget.blur();
                } else if (e.key === "Escape") {
                    setDraft("");
                    e.currentTarget.blur();
                }
            }}
            className="h-[30px] w-[260px] rounded-sm border border-edge-mid bg-surface px-2.5 text-[12.5px] text-primary outline-none placeholder:text-ink-faint focus:border-accent-700"
        />
    );
}

// A pick-one dropdown: a button showing the current choice that opens the themed context menu. `items` are
// ContextMenuItems (radio items with `checked`, `sublabel`, separators); `value` names the current choice
// for anything that needs to read it back off the button.
export function Select({
    value,
    label,
    items,
    ariaLabel,
}: {
    value: string;
    label: string;
    items: ContextMenuItem[];
    ariaLabel: string;
}) {
    return (
        <button
            type="button"
            data-select={value}
            aria-label={ariaLabel}
            aria-haspopup="menu"
            onClick={(e) => ContextMenuModel.getInstance().showContextMenu(items, e)}
            className="flex h-7 cursor-pointer items-center gap-2 rounded-sm border border-edge-mid bg-surface px-2.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-surface-hover"
        >
            <span>{label}</span>
            <ChevronDown size={12} className="flex-none text-muted" aria-hidden />
        </button>
    );
}

// One row of a pick-one list inside a card. The selected row is a grey fill with a check in the leading
// column; `dim` draws a choice that is not available in the muted tone, and `disabled` stops it being
// picked. Extra attributes (data-*) land on the button.
export function ChoiceRow({
    selected,
    dim,
    disabled,
    onPick,
    children,
    ...rest
}: {
    selected: boolean;
    dim?: boolean;
    disabled?: boolean;
    onPick: () => void;
    children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children" | "className" | "type" | "disabled">) {
    return (
        <button
            {...rest}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={onPick}
            className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 border-t border-edge-mid px-4 py-2.5 text-left transition-colors first:border-t-0 disabled:cursor-not-allowed",
                selected ? "bg-surface-selected" : "hover:bg-surface-hover disabled:hover:bg-transparent",
                dim ? "text-muted" : "text-primary"
            )}
        >
            <span className="flex w-4 flex-none">{selected ? <Check size={14} aria-hidden /> : null}</span>
            {children}
        </button>
    );
}
