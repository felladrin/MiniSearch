import { expect, type Page, test } from "@playwright/test";

// A search settles into one of three states. "Text search unavailable" is a
// routine outcome on CI runners, whose shared IPs the upstream engines
// CAPTCHA or suspend, so the smoke test accepts it as settled.
function settledSearch(page: Page) {
  return page
    .getByTestId("search-result-link")
    .first()
    .or(page.getByText("No results found"))
    .or(page.getByRole("alert", { name: "Text search unavailable" }));
}

test("homepage loads, search runs, and results render", async ({ page }) => {
  // URL ?q= auto-starts search in SearchForm — same path users hit via default-engine.
  await page.goto("/?q=playwright");

  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("button", { name: /search/i })).toBeVisible();

  await expect(settledSearch(page)).toBeVisible({ timeout: 60_000 });

  // If results are present, verify they have valid URLs.
  const resultLink = page.getByTestId("search-result-link").first();
  if ((await resultLink.count()) > 0) {
    await expect(resultLink).toHaveAttribute("href", /https?:\/\//);
  }
});

test("a failing text search degrades to the retryable alert", async ({
  page,
}) => {
  await page.route("**/search/text*", (route) =>
    route.fulfill({ status: 503, body: "unavailable" }),
  );

  await page.goto("/?q=playwright");

  await expect(settledSearch(page)).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("alert", { name: "Text search unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry Search" }),
  ).toBeVisible();
});
