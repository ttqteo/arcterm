// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { formatBuildTime, UNKNOWN_VERSION, versionInfoAtom } from "./versioninfo";

// The app's version at the right end of a hints bar (FooterStatus), so which build is running is always one glance away. Nothing
// until boot has read it.
export function VersionTag() {
    const version = useAtomValue(versionInfoAtom);
    if (version.app === UNKNOWN_VERSION) {
        return null;
    }
    const built = version.buildTime > 0 ? ` · built ${formatBuildTime(version.buildTime)}` : "";
    return (
        <span
            data-app-version
            title={`arcterm ${version.app} · backend ${version.server}${built}`}
            className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted"
        >
            v{version.app}
        </span>
    );
}
