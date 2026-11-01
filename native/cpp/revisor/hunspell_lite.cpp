// hunspell_lite.cpp — verificação ortográfica "hunspell-lite" do Serifa (seção 3 da especificação).
// Copyright (©) 2026 Clara Portes
#include "hunspell_lite.hpp"

#include <algorithm>
#include <functional>
#include <cstring>
#include <sstream>

extern "C" {
#include "../../c/textstats.h"
}

// A distância vem do mesmo código do fuzzy.wasm (sem as exportações do WebAssembly).
#define FZ_NO_EXPORTS
#include "../fuzzy.cpp"

namespace serifa {

// ---------------------------------------------------------------------------
// UTF-8 e caixa
// ---------------------------------------------------------------------------
std::u32string utf8_to_u32(const std::string &s)
{
    std::u32string out;
    out.reserve(s.size());
    unsigned long pos = 0, n = (unsigned long)s.size();
    const unsigned char *p = (const unsigned char *)s.data();
    while (pos < n) out.push_back((char32_t)ts_utf8_next(p, n, &pos));
    return out;
}

std::string u32_to_utf8(const std::u32string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (char32_t c : s) {
        if (c < 0x80) out.push_back((char)c);
        else if (c < 0x800) {
            out.push_back((char)(0xC0 | (c >> 6)));
            out.push_back((char)(0x80 | (c & 0x3F)));
        } else if (c < 0x10000) {
            out.push_back((char)(0xE0 | (c >> 12)));
            out.push_back((char)(0x80 | ((c >> 6) & 0x3F)));
            out.push_back((char)(0x80 | (c & 0x3F)));
        } else {
            out.push_back((char)(0xF0 | (c >> 18)));
            out.push_back((char)(0x80 | ((c >> 12) & 0x3F)));
            out.push_back((char)(0x80 | ((c >> 6) & 0x3F)));
            out.push_back((char)(0x80 | (c & 0x3F)));
        }
    }
    return out;
}

char32_t to_lower(char32_t c)
{
    if (c < 0x80) return (c >= U'A' && c <= U'Z') ? c + 32 : c;
    if (c >= 0xC0 && c <= 0xDE && c != 0xD7) return c + 32;
    if (c >= 0x100 && c <= 0x17F) {
        if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c & 1) ? c + 1 : c;
        if (c == 0x130) return U'i';
        if (c == 0x178) return 0xFF;
        if (c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) return c;
        return (c & 1) ? c : c + 1;
    }
    if (c >= 0x391 && c <= 0x3A9 && c != 0x3A2) return c + 32;  // grego
    if (c >= 0x410 && c <= 0x42F) return c + 32;                // cirílico
    if (c >= 0x400 && c <= 0x40F) return c + 80;
    return c;
}

char32_t to_upper(char32_t c)
{
    if (c < 0x80) return (c >= U'a' && c <= U'z') ? c - 32 : c;
    if (c >= 0xE0 && c <= 0xFE && c != 0xF7) return c - 32;
    if (c == 0xFF) return 0x178;
    if (c >= 0x100 && c <= 0x17F) {
        if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c & 1) ? c : c - 1;
        if (c == 0x131) return U'I';
        if (c == 0x130 || c == 0x138 || c == 0x149 || c == 0x178 || c == 0x17F) return c;
        return (c & 1) ? c - 1 : c;
    }
    if (c >= 0x3B1 && c <= 0x3C9 && c != 0x3C2) return c - 32;
    if (c >= 0x430 && c <= 0x44F) return c - 32;
    if (c >= 0x450 && c <= 0x45F) return c - 80;
    return c;
}

std::u32string lower(const std::u32string &s)
{
    std::u32string o(s);
    for (auto &c : o) c = to_lower(c);
    return o;
}

std::u32string upper(const std::u32string &s)
{
    std::u32string o(s);
    for (auto &c : o) c = to_upper(c);
    return o;
}

std::u32string capitalize(const std::u32string &s)
{
    std::u32string o = lower(s);
    if (!o.empty()) o[0] = to_upper(o[0]);
    return o;
}

bool is_word_char(char32_t c) { return ts_is_word_char((ts_u32)c) != 0; }
bool is_space(char32_t c) { return ts_is_space((ts_u32)c) != 0; }

