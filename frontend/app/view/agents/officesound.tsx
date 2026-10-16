// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's sound (office sounds spec): mounted inside CockpitOffice, it draws nothing. Each change to what the
// office draws becomes at most one jingle (officesoundcues.ts); the music follows its switch and day or night; the
// office unmounting stops it all and closes the AudioContext.

import { atoms } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { attentionFixtureAtom, attentionLoadedAtom } from "./attentionstore";
import { closeOfficeSink, officeSink, soundLogging } from "./officeaudio";
import type { PlanAgent, PlanRun } from "./officeplanmodel";
import {
    cueSnapshot,
    diffCues,
    pickCue,
    soundGate,
    type BoardCue,
    type CueSnapshot,
    type SoundGate,
} from "./officesoundcues";
import {
    DEFAULT_SOUND,
    officeSoundEventsAtom,
    officeSoundMusicAtom,
    officeSoundMutedAtom,
    officeSoundUiAtom,
    officeSoundVolumeAtom,
    soundSwitch,
    soundVolume,
} from "./officestore";

function useSoundGate(): SoundGate {
    const events = soundSwitch(useAtomValue(officeSoundEventsAtom), DEFAULT_SOUND.events);
    const ui = soundSwitch(useAtomValue(officeSoundUiAtom), DEFAULT_SOUND.ui);
    const music = soundSwitch(useAtomValue(officeSoundMusicAtom), DEFAULT_SOUND.music);
    const volume = soundVolume(useAtomValue(officeSoundVolumeAtom));
    const muted = soundSwitch(useAtomValue(officeSoundMutedAtom), DEFAULT_SOUND.muted);
    const focused = useAtomValue(atoms.documentHasFocus);
    return soundGate({ events, ui, music, volume, muted }, focused || soundLogging());
}

export function OfficeSound(props: { agents: PlanAgent[]; runs: PlanRun[]; board: BoardCue[]; night: boolean }) {
    const { agents, runs, night } = props;
    // the Needs you list can land after the office mounts: until its first load (or a DEV fixture) it is not there,
    // so that load is a baseline and does not chime (officesoundcues.ts, CueSnapshot.board)
    const loaded = useAtomValue(attentionLoadedAtom);
    const fixture = useAtomValue(attentionFixtureAtom);
    const board = loaded || fixture != null ? props.board : null;
    const gate = useSoundGate();
    const gateRef = useRef(gate);
    gateRef.current = gate;
    const prev = useRef<CueSnapshot | null>(null);
    const lastAt = useRef<number | null>(null);

    // the snapshot moves on even while jingles are off, so turning them on later plays no backlog
    useEffect(() => {
        const next = cueSnapshot(agents, runs, board);
        const cues = diffCues(prev.current, next);
        prev.current = next;
        if (!gateRef.current.events) {
            return;
        }
        const now = Date.now();
        const cue = pickCue(cues, lastAt.current, now);
        if (cue) {
            lastAt.current = now;
            officeSink().play(cue);
        }
    }, [agents, runs, board]);

    useEffect(() => {
        officeSink().volume(gate.volume);
    }, [gate.volume]);

    // unfocused, muted or switched off, the music stops; back on, its loop starts again from the top (spec, "Music")
    useEffect(() => {
        officeSink().music(gate.music ? (night ? "night" : "day") : null);
    }, [gate.music, night]);

    useEffect(
        () => () => {
            officeSink().music(null);
            closeOfficeSink();
        },
        []
    );
    return null;
}
