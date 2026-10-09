// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// these should both be 5 characters
const WaveOSC = "23198"
const WaveServerOSC = "23199"
const WaveOSCPrefixLen = 5 + 3 // \x1b] + WaveOSC + ; + \x07

const WaveOSCPrefix = "\x1b]" + WaveOSC + ";"
const WaveServerOSCPrefix = "\x1b]" + WaveServerOSC + ";"

const HexChars = "0123456789ABCDEF"
const BEL = 0x07
const ST = 0x9c
const ESC = 0x1b

const DefaultOutputChSize = 32
const DefaultInputChSize = 32

const WaveJwtTokenVarName = wavebase.WaveJwtTokenVarName

// OSC escape types
// OSC 23198 ; (JSON | base64-JSON) ST
// JSON = must escape all ASCII control characters ([\x00-\x1F\x7F])
// we can tell the difference between JSON and base64-JSON by the first character: '{' or not

// for responses (terminal -> program), we'll use OSC 23199
// same json format

var shutdownOnce sync.Once

func DoShutdown(reason string, exitCode int, quiet bool) {
	shutdownOnce.Do(func() {
		defer os.Exit(exitCode)
		if !quiet && reason != "" {
			log.Printf("shutting down: %s\n", reason)
		}
	})
}

func SetupConnRpcClient(conn net.Conn, serverImpl ServerImpl, debugStr string) (*WshRpc, chan error, error) {
	inputCh := make(chan baseds.RpcInputChType, DefaultInputChSize)
	outputCh := make(chan []byte, DefaultOutputChSize)
	writeErrCh := make(chan error, 1)
	go func() {
		defer func() {
			panichandler.PanicHandler("SetupConnRpcClient:AdaptOutputChToStream", recover())
		}()
		writeErr := AdaptOutputChToStream(outputCh, conn)
		if writeErr != nil {
			writeErrCh <- writeErr
			close(writeErrCh)
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("SetupConnRpcClient:AdaptStreamToMsgCh", recover())
		}()
		// when input is closed, close the connection
		defer conn.Close()
		AdaptStreamToMsgCh(conn, inputCh, nil)
	}()
	rtn := MakeWshRpcWithChannels(inputCh, outputCh, wshrpc.RpcContext{}, serverImpl, debugStr)
	return rtn, writeErrCh, nil
}

func tryTcpSocket(sockName string) (net.Conn, error) {
	addr, err := net.ResolveTCPAddr("tcp", sockName)
	if err != nil {
		return nil, err
	}
	return net.DialTCP("tcp", nil, addr)
}

func SetupDomainSocketRpcClient(sockName string, serverImpl ServerImpl, debugName string) (*WshRpc, error) {
	sockName = wavebase.ExpandHomeDirSafe(sockName)
	resolvedPath, err := filepath.EvalSymlinks(sockName)
	if err == nil {
		sockName = resolvedPath
	}
	if !filepath.IsAbs(sockName) {
		return nil, fmt.Errorf("socket path must be absolute: %s", sockName)
	}
	conn, tcpErr := tryTcpSocket(sockName)
	var unixErr error
	if tcpErr != nil {
		conn, unixErr = net.Dial("unix", sockName)
	}
	if tcpErr != nil && unixErr != nil {
		return nil, fmt.Errorf("failed to connect to tcp or unix domain socket: tcp err:%w: unix socket err: %w", tcpErr, unixErr)
	}
	rtn, errCh, err := SetupConnRpcClient(conn, serverImpl, debugName)
	go func() {
		defer func() {
			panichandler.PanicHandler("SetupDomainSocketRpcClient:closeConn", recover())
		}()
		defer conn.Close()
		err := <-errCh
		if err != nil && err != io.EOF {
			log.Printf("error in domain socket connection: %v\n", err)
		}
	}()
	return rtn, err
}

func MakeClientJWTToken(rpcCtx wshrpc.RpcContext) (string, error) {
	if wavebase.IsDevMode() {
		if rpcCtx.IsRouter && (rpcCtx.RouteId != "" || rpcCtx.ProcRoute) {
			panic("Invalid RpcCtx, router w/ routeid")
		}
		if !rpcCtx.IsRouter && (rpcCtx.RouteId == "" && !rpcCtx.ProcRoute) {
			panic("Invalid RpcCtx, no routeid")
		}
	}
	claims := &wavejwt.WaveJwtClaims{
		Sock:      rpcCtx.SockName,
		RouteId:   rpcCtx.RouteId,
		ProcRoute: rpcCtx.ProcRoute,
		BlockId:   rpcCtx.BlockId,
		Conn:      rpcCtx.Conn,
		Router:    rpcCtx.IsRouter,
	}
	return wavejwt.Sign(claims)
}

