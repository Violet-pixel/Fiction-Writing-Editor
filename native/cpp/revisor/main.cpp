// main.cpp — CLI `revisor` do Serifa: revisão ortográfica de arquivos de texto.
// Copyright (©) 2026 Clara Portes
//
// Uso: revisor [opções] arquivo.txt [arquivo2.txt ...]
//   --json               saída em JSON (um objeto por arquivo; lista se houver vários)
//   --dic caminho        dicionário (.dic, .aff, pasta ou caminho sem extensão)
//   --pessoal arquivo    palavras extras aceitas (uma por linha; # comenta)
//   --contar             inclui as estatísticas de texto (seção 1)
//   --sem-sugestoes      só lista as palavras desconhecidas (mais rápido)
// Códigos de saída: 0 = nenhuma palavra desconhecida, 1 = há palavras desconhecidas, 2 = erro.
#include "hunspell_lite.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

extern "C" {
#include "../../c/textstats.h"
}

using namespace serifa;

static void uso()
{
    std::fprintf(stderr,
                 "Uso: revisor [opções] arquivo.txt [arquivo2.txt ...]\n"
                 "  --json               saída em JSON\n"
                 "  --dic caminho        dicionário (.dic, .aff, pasta ou caminho sem extensão)\n"
                 "  --pessoal arquivo    palavras extras aceitas (uma por linha)\n"
                 "  --contar             inclui as estatísticas de texto\n"
                 "  --sem-sugestoes      não calcula sugestões\n"
                 "Use \"-\" para ler da entrada padrão.\n"
                 "Saída: linha:coluna palavra → sugestões (coluna em caracteres, a partir de 1).\n");
}

static bool read_all(const std::string &path, std::string &out)
{
    FILE *f = path == "-" ? stdin : std::fopen(path.c_str(), "rb");
    if (!f) return false;
    char buf[1 << 16];
    size_t n;
    out.clear();
    while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) out.append(buf, n);
    bool err = std::ferror(f) != 0;
    if (f != stdin) std::fclose(f);
    return !err;
}

static bool exists(const std::string &p)
{
    FILE *f = std::fopen(p.c_str(), "rb");
    if (!f) return false;
    std::fclose(f);
    return true;
}

static bool ends_with(const std::string &s, const std::string &suf)
{
    return s.size() >= suf.size() && s.compare(s.size() - suf.size(), suf.size(), suf) == 0;
}

// Resolve o par .aff/.dic a partir do que o usuário passou (ou dos lugares padrão).
static bool resolve_dic(const std::string &given, const char *argv0, std::string &aff, std::string &dic)
{
    std::vector<std::string> bases;
    if (!given.empty()) {
        std::string g = given;
        if (ends_with(g, ".dic") || ends_with(g, ".aff")) g = g.substr(0, g.size() - 4);
        bases.push_back(g);
        bases.push_back(g + "/pt-BR");
    } else {
        std::string exe = argv0 ? argv0 : "";
        size_t slash = exe.find_last_of("/\\");
        std::string dir = slash == std::string::npos ? std::string(".") : exe.substr(0, slash);
        const char *rel[] = {"web/dicionario/pt-BR", "../web/dicionario/pt-BR", "../../web/dicionario/pt-BR",
                             "../../../web/dicionario/pt-BR"};
        for (const char *r : rel) bases.push_back(r);
        for (const char *r : rel) bases.push_back(dir + "/" + r);
    }
    for (const auto &b : bases) {
        if (exists(b + ".aff") && exists(b + ".dic")) {
            aff = b + ".aff";
            dic = b + ".dic";
            return true;
        }
    }
    return false;
}

static std::string json_str(const std::string &s)
{
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
            if (c < 0x20) {
                char b[8];
                std::snprintf(b, sizeof b, "\\u%04x", c);
                o += b;
            } else o += (char)c;
        }
    }
    return o + "\"";
}

