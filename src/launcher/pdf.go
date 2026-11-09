package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type settings struct {
	Path string `json:"pdf_path"`
}

func (s *server) readConfig() (settings, error) {
	b, err := os.ReadFile(s.configPath)
	if os.IsNotExist(err) {
		return settings{}, nil
	}
	if err != nil {
		return settings{}, err
	}
	var c settings
	if err = json.Unmarshal(b, &c); err != nil {
		return settings{}, err
	}
	return c, nil
}
func (s *server) writeConfig(cfg settings) error {
	dir := filepath.Dir(s.configPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".atlas-source-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.configPath)
}
func validatePDF(path string) (string, int64, error) {
	if path == "" {
		return "", 0, errors.New("no source PDF selected")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", 0, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", 0, err
	}
	if !info.Mode().IsRegular() {
		return "", 0, errors.New("source must be a PDF file")
	}
	h := make([]byte, 5)
	if _, err = io.ReadFull(f, h); err != nil {
		return "", 0, err
	}
	if string(h) != "%PDF-" {
		return "", 0, errors.New("file does not begin with a PDF signature")
	}
	return abs, info.Size(), nil
}
func (s *server) current() (settings, string, int64, error) {
	cfg, err := s.readConfig()
	if err != nil {
		return cfg, "", 0, err
	}
	if cfg.Path == "" {
		return cfg, "", 0, errors.New("no saved PDF path")
	}
	path, size, err := validatePDF(cfg.Path)
	return cfg, path, size, err
}
func sendJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, code int, err error) {
	sendJSON(w, code, map[string]any{"ok": false, "error": err.Error()})
}
func (s *server) savePDF(path string) (string, int64, error) {
	abs, size, err := validatePDF(path)
	if err != nil {
		return "", 0, err
	}
	if err = s.writeConfig(settings{Path: abs}); err != nil {
		return "", 0, err
	}
	return abs, size, nil
}
func (s *server) getStatus(w http.ResponseWriter, r *http.Request) {
	cfg, path, size, err := s.current()
	if err != nil {
		sendJSON(w, 200, map[string]any{"portable": true, "version": appVersion, "configured": cfg.Path != "", "available": false, "error": err.Error()})
		return
	}
	sendJSON(w, 200, map[string]any{"portable": true, "version": appVersion, "configured": true, "available": true, "name": filepath.Base(path), "size": size})
}
func (s *server) getPDF(w http.ResponseWriter, r *http.Request) {
	_, path, _, err := s.current()
	if err != nil {
		fail(w, 404, err)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		fail(w, 404, err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		fail(w, 404, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Requesting the file only serves it from its existing location. No copy
	// or PDF data is ever written to the Atlas package or settings folder.
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}
func (s *server) selectPDF(w http.ResponseWriter, r *http.Request) {
	path, err := nativeDialog(r.Context())
	if err != nil {
		fail(w, 400, err)
		return
	}
	abs, size, err := s.savePDF(path)
	if err != nil {
		fail(w, 400, err)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true, "name": filepath.Base(abs), "size": size})
}
func (s *server) setPath(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	var v struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		fail(w, 400, err)
		return
	}
	path, size, err := s.savePDF(strings.TrimSpace(v.Path))
	if err != nil {
		fail(w, 400, err)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true, "name": filepath.Base(path), "size": size})
}
func (s *server) forgetPDF(w http.ResponseWriter, r *http.Request) {
	if err := os.Remove(s.configPath); err != nil && !os.IsNotExist(err) {
		fail(w, 500, err)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true})
}
