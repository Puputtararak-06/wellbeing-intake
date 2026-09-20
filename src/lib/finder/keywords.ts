// FR-23 / BR-24 deterministic fallback: a keyword matcher over the seeded service
// vocabulary. Pure and dependency-free — this is what the demo must never lack.

export type CatalogueEntry = {
  id: string;
  name: string;
  keywords: string[];
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from", "get", "have",
  "how", "i", "im", "in", "is", "it", "me", "my", "need", "not", "of", "on", "or", "so", "some",
  "that", "the", "to", "want", "was", "with", "would", "you",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Very light stemming so "sleeping" matches "sleep" and "vaccines" matches "vaccine". */
function stem(token: string): string {
  return token.replace(/(ing|ed|es|s)$/u, "");
}

export function rankByKeywords(text: string, catalogue: CatalogueEntry[], limit = 3): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const stems = new Set(tokens.map(stem));
  const joined = " " + tokens.join(" ") + " ";

  const scored = catalogue.map((entry) => {
    let score = 0;
    for (const raw of [...entry.keywords, ...tokenize(entry.name)]) {
      const kw = raw.toLowerCase().trim();
      if (!kw) continue;
      if (kw.includes(" ")) {
        if (joined.includes(" " + kw + " ")) score += 3; // phrase match counts most
      } else if (tokens.includes(kw)) {
        score += 2;
      } else if (stems.has(stem(kw))) {
        score += 1;
      }
    }
    return { id: entry.id, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) // stable, deterministic
    .slice(0, limit)
    .map((s) => s.id);
}
