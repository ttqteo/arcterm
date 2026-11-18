//go:build windows

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package resmon

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32                = windows.NewLazySystemDLL("shell32.dll")
	user32                 = windows.NewLazySystemDLL("user32.dll")
	gdi32                  = windows.NewLazySystemDLL("gdi32.dll")
	procExtractIconExW     = shell32.NewProc("ExtractIconExW")
	procGetIconInfo        = user32.NewProc("GetIconInfo")
	procDestroyIcon        = user32.NewProc("DestroyIcon")
	procCreateCompatibleDC = gdi32.NewProc("CreateCompatibleDC")
	procDeleteDC           = gdi32.NewProc("DeleteDC")
	procDeleteObject       = gdi32.NewProc("DeleteObject")
	procGetObjectW         = gdi32.NewProc("GetObjectW")
	procGetDIBits          = gdi32.NewProc("GetDIBits")
)

// mirrors ICONINFO (winuser.h)
type iconInfo struct {
	fIcon    int32
	xHotspot uint32
	yHotspot uint32
	hbmMask  windows.Handle
	hbmColor windows.Handle
}

// mirrors BITMAP (wingdi.h)
type bitmap struct {
	bmType       int32
	bmWidth      int32
	bmHeight     int32
	bmWidthBytes int32
	bmPlanes     uint16
	bmBitsPixel  uint16
	bmBits       uintptr
}

// mirrors BITMAPINFO (wingdi.h) with room for the three masks a 32-bit DIB may carry
type bitmapInfo struct {
	biSize          uint32
	biWidth         int32
	biHeight        int32
	biPlanes        uint16
	biBitCount      uint16
	biCompression   uint32
	biSizeImage     uint32
	biXPelsPerMeter int32
	biYPelsPerMeter int32
	biClrUsed       uint32
	biClrImportant  uint32
	colors          [3]uint32
}

// iconSize caps the icon read: the large shell icon is 32 px where wavesrv runs unaware of the screen's scale, which a
// 16 px row draws sharp up to 200%
const iconSize = 32

// readIcon is the icon of the executable pid runs, as a PNG data URL, as Task Manager draws beside its name; "" when the
// process cannot be opened (a protected one), its image has no icon, or the icon cannot be read.
func readIcon(pid int) string {
	path := imagePath(pid)
	if path == "" {
		return ""
	}
	return iconOfFile(path)
}

// iconOfFile is the first icon an executable holds, as a PNG data URL; "" where it has none or it cannot be read
func iconOfFile(path string) string {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return ""
	}
	var large windows.Handle
	n, _, _ := procExtractIconExW.Call(uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&large)), 0, 1)
	if n == 0 || large == 0 {
		return ""
	}
	defer procDestroyIcon.Call(uintptr(large))
	img := iconImage(large)
	if img == nil {
		return ""
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func imagePath(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

// iconImage reads an icon's colour bitmap as straight-alpha RGBA. An icon drawn without an alpha channel (every pixel's
// alpha 0) takes its transparency from the AND mask instead; a monochrome icon (no colour bitmap) reads as nil.
func iconImage(icon windows.Handle) image.Image {
	var ii iconInfo
	if ok, _, _ := procGetIconInfo.Call(uintptr(icon), uintptr(unsafe.Pointer(&ii))); ok == 0 {
		return nil
	}
	defer procDeleteObject.Call(uintptr(ii.hbmMask))
	if ii.hbmColor == 0 {
		return nil
	}
	defer procDeleteObject.Call(uintptr(ii.hbmColor))
	var bm bitmap
	if n, _, _ := procGetObjectW.Call(uintptr(ii.hbmColor), unsafe.Sizeof(bm), uintptr(unsafe.Pointer(&bm))); n == 0 {
		return nil
	}
	w, h := int(bm.bmWidth), int(bm.bmHeight)
	if w <= 0 || h <= 0 || w > 256 || h > 256 {
		return nil
	}
	dc, _, _ := procCreateCompatibleDC.Call(0)
	if dc == 0 {
		return nil
	}
	defer procDeleteDC.Call(dc)
	bgra := dibits(dc, ii.hbmColor, w, h)
	if bgra == nil {
		return nil
	}
	hasAlpha := false
	for i := 3; i < len(bgra); i += 4 {
		if bgra[i] != 0 {
			hasAlpha = true
			break
		}
	}
	var mask []byte
	if !hasAlpha {
		mask = dibits(dc, ii.hbmMask, w, h)
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			i := (y*w + x) * 4
			a := bgra[i+3]
			if !hasAlpha {
				// the AND mask: white is transparent, black shows the colour
				a = 255
				if mask != nil && mask[i] != 0 {
					a = 0
				}
			}
			img.SetNRGBA(x, y, color.NRGBA{R: bgra[i+2], G: bgra[i+1], B: bgra[i], A: a})
		}
	}
	if w > iconSize || h > iconSize {
		return shrink(img, iconSize)
	}
	return img
}

// dibits reads a bitmap as top-down 32-bit BGRA rows
func dibits(dc uintptr, bmp windows.Handle, w, h int) []byte {
	bi := bitmapInfo{biWidth: int32(w), biHeight: -int32(h), biPlanes: 1, biBitCount: 32}
	bi.biSize = uint32(unsafe.Offsetof(bi.colors))
	buf := make([]byte, w*h*4)
	n, _, _ := procGetDIBits.Call(dc, uintptr(bmp), 0, uintptr(h), uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&bi)), 0)
	if int(n) != h {
		return nil
	}
	return buf
}

// shrink box-averages an image down to size px square (an icon read larger than asked, at a high-DPI shell size)
func shrink(src *image.NRGBA, size int) *image.NRGBA {
	b := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := range size {
		for x := range size {
			x0, x1 := x*b.Dx()/size, (x+1)*b.Dx()/size
			y0, y1 := y*b.Dy()/size, (y+1)*b.Dy()/size
			var r, g, bl, a, n int
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					c := src.NRGBAAt(sx, sy)
					// weighted by alpha, so a transparent pixel's colour does not bleed into the edge
					r += int(c.R) * int(c.A)
					g += int(c.G) * int(c.A)
					bl += int(c.B) * int(c.A)
					a += int(c.A)
					n++
				}
			}
			if n == 0 || a == 0 {
				continue
			}
			dst.SetNRGBA(x, y, color.NRGBA{R: uint8(r / a), G: uint8(g / a), B: uint8(bl / a), A: uint8(a / n)})
		}
	}
	return dst
}
