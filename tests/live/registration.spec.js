// Live tenant registration (J-01, F-01, AC-F01-2; D-37).
//
// This journey contacts the real API and the real Supabase project with the
// current keys. It is not part of the credential-free pull-request suite: the
// spec skips itself unless E2E_LIVE_API_URL is set, so a normal `npm run
// e2e:web` stays offline and deterministic.
//
// Run it against the single environment:
//   1. `npm run build:web` with the current NEXT_PUBLIC_SUPABASE_* values
//   2. `PORT=3000 npm run dev:api` (or the built API) in another shell
//   3. `E2E_LIVE_API_URL=http://localhost:3000 npm run e2e:live`
//
// The account it creates is synthetic and disposable. The owner clears the
// development data before production, so no live check data reaches release.

import { expect, test } from "@playwright/test";

const apiUrl = process.env.E2E_LIVE_API_URL;
const password = process.env.E2E_LIVE_PASSWORD ?? "live-check-password-1";

test.describe("live registration (single environment)", () => {
  test.skip(
    !apiUrl,
    "Set E2E_LIVE_API_URL to run against the live API; the default suite stays offline",
  );

  test("a new workspace registers and lands in the admin view (J-01)", async ({
    page,
  }) => {
    const stamp = Date.now();
    const email = `live-check+${stamp}@velaris.test`;

    await page.goto("/");

    const header = page.locator("header");
    await header.getByRole("button", { name: /Start Free/ }).click();
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();

    await page.getByTestId("sign-up-workspace").fill(`Live Check ${stamp}`);
    await page.getByTestId("sign-in-email").fill(email);
    await page.getByTestId("sign-in-password").fill(password);
    await page.getByTestId("sign-in-submit").click();

    // The server creates the tenant and signs the new owner in. A failure
    // renders the API message in the dialog and stays on the landing page.
    await expect(page.getByTestId("sign-in-error")).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
    await expect(
      page.getByText(/WORKSPACE ADMINISTRATION|Tenant Control Center/),
    ).toBeVisible();
  });

  test("a protected route answers 401 without a credential", async ({
    request,
  }) => {
    const response = await request.get(
      `${apiUrl}/conversations?tenantId=00000000-0000-0000-0000-000000000000`,
    );
    expect(response.status()).toBe(401);
  });
});
