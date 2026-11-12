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
		{"npm run build", true, "npm run build", 3584 * mib},
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

		// a redirection and its target are not operands: the whole suite still runs
		{"npm test 2>&1 | tail -50", true, "vitest (all)", 2 * gib},
		{"npx vitest run 2>&1 | tail -40", true, "vitest (all)", 2 * gib},
		{"npx vitest run > /tmp/out.txt", true, "vitest (all)", 2 * gib},
		{"npx vitest run >/tmp/out.txt 2>&1", true, "vitest (all)", 2 * gib},
		{"npx vitest run >> out.log 2> err.log", true, "vitest (all)", 2 * gib},
		{"npx vitest run &> out.log", true, "vitest (all)", 2 * gib},
		{"npx vitest run &>>out.log", true, "vitest (all)", 2 * gib},
		{`npx vitest run > "out file.log" 2>/dev/null`, true, "vitest (all)", 2 * gib},
		{"npx vitest run < /dev/null", true, "vitest (all)", 2 * gib},
		{"npx vitest run >&2", true, "vitest (all)", 2 * gib},
		{"npm run test 1>/dev/null", true, "vitest (all)", 2 * gib},
		{"npx vitest run frontend/a.test.ts 2>&1 | tail -20", false, "", 0},
		{"npm test -- frontend/util/keyutil.test.ts > out.txt 2>&1", false, "", 0},
		{`npx vitest run ">"`, false, "", 0},

		// a wrapper that only runs the command, its own flags (and their values) skipped, by any path
		{"nice -n 10 task check:ts", true, "task check:ts", 3 * gib},
		{"nice -10 task check:ts", true, "task check:ts", 3 * gib},
		{"nice --adjustment=5 npx vitest run", true, "vitest (all)", 2 * gib},
		{"time -p task check:ts", true, "task check:ts", 3 * gib},
		{"/usr/bin/time -l task check:ts", true, "task check:ts", 3 * gib},
		{"/usr/bin/time -f %M -o mem.txt npx vitest run", true, "vitest (all)", 2 * gib},
		{"env -u FOO task check:ts", true, "task check:ts", 3 * gib},
		{"env -i PATH=/usr/bin:/bin task check:ts", true, "task check:ts", 3 * gib},
		{"/usr/bin/env NODE_OPTIONS=--max-old-space-size=4096 task check:ts", true, "task check:ts", 3 * gib},
		{"env -- task check:ts", true, "task check:ts", 3 * gib},
		{"nohup task tauri:build > build.log 2>&1 &", true, "task tauri:build", 3584 * mib},
		{"caffeinate -i task tauri:build", true, "task tauri:build", 3584 * mib},
		{"caffeinate -t 3600 -s task tauri:build", true, "task tauri:build", 3584 * mib},
		{"gtimeout 600 npx vitest run", true, "vitest (all)", 2 * gib},
		{"/usr/bin/timeout -k 5 600 task check:ts", true, "task check:ts", 3 * gib},
		{"nice -n 10 git status", false, "", 0},
		{"time -p", false, "", 0},
		{"nohup", false, "", 0},
		// command -v / -V looks a program up, it does not run it
		{"command -v tsc", false, "", 0},
		{"command -V tsc", false, "", 0},
		{"command -p task check:ts", true, "task check:ts", 3 * gib},

		// arcterm's own heavy scripts: Final starts a dev app and a browser; the release build is task tauri:build
		{"node scripts/cdp/final-verify.mjs agent-chat", true, "scripts/cdp/final-verify.mjs", 3 * gib},
		{"node scripts/cdp/final-verify.mjs", true, "scripts/cdp/final-verify.mjs", 3 * gib},
		{"ARC_FINAL_OUT=/tmp/f node --experimental-websocket /w/arcterm/scripts/cdp/final-verify.mjs surface-smoke", true, "scripts/cdp/final-verify.mjs", 3 * gib},
		{"node --experimental-websocket scripts/cdp/verify.mjs agent-chat", false, "", 0},
		{"node scripts/release-build.mjs --bump none --from HEAD", true, "task tauri:build", 3584 * mib},
		{"go build ./...", true, "go build ./...", 1536 * mib},
		{"go vet ./...", true, "go vet ./...", 1536 * mib},
		{"go vet ./pkg/memgate", false, "", 0},
		{"go test -run=TestMerge ./pkg/orchestrate", false, "", 0},
		{"go test -run=TestMerge ./...", true, "go test ./...", 2560 * mib},

		// npm's flags before or after its command, and the ones that take a value
		{"npm --prefix frontend run build", true, "npm run build", 3584 * mib},
		{"npm -w web test", true, "vitest (all)", 2 * gib},
		{"npm --silent test", true, "vitest (all)", 2 * gib},
		{"npm test --prefix frontend", true, "vitest (all)", 2 * gib},
		{"npm --prefix frontend test -- src/a.test.ts", false, "", 0},
		{"npm exec tsc -- --noEmit", true, "task check:ts", 3 * gib},
		{"npm exec -- vitest run src/a.test.ts", false, "", 0},

		// a shell's -c string is a command line of its own
		{"bash -c 'task check:ts'", true, "task check:ts", 3 * gib},
		{"bash -lc 'task check:ts'", true, "task check:ts", 3 * gib},
		{"bash -c -l 'task check:ts 2>&1 | tail'", true, "task check:ts", 3 * gib},
		{`zsh -c "cd frontend && npx vitest run"`, true, "vitest (all)", 2 * gib},
		{"sh -c 'echo task check:ts'", false, "", 0},
		{"bash --norc scripts/e2e.sh", true, "e2e script", 4 * gib},

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

		// another project's suites and builds: a FastAPI + Vite/Astro app (pytest, pnpm, an e2e script)
		{"sh scripts/e2e.sh", true, "e2e script", 4 * gib},
		{"cd apps/portal && bash scripts/e2e.sh 2>&1 | tail -n 40", true, "e2e script", 4 * gib},
		{"./scripts/e2e.sh", true, "e2e script", 4 * gib},
		{`bash -c "echo scripts/e2e.sh"`, false, "", 0},
		{"timeout 1500 sh scripts/e2e.sh 2>&1", true, "e2e script", 4 * gib},
		{"cd apps/portal && SMOKE_ONLY=45-crosslinks timeout 1500 sh scripts/e2e.sh > e2e.log 2>&1", true, "e2e script", 4 * gib},
		{"timeout -k 10 -s KILL 30m npm run test:e2e", true, "e2e script", 4 * gib},
		{"timeout 5 curl -s localhost:4310", false, "", 0},
		{"timeout --preserve-status 600 task check:ts", true, "task check:ts", 3 * gib},
		{"node scripts/smoke.mjs", true, "smoke script", 1536 * mib},
		{"PORTAL_URL=http://127.0.0.1:4310 node scripts/smoke.mjs", true, "smoke script", 1536 * mib},
		{"node scripts/handbook.mjs --if-stale", false, "", 0},
		{"node scripts/report.mjs --out e2e.json", false, "", 0},
		{"npm run smoke", true, "smoke script", 1536 * mib},
		{"pnpm smoke", true, "smoke script", 1536 * mib},
		{"pnpm -C web run test:e2e", true, "e2e script", 4 * gib},
		{"pnpm -C web dev", false, "", 0},
		{"npm run lint", false, "", 0},
		{"npx playwright test", true, "e2e script", 4 * gib},
		{"npx playwright install chromium", false, "", 0},
		{"sh scripts/smoke-api.sh", true, "smoke script", 1536 * mib},
		{"sh scripts/deploy.sh", false, "", 0},
		{"pytest -q", true, "pytest (all)", 1 * gib},
		{"uv run --env-file ../web/.env pytest -q", true, "pytest (all)", 1 * gib},
		{"cd api; uv run --env-file ../web/.env pytest", true, "pytest (all)", 1 * gib},
		{"python -m pytest -x", true, "pytest (all)", 1 * gib},
		{"D:/w/api/.venv/Scripts/python.exe -m pytest", true, "pytest (all)", 1 * gib},
		{"uv run pytest tests/test_release_deploy.py -q", false, "", 0},
		{"uv run pytest tests/test_bundle.py::test_golden", false, "", 0},
		{`uv run pytest -k "deploy and not bulk"`, false, "", 0},
		{"uv run alembic upgrade head", false, "", 0},
		{"uv sync", false, "", 0},
		{"pnpm -C web test", true, "vitest (all)", 2 * gib},
		{"pnpm --dir web run test", true, "vitest (all)", 2 * gib},
		{"pnpm -C web test src/lib/auth.test.ts", false, "", 0},
		{"pnpm install", true, "npm install", 1 * gib},
		{"pnpm -C web build", true, "vite build", 3 * gib},
		{"pnpm exec vitest run", true, "vitest (all)", 2 * gib},
		{"pnpm -C web lint", false, "", 0},
		{`node --env-file-if-exists=.env "$M/web/node_modules/vitest/vitest.mjs" run`, true, "vitest (all)", 2 * gib},
		{"node node_modules/vitest/vitest.mjs run src/lib/auth.test.ts", false, "", 0},
		{"npx astro build", true, "astro build", 2 * gib},
		{"node web/node_modules/astro/bin/astro.mjs build", true, "astro build", 2 * gib},
		{"npx astro check", false, "", 0},
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

