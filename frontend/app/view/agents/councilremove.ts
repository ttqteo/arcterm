// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Remove council: the tree row's menu and the Discussion header ask it of an ended council (canRemoveCouncil). Its own
// module so agentcenter.ts, which many tests import, stays free of the modal and the config store.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { centerModeAtom, showProjectOverview, showTerminal } from "./agentcenter";
import { councilProjectName } from "./councilmodel";
import { councilSelAtom, councilViewAtom, deleteCouncil } from "./councilstore";
import { projectsAtom } from "./projectsstore";

/** Removes an ended council behind a confirm. When it is the one open, the centre goes to its project's Overview, or
 *  back to the terminal when its folder is no registered project. A refusal (a council that started again meanwhile)
 *  is logged by the store. */
export function confirmRemoveCouncil(c: Pick<Council, "id" | "feature" | "project">): void {
    modalsModel.pushModal("ConfirmModal", {
        title: "Remove council",
        message: `Remove "${c.feature.trim() || "this council"}" and its discussion? A document it saved into the project stays.`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: () => {
            const open =
                globalStore.get(centerModeAtom) === "council" &&
                globalStore.get(councilViewAtom) !== "setup" &&
                globalStore.get(councilSelAtom) === c.id;
            void deleteCouncil(c.id).then((r) => {
                if (!r.ok || !open) {
                    return;
                }
                const project = councilProjectName(globalStore.get(projectsAtom), c.project);
                if (project != null) {
                    showProjectOverview(project);
                } else {
                    showTerminal();
                }
            });
        },
    });
}
