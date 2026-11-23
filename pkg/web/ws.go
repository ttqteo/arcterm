// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/web/webcmd"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const wsReadWaitTimeout = 15 * time.Second

// How long one write may wait for the WebView to take it. The WebView stops reading while its main thread is busy, and
// right after the cockpit first renders it was busy 12 to 43 s on every launch measured (waveapp.log, 2026-11-20 to
// 11-23): at 10 s the write timed out on 3 launches of 4 and the link was dropped mid-boot. A var for the tests.
var wsWriteWaitTimeout = 30 * time.Second

const wsPingPeriodTickTime = 10 * time.Second
const wsInitialPingTime = 1 * time.Second
const wsMaxMessageSize = 10 * 1024 * 1024

const DefaultCommandTimeout = 2 * time.Second
const WebSocketChannelSize = 128

type StableConnInfo struct {
	ConnId string
	LinkId baseds.LinkId
}

var GlobalLock = &sync.Mutex{}
var RouteToConnMap = map[string]*StableConnInfo{} // stableid => StableConnInfo

func RunWebSocketServer(listener net.Listener) {
	gr := mux.NewRouter()
	gr.HandleFunc("/ws", HandleWs)
	server := &http.Server{
		ReadTimeout:    HttpReadTimeout,
		WriteTimeout:   HttpWriteTimeout,
		MaxHeaderBytes: HttpMaxHeaderBytes,
		Handler:        gr,
	}
	server.SetKeepAlivesEnabled(false)
	log.Printf("[websocket] running websocket server on %s\n", listener.Addr())
	err := server.Serve(listener)
	if err != nil {
		log.Printf("[websocket] error trying to run websocket server: %v\n", err)
	}
}

var WebSocketUpgrader = websocket.Upgrader{
	ReadBufferSize:   4 * 1024,
	WriteBufferSize:  32 * 1024,
	HandshakeTimeout: 1 * time.Second,
	CheckOrigin:      func(r *http.Request) bool { return true },
}

func HandleWs(w http.ResponseWriter, r *http.Request) {
	err := HandleWsInternal(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func getMessageType(jmsg map[string]any) string {
	if str, ok := jmsg["type"].(string); ok {
		return str
	}
	return ""
}

func getStringFromMap(jmsg map[string]any, key string) string {
	if str, ok := jmsg[key].(string); ok {
		return str
	}
	return ""
}

// sendToWriter queues msg for the write loop, unless that loop has ended: then nothing drains outputCh, and a send
// would block its caller for good.
func sendToWriter(outputCh chan<- any, writerDone <-chan struct{}, msg any) bool {
	select {
	case outputCh <- msg:
		return true
	case <-writerDone:
		return false
	}
}

func processWSCommand(jmsg map[string]any, outputCh chan any, writerDone <-chan struct{}, rpcInputCh chan baseds.RpcInputChType) {
	var rtnErr error
	var cmdType string
	defer func() {
		panicCtx := "processWSCommand"
		if cmdType != "" {
			panicCtx = fmt.Sprintf("processWSCommand:%s", cmdType)
		}
		panicErr := panichandler.PanicHandler(panicCtx, recover())
		if panicErr != nil {
			rtnErr = panicErr
		}
		if rtnErr == nil {
			return
		}
		rtn := map[string]any{"type": "error", "error": rtnErr.Error()}
		sendToWriter(outputCh, writerDone, rtn)
	}()
	wsCommand, err := webcmd.ParseWSCommandMap(jmsg)
	if err != nil {
		rtnErr = fmt.Errorf("cannot parse wscommand: %v", err)
		return
	}
	cmdType = wsCommand.GetWSCommand()
	switch cmd := wsCommand.(type) {
	case *webcmd.WSRpcCommand:
		rpcMsg := cmd.Message
		if rpcMsg == nil {
			return
		}
		if rpcMsg.Command != "" {
			cmdType = fmt.Sprintf("%s:%s", cmdType, rpcMsg.Command)
		}
		msgBytes, err := json.Marshal(rpcMsg)
		if err != nil {
			// this really should never fail since we just unmarshalled this value
			return
		}
		rpcInputCh <- baseds.RpcInputChType{MsgBytes: msgBytes}
	}
}

// ReadLoop reads until the connection fails, or until the write loop has ended (writerDone) and an answer it owes
// could not be sent: a ping's pong used to block here once the writer was gone, so the read loop never returned, the
// link was never unregistered and the WebView, whose pings were still read, never saw the socket close.
func ReadLoop(conn *websocket.Conn, outputCh chan any, writerDone <-chan struct{}, closeCh chan any, rpcInputCh chan baseds.RpcInputChType, routeId string) {
	readWait := wsReadWaitTimeout
	conn.SetReadLimit(wsMaxMessageSize)
	conn.SetReadDeadline(time.Now().Add(readWait))
	defer close(closeCh)
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("[websocket] ReadPump error (%s): %v\n", routeId, err)
			break
		}
		jmsg := map[string]any{}
		err = json.Unmarshal(message, &jmsg)
		if err != nil {
			log.Printf("[websocket] error unmarshalling json: %v\n", err)
			break
		}
		conn.SetReadDeadline(time.Now().Add(readWait))
		msgType := getMessageType(jmsg)
		if msgType == "pong" {
			// nothing
			continue
		}
		if msgType == "ping" {
			now := time.Now()
			pongMessage := map[string]interface{}{"type": "pong", "stime": now.UnixMilli()}
			if !sendToWriter(outputCh, writerDone, pongMessage) {
				log.Printf("[websocket] ReadPump (%s): the write loop has ended, closing\n", routeId)
				break
			}
			continue
		}
		wsCommand := getStringFromMap(jmsg, "wscommand")
		if wsCommand == "" {
			continue
		}
		processWSCommand(jmsg, outputCh, writerDone, rpcInputCh)
	}
}

