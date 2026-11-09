package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidatePDFRejectsUnusableFiles(t *testing.T) {
	if _, _, err := validatePDF(""); err == nil {
		t.Fatal("missing PDF path was accepted")
	}
	temp := t.TempDir()
	wrong := filepath.Join(temp, "wrong.pdf")
	if err := os.WriteFile(wrong, []byte("not a PDF"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := validatePDF(wrong); err == nil {
		t.Fatal("non-PDF file signature was accepted")
	}
}

func TestSelectedPDFPathIsSavedWithoutCopyingContent(t *testing.T) {
	temp := t.TempDir()
	original := filepath.Join(temp, "original.pdf")
	if err := os.WriteFile(original, []byte("%PDF-1.4\nminimal fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	srv := server{configPath: filepath.Join(temp, "config", "pdf.json")}
	path, size, err := srv.savePDF(original)
	if err != nil || size <= 5 || path != original {
		t.Fatalf("failed to save path: %s %d %v", path, size, err)
	}
	cfg, err := srv.readConfig()
	if err != nil || cfg.Path != original {
		t.Fatalf("wrong PDF path in settings: %+v %v", cfg, err)
	}
	entries, err := os.ReadDir(filepath.Dir(srv.configPath))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "pdf.json" {
		t.Fatalf("PDF content seems to have been copied into config directory: %v", entries)
	}
}
