// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAgentSessionCommand = vi.fn();
const loadSessionsArchive = vi.fn();
const pushModal = vi.fn();
const pushToast = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { DeleteAgentSessionCommand: (...args: any[]) => deleteAgentSessionCommand(...args) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: { id: "client" } }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: { pushModal: (...args: any[]) => pushModal(...args) } }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...args: any[]) => pushToast(...args) }));
vi.mock("./sessionsarchivestore", () => ({ loadSessionsArchive: (...args: any[]) => loadSessionsArchive(...args) }));

import {
    canDeleteSession,
    confirmDeleteSession,
    DELETE_SESSION_LABEL,
    deleteSession,
    deleteSessionMessage,
    type DeletableSession,
} from "./sessiondelete";

const session = (over: Partial<DeletableSession> = {}): DeletableSession => ({
    runtime: "claude",
    live: false,
    transcriptpath: "/home/u/.claude/projects/p/abc.jsonl",
    task: "fix the build",
    ...over,
});

beforeEach(() => {
    deleteAgentSessionCommand.mockReset();
    loadSessionsArchive.mockReset();
    pushModal.mockReset();
    pushToast.mockReset();
});

describe("canDeleteSession", () => {
    it("is true for an ended Claude session", () => {
        expect(canDeleteSession(session())).toBe(true);
    });
    it("is false for a session that is live", () => {
        expect(canDeleteSession(session({ live: true }))).toBe(false);
    });
    it("is false for pi and every other runtime", () => {
        expect(canDeleteSession(session({ runtime: "pi" }))).toBe(false);
        expect(canDeleteSession(session({ runtime: "codex" }))).toBe(false);
        expect(canDeleteSession(session({ runtime: "opencode" }))).toBe(false);
    });
    it("is false when there is no transcript to move", () => {
        expect(canDeleteSession(session({ transcriptpath: "" }))).toBe(false);
    });
});

describe("deleteSessionMessage", () => {
    it("names the session and says where it goes and for how long", () => {
        expect(deleteSessionMessage("fix the build")).toBe(
            "Xoá session 'fix the build'? Transcript được chuyển vào ~/.arc/trash và xoá hẳn sau 7 ngày; session sẽ không còn trong claude --resume."
        );
    });
    it("names an untitled session, and keeps a long or multi-line prompt to one line", () => {
        expect(deleteSessionMessage("")).toContain("'(untitled session)'");
        const msg = deleteSessionMessage(`first line\n\n  second   line ${"x".repeat(200)}`);
        expect(msg).toContain("'first line second line ");
        expect(msg).toContain("…'?");
        expect(msg).not.toContain("\n");
        expect(msg.length).toBeLessThan(300);
    });
});

describe("confirmDeleteSession", () => {
    it("opens a destructive ConfirmModal and deletes nothing until it is confirmed", () => {
        confirmDeleteSession(session());
        expect(pushModal).toHaveBeenCalledTimes(1);
        const [name, props] = pushModal.mock.calls[0];
        expect(name).toBe("ConfirmModal");
        expect(props.title).toBe(DELETE_SESSION_LABEL);
        expect(props.message).toBe(deleteSessionMessage("fix the build"));
        expect(props.destructive).toBe(true);
        expect(deleteAgentSessionCommand).not.toHaveBeenCalled();
    });
    it("deletes the transcript and reloads the archive on confirm", async () => {
        deleteAgentSessionCommand.mockResolvedValue(undefined);
        const onDeleted = vi.fn();
        confirmDeleteSession(session(), onDeleted);
        pushModal.mock.calls[0][1].onConfirm();
        await vi.waitFor(() => expect(onDeleted).toHaveBeenCalled());
        expect(deleteAgentSessionCommand).toHaveBeenCalledWith(
            { id: "client" },
            { transcriptpath: "/home/u/.claude/projects/p/abc.jsonl" }
        );
        expect(loadSessionsArchive).toHaveBeenCalledTimes(1);
    });
});

describe("deleteSession", () => {
    it("shows the server's refusal and leaves the archive alone", async () => {
        deleteAgentSessionCommand.mockRejectedValue(new Error("that session is still running: stop it first"));
        const onDeleted = vi.fn();
        await deleteSession(session(), onDeleted);
        expect(pushToast).toHaveBeenCalledTimes(1);
        const toast = pushToast.mock.calls[0][0];
        expect(toast.level).toBe("error");
        expect(toast.message).toBe("that session is still running: stop it first");
        expect(loadSessionsArchive).not.toHaveBeenCalled();
        expect(onDeleted).not.toHaveBeenCalled();
    });
    it("does not call the server for a session it should not delete", async () => {
        await deleteSession(session({ runtime: "pi" }));
        expect(deleteAgentSessionCommand).not.toHaveBeenCalled();
    });
});
