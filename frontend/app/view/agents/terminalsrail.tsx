// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The menu of a plain terminal's row in the Agent tree's Terminals section.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { Copy, CopyPlus, Pencil, X } from "lucide-react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { startRowRename } from "./rowrename";
import { duplicateSession } from "./session-models/sessionsidebarmodel";

// A terminal row's menu in the Agent tree: the actions an agent row offers, minus the agent-only wording (a
// terminal duplicates into a fresh shell in the same cwd). Rename matters more here than on an agent row: a terminal
// has no ai-title to name it, so without a rename it is stuck on the launch-time label it shares with every other
// shell in the repo.
export function showTerminalMenu(model: AgentsViewModel, terminal: AgentVM, e: React.MouseEvent): void {
    const items: ContextMenuItem[] = [
        { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(terminal.id) },
        { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, terminal.id) },
        {
            label: "Copy name",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText(terminal.name),
        },
        { type: "separator" },
        {
            label: "Close terminal",
            icon: <X size={15} />,
            danger: true,
            click: () => confirmCloseSession(terminal),
        },
    ];
    ContextMenuModel.getInstance().showContextMenu(items, e);
}
