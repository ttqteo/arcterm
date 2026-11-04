// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writePNG writes a w×h grey PNG at path and returns the path.
func writePNG(t *testing.T, path string, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: 120, G: 120, B: 120, A: 255})
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
	return path
}

func readPNG(t *testing.T, path string) image.Image {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func TestParseShotRef(t *testing.T) {
	for _, c := range []struct {
		ref  string
		want shotRef
		ok   bool
	}{
		{"screenshot:home.png#save@0.1,0.2,0.3,0.4", shotRef{File: "home.png", Name: "save", Box: "0.1,0.2,0.3,0.4", HasBox: true}, true},
		{"Screenshot:home.png#save", shotRef{File: "home.png", Name: "save"}, true},
		{"screenshot:shot@2x.png#top", shotRef{File: "shot@2x.png", Name: "top"}, true},
		{"screenshot:shot@2x.png#top@0,0,1,1", shotRef{File: "shot@2x.png", Name: "top", Box: "0,0,1,1", HasBox: true}, true},
		{"screenshot:home.png@0,0,0.5,0.5", shotRef{File: "home.png", Box: "0,0,0.5,0.5", HasBox: true}, true},
		{"screenshot:shot@2x.png", shotRef{File: "shot@2x.png"}, true},
		{"screenshot:home.png#save@", shotRef{File: "home.png", Name: "save", HasBox: true}, true},
		{"pkg/x.go:3", shotRef{}, false},
	} {
		got, ok := parseShotRef(c.ref)
		if ok != c.ok || got != c.want {
			t.Errorf("parseShotRef(%q) = %+v, %v; want %+v, %v", c.ref, got, ok, c.want, c.ok)
		}
	}
}

func TestCheckEvidenceScreenshots(t *testing.T) {
	dir := t.TempDir()
	home := writePNG(t, filepath.Join(dir, "shots", "home.png"), 400, 200)
	twinA := writePNG(t, filepath.Join(dir, "a", "twin.png"), 50, 50)
	twinB := writePNG(t, filepath.Join(dir, "b", "twin.png"), 50, 50)
	webp := filepath.Join(dir, "anim.webp")
	if err := os.WriteFile(webp, []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), 0o644); err != nil {
		t.Fatal(err)
	}
	gone := filepath.Join(dir, "gone.png") // given, never on disk
	shots := &Shots{Images: []string{home, twinA, twinB, webp, gone}, Dir: filepath.Join(dir, "regions")}

	for _, c := range []struct {
		name, ref, cite, noteHas string
	}{
		{"a boxed cite", "screenshot:home.png#save@0.25,0.25,0.25,0.25", CiteOK, ""},
		{"by its absolute path", "screenshot:" + home + "#save@0.25,0.25,0.25,0.25", CiteOK, ""},
		{"by a path whose base name is given", "screenshot:elsewhere/home.png#save@0.25,0.25,0.25,0.25", CiteOK, ""},
		{"a box a hair past the edge is clamped", "screenshot:home.png#edge@0.9,0.9,0.105,0.1", CiteOK, ""},
		{"a box outside the image", "screenshot:home.png#save@0.8,0.1,0.5,0.1", CiteWrong, "past the right edge"},
		{"a box below the image", "screenshot:home.png#save@0.1,0.8,0.1,0.5", CiteWrong, "past the bottom edge"},
		{"a negative corner", "screenshot:home.png#save@-0.2,0.1,0.1,0.1", CiteWrong, "negative"},
		{"a box with no width", "screenshot:home.png#save@0.1,0.1,0,0.1", CiteWrong, "more than 0"},
		{"a box that does not parse", "screenshot:home.png#save@left,top", CiteWrong, "not four numbers"},
		{"an empty box", "screenshot:home.png#save@", CiteWrong, "not four numbers"},
		{"an unknown file", "screenshot:other.png#save@0.1,0.1,0.1,0.1", CiteWrong, "no image named other.png"},
		{"a name matching two images", "screenshot:twin.png#x@0.1,0.1,0.1,0.1", CiteWrong, "names 2 images"},
		{"a format the standard library cannot read", "screenshot:anim.webp#x@0.1,0.1,0.1,0.1", CiteWrong, "can't read WEBP images"},
		{"an image no longer on disk", "screenshot:gone.png#x@0.1,0.1,0.1,0.1", CiteWrong, "not on disk"},
		{"a name-only cite is unchecked", "screenshot:home.png#save", "", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := CheckEvidence([]CouncilEvidence{{Ref: c.ref}}, nil, shots)[0]
			if got.Cite != c.cite {
				t.Fatalf("Cite = %q (%q), want %q", got.Cite, got.CiteNote, c.cite)
			}
			if c.noteHas != "" && !strings.Contains(got.CiteNote, c.noteHas) {
				t.Errorf("CiteNote = %q, want it to hold %q", got.CiteNote, c.noteHas)
			}
			if c.cite == CiteOK {
				if got.Region == nil || !fileExists(got.Region.Crop) || got.Region.Image != home {
					t.Fatalf("Region = %+v, want a drawn crop of %s", got.Region, home)
				}
				if got.Region.X+got.Region.W > 1 || got.Region.Y+got.Region.H > 1 {
					t.Errorf("the box was not clamped into the image: %+v", got.Region)
				}
			} else if got.Region != nil {
				t.Errorf("a cite that is not ok has a region: %+v", got.Region)
			}
		})
	}
	// with no Shots, a screenshot cite is left unchecked as before
	if got := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:home.png#save@0.25,0.25,0.25,0.25"}}, nil, nil)[0]; got.Cite != "" || got.Region != nil {
		t.Errorf("with no shots, got %+v, want it unchecked", got)
	}
	// a name-only cite is no evidence: the claim it backs is a Guess
	nameOnly := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:home.png#save"}}, nil, shots)
	if l := LabelOf(nameOnly, nil); l != LabelGuess {
		t.Errorf("a claim citing a region with no box is %q, want %q", l, LabelGuess)
	}
	boxed := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:home.png#save@0.25,0.25,0.25,0.25"}}, nil, shots)
	if l := LabelOf(boxed, nil); l != LabelRead {
		t.Errorf("a claim citing a boxed region is %q, want %q", l, LabelRead)
	}
}

