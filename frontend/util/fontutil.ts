// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let isJetBrainsMonoLoaded = false;
let isHackFontLoaded = false;
let isHackNerdFontLoaded = false;
let isInterFontLoaded = false;
let isHankenGroteskLoaded = false;
let isFiraCodeLoaded = false;

function addToFontFaceSet(fontFaceSet: FontFaceSet, fontFace: FontFace) {
    // any cast to work around typing issue
    (fontFaceSet as any).add(fontFace);
}

function loadJetBrainsMonoFont() {
    if (isJetBrainsMonoLoaded) {
        return;
    }
    isJetBrainsMonoLoaded = true;
    // variable font with the full charset (Vietnamese included); the v13 latin files it replaces mapped 222 characters
    const jbmFont = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-variable.woff2')", {
        style: "normal",
        weight: "100 800",
    });
    addToFontFaceSet(document.fonts, jbmFont);
    jbmFont.load();
}

function loadHackNerdFont() {
    if (isHackNerdFontLoaded) {
        return;
    }
    isHackFontLoaded = true;
    const hackRegular = new FontFace("Hack", "url('fonts/hacknerdmono-regular.ttf')", {
        style: "normal",
        weight: "400",
    });
    const hackBold = new FontFace("Hack", "url('fonts/hacknerdmono-bold.ttf')", {
        style: "normal",
        weight: "700",
    });
    const hackItalic = new FontFace("Hack", "url('fonts/hacknerdmono-italic.ttf')", {
        style: "italic",
        weight: "400",
    });
    const hackBoldItalic = new FontFace("Hack", "url('fonts/hacknerdmono-bolditalic.ttf')", {
        style: "italic",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, hackRegular);
    addToFontFaceSet(document.fonts, hackBold);
    addToFontFaceSet(document.fonts, hackItalic);
    addToFontFaceSet(document.fonts, hackBoldItalic);
    hackRegular.load();
    hackBold.load();
    hackItalic.load();
    hackBoldItalic.load();
}

function loadInterFont() {
    if (isInterFontLoaded) {
        return;
    }
    isInterFontLoaded = true;
    const interFont = new FontFace("Inter", "url('fonts/inter-variable.woff2')", {
        style: "normal",
        weight: "100 900",
    });
    addToFontFaceSet(document.fonts, interFont);
    interFont.load();
}

function loadHankenGroteskFont() {
    if (isHankenGroteskLoaded) {
        return;
    }
    isHankenGroteskLoaded = true;
    // variable font: a single woff2 covers the whole weight axis (same as Inter)
    const hankenFont = new FontFace("Hanken Grotesk", "url('fonts/hanken-grotesk-variable.woff2')", {
        style: "normal",
        weight: "100 900",
    });
    addToFontFaceSet(document.fonts, hankenFont);
    hankenFont.load();
}

function loadFiraCodeFont() {
    if (isFiraCodeLoaded) {
        return;
    }
    isFiraCodeLoaded = true;
    // variable font: a single woff2 covers the whole weight axis (same as Inter / Hanken)
    const firaFont = new FontFace("Fira Code", "url('fonts/fira-code-variable.woff2')", {
        style: "normal",
        weight: "300 700",
    });
    addToFontFaceSet(document.fonts, firaFont);
    firaFont.load();
}

function loadFonts() {
    loadHankenGroteskFont();
    loadInterFont();
    loadJetBrainsMonoFont();
    loadHackNerdFont();
    loadFiraCodeFont();
}

export { loadFonts };
