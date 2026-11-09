package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// Atlas tabs identify themselves with one random per-tab identifier. A tab
// that refreshes re-registers before the grace period expires. Unrelated
// browser windows, minimized tabs and extra Atlas tabs are not shut down.
type sessionTracker struct {
	mu         sync.Mutex
	tabs       map[string]time.Time
	seen       bool
	started    time.Time
	emptySince time.Time
}

var validTabID = regexp.MustCompile(`^[A-Za-z0-9_-]{12,75}$`)

func (t *sessionTracker) record(id, event string) error {
	if !validTabID.MatchString(id) {
		return errors.New("invalid session identifier")
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	switch event {
	case "open", "ping":
		t.tabs[id] = time.Now()
		t.seen = true
		t.emptySince = time.Time{}
	case "close":
		delete(t.tabs, id)
		if t.seen && len(t.tabs) == 0 && t.emptySince.IsZero() {
			t.emptySince = time.Now()
		}
	default:
		return errors.New("unknown session event")
	}
	return nil
}
func (t *sessionTracker) shouldStop(now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.seen {
		// Avoid leaving a terminal open forever if the browser cannot start.
		// A working browser registers immediately; slow starts get a grace period.
		return !t.started.IsZero() && now.Sub(t.started) > 90*time.Second
	}
	// Long-lived background tabs can throttle JS heartbeats. Allow generous
	// leeway before considering them closed without a pagehide event.
	for id, last := range t.tabs {
		if now.Sub(last) > 16*time.Second {
			delete(t.tabs, id)
		}
	}
	if len(t.tabs) > 0 {
		t.emptySince = time.Time{}
		return false
	}
	if t.emptySince.IsZero() {
		t.emptySince = now
		return false
	}
	return now.Sub(t.emptySince) > 3*time.Second
}
func (s *server) browserSession(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 512)
	var event struct {
		ID    string `json:"id"`
		Event string `json:"event"`
	}
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		fail(w, 400, err)
		return
	}
	if err := s.sessions.record(event.ID, event.Event); err != nil {
		fail(w, 400, err)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true})
}

// A live browser connection is more reliable than pagehide callbacks, which
// browsers can cancel when their final window is closed. The server sees the
// connection close and exits after a short refresh/multi-tab grace period.
func (s *server) liveSession(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if !validTabID.MatchString(id) {
		http.Error(w, "Invalid tab ID", 400)
		return
	}
	if err := s.sessions.record(id, "open"); err != nil {
		http.Error(w, "Invalid tab ID", 400)
		return
	}
	defer func() { _ = s.sessions.record(id, "close") }()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	flush, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", 500)
		return
	}
	_, _ = io.WriteString(w, "event: ready\ndata: connected\n\n")
	flush.Flush()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			_, err := io.WriteString(w, ": atlas-live\n\n")
			if err != nil {
				return
			}
			flush.Flush()
			// A healthy streaming socket is an implicit heartbeat.
			_ = s.sessions.record(id, "ping")
		}
	}
}
