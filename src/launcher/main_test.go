package main

import (
	"testing"
	"time"
)

func TestBrowserLifecycleClosesAfterLastTab(t *testing.T) {
	now := time.Now()
	tracker := sessionTracker{tabs: map[string]time.Time{}, started: now}
	a, b := "atlas_session_tab_one", "atlas_session_tab_two"
	if err := tracker.record(a, "open"); err != nil {
		t.Fatal(err)
	}
	if err := tracker.record(b, "open"); err != nil {
		t.Fatal(err)
	}
	if err := tracker.record(a, "close"); err != nil {
		t.Fatal(err)
	}
	if tracker.shouldStop(now.Add(5 * time.Second)) {
		t.Fatal("still-open second tab must keep server running")
	}
	if err := tracker.record(b, "close"); err != nil {
		t.Fatal(err)
	}
	if tracker.shouldStop(time.Now().Add(time.Second)) {
		t.Fatal("must allow grace period for refresh")
	}
	if !tracker.shouldStop(time.Now().Add(5 * time.Second)) {
		t.Fatal("last tab closed but server did not stop")
	}
}

func TestNoBrowserStartEventuallyStopsLauncher(t *testing.T) {
	now := time.Now()
	tracker := sessionTracker{tabs: map[string]time.Time{}, started: now}
	if tracker.shouldStop(now.Add(10 * time.Second)) {
		t.Fatal("premature startup shutdown")
	}
	if !tracker.shouldStop(now.Add(91 * time.Second)) {
		t.Fatal("orphan launch never shuts down")
	}
}

func TestInvalidSessionIdentifiersRejected(t *testing.T) {
	tracker := sessionTracker{tabs: map[string]time.Time{}, started: time.Now()}
	if err := tracker.record("bad", "open"); err == nil {
		t.Fatal("invalid tab ID accepted")
	}
	if err := tracker.record("valid_session_12345", "unknown"); err == nil {
		t.Fatal("invalid event accepted")
	}
}
