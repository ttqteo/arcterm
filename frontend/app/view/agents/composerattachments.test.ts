// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    appendAttachments,
    attachmentBlocker,
    attachmentsFromPaths,
    classifyKind,
    clearDraftAttachments,
    composeLaunchTask,
    draftAttachments,
    FILES_HEADER,
    isOversize,
    MAX_ATTACHMENT_BYTES,
    messageWithAttachments,
    patchDraftAttachment,
    readyPaths,
    setDraftAttachments,
    type Attachment,
} from "./composerattachments";
import { splitAttachedImages } from "./launcherimages";
import { MAX_UPLOAD_BYTES } from "./uploadfile";

function att(over: Partial<Attachment>): Attachment {
    return { id: "1", name: "f", kind: "file", status: "ready", size: 1, path: "/tmp/f", ...over };
}

describe("appendAttachments", () => {
    it("returns text unchanged when there are no attachments", () => {
        expect(appendAttachments("hello", [])).toBe("hello");
    });
    it("skips non-ready attachments", () => {
        const atts = [
            att({ status: "uploading", path: undefined }),
            att({ id: "2", status: "error", path: undefined }),
        ];
        expect(appendAttachments("hello", atts)).toBe("hello");
    });
    it("appends a trailing block listing ready attachment paths", () => {
        const atts = [att({ path: "C:\\a\\shot.png" }), att({ id: "2", path: "C:\\a\\err.log" })];
        expect(appendAttachments("fix it", atts)).toBe(
            "fix it\n\nAttachments (read these files):\n- C:\\a\\shot.png\n- C:\\a\\err.log"
        );
    });
    it("preserves a leading @-command token", () => {
        const out = appendAttachments("@run fix it", [att({ path: "C:\\a\\shot.png" })]);
        expect(out.startsWith("@run fix it")).toBe(true);
        expect(out).toContain("- C:\\a\\shot.png");
    });
    it("returns just the block when the base text is blank", () => {
        expect(appendAttachments("   ", [att({ path: "C:\\a\\x.png" })])).toBe(
            "Attachments (read these files):\n- C:\\a\\x.png"
        );
    });
});

describe("messageWithAttachments", () => {
    it("returns the text alone when nothing is ready", () => {
        expect(messageWithAttachments("hi", [att({ status: "uploading", path: undefined })])).toBe("hi");
    });
    it("puts images last as the Attached images block, which a bubble reads back as pictures", () => {
        const out = messageWithAttachments("look", [
            att({ id: "1", kind: "image", path: "/a/shot.png" }),
            att({ id: "2", path: "/a/err.log" }),
        ]);
        expect(out).toBe("look\n\nAttachments (read these files):\n- /a/err.log\n\nAttached images:\n- /a/shot.png");
        expect(splitAttachedImages(out)).toEqual({
            text: "look\n\nAttachments (read these files):\n- /a/err.log",
            paths: ["/a/shot.png"],
        });
    });
    it("sends images alone as just their block", () => {
        expect(messageWithAttachments("", [att({ kind: "image", path: "/a/x.png" })])).toBe(
            "Attached images:\n- /a/x.png"
        );
    });
    it("keeps files that are not images in the read-these-files block", () => {
        expect(messageWithAttachments("fix", [att({ path: "/a/err.log" })])).toBe(
            "fix\n\nAttachments (read these files):\n- /a/err.log"
        );
    });
});

describe("classifyKind", () => {
    it("classifies by image mime type", () => {
        expect(classifyKind({ name: "x", type: "image/png" })).toBe("image");
    });
    it("classifies by extension when mime is empty", () => {
        expect(classifyKind({ name: "shot.JPG", type: "" })).toBe("image");
    });
    it("classifies non-images as file", () => {
        expect(classifyKind({ name: "error.log", type: "text/plain" })).toBe("file");
    });
});

describe("isOversize", () => {
    it("allows a file exactly at the cap", () => {
        expect(isOversize(MAX_ATTACHMENT_BYTES)).toBe(false);
    });
    it("rejects a file one byte over the cap", () => {
        expect(isOversize(MAX_ATTACHMENT_BYTES + 1)).toBe(true);
    });
    it("is the 3.5 MB one websocket message carries, the same cap as createTempFileFromBlob", () => {
        expect(isOversize(3.5 * 1024 * 1024)).toBe(false);
        expect(isOversize(3.5 * 1024 * 1024 + 1)).toBe(true);
        expect(MAX_ATTACHMENT_BYTES).toBe(MAX_UPLOAD_BYTES);
    });
});

