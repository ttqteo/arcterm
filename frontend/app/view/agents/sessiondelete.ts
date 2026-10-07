// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Delete an ended session (docs/superpowers/specs/2026-10-07-session-delete-design.md): wavesrv moves a Claude
// session's transcript into ~/.arc/trash, where it is purged after 7 days. Whether a session offers it is the pure
// canDeleteSession; the confirm, the RPC and the archive reload are the rest of this file, shared by the sidebar row's
// menu, History's detail header and the command palette's session actions.

import { pushToast } from "@/app/cockpit/notificationstore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { loadSessionsArchive, type LiveSession } from "./sessionsarchivestore";

export const DELETE_SESSION_LABEL = "Xoá session";

const TASK_MAX = 80;

export type DeletableSession = Pick<LiveSession, "runtime" | "live" | "transcriptpath" | "task">;

// only an ended Claude session: pi and the other runtimes keep theirs, and a live one is still being written
export function canDeleteSession(s: Pick<LiveSession, "runtime" | "live" | "transcriptpath">): boolean {
    return s.runtime === "claude" && !s.live && s.transcriptpath !== "";
}

// the first prompt can run to paragraphs: one line, 80 characters
function taskLabel(task: string): string {
    const line = task.replace(/\s+/g, " ").trim();
    if (line === "") {
        return "(untitled session)";
    }
    return line.length > TASK_MAX ? `${line.slice(0, TASK_MAX).trimEnd()}…` : line;
}

export function deleteSessionMessage(task: string): string {
    return `Xoá session '${taskLabel(task)}'? Transcript được chuyển vào ~/.arc/trash và xoá hẳn sau 7 ngày; session sẽ không còn trong claude --resume.`;
}

// Move the session to the trash, then reload the archive so its row goes. The server refuses a session that is still
// running (or a path that is not a Claude transcript) and says why; that message is shown as it came. onDeleted runs
// once it is gone, for a view that was reading it.
export async function deleteSession(session: DeletableSession, onDeleted?: () => void): Promise<void> {
    if (!canDeleteSession(session)) {
        return;
    }
    try {
        await RpcApi.DeleteAgentSessionCommand(TabRpcClient, { transcriptpath: session.transcriptpath });
    } catch (e) {
        pushToast({
            title: "Không xoá được session",
            message: e instanceof Error ? e.message : String(e),
            level: "error",
        });
        return;
    }
    onDeleted?.();
    await loadSessionsArchive();
}

export function confirmDeleteSession(session: DeletableSession, onDeleted?: () => void): void {
    if (!canDeleteSession(session)) {
        return;
    }
    modalsModel.pushModal("ConfirmModal", {
        title: DELETE_SESSION_LABEL,
        message: deleteSessionMessage(session.task),
        confirmLabel: "Xoá",
        destructive: true,
        onConfirm: () => fireAndForget(() => deleteSession(session, onDeleted)),
    });
}