func TestSoloIsTheBrowserRuns(t *testing.T) {
	cases := map[string]bool{
		"sh scripts/e2e.sh":      true,
		"node scripts/smoke.mjs": true,
		"npx playwright test":    true,
		"task check:ts":          false,
		"npx vitest run":         false,
		"pytest -q":              false,
	}
	for command, want := range cases {
		job, heavy := Classify(command)
		if !heavy || Solo(job.Name) != want {
			t.Fatalf("Classify(%q) = %+v, %v; want heavy, Solo %v", command, job, heavy, want)
		}
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

func TestPattern(t *testing.T) {
	cases := []struct {
		command string
		name    string
		known   bool
		ok      bool
	}{
		// an unknown program: its name and its first word that is not a flag
		{"make build", "make build", false, true},
		{"make", "make", false, true},
		{"make -j4 build", "make build", false, true},
		{"gradle build --info", "gradle build", false, true},
		{"./gradlew build", "gradlew build", false, true},
		{"/usr/bin/make.exe all", "make all", false, true},
		{"env FOO=1 nice -n 5 gradle build --info", "gradle build", false, true},
		{"time make build", "make build", false, true},
		{"FOO=1 make build", "make build", false, true},
		{"timeout 600 mvn package", "mvn package", false, true},
		{"make build > build.log 2>&1", "make build", false, true},
		// steps that do no work, and the pipeline tails, are dropped
		{"cd web && make build 2>&1 | tail -5", "make build", false, true},
		{"cd web; export CI=1; make build", "make build", false, true},
		{"set -e && source env.sh && make build | tee build.log | grep -v warn", "make build", false, true},
		{"make build && echo done", "make build", false, true},
		{"(cd web && make build)", "make build", false, true},
		{"pushd web && make build && popd", "make build", false, true},
		// sh -c is not a program of its own: its command line is
		{`bash -c "make build"`, "make build", false, true},
		{`/bin/zsh -c -l "make build"`, "make build", false, true},
		{"bash -lc 'cd web && make build'", "make build", false, true},
		{"sh -c 'make build 2>&1 | tail -5'", "make build", false, true},
		{"bash -o pipefail -c 'make build'", "make build", false, true},
		{`bash -c "bash -c 'make build'"`, "make build", false, true},
		// a command in the table: the table's name
		{"task check:ts", "task check:ts", true, true},
		{"cd frontend && npx vitest", "vitest (all)", true, true},
		{"pnpm build", "vite build", true, true},
		{"npm test", "vitest (all)", true, true},
		{"export CI=1; task tauri:build 2>&1 | tail -20", "task tauri:build", true, true},
		{"bash -c 'task check:ts'", "task check:ts", true, true},
		{"cargo build --release", "cargo build", true, true},
		{"sh scripts/e2e.sh", "e2e script", true, true},
		// not one command: nothing to learn
		{"make build && gradle test", "", false, false},
		{"make build && pnpm test", "", false, false},
		{"task check:ts && task check:ts", "", false, false},
		{"npm install && task check:ts", "", false, false},
		{"make build; make test", "", false, false},
		{"echo hi", "", false, false},
		{"cd web", "", false, false},
		{"cd web && echo hi | tee log", "", false, false},
		{"NODE_ENV=production", "", false, false},
		{"command -v make", "", false, false},
		{`echo "a && make build"`, "", false, false},
		{"", "", false, false},
		// a program memgate has a rule for, which it calls light: the table's verdict stands
		{"go test ./pkg/x -run X", "", false, false},
		{"go test ./pkg/x", "", false, false},
		{"go vet ./pkg/x", "", false, false},
		{"npx vitest run foo.test.ts", "", false, false},
		{"npx eslint src", "", false, false},
		{"npm run lint", "", false, false},
		{"pnpm lint", "", false, false},
		{"cargo fmt", "", false, false},
		{"cargo check", "", false, false},
		{"task --list", "", false, false},
		{"node scripts/gen.mjs", "", false, false},
		{"python script.py", "", false, false},
		{"py -m pytest foo.py", "", false, false},
		{"pytest -k x", "", false, false},
		{"uv run make build", "", false, false},
		{"sh scripts/deploy.sh", "", false, false},
		{"./run.sh", "", false, false},
		{"bash scripts/deploy.sh", "", false, false},
		{"vite", "", false, false},
		{"sh -c 'go test -run X'", "", false, false},
		{"cd x && go test -run X && make build", "", false, false},
	}
	for _, tc := range cases {
		t.Run(tc.command, func(t *testing.T) {
			name, known, ok := Pattern(tc.command)
			if name != tc.name || known != tc.known || ok != tc.ok {
				t.Fatalf("Pattern(%q) = (%q, %v, %v); want (%q, %v, %v)", tc.command, name, known, ok, tc.name, tc.known, tc.ok)
			}
		})
	}
}

// a command that is known is the table's heavy job under the table's name, whichever way it is written
func TestPatternKnownNameIsTheTablesJobName(t *testing.T) {
	for _, command := range []string{
		"task check:ts", "npx tsc --noEmit", "cd x && task tauri:build", "cargo test", "pytest", "npm install",
		"vitest run", "sh scripts/e2e.sh", "task dev", "bash -c 'npx astro build'",
	} {
		job, heavy := Classify(command)
		name, known, ok := Pattern(command)
		if !heavy || !ok || !known || name != job.Name {
			t.Errorf("Pattern(%q) = (%q, %v, %v); Classify = %+v, %v; want the table's job name", command, name, known, ok, job, heavy)
		}
	}
}

// the one list of programs memgate has a rule for: a program the classifier reads is never an unknown pattern, so
// Pattern cannot learn what Classify already decides
func TestPatternNeverLearnsAProgramTheClassifierHasARuleFor(t *testing.T) {
	for _, command := range []string{
		"task x", "npm x", "pnpm x", "uv x", "python x", "python3 x", "py x", "npx x", "node x.mjs", "cargo x", "go x",
		"vitest x", "vite x", "tsc x", "tauri x", "pytest x", "py.test x", "astro x", "playwright x", "x.sh",
		"sh x", "bash x", "zsh x",
	} {
		if name, known, ok := Pattern(command); ok && !known {
			t.Errorf("Pattern(%q) = %q, an unknown pattern for a program memgate has a rule for", command, name)
		}
	}
}

func TestClassifyWith(t *testing.T) {
	learned := map[string]bool{"make build": true, "gradle build": true}
	cases := []struct {
		command string
		learned map[string]bool
		heavy   bool
		name    string
		bytes   uint64
	}{
		{"make build", learned, true, "make build", LearnedBytes},
		{"cd x && make build", learned, true, "make build", LearnedBytes},
		{"cd web && make build 2>&1 | tail -5", learned, true, "make build", LearnedBytes},
		{"bash -c 'make build'", learned, true, "make build", LearnedBytes},
		{`/bin/zsh -c -l "cd web && make build"`, learned, true, "make build", LearnedBytes},
		{"bash -o pipefail -c 'make build'", learned, true, "make build", LearnedBytes},
		{"env FOO=1 nice -n 5 gradle build --info", learned, true, "gradle build", LearnedBytes},
		// any step may match, not only the one working step
		{"make build && make test", learned, true, "make build", LearnedBytes},
		{"make test && gradle build", learned, true, "gradle build", LearnedBytes},
		{"make build; echo done", learned, true, "make build", LearnedBytes},
		// not learned
		{"make test", learned, false, "", 0},
		{"make", learned, false, "", 0},
		{"make build", nil, false, "", 0},
		{"make build", map[string]bool{}, false, "", 0},
		{"ls src", learned, false, "", 0},
		{"echo make build", learned, false, "", 0},
		{`echo "x && make build"`, learned, false, "", 0},
		// steps that do no work never match, whatever the set holds
		{"cd x", map[string]bool{"cd x": true}, false, "", 0},
		{"echo hi", map[string]bool{"echo hi": true}, false, "", 0},
		{"export A=1", map[string]bool{"export A=1": true}, false, "", 0},
		// a program memgate has a rule for keeps the table's verdict, whatever the set holds
		{"go test -run X", map[string]bool{"go test": true, "go": true, "go test -run": true}, false, "", 0},
		{"go test ./pkg/x -run X", map[string]bool{"go test": true}, false, "", 0},
		{"npx vitest run foo.test.ts", map[string]bool{"npx vitest": true, "npx": true}, false, "", 0},
		{"pnpm lint", map[string]bool{"pnpm lint": true}, false, "", 0},
		// the table's jobs are what Classify says; the heaviest step wins
		{"task check:ts", learned, true, "task check:ts", 3 * gib},
		{"make build && task check:ts", learned, true, "task check:ts", 3 * gib},
		{"task check:ts && make build", learned, true, "task check:ts", 3 * gib},
		{"npm install && make build", learned, true, "npm install", 1 * gib},
		{"cd x && npx vitest run", learned, true, "vitest (all)", 2 * gib},
	}
	for _, tc := range cases {
		t.Run(tc.command, func(t *testing.T) {
			job, heavy := ClassifyWith(tc.command, tc.learned)
			if heavy != tc.heavy || job.Name != tc.name || job.Bytes != tc.bytes {
				t.Fatalf("ClassifyWith(%q) = %+v, %v; want {%s %d}, %v", tc.command, job, heavy, tc.name, tc.bytes, tc.heavy)
			}
		})
	}
}

// with no learned set ClassifyWith is Classify, for every command the table classifies
func TestClassifyWithNothingLearnedIsClassify(t *testing.T) {
	for _, command := range []string{
		"task check:ts", "make build", "go test -run X", "npm install && task check:ts", "bash -c 'cd x && npx vitest run'",
		"ls", "", "task dev", "sh scripts/e2e.sh", "uv run pytest",
	} {
		wantJob, wantHeavy := Classify(command)
		for _, learned := range []map[string]bool{nil, {}} {
			if job, heavy := ClassifyWith(command, learned); job != wantJob || heavy != wantHeavy {
				t.Errorf("ClassifyWith(%q, %v) = %+v, %v; Classify = %+v, %v", command, learned, job, heavy, wantJob, wantHeavy)
			}
		}
	}
}

// a learned job is no dev server and no solo run: it queues like any other heavy command
func TestClassifyWithLearnedJobIsAnOrdinaryJob(t *testing.T) {
	job, heavy := ClassifyWith("make build", map[string]bool{"make build": true})
	if !heavy || job.LongRunning() || Solo(job.Name) {
		t.Fatalf("got %+v, %v; want an ordinary heavy job", job, heavy)
	}
	if job.Bytes != LearnedBytes {
		t.Fatalf("bytes %d, want LearnedBytes", job.Bytes)
	}
}
