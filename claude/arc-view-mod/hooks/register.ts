// arcterm's second Claude Code mod: draws the transcript rows of prompts the arc mod submitted. It is a
// mod of its own because the engine never runs a plugin's render hook on a row that plugin raised.
// `wsh install-agent-hooks` installs it beside the arc mod; outside arcterm no such row exists.
import type { Register } from "claude-code";
import { parseWake } from "./wake-core";
import { drawWakeRow } from "./wake-row";

// the width a row is laid out for where the surface has not measured
const DEFAULT_COLUMNS = 80;

export const register: Register = (on) => {
    // a wake is drawn as what it holds; the model reads it as sent, and ctrl+o shows that text
    on("ui.render", { component: "UserMessage", props: { origin: { kind: "plugin", name: "arc" } } }, ($, e, next) => {
        const wake = e.props.isExpanded ? null : parseWake(e.props.text);
        return wake ? drawWakeRow($.ui.resolve(e), wake, e.viewport?.columns ?? DEFAULT_COLUMNS) : next(e);
    });
};
