package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const preferredPort = "43119"
const appSignature = "Electrochemical-Atlas-Portable-v1"
const appVersion = "6.30"
const appEntry = "/atlas/app/index.html"

// Distinguish separate Atlas installations even if they use the same port.
// Hashing avoids exposing the local directory path to the browser.
func installationID(root string) string {
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		canonical = root
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		canonical = root
	}
	hash := sha256.Sum256([]byte(filepath.Clean(canonical)))
	return hex.EncodeToString(hash[:12])
}

type server struct {
	configPath, appRoot string
	rendererDir         string
	sessions            *sessionTracker
}

func openBrowser(address string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address)
	case "darwin":
		cmd = exec.Command("open", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Could not open browser automatically. Visit %s: %v", address, err)
	}
	if cmd.Process != nil {
		_ = cmd.Process.Release()
	}
}
func main() {
	execPath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	root := filepath.Dir(filepath.Dir(execPath))
	info, err := os.Stat(filepath.Join(root, "app", "index.html"))
	if err != nil || !info.Mode().IsRegular() {
		log.Fatalf("Atlas files are missing beside the launcher: %v", err)
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatal(err)
	}
	s := &server{configPath: filepath.Join(configDir, "ElectrochemicalAtlas", "original-pdf-path.json"), appRoot: root, sessions: &sessionTracker{tabs: make(map[string]time.Time), started: time.Now()}}
	// Tell source-checkout users when this first launch needs internet.
	if !rendererDirComplete(filepath.Join(root, "app", "vendor", "pdfjs")) &&
		!rendererDirComplete(filepath.Join(configDir, "ElectrochemicalAtlas", "renderer", "pdfjs-"+pdfjsVersion)) {
		log.Printf("Installing local PDF.js equation renderer (one-time network setup). The selected textbook is never uploaded.")
	}
	// A source checkout may lack the generated PDF.js modules. Set them up once
	// from a pinned upstream distribution; official releases are fully offline.
	httpClient := &http.Client{Timeout: 14 * time.Second}
	if rendererDir, setupErr := preparePDFRenderer(root, configDir, rendererSources, httpClient); setupErr == nil {
		s.rendererDir = rendererDir
		log.Printf("Local equation renderer ready.")
	} else {
		log.Printf("Equation renderer could not be installed: %v", setupErr)
		log.Printf("Connect to the internet and restart Atlas once to install it; PDF reading and navigation remain available.")
	}
	// Drag an original PDF onto the launcher (Windows), or pass its path as a
	// command-line argument. This saves only the path and bypasses GUI dialogs.
	if len(os.Args) > 1 {
		supplied := os.Args[1]
		if supplied == "--pdf" && len(os.Args) > 2 {
			supplied = os.Args[2]
		}
		if supplied != "" {
			if path, _, e := s.savePDF(supplied); e != nil {
				log.Printf("Could not use provided PDF path: %v", e)
			} else {
				log.Printf("Saved original PDF location: %s", filepath.Base(path))
			}
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+preferredPort)
	if err != nil {
		client := http.Client{Timeout: 750 * time.Millisecond}
		req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:"+preferredPort+"/__atlas/status", nil)
		resp, e := client.Do(req)
		if e == nil {
			resp.Body.Close()
			if resp.Header.Get("X-Atlas-Launcher") == appSignature &&
				resp.Header.Get("X-Atlas-Installation") == installationID(root) &&
				resp.Header.Get("X-Atlas-Build") == appVersion {
				// Reuse only this exact installation and this exact UI build.
				openBrowser("http://127.0.0.1:" + preferredPort + appEntry)
				return
			}
		}
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("Another Atlas installation is already using port %s. This installation opened on its own port; close the old instance to reuse the usual browser settings.", preferredPort)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	mux.HandleFunc("/__atlas/status", s.getStatus)
	mux.HandleFunc("/__atlas/pdf", s.getPDF)
	mux.HandleFunc("/__atlas/select", s.selectPDF)
	mux.HandleFunc("/__atlas/path", s.setPath)
	mux.HandleFunc("/__atlas/forget", s.forgetPDF)
	mux.HandleFunc("/__atlas/session", s.browserSession)
	mux.HandleFunc("/__atlas/live", s.liveSession)
	fileServer := http.StripPrefix("/app/", http.FileServer(http.Dir(filepath.Join(root, "app"))))
	staticHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.servePDFRenderer(w, r) {
			return
		}
		// This version-qualified route cannot accidentally display a legacy build.
		w.Header().Set("Cache-Control", "no-store, max-age=0")
		w.Header().Set("X-Atlas-Build", appVersion)
		fileServer.ServeHTTP(w, r)
	})
	mux.Handle("/app/", staticHandler)
	mux.Handle("/atlas/app/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip the version prefix so the existing /app/ file server stays reusable.
		r2 := r.Clone(r.Context())
		r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/atlas")
		staticHandler.ServeHTTP(w, r2)
	}))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, appEntry, http.StatusFound)
	})
	guard := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Atlas-Launcher", appSignature)
		w.Header().Set("X-Atlas-Installation", installationID(root))
		w.Header().Set("X-Atlas-Build", appVersion)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		host := r.Host
		if host != "127.0.0.1:"+fmt.Sprint(port) && host != "localhost:"+fmt.Sprint(port) {
			http.Error(w, "Wrong local host", 403)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:"+fmt.Sprint(port) && origin != "http://localhost:"+fmt.Sprint(port) {
			http.Error(w, "Cross-origin requests are not permitted", 403)
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Cross-site requests are not permitted", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/__atlas/") {
			if r.URL.Path != "/__atlas/status" && r.URL.Path != "/__atlas/pdf" && r.URL.Path != "/__atlas/select" && r.URL.Path != "/__atlas/path" && r.URL.Path != "/__atlas/forget" && r.URL.Path != "/__atlas/session" && r.URL.Path != "/__atlas/live" {
				http.NotFound(w, r)
				return
			}
			if r.URL.Path == "/__atlas/select" || r.URL.Path == "/__atlas/path" || r.URL.Path == "/__atlas/forget" || r.URL.Path == "/__atlas/session" {
				if r.Method != http.MethodPost {
					http.Error(w, "Use POST", 405)
					return
				}
				// The browser must supply a same-origin fetch header for every
				// state-changing endpoint. This prevents blind forms from other sites.
				if r.Header.Get("X-Atlas-Request") != "same-origin" {
					http.Error(w, "Invalid request", 403)
					return
				}
			} else if r.Method != http.MethodGet {
				http.Error(w, "Use GET", 405)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
	url := fmt.Sprintf("http://127.0.0.1:%d%s", port, appEntry)
	log.Printf("Electrochemical Atlas: %s", url)
	log.Printf("Only the selected PDF's file path is remembered. No PDF bytes are stored.")
	log.Printf("Closing the final Atlas browser tab also closes this command window after a short grace period.")
	go func() { time.Sleep(250 * time.Millisecond); openBrowser(url) }()
	httpSrv := &http.Server{Handler: guard, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 3 * time.Minute}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if s.sessions.shouldStop(time.Now()) {
				log.Printf("All Atlas tabs have closed; stopping local server.")
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_ = httpSrv.Shutdown(ctx)
				cancel()
				return
			}
		}
	}()
	err = httpSrv.Serve(listener)
	if err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
