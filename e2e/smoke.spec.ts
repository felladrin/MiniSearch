import { expect, test } from "@playwright/test";

test("homepage loads, search runs, and results render", async ({ page }) => {
  // URL ?q= auto-starts search in SearchForm — same path users hit via default-engine.
  await page.goto("/?q=playwright");

  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(page.getByRole("button", { name: /search/i })).toBeVisible();

  // Wait for at least one text result link (title anchors open in a new tab).
  const resultLink = page.locator('a[target="_blank"]').first();
  await expect(resultLink).toBeVisible({ timeout: 60_000 });
  await expect(resultLink).toHaveAttribute("href", /https?:\/\//);
});
