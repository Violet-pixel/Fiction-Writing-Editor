package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed all:app
var appFS embed.FS

const porta = 8840

var versao = "1.0.0"

type config struct {
	Base       string `json:"base"`
	CriarPasta *bool  `json:"criarPasta,omitempty"`
	SalvarAuto *bool  `json:"salvarAuto,omitempty"`
}

var (
	mu         sync.Mutex
	cfg        config
	cfgPath    string
	ultimoPing atomic.Int64
	origem     = fmt.Sprintf("http://127.0.0.1:%d", porta)
)

func main() {
	dir := pastaConfig()
	_ = os.MkdirAll(dir, 0o755)
	cfgPath = filepath.Join(dir, "config.json")
	carregarConfig()
	url := origem + "/"
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", porta))
	if err != nil {
		if serifaAberto(url) {
			abrirJanela(url, dir)
			return
		}
		mensagem("Serifa", fmt.Sprintf("A porta %d já está em uso por outro programa. Feche-o e abra o Serifa de novo.", porta))
		return
	}
	sub, _ := fs.Sub(appFS, "app")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/desktop/", api)
	mux.Handle("/", estatico(sub))
	srv := &http.Server{Handler: seguranca(mux), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	ultimoPing.Store(time.Now().Unix())
	var saiu atomic.Bool
	if cmd := abrirJanela(url, dir); cmd != nil {
		go func() {
			_ = cmd.Wait()
			saiu.Store(true)
		}()
	}
	for {
		time.Sleep(3 * time.Second)
		sem := time.Now().Unix() - ultimoPing.Load()
		if sem > 60 || (saiu.Load() && sem > 15) {
			break
		}
	}
	_ = srv.Close()
}

func serifaAberto(url string) bool {
	c := http.Client{Timeout: 2 * time.Second}
	req, _ := http.NewRequest("GET", url+"api/desktop/info", nil)
	req.Header.Set("X-Serifa", "1")
	r, err := c.Do(req)
	if err != nil {
		return false
	}
	defer r.Body.Close()
	var d map[string]any
	return json.NewDecoder(r.Body).Decode(&d) == nil && d["desktop"] == true
}

func carregarConfig() {
	mu.Lock()
	defer mu.Unlock()
	if b, err := os.ReadFile(cfgPath); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
}

func gravarConfig() error {
	b, _ := json.MarshalIndent(cfg, "", "  ")
	tmp := cfgPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, cfgPath)
}

func base() string {
	if cfg.Base != "" {
		if st, err := os.Stat(cfg.Base); err == nil && st.IsDir() {
			return cfg.Base
		}
	}
	return pastaDownloads()
}

func flag(b *bool) bool { return b == nil || *b }

func info() map[string]any {
	return map[string]any{"desktop": true, "versao": versao, "base": base(), "padrao": pastaDownloads(),
		"criarPasta": flag(cfg.CriarPasta), "salvarAuto": flag(cfg.SalvarAuto)}
}

var reservados = map[string]bool{"CON": true, "PRN": true, "AUX": true, "NUL": true}

func limpar(nome string) string {
	var b strings.Builder
	for _, r := range nome {
		if r < 32 || strings.ContainsRune(`\/:*?"<>|`, r) {
			b.WriteRune(' ')
			continue
		}
		b.WriteRune(r)
	}
	s := strings.Join(strings.Fields(b.String()), " ")
	s = strings.Trim(s, " .")
	if len([]rune(s)) > 120 {
		s = string([]rune(s)[:120])
	}
	up := strings.ToUpper(strings.SplitN(s, ".", 2)[0])
	if reservados[up] || (len(up) == 4 && (strings.HasPrefix(up, "COM") || strings.HasPrefix(up, "LPT"))) {
		s = "_" + s
	}
	if s == "" || s == ".." {
		s = "Sem título"
	}
	return s
}

func pastaHistoria(q string) string {
	if strings.TrimSpace(q) == "" {
		return base()
	}
	return filepath.Join(base(), limpar(q))
}