int main(int argc, char **argv)
{
    bool json = false, contar = false, sugestoes = true;
    std::string dic_arg, pessoal;
    std::vector<std::string> files;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--json") json = true;
        else if (a == "--contar") contar = true;
        else if (a == "--sem-sugestoes") sugestoes = false;
        else if (a == "--dic" && i + 1 < argc) dic_arg = argv[++i];
        else if (a == "--pessoal" && i + 1 < argc) pessoal = argv[++i];
        else if (a == "-h" || a == "--help" || a == "--ajuda") { uso(); return 0; }
        else if (a.size() > 1 && a[0] == '-' && a[1] == '-') {
            std::fprintf(stderr, "revisor: opção desconhecida: %s\n", a.c_str());
            uso();
            return 2;
        } else files.push_back(a);
    }
    if (files.empty()) { uso(); return 2; }

    std::string aff, dic;
    if (!resolve_dic(dic_arg, argv[0], aff, dic)) {
        std::fprintf(stderr, "revisor: dicionário não encontrado%s%s. Use --dic caminho/pt-BR.dic.\n",
                     dic_arg.empty() ? "" : " em ", dic_arg.c_str());
        return 2;
    }

    auto t0 = std::chrono::steady_clock::now();
    Dictionary d;
    std::string err;
    if (!d.load(aff, dic, err)) {
        std::fprintf(stderr, "revisor: erro ao carregar o dicionário: %s\n", err.c_str());
        return 2;
    }
    if (!pessoal.empty()) {
        std::string txt;
        if (!read_all(pessoal, txt)) {
            std::fprintf(stderr, "revisor: não foi possível ler o dicionário pessoal \"%s\".\n", pessoal.c_str());
            return 2;
        }
        size_t s = 0;
        while (s <= txt.size()) {
            size_t e = txt.find('\n', s);
            if (e == std::string::npos) e = txt.size();
            std::string w = txt.substr(s, e - s);
            while (!w.empty() && (w.back() == '\r' || w.back() == ' ' || w.back() == '\t')) w.pop_back();
            while (!w.empty() && (w[0] == ' ' || w[0] == '\t')) w.erase(0, 1);
            if (!w.empty() && w[0] != '#') d.add_personal(utf8_to_u32(w));
            s = e + 1;
        }
    }
    auto t1 = std::chrono::steady_clock::now();
    double load_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

    size_t total = 0;
    bool failed = false;
    if (json && files.size() > 1) std::printf("[");
    for (size_t fi = 0; fi < files.size(); fi++) {
        std::string raw;
        if (!read_all(files[fi], raw)) {
            std::fprintf(stderr, "revisor: não foi possível ler \"%s\".\n", files[fi].c_str());
            failed = true;
            continue;
        }
        if (raw.size() >= 3 && (unsigned char)raw[0] == 0xEF && (unsigned char)raw[1] == 0xBB && (unsigned char)raw[2] == 0xBF)
            raw.erase(0, 3);  // BOM
        std::u32string text = utf8_to_u32(raw);
        std::vector<Misspelling> ms = d.review(text, sugestoes);
        total += ms.size();
        ts_u32 st[TS_FIELDS];
        if (contar) ts_count_utf8((const unsigned char *)raw.data(), (unsigned long)raw.size(), st);

        if (json) {
            if (fi > 0 && files.size() > 1) std::printf(",");
            std::printf("{\"file\":%s,\"spelling\":[", json_str(files[fi]).c_str());
            for (size_t k = 0; k < ms.size(); k++) {
                const Misspelling &m = ms[k];
                std::printf("%s{\"word\":%s,\"start\":%zu,\"end\":%zu,\"line\":%zu,\"column\":%zu,\"suggestions\":[",
                            k ? "," : "", json_str(u32_to_utf8(m.word)).c_str(), m.start16, m.end16, m.line, m.column);
                for (size_t s = 0; s < m.suggestions.size(); s++)
                    std::printf("%s%s", s ? "," : "", json_str(u32_to_utf8(m.suggestions[s])).c_str());
                std::printf("]}");
            }
            std::printf("]");
            if (contar)
                std::printf(",\"count\":{\"words\":%u,\"characters\":%u,\"charactersNoSpaces\":%u,\"paragraphs\":%u,"
                            "\"sentences\":%u,\"dialogues\":%u,\"readingMinutes\":%u}",
                            st[TS_WORDS], st[TS_CHARACTERS], st[TS_CHARACTERS_NO_SPACES], st[TS_PARAGRAPHS],
                            st[TS_SENTENCES], st[TS_DIALOGUES], ts_reading_minutes(st[TS_WORDS]));
            std::printf("}");
        } else {
            std::string prefix = files.size() > 1 ? files[fi] + ":" : "";
            for (const Misspelling &m : ms) {
                std::string sug;
                for (size_t s = 0; s < m.suggestions.size(); s++) sug += (s ? ", " : "") + u32_to_utf8(m.suggestions[s]);
                if (sug.empty()) sug = sugestoes ? "(sem sugestões)" : "?";
                std::printf("%s%zu:%zu %s → %s\n", prefix.c_str(), m.line, m.column, u32_to_utf8(m.word).c_str(), sug.c_str());
            }
            if (contar) {
                std::printf("%sPalavras: %u | Caracteres: %u | Sem espaços: %u | Parágrafos: %u | Frases: %u | Falas: %u | Leitura: %u min\n",
                            prefix.c_str(), st[TS_WORDS], st[TS_CHARACTERS], st[TS_CHARACTERS_NO_SPACES], st[TS_PARAGRAPHS],
                            st[TS_SENTENCES], st[TS_DIALOGUES], ts_reading_minutes(st[TS_WORDS]));
            }
        }
    }
    if (json && files.size() > 1) std::printf("]");
    if (json) std::printf("\n");
    double all_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    if (!json)
        std::fprintf(stderr, "%zu palavra(s) desconhecida(s). Dicionário: %zu verbetes, %zu afixos, carregado em %.0f ms; total %.0f ms.\n",
                     total, d.word_count(), d.affix_count(), load_ms, all_ms);
    if (failed) return 2;
    return total > 0 ? 1 : 0;
}
