import { describe, expect, it } from "vitest";
import { rankByKeywords, type CatalogueEntry } from "@/lib/finder/keywords";

const catalogue: CatalogueEntry[] = [
  { id: "counselling", name: "Counselling", keywords: ["stress", "anxiety", "low mood", "exam stress", "lonely"] },
  { id: "clinic", name: "Health clinic", keywords: ["vaccine", "flu shot", "fever", "medical certificate"] },
  { id: "physio", name: "Physiotherapy", keywords: ["back pain", "knee", "sports injury"] },
  { id: "advising", name: "Wellbeing advising", keywords: ["sleep", "money", "time management"] },
];

// The weeks 8–10 evaluation set starts here: phrase -> expected first suggestion (FR-23, BR-24).
const PHRASES: [string, string][] = [
  ["I need a flu shot before travelling", "clinic"],
  ["I can't stop worrying about exams, so much stress", "counselling"],
  ["my back pain is getting worse from sitting", "physio"],
  ["trouble sleeping lately", "advising"],
  ["I need a medical certificate for class", "clinic"],
  ["feeling lonely since I moved here", "counselling"],
];

describe("deterministic fallback matcher (FR-23)", () => {
  it.each(PHRASES)("%s -> %s", (phrase, expected) => {
    expect(rankByKeywords(phrase, catalogue)[0]).toBe(expected);
  });

  it("is deterministic", () => {
    const a = rankByKeywords("stress and sleep and money", catalogue);
    const b = rankByKeywords("stress and sleep and money", catalogue);
    expect(a).toEqual(b);
  });

  it("only ever returns ids from the catalogue, at most three", () => {
    const ids = rankByKeywords("stress sleep money flu shot back pain knee vaccine", catalogue);
    expect(ids.length).toBeLessThanOrEqual(3);
    for (const id of ids) expect(catalogue.map((c) => c.id)).toContain(id);
  });

  it("returns nothing rather than guessing when there is no match", () => {
    expect(rankByKeywords("zxqv plorb", catalogue)).toEqual([]);
    expect(rankByKeywords("", catalogue)).toEqual([]);
  });
});
