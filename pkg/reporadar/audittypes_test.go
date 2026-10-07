// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestAuditReplyJSONShape(t *testing.T) {
	const in = `{"rootcause":"unchecked nil","siblings":["a.go:Foo","b.go:Bar"],"hits":[{"file":"b.go","line":42,"title":"Bar derefs nil","trigger":"empty input","actual":"panic","expected":"error","whynotcovered":"fix only touched Foo","severity":"high"}]}`
	var got auditReply
	if err := json.Unmarshal([]byte(in), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := auditReply{
		RootCause: "unchecked nil",
		Siblings:  []string{"a.go:Foo", "b.go:Bar"},
		Hits: []auditHit{{File: "b.go", Line: 42, Title: "Bar derefs nil", Trigger: "empty input",
			Actual: "panic", Expected: "error", WhyNotCovered: "fix only touched Foo", Severity: "high"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}

	var none auditReply
	if err := json.Unmarshal([]byte(`{"rootcause":"x","siblings":[],"hits":[]}`), &none); err != nil {
		t.Fatalf("unmarshal empty: %v", err)
	}
	if len(none.Hits) != 0 {
		t.Fatalf("want zero hits, got %d", len(none.Hits))
	}
}
