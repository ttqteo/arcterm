// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's sound player (office sounds spec, "Architecture"): one AudioContext made on the first sound, a short-
// lived oscillator per note (pulse waves from their harmonics, a triangle, a shared noise buffer), a master gain for
// the volume and a music bus that ducks under a jingle. With the office off nothing here exists. The DEV log sink
// stands in for it in the CDP scenarios (cockpitofficedevhooks.ts).

// no import of @/app/store/global here: officeaudio.test.ts loads this module under vitest
import { globalStore } from "@/app/store/jotaiStore";
import {
    CUE_IDS,
    SCORES,
    scoreSeconds,
    sixteenthSec,
    type CueId,
    type Duty,
    type Score,
    type Track,
    type UiCue,
} from "./officescores";
import { soundGate, type SoundGate } from "./officesoundcues";
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

// volume 1 is this share of full scale: pulse waves are loud
const MASTER = 0.4;
// the music under a jingle
const DUCK = 0.3;
// how early the next loop of the music is scheduled
const LOOKAHEAD_S = 0.25;
// the release at a note's end, so it does not click
const RELEASE_S = 0.03;
const HARMONICS = 32;
const DUCKING: ReadonlySet<string> = new Set<string>(CUE_IDS);

export interface OfficeSink {
    play(id: CueId | UiCue): void;
    music(track: Track | null): void;
    volume(v: number): void;
    close(): void;
}

/** Pure: the cosine terms of a pulse wave of this duty, index 0 the (unused) DC term. */
export function pulseHarmonics(duty: number, n = HARMONICS): Float32Array {
    const real = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) {
        real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    return real;
}

class ChipPlayer implements OfficeSink {
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private track: Track | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private waves = new Map<Duty, PeriodicWave>();
    private noise: AudioBuffer | null = null;
    private vol: number = DEFAULT_SOUND.volume;

    private context(): AudioContext {
        if (!this.ctx) {
            this.ctx = new AudioContext();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.vol * MASTER;
            this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === "suspended") {
            // a context made before the person's first key or click starts suspended; it resumes on the next sound
            void this.ctx.resume().catch(() => {});
        }
        return this.ctx;
    }

    private wave(ctx: AudioContext, duty: Duty): PeriodicWave {
        let w = this.waves.get(duty);
        if (!w) {
            const real = pulseHarmonics(duty);
            w = ctx.createPeriodicWave(real, new Float32Array(real.length));
            this.waves.set(duty, w);
        }
        return w;
    }

    private noiseBuffer(ctx: AudioContext): AudioBuffer {
        if (!this.noise) {
            this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = this.noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }
        return this.noise;
    }

    private schedule(ctx: AudioContext, score: Score, t0: number, out: AudioNode): void {
        const s16 = sixteenthSec(score.bpm);
        for (const n of score.notes) {
            const start = t0 + n.at * s16;
            const end = start + n.len * s16;
            const g = ctx.createGain();
            g.gain.setValueAtTime(n.vol, start);
            g.gain.setValueAtTime(n.vol, Math.max(start, end - RELEASE_S));
            g.gain.linearRampToValueAtTime(0, end);
            g.connect(out);
            let src: AudioScheduledSourceNode;
            if (n.ch === "noise") {
                const b = ctx.createBufferSource();
                b.buffer = this.noiseBuffer(ctx);
                b.loop = true;
                src = b;
            } else {
                const o = ctx.createOscillator();
                o.frequency.value = n.freq;
                if (n.ch === "tri") {
                    o.type = "triangle";
                } else {
                    o.setPeriodicWave(this.wave(ctx, n.duty));
                }
                src = o;
            }
            src.connect(g);
            src.onended = () => {
                src.disconnect();
                g.disconnect();
            };
            src.start(start);
            src.stop(end);
        }
    }

