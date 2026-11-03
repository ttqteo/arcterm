// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// AppleHelperName is the helper's file in the app's bin dir, beside wavesrv: pkg/translate/apple/main.swift, built
// by the Taskfile's build:translate:macos and shipped by src-tauri/tauri.macos.conf.json.
const AppleHelperName = "apple-translate.arm64"

// appleTimeout covers a cold start: the first request after a while loads the language model, about 6 s on an 8 GB
// Mac; a warm one takes under 2 s.
const appleTimeout = 15 * time.Second

// Google's codes where Apple names the language otherwise (both ways; NLLanguageRecognizer, which detects the source
// on "auto", names them Apple's way)
var googleToApple = map[string]string{"zh-CN": "zh-Hans", "zh-TW": "zh-Hant", "iw": "he", "jw": "jv", "tl": "fil", "no": "nb"}

func appleCode(google string) string {
	if c, ok := googleToApple[google]; ok {
		return c
	}
	return google
}

func googleCode(apple string) string {
	for g, a := range googleToApple {
		if a == apple {
			return g
		}
	}
	return apple
}

// Apple translates through Apple Translation on the device, by running the helper at helper: source (a Google code, or
// "auto") and target as arguments, the text on stdin, and {"translation","source"} on stdout. Its answer has no
// phonetics and no word classes. A failure answers the reason the helper gave, such as a language pack that is not
// downloaded.
func Apple(ctx context.Context, helper, source, target, text string) (Answer, error) {
	ctx, cancel := context.WithTimeout(ctx, appleTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, helper, appleCode(source), appleCode(target))
	cmd.Stdin = strings.NewReader(text)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return Answer{}, fmt.Errorf("no answer within %v", appleTimeout)
		}
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			return Answer{}, errors.New(msg)
		}
		return Answer{}, err
	}
	var out struct {
		Translation string `json:"translation"`
		Source      string `json:"source"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return Answer{}, fmt.Errorf("unreadable answer: %v", err)
	}
	return Answer{Translation: strings.TrimSpace(out.Translation), Source: googleCode(out.Source)}, nil
}
