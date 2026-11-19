// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Open in Claude Desktop: Claude Desktop's resume link takes one CLI session into its Code tab (it imports the session
// when it does not hold it yet), as `claude --desktop --resume <id>` does. Only an ended Claude session offers it: a
// live one is still being written by its terminal, and Desktop's own import skips a running session too. The host
// opens no other claude: link (src-tauri/src/commands.rs).

import type { LiveSession } from "./sessionsarchivestore";

export const OPEN_IN_DESKTOP_LABEL = "Open in Claude Desktop";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link that opens s in Claude Desktop, or null when s does not offer it. */
export function claudeDesktopLink(s: Pick<LiveSession, "runtime" | "live" | "id">): string | null {
    if (s.runtime !== "claude" || s.live || !SESSION_ID.test(s.id ?? "")) {
        return null;
    }
    return `claude://resume?session=${s.id}`;
}
