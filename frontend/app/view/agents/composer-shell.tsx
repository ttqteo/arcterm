// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The shared composer frame used by the channel chat composer, the Runs new-run panel, and the inline
// steer composer, so the three read as one system. Owns the rounded card, the footer row, and the Send
// button. Callers either use the built-in auto-growing textarea (value/onChange/onSubmit) or pass a
// custom `inputRegion` (chat's mention-highlight backdrop + textarea) plus an `overlay` (chat's mention
// dropdown). Outer positioning/padding around the card belongs to the caller (bottom bar vs centered
// panel vs inline steer), so it is intentionally not owned here.
//
// Attachment props (onPaste/onDrop/onDragOver/onDragLeave/isDragging/attachments) are opt-in: callers
// that omit them render byte-for-byte as before. The Channels composer uses them for paste/attach/drop.

import {
    useLayoutEffect,
    useRef,
    type ClipboardEventHandler,
    type DragEventHandler,
    type KeyboardEvent,
    type ReactNode,
} from "react";

export function ComposerShell({
    onSubmit,
    value,
    onChange,
    placeholder,
    disabled,
    autoFocus,
    inputRegion,
    overlay,
    footerLeft,
    footerRight,
    sendLabel = "Send ⏎",
    sendDisabled,
    onPaste,
    onDrop,
    onDragOver,
    onDragLeave,
    isDragging,
    attachments,
}: {
    onSubmit: () => void;
    value?: string;
    onChange?: (next: string) => void;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    inputRegion?: ReactNode;
    overlay?: ReactNode;
    footerLeft?: ReactNode;
    footerRight?: ReactNode;
    sendLabel?: string;
    sendDisabled?: boolean;
    onPaste?: ClipboardEventHandler;
    onDrop?: DragEventHandler;
    onDragOver?: DragEventHandler;
    onDragLeave?: DragEventHandler;
    isDragging?: boolean;
    attachments?: ReactNode;
}) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    // grow the built-in textarea to fit its content (capped by max-h). Chat supplies its own inputRegion
    // and sizes itself via the highlight backdrop, so this only runs for the built-in path.
    useLayoutEffect(() => {
        const ta = taRef.current;
        if (ta && inputRegion == null) {
            ta.style.height = "0px";
            ta.style.height = `${ta.scrollHeight}px`;
        }
    }, [value, inputRegion]);
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
        }
    };
    return (
        <div data-pet-avoid className="relative">
            {overlay}
            <div
                className="relative rounded-lg border border-edge-mid bg-surface-raised px-[15px] py-3"
                onPaste={onPaste}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
            >
                {isDragging ? (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface-raised/80">
                        <span className="text-[12px] font-semibold text-accent-soft">Drop files to attach</span>
                    </div>
                ) : null}
                {attachments}
                <div className="relative">
                    {inputRegion ?? (
                        <textarea
                            ref={taRef}
                            value={value ?? ""}
                            onChange={(e) => onChange?.(e.target.value)}
                            onKeyDown={onKeyDown}
                            rows={1}
                            autoFocus={autoFocus}
                            placeholder={placeholder}
                            disabled={disabled}
                            className="max-h-[160px] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-[1.5] text-primary placeholder:text-muted focus:outline-none disabled:opacity-50"
                            style={{ caretColor: "var(--color-primary)" }}
                        />
                    )}
                </div>
                <div className="mt-2.5 flex items-center gap-2.5">
                    {footerLeft}
                    <div className="flex-1" />
                    {footerRight}
                    <button
                        type="button"
                        data-testid="composer-action"
                        onClick={onSubmit}
                        disabled={sendDisabled ?? disabled}
                        className="shrink-0 cursor-pointer rounded bg-accent px-[15px] py-1.5 text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:opacity-50"
                    >
                        {sendLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
