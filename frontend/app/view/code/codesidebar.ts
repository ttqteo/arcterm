// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure geometry and persistence rules for the Code sidebar. The component owns DOM events; this
// module keeps bounds and external values deterministic and testable.

export const CODE_SIDEBAR_MIN_WIDTH = 200;
export const CODE_SIDEBAR_MAX_WIDTH = 480;
export const CODE_SIDEBAR_EDITOR_FLOOR = 280;
export const CODE_SIDEBAR_COMPACT_WIDTH = 36;
export const CODE_SIDEBAR_SEPARATOR_WIDTH = 8;

// One width for every mode, so switching between Files, Search and Changed never moves the editor's edge.
export const CODE_SIDEBAR_DEFAULT_WIDTH = 280;

export type CodeSidebarMode = "files" | "search" | "changed";

export type CodeSidebarPrefs = {
    width: number;
    open: boolean;
};

export type CodeSidebarVisibility = {
    temporary: boolean;
    compact: boolean;
};

export function defaultCodeSidebarPrefs(): CodeSidebarPrefs {
    return { width: CODE_SIDEBAR_DEFAULT_WIDTH, open: true };
}

export function clampCodeSidebarWidth(value: number, max = CODE_SIDEBAR_MAX_WIDTH): number {
    const safeMax = Math.max(CODE_SIDEBAR_MIN_WIDTH, Math.min(CODE_SIDEBAR_MAX_WIDTH, max));
    return Number.isFinite(value) ? Math.min(safeMax, Math.max(CODE_SIDEBAR_MIN_WIDTH, value)) : CODE_SIDEBAR_MIN_WIDTH;
}

export function codeSidebarMaxWidth(workspaceWidth: number): number {
    if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
        return CODE_SIDEBAR_MAX_WIDTH;
    }
    return Math.max(
        CODE_SIDEBAR_MIN_WIDTH,
        Math.min(CODE_SIDEBAR_MAX_WIDTH, workspaceWidth - CODE_SIDEBAR_EDITOR_FLOOR - CODE_SIDEBAR_SEPARATOR_WIDTH)
    );
}

export function codeSidebarVisibility(workspaceWidth: number, open: boolean): CodeSidebarVisibility {
    const temporary =
        workspaceWidth > 0 &&
        workspaceWidth < CODE_SIDEBAR_MIN_WIDTH + CODE_SIDEBAR_EDITOR_FLOOR + CODE_SIDEBAR_SEPARATOR_WIDTH;
    return { temporary, compact: temporary || !open };
}

export function codeSidebarWidthFor(width: number, workspaceWidth: number): number {
    return clampCodeSidebarWidth(width, codeSidebarMaxWidth(workspaceWidth));
}

export function codeSidebarWidthAfterPointer(start: number, deltaX: number, max: number): number {
    return clampCodeSidebarWidth(start + deltaX, max);
}

export function codeSidebarDragWidthForWorkspace(width: number, workspaceWidth: number): number {
    return clampCodeSidebarWidth(width, codeSidebarMaxWidth(workspaceWidth));
}

export function codeSidebarDragEndWidth(width: number, workspaceWidth: number, commit: boolean): number | null {
    return commit ? codeSidebarDragWidthForWorkspace(width, workspaceWidth) : null;
}

export function nextCodeSidebarWidth(
    current: number,
    key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
    shiftKey: boolean,
    max: number
): number {
    if (key === "Home") {
        return CODE_SIDEBAR_MIN_WIDTH;
    }
    if (key === "End") {
        return clampCodeSidebarWidth(max, max);
    }
    const step = shiftKey ? 40 : 16;
    const delta = key === "ArrowRight" ? step : -step;
    return clampCodeSidebarWidth(current + delta, max);
}

function validWidth(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? clampCodeSidebarWidth(value) : fallback;
}

export function parseCodeSidebarPrefs(raw: string | null): CodeSidebarPrefs {
    const defaults = defaultCodeSidebarPrefs();
    if (raw == null) {
        return defaults;
    }
    try {
        const value: unknown = JSON.parse(raw);
        if (value == null || typeof value !== "object" || Array.isArray(value)) {
            return defaults;
        }
        const record = value as { width?: unknown; widths?: unknown; open?: unknown };
        // Prefs saved before the width was shared kept one per mode; the Files width carries over.
        const legacy = record.widths;
        const legacyFiles =
            legacy != null && typeof legacy === "object" && !Array.isArray(legacy)
                ? (legacy as { files?: unknown }).files
                : undefined;
        return {
            width: validWidth(record.width, validWidth(legacyFiles, defaults.width)),
            open: typeof record.open === "boolean" ? record.open : defaults.open,
        };
    } catch {
        return defaults;
    }
}

export function codeSidebarPrefsJson(prefs: CodeSidebarPrefs): string {
    return JSON.stringify({
        width: clampCodeSidebarWidth(prefs.width),
        open: prefs.open,
    });
}