// the crop is the box plus half its size each side, with a red rectangle just outside the box, and it is drawn once
func TestRegionCropIsDrawnOnceAtItsSize(t *testing.T) {
	dir := t.TempDir()
	home := writePNG(t, filepath.Join(dir, "home.png"), 400, 200)
	shots := &Shots{Images: []string{home}, Dir: filepath.Join(dir, "regions")}
	ev := []CouncilEvidence{{Ref: "screenshot:home.png#save@0.25,0.25,0.25,0.25"}}

	first := CheckEvidence(ev, nil, shots)[0]
	if first.Region == nil {
		t.Fatalf("no region: %+v", first)
	}
	crop := readPNG(t, first.Region.Crop)
	// the box is 100×50 at (100,50); half its size each side is (50,25)-(250,125)
	if b := crop.Bounds(); b.Dx() != 200 || b.Dy() != 100 {
		t.Errorf("crop is %d×%d, want 200×100", b.Dx(), b.Dy())
	}
	isRed := func(x, y int) bool {
		r, g, b, _ := crop.At(x, y).RGBA()
		return r>>8 == uint32(regionRed.R) && g>>8 == uint32(regionRed.G) && b>>8 == uint32(regionRed.B)
	}
	// the box's left edge is at x=50 in the crop: the rectangle sits just outside it, the box itself stays clear
	if !isRed(49, 50) || !isRed(48, 50) {
		t.Error("no red rectangle just outside the box's left edge")
	}
	if isRed(50, 50) || isRed(100, 50) || isRed(10, 10) {
		t.Error("red inside the box or in the margin")
	}

	// a second check of the same cite, the same cite in another message, reuse the PNG: it is not drawn again
	if err := os.WriteFile(first.Region.Crop, []byte("kept"), 0o644); err != nil {
		t.Fatal(err)
	}
	again := CheckEvidence([]CouncilEvidence{{Ref: ev[0].Ref}}, nil, shots)[0]
	if again.Cite != CiteOK || again.Region.Crop != first.Region.Crop {
		t.Fatalf("second check = %+v, want ok with the same crop", again)
	}
	if b, _ := os.ReadFile(first.Region.Crop); string(b) != "kept" {
		t.Error("the crop was drawn again")
	}
}

// a small box still gets a crop of at least minCropSide on its long side, clamped to the image
func TestRegionCropKeepsNeighbours(t *testing.T) {
	dir := t.TempDir()
	home := writePNG(t, filepath.Join(dir, "home.png"), 400, 200)
	shots := &Shots{Images: []string{home}, Dir: filepath.Join(dir, "regions")}
	got := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:home.png#dot@0.5,0.5,0.01,0.01"}}, nil, shots)[0]
	if got.Region == nil {
		t.Fatalf("no region: %+v", got)
	}
	b := readPNG(t, got.Region.Crop).Bounds()
	if max(b.Dx(), b.Dy()) < minCropSide {
		t.Errorf("crop is %d×%d, want its long side at least %d", b.Dx(), b.Dy(), minCropSide)
	}
	corner := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:home.png#corner@0,0,0.01,0.01"}}, nil, shots)[0]
	if b := readPNG(t, corner.Region.Crop).Bounds(); b.Dx() > 400 || b.Dy() > 200 {
		t.Errorf("a corner's crop is %d×%d, past the image", b.Dx(), b.Dy())
	}
}

