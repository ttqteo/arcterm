// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Keyboard navigation of the Usage surface's By work lens: where Escape goes Back to, and the one cursor
// order over the scope cards and the shown list rows.

import { ALL_SCOPE } from "./usageattribution";
import type { UsageLens, UsageWorkItem } from "./usagestore";

export interface UsageBackTarget {
    scope: string;
    item: null;
}

// An item goes Back to the scope it was opened from; a project or initiative scope goes to All usage. Null
// where By work has nowhere to go Back to, so Escape leaves the surface.
export function usageBackStep(lens: UsageLens, scopeKey: string, item: UsageWorkItem | null): UsageBackTarget | null {
    if (lens !== "work") {
        return null;
    }
    if (item != null) {
        return { scope: item.back, item: null };
    }
    return scopeKey !== ALL_SCOPE ? { scope: ALL_SCOPE, item: null } : null;
}

// scope keys ("all", project paths, `effort:<oid>`) and row keys (`run:` / `session:`) never collide
export function usageNavIds(scopeIds: string[], rowKeys: string[]): string[] {
    return [...scopeIds, ...rowKeys];
}

export type UsageCursor = { kind: "scope" | "row"; id: string };

export function resolveUsageCursor(id: string, scopeIds: string[]): UsageCursor {
    return { kind: scopeIds.includes(id) ? "scope" : "row", id };
}
