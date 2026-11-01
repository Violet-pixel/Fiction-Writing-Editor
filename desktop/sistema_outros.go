//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func pastaDownloads() string {
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
	_ = exec.Command("xdg-open", d).Start()
}

func escolherPasta(string) (string, error) {
	return "", errors.New("disponível só no Windows")
}

func mensagem(titulo, texto string) {
	fmt.Fprintln(os.Stderr, titulo+": "+texto)
}

func abrirJanela(url, dir string) *exec.Cmd {
	if os.Getenv("SERIFA_SEM_JANELA") != "" {
		return nil
	}
	cmd := exec.Command("xdg-open", url)
	if cmd.Start() != nil {
		return nil
	}
	return cmd
}
