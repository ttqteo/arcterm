// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import "testing"

func TestClassifyDocker(t *testing.T) {
	cases := []struct {
		command     string
		heavy       bool
		name        string
		longRunning bool
	}{
		{"docker build -t img .", true, "docker build", false},
		{"docker --context ci build .", true, "docker build", false},
		{"docker image build .", true, "docker build", false},
		{"docker buildx build --platform linux/amd64 .", true, "docker buildx build", false},
		{"docker compose build", true, "docker compose build", false},
		{"docker compose -f ci.yml up -d", true, "docker compose up -d", false},
		{"docker compose up --detach web", true, "docker compose up -d", false},
		{"docker compose up --wait", true, "docker compose up -d", false},
		{"docker-compose up -d", true, "docker compose up -d", false},
		// in the foreground it runs until stopped, like a dev server: it never queues
		{"docker compose up", true, "docker compose up", true},
		{"docker compose -p thesis up web", true, "docker compose up", true},
		// the rest of docker is light
		{"docker run --rm img", false, "", false},
		{"docker ps", false, "", false},
		{"docker compose logs -f", false, "", false},
		{"docker image ls", false, "", false},
	}
	for _, c := range cases {
		job, heavy := Classify(c.command)
		if heavy != c.heavy || job.Name != c.name || job.LongRunning() != c.longRunning {
			t.Errorf("Classify(%q) = %+v, %v (long %v); want %v %q long %v",
				c.command, job, heavy, job.LongRunning(), c.heavy, c.name, c.longRunning)
		}
		if heavy && job.Bytes != 2*gib {
			t.Errorf("Classify(%q) bytes = %d, want 2 GB", c.command, job.Bytes)
		}
	}
}

// jobmeter cannot see inside docker's VM, so its commands keep the table's figure: no peak is kept under a pattern
func TestDockerIsNeverMeasured(t *testing.T) {
	for _, command := range []string{"docker build .", "docker compose up -d", "docker compose up", "docker buildx build ."} {
		if _, _, ok := Pattern(command); ok {
			t.Errorf("Pattern(%q) is ok; docker's peak runs outside the process tree", command)
		}
	}
}

// a line that starts with wsh protect takes no slot of its own (it would wait on itself) and is never learned
func TestWshProtectTakesNoSlot(t *testing.T) {
	learned := map[string]bool{"wsh protect": true, "python scripts/audit_guard.py": true}
	for _, command := range []string{
		"wsh protect -- python scripts/audit_guard.py",
		"wsh protect -- npm test",
		"~/.arc/bin/wsh.exe protect -- task check:ts",
		"cd /work && wsh protect -- go test ./... && npm test",
		`bash -c "wsh protect -- docker compose up -d"`,
	} {
		if job, heavy := ClassifyWith(command, learned); heavy {
			t.Errorf("ClassifyWith(%q) = %+v, heavy; want no slot", command, job)
		}
		if !Protected(command) {
			t.Errorf("Protected(%q) = false", command)
		}
		if _, _, ok := Pattern(command); ok {
			t.Errorf("Pattern(%q) is ok; a protected line is never learned", command)
		}
	}
	for _, command := range []string{"npm test && wsh protect -- python x.py", "wsh agents list", "echo wsh protect"} {
		if Protected(command) {
			t.Errorf("Protected(%q) = true", command)
		}
	}
	if _, heavy := Classify("npm test && wsh protect -- python x.py"); !heavy {
		t.Error("a heavy step before wsh protect still takes a slot")
	}
}
