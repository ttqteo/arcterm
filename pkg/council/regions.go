// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io/fs"
	"log"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// The screenshot regions (docs/superpowers/specs/2026-11-04-council-screenshot-regions-design.md). A seat cites part of
// an image the council was given as `screenshot:<file>#<name>@x,y,w,h`, the box as fractions of the image's width and
// height, so it lands in the same place whatever size of copy the seat saw. Go finds the image, checks the box lies
// inside it, and draws the box once as a PNG (the region's crop with a red rectangle on it), which the cockpit shows under
// the claim and the saved document embeds. Go cannot tell whether the box sits on the right button, only that it lies in
// the image.

const (
	// shotPrefix opens every screenshot cite, matched without regard to case.
	shotPrefix = "screenshot:"
	// regionsFolder holds a council's crops, under CouncilsDir/<id>/.
	regionsFolder = "regions"
	// boxSlack is how far past an edge of the image a box may reach and be clamped onto it instead of failing: a seat
	// reading a box off a scaled-down copy is often a pixel or two out.
	boxSlack = 0.01
	// minCropSide is the least the crop's long side may be, in pixels of the image, so a small box keeps its neighbours.
	minCropSide = 160
)

// regionRed is the rectangle drawn on a crop. It is pixels of a PNG, not a colour of the cockpit's theme.
var regionRed = color.RGBA{R: 229, G: 57, B: 53, A: 255}

// shotRef is a screenshot cite taken apart: the file as cited, the region's name and the box as written ("" with HasBox
// false when the cite names no box).
type shotRef struct {
	File, Name, Box string
	HasBox          bool
}

// parseShotRef reads a `screenshot:` ref, ok false for any other. The box is what follows the last "@" of the part after
// "#"; a ref with no "#" takes a box only when what follows its last "@" holds a comma, so a file named shot@2x.png stays
// a file.
func parseShotRef(ref string) (shotRef, bool) {
	ref = strings.TrimSpace(ref)
	if len(ref) < len(shotPrefix) || !strings.EqualFold(ref[:len(shotPrefix)], shotPrefix) {
		return shotRef{}, false
	}
	rest := ref[len(shotPrefix):]
	var s shotRef
	if file, frag, ok := strings.Cut(rest, "#"); ok {
		s.File, s.Name = file, frag
		if i := strings.LastIndex(frag, "@"); i >= 0 {
			s.Name, s.Box, s.HasBox = frag[:i], frag[i+1:], true
		}
	} else {
		s.File = rest
		if i := strings.LastIndex(rest, "@"); i >= 0 && strings.Contains(rest[i+1:], ",") {
			s.File, s.Box, s.HasBox = rest[:i], rest[i+1:], true
		}
	}
	s.File, s.Name, s.Box = strings.TrimSpace(s.File), strings.TrimSpace(s.Name), strings.TrimSpace(s.Box)
	return s, true
}

// shotBox is a box as fractions (0..1) of the image's width and height: its top-left corner and its size.
type shotBox struct{ X, Y, W, H float64 }

// parseBox reads "x,y,w,h" as four finite numbers.
func parseBox(s string) (shotBox, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return shotBox{}, fmt.Errorf("the box %q is not four numbers x,y,w,h", s)
	}
	var n [4]float64
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			return shotBox{}, fmt.Errorf("the box %q is not four numbers x,y,w,h", s)
		}
		n[i] = v
	}
	return shotBox{n[0], n[1], n[2], n[3]}, nil
}

// fitBox is the box clamped into the image when it reaches past an edge by no more than boxSlack, or why it does not
// lie inside the image.
func fitBox(b shotBox) (shotBox, error) {
	outside := func(why string) (shotBox, error) {
		return shotBox{}, errors.New("the box is not inside the image: " + why)
	}
	if b.X < -boxSlack || b.Y < -boxSlack {
		return outside("x and y are fractions from 0 to 1, and one is negative")
	}
	if b.W <= 0 || b.H <= 0 {
		return outside("its width and height must be more than 0")
	}
	if b.X < 0 {
		b.W, b.X = b.W+b.X, 0
	}
	if b.Y < 0 {
		b.H, b.Y = b.H+b.Y, 0
	}
	if b.X+b.W > 1+boxSlack {
		return outside(fmt.Sprintf("x+w is %.2f, past the right edge at 1", b.X+b.W))
	}
	if b.Y+b.H > 1+boxSlack {
		return outside(fmt.Sprintf("y+h is %.2f, past the bottom edge at 1", b.Y+b.H))
	}
	b.W, b.H = min(b.W, 1-b.X), min(b.H, 1-b.Y)
	if b.W <= 0 || b.H <= 0 {
		return outside("it has no width or no height left inside the image")
	}
	return b, nil
}

