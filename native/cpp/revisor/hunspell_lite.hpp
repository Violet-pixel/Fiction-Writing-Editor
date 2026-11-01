// hunspell_lite.hpp — verificação ortográfica "hunspell-lite" do Serifa (seção 3 da especificação).
// Copyright (©) 2026 Clara Portes
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace serifa {

// ---------------------------------------------------------------------------
// UTF-8 / UTF-32 e caixa (maiúsculas/minúsculas) simples
// ---------------------------------------------------------------------------
std::u32string utf8_to_u32(const std::string &s);
std::string u32_to_utf8(const std::u32string &s);
char32_t to_lower(char32_t c);
char32_t to_upper(char32_t c);
std::u32string lower(const std::u32string &s);
std::u32string upper(const std::u32string &s);
std::u32string capitalize(const std::u32string &s); // primeira letra maiúscula, resto minúsculo
inline bool is_upper(char32_t c) { return to_lower(c) != c; }
inline bool is_lower(char32_t c) { return to_upper(c) != c; }
bool is_word_char(char32_t c);
bool is_space(char32_t c);
inline bool is_digit(char32_t c) { return c >= U'0' && c <= U'9'; }
inline bool is_letter(char32_t c) { return is_word_char(c) && !is_digit(c); }

// ---------------------------------------------------------------------------
// Dicionário + afixos
// ---------------------------------------------------------------------------
struct CondElem {
    bool any = false;      // "."
    bool negated = false;  // "[^...]"
    std::u32string set;    // literal (1 code point) ou conteúdo da classe
    bool matches(char32_t c) const;
};

struct Affix {
    char32_t flag = 0;
    bool cross = false;
    bool prefix = false;
    std::u32string strip, add;
    std::vector<CondElem> cond;
};

struct StripGroup {
    std::u32string strip;
    std::vector<int> rules;  // índices em affixes
};

struct Entry {
    std::u32string flags;   // união das flags de todas as linhas da palavra
    bool allowed = false;   // existe ao menos uma linha sem FORBIDDENWORD
    bool forbidden = false; // existe ao menos uma linha com FORBIDDENWORD
};

struct Misspelling {
    std::u32string word;
    size_t start16 = 0, end16 = 0;  // offsets em unidades UTF-16 (compatível com JS)
    size_t line = 0, column = 0;    // 1-based; coluna em code points
    std::vector<std::u32string> suggestions;
};

class Dictionary {
public:
    // Carrega .aff e .dic (UTF-8). Em caso de erro devolve false e preenche `error`.
    bool load(const std::string &aff_path, const std::string &dic_path, std::string &error);
    void add_personal(const std::u32string &word);

    bool lookup(const std::u32string &w, bool for_suggest = false) const;
    bool check(const std::u32string &w, bool for_suggest = false) const;
    std::vector<std::u32string> suggest(const std::u32string &word, size_t max = 6) const;

    // Revisa um texto inteiro (tokenização da seção 3).
    std::vector<Misspelling> review(const std::u32string &text, bool with_suggestions = true) const;

    size_t word_count() const { return dic_.size(); }
    size_t affix_count() const { return affixes_.size(); }

private:
    bool check_inner(const std::u32string &w, bool for_suggest, int depth) const;
    bool entry_ok(const Entry &e, bool for_suggest) const;
    bool suffix_check(const std::u32string &w, bool for_suggest, const Affix *pfx) const;
    bool prefix_check(const std::u32string &w, bool for_suggest, bool cross) const;
    bool parse_aff(const std::string &text, std::string &error);
    bool parse_dic(const std::string &text, std::string &error);

    std::unordered_map<std::u32string, Entry> dic_;
    std::unordered_set<std::u32string> personal_;
    std::vector<Affix> affixes_;
    std::unordered_map<std::u32string, std::vector<StripGroup>> sfx_by_add_, pfx_by_add_;
    size_t max_sfx_add_ = 0, max_pfx_add_ = 0;
    std::vector<std::pair<std::u32string, std::u32string>> rep_;
    std::vector<std::u32string> map_;
    std::u32string try_;
    char32_t forbidden_ = 0, nosuggest_ = 0;
};

// Distância Damerau-Levenshtein ponderada × 1000 (mesma do fuzzy.wasm).
int weighted_distance(const std::u32string &a, const std::u32string &b);

} // namespace serifa
