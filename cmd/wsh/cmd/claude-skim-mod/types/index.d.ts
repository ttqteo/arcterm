// the mod's $.state contract: whether the person turned the dimming of explanations off, and the question the last
// reply left waiting on them, with whether its rows have scrolled out of view.

export type Ask = { hash: string; text: string };

declare module "claude-code" {
    interface PluginState {
        skim: { isSkimOff: boolean; ask: Ask | null; isAskHidden: boolean };
    }
}
