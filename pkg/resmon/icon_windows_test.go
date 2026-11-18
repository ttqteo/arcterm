//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIconOfFileReadsExplorersIcon(t *testing.T) {
	path := filepath.Join(os.Getenv("SystemRoot"), "explorer.exe")
	url := iconOfFile(path)
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(url, prefix) {
		t.Fatalf("no icon read from %s: %q", path, url)
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, prefix))
	if err != nil {
		t.Fatal(err)
	}
	img, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	if b.Dx() != iconSize || b.Dy() != iconSize {
		t.Fatalf("icon is %dx%d, want %d square", b.Dx(), b.Dy(), iconSize)
	}
	opaque := 0
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a > 0 {
				opaque++
			}
		}
	}
	if opaque == 0 || opaque == b.Dx()*b.Dy() {
		t.Fatalf("%d of %d pixels show: an icon has both shape and a transparent ground", opaque, b.Dx()*b.Dy())
	}
}

func TestImagePathOfThisProcess(t *testing.T) {
	if p := imagePath(os.Getpid()); !strings.HasSuffix(strings.ToLower(p), ".exe") {
		t.Fatalf("imagePath(self) = %q", p)
	}
}