int weighted_distance(const std::u32string &a, const std::u32string &b)
{
    return fz::distance((const fz_u32 *)a.data(), (fz_u32)a.size(), (const fz_u32 *)b.data(), (fz_u32)b.size());
}

// ---------------------------------------------------------------------------
// Leitura do .aff
// ---------------------------------------------------------------------------
bool CondElem::matches(char32_t c) const
{
    if (any) return true;
    bool in = set.find(c) != std::u32string::npos;
    return negated ? !in : in;
}

static std::vector<CondElem> parse_condition(const std::u32string &s)
{
    std::vector<CondElem> out;
    if (s == U".") {  // "." sozinho: qualquer radical (hunspell trata como sem condição)
        return out;
    }
    for (size_t i = 0; i < s.size(); i++) {
        CondElem e;
        if (s[i] == U'.') e.any = true;
        else if (s[i] == U'[') {
            size_t j = i + 1;
            if (j < s.size() && s[j] == U'^') { e.negated = true; j++; }
            while (j < s.size() && s[j] != U']') e.set.push_back(s[j++]);
            i = j;  // fica no ']'
        } else e.set.push_back(s[i]);
        out.push_back(e);
    }
    return out;
}

// Quebra uma linha em campos separados por espaço/tab.
static std::vector<std::u32string> fields(const std::u32string &line)
{
    std::vector<std::u32string> f;
    size_t i = 0, n = line.size();
    while (i < n) {
        while (i < n && (line[i] == U' ' || line[i] == U'\t')) i++;
        if (i >= n) break;
        size_t j = i;
        while (j < n && line[j] != U' ' && line[j] != U'\t') j++;
        f.push_back(line.substr(i, j - i));
        i = j;
    }
    return f;
}

static void split_lines(const std::string &text, std::vector<std::string> &lines)
{
    size_t i = 0, n = text.size();
    while (i <= n) {
        size_t j = text.find('\n', i);
        if (j == std::string::npos) j = n;
        size_t e = j;
        if (e > i && text[e - 1] == '\r') e--;
        lines.emplace_back(text, i, e - i);
        if (j == n) break;
        i = j + 1;
    }
}

bool Dictionary::parse_aff(const std::string &text, std::string &error)
{
    std::vector<std::string> lines;
    split_lines(text, lines);
    std::unordered_map<char32_t, bool> cross_of;
    for (size_t ln = 0; ln < lines.size(); ln++) {
        const std::string &raw = lines[ln];
        if (raw.empty() || raw[0] == '#') continue;
        std::vector<std::u32string> f = fields(utf8_to_u32(raw));
        if (f.empty()) continue;
        const std::u32string &k = f[0];
        if ((k == U"SFX" || k == U"PFX") && f.size() >= 4) {
            bool is_pfx = k == U"PFX";
            char32_t flag = f[1].empty() ? 0 : f[1][0];
            if ((f[2] == U"Y" || f[2] == U"N") && f.size() == 4) {  // cabeçalho
                cross_of[flag] = f[2] == U"Y";
                continue;
            }
            Affix a;
            a.prefix = is_pfx;
            a.flag = flag;
            a.cross = cross_of.count(flag) ? cross_of[flag] : false;
            a.strip = f[2] == U"0" ? U"" : f[2];
            std::u32string add = f[3];
            size_t slash = add.find(U'/');
            if (slash != std::u32string::npos) add = add.substr(0, slash);  // ignora flags de continuação
            a.add = add == U"0" ? U"" : add;
            a.cond = parse_condition(f.size() >= 5 ? f[4] : U".");
            int idx = (int)affixes_.size();
            affixes_.push_back(a);
            auto &groups = (is_pfx ? pfx_by_add_ : sfx_by_add_)[a.add];
            auto g = std::find_if(groups.begin(), groups.end(), [&](const StripGroup &s) { return s.strip == a.strip; });
            if (g == groups.end()) {
                groups.push_back(StripGroup{a.strip, {}});
                g = groups.end() - 1;
            }
            g->rules.push_back(idx);
            size_t &mx = is_pfx ? max_pfx_add_ : max_sfx_add_;
            mx = std::max(mx, a.add.size());
        } else if (k == U"REP" && f.size() >= 3) {
            rep_.emplace_back(f[1], f[2]);
        } else if (k == U"MAP" && f.size() >= 2 && f.size() == 2 && !(f[1].size() > 0 && is_digit(f[1][0]))) {
            map_.push_back(f[1]);
        } else if (k == U"TRY" && f.size() >= 2) {
            try_ = f[1];
        } else if (k == U"FORBIDDENWORD" && f.size() >= 2) {
            forbidden_ = f[1][0];
        } else if (k == U"NOSUGGEST" && f.size() >= 2) {
            nosuggest_ = f[1][0];
        }
    }
    if (affixes_.empty()) {
        error = "nenhuma regra de afixo encontrada no .aff";
        return false;
    }
    return true;
}

