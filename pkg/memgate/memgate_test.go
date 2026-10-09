// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memgate

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		command string
		heavy   bool
		name    string
		bytes   uint64
	}{
		// builds
		{"task tauri:build", true, "task tauri:build", 3584 * mib},
		{"task build:app", true, "task tauri:build", 3584 * mib},
		{"BUMP=patch task tauri:build", true, "task tauri:build", 3584 * mib},
		{"cd /x && NODE_OPTIONS=--max-old-space-size=4096 task tauri:build > build.log 2>&1; echo EXIT=$?", true, "task tauri:build", 3584 * mib},
		{"npm run build", true, "task tauri:build", 3584 * mib},
		{"cargo tauri build", true, "cargo tauri build", 3 * gib},
		{"task dev", true, "task dev", 3 * gib},
		{"task tauri:dev", true, "task dev", 3 * gib},
		{"cargo tauri dev", true, "task dev", 3 * gib},
		{"npx vite build --config frontend/tauri/vite.config.ts", true, "vite build", 3 * gib},
		{"task build:backend", true, "task build:backend", 1536 * mib},
		{"cargo build --release", true, "cargo build", 2 * gib},
		{"cargo test --manifest-path src-tauri/Cargo.toml", true, "cargo test", 2 * gib},
		{"npm install", true, "npm install", 1 * gib},
		{"npm ci", true, "npm install", 1 * gib},
		{"task init", true, "npm install", 1 * gib},

		// typecheck
		{"task check:ts", true, "task check:ts", 3 * gib},
		{"node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit", true, "task check:ts", 3 * gib},
		{"npx tsc --noEmit", true, "task check:ts", 3 * gib},

		// whole test suites
		{"npm test", true, "vitest (all)", 2 * gib},
		{"npx vitest", true, "vitest (all)", 2 * gib},
		{"npx vitest run", true, "vitest (all)", 2 * gib},
		{"go test ./...", true, "go test ./...", 2560 * mib},
		{"go test ./pkg/... ./cmd/...", true, "go test ./...", 2560 * mib},
		{"node scripts/verify.mjs ./pkg/orchestrate", true, "scripts/verify.mjs", 2560 * mib},
		{"ARC_VERIFY_CHANGED=/tmp/c node scripts/verify.mjs ./pkg/x", true, "scripts/verify.mjs", 2560 * mib},
		{"go test ./pkg/orchestrate", true, "go test pkg/orchestrate", 2 * gib},

		// a single test or file is light
		{"npx vitest run frontend/app/view/agents/projectname.test.ts", false, "", 0},
		{`npx vitest run -t "handles backslash paths"`, false, "", 0},
		{"npm test -- frontend/util/keyutil.test.ts", false, "", 0},
		{"go test ./pkg/memgate", false, "", 0},
		{"go test ./pkg/orchestrate -run '^TestMerge$'", false, "", 0},

		// not heavy at all
		{"git status --short", false, "", 0},
		{"ls dist/bin", false, "", 0},
		{"task --dry build:wsh", false, "", 0},
		{"task --list", false, "", 0},
		{`grep -n "task tauri:build" Taskfile.yml`, false, "", 0},
		{`echo "npm test"`, false, "", 0},
		{"cat Taskfile.yml | grep tauri:build", false, "", 0},
		{`echo "a && task check:ts"`, false, "", 0},
		{`git commit -m 'run npm test; then task tauri:build'`, false, "", 0},
		{"(CGO_ENABLED=0 GOOS=darwin go build -o dist/bin/wsh cmd/wsh/main-wsh.go)", false, "", 0},
		{"(cd frontend && npx vitest run)", true, "vitest (all)", 2 * gib},
		{"", false, "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.command, func(t *testing.T) {
			job, heavy := Classify(tc.command)
			if heavy != tc.heavy || job.Name != tc.name || job.Bytes != tc.bytes {
				t.Fatalf("Classify(%q) = %+v, %v; want {%s %d}, %v", tc.command, job, heavy, tc.name, tc.bytes, tc.heavy)
			}
		})
	}
}

func TestClassifyTakesTheHeaviestStep(t *testing.T) {
	job, heavy := Classify("npm install && task check:ts && npx vitest run")
	if !heavy || job.Name != "task check:ts" || job.Bytes != 3*gib {
		t.Fatalf("got %+v, %v; want the typecheck, the heaviest step", job, heavy)
	}
}

func TestLongRunningIsTheDevServer(t *testing.T) {
	cases := map[string]bool{
		"task dev":         true,
		"cargo tauri dev":  true,
		"task check:ts":    false,
		"task tauri:build": false,
	}
	for command, want := range cases {
		job, heavy := Classify(command)
		if !heavy || job.LongRunning() != want {
			t.Fatalf("Classify(%q) = %+v, %v; want heavy, LongRunning %v", command, job, heavy, want)
		}
	}
	if DevBytes != 3*gib {
		t.Fatalf("DevBytes = %d, want 3 GB", DevBytes)
	}
}

func TestFits(t *testing.T) {
	job := Job{Name: "task check:ts", Bytes: 3 * gib}
	cases := []struct {
		name      string
		available uint64
		want      bool
	}{
		{"room for the job and the headroom", 3*gib + Headroom, true},
		{"plenty", 6 * gib, true},
		{"the job fits but not the headroom", 3 * gib, false},
		{"short", 1 * gib, false},
		{"nothing free", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Fits(job, tc.available); got != tc.want {
				t.Fatalf("Fits(%d) = %v, want %v", tc.available, got, tc.want)
			}
		})
	}
}

func TestFormatGB(t *testing.T) {
	cases := map[uint64]string{
		3584 * mib: "3.5 GB",
		3 * gib:    "3 GB",
		1843 * mib: "1.8 GB",
		8 * gib:    "8 GB",
		300 * mib:  "0.3 GB",
	}
	for in, want := range cases {
		if got := FormatGB(in); got != want {
			t.Fatalf("FormatGB(%d) = %q, want %q", in, got, want)
		}
	}
}
