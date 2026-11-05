import { describe, expect, it } from "vitest";
import { allocatePageExcerpts } from "./pageExcerptAllocation";
import { handleExcerptRequest } from "./pageExcerptWorker";
import type { WorkerRequest } from "./pageExcerptWorkerProtocol";

/**
 * The same fixtures `pageExcerptAllocation.test.ts` runs against the
 * synchronous function, so the worker's answer is checked against the very
 * inputs whose synchronous output is pinned there.
 */
const fixtures: WorkerRequest[] = [
  { contents: ["short page", "another short page"], tokenBudget: 1000 },
  { contents: ["", "content", ""], tokenBudget: 1000 },
  {
    contents: ["a much longer page. ".repeat(200), "a short page."],
    tokenBudget: 120,
  },
  {
    contents: [
      "tiny.",
      "a much longer page. ".repeat(200),
      "a much longer page. ".repeat(200),
    ],
    tokenBudget: 120,
  },
  { contents: ["content", "more content"], tokenBudget: 0 },
];

describe("handleExcerptRequest", () => {
  it("answers with exactly the excerpts the synchronous allocation produces", () => {
    for (const request of fixtures) {
      expect(handleExcerptRequest(request)).toEqual({
        type: "excerpts",
        excerpts: allocatePageExcerpts(request.contents, request.tokenBudget),
      });
    }
  });

  it("reports an error instead of throwing when the tokenizer cannot run", () => {
    const broken = [undefined as unknown as string];

    const response = handleExcerptRequest({
      contents: broken,
      tokenBudget: 100,
    });

    expect(response.type).toBe("error");
  });
});
