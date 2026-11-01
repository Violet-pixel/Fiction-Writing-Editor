//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var (
	shell32  = syscall.NewLazyDLL("shell32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")
	user32   = syscall.NewLazyDLL("user32.dll")
	pKnown   = shell32.NewProc("SHGetKnownFolderPath")
	pFree    = ole32.NewProc("CoTaskMemFree")
	pMsgBox  = user32.NewProc("MessageBoxW")
	downloadsGUID = syscall.GUID{Data1: 0x374DE290, Data2: 0x123F, Data3: 0x4565, Data4: [8]byte{0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B}}
)

const semJanela = 0x08000000

func pastaDownloads() string {
	var p *uint16
	r, _, _ := pKnown.Call(uintptr(unsafe.Pointer(&downloadsGUID)), 0, 0, uintptr(unsafe.Pointer(&p)))
	if r == 0 && p != nil {
		defer pFree.Call(uintptr(unsafe.Pointer(p)))
		n := 0
		for *(*uint16)(unsafe.Add(unsafe.Pointer(p), n*2)) != 0 {
			n++
		}
		s := syscall.UTF16ToString(unsafe.Slice(p, n))
		if s != "" {
			return s
		}
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Downloads")
}

func pastaConfig() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "Serifa")
}

func abrirPasta(d string) {
	_ = exec.Command("explorer.exe", d).Start()
}

func escolherPasta(inicial string) (string, error) {
	script := `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ` +
		`$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Pasta onde o Serifa salva as histórias'; ` +
		`$d.ShowNewFolderButton=$true; $d.SelectedPath=$env:SERIFA_INICIAL; ` +
		`$f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; ` +
		`if($d.ShowDialog($f) -eq 'OK'){ [Console]::Out.Write($d.SelectedPath) }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = append(os.Environ(), "SERIFA_INICIAL="+inicial)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: semJanela}
	out, err := cmd.Output()
	if err != nil {
		return "", errors.New("não foi possível abrir a janela de pastas")
	}
	return strings.TrimSpace(string(out)), nil
}

func mensagem(titulo, texto string) {
	t, _ := syscall.UTF16PtrFromString(titulo)
	m, _ := syscall.UTF16PtrFromString(texto)
	pMsgBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x40)
}

func navegador() string {
	var cands []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		if b := os.Getenv(env); b != "" {
			cands = append(cands, filepath.Join(b, "Microsoft", "Edge", "Application", "msedge.exe"))
		}
	}
	for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
		if b := os.Getenv(env); b != "" {
			cands = append(cands, filepath.Join(b, "Google", "Chrome", "Application", "chrome.exe"))
		}
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func abrirJanela(url, dir string) *exec.Cmd {
	nav := navegador()
	if nav == "" {
		_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
		return nil
	}
	cmd := exec.Command(nav, "--app="+url, "--user-data-dir="+filepath.Join(dir, "janela"), "--start-maximized",
		"--no-first-run", "--no-default-browser-check", "--disable-features=Translate", "--lang=pt-BR")
	if err := cmd.Start(); err != nil {
		_ = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start()
		return nil
	}
	return cmd
}
