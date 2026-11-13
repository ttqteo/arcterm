package ctxbreakdown

import (
	"os"
	"testing"
)

func TestParseTokens(t *testing.T) {
	cases := map[string]int{"676": 676, "2.5k": 2500, "958.1k": 958100, "1m": 1000000, "~80": 80, " 14.8k ": 14800, "1,024": 1024}
	for in, want := range cases {
		got, ok := ParseTokens(in)
		if !ok || got != want {
			t.Errorf("ParseTokens(%q) = %d, %v; want %d", in, got, ok, want)
		}
	}
	if _, ok := ParseTokens("—"); ok {
		t.Error("a dash is not a token count")
	}
}

func TestParseRealReport(t *testing.T) {
	raw, err := os.ReadFile("testdata/context-opus-1m.md")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Parse(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if b.Model != "claude-opus-5-5" || b.WindowTokens != 1000000 {
		t.Fatalf("model/window = %q/%d", b.Model, b.WindowTokens)
	}
	if len(b.Categories) != 12 || b.Categories[0].Name != "System prompt" || b.Categories[0].Tokens != 2500 {
		t.Fatalf("categories = %+v", b.Categories)
	}
	var deferred int
	for _, c := range b.Categories {
		if c.Deferred {
			deferred++
		}
	}
	if deferred != 2 {
		t.Errorf("deferred categories = %d, want 2 (MCP tools, System tools)", deferred)
	}
	if len(b.MemoryFiles) != 3 || b.MemoryFiles[2].Name != "AGENTS.md" || b.MemoryFiles[2].Source != "Project" ||
		b.MemoryFiles[2].Path != `D:\work\arcterm\AGENTS.md` || b.MemoryFiles[2].Tokens != 14800 {
		t.Errorf("memory files = %+v", b.MemoryFiles)
	}
	if len(b.Skills) == 0 || b.Skills[0].Name != "graphify" || b.Skills[0].Source != "User" || b.Skills[0].Tokens != 80 {
		t.Fatalf("skills = %+v", b.Skills)
	}
	if len(b.Agents) != 2 || b.Agents[1].Name != "superpowers:code-reviewer" || b.Agents[1].Source != "Plugin" {
		t.Errorf("agents = %+v", b.Agents)
	}
	var stitch *struct{ tools, tokens int }
	for _, m := range b.McpServers {
		if m.Server == "stitch" {
			stitch = &struct{ tools, tokens int }{m.Tools, m.Tokens}
		}
	}
	if stitch == nil || stitch.tools != 18 {
		t.Errorf("stitch = %+v, want 18 tools", stitch)
	}
}

func TestParseKeepsUnknownCategoryAndFailsWithoutTable(t *testing.T) {
	md := "**Tokens:** 10k / 200k (5%)\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|---|---|---|\n| Brand new thing | 1.2k | 0.6% |\n| Messages | 300 | 0.1% |\n"
	b, err := Parse(md)
	if err != nil || len(b.Categories) != 2 || b.Categories[0].Name != "Brand new thing" || b.WindowTokens != 200000 {
		t.Fatalf("b = %+v, err = %v", b, err)
	}
	if b.MemoryFiles == nil || b.Skills == nil || b.Agents == nil || b.McpServers == nil {
		t.Error("missing tables must be empty slices, not nil, so the wire carries []")
	}
	if _, err := Parse("## Context Usage\n\nnothing here\n"); err == nil {
		t.Error("no category table must be an error")
	}
}
