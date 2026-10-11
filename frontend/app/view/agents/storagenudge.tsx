// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The once-a-day toast when more than storage:nudgegb GB can be cleaned. Lives in the cockpit shell, since a scan
// can finish while any surface shows; its click opens Settings → Storage.

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { openSettingsSection } from "./settingsstore";
import {
    cleanableTotal,
    dayKey,
    DEFAULT_NUDGE_GB,
    DEFAULT_SESSION_DAYS,
    formatSize,
    shouldNudge,
} from "./storagemodel";
import { useStorageReport } from "./storagestore";

// per-viewer convenience: losing it only means one more nudge that day
const NUDGE_DAY_KEY = "storage.nudge.lastday";

function readLastDay(): string | null {
    try {
        return localStorage.getItem(NUDGE_DAY_KEY);
    } catch {
        return null;
    }
}

function writeLastDay(day: string): void {
    try {
        localStorage.setItem(NUDGE_DAY_KEY, day);
    } catch {
        // storage blocked: the nudge may repeat today
    }
}

export function StorageNudge({ model }: { model: AgentsViewModel }): null {
    const report = useStorageReport();
    const nudgeGb = (useAtomValue(getSettingsKeyAtom("storage:nudgegb")) as number | undefined) ?? DEFAULT_NUDGE_GB;
    useEffect(() => {
        if (report == null || !report.scannedts || report.scanning) {
            return;
        }
        const now = Date.now();
        const total = cleanableTotal(report, DEFAULT_SESSION_DAYS, now);
        const today = dayKey(now);
        if (!shouldNudge(total, nudgeGb, readLastDay(), today)) {
            return;
        }
        writeLastDay(today);
        pushToast({
            title: "Storage",
            message: `${formatSize(total)} can be cleaned`,
            level: "info",
            onOpen: () => openSettingsSection(model, "storage"),
        });
    }, [report, nudgeGb, model]);
    return null;
}
