/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.ideas;

import java.util.LinkedHashMap;
import java.util.Map;
import serifa.json.JsonWritable;

/** Uma ideia (sugestão de estilo ou gramática) com offsets UTF-16 no texto puro. */
public record Idea(String rule, String category, int start, int end, String message, String suggestion)
        implements JsonWritable {

    @Override
    public Object toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("rule", rule);
        m.put("category", category);
        m.put("start", start);
        m.put("end", end);
        m.put("message", message);
        m.put("suggestion", suggestion == null ? "" : suggestion);
        return m;
    }
}
