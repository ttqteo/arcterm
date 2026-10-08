package claudeaccount

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func useEndpoint(t *testing.T, status int, seen *http.Header) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = r.Header.Clone()
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	old := checkEndpoint
	checkEndpoint = srv.URL
	t.Cleanup(func() { checkEndpoint = old })
}

func TestNormalizeTokenDropsWhatACopyAdds(t *testing.T) {
	const tok = "sk-ant-oat01-Ab1_-xyzAA"
	for _, in := range []string{
		tok,
		"  " + tok + "\r\n",
		"sk-ant-oat01-Ab1_-\r\n xyzAA",           // copied across a wrap, with the next row's margin
		"sk-ant-oat01-Ab1_- xyz AA",              // a space or a no-break space where the wrap was
		"Your OAuth token: " + tok + " (1 year)", // copied with the text around it
	} {
		if got := NormalizeToken(in); got != tok {
			t.Errorf("NormalizeToken(%q) = %q", in, got)
		}
	}
	if got := NormalizeToken("sk-ant-api03-nope"); got != "sk-ant-api03-nope" {
		t.Errorf("a value that is no setup-token is left for Add to refuse, got %q", got)
	}
}

func TestCheckTokenRejectsA401(t *testing.T) {
	var seen http.Header
	useEndpoint(t, http.StatusUnauthorized, &seen)
	if err := CheckToken(context.Background(), " sk-ant-oat01-cut "); err == nil {
		t.Fatal("want an error for a token the API answers 401")
	}
	if seen.Get("Authorization") != "Bearer sk-ant-oat01-cut" || seen.Get("anthropic-beta") == "" {
		t.Fatalf("request headers = %v", seen)
	}
}

// the empty request is refused for its body (400) only once the token was accepted
func TestCheckTokenAcceptsABadRequestAnswer(t *testing.T) {
	useEndpoint(t, http.StatusBadRequest, nil)
	if err := CheckToken(context.Background(), "sk-ant-oat01-good"); err != nil {
		t.Fatal(err)
	}
}

// a check that cannot decide (rate limit, outage, offline) never blocks adding the account
func TestCheckTokenLetsAnUndecidedCheckThrough(t *testing.T) {
	for _, status := range []int{http.StatusTooManyRequests, http.StatusInternalServerError} {
		useEndpoint(t, status, nil)
		if err := CheckToken(context.Background(), "sk-ant-oat01-x"); err != nil {
			t.Fatalf("status %d: %v", status, err)
		}
	}
	checkEndpoint = "http://127.0.0.1:1"
	if err := CheckToken(context.Background(), "sk-ant-oat01-x"); err != nil {
		t.Fatalf("unreachable: %v", err)
	}
}
