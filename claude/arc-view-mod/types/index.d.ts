// the mod's $.state contract: the highlight's skim switch, and the question the last reply left waiting on the
// person, with whether its rows have scrolled out of view.

export type Ask = { hash: string; text: string };

declare module "claude-code" {
    interface PluginState {
        "arc-view": { skim: boolean; ask: Ask | null; isAskHidden: boolean };
    }
}