func WritePing(conn *websocket.Conn) error {
	now := time.Now()
	pingMessage := map[string]interface{}{"type": "ping", "stime": now.UnixMilli()}
	jsonVal, _ := json.Marshal(pingMessage)
	return writeWsMessage(conn, jsonVal)
}

// every write needs its own deadline: relying on the last ping's lapses between pings, and under busy
// traffic a message landing in that gap failed with a spurious i/o timeout that dropped the socket.
func writeWsMessage(conn *websocket.Conn, barr []byte) error {
	_ = conn.SetWriteDeadline(time.Now().Add(wsWriteWaitTimeout)) // no error
	return conn.WriteMessage(websocket.TextMessage, barr)
}

// WriteLoop writes until a write fails or the read loop ends. Either way it closes the connection as it returns: a
// failed ping used to return with the socket open, so the WebView kept a link nothing wrote to and never reconnected
// (2026-11-23 10:17: three minutes of "timeout waiting for response" until arcterm was restarted).
func WriteLoop(conn *websocket.Conn, outputCh chan any, closeCh chan any, routeId string) {
	defer conn.Close()
	ticker := time.NewTicker(wsInitialPingTime)
	defer ticker.Stop()
	initialPing := true
	for {
		select {
		case msg := <-outputCh:
			var barr []byte
			var err error
			if _, ok := msg.([]byte); ok {
				barr = msg.([]byte)
			} else {
				barr, err = json.Marshal(msg)
				if err != nil {
					log.Printf("[websocket] cannot marshal websocket message: %v\n", err)
					// just loop again
					break
				}
			}
			err = writeWsMessage(conn, barr)
			if err != nil {
				log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
				return
			}

		case <-ticker.C:
			err := WritePing(conn)
			if err != nil {
				log.Printf("[websocket] WritePump error (%s): %v\n", routeId, err)
				return
			}
			if initialPing {
				initialPing = false
				ticker.Reset(wsPingPeriodTickTime)
			}

		case <-closeCh:
			return
		}
	}
}