    play(id: CueId | UiCue): void {
        const ctx = this.context();
        const score = SCORES[id];
        const t = ctx.currentTime;
        this.schedule(ctx, score, t + 0.02, this.master!);
        if (this.musicBus && DUCKING.has(id)) {
            const g = this.musicBus.gain;
            const back = t + scoreSeconds(score);
            g.cancelScheduledValues(t);
            g.setValueAtTime(g.value, t);
            g.linearRampToValueAtTime(DUCK, t + 0.05);
            g.setValueAtTime(DUCK, back);
            g.linearRampToValueAtTime(1, back + 0.3);
        }
    }

    music(track: Track | null): void {
        if (track === this.track) {
            return;
        }
        this.stopMusic();
        if (!track) {
            return;
        }
        this.track = track;
        const ctx = this.context();
        const bus = ctx.createGain();
        bus.connect(this.master!);
        this.musicBus = bus;
        const score = SCORES[track];
        const len = scoreSeconds(score);
        let t0 = ctx.currentTime + 0.05;
        const loop = () => {
            if (this.musicBus !== bus) {
                return;
            }
            this.schedule(ctx, score, t0, bus);
            t0 += len;
            this.timer = setTimeout(loop, Math.max(0, (t0 - ctx.currentTime - LOOKAHEAD_S) * 1000));
        };
        loop();
    }

    private stopMusic(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        // the notes already scheduled on the bus play on into nothing and end
        this.musicBus?.disconnect();
        this.musicBus = null;
        this.track = null;
    }

    volume(v: number): void {
        this.vol = v;
        if (this.ctx && this.master) {
            this.master.gain.setTargetAtTime(v * MASTER, this.ctx.currentTime, 0.05);
        }
    }

    close(): void {
        this.stopMusic();
        void this.ctx?.close().catch(() => {});
        this.ctx = null;
        this.master = null;
        this.waves.clear();
        this.noise = null;
    }
}

class LogSink implements OfficeSink {
    constructor(readonly log: string[]) {}
    play(id: CueId | UiCue): void {
        this.log.push(id);
    }
    music(track: Track | null): void {
        this.log.push(`music:${track ?? "off"}`);
    }
    volume(): void {}
    close(): void {}
}

let player: ChipPlayer | null = null;
let devLog: LogSink | null = null;

export function officeSink(): OfficeSink {
    if (devLog) {
        return devLog;
    }
    player ??= new ChipPlayer();
    return player;
}

// the office unmounts: its AudioContext closes
export function closeOfficeSink(): void {
    player?.close();
    player = null;
}

// DEV: log what would play instead of playing it (the office-sound scenario); a fresh log each time it turns on
export function setOfficeSoundLog(on: boolean): void {
    devLog = on ? new LogSink([]) : null;
}

export function officeSoundLog(): string[] | null {
    return devLog ? [...devLog.log] : null;
}

// the DEV log counts as focus: the scenario's window is not always the focused one
export function soundLogging(): boolean {
    return devLog != null;
}

// read at the moment of a boss sound; officesound.tsx reads the same through hooks
export function readSoundGate(): SoundGate {
    return soundGate(
        {
            events: soundSwitch(globalStore.get(officeSoundEventsAtom), DEFAULT_SOUND.events),
            ui: soundSwitch(globalStore.get(officeSoundUiAtom), DEFAULT_SOUND.ui),
            music: soundSwitch(globalStore.get(officeSoundMusicAtom), DEFAULT_SOUND.music),
            volume: soundVolume(globalStore.get(officeSoundVolumeAtom)),
            muted: soundSwitch(globalStore.get(officeSoundMutedAtom), DEFAULT_SOUND.muted),
        },
        soundLogging() || (typeof document !== "undefined" && document.hasFocus())
    );
}

// the boss's sounds, called from cockpitoffice.tsx where it moves
export function playOfficeUi(id: UiCue): void {
    if (readSoundGate().ui) {
        officeSink().play(id);
    }
}
