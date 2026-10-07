// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The emails offered when a Claude token account is tied to the account it belongs to: the /login
// account's and every one arcterm has saved a snapshot for (knownClaudeEmails). Free text is still
// allowed; an input points at it with list={id}.

import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { knownClaudeEmails } from "./claudeaccount";
import { claudeIdentityAtom, savedRateLimitsAtom } from "./ratelimitstore";

export function KnownEmailsDatalist({ id }: { id: string }) {
    const saved = useAtomValue(savedRateLimitsAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const emails = useMemo(() => knownClaudeEmails(saved, identity), [saved, identity]);
    return (
        <datalist id={id}>
            {emails.map((email) => (
                <option key={email} value={email} />
            ))}
        </datalist>
    );
}