// once drawn, a region stands: a check that no longer finds its image keeps it ok, with its crop
func TestRegionStandsOnceTheImageIsGone(t *testing.T) {
	dir := t.TempDir()
	pasted := writePNG(t, filepath.Join(dir, "attachments", "paste-1.png"), 300, 300)
	c := &Council{Id: "c1", Replies: []CouncilReply{
		{Id: "y1", Author: YouId, Text: "look", Attachments: []string{pasted}},
	}}
	shots := &Shots{Images: councilImages(c), Dir: filepath.Join(dir, "regions")}
	first := CheckEvidence([]CouncilEvidence{{Ref: "screenshot:paste-1.png#chart@0.1,0.1,0.5,0.5"}}, nil, shots)
	if first[0].Cite != CiteOK || first[0].Region == nil {
		t.Fatalf("a pasted image's region = %+v, want ok and drawn", first[0])
	}
	if err := os.Remove(pasted); err != nil {
		t.Fatal(err)
	}
	second := CheckEvidence(first, nil, &Shots{Dir: shots.Dir})[0]
	if second.Cite != CiteOK || second.Region == nil || second.Region.Crop != first[0].Region.Crop {
		t.Errorf("after the image went, got %+v, want ok with the same crop", second)
	}
}

func TestCouncilImages(t *testing.T) {
	project := t.TempDir()
	other := t.TempDir()
	abs, pasted := filepath.Join(other, "a.png"), filepath.Join(other, "c.png")
	c := &Council{
		Project:     project,
		Screenshots: []string{abs, "docs/b.png", abs},
		Replies: []CouncilReply{
			{Author: YouId, Attachments: []string{filepath.Join(project, "docs", "b.png"), pasted}},
			{Author: "ux", Attachments: []string{filepath.Join(other, "seat.png")}}, // only the person attaches
		},
	}
	got := councilImages(c)
	want := []string{abs, filepath.Join(project, "docs", "b.png"), pasted}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("councilImages = %v, want %v", got, want)
	}
}

// the crop pass runs on every save, in every mode: a Brainstorm's plain idea, which nothing checks, gets its crop, and
// labels nothing
func TestSaveDrawsRegionsInEveryMode(t *testing.T) {
	useTempRoot(t)
	dir := t.TempDir()
	home := writePNG(t, filepath.Join(dir, "home.png"), 200, 200)
	c := testCouncil("bs1")
	c.Mode, c.Screenshots = ModeBrainstorm, []string{home}
	c.Proposals = []CouncilProposal{{Id: "P1", Author: "ux", Title: "t", Evidence: []CouncilEvidence{
		{Ref: "screenshot:home.png#a@0.1,0.1,0.2,0.2"},
		{Ref: "screenshot:nope.png#a@0.1,0.1,0.2,0.2"},
	}}}
	if err := Save(c); err != nil {
		t.Fatal(err)
	}
	got, err := Load("bs1")
	if err != nil {
		t.Fatal(err)
	}
	ev := got.Proposals[0].Evidence
	if ev[0].Region == nil || !strings.HasPrefix(ev[0].Region.Crop, regionsDir("bs1")) || !fileExists(ev[0].Region.Crop) {
		t.Errorf("the boxed cite's region = %+v, want a crop under %s", ev[0].Region, regionsDir("bs1"))
	}
	if ev[0].Cite != "" || ev[1].Cite != "" || ev[1].Region != nil {
		t.Errorf("the crop pass labelled something: %+v", ev)
	}

	// deleting the council takes its regions folder with it
	if err := Remove("bs1"); err != nil {
		t.Fatal(err)
	}
	if dirExists(filepath.Join(Dir(), "bs1")) {
		t.Error("the council's regions folder stayed after Remove")
	}
}

// the saved document copies the crops beside itself and embeds them under the evidence line; a crop no longer on disk
// stays the text ref
func TestWriteDocumentEmbedsRegions(t *testing.T) {
	useDocDay(t)
	useTempRoot(t)
	project := t.TempDir()
	home := writePNG(t, filepath.Join(t.TempDir(), "home.png"), 200, 200)
	c := docCouncil(project)
	c.Screenshots = []string{home}
	c.Proposals[0].Evidence = []CouncilEvidence{{Ref: "screenshot:home.png#save@0.1,0.1,0.2,0.2"}}
	c.Proposals[1].Evidence = []CouncilEvidence{{Ref: "screenshot:home.png#lost@0.5,0.5,0.2,0.2"}}
	ApplyChecks(c, nil)
	lost := c.Proposals[1].Evidence[0].Region
	if lost == nil {
		t.Fatal("the second region was not drawn")
	}
	if err := os.Remove(lost.Crop); err != nil {
		t.Fatal(err)
	}
	path, err := WriteDocument(c, "")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(path)
	folder := strings.TrimSuffix(filepath.Base(path), ".md") + "-regions"
	kept := filepath.Base(c.Proposals[0].Evidence[0].Region.Crop)
	if !strings.Contains(string(body), "  ![home.png#save]("+folder+"/"+kept+")\n") {
		t.Errorf("the document does not embed the region:\n%s", body)
	}
	if strings.Contains(string(body), "home.png#lost]") {
		t.Errorf("the document embeds a crop no longer on disk:\n%s", body)
	}
	if !strings.Contains(string(body), "screenshot:home.png#lost@0.5,0.5,0.2,0.2") {
		t.Error("the missing crop's text ref is gone")
	}
	if !fileExists(filepath.Join(filepath.Dir(path), folder, kept)) {
		t.Error("the crop was not copied beside the document")
	}
	if Document(c) == string(body) {
		t.Error("Document embeds no region, so the file should differ from it")
	}
}
