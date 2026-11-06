// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Starts the lobby tree's feed and announces its milestones (spec "A milestone reached"): while the Christmas decor
// shows and the season runs, a milestone above the highest announced one is announced with one toast and stored, so a
// gap (the app closed, the theme off) names only the highest. Clicking the toast opens the Office at the tree. Mounted
// once in cockpit-root.tsx; draws nothing.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { useChristmasDecor } from "./christmasstore";
import { cockpitViewAtom, officeFloorAtom } from "./officestore";
import { milestoneTitle, milestoneToAnnounce } from "./xmastreemodel";
import { ensureXmasTreeFeed, readAnnounced, writeAnnounced, xmasTreeAtom, xmasTreeGoAtom } from "./xmastreestore";

/** Opens the Cockpit's Office on the ground floor and walks the boss to the tree. */
function goToTree(model: AgentsViewModel): void {
    globalStore.set(model.surfaceAtom, "cockpit");
    globalStore.set(cockpitViewAtom, "office");
    globalStore.set(officeFloorAtom, 0);
    globalStore.set(xmasTreeGoAtom, (n) => n + 1);
}

export function XmasTreeNotifier({ model }: { model: AgentsViewModel }) {
    useEffect(() => ensureXmasTreeFeed(), []);
    const decorOn = useChristmasDecor();
    const view = useAtomValue(xmasTreeAtom);
    useEffect(() => {
        if (!decorOn || view == null || view.phase !== "season") return;
        const m = milestoneToAnnounce(view.milestone, readAnnounced(view.season));
        if (m == null) return;
        writeAnnounced(view.season, m);
        pushToast({
            level: "info",
            title: milestoneTitle(m),
            message: `${view.count.toLocaleString("en-US")} tasks finished this season`,
            onOpen: () => goToTree(model),
        });
    }, [decorOn, view, model]);
    return null;
}
