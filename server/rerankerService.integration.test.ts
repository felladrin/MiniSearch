// @vitest-environment node

/**
 * Exercises the real reranker model end to end, including the multilingual
 * behaviour that motivated picking jina-reranker-v1-tiny-en. Downloads ~130MB
 * on first run, so it is excluded from the default suite:
 *
 *   npx vitest run --config vitest.integration.config.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getRerankerStatus,
  rerank,
  startRerankerService,
  stopRerankerService,
} from "./rerankerService";

type SearchResult = [title: string, content: string, url: string];

type Fixture = {
  name: string;
  query: string;
  results: SearchResult[];
  /** Indices of `results` a human would consider relevant to `query`. */
  relevant: number[];
};

const fixtures: Fixture[] = [
  {
    name: "english / factual",
    query: "how to reverse a string in javascript",
    results: [
      [
        "Reverse a String in JavaScript",
        "Use split(''), reverse() and join('') to reverse a string in JavaScript.",
        "https://a.dev/reverse",
      ],
      [
        "Best Hotels in Reverse, Texas",
        "Compare 240 hotels in Reverse with free cancellation and instant booking.",
        "https://hotels.com/reverse-tx",
      ],
      [
        "How do I reverse a string in JS? - Stack Overflow",
        "I want to take a string and reverse its characters. What is the idiomatic way?",
        "https://so.com/q/958908",
      ],
      [
        "String Manipulation in Python",
        "Learn slicing, concatenation and formatting of Python strings from scratch.",
        "https://py.io/strings",
      ],
      [
        "Reverse Mortgage Calculator 2026",
        "Estimate how much equity you can access with a reverse mortgage this year.",
        "https://finance.com/reverse-mortgage",
      ],
      [
        "Reversing Unicode strings correctly",
        "Naive reversal breaks emoji and combining characters. Use Intl.Segmenter instead.",
        "https://a.dev/unicode-reverse",
      ],
    ],
    relevant: [0, 2, 5],
  },
  {
    name: "portuguese / recipe",
    query: "como fazer pão de queijo caseiro",
    results: [
      [
        "Receita de Pão de Queijo Caseiro Fácil",
        "Aprenda a fazer pão de queijo mineiro com polvilho doce, queijo meia cura e leite.",
        "https://receitas.com/pao-de-queijo",
      ],
      [
        "Onde comprar polvilho azedo online",
        "Compare preços de polvilho azedo e doce em 12 lojas com entrega para todo o Brasil.",
        "https://mercado.br/polvilho",
      ],
      [
        "Pão de Queijo: a receita original de Minas Gerais",
        "O segredo do pão de queijo caseiro está no polvilho azedo e no ponto da massa escaldada.",
        "https://cozinha.br/pao-queijo-mg",
      ],
      [
        "Bolo de cenoura com cobertura de chocolate",
        "Receita de bolo de cenoura fofinho com cobertura cremosa de chocolate meio amargo.",
        "https://receitas.com/bolo-cenoura",
      ],
      [
        "Queijo Minas Artesanal: história e produção",
        "Conheça o processo de maturação do queijo minas e as regiões produtoras do estado.",
        "https://queijos.br/minas-artesanal",
      ],
    ],
    relevant: [0, 2],
  },
  {
    name: "portuguese / technical",
    query: "configurar nginx como proxy reverso",
    results: [
      [
        "Como configurar o Nginx como proxy reverso",
        "Tutorial passo a passo para configurar proxy_pass, headers e upstream no Nginx.",
        "https://tutoriais.br/nginx-proxy-reverso",
      ],
      [
        "Certificados SSL grátis com Let's Encrypt",
        "Emita e renove certificados SSL automaticamente usando o Certbot.",
        "https://tutoriais.br/lets-encrypt",
      ],
      [
        "Nginx Reverse Proxy Guide",
        "Configure Nginx as a reverse proxy with proxy_pass, load balancing and SSL termination.",
        "https://docs.nginx.com/reverse-proxy",
      ],
      [
        "Instalando o Nginx no Ubuntu 24.04",
        "Guia de instalação do Nginx via apt e configuração inicial do firewall.",
        "https://tutoriais.br/instalar-nginx",
      ],
      [
        "Nginx: erro 502 Bad Gateway ao usar proxy_pass",
        "Como diagnosticar e resolver o erro 502 na configuração de proxy reverso do Nginx.",
        "https://forum.br/nginx-502",
      ],
    ],
    relevant: [0, 2, 4],
  },
  {
    name: "english / ambiguous term",
    query: "jaguar animal habitat and diet",
    results: [
      [
        "Jaguar F-PACE 2026 Review",
        "The F-PACE gets a refreshed interior and a new mild-hybrid powertrain for 2026.",
        "https://cars.com/jaguar-f-pace",
      ],
      [
        "Jaguar | Species Profile - WWF",
        "The jaguar is the largest cat in the Americas, living in rainforest and wetland habitats.",
        "https://wwf.org/jaguar",
      ],
      [
        "Jacksonville Jaguars 2026 Schedule",
        "Full regular season schedule, opponents and kickoff times for the Jaguars.",
        "https://nfl.com/jaguars-schedule",
      ],
      [
        "What do jaguars eat?",
        "Jaguars are apex predators feeding on capybara, caiman, peccary, deer and fish.",
        "https://animals.net/jaguar-diet",
      ],
      [
        "Jaguar XJ220: the 1990s supercar",
        "How Jaguar built a 217mph V6 supercar and then struggled to sell it.",
        "https://classics.com/xj220",
      ],
    ],
    relevant: [1, 3],
  },
];

const MAX_DOCUMENT_LENGTH = 512;

/** Mirrors the document formatting in rankSearchResults.ts. */
function buildDocuments(results: SearchResult[]) {
  return results.map(([title, snippet, url]) => {
    const doc =
      `[${title}](${url} "${snippet.replaceAll('"', "'")}")`.toLocaleLowerCase();
    return doc.length > MAX_DOCUMENT_LENGTH
      ? doc.slice(0, MAX_DOCUMENT_LENGTH)
      : doc;
  });
}

describe("reranker service", () => {
  beforeAll(async () => {
    await startRerankerService();
  }, 600_000);

  afterAll(async () => {
    await stopRerankerService();
  });

  it("reports ready after startup", async () => {
    expect(await getRerankerStatus()).toBe(true);
  });

  it("returns an empty array without calling the model", async () => {
    expect(await rerank("anything", [])).toEqual([]);
  });

  for (const fixture of fixtures) {
    it(`ranks relevant results first: ${fixture.name}`, async () => {
      const documents = buildDocuments(fixture.results);
      const scored = await rerank(fixture.query.toLocaleLowerCase(), documents);

      expect(scored).toHaveLength(fixture.results.length);
      expect(
        scored.every(({ relevance_score }) => Number.isFinite(relevance_score)),
      ).toBe(true);

      const ordered = scored
        .slice()
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .map(({ index }) => index);

      // Every relevant result must outrank every irrelevant one. The model
      // clears this with a score gap of at least 0.99 between the two groups,
      // so it is not sensitive to the ~1e-6 difference between the CPU and
      // WebGPU execution providers.
      const topIndices = ordered
        .slice(0, fixture.relevant.length)
        .sort((a, b) => a - b);
      expect(topIndices).toEqual([...fixture.relevant].sort((a, b) => a - b));
    }, 120_000);
  }
});
