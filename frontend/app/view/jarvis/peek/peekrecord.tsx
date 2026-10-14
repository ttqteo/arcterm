// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The record body (PeekRecord.dc.html) is the Brief's record peek itself, so the two cannot drift; only its exits
// differ. The list is what says whether the record is still there.

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { RecordPeekBody } from "../briefpeekview";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { taskListAtom } from "../tasksstore";
import { recordPeekFacts } from "./peekrecordmodel";

export function PeekRecordBody({ model, target }: { model: AgentsViewModel; target: PeekTarget }) {
    const dossierId = target.kind === "record" ? target.dossierId : "";
    const summary = useAtomValue(taskListAtom)?.find((d) => d.id === dossierId);

    useEffect(() => {
        reportPeekFacts(target, recordPeekFacts(summary));
    }, [target, summary]);

    return (
        <div className="flex min-h-0 flex-col">
            <RecordPeekBody model={model} recordId={dossierId} place="popup" />
        </div>
    );
}
