// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Lucide glyphs for collapsible rail section strips (Agent details + Channels).

import {
    BarChart3,
    Bell,
    Coins,
    Diamond,
    FileText,
    Folder,
    GitBranch,
    Info,
    Settings,
    SquareTerminal,
    Users,
    Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

const iconProps = { size: 20, strokeWidth: 1.8 } as const;

export const RAIL_ICON: Record<string, ReactNode> = {
    info: <Info {...iconProps} />,
    context: <BarChart3 {...iconProps} />,
    subagents: <GitBranch {...iconProps} />,
    tools: <Wrench {...iconProps} />,
    files: <FileText {...iconProps} />,
    usage: <Coins {...iconProps} />,
    autonomy: <Diamond {...iconProps} />,
    gear: <Settings {...iconProps} />,
    fleet: <Users {...iconProps} />,
    bell: <Bell {...iconProps} />,
    terminal: <SquareTerminal {...iconProps} />,
    folder: <Folder {...iconProps} />,
};
