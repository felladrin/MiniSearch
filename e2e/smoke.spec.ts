import { expect, test } from "@playwright/test";

test("homepage loads, search runs, and results render", async ({ page }) => {
  // URL ?q= auto-starts search in SearchForm — same path users hit via default-engine.
  await page.goto("/?q=playwright");

  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("button", { name: /search/i })).toBeVisible();

  // Wait for search results to reach a terminal state (results or "no results" message).
  // This avoids CI flakiness when upstream search engines are rate-limited.
  const resultLink = page.getByTestId("search-result-link").first();
  const noResults = page.getByText("No results found");
  await expect(resultLink.or(noResults)).toBeVisible({ timeout: 60_000 });

  // If results are present, verify they have valid URLs.
  if ((await resultLink.count()) > 0) {
    await expect(resultLink).toHaveAttribute("href", /https?:\/\//);
  }
});
