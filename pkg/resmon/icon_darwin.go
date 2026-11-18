//go:build darwin

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

/*
#cgo LDFLAGS: -framework CoreFoundation
#include <stdlib.h>
#include <string.h>
#include <CoreFoundation/CoreFoundation.h>

// the bundle's CFBundleIconFile, read through CoreFoundation (which parses a binary Info.plist too); NULL when it has
// none. The caller frees it.
static char *arc_bundle_icon_file(const char *path) {
	CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, (CFIndex)strlen(path), true);
	if (url == NULL) {
		return NULL;
	}
	CFBundleRef bundle = CFBundleCreate(NULL, url);
	CFRelease(url);
	if (bundle == NULL) {
		return NULL;
	}
	char *out = NULL;
	CFTypeRef v = CFBundleGetValueForInfoDictionaryKey(bundle, CFSTR("CFBundleIconFile"));
	if (v != NULL && CFGetTypeID(v) == CFStringGetTypeID()) {
		char buf[1024];
		if (CFStringGetCString((CFStringRef)v, buf, sizeof buf, kCFStringEncodingUTF8)) {
			out = strdup(buf);
		}
	}
	CFRelease(bundle);
	return out;
}
*/
import "C"

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
	"unsafe"
)

// the icon's side in pixels: the panel draws it at 16 points, so 32 keeps it sharp on a Retina screen
const iconSide = 32

// readIcon is the icon of the app pid runs from (its outermost .app), as a PNG data URL; "" for a process in no app,
// or an app whose icon lives only in an asset catalog (Assets.car), which only AppKit reads: wavesrv does not load it,
// for the RAM it would hold.
func readIcon(pid int) string {
	bundle := outerBundle(pidPath(pid))
	if bundle == "" {
		return ""
	}
	path := bundleIconPath(bundle)
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var out []byte
	if img := icnsImage(data, iconSide); img != nil {
		var buf bytes.Buffer
		if png.Encode(&buf, img) == nil {
			out = buf.Bytes()
		}
	} else {
		out = sipsIcon(path, iconSide)
	}
	if out == nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(out)
}

const sipsWait = 5 * time.Second

// sipsIcon converts an .icns with no PNG entry (Zalo's holds one JPEG 2000 image, which Go cannot decode) by macOS's
// own sips, scaled to side; nil when it cannot. Each app's icon is read once per wavesrv (iconCache), so this runs at
// most once per app.
func sipsIcon(icns string, side int) []byte {
	dir, err := os.MkdirTemp("", "arc-icon-")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(dir)
	out := filepath.Join(dir, "icon.png")
	ctx, cancel := context.WithTimeout(context.Background(), sipsWait)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/sips", "-s", "format", "png", "-Z", strconv.Itoa(side), icns, "--out", out)
	if err := cmd.Run(); err != nil {
		return nil
	}
	data, err := os.ReadFile(out)
	if err != nil || !bytes.HasPrefix(data, pngMagic) {
		return nil
	}
	return data
}

// bundleIconPath is the .icns its Info.plist names, or AppIcon.icns, where Xcode puts one by default.
func bundleIconPath(bundle string) string {
	name := "AppIcon.icns"
	cpath := C.CString(bundle)
	defer C.free(unsafe.Pointer(cpath))
	if c := C.arc_bundle_icon_file(cpath); c != nil {
		name = C.GoString(c)
		C.free(unsafe.Pointer(c))
		if filepath.Ext(name) == "" {
			name += ".icns"
		}
	}
	return filepath.Join(bundle, "Contents", "Resources", filepath.Base(name))
}

var pngMagic = []byte("\x89PNG")

// icnsImage reads an .icns file's PNG entries (every size since 10.7 is one; older ARGB and JPEG 2000 entries are
// passed over) and returns the smallest at least side wide, scaled to side; the largest when none is. nil when the
// file holds no PNG.
func icnsImage(data []byte, side int) image.Image {
	if len(data) < 8 || string(data[:4]) != "icns" {
		return nil
	}
	var best []byte
	bestW := 0
	for off := 8; off+8 <= len(data); {
		n := int(binary.BigEndian.Uint32(data[off+4 : off+8]))
		if n < 8 || off+n > len(data) {
			break
		}
		entry := data[off+8 : off+n]
		off += n
		if !bytes.HasPrefix(entry, pngMagic) {
			continue
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(entry))
		if err != nil {
			continue
		}
		w := cfg.Width
		better := best == nil ||
			(w >= side && (bestW < side || w < bestW)) ||
			(w < side && bestW < side && w > bestW)
		if better {
			best, bestW = entry, w
		}
	}
	if best == nil {
		return nil
	}
	img, err := png.Decode(bytes.NewReader(best))
	if err != nil {
		return nil
	}
	return scaleDown(img, side)
}

// scaleDown averages img into a side×side square (a box filter, enough for an icon's whole-number steps); an image no
// wider than side comes back as it is.
func scaleDown(img image.Image, side int) image.Image {
	b := img.Bounds()
	if b.Dx() <= side && b.Dy() <= side {
		return img
	}
	out := image.NewNRGBA(image.Rect(0, 0, side, side))
	for y := 0; y < side; y++ {
		y0, y1 := b.Min.Y+y*b.Dy()/side, b.Min.Y+(y+1)*b.Dy()/side
		for x := 0; x < side; x++ {
			x0, x1 := b.Min.X+x*b.Dx()/side, b.Min.X+(x+1)*b.Dx()/side
			var r, g, bl, a, n uint64
			for sy := y0; sy < max(y1, y0+1); sy++ {
				for sx := x0; sx < max(x1, x0+1); sx++ {
					// premultiplied, so a transparent pixel's colour does not bleed into the edge
					pr, pg, pb, pa := img.At(sx, sy).RGBA()
					r, g, bl, a, n = r+uint64(pr), g+uint64(pg), bl+uint64(pb), a+uint64(pa), n+1
				}
			}
			r, g, bl, a = r/n, g/n, bl/n, a/n
			out.Set(x, y, color.RGBA64{R: uint16(r), G: uint16(g), B: uint16(bl), A: uint16(a)})
		}
	}
	return out
}
