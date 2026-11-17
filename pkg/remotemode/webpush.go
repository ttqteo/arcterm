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
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrSubscriptionGone means the push service no longer knows the subscription (404 or 410):
// the caller drops it rather than retrying.
var ErrSubscriptionGone = errors.New("push subscription gone")

const (
	pushRecordSize   = 4096
	pushSaltLen      = 16
	pushAuthLen      = 16
	pushKeyLen       = 65 // uncompressed P-256 point
	pushHeaderLen    = pushSaltLen + 4 + 1 + pushKeyLen
	pushTagLen       = 16
	pushDelimiter    = 0x02 // last-record padding delimiter, RFC 8188
	pushVapidExpiry  = 12 * time.Hour
	pushMaxBodyBytes = 4096 // push services must accept at least this much; one record must fit
	pushErrBodyBytes = 512
)

// the payload limit keeps header, delimiter, tag and plaintext within one 4096-byte body.
const pushMaxPlaintext = pushMaxBodyBytes - pushHeaderLen - 1 - pushTagLen

// SendPush encrypts payload for one browser push subscription (RFC 8291 aes128gcm) and posts it
// to the subscription's endpoint with a VAPID authorization (RFC 8292).
func SendPush(ctx context.Context, client *http.Client, endpoint, p256dh, auth, vapidPrivate, vapidPublic, subject string, payload []byte, ttl time.Duration) error {
	uaPublic, err := base64.RawURLEncoding.DecodeString(p256dh)
	if err != nil {
		return fmt.Errorf("push: decoding p256dh: %w", err)
	}
	authSecret, err := base64.RawURLEncoding.DecodeString(auth)
	if err != nil {
		return fmt.Errorf("push: decoding auth: %w", err)
	}
	asPrivate, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("push: generating sender key: %w", err)
	}
	salt := make([]byte, pushSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("push: generating salt: %w", err)
	}
	body, err := pushEncrypt(payload, uaPublic, authSecret, salt, asPrivate)
	if err != nil {
		return err
	}
	authz, err := pushVapidAuth(endpoint, vapidPrivate, vapidPublic, subject, time.Now())
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("push: building request: %w", err)
	}
	req.Header.Set("Authorization", authz)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("TTL", strconv.Itoa(int(ttl/time.Second)))
	req.Header.Set("Urgency", "high")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("push: posting to %s: %w", pushOrigin(endpoint), err)
	}
	defer resp.Body.Close()
	snippet, _ := io.ReadAll(io.LimitReader(resp.Body, pushErrBodyBytes))
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return ErrSubscriptionGone
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("push: %s returned %s: %s", pushOrigin(endpoint), resp.Status, bytes.TrimSpace(snippet))
	}
	return nil
}

// pushEncrypt is RFC 8291's aes128gcm encryption as one record; salt and sender key are
// parameters so the RFC's Appendix A vector can pin them.
func pushEncrypt(plaintext, uaPublic, authSecret, salt []byte, asPrivate *ecdh.PrivateKey) ([]byte, error) {
	if len(plaintext) > pushMaxPlaintext {
		return nil, fmt.Errorf("push: payload is %d bytes, over the %d-byte limit", len(plaintext), pushMaxPlaintext)
	}
	if len(authSecret) != pushAuthLen {
		return nil, fmt.Errorf("push: auth secret is %d bytes, want %d", len(authSecret), pushAuthLen)
	}
	if len(salt) != pushSaltLen {
		return nil, fmt.Errorf("push: salt is %d bytes, want %d", len(salt), pushSaltLen)
	}
	uaKey, err := ecdh.P256().NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("push: bad p256dh key: %w", err)
	}
	ecdhSecret, err := asPrivate.ECDH(uaKey)
	if err != nil {
		return nil, fmt.Errorf("push: ecdh: %w", err)
	}
	asPublic := asPrivate.PublicKey().Bytes()
	prkKey, err := hkdf.Extract(sha256.New, ecdhSecret, authSecret)
	if err != nil {
		return nil, err
	}
	keyInfo := "WebPush: info\x00" + string(uaPublic) + string(asPublic)
	ikm, err := hkdf.Expand(sha256.New, prkKey, keyInfo, 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, pushHeaderLen+len(plaintext)+1+pushTagLen)
	out = append(out, salt...)
	out = binary.BigEndian.AppendUint32(out, pushRecordSize)
	out = append(out, byte(len(asPublic)))
	out = append(out, asPublic...)
	padded := append(append([]byte{}, plaintext...), pushDelimiter)
	return gcm.Seal(out, nonce, padded, nil), nil
}

// pushVapidAuth builds RFC 8292's Authorization header: an ES256 JWT for the endpoint's origin,
// signed with the stored VAPID scalar, plus the matching public key.
func pushVapidAuth(endpoint, vapidPrivate, vapidPublic, subject string, now time.Time) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(vapidPrivate)
	if err != nil {
		return "", fmt.Errorf("push: decoding vapid private key: %w", err)
	}
	key, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return "", fmt.Errorf("push: bad vapid private key: %w", err)
	}
	aud := pushOrigin(endpoint)
	if aud == "" {
		return "", fmt.Errorf("push: endpoint %q has no scheme or host", endpoint)
	}
	claims := jwt.MapClaims{
		"aud": aud,
		"exp": now.Add(pushVapidExpiry).Unix(),
		"sub": subject,
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodES256, claims).SignedString(key)
	if err != nil {
		return "", fmt.Errorf("push: signing vapid jwt: %w", err)
	}
	return "vapid t=" + token + ", k=" + vapidPublic, nil
}

// pushOrigin is the endpoint's scheme and host, the VAPID audience; it also keeps the
// subscription's secret path out of error messages.
func pushOrigin(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
