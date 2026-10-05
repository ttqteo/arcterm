// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Getting a file in front of an agent: an image pasted into its terminal (termwrap.ts calls recordPastedImage),
// files dropped on its terminal (focus-pane.tsx calls ingestFiles) and files picked with the Uploads section's
// Attach (pickAndAttach). Each way ends the same: the path goes into the terminal as a paste with no Enter, one
// paste per file so the TUI reads each as its own (Claude Code turns a lone image path into an attachment and
// leaves several in one paste as plain text), and the file is recorded in uploadsstore. Impure glue; the rules
// worth testing live in uploadfile.ts and uploadsstore.ts.

import { fireAndForget } from "@/util/util";
import { makeRecord, recordUpload } from "./uploadsstore";
import { makeThumbnail } from "./uploadthumb";

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
