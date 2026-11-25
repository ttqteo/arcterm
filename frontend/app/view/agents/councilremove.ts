// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Remove council: the tree row's menu asks it of an ended council (canRemoveCouncil); Close is the everyday action. Its own
// module so agentcenter.ts, which many tests import, stays free of the modal and the config store. It is also where the
// Library case is handled: councilstore.ts cannot import Library's store (librarystore.ts reaches councilstore through
// agentcenter.ts, so that would be a cycle), so a council removed while Library has it open is let go of here.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { libraryConvViewAtom, libraryCouncilSelAtom } from "../library/librarystore";
import { centerModeAtom, showProjectOverview, showTerminal } from "./agentcenter";
import { councilProjectName } from "./councilmodel";
import { councilSelAtom, councilViewAtom, deleteCouncil } from "./councilstore";
import { projectsAtom } from "./projectsstore";

/** Removes an ended council behind a confirm. When it is the one open in Agent's centre, the centre goes to its project's
 *  Overview, or back to the terminal when its folder is no registered project; when Conversations' council view has it open,
 *  Library goes back to the Conversations list (a council that is gone would otherwise sit on "Loading the council…"). A
 *  refusal (a council that started again meanwhile) is logged by the store. */
export function confirmRemoveCouncil(c: Pick<Council, "id" | "feature" | "project">): void {
    modalsModel.pushModal("ConfirmModal", {
        title: "Remove council",
        message: `Remove "${c.feature.trim() || "this council"}" and its discussion? Its file moves to ~/.arc/trash; a document it saved into the project stays. To only hide it, close it instead.`,
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: () => {
            const open =
                globalStore.get(centerModeAtom) === "council" &&
                globalStore.get(councilViewAtom) !== "setup" &&
                globalStore.get(councilSelAtom) === c.id;
            void deleteCouncil(c.id).then((r) => {
                if (!r.ok) {
                    return;
                }
                // the store lets go of Agent's selection itself (councilstore.ts); Library's is its own atom. The view is left
                // here and not through leaveLibraryDetail: that one also goes back over the jump that opened Library, and
                // this runs from the Agent tree, where a surface change is not wanted
                if (globalStore.get(libraryCouncilSelAtom) === c.id) {
                    globalStore.set(libraryCouncilSelAtom, null);
                    if (globalStore.get(libraryConvViewAtom) === "council") {
                        globalStore.set(libraryConvViewAtom, "list");
                    }
                }
                if (!open) {
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
