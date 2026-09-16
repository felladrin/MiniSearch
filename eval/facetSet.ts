/**
 * Facet set for the clarifying-question distinctness eval: a fixed collection
 * of ambiguous queries, each with the short candidate answers a clarification
 * pane would offer (Zamani et al., WWW 2020).
 *
 * Each facet is meant to be CONCATENATED onto the query and re-submitted
 * (`query + " " + facet`), so every facet must be a term a user would actually
 * type as a refinement. A facet that repeats a token from the query, or a
 * phrase nobody types, makes the engine treat the refined query as the same
 * query, and the distinctness reading for that pair becomes a false negative.
 *
 * The queries are classic homonyms and bare nouns whose ambiguity is not yet
 * collapsed upstream: a bare "apple" would be wrong here because the engines
 * return the company for nearly every click, so the facets could not steer
 * the top results.
 *
 * This is deliberately hand-curated and stable, like the golden set. To grow
 * the set, add an entry with the same shape: one ambiguous query, 2-4 facets.
 */

export interface FacetQuery {
  /** Stable id used in reports. */
  id: string;
  /** The ambiguous query, as a user would type it. */
  query: string;
  /**
   * Short additive terms, each meant to be concatenated onto `query` to form
   * the refined query that reveals which sense the user wanted.
   */
  facets: string[];
}

export const facetQueries: FacetQuery[] = [
  {
    id: "jaguar",
    query: "jaguar",
    facets: ["car", "animal", "os"],
  },
  {
    id: "crane",
    query: "crane",
    facets: ["bird", "machine"],
  },
  {
    id: "mercury",
    query: "mercury",
    facets: ["planet", "element", "band"],
  },
  {
    id: "java",
    query: "java",
    facets: ["island", "coffee", "programming language"],
  },
  {
    id: "cricket",
    query: "cricket",
    facets: ["insect", "sport"],
  },
  {
    id: "rush",
    query: "rush",
    facets: ["drug", "band"],
  },
  {
    id: "bass",
    query: "bass",
    facets: ["fish", "guitar"],
  },
  {
    id: "spring",
    query: "spring",
    facets: ["season", "water"],
  },
  {
    id: "key",
    query: "key",
    facets: ["lock", "music"],
  },
  {
    id: "python",
    query: "python",
    facets: ["snake", "programming language"],
  },
  {
    id: "mango",
    query: "mango",
    facets: ["fruit", "tree"],
  },
  {
    id: "fox",
    query: "fox",
    facets: ["animal", "browser"],
  },
];