describe("attachmentsFromPaths", () => {
    it("makes a ready chip per picked path, referenced in place and named by its basename", () => {
        const out = attachmentsFromPaths(["C:\\work\\shot.PNG", "/home/me/notes.txt"], []);
        expect(out.map(({ name, kind, status, path, size }) => ({ name, kind, status, path, size }))).toEqual([
            { name: "shot.PNG", kind: "image", status: "ready", path: "C:\\work\\shot.PNG", size: undefined },
            { name: "notes.txt", kind: "file", status: "ready", path: "/home/me/notes.txt", size: undefined },
        ]);
        expect(new Set(out.map((a) => a.id)).size).toBe(2);
    });
    it("skips a path already attached and a repeat within the pick", () => {
        const out = attachmentsFromPaths(
            ["C:\\a\\x.log", "C:\\a\\y.log", "C:\\a\\y.log"],
            [att({ path: "C:\\a\\x.log" })]
        );
        expect(out.map((a) => a.path)).toEqual(["C:\\a\\y.log"]);
    });
    it("lands in the goal's attachment block", () => {
        expect(appendAttachments("fix it", attachmentsFromPaths(["C:\\a\\err.log"], []))).toBe(
            "fix it\n\nAttachments (read these files):\n- C:\\a\\err.log"
        );
    });
});

describe("attachmentBlocker", () => {
    it("lets a launch go when every attachment is ready, or there are none", () => {
        expect(attachmentBlocker([])).toBeNull();
        expect(attachmentBlocker([att({})])).toBeNull();
    });
    it("holds the launch while an upload is in flight", () => {
        expect(attachmentBlocker([att({}), att({ id: "2", status: "uploading", path: undefined })])).toBe("Attaching…");
    });
    it("holds the launch on a failed attachment, which the goal would otherwise drop", () => {
        expect(attachmentBlocker([att({ status: "error", path: undefined })])).toBe(
            "Retry or remove the failed attachment"
        );
    });
});

describe("readyPaths", () => {
    it("splits the ready ones into images and other files, leaving out uploads in flight and failures", () => {
        expect(
            readyPaths([
                att({ id: "1", kind: "image", path: "/k/a.png" }),
                att({ id: "2", path: "/k/notes.md" }),
                att({ id: "3", kind: "image", status: "uploading", path: undefined }),
                att({ id: "4", status: "error", path: undefined }),
            ])
        ).toEqual({ images: ["/k/a.png"], files: ["/k/notes.md"] });
    });
});

describe("composeLaunchTask", () => {
    it("puts the files block under the task and the images block last", () => {
        const got = composeLaunchTask("claude", " fix it ", ["/k/a.png"], ["/k/notes.md"], false);
        expect(got.extraArgs).toEqual([]);
        expect(got.task).toBe(`fix it\n\n${FILES_HEADER}\n- /k/notes.md\n\nAttached images:\n- /k/a.png`);
        // the bubble still draws the images: their block is the prompt's last lines
        expect(splitAttachedImages(got.task).paths).toEqual(["/k/a.png"]);
    });
    it("gives codex starting fresh its images as --image, the files staying in the prompt", () => {
        const got = composeLaunchTask("codex", "look", ["/k/a.png"], ["/k/notes.md"], false);
        expect(got.extraArgs).toEqual(["--image", "/k/a.png"]);
        expect(got.task).toBe(`look\n\n${FILES_HEADER}\n- /k/notes.md`);
    });
    it("leaves a task with nothing attached as typed, trimmed", () => {
        expect(composeLaunchTask("claude", " hi ", [], [], false)).toEqual({ task: "hi", extraArgs: [] });
    });
});

describe("a box's draft read from outside it", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    afterEach(() => {
        clearDraftAttachments("k");
        revoke.mockClear();
    });
    it("is set, patched and read by key", () => {
        setDraftAttachments("k", [att({ id: "a", kind: "image", path: "/k/a.png" })]);
        patchDraftAttachment("k", "a", { previewUrl: "blob:a" });
        expect(draftAttachments("k")).toEqual([
            att({ id: "a", kind: "image", path: "/k/a.png", previewUrl: "blob:a" }),
        ]);
        expect(draftAttachments("other")).toEqual([]);
    });
    it("leaves a chip removed meanwhile gone when a late patch lands", () => {
        setDraftAttachments("k", [att({ id: "a" })]);
        clearDraftAttachments("k");
        patchDraftAttachment("k", "a", { previewUrl: "blob:a" });
        expect(draftAttachments("k")).toEqual([]);
    });
    it("frees the previews of what it held when cleared or replaced", () => {
        setDraftAttachments("k", [att({ id: "a", previewUrl: "blob:a" })]);
        setDraftAttachments("k", [att({ id: "b", previewUrl: "blob:b" })]);
        expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a"]);
        clearDraftAttachments("k");
        expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a", "blob:b"]);
    });
});
