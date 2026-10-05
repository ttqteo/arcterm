// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Getting a file in front of an agent: an image pasted into its terminal (termwrap.ts calls recordPastedImage),
// files dropped on its terminal (focus-pane.tsx calls ingestFiles) and files picked with the Uploads section's
// Attach (pickAndAttach). Each way ends the same: the path goes into the terminal as a paste with no Enter, one
// paste per file so the TUI reads each as its own (Claude Code turns a lone image path into an attachment and
// leaves several in one paste as plain text), and the file is recorded in uploadsstore. Impure glue; the rules
// worth testing live in uploadfile.ts and uploadsstore.ts.

import { pushToast } from "@/app/cockpit/notificationstore";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { createTempFileFromFile } from "@/app/view/term/termutil";
import { fireAndForget, sleep } from "@/util/util";
import { rejectionToast, UploadError, type Rejection } from "./uploadfile";
import { makeRecord, pastesAsIs, pasteTextFor, recordUpload, type UploadKind } from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

// the gap pasteHandler leaves between pasted images: two pastes back to back can reach a TUI as one
const PASTE_GAP_MS = 150;
const nonce = () => Math.random().toString(36).slice(2, 8);

// termwrap.ts's pasteHandler has already written the image to a temp file and pasted its path
export function recordPastedImage(blockId: string, path: string, image: Blob): void {
    const now = Date.now();
    fireAndForget(async () => {
        const thumb = await makeThumbnail(image);
        const record = makeRecord({ path, source: "paste", now, nonce: nonce(), name: "Pasted image", kind: "image" });
        recordUpload(blockId, record, thumb);
    });
}

// When the next paste may go in. Every paste takes the next free slot, PASTE_GAP_MS after the one before it, whichever
// call it belongs to, so two drops at once stay apart too. Module state: it carries across vitest tests.
let nextPasteAt = 0;

// Pastes text into the block's terminal at its slot; false when the terminal is not mounted or not ready for input
// (nothing was pasted).
export async function deliver(blockId: string, text: string): Promise<boolean> {
    const now = Date.now();
    const at = Math.max(now, nextPasteAt);
    nextPasteAt = at + PASTE_GAP_MS; // reserved before the first await, so a concurrent caller sees it
    if (at > now) {
        await sleep(at - now);
    }
    return pasteIntoTerm(blockId, text);
}

function warnUnreachable(): void {
    pushToast({
        title: "No terminal to insert into",
        message: "This agent's terminal is not open or not ready for input. Try again in a moment.",
        level: "warn",
    });
}

// Files dropped on a terminal arrive as blobs with no path (the window's native drop is off so the grid's HTML5
// drag works): each is copied to a temp file and its path pasted. What could not be taken (a folder, a file over
// the cap, a failed copy) comes back as one toast. A file is recorded only once its path is in the terminal; when
// the terminal cannot take a paste the rest of the drop is left alone.
export async function ingestFiles(
    blockId: string,
    files: readonly File[],
    rejected: readonly Rejection[]
): Promise<void> {
    const failed: Rejection[] = [...rejected];
    let inserted = 0;
    let unreachable = false;
    for (const file of files) {
        try {
            const path = await createTempFileFromFile(file);
            // a path with a control character would be pasted as a different file, so it is not added
            if (!pastesAsIs(path)) {
                throw new UploadError("error", file.name);
            }
            const kind: UploadKind | undefined = file.type.startsWith("image/") ? "image" : undefined;
            const record = makeRecord({ path, source: "drop", now: Date.now(), nonce: nonce(), kind });
            if (!(await deliver(blockId, pasteTextFor(path)))) {
                unreachable = true;
                break;
            }
            const thumb = record.kind === "image" ? await makeThumbnail(file) : null;
            recordUpload(blockId, record, thumb);
            inserted++;
        } catch (err) {
            failed.push({ name: file.name, code: err instanceof UploadError ? err.code : "error" });
            if (!(err instanceof UploadError)) {
                console.error("uploads: could not add", file.name, err);
            }
        }
    }
    if (inserted > 0) {
        focusTerm(blockId);
    }
    const toast = rejectionToast(failed);
    if (toast != null) {
        pushToast({ ...toast, level: "warn" });
    }
    if (unreachable) {
        warnUnreachable();
    }
}