// councilImages are the images a seat may box: the screenshots attached at setup (relative ones under the project),
// then the images the person pasted into the discussion, absolute and each once.
func councilImages(c *Council) []string {
	var out []string
	add := func(p string) {
		if p = strings.TrimSpace(p); p == "" {
			return
		}
		if !filepath.IsAbs(p) && strings.TrimSpace(c.Project) != "" {
			p = filepath.Join(c.Project, p)
		}
		p = filepath.Clean(p)
		if !slices.ContainsFunc(out, func(x string) bool { return samePath(x, p) }) {
			out = append(out, p)
		}
	}
	for _, s := range c.Screenshots {
		add(s)
	}
	for _, r := range c.Replies {
		if r.Author == YouId {
			for _, a := range r.Attachments {
				add(a)
			}
		}
	}
	return out
}

// resolveShot is the image a cited file names: an absolute path in images, or the one image with that base name. A name
// that matches none, or two, is an error that says so.
func resolveShot(file string, images []string) (string, error) {
	if file == "" {
		return "", errors.New("the cite names no image")
	}
	f := filepath.Clean(filepath.FromSlash(file))
	if filepath.IsAbs(f) {
		for _, img := range images {
			if samePath(img, f) {
				return img, nil
			}
		}
	}
	base := filepath.Base(f)
	var hits []string
	for _, img := range images {
		if samePath(filepath.Base(img), base) {
			hits = append(hits, img)
		}
	}
	switch len(hits) {
	case 0:
		return "", fmt.Errorf("no image named %s was given to this council", base)
	case 1:
		return hits[0], nil
	}
	return "", fmt.Errorf("%s names %d images; cite one by its full path", base, len(hits))
}

// Shots is what a screenshot cite is read against: the images the council was given (councilImages) and the folder its
// crops are drawn into.
type Shots struct {
	Images []string
	Dir    string
}

// shotsOf is the council's Shots.
func shotsOf(c *Council) *Shots {
	return &Shots{Images: councilImages(c), Dir: regionsDir(c.Id)}
}

// regionsDir is the folder a council's crops are drawn into: CouncilsDir/<id>/regions.
func regionsDir(id string) string {
	return filepath.Join(Dir(), id, regionsFolder)
}

