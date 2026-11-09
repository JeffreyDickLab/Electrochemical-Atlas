package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRendererBootstrapDownloadsAndReusesCache(t *testing.T) {
	var hits atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch r.URL.Path {
		case "/pdf.mjs":
			_, _ = io.WriteString(w, "/* PDF.js offline test display */\n"+strings.Repeat("const test=1;\n", 27000))
		case "/pdf.worker.mjs":
			_, _ = io.WriteString(w, "/* PDF.js offline test worker */\n"+strings.Repeat("const worker=1;\n", 65000))
		default:
			http.NotFound(w, r)
		}
	}))
	defer remote.Close()
	root := t.TempDir()
	config := t.TempDir()
	dir, err := preparePDFRenderer(root, config, []string{remote.URL + "/"}, remote.Client())
	if err != nil {
		t.Fatal(err)
	}
	if !rendererDirComplete(dir) {
		t.Fatal("first-run source modules were not saved")
	}
	if count := hits.Load(); count != 2 {
		t.Fatalf("got %d downloads, expected two", count)
	}
	// The cache makes subsequent runs completely offline.
	remote.Close()
	again, err := preparePDFRenderer(root, config, nil, remote.Client())
	if err != nil || again != dir {
		t.Fatalf("cached renderer not reused offline: %s, %v", again, err)
	}
}

func TestRendererRejectsHTMLAndTruncatedDownloads(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, strings.Repeat("<html>bad gateway</html>\n", 6000))
	}))
	defer remote.Close()
	_, err := preparePDFRenderer(t.TempDir(), t.TempDir(), []string{remote.URL}, remote.Client())
	if err == nil {
		t.Fatal("accepted HTML instead of PDF.js module")
	}
}

func TestRendererFilesServedOnlyFromAllowlist(t *testing.T) {
	root := t.TempDir()
	moduleDir := filepath.Join(root, "app", "vendor", "pdfjs")
	if err := os.MkdirAll(moduleDir, 0700); err != nil {
		t.Fatal(err)
	}
	for name, size := range map[string]int{"pdf.mjs": 420000, "pdf.worker.mjs": 850000} {
		if err := os.WriteFile(filepath.Join(moduleDir, name), []byte("/* pdf module */\n"+strings.Repeat("/", size)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := server{rendererDir: moduleDir}
	request := httptest.NewRequest(http.MethodGet, "/app/vendor/pdfjs/pdf.mjs", nil)
	response := httptest.NewRecorder()
	if !s.servePDFRenderer(response, request) || response.Code != 200 {
		t.Fatalf("local module not served: HTTP %d", response.Code)
	}
	if got := response.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/javascript") {
		t.Fatalf("module response incorrect Content-Type: %q", got)
	}
	request = httptest.NewRequest(http.MethodGet, "/app/vendor/pdfjs/../../private-file", nil)
	response = httptest.NewRecorder()
	if !s.servePDFRenderer(response, request) || response.Code == 200 {
		t.Fatal("traversal-like request should be rejected, not served")
	}
}
