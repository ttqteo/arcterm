// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The inline "type a name" row of a file tree, shared by the Code tree and the Agent panel's Files tree: Enter commits,
// Escape or a blur cancels, and the error shows while you type. The pre-check reads the tree's listing, so it can be
// wrong, which is why the write still surfaces the backend's error.

import { useState } from "react";
import { nameErrorMessage, validateName } from "./codemutate";

export function NameInput({
    initial,
    dir,
    depth,
    existing,
    onCommit,
    onCancel,
}: {
    initial: string;
    dir: string;
    depth: number;
    existing: readonly string[];
    onCommit: (name: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    // an unchanged rename is not an error, but an empty create is — so the skip only applies to a
    // name that is both non-empty and untouched
    const trimmed = value.trim();
    const err = trimmed !== "" && trimmed === initial ? null : validateName(value, dir, existing);
    return (
        <div style={{ paddingLeft: 8 + depth * 12 }} className="flex w-full items-center gap-1.5 py-[3px] pr-2">
            <input
                autoFocus
                value={value}
                data-code-name-input
                onChange={(e) => setValue(e.target.value)}
                onBlur={onCancel}
                onKeyDown={(e) => {
                    e.stopPropagation(); // the tree's own keys (j/k, n, the arrows) must not eat what you type
                    if (e.key === "Escape") {
                        onCancel();
                    }
                    if (e.key === "Enter" && err == null) {
                        onCommit(trimmed);
                    }
                }}
                className="min-w-0 flex-1 select-text rounded-[4px] border border-border bg-surface px-1 py-[1px] text-[12px] text-primary outline-none"
            />
            {err != null ? (
                <span title={nameErrorMessage(err)} className="flex-none text-[10px] text-error">
                    {nameErrorMessage(err)}
                </span>
            ) : null}
        </div>
    );
}
