import { expect, type Page, test } from "@playwright/test";

const QUERY = "miniSearch e2e probe";

// A search settles into one of three states. Same idea as the smoke test's
// settle locator, kept local so specs don't import from each other.
function settledSearch(page: Page) {
  return page
    .getByTestId("search-result-link")
    .first()
    .or(page.getByText("No results found"))
    .or(page.getByRole("alert", { name: "Text search unavailable" }));
}

async function openHistoryDrawer(page: Page) {
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
  // Scope to the drawer so the query text is matched against the entry card,
  // not the search textarea (whose value is the same query).
  return page.getByRole("dialog");
}

test("a search is recorded and listed in the history drawer", async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent(QUERY)}`);
  await expect(settledSearch(page)).toBeVisible({ timeout: 60_000 });

  const drawer = await openHistoryDrawer(page);
  await expect(drawer.getByText(QUERY, { exact: true })).toBeVisible();
});

test("the history filter narrows the list and clearing it restores it", async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent(QUERY)}`);
  await expect(settledSearch(page)).toBeVisible({ timeout: 60_000 });

  const drawer = await openHistoryDrawer(page);
  const entry = drawer.getByText(QUERY, { exact: true });
  await expect(entry).toBeVisible();

  const filter = page.getByPlaceholder("Filter history...");
  await filter.fill("zzz-no-match-zzz");
  await expect(entry).toBeHidden();
  await expect(drawer.getByText("No matching searches found")).toBeVisible();

  await filter.fill("");
  await expect(entry).toBeVisible();
});

test("restoring a history entry closes the drawer and keeps the query", async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent(QUERY)}`);
  await expect(settledSearch(page)).toBeVisible({ timeout: 60_000 });

  const drawer = await openHistoryDrawer(page);
  await drawer.getByText(QUERY, { exact: true }).click();

  // Selecting an entry fires onSearchSelect, which closes the drawer.
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("textbox")).toHaveValue(QUERY);
});