// cropName is the file a crop of image at box is drawn as: one per distinct image and box, so the same cite made twice,
// or checked again, reuses it.
func cropName(img string, b shotBox) string {
	key := filepath.Clean(img)
	if isWindows {
		key = strings.ToLower(key)
	}
	sum := sha256.Sum256(fmt.Appendf(nil, "%s|%.4f,%.4f,%.4f,%.4f", key, b.X, b.Y, b.W, b.H))
	return hex.EncodeToString(sum[:8]) + ".png"
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// errNotDrawn is a crop that could not be saved: the disk, not the cite, is at fault, so it is logged as well as noted.
var errNotDrawn = errors.New("the region's image could not be saved")

// regionOf locates a boxed screenshot cite: its region, or why it cannot be drawn. A region already drawn stands while
// its PNG is on disk, even once the image it came from is gone; otherwise the box is read and fitted, the image resolved
// in shots, and the crop drawn unless a crop of the same image and box is there already.
func regionOf(e CouncilEvidence, s shotRef, shots *Shots) (*CouncilRegion, error) {
	if e.Region != nil && e.Region.Crop != "" && fileExists(e.Region.Crop) {
		return e.Region, nil
	}
	b, err := parseBox(s.Box)
	if err != nil {
		return nil, err
	}
	if b, err = fitBox(b); err != nil {
		return nil, err
	}
	img, err := resolveShot(s.File, shots.Images)
	if err != nil {
		return nil, err
	}
	reg := &CouncilRegion{Image: img, Crop: filepath.Join(shots.Dir, cropName(img, b)), X: b.X, Y: b.Y, W: b.W, H: b.H}
	if fileExists(reg.Crop) {
		return reg, nil
	}
	if err := drawCrop(img, b, reg.Crop); err != nil {
		return nil, err
	}
	return reg, nil
}

// drawCrop reads the image, cuts out the box with a margin of half its size each side (at least minCropSide on the long
// side, clamped to the image), draws a red rectangle just outside the box, and writes the PNG at out. It reads PNG,
// JPEG and GIF; any other format is an error that names it.
func drawCrop(src string, b shotBox, out string) error {
	f, err := os.Open(src)
	if errors.Is(err, fs.ErrNotExist) {
		return errors.New("the image is not on disk any more")
	}
	if err != nil {
		return errors.New("the image could not be read")
	}
	img, _, err := image.Decode(f)
	f.Close()
	if errors.Is(err, image.ErrFormat) {
		return fmt.Errorf("can't read %s images", formatName(src))
	}
	if err != nil {
		return errors.New("the image could not be read")
	}
	dst := cropRegion(img, b)
	var buf bytes.Buffer
	if err := png.Encode(&buf, dst); err != nil {
		return fmt.Errorf("%w: %v", errNotDrawn, err)
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return fmt.Errorf("%w: %v", errNotDrawn, err)
	}
	if err := fileutil.AtomicWriteFile(out, buf.Bytes(), 0o644); err != nil {
		return fmt.Errorf("%w: %v", errNotDrawn, err)
	}
	return nil
}

// formatName is the format a file's extension names, as a note reads it: "WEBP", or "this kind of" with none.
func formatName(path string) string {
	if ext := strings.TrimPrefix(filepath.Ext(path), "."); ext != "" {
		return strings.ToUpper(ext)
	}
	return "this kind of"
}

// cropRegion is the crop drawCrop writes, as an image.
func cropRegion(img image.Image, b shotBox) *image.RGBA {
	r := img.Bounds()
	w, h := float64(r.Dx()), float64(r.Dy())
	box := image.Rect(
		r.Min.X+int(math.Round(b.X*w)), r.Min.Y+int(math.Round(b.Y*h)),
		r.Min.X+int(math.Round((b.X+b.W)*w)), r.Min.Y+int(math.Round((b.Y+b.H)*h)),
	)
	if box.Dx() < 1 {
		box.Max.X = box.Min.X + 1
	}
	if box.Dy() < 1 {
		box.Max.Y = box.Min.Y + 1
	}
	box = box.Intersect(r)
	crop := image.Rect(box.Min.X-box.Dx()/2, box.Min.Y-box.Dy()/2, box.Max.X+box.Dx()/2, box.Max.Y+box.Dy()/2)
	if long := max(crop.Dx(), crop.Dy()); long < minCropSide {
		grow := (minCropSide - long + 1) / 2
		crop = crop.Inset(-grow)
	}
	crop = crop.Intersect(r)
	dst := image.NewRGBA(image.Rect(0, 0, crop.Dx(), crop.Dy()))
	draw.Draw(dst, dst.Bounds(), img, crop.Min, draw.Src)
	// the rectangle reads at the 240px the cockpit draws the crop at: about 2px there whatever the crop's size
	t := max(2, max(crop.Dx(), crop.Dy())/120)
	inner := box.Sub(crop.Min)
	outer := inner.Inset(-t)
	red := image.NewUniform(regionRed)
	for _, bar := range []image.Rectangle{
		image.Rect(outer.Min.X, outer.Min.Y, outer.Max.X, inner.Min.Y), // top
		image.Rect(outer.Min.X, inner.Max.Y, outer.Max.X, outer.Max.Y), // bottom
		image.Rect(outer.Min.X, inner.Min.Y, inner.Min.X, inner.Max.Y), // left
		image.Rect(inner.Max.X, inner.Min.Y, outer.Max.X, inner.Max.Y), // right
	} {
		draw.Draw(dst, bar.Intersect(dst.Bounds()), red, image.Point{}, draw.Src)
	}
	return dst
}

// regionAlt is a screenshot cite as an image's alt text in the document: the file and the region's name, no box.
func regionAlt(ref string) string {
	s, _ := parseShotRef(ref)
	alt := s.File
	if s.Name != "" {
		alt += "#" + s.Name
	}
	return strings.NewReplacer("[", "(", "]", ")").Replace(alt)
}

// copyRegions copies the crop of every screenshot region the document shows (sent messages, cites not wrong) into a
// folder beside the document at docPath, `<doc name>-regions/`, and maps each crop to the link the document reaches its
// copy by. The document then stands alone, and survives deleting the council. A crop no longer on disk, or one that will
// not copy (logged), is left out, and its message keeps the text ref only. It makes the folder only for a crop to copy.
func copyRegions(c *Council, docPath string) map[string]string {
	folder := strings.TrimSuffix(docPath, filepath.Ext(docPath)) + "-regions"
	links := map[string]string{}
	take := func(ev []CouncilEvidence) {
		for _, e := range ev {
			if e.Region == nil || e.Cite == CiteWrong || links[e.Region.Crop] != "" || !fileExists(e.Region.Crop) {
				continue
			}
			name := filepath.Base(e.Region.Crop)
			if err := copyFile(e.Region.Crop, filepath.Join(folder, name)); err != nil {
				log.Printf("[council] %s: the document leaves out a region: %v", c.Id, err)
				continue
			}
			link := filepath.Base(folder) + "/" + name
			if strings.ContainsAny(link, " ()<>") {
				link = "<" + link + ">"
			}
			links[e.Region.Crop] = link
		}
	}
	for _, p := range sentProposals(c) {
		take(p.Evidence)
	}
	for _, r := range c.Replies {
		if Sent(r.Draft) {
			take(r.Evidence)
		}
	}
	return links
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dst, b, 0o644)
}

// drawRegions locates and draws the boxed screenshot cites of every proposal and reply, in every mode and whether or not
// the message is checked, and labels nothing: a cite it cannot draw keeps no region, and its message, if checked, says
// why through ApplyChecks. It runs on every save (writeLocked), and a region already drawn costs it one stat.
func drawRegions(c *Council) {
	var shots *Shots
	locate := func(ev []CouncilEvidence) {
		for i := range ev {
			s, ok := parseShotRef(ev[i].Ref)
			if !ok || !s.HasBox {
				continue
			}
			if shots == nil {
				shots = shotsOf(c)
			}
			reg, err := regionOf(ev[i], s, shots)
			if errors.Is(err, errNotDrawn) {
				log.Printf("[council] %s: %s: %v", c.Id, ev[i].Ref, err)
			}
			ev[i].Region = reg
		}
	}
	for i := range c.Proposals {
		locate(c.Proposals[i].Evidence)
	}
	for i := range c.Replies {
		locate(c.Replies[i].Evidence)
	}
}
