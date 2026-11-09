package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSessionHTTPEvents(t *testing.T) {
	srv := server{sessions: &sessionTracker{tabs: map[string]time.Time{}, started: time.Now()}}
	cases := []struct {
		body string
		want int
	}{
		{`{"id":"tab_test_identifier_123","event":"open"}`, 200},
		{`{"id":"tab_test_identifier_123","event":"ping"}`, 200},
		{`{"id":"tab_test_identifier_123","event":"close"}`, 200},
		{`{"id":"bad","event":"open"}`, 400},
		{`{"id":"tab_test_identifier_123","event":"invalid"}`, 400},
		{`{not-json}`, 400},
	}
	for _, tc := range cases {
		request := httptest.NewRequest(http.MethodPost, "/__atlas/session", bytes.NewBufferString(tc.body))
		response := httptest.NewRecorder()
		srv.browserSession(response, request)
		if response.Code != tc.want {
			t.Errorf("request %s returned %d, expected %d", tc.body, response.Code, tc.want)
		}
	}
}
