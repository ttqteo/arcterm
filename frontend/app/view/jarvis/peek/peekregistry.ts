// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// One body per peekable kind. A body renders its target and reports what only it knows (reportPeekFacts);
// the item view around it owns the header, the buttons and the keys.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { ComponentType } from "react";
import type { PeekTarget } from "../peekstore";
import { PeekAgentBody } from "./peekagent";
import { PeekEffortBody } from "./peekeffort";
import { PeekNoteBody } from "./peeknote";
import { PeekRecordBody } from "./peekrecord";
import { PeekRunBody } from "./peekrun";

export const PEEK_BODIES: Record<PeekTarget["kind"], ComponentType<{ model: AgentsViewModel; target: PeekTarget }>> = {
    run: PeekRunBody,
    agent: PeekAgentBody,
    record: PeekRecordBody,
    effort: PeekEffortBody,
    note: PeekNoteBody,
};
