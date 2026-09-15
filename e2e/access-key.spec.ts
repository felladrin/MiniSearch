import { expect, type Page, test } from "@playwright/test";

const CONFIG = {
  accessKeysEnabled: true,
  accessKeyTimeoutHours: 24,
  defaultInferenceType: "browser",
};

function stubAccessKeyConfig(page: Page) {
  return page.route("**/api/config", (route) =>
    route.fulfill({ json: CONFIG }),
  );
}

test("a wrong key shows an error and does not grant access", async ({
  page,
}) => {
  await stubAccessKeyConfig(page);
  await page.route("**/api/validate-access-key", (route) =>
    route.fulfill({ json: { valid: false } }),
  );

  await page.goto("/");
  await page
    .getByPlaceholder("Enter your access key to continue")
    .fill("wrong-key");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("Invalid access key")).toBeVisible();
  // Still on the access page; the access-key input remains and the app never
  // advanced past it. (The access-key field is itself a textbox, so we assert
  // on the access page persisting rather than on a textbox count.)
  await expect(
    page.getByPlaceholder("Enter your access key to continue"),
  ).toBeVisible();
});

test("a correct key grants access", async ({ page }) => {
  await stubAccessKeyConfig(page);
  await page.route("**/api/validate-access-key", (route) =>
    route.fulfill({ json: { valid: true } }),
  );

  await page.goto("/");
  await page
    .getByPlaceholder("Enter your access key to continue")
    .fill("right-key");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByText("Access Restricted")).toBeHidden();
  // Assert the app shell, not any textbox. The Menu button only exists past the
  // gate, so a half-rendered page that still shows an input cannot pass this.
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toBeVisible();
});
