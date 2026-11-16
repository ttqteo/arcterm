// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { pushToast } from "@/app/cockpit/notificationstore";
import { invoke } from "@tauri-apps/api/core";

// Sidecar is a window of the Tauri host (sidecar.rs open_sidecar): built the first time, brought forward after. A refusal
// from the host is shown as a toast, never swallowed. One opener for every route to it: the palette's Open Sidecar row,
// the Cockpit header's Sidecar button and the Jarvis fold button's right-click menu.
export function openSidecar(): void {
    invoke("open_sidecar").catch((err: unknown) => {
        pushToast({ title: "Sidecar did not open", message: String(err), level: "error" });
    });
}
