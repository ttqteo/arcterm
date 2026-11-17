// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	accessTestTeam  = "myteam"
	accessTestAud   = "aud-tag-123"
	accessTestEmail = "owner@example.com"
	accessTestKid   = "kid-1"
)

var accessTestBase = time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)

type accessTestEnv struct {
	t        *testing.T
	verifier *AccessVerifier
	clock    time.Time
	hits     atomic.Int32

	lock sync.Mutex
	keys map[string]*rsa.PrivateKey
}

func accessTestKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func newAccessTestEnv(t *testing.T) *accessTestEnv {
	env := &accessTestEnv{t: t, clock: accessTestBase, keys: map[string]*rsa.PrivateKey{accessTestKid: accessTestKey(t)}}
	srv := httptest.NewServer(http.HandlerFunc(env.serveCerts))
	t.Cleanup(srv.Close)
	env.verifier = NewAccessVerifier(srv.URL, TeamIssuer(accessTestTeam), accessTestAud, accessTestEmail, srv.Client())
	env.verifier.now = func() time.Time { return env.clock }
	return env
}

func (env *accessTestEnv) serveCerts(w http.ResponseWriter, r *http.Request) {
	env.hits.Add(1)
	env.lock.Lock()
	defer env.lock.Unlock()
	var jwks accessJWKS
	for kid, key := range env.keys {
		jwks.Keys = append(jwks.Keys, struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		}{kid, "RSA", base64.RawURLEncoding.EncodeToString(key.N.Bytes()), base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())})
	}
	json.NewEncoder(w).Encode(jwks)
}

func (env *accessTestEnv) setKeys(keys map[string]*rsa.PrivateKey) {
	env.lock.Lock()
	defer env.lock.Unlock()
	env.keys = keys
}

func (env *accessTestEnv) claims() accessClaims {
	return accessClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    TeamIssuer(accessTestTeam),
			Audience:  jwt.ClaimStrings{accessTestAud},
			IssuedAt:  jwt.NewNumericDate(env.clock),
			NotBefore: jwt.NewNumericDate(env.clock),
			ExpiresAt: jwt.NewNumericDate(env.clock.Add(time.Hour)),
		},
		Email: accessTestEmail,
	}
}

func accessTestSign(t *testing.T, claims accessClaims, kid string, key *rsa.PrivateKey) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func (env *accessTestEnv) sign(claims accessClaims) string {
	return accessTestSign(env.t, claims, accessTestKid, env.keys[accessTestKid])
}

func (env *accessTestEnv) verify(token string) error {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		r.Header.Set(accessHeader, token)
	}
	return env.verifier.Verify(r)
}

func TestAccessTeamURLs(t *testing.T) {
	if got := TeamCertsURL("acme"); got != "https://acme.cloudflareaccess.com/cdn-cgi/access/certs" {
		t.Errorf("TeamCertsURL = %q", got)
	}
	if got := TeamIssuer("acme"); got != "https://acme.cloudflareaccess.com" {
		t.Errorf("TeamIssuer = %q", got)
	}
}

func TestAccessValidTokenPasses(t *testing.T) {
	env := newAccessTestEnv(t)
	if err := env.verify(env.sign(env.claims())); err != nil {
		t.Fatalf("valid token refused: %v", err)
	}
}

func TestAccessEmailIsCaseInsensitive(t *testing.T) {
	env := newAccessTestEnv(t)
	claims := env.claims()
	claims.Email = "Owner@Example.com"
	if err := env.verify(env.sign(claims)); err != nil {
		t.Fatalf("mixed-case owner email refused: %v", err)
	}
}

func TestAccessRejects(t *testing.T) {
	env := newAccessTestEnv(t)
	otherKey := accessTestKey(t)
	pubDER, err := x509.MarshalPKIXPublicKey(&env.keys[accessTestKid].PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})

	cases := []struct {
		name  string
		token func() string
	}{
		{"missing header", func() string { return "" }},
		{"garbage", func() string { return "not.a.jwt" }},
		{"wrong audience", func() string {
			c := env.claims()
			c.Audience = jwt.ClaimStrings{"other-aud"}
			return env.sign(c)
		}},
		{"wrong issuer", func() string {
			c := env.claims()
			c.Issuer = TeamIssuer("otherteam")
			return env.sign(c)
		}},
		{"expired", func() string {
			c := env.claims()
			c.ExpiresAt = jwt.NewNumericDate(env.clock.Add(-time.Hour))
			return env.sign(c)
		}},
		{"no expiry", func() string {
			c := env.claims()
			c.ExpiresAt = nil
			return env.sign(c)
		}},
		{"not yet valid", func() string {
			c := env.claims()
			c.NotBefore = jwt.NewNumericDate(env.clock.Add(time.Hour))
			return env.sign(c)
		}},
		{"other email", func() string {
			c := env.claims()
			c.Email = "intruder@example.com"
			return env.sign(c)
		}},
		{"alg none", func() string {
			token := jwt.NewWithClaims(jwt.SigningMethodNone, env.claims())
			token.Header["kid"] = accessTestKid
			signed, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
			if err != nil {
				t.Fatal(err)
			}
			return signed
		}},
		{"HS256 with public key bytes", func() string {
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, env.claims())
			token.Header["kid"] = accessTestKid
			signed, err := token.SignedString(pubPEM)
			if err != nil {
				t.Fatal(err)
			}
			return signed
		}},
		{"bad signature", func() string {
			return accessTestSign(t, env.claims(), accessTestKid, otherKey)
		}},
		{"unknown key", func() string {
			return accessTestSign(t, env.claims(), "kid-unknown", otherKey)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := env.verify(tc.token())
			if err == nil {
				t.Fatal("token accepted, want refused")
			}
			t.Log(err)
		})
	}
}

func TestAccessRotatedKeyIsFetchedOnce(t *testing.T) {
	env := newAccessTestEnv(t)
	if err := env.verify(env.sign(env.claims())); err != nil {
		t.Fatalf("initial token refused: %v", err)
	}
	if got := env.hits.Load(); got != 1 {
		t.Fatalf("certs fetched %d times, want 1", got)
	}

	rotated := accessTestKey(t)
	env.setKeys(map[string]*rsa.PrivateKey{"kid-2": rotated})
	env.clock = env.clock.Add(time.Hour)
	for i := range 3 {
		if err := env.verify(accessTestSign(t, env.claims(), "kid-2", rotated)); err != nil {
			t.Fatalf("rotated-key token %d refused: %v", i, err)
		}
	}
	if got := env.hits.Load(); got != 2 {
		t.Fatalf("certs fetched %d times, want 2", got)
	}
}

func TestAccessUnknownKidsRefetchRateLimited(t *testing.T) {
	env := newAccessTestEnv(t)
	if err := env.verify(env.sign(env.claims())); err != nil {
		t.Fatalf("initial token refused: %v", err)
	}
	env.clock = env.clock.Add(time.Hour)
	before := env.hits.Load()
	forger := accessTestKey(t)
	for i := range 20 {
		if err := env.verify(accessTestSign(t, env.claims(), fmt.Sprintf("kid-forged-%d", i), forger)); err == nil {
			t.Fatalf("forged token %d accepted", i)
		}
	}
	if got := env.hits.Load() - before; got > 2 {
		t.Fatalf("20 unknown kids caused %d certs fetches, want at most 2", got)
	}
	if err := env.verify(env.sign(env.claims())); err != nil {
		t.Fatalf("owner token refused after forged stream: %v", err)
	}
}
