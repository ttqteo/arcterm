// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { UNKNOWN_VERSION, versionInfoAtom } from "./versioninfo";
import { openWhatsNew } from "./whatsnewstore";

// The app's version at the right end of a hints bar (FooterStatus), so which build is running is always one glance away,
// and the door to its release notes, whose header says when it was built. Just the number: the commit is in
// Settings → About. Nothing until boot has read it.
export function VersionTag() {
    const version = useAtomValue(versionInfoAtom);
    if (version.app === UNKNOWN_VERSION) {
        return null;
    }
    return (
        <button
            type="button"
            data-app-version
            title={`What's new in arcterm ${version.app}`}
            onClick={openWhatsNew}
            className="shrink-0 cursor-pointer whitespace-nowrap text-[11.5px] tabular-nums text-muted hover:text-primary"
        >
            v{version.app}
        </button>
    );
}
