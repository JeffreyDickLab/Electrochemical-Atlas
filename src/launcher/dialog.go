package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func nativeDialog(requestCtx context.Context) (string, error) {
	// Do not let a hidden OS dialog block the browser indefinitely.
	ctx, cancel := context.WithTimeout(requestCtx, 75*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		script := `Add-Type -AssemblyName System.Windows.Forms; ` +
			`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
			`$owner = New-Object System.Windows.Forms.Form; ` +
			`$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0; ` +
			`$owner.StartPosition = 'CenterScreen'; $owner.Show(); $owner.Activate(); ` +
			`$d = New-Object System.Windows.Forms.OpenFileDialog; ` +
			`$d.Title = 'Choose original Electrochemical Methods PDF'; ` +
			`$d.Filter = 'PDF files (*.pdf)|*.pdf|All files (*.*)|*.*'; ` +
			`$d.CheckFileExists = $true; $d.RestoreDirectory = $true; ` +
			`try { if($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { ` +
			`[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($d.FileName)) } } ` +
			`finally { $owner.Close(); $owner.Dispose() }`
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-STA", "-Command", script)
		raw, err := cmd.Output()
		if ctx.Err() != nil {
			return "", errors.New("file chooser timed out or was cancelled; browse the PDF in Atlas or enter its path")
		}
		if err != nil {
			return "", fmt.Errorf("Windows file picker could not open: %w", err)
		}
		value := strings.TrimSpace(string(raw))
		if value == "" {
			return "", errors.New("no file was selected")
		}
		b, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "darwin":
		script := `activate` + "\n" + `POSIX path of (choose file with prompt "Choose your original Electrochemical Methods PDF" of type {"com.adobe.pdf"})`
		cmd = exec.CommandContext(ctx, "osascript", "-e", script)
	default:
		if _, err := exec.LookPath("zenity"); err == nil {
			cmd = exec.CommandContext(ctx, "zenity", "--file-selection", "--title=Select your original PDF", "--file-filter=PDF files | *.pdf")
		} else if _, err := exec.LookPath("kdialog"); err == nil {
			cmd = exec.CommandContext(ctx, "kdialog", "--getopenfilename", os.Getenv("HOME"), "*.pdf")
		} else {
			return "", errors.New("no graphical file chooser is installed on this Linux desktop; paste the absolute PDF path instead")
		}
	}
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return "", errors.New("file chooser timed out or was cancelled; browse the PDF in Atlas or enter its path")
	}
	if err != nil {
		return "", fmt.Errorf("file selection cancelled or unavailable: %w", err)
	}
	path := strings.TrimSpace(string(out))
	if path == "" {
		return "", errors.New("no file was selected")
	}
	return path, nil
}
