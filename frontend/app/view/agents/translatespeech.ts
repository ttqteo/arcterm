// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Quick translate's read-aloud: the OS's own voices through the Web Speech API, so it needs no network and costs no
// memory while silent. The choice of voice is translatemodel.ts' pickVoice; translatepanel.tsx draws the buttons.

import { useEffect, useState } from "react";
import { langName, pickVoice, speechLang } from "./translatemodel";

function synth(): SpeechSynthesis | null {
    return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

/** The system's voices, kept current: a webview often lists none until its voiceschanged event. */
export function useSpeechVoices(): SpeechSynthesisVoice[] {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => synth()?.getVoices() ?? []);
    useEffect(() => {
        const s = synth();
        if (s == null) {
            return;
        }
        const update = () => setVoices(s.getVoices());
        update();
        s.addEventListener("voiceschanged", update);
        return () => s.removeEventListener("voiceschanged", update);
    }, []);
    return voices;
}

/** Why a Google language cannot be read, null when it can: no speech at all, no language yet (Detect language before
 *  an answer), or no voice for it. An empty voice list still reads, in the language alone, since some webviews never
 *  list their voices. */
export function cannotSpeak(voices: readonly SpeechSynthesisVoice[], code: string | null): string | null {
    if (synth() == null) {
        return "Reading aloud is not available here";
    }
    const lang = code == null ? null : speechLang(code);
    if (code == null || lang == null) {
        return "No language detected yet";
    }
    if (voices.length > 0 && pickVoice(voices, lang) == null) {
        return `No ${langName(code)} voice on this system`;
    }
    return null;
}

/** Reads a text in a Google language, cutting off whatever was being read. */
export function speak(text: string, code: string): void {
    const s = synth();
    const lang = speechLang(code);
    if (s == null || lang == null || text.trim() === "") {
        return;
    }
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(s.getVoices(), lang);
    u.lang = voice?.lang ?? lang;
    if (voice != null) {
        u.voice = voice;
    }
    s.speak(u);
}

/** Stops reading. */
export function stopSpeaking(): void {
    synth()?.cancel();
}