func responder(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func falha(w http.ResponseWriter, code int, err error) {
	responder(w, code, map[string]string{"erro": err.Error()})
}

func api(w http.ResponseWriter, r *http.Request) {
	acao := strings.TrimPrefix(r.URL.Path, "/api/desktop/")
	ultimoPing.Store(time.Now().Unix())
	if acao != "info" && r.Method != http.MethodPost {
		falha(w, http.StatusMethodNotAllowed, errors.New("use POST"))
		return
	}
	mu.Lock()
	defer mu.Unlock()
	q := r.URL.Query()
	switch acao {
	case "info", "ping":
		responder(w, 200, info())
	case "config":
		var in struct {
			Base       *string `json:"base"`
			CriarPasta *bool   `json:"criarPasta"`
			SalvarAuto *bool   `json:"salvarAuto"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil {
			falha(w, 400, errors.New("configuração inválida"))
			return
		}
		if in.Base != nil {
			b := strings.TrimSpace(*in.Base)
			if b != "" {
				if st, err := os.Stat(b); err != nil || !st.IsDir() {
					falha(w, 400, errors.New("a pasta não existe"))
					return
				}
			}
			cfg.Base = b
		}
		if in.CriarPasta != nil {
			cfg.CriarPasta = in.CriarPasta
		}
		if in.SalvarAuto != nil {
			cfg.SalvarAuto = in.SalvarAuto
		}
		if err := gravarConfig(); err != nil {
			falha(w, 500, err)
			return
		}
		responder(w, 200, info())
	case "escolher-pasta":
		p, err := escolherPasta(base())
		if err != nil {
			falha(w, 500, err)
			return
		}
		responder(w, 200, map[string]string{"base": p})
	case "criar-pasta":
		d := pastaHistoria(q.Get("pasta"))
		if err := os.MkdirAll(d, 0o755); err != nil {
			falha(w, 500, err)
			return
		}
		responder(w, 200, map[string]string{"caminho": d})
	case "abrir-pasta":
		d := pastaHistoria(q.Get("pasta"))
		_ = os.MkdirAll(d, 0o755)
		abrirPasta(d)
		responder(w, 200, map[string]string{"caminho": d})
	case "salvar":
		d := pastaHistoria(q.Get("pasta"))
		nome := limpar(q.Get("arquivo"))
		if err := os.MkdirAll(d, 0o755); err != nil {
			falha(w, 500, err)
			return
		}
		dados, err := io.ReadAll(io.LimitReader(r.Body, 300<<20))
		if err != nil {
			falha(w, 400, err)
			return
		}
		dest := filepath.Join(d, nome)
		tmp := dest + ".serifa-tmp"
		if err := os.WriteFile(tmp, dados, 0o644); err != nil {
			falha(w, 500, err)
			return
		}
		if err := os.Rename(tmp, dest); err != nil {
			_ = os.Remove(tmp)
			falha(w, 500, err)
			return
		}
		responder(w, 200, map[string]string{"caminho": dest})
	default:
		falha(w, 404, errors.New("ação desconhecida"))
	}
}

func seguranca(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if host != fmt.Sprintf("127.0.0.1:%d", porta) && host != fmt.Sprintf("localhost:%d", porta) {
			http.Error(w, "host recusado", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			o := r.Header.Get("Origin")
			if o != "" && o != origem && o != fmt.Sprintf("http://localhost:%d", porta) {
				http.Error(w, "origem recusada", http.StatusForbidden)
				return
			}
			if o == "" && r.Method == http.MethodPost && r.Header.Get("X-Serifa") != "1" {
				http.Error(w, "pedido recusado", http.StatusForbidden)
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

var tipos = map[string]string{
	".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
	".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
	".aff": "text/plain; charset=utf-8", ".dic": "text/plain; charset=utf-8",
}

func estatico(sub fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "método não permitido", http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if strings.HasSuffix(p, "/") {
			p += "index.html"
		}
		nome := strings.TrimPrefix(p, "/")
		if nome == "" || nome == "." {
			nome = "index.html"
		}
		ct := tipos[path.Ext(nome)]
		if ct == "" {
			ct = mime.TypeByExtension(path.Ext(nome))
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-cache")
		if b, err := fs.ReadFile(sub, nome+".gz"); err == nil {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Vary", "Accept-Encoding")
			w.Header().Set("Content-Length", fmt.Sprint(len(b)))
			if r.Method == http.MethodHead {
				return
			}
			_, _ = w.Write(b)
			return
		}
		b, err := fs.ReadFile(sub, nome)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(b)))
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(b)
	})
}

