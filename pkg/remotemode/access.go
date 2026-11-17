// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	accessHeader = "Cf-Access-Jwt-Assertion"
	accessLeeway = 30 * time.Second
	// an unknown kid triggers at most one certs refetch per interval, so a stream of forged tokens
	// cannot turn into a stream of requests to cloudflare.
	accessRefetchInterval = 30 * time.Second
	accessFetchTimeout    = 10 * time.Second
	accessMaxCertsBytes   = 1 << 20
)

func TeamCertsURL(team string) string {
	return TeamIssuer(team) + "/cdn-cgi/access/certs"
}

func TeamIssuer(team string) string {
	return "https://" + team + ".cloudflareaccess.com"
}

// AccessVerifier checks the token Cloudflare Access attaches to every request it lets through.
type AccessVerifier struct {
	certsURL string
	issuer   string
	aud      string
	email    string
	client   *http.Client
	now      func() time.Time

	lock      sync.Mutex
	keys      map[string]*rsa.PublicKey
	lastFetch time.Time
}

type accessClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
}

type accessJWKS struct {
	Keys []struct {
		Kid string `json:"kid"`
		Kty string `json:"kty"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func NewAccessVerifier(certsURL, issuer, aud, email string, client *http.Client) *AccessVerifier {
	if client == nil {
		client = &http.Client{Timeout: accessFetchTimeout}
	}
	return &AccessVerifier{
		certsURL: certsURL,
		issuer:   issuer,
		aud:      aud,
		email:    email,
		client:   client,
		now:      time.Now,
	}
}

// Verify returns nil only for a valid owner token; the error names the reason for the log line and is
// never meant for the client.
func (v *AccessVerifier) Verify(r *http.Request) error {
	raw := r.Header.Get(accessHeader)
	if raw == "" {
		return errors.New("access: missing " + accessHeader + " header")
	}
	var claims accessClaims
	_, err := jwt.ParseWithClaims(raw, &claims, v.keyFunc,
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithAudience(v.aud),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(accessLeeway),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		return fmt.Errorf("access: %w", err)
	}
	if !strings.EqualFold(claims.Email, v.email) {
		return fmt.Errorf("access: token is for %q, not the owner", claims.Email)
	}
	return nil
}

func (v *AccessVerifier) keyFunc(token *jwt.Token) (any, error) {
	kid, _ := token.Header["kid"].(string)
	if kid == "" {
		return nil, errors.New("token has no kid")
	}
	v.lock.Lock()
	defer v.lock.Unlock()
	if key := v.keys[kid]; key != nil {
		return key, nil
	}
	if !v.lastFetch.IsZero() && v.now().Sub(v.lastFetch) < accessRefetchInterval {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}
	v.lastFetch = v.now()
	keys, err := v.fetchKeys()
	if err != nil {
		return nil, fmt.Errorf("fetching access certs: %w", err)
	}
	v.keys = keys
	if key := v.keys[kid]; key != nil {
		return key, nil
	}
	return nil, fmt.Errorf("unknown key id %q", kid)
}

func (v *AccessVerifier) fetchKeys() (map[string]*rsa.PublicKey, error) {
	resp, err := v.client.Get(v.certsURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s returned %s", v.certsURL, resp.Status)
	}
	var jwks accessJWKS
	if err := json.NewDecoder(io.LimitReader(resp.Body, accessMaxCertsBytes)).Decode(&jwks); err != nil {
		return nil, fmt.Errorf("decoding %s: %w", v.certsURL, err)
	}
	keys := make(map[string]*rsa.PublicKey)
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		n, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return nil, fmt.Errorf("key %q modulus: %w", k.Kid, err)
		}
		e, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, fmt.Errorf("key %q exponent: %w", k.Kid, err)
		}
		exp := new(big.Int).SetBytes(e)
		if !exp.IsInt64() || exp.Int64() > 1<<31-1 || exp.Int64() < 2 {
			return nil, fmt.Errorf("key %q has a bad exponent", k.Kid)
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(exp.Int64())}
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%s has no RSA keys", v.certsURL)
	}
	return keys, nil
}
