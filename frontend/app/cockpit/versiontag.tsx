// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { formatBuildTime, UNKNOWN_VERSION, versionInfoAtom } from "./versioninfo";
import { openWhatsNew } from "./whatsnewstore";

// The app's version at the right end of a hints bar (FooterStatus), so which build is running is always one glance away,
// and the door to its release notes. Nothing until boot has read it.
export function VersionTag() {
    const version = useAtomValue(versionInfoAtom);
    if (version.app === UNKNOWN_VERSION) {
        return null;
    }
    const built = version.buildTime > 0 ? ` · built ${formatBuildTime(version.buildTime)}` : "";
    return (
        <button
            type="button"
            data-app-version
            title={`What's new · arcterm ${version.app} · backend ${version.server}${built}`}
            onClick={openWhatsNew}
            className="shrink-0 cursor-pointer whitespace-nowrap text-[11.5px] tabular-nums text-muted hover:text-primary"
        >
            v{version.app}
        </button>
    );
}
