// A terminal's process starts on its pane's first fit, which only comes once the pane shows: a pane restored hidden
// (an agent behind the one on screen after a restart) stays put until it is picked, so a restart does not start every
// agent at once. A new launch whose pane never showed (started from a held agent, or hidden behind another view as it
// mounted) waited the same way, with its task unsent, until someone opened it: 81 minutes on 2026-11-25. A pane with
// no output yet has never run, so it starts at once, hidden, at the size of a terminal on screen.

export type PaneSize = { cols: number; rows: number };

/** Whether a pane that finished loading should start its process before it shows. */
export function startsWhileHidden(state: { hidden: boolean; started: boolean; replayed: boolean }): boolean {
    return state.hidden && !state.started && !state.replayed;
}

/** The size a hidden pane starts at: the first terminal on screen's, which the pane is most likely to get when it
 *  shows (the Agent surface's cells share one centre), else what the terminal already has. */
export function hiddenStartSize(onScreen: PaneSize[], current: PaneSize): PaneSize {
    const shown = onScreen.find((s) => s.cols > 0 && s.rows > 0);
    return shown ?? current;
}