bool Dictionary::parse_dic(const std::string &text, std::string &error)
{
    std::vector<std::string> lines;
    split_lines(text, lines);
    if (lines.empty()) {
        error = ".dic vazio";
        return false;
    }
    dic_.reserve(lines.size() + lines.size() / 4);
    for (size_t ln = 1; ln < lines.size(); ln++) {  // 1ª linha = contagem
        const std::string &raw = lines[ln];
        if (raw.empty()) continue;
        std::u32string line = utf8_to_u32(raw);
        size_t slash = line.find(U'/');
        std::u32string word = slash == std::u32string::npos ? line : line.substr(0, slash);
        std::u32string flags = slash == std::u32string::npos ? U"" : line.substr(slash + 1);
        // Corta campos morfológicos opcionais (depois de tab).
        size_t tab = flags.find(U'\t');
        if (tab != std::u32string::npos) flags = flags.substr(0, tab);
        while (!word.empty() && (word.back() == U' ' || word.back() == U'\t')) word.pop_back();
        if (word.empty()) continue;
        Entry &e = dic_[word];
        bool forb = forbidden_ && flags.find(forbidden_) != std::u32string::npos;
        if (forb) e.forbidden = true;
        else e.allowed = true;
        for (char32_t c : flags)
            if (e.flags.find(c) == std::u32string::npos) e.flags.push_back(c);
    }
    return true;
}

static bool read_file(const std::string &path, std::string &out)
{
    FILE *f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    long sz = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (sz < 0) { std::fclose(f); return false; }
    out.resize((size_t)sz);
    size_t got = sz > 0 ? std::fread(&out[0], 1, (size_t)sz, f) : 0;
    std::fclose(f);
    out.resize(got);
    return true;
}

bool Dictionary::load(const std::string &aff_path, const std::string &dic_path, std::string &error)
{
    std::string aff, dic;
    if (!read_file(aff_path, aff)) { error = "não foi possível ler " + aff_path; return false; }
    if (!read_file(dic_path, dic)) { error = "não foi possível ler " + dic_path; return false; }
    if (!parse_aff(aff, error)) return false;
    return parse_dic(dic, error);
}

void Dictionary::add_personal(const std::u32string &word)
{
    if (!word.empty()) personal_.insert(lower(word));
}

// ---------------------------------------------------------------------------
// lookup / check
// ---------------------------------------------------------------------------
static inline bool has_flag(const Entry &e, char32_t f) { return f && e.flags.find(f) != std::u32string::npos; }

bool Dictionary::entry_ok(const Entry &e, bool for_suggest) const
{
    return !(for_suggest && has_flag(e, nosuggest_));
}

static bool cond_suffix(const std::u32string &stem, const Affix &a)
{
    size_t n = a.cond.size();
    if (stem.size() < n) return false;
    size_t off = stem.size() - n;
    for (size_t k = 0; k < n; k++)
        if (!a.cond[k].matches(stem[off + k])) return false;
    return true;
}

static bool cond_prefix(const std::u32string &stem, const Affix &a)
{
    size_t n = a.cond.size();
    if (stem.size() < n) return false;
    for (size_t k = 0; k < n; k++)
        if (!a.cond[k].matches(stem[k])) return false;
    return true;
}

