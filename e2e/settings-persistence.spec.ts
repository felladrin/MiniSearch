import { expect, type Page, test } from "@playwright/test";

async function openSearchSettings(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const control = page.getByRole("button", { name: /Search Settings/ });
  // The accordion's expanded state persists across reloads, so only click when
  // it is collapsed; clicking an already-open panel would close it.
  if ((await control.getAttribute("aria-expanded")) !== "true") {
    await control.click();
  }
}

test("a toggled Image Search setting survives a reload", async ({ page }) => {
  await page.goto("/");
  await openSearchSettings(page);

  const imageSwitch = page.getByRole("switch", { name: "Image Search" });
  // Mantine's Switch is an <input type="checkbox" role="switch">; its state is
  // the native `checked` property, not an aria-checked attribute.

  // Land on OFF, the opposite of the shipped default (true). Toggling from
  // whatever the context held can leave the final value equal to the default,
  // and then a persistence write that does nothing still passes, because the
  // reload falls back to the same value the test asserts.
  if (!(await imageSwitch.isChecked())) {
    await imageSwitch.click();
  }
  await expect(imageSwitch).toBeChecked();

  await imageSwitch.click();
  await expect(imageSwitch).not.toBeChecked();

  await page.reload();
  await openSearchSettings(page);

  await expect(
    page.getByRole("switch", { name: "Image Search" }),
  ).not.toBeChecked();

  const stored = JSON.parse(
    await page.evaluate(() => localStorage.getItem("settings") ?? "null"),
  );
  expect(stored.enableImageSearch).toBe(false);
});

test("a toggled Text Search setting persists independently", async ({
  page,
}) => {
  await page.goto("/");
  await openSearchSettings(page);

  const textSwitch = page.getByRole("switch", { name: "Text Search" });

  // Normalize to off so the persisted value is known regardless of the default.
  if (await textSwitch.isChecked()) {
    await textSwitch.click();
  }
  await expect(textSwitch).not.toBeChecked();

  await page.reload();
  await openSearchSettings(page);

  await expect(
    page.getByRole("switch", { name: "Text Search" }),
  ).not.toBeChecked();

  const stored = JSON.parse(
    await page.evaluate(() => localStorage.getItem("settings") ?? "null"),
  );
  expect(stored.enableTextSearch).toBe(false);
});
