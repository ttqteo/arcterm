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
import { globalStore } from "@/app/store/jotaiStore";
import { localFileUrl } from "@/app/view/jarvis/localimage";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { createTempFileFromFile } from "@/app/view/term/termutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { fireAndForget, sleep } from "@/util/util";
import { nameScreenPaste, newScreenNumber, screenImageNumbers, takenPasteNumbers } from "./imagepasteids";
import { rejectionToast, THUMB_SOURCE_LIMIT_BYTES, UploadError, type Rejection } from "./uploadfile";
import {
    baseName,
    makeRecord,
    pastesAsIs,
    pasteTextFor,
    planInserts,
    recordUpload,
    updateUploads,
    uploadsAtom,
    type UploadKind,
} from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

// the gap pasteHandler leaves between pasted images: two pastes back to back can reach a TUI as one
const PASTE_GAP_MS = 150;
// how long an attached image's picture may take to read back; a file on a slow share must not hold up its record
const THUMB_FETCH_TIMEOUT_MS = 10_000;
const nonce = () => Math.random().toString(36).slice(2, 8);

// termwrap.ts's pasteHandler has already written the image to a temp file and pasted its path. `screenBefore` is the
// terminal's lines from just before the paste and `readScreen` reads them again, so the record takes the [Image #N]
// Claude Code draws in its prompt as soon as it shows; the transcript confirms it once the prompt is sent.
export function recordPastedImage(
    blockId: string,
    path: string,
    image: Blob,
    screenBefore: readonly string[],
    readScreen: () => string[]
): void {
    const now = Date.now();
    fireAndForget(async () => {
        const thumb = await makeThumbnail(image);
        const record = makeRecord({ path, source: "paste", now, nonce: nonce(), name: "Pasted image", kind: "image" });
        recordUpload(blockId, record, thumb);
        const n = await waitForScreenNumber(blockId, path, now, screenImageNumbers(screenBefore), readScreen);
        if (n != null) {
            updateUploads(blockId, (list) => nameScreenPaste(list, path, n));
        }
    });
}

// how long a paste's number may take to show in the prompt (a TUI that never numbers pastes, pi or a shell, ends here)
const SCREEN_WAIT_MS = 3000;
const SCREEN_POLL_MS = 150;
// a paste older than this holds no number a new one could be given (Claude Code numbers per session)
const TAKEN_WINDOW_MS = 10 * 60 * 1000;

async function waitForScreenNumber(
    blockId: string,
    path: string,
    pastedAt: number,
    before: ReadonlySet<number>,
    readScreen: () => string[]
): Promise<number | undefined> {
    for (let waited = 0; waited <= SCREEN_WAIT_MS; waited += SCREEN_POLL_MS) {
        const taken = takenPasteNumbers(globalStore.get(uploadsAtom(blockId)), path, pastedAt - TAKEN_WINDOW_MS);
        const n = newScreenNumber(before, screenImageNumbers(readScreen()), taken);
        if (n != null) {
            return n;
        }
        await sleep(SCREEN_POLL_MS);
    }
    return undefined;
}

// When the next paste may go in. Every paste takes the next free slot, PASTE_GAP_MS after the one before it, whichever
// call it belongs to, so two drops at once stay apart too. Module state: it carries across vitest tests.
let nextPasteAt = 0;

// Pastes text into the block's terminal at its slot; false when the terminal is not mounted or not ready for input
// (nothing was pasted).
async function deliver(blockId: string, text: string): Promise<boolean> {
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

// An attached image is the user's own file, so its picture is read back through wavesrv, the way the lightbox reads
// it (jarvis/localimage.ts). Best effort, like makeThumbnail: a file that is missing, too big or too slow gives null.
async function thumbnailForPath(path: string): Promise<string | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), THUMB_FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(localFileUrl(getWebServerEndpoint(), path), { signal: abort.signal });
        if (!resp.ok || Number(resp.headers.get("content-length") ?? 0) > THUMB_SOURCE_LIMIT_BYTES) {
            // the body is never read, so let go of it
            await resp.body?.cancel();
            return null;
        }
        return await makeThumbnail(await resp.blob());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function warnNotAttached(names: readonly string[]): void {
    pushToast({
        title: names.length === 1 ? `Couldn't attach “${names[0]}”` : `${names.length} files weren't attached`,
        message:
            names.length === 1
                ? "Its path can't be pasted into the terminal."
                : "Their paths can't be pasted into the terminal.",
        level: "warn",
    });
}

// Attach: the picked files keep their own paths, so there is no copy and no size cap. Same policy as ingestFiles: a
// file is recorded only once its path is in the terminal, and when the terminal cannot take a paste the rest of
// the files are left alone.
export async function attachPaths(blockId: string, paths: readonly string[]): Promise<void> {
    // a path with a control character would be pasted as a different file, so it is not attached
    const failed = paths.filter((path) => !pastesAsIs(path)).map(baseName);
    const plan = planInserts(
        paths.filter((path) => pastesAsIs(path)),
        "attach",
        Date.now(),
        nonce
    );
    let inserted = 0;
    let unreachable = false;
    for (const { record, text } of plan) {
        try {
            if (!(await deliver(blockId, text))) {
                unreachable = true;
                break;
            }
        } catch (err) {
            console.error("uploads: could not attach", record.path, err);
            failed.push(record.name);
            continue;
        }
        const thumb = record.kind === "image" ? await thumbnailForPath(record.path) : null;
        recordUpload(blockId, record, thumb);
        inserted++;
    }
    if (inserted > 0) {
        focusTerm(blockId);
    }
    if (failed.length > 0) {
        warnNotAttached(failed);
    }
    if (unreachable) {
        warnUnreachable();
    }
}

// True while the native file dialog is open, so a second click on Attach (the dialog takes a moment to appear) does
// not open another and paste the files twice. Module state, not component state: the section can unmount and
// remount while the dialog is up, and the button it comes back with must still know.
let picking = false;

// the Uploads section's Attach button: a native file picker, then each picked file's path pasted into the terminal
export async function pickAndAttach(blockId: string): Promise<void> {
    if (picking) {
        return;
    }
    picking = true;
    let paths: string[];
    try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked: string | string[] | null = await open({
            multiple: true,
            directory: false,
            title: "Attach files",
        });
        paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    } catch (err) {
        console.error("uploads: file picker failed", err);
        pushToast({ title: "Couldn't open the file picker", message: String(err), level: "error" });
        return;
    } finally {
        picking = false;
    }
    await attachPaths(blockId, paths);
}
