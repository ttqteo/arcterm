// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    appendAttachments,
    attachmentBlocker,
    attachmentsFromPaths,
    classifyKind,
    isOversize,
    MAX_ATTACHMENT_BYTES,
    type Attachment,
} from "./composerattachments";

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
