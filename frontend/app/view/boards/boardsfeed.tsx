// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Always mounted at the cockpit root, beside the pollers: lands the drawer's answers on their boards and toasts a
// drawing the agent asked for (boardapplier.ts). Renders nothing, and loads no Excalidraw until an answer arrives.

import { useEffect } from "react";
import { startBoardApplier, type BoardApplierModel } from "./boardapplier";

export function BoardsFeed({ model }: { model: BoardApplierModel }) {
    useEffect(() => startBoardApplier(model), [model]);
    return null;
}