// pfx != nullptr: só regras com cross product; o radical precisa ter a flag do prefixo e bater a condição dele.
bool Dictionary::suffix_check(const std::u32string &w, bool for_suggest, const Affix *pfx) const
{
    size_t len = w.size();
    size_t maxk = std::min(max_sfx_add_, len ? len - 1 : 0);
    std::u32string stem;
    for (size_t k = 0; k <= maxk; k++) {
        auto it = sfx_by_add_.find(w.substr(len - k));
        if (it == sfx_by_add_.end()) continue;
        for (const StripGroup &g : it->second) {
            stem.assign(w, 0, len - k);
            stem += g.strip;
            auto de = dic_.find(stem);
            if (de == dic_.end() || !entry_ok(de->second, for_suggest)) continue;
            const Entry &e = de->second;
            if (e.forbidden) continue;
            if (pfx && (!has_flag(e, pfx->flag) || !cond_prefix(stem, *pfx))) continue;
            for (int ri : g.rules) {
                const Affix &a = affixes_[ri];
                if (pfx && !a.cross) continue;
                if (has_flag(e, a.flag) && cond_suffix(stem, a)) return true;
            }
        }
    }
    return false;
}

bool Dictionary::prefix_check(const std::u32string &w, bool for_suggest, bool cross) const
{
    size_t len = w.size();
    size_t maxk = std::min(max_pfx_add_, len ? len - 1 : 0);
    std::u32string stem;
    for (size_t k = 1; k <= maxk; k++) {
        auto it = pfx_by_add_.find(w.substr(0, k));
        if (it == pfx_by_add_.end()) continue;
        for (const StripGroup &g : it->second) {
            stem = g.strip;
            stem.append(w, k, std::u32string::npos);
            if (!cross) {
                auto de = dic_.find(stem);
                if (de == dic_.end() || !entry_ok(de->second, for_suggest) || de->second.forbidden) continue;
                for (int ri : g.rules) {
                    const Affix &a = affixes_[ri];
                    if (has_flag(de->second, a.flag) && cond_prefix(stem, a)) return true;
                }
            } else {
                for (int ri : g.rules) {
                    const Affix &a = affixes_[ri];
                    if (a.cross && cond_prefix(stem, a) && suffix_check(stem, for_suggest, &a)) return true;
                }
            }
        }
    }
    return false;
}

bool Dictionary::lookup(const std::u32string &w, bool for_suggest) const
{
    if (w.empty()) return false;
    auto it = dic_.find(w);
    if (it != dic_.end()) {
        // (a) — uma linha com FORBIDDENWORD torna a palavra proibida (não tenta afixos)
        return !it->second.forbidden && entry_ok(it->second, for_suggest);
    }
    if (suffix_check(w, for_suggest, nullptr)) return true;  // (b)
    if (prefix_check(w, for_suggest, false)) return true;    // (c)
    return prefix_check(w, for_suggest, true);               // (d)
}

bool Dictionary::check(const std::u32string &w, bool for_suggest) const
{
    return check_inner(w, for_suggest, 0);
}

