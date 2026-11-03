// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// apple-translate: one translation through Apple Translation, on the device, for wavesrv's translate command when
// Google cannot answer (pkg/translate/apple.go). Built by the Taskfile's build:translate:macos into
// dist/bin/apple-translate.arm64.
//
//   apple-translate <source|auto> <target>     the text on stdin, codes in Apple's form (zh-Hans, he, nb…)
//
// It prints {"translation":…,"source":…} and exits 0, or prints the reason on stderr and exits 2 when Apple
// Translation cannot take the request (macOS before 26, a pair it does not translate, a language pack not downloaded)
// and 1 on any other failure. `TranslationSession(installedSource:target:)` needs no window, so macOS never shows its
// download sheet: a missing pack is reported instead.

import Foundation
import NaturalLanguage
import Translation

func fail(_ code: Int32, _ reason: String) -> Never {
    FileHandle.standardError.write(Data(reason.utf8))
    exit(code)
}

func answer(_ translation: String, _ source: String) -> Never {
    let out = ["translation": translation, "source": source]
    guard let data = try? JSONSerialization.data(withJSONObject: out) else {
        fail(1, "couldn't write the answer")
    }
    FileHandle.standardOutput.write(data)
    exit(0)
}

// "English", whatever the Mac's own language
func name(_ code: String) -> String {
    Locale(identifier: "en").localizedString(forIdentifier: code) ?? code
}

func languageCode(_ id: String) -> String? {
    Locale.Language(identifier: id).languageCode?.identifier
}

// The text's language for "auto". NLLanguageRecognizer guesses a lone word poorly ("gold" reads as Turkish,
// "Contrarian" as Spanish), so when its best guess is under even odds and one of the Mac's own languages is among its
// guesses at 15% or more, that one wins.
func detect(_ text: String) -> String? {
    let recognizer = NLLanguageRecognizer()
    recognizer.processString(text)
    let guesses = recognizer.languageHypotheses(withMaximum: 5).filter { $0.key != .undetermined }
    guard let best = guesses.max(by: { $0.value < $1.value }) else {
        return nil
    }
    if best.value >= 0.5 {
        return best.key.rawValue
    }
    let own = Set(Locale.preferredLanguages.compactMap(languageCode))
    let mine = guesses.filter { own.contains(languageCode($0.key.rawValue) ?? "") && $0.value >= 0.15 }
    return (mine.max(by: { $0.value < $1.value }) ?? best).key.rawValue
}

@available(macOS 26.0, *)
func translate(source: String, target: String, text: String) async -> Never {
    var from = source
    if from == "auto" {
        guard let detected = detect(text) else {
            fail(2, "it couldn't tell what language the text is in")
        }
        from = detected
    }
    if Locale.Language(identifier: from).languageCode == Locale.Language(identifier: target).languageCode
        && Locale.Language(identifier: from).script == Locale.Language(identifier: target).script
    {
        answer(text, from)
    }
    let src = Locale.Language(identifier: from)
    let tgt = Locale.Language(identifier: target)
    switch await LanguageAvailability().status(from: src, to: tgt) {
    case .installed:
        break
    case .supported:
        fail(
            2,
            "the \(name(from)) → \(name(target)) language pack isn't downloaded (System Settings → General → Language & Region → Translation Languages)"
        )
    case .unsupported:
        fail(2, "it doesn't translate \(name(from)) into \(name(target))")
    @unknown default:
        fail(2, "it can't translate \(name(from)) into \(name(target))")
    }
    do {
        let session = TranslationSession(installedSource: src, target: tgt)
        let response = try await session.translate(text)
        answer(response.targetText, from)
    } catch {
        fail(1, error.localizedDescription)
    }
}

let args = CommandLine.arguments
guard args.count == 3 else {
    fail(1, "usage: apple-translate <source|auto> <target>, the text on stdin")
}
let text = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
if #available(macOS 26.0, *) {
    await translate(source: args[1], target: args[2], text: text)
} else {
    fail(2, "it needs macOS 26 or later")
}
