// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func pushB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("decoding %q: %v", s, err)
	}
	return b
}

// pushTestVapid returns a fresh VAPID pair in the stored encoding and its public key.
func pushTestVapid(t *testing.T) (priv, pub string, key *ecdsa.PublicKey) {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pubBytes := k.PublicKey().Bytes()
	key, err = ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pubBytes)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(k.Bytes()), base64.RawURLEncoding.EncodeToString(pubBytes), key
}

// pushTestDecrypt is the user agent's side of RFC 8291, for checking what SendPush posts.
func pushTestDecrypt(t *testing.T, body []byte, uaPrivate *ecdh.PrivateKey, authSecret []byte) []byte {
	t.Helper()
	if len(body) < pushHeaderLen+pushTagLen {
		t.Fatalf("body is %d bytes", len(body))
	}
	salt := body[:pushSaltLen]
	asKey, err := ecdh.P256().NewPublicKey(body[pushSaltLen+5 : pushHeaderLen])
	if err != nil {
		t.Fatal(err)
	}
	secret, err := uaPrivate.ECDH(asKey)
	if err != nil {
		t.Fatal(err)
	}
	prkKey, _ := hkdf.Extract(sha256.New, secret, authSecret)
	info := "WebPush: info\x00" + string(uaPrivate.PublicKey().Bytes()) + string(asKey.Bytes())
	ikm, _ := hkdf.Expand(sha256.New, prkKey, info, 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	padded, err := gcm.Open(nil, nonce, body[pushHeaderLen:], nil)
	if err != nil {
		t.Fatalf("decrypting: %v", err)
	}
	if len(padded) == 0 || padded[len(padded)-1] != pushDelimiter {
		t.Fatalf("missing 0x02 delimiter: %x", padded)
	}
	return padded[:len(padded)-1]
}

func TestPushEncryptRFC8291Vector(t *testing.T) {
	// RFC 8291 Appendix A.
	plaintext := pushB64(t, "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24")
	asPrivate, err := ecdh.P256().NewPrivateKey(pushB64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	uaPublic := pushB64(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	salt := pushB64(t, "DGv6ra1nlYgDCS1FRnbzlw")
	authSecret := pushB64(t, "BTBZMqHH6r4Tts7J_aSIgg")
	header := pushB64(t, "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
	ciphertext := pushB64(t, "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ")
	want := append(append([]byte{}, header...), ciphertext...)

	got, err := pushEncrypt(plaintext, uaPublic, authSecret, salt, asPrivate)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("encrypted message differs from RFC 8291 Appendix A\n got %s\nwant %s",
			base64.RawURLEncoding.EncodeToString(got), base64.RawURLEncoding.EncodeToString(want))
	}
}

func TestPushEncryptRefusesOversizePayload(t *testing.T) {
	asPrivate, _ := ecdh.P256().GenerateKey(rand.Reader)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	_, err := pushEncrypt(make([]byte, pushMaxPlaintext+1), ua.PublicKey().Bytes(), make([]byte, pushAuthLen), make([]byte, pushSaltLen), asPrivate)
	if err == nil {
		t.Fatal("want an error for a payload that cannot fit one 4096-byte body")
	}
}

func TestVapidHeader(t *testing.T) {
	priv, pub, key := pushTestVapid(t)
	now := time.Now()
	authz, err := pushVapidAuth("https://web.push.apple.com/QGuQyavXutnMH8/abc?x=1", priv, pub, "mailto:owner@example.com", now)
	if err != nil {
		t.Fatal(err)
	}
	rest, ok := strings.CutPrefix(authz, "vapid t=")
	if !ok {
		t.Fatalf("header %q lacks the vapid scheme", authz)
	}
	tok, k, ok := strings.Cut(rest, ", k=")
	if !ok || k != pub {
		t.Fatalf("header %q: want k=%s", authz, pub)
	}
	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(tok, claims, func(*jwt.Token) (any, error) { return key, nil },
		jwt.WithValidMethods([]string{"ES256"}), jwt.WithExpirationRequired())
	if err != nil {
		t.Fatalf("jwt does not verify with the vapid public key: %v", err)
	}
	if claims["aud"] != "https://web.push.apple.com" {
		t.Errorf("aud = %v", claims["aud"])
	}
	if claims["sub"] != "mailto:owner@example.com" {
		t.Errorf("sub = %v", claims["sub"])
	}
	exp, err := claims.GetExpirationTime()
	if err != nil {
		t.Fatal(err)
	}
	if !exp.After(now) || exp.Sub(now) > 12*time.Hour {
		t.Errorf("exp %v is not within 12 h of %v", exp, now)
	}
}

func TestSendPushGone(t *testing.T) {
	priv, pub, _ := pushTestVapid(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	p256dh := base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes())
	auth := base64.RawURLEncoding.EncodeToString(make([]byte, pushAuthLen))
	for _, tc := range []struct {
		status   int
		wantGone bool
	}{
		{http.StatusGone, true},
		{http.StatusNotFound, true},
		{http.StatusTooManyRequests, false},
		{http.StatusInternalServerError, false},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
		}))
		err := SendPush(context.Background(), srv.Client(), srv.URL+"/sub/1", p256dh, auth, priv, pub, "mailto:o@example.com", []byte(`{}`), time.Hour)
		srv.Close()
		if err == nil {
			t.Fatalf("status %d: want an error", tc.status)
		}
		if errors.Is(err, ErrSubscriptionGone) != tc.wantGone {
			t.Errorf("status %d: errors.Is(gone) = %v, want %v (err %v)", tc.status, !tc.wantGone, tc.wantGone, err)
		}
		if !tc.wantGone && !strings.Contains(err.Error(), http.StatusText(tc.status)) {
			t.Errorf("status %d: error %q does not name the status", tc.status, err)
		}
	}
}

func TestSendPushHeaders(t *testing.T) {
	priv, pub, key := pushTestVapid(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	authSecret := make([]byte, pushAuthLen)
	rand.Read(authSecret)
	payload := []byte(`{"title":"api-agent","body":"Which schema?","key":"ask:1"}`)

	var gotReq *http.Request
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReq = r
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	err := SendPush(context.Background(), srv.Client(), srv.URL+"/push/abc", base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(authSecret), priv, pub, "mailto:o@example.com", payload, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if gotReq.Method != http.MethodPost || gotReq.URL.Path != "/push/abc" {
		t.Errorf("request %s %s", gotReq.Method, gotReq.URL.Path)
	}
	for h, want := range map[string]string{
		"Content-Encoding": "aes128gcm",
		"TTL":              "3600",
		"Urgency":          "high",
	} {
		if got := gotReq.Header.Get(h); got != want {
			t.Errorf("%s = %q, want %q", h, got, want)
		}
	}
	tok, k, ok := strings.Cut(strings.TrimPrefix(gotReq.Header.Get("Authorization"), "vapid t="), ", k=")
	if !ok || k != pub {
		t.Fatalf("Authorization = %q", gotReq.Header.Get("Authorization"))
	}
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(tok, claims, func(*jwt.Token) (any, error) { return key, nil }); err != nil {
		t.Fatal(err)
	}
	if claims["aud"] != srv.URL {
		t.Errorf("aud = %v, want %s", claims["aud"], srv.URL)
	}
	if rs := binary.BigEndian.Uint32(gotBody[pushSaltLen:]); rs != pushRecordSize {
		t.Errorf("record size %d", rs)
	}
	if got := pushTestDecrypt(t, gotBody, ua, authSecret); !bytes.Equal(got, payload) {
		t.Errorf("decrypted %q, want %q", got, payload)
	}
}
