// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Tells you when a council ends, in the always-mounted shell since that can happen while any surface shows: a toast that
// opens its Summary (when Settings → In-app toasts is on), and an unread dot on its row in the Agent tree
// (councilUnreadAtom, whatever that setting says). Nothing for a council you are looking at, nor for those already done
// when the list first loads. councilnotify.ts decides what is said.

import { pushToast } from "@/app/cockpit/notificationstore";
import { getSettingsKeyAtom } from "@/app/store/global";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { centerModeAtom, showCouncil } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { endedNotice, markRead, markUnread, noticeRoute, viewingCouncil } from "./councilnotify";
import { councilSelAtom, councilUnreadAtom, councilViewAtom, useCouncils } from "./councilstore";

export function CouncilNotifySync({ model }: { model: AgentsViewModel }): null {
    const councils = useCouncils("");
    const surface = useAtomValue(model.surfaceAtom);
    const center = useAtomValue(centerModeAtom);
    const view = useAtomValue(councilViewAtom);
    const selected = useAtomValue(councilSelAtom);
    const [unread, setUnread] = useAtom(councilUnreadAtom);

    // the shown view at the moment of a change, through a ref so the list effect below runs on the list alone
    const toastsOn = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const shown = useRef({ surface, center, view, selected, toastsOn });
    shown.current = { surface, center, view, selected, toastsOn };

    // the last record of each council; null until the first list has loaded, which is only recorded
    const prev = useRef<Map<string, Council> | null>(null);
    useEffect(() => {
        if (councils == null) {
            return;
        }
        const before = prev.current;
        prev.current = new Map(councils.map((c) => [c.id, c]));
        if (before == null) {
            return;
        }
        for (const next of councils) {
            const at = shown.current;
            const notice = endedNotice(
                before.get(next.id),
                next,
                viewingCouncil(at.surface, at.center, at.view, at.selected, next.id)
            );
            const route = noticeRoute(notice, at.toastsOn);
            if (notice == null) {
                continue;
            }
            if (route.unread) {
                setUnread((set) => markUnread(set, next.id));
            }
            if (route.toast) {
                pushToast({
                    title: notice.title,
                    message: notice.body,
                    level: next.state === "failed" ? "error" : "info",
                    onOpen: () => showCouncil(next.id, "summary", model),
                });
            }
        }
    }, [councils]);

    // a council in view is read, whichever of its views shows
    useEffect(() => {
        if (selected != null && viewingCouncil(surface, center, view, selected, selected)) {
            setUnread((set) => markRead(set, selected));
        }
    }, [surface, center, view, selected, unread]);
    return null;
}
