// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// pure availability derivation for Pet Errand. Only an in-flight reply locks the field; draft and harness
// validity block dispatch without blocking composition. Keeping those decisions separate prevents an empty
// draft from disabling the very field needed to make it non-empty. A destination always exists (No folder), so
// there is no "no channel" state to lock on.

import { supportsOperation } from "@/app/view/agents/harnesspicker";
import { NO_FOLDER_DEST } from "./petstore";

export interface PetErrandStateInput {
    draft: string;
    busy: boolean;
    runtime: string;
    saving: boolean;
    harnesses: HarnessInfo[];
}

export interface PetErrandState {
    inputDisabled: boolean;
    submitDisabled: boolean;
    reason: string | null;
    runtime: string;
}

export function petErrandState(input: PetErrandStateInput): PetErrandState {
    if (input.busy) {
        return {
            inputDisabled: true,
            submitDisabled: true,
            reason: "busy",
            runtime: input.runtime,
        };
    }
    if (input.runtime === "") {
        return {
            inputDisabled: false,
            submitDisabled: true,
            reason: "Choose a harness",
            runtime: input.runtime,
        };
    }
    if (input.saving) {
        return {
            inputDisabled: false,
            submitDisabled: true,
            reason: "saving harness preference…",
            runtime: input.runtime,
        };
    }
    const harness = input.harnesses.find((candidate) => candidate.runtime === input.runtime);
    if (harness == null || !harness.installed || !supportsOperation(harness, "consult")) {
        return {
            inputDisabled: false,
            submitDisabled: true,
            reason: "Choose a harness",
            runtime: input.runtime,
        };
    }
    if (input.draft.trim() === "") {
        return {
            inputDisabled: false,
            submitDisabled: true,
            reason: "empty draft",
            runtime: input.runtime,
        };
    }
    return {
        inputDisabled: false,
        submitDisabled: false,
        reason: null,
        runtime: input.runtime,
    };
}

// Whether the reply box is drawn. A finished reply with no text is the model's verdict block alone (the block is
// stripped from what shows), and under a chooser card an empty "replied" box would only repeat the card, so the
// card stands alone. A reply in flight or failed always shows: it carries the status.
export function errandReplyShown(
    errand: { status: "streaming" | "done" | "error"; text: string } | null,
    hasCard: boolean
): boolean {
    if (errand == null) {
        return false;
    }
    return !(hasCard && errand.status === "done" && errand.text.trim() === "");
}

export interface DestinationInput {
    // the panel's own choice, once the user has made one: a project channel's oid, or NO_FOLDER_DEST
    picked: string | null;
    channels: Channel[] | null;
}

// Where an Ask goes: No folder, where Jarvis picks the project, or one project's channel, asked straight.
export type PetDest = { kind: "no-folder" } | { kind: "channel"; channel: Channel };

// Where the reply lands. The peek opens over every surface and must never be dead, and No folder always answers,
// so nothing ever has to fall back to "some channel": the panel's own pick of a live channel wins, and everything
// else — nothing picked, the NO_FOLDER_DEST sentinel, an oid that no longer resolves (channels outlive neither
// reloads nor deletion, and a remembered pick must not be able to kill the field) — is No folder. The Jarvis
// surface's selection and the newest channel no longer count: the first is set by a surface the person may never
// open, the second reliably landed the reply in a months-old per-task channel.
export function resolveDestination(input: DestinationInput): PetDest {
    if (input.picked != null && input.picked !== NO_FOLDER_DEST) {
        const channel = (input.channels ?? []).find((c) => c.oid === input.picked);
        if (channel != null) {
            return { kind: "channel", channel };
        }
    }
    return { kind: "no-folder" };
}