func claimsToRpcCtx(claims *wavejwt.WaveJwtClaims) *wshrpc.RpcContext {
	return &wshrpc.RpcContext{
		SockName:  claims.Sock,
		RouteId:   claims.RouteId,
		ProcRoute: claims.ProcRoute,
		BlockId:   claims.BlockId,
		Conn:      claims.Conn,
		IsRouter:  claims.Router,
	}
}

func ValidateAndExtractRpcContextFromToken(tokenStr string) (*wshrpc.RpcContext, error) {
	claims, err := wavejwt.ValidateAndExtract(tokenStr)
	if err != nil {
		return nil, err
	}
	return claimsToRpcCtx(claims), nil
}

func RunWshRpcOverListener(listener net.Listener, readCallback func()) {
	defer log.Printf("domain socket listener shutting down\n")
	for {
		conn, err := listener.Accept()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("error accepting connection: %v\n", err)
			break
		}
		log.Print("got domain socket connection\n")
		go handleDomainSocketClient(conn, readCallback)
	}
}

// DomainLinkClosedHook runs once a domain-socket link is unregistered. wavesrv sets it to cancel the streaming
// RPCs that entered on the link (a held job slot, an agent's control stream), as pkg/web/ws.go does for a
// websocket; without it they live until their timeout.
var DomainLinkClosedHook func(baseds.LinkId)

func handleDomainSocketClient(conn net.Conn, readCallback func()) {
	proxy := MakeRpcProxy("domain")
	// register before the reader starts: a client that disconnects at once must still find its link
	// id at teardown, or the link outlives the connection
	linkId := DefaultRouter.RegisterUntrustedLink(proxy)
	go func() {
		defer func() {
			panichandler.PanicHandler("handleDomainSocketClient:AdaptOutputChToStream", recover())
		}()
		writeErr := AdaptOutputChToStream(proxy.ToRemoteCh, conn)
		if writeErr != nil {
			log.Printf("error writing to domain socket: %v\n", writeErr)
		}
	}()
	go func() {
		// when input is closed, close the connection
		defer func() {
			panichandler.PanicHandler("handleDomainSocketClient:AdaptStreamToMsgCh", recover())
		}()
		defer func() {
			conn.Close()
			// unregister before closing ToRemoteCh so no reply is routed into a closed channel
			DefaultRouter.UnregisterLink(linkId)
			if DomainLinkClosedHook != nil {
				DomainLinkClosedHook(linkId)
			}
			close(proxy.FromRemoteCh)
			close(proxy.ToRemoteCh)
		}()
		AdaptStreamToMsgCh(conn, proxy.FromRemoteCh, readCallback)
	}()
}

// only for use on client
func ExtractUnverifiedRpcContext(tokenStr string) (*wshrpc.RpcContext, error) {
	token, _, err := new(jwt.Parser).ParseUnverified(tokenStr, &wavejwt.WaveJwtClaims{})
	if err != nil {
		return nil, fmt.Errorf("error parsing token: %w", err)
	}
	claims, ok := token.Claims.(*wavejwt.WaveJwtClaims)
	if !ok {
		return nil, fmt.Errorf("error getting claims from token")
	}
	return claimsToRpcCtx(claims), nil
}

// only for use on client
func ExtractUnverifiedSocketName(tokenStr string) (string, error) {
	token, _, err := new(jwt.Parser).ParseUnverified(tokenStr, &wavejwt.WaveJwtClaims{})
	if err != nil {
		return "", fmt.Errorf("error parsing token: %w", err)
	}
	claims, ok := token.Claims.(*wavejwt.WaveJwtClaims)
	if !ok {
		return "", fmt.Errorf("error getting claims from token")
	}
	sockName := claims.Sock
	if sockName == "" {
		return "", fmt.Errorf("sock claim is missing or invalid")
	}
	sockName = wavebase.ExpandHomeDirSafe(sockName)
	return sockName, nil
}

func RespErr[T any](err error) wshrpc.RespOrErrorUnion[T] {
	return wshrpc.RespOrErrorUnion[T]{Error: err}
}
