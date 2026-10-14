package jarvis

import "testing"

func parents(m map[string]string) func(string) (string, error) {
	return func(oid string) (string, error) { return m[oid], nil }
}

func TestLinkMakesCycle(t *testing.T) {
	// a <- b <- c (c's parent is b, b's parent is a)
	up := parents(map[string]string{"c": "b", "b": "a"})
	cases := []struct {
		child, parent string
		want          bool
	}{
		{"a", "c", true}, // a under c, while c is under a
		{"a", "b", true},
		{"c", "a", false}, // already the shape, one more level up is fine
		{"d", "c", false},
	}
	for _, tc := range cases {
		got, err := LinkMakesCycle(tc.child, tc.parent, up)
		if err != nil || got != tc.want {
			t.Fatalf("%s under %s: got %v %v, want %v", tc.child, tc.parent, got, err, tc.want)
		}
	}
}
