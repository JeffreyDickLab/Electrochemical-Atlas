package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// pdfjsVersion is intentionally pinned to the version in package.json.
// Published portable releases already contain PDF.js. Source checkouts
// can install the same renderer on first launch without requiring Node.js.
const pdfjsVersion = "6.4.299"

const (
	maxRendererModuleBytes = 10 << 20
	minPDFModuleBytes      = 300_000
	minWorkerModuleBytes   = 750_000
)

var rendererSources = []string{
	"https://cdn.jsdelivr.net/npm/pdfjs-dist@" + pdfjsVersion + "/build/",
	"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + pdfjsVersion + "/",
}

func rendererFileSize(name string) int64 {
	switch name {
	case "pdf.mjs":
		return minPDFModuleBytes
	case "pdf.worker.mjs":
		return minWorkerModuleBytes
	default:
		return -1
	}
}

// rendererModuleIsUsable rejects truncated files and the HTML error pages
// that some CDNs return with HTTP 200. The connection is HTTPS and the
// package version is fixed, but CDN downloads are not a substitute for
// a reproducible, lockfile-backed release build.
func rendererModuleIsUsable(path, name string) bool {
	minimum := rendererFileSize(name)
	if minimum < 0 {
		return false
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() < minimum || info.Size() > maxRendererModuleBytes {
		return false
	}
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	prefix := make([]byte, 256)
	n, err := file.Read(prefix)
	if err != nil && err != io.EOF {
		return false
	}
	beginning := strings.ToLower(strings.TrimSpace(string(prefix[:n])))
	return !strings.HasPrefix(beginning, "<") && !strings.HasPrefix(beginning, "{")
}

func rendererDirComplete(dir string) bool {
	return rendererModuleIsUsable(filepath.Join(dir, "pdf.mjs"), "pdf.mjs") &&
		rendererModuleIsUsable(filepath.Join(dir, "pdf.worker.mjs"), "pdf.worker.mjs")
}

// preparePDFRenderer prefers the vendored modules in an official release.
// Source-only portable checkouts download the same pinned modules once into
// the user's private config directory. The user's PDF is never transmitted.
func preparePDFRenderer(root, configDir string, urls []string, client *http.Client) (string, error) {
	bundled := filepath.Join(root, "app", "vendor", "pdfjs")
	if rendererDirComplete(bundled) {
		return bundled, nil
	}
	cache := filepath.Join(configDir, "ElectrochemicalAtlas", "renderer", "pdfjs-"+pdfjsVersion)
	if rendererDirComplete(cache) {
		return cache, nil
	}
	if err := os.MkdirAll(cache, 0700); err != nil {
		return "", fmt.Errorf("create renderer cache: %w", err)
	}
	if len(urls) == 0 {
		return "", errors.New("no PDF renderer download sources configured")
	}
	for _, asset := range []string{"pdf.mjs", "pdf.worker.mjs"} {
		if rendererModuleIsUsable(filepath.Join(cache, asset), asset) {
			continue
		}
		var errorsForAsset []string
		for _, source := range urls {
			if err := fetchRendererModule(client, strings.TrimRight(source, "/")+"/"+asset, filepath.Join(cache, asset), asset); err == nil {
				break
			} else {
				errorsForAsset = append(errorsForAsset, err.Error())
			}
		}
		if !rendererModuleIsUsable(filepath.Join(cache, asset), asset) {
			return "", fmt.Errorf("cannot install %s: %s", asset, strings.Join(errorsForAsset, "; "))
		}
	}
	return cache, nil
}

func fetchRendererModule(client *http.Client, url, destination, name string) error {
	if rendererFileSize(name) < 0 {
		return fmt.Errorf("unrecognized renderer asset %q", name)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s returned HTTP %d", name, res.StatusCode)
	}
	if res.ContentLength > maxRendererModuleBytes {
		return fmt.Errorf("download %s exceeds maximum file size", name)
	}
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".atlas-pdfjs-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	if err := tmp.Chmod(0600); err != nil {
		return err
	}
	count, err := io.Copy(tmp, io.LimitReader(res.Body, maxRendererModuleBytes+1))
	if err != nil {
		return err
	}
	if count > maxRendererModuleBytes || count < rendererFileSize(name) {
		return fmt.Errorf("download %s is incomplete or unexpectedly large (%d bytes)", name, count)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if !rendererModuleIsUsable(tmp.Name(), name) {
		return fmt.Errorf("download %s is not a valid script file", name)
	}
	return os.Rename(tmp.Name(), destination)
}

// servePDFRenderer serves a verified module from either the official bundled
// release or the per-user cache. The path is deliberately an exact allowlist.
func (s *server) servePDFRenderer(w http.ResponseWriter, r *http.Request) bool {
	const prefix = "/app/vendor/pdfjs/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		return false
	}
	name := strings.TrimPrefix(r.URL.Path, prefix)
	if rendererFileSize(name) < 0 || s.rendererDir == "" || !rendererModuleIsUsable(filepath.Join(s.rendererDir, name), name) {
		http.Error(w, "The offline equation renderer is not installed. Launch the Atlas once while connected to the internet, or use an official built release.", http.StatusServiceUnavailable)
		return true
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join(s.rendererDir, name))
	return true
}