func registerConn(wsConnId string, stableId string, wproxy *wshutil.WshRpcProxy) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnInfo := RouteToConnMap[stableId]
	// registered before the old link goes, so the requests the old link had not answered can move to it; nothing
	// reaches the new link before its read loop starts, after this returns
	linkId := wshutil.DefaultRouter.RegisterTrustedRouter(wproxy)
	if curConnInfo != nil {
		log.Printf("[websocket] warning: replacing existing connection for stableid %q\n", stableId)
		if curConnInfo.LinkId != baseds.NoLinkId {
			// cancels the old link's in-flight requests too, or its streaming RPCs leak until their timeout
			wshutil.DefaultRouter.ReplaceLink(curConnInfo.LinkId, linkId)
		}
	}
	RouteToConnMap[stableId] = &StableConnInfo{
		ConnId: wsConnId,
		LinkId: linkId,
	}
}

func unregisterConn(wsConnId string, stableId string) {
	GlobalLock.Lock()
	defer GlobalLock.Unlock()
	curConnInfo := RouteToConnMap[stableId]
	if curConnInfo == nil || curConnInfo.ConnId != wsConnId {
		log.Printf("[websocket] warning: trying to unregister connection %q for stableid %q but it is not the current connection (ignoring)\n", wsConnId, stableId)
		return
	}
	delete(RouteToConnMap, stableId)
	if curConnInfo.LinkId != baseds.NoLinkId {
		// cancels the link's in-flight requests too, or its streaming RPCs leak until their timeout
		wshutil.DefaultRouter.UnregisterLink(curConnInfo.LinkId)
	}
}

func forwardRpcMessages(toRemoteCh <-chan []byte, outputCh chan<- any, closeCh <-chan any) {
	for msgBytes := range toRemoteCh {
		rpcWSMsg := map[string]any{
			"eventtype": "rpc", // TODO don't hard code this (but def is in eventbus)
			"data":      json.RawMessage(msgBytes),
		}
		select {
		case outputCh <- rpcWSMsg:
		case <-closeCh:
			return
		}
	}
}

func HandleWsInternal(w http.ResponseWriter, r *http.Request) error {
	stableId := r.URL.Query().Get("stableid")
	if stableId == "" {
		return fmt.Errorf("stableid is required")
	}
	err := authkey.ValidateIncomingRequest(r)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
		log.Printf("[websocket] error validating authkey: %v\n", err)
		return err
	}
	conn, err := WebSocketUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return fmt.Errorf("WebSocket Upgrade Failed: %v", err)
	}
	defer conn.Close()
	wsConnId := uuid.New().String()
	outputCh := make(chan any, WebSocketChannelSize)
	closeCh := make(chan any)
	log.Printf("[websocket] new connection: connid:%s stableid:%s\n", wsConnId, stableId)
	eventbus.RegisterWSChannel(wsConnId, stableId, outputCh)
	defer eventbus.UnregisterWSChannel(wsConnId)
	wproxy := wshutil.MakeRpcProxyWithSize(fmt.Sprintf("ws:%s", stableId), WebSocketChannelSize, WebSocketChannelSize)
	defer close(wproxy.ToRemoteCh)
	registerConn(wsConnId, stableId, wproxy)
	defer unregisterConn(wsConnId, stableId)
	runWsLoops(conn, outputCh, closeCh, wproxy, stableId)
	return nil
}

// runWsLoops runs the read and write loops and the RPC forwarder of one connection until both loops have ended.
func runWsLoops(conn *websocket.Conn, outputCh chan any, closeCh chan any, wproxy *wshutil.WshRpcProxy, routeId string) {
	writerDone := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:outputCh", recover())
		}()
		// no waitgroup add here
		forwardRpcMessages(wproxy.ToRemoteCh, outputCh, closeCh)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:ReadLoop", recover())
		}()
		defer wg.Done()
		ReadLoop(conn, outputCh, writerDone, closeCh, wproxy.FromRemoteCh, routeId)
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("HandleWsInternal:WriteLoop", recover())
		}()
		defer wg.Done()
		defer close(writerDone)
		WriteLoop(conn, outputCh, closeCh, routeId)
	}()
	wg.Wait()
	close(wproxy.FromRemoteCh)
}