bool Dictionary::check_inner(const std::u32string &w, bool for_suggest, int depth) const
{
    if (w.empty()) return true;
    if (!personal_.empty() && personal_.count(lower(w))) return true;
    if (lookup(w, for_suggest)) return true;

    bool any_upper = false, any_lower = false;
    for (char32_t c : w) {
        if (is_upper(c)) any_upper = true;
        else if (is_lower(c)) any_lower = true;
    }
    if (any_upper && !any_lower) {  // TODA MAIÚSCULA
        std::u32string lw = lower(w);
        if (lookup(lw, for_suggest) || lookup(capitalize(w), for_suggest)) return true;
    } else if (is_upper(w[0])) {    // Capitalizada (resto sem maiúsculas)
        bool rest_upper = false;
        for (size_t i = 1; i < w.size(); i++) if (is_upper(w[i])) { rest_upper = true; break; }
        if (!rest_upper && lookup(lower(w), for_suggest)) return true;
    }
    // Apóstrofo tipográfico: o dicionário usa o apóstrofo reto (d'água).
    if (depth == 0 && w.find(U'’') != std::u32string::npos) {
        std::u32string r(w);
        std::replace(r.begin(), r.end(), U'’', U'\'');
        if (check_inner(r, for_suggest, 1)) return true;
    }
    // Palavra com hífen: todas as partes precisam passar.
    if (depth < 2 && w.find(U'-') != std::u32string::npos) {
        size_t i = 0, parts = 0;
        while (i <= w.size()) {
            size_t j = w.find(U'-', i);
            if (j == std::u32string::npos) j = w.size();
            if (j > i) {
                parts++;
                std::u32string p = w.substr(i, j - i);
                if (!check_inner(p, for_suggest, 2)) return false;
            }
            i = j + 1;
        }
        return parts > 1;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Sugestões
// ---------------------------------------------------------------------------
std::vector<std::u32string> Dictionary::suggest(const std::u32string &word, size_t max) const
{
    // Mesma ordem de geração e pontuação do front-end (web/js/core/ortografia.js):
    // trabalha em minúsculas e recoloca a caixa da original no fim.
    const std::u32string low = lower(word);
    std::vector<std::u32string> cands;
    std::unordered_set<std::u32string> seen;
    seen.insert(low);

    auto suggestable = [&](const std::u32string &c) {
        if (!check(c, true)) return false;
        auto it = dic_.find(c);
        return !(it != dic_.end() && has_flag(it->second, nosuggest_));
    };
    auto add = [&](std::u32string c) {
        if (c.empty() || !seen.insert(c).second) return;
        bool ok;
        if (c.find(U' ') != std::u32string::npos) {  // REP com "_" gera duas palavras
            ok = true;
            size_t s = 0;
            while (s <= c.size() && ok) {
                size_t e = c.find(U' ', s);
                if (e == std::u32string::npos) e = c.size();
                if (e > s && (e - s < 2 || !suggestable(c.substr(s, e - s)))) ok = false;
                s = e + 1;
            }
        } else if (c.find(U'-') != std::u32string::npos) {
            ok = lookup(c);
        } else ok = suggestable(c);
        if (ok) cands.push_back(std::move(c));
    };

    // 1. REP
    for (const auto &r : rep_) {
        std::u32string from = r.first, to = r.second;
        bool start = !from.empty() && from[0] == U'^';
        if (start) from.erase(0, 1);
        bool end = !from.empty() && from.back() == U'$';
        if (end) from.pop_back();
        std::replace(from.begin(), from.end(), U'_', U' ');
        std::replace(to.begin(), to.end(), U'_', U' ');
        if (from.empty()) continue;
        size_t pos = low.find(from);
        while (pos != std::u32string::npos) {
            if ((!start || pos == 0) && (!end || pos + from.size() == low.size()))
                add(low.substr(0, pos) + to + low.substr(pos + from.size()));
            pos = low.find(from, pos + 1);
        }
    }

    // 2. MAP: 1 e 2 trocas (variantes minúsculas do mesmo grupo)
    auto group_of = [&](char32_t c) -> const std::u32string * {
        for (const auto &g : map_) if (g.find(c) != std::u32string::npos) return &g;
        return nullptr;
    };
    std::function<void(const std::u32string &, size_t, int)> variants = [&](const std::u32string &arr, size_t from, int depth) {
        for (size_t i = from; i < arr.size(); i++) {
            const std::u32string *g = group_of(arr[i]);
            if (!g) continue;
            for (char32_t alt : *g) {
                if (alt == arr[i] || alt != to_lower(alt)) continue;
                std::u32string copy = arr;
                copy[i] = alt;
                add(copy);
                if (depth > 1 && arr.size() <= 14) variants(copy, i + 1, depth - 1);
            }
        }
    };
    variants(low, 0, 2);

    // 3. Edição 1: em cada posição remove, troca com a vizinha, substitui e insere (letras do TRY)
    std::u32string letters;
    for (char32_t c : try_) if (c == to_lower(c)) letters.push_back(c);
    if (letters.empty()) letters = U"aeiosrnmtcdlup";
    for (size_t i = 0; i <= low.size(); i++) {
        if (i < low.size()) {
            add(low.substr(0, i) + low.substr(i + 1));
            if (i + 1 < low.size()) {
                std::u32string t = low;
                std::swap(t[i], t[i + 1]);
                add(t);
            }
            for (char32_t l : letters) {
                if (l == low[i]) continue;
                std::u32string t = low;
                t[i] = l;
                add(t);
            }
        }
        for (char32_t l : letters) {
            std::u32string t = low;
            t.insert(t.begin() + (std::ptrdiff_t)i, l);
            add(t);
        }
    }

    // 4. Ordena pela distância (empate: ordem de geração); compostos com espaço/hífen pagam +0,6.
    struct Scored { size_t idx; int dist; };
    std::vector<Scored> sc;
    for (size_t i = 0; i < cands.size(); i++) {
        const std::u32string &c = cands[i];
        bool comp = c.find_first_of(U" -") != std::u32string::npos;
        bool low_comp = low.find_first_of(U" -") != std::u32string::npos;
        sc.push_back(Scored{i, weighted_distance(low, c) + (comp && !low_comp ? 600 : 0)});
    }
    std::stable_sort(sc.begin(), sc.end(), [](const Scored &a, const Scored &b) { return a.dist < b.dist; });

    // Caixa: TODA MAIÚSCULA (2+ letras) → maiúsculas; primeira maiúscula → capitaliza só a 1ª.
    bool all_upper = word.size() > 1 && upper(word) == word && low != word;
    bool first_upper = !word.empty() && to_lower(word[0]) != word[0];
    std::vector<std::u32string> res;
    for (size_t i = 0; i < sc.size() && res.size() < max; i++) {
        std::u32string c = cands[sc[i].idx];
        if (all_upper) c = upper(c);
        else if (first_upper && !c.empty()) c[0] = to_upper(c[0]);
        res.push_back(std::move(c));
    }
    return res;
}

// ---------------------------------------------------------------------------
// Revisão de um texto
// ---------------------------------------------------------------------------
std::vector<Misspelling> Dictionary::review(const std::u32string &t, bool with_suggestions) const
{
    std::vector<Misspelling> out;
    size_t n = t.size();
    // Trechos (separados por espaço) que parecem URL ou e-mail ficam de fora.
    std::vector<char> skip(n, 0);
    for (size_t i = 0; i < n;) {
        if (is_space(t[i])) { i++; continue; }
        size_t j = i;
        while (j < n && !is_space(t[j])) j++;
        std::u32string chunk = t.substr(i, j - i);
        if (chunk.find(U"://") != std::u32string::npos || chunk.find(U"www.") != std::u32string::npos ||
            chunk.find(U'@') != std::u32string::npos)
            std::fill(skip.begin() + (std::ptrdiff_t)i, skip.begin() + (std::ptrdiff_t)j, 1);
        i = j;
    }

    size_t off16 = 0, line = 1, col = 1;  // posição do code point i
    size_t i = 0;
    auto advance = [&](size_t to) {
        while (i < to) {
            off16 += t[i] > 0xFFFF ? 2 : 1;
            if (t[i] == U'\n') { line++; col = 1; } else col++;
            i++;
        }
    };
    while (i < n) {
        if (!is_letter(t[i])) { advance(i + 1); continue; }
        size_t s = i, j = i;
        while (j < n) {
            if (is_letter(t[j])) j++;
            else if ((t[j] == U'-' || t[j] == U'\'' || t[j] == 0x2019) && j + 1 < n && is_letter(t[j + 1])) j++;
            else break;
        }
        size_t s16 = off16, sline = line, scol = col;
        std::u32string tok = t.substr(s, j - s);
        advance(j);
        size_t e16 = off16;

        if (skip[s]) continue;
        if ((s > 0 && is_digit(t[s - 1])) || (j < n && is_digit(t[j]))) continue;  // dígito colado
        if (tok.size() < 2) continue;
        size_t letters = 0;
        bool all_upper = true;
        for (char32_t c : tok) {
            if (!is_letter(c)) continue;
            letters++;
            if (!is_upper(c)) all_upper = false;
        }
        if (letters < 2) continue;
        if (all_upper && letters <= 4) continue;  // sigla
        if (check(tok)) continue;
        Misspelling m;
        m.word = tok;
        m.start16 = s16;
        m.end16 = e16;
        m.line = sline;
        m.column = scol;
        if (with_suggestions) m.suggestions = suggest(tok);
        out.push_back(std::move(m));
    }
    return out;
}

} // namespace serifa
