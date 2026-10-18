// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// pathactions.ts's items as context menu items: Copy Relative Path, Copy Absolute Path, Reveal in Finder.

import { getApi } from "@/app/store/global";
import { Copy, FolderOpen } from "lucide-react";
import { pathActions } from "./pathactions";

export function pathMenuItems(abs: string, rel: string | null): ContextMenuItem[] {
    return pathActions(abs, rel, getApi().getPlatform()).map((a) =>
        a.kind === "copy"
            ? {
                  label: a.label,
                  icon: <Copy size={13} strokeWidth={1.8} />,
                  click: () => void navigator.clipboard?.writeText(a.text),
              }
            : {
                  label: a.label,
                  icon: <FolderOpen size={13} strokeWidth={1.8} />,
                  click: () => getApi().revealPath(a.path),
              }
    );
}
