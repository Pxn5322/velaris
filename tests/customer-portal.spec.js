// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Journey J-03 / T2.04: customer portal sign-in and conversation timeline.
 *
 * Maps to AC-F05-1 (customer reads their conversation) and AC-F06-3
 * denial behavior. All Supabase Auth and API calls are intercepted with
 * page.route; the stored session is injected exactly as the auth
 * library writes it, so no real service is contacted.
 */

const SESSION_KEY = 'velaris.auth.session.v1';

const session = {
  accessToken: 'e2e-customer-token',
  refreshToken: 'e2e-refresh-token',
  expiresAt: 0,
  email: 'buyer@example.test',
};

const sessionResponse = {
  identity: { provider: 'supabase', subject: 'sub-customer', email: 'buyer@example.test' },
  tenantContext: {
    userId: 'user-customer',
    tenants: [
      { tenantId: 'tenant-a', slug: 'acme', name: 'Acme', membershipId: 'membership-customer' },
    ],
  },
};

const conversations = [
  {
    id: 'conv-1',
    customerId: 'customer-1',
    channel: 'email',
    status: 'OPEN',
    version: 2,
    createdAt: '2026-10-21T09:00:00Z',
  },
];

const timeline = {
  ...conversations[0],
  messages: [
    {
      id: 'msg-1',
      body: 'Hello, I need help with my order.',
      authorType: 'CUSTOMER',
      visibility: 'CUSTOMER_VISIBLE',
      createdAt: '2026-10-21T09:00:00Z',
    },
    {
      id: 'msg-2',
      body: 'We are on it, checking with logistics.',
      authorType: 'AGENT',
      visibility: 'CUSTOMER_VISIBLE',
      createdAt: '2026-10-21T09:05:00Z',
    },
  ],
};

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

async function seedSession(page) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(session)],
  );
}

test.describe('customer portal (J-03)', () => {
  test('signed out, the conversations view offers sign-in', async ({ page }) => {
    await page.goto('/portal/conversations');
    await expect(page.getByTestId('portal-signedout')).toBeVisible();
    await expect(page.getByTestId('portal-signin-link')).toHaveAttribute(
      'href',
      '/portal/sign-in',
    );
  });

  test('sign-in refuses bad credentials with a visible error', async ({ page }) => {
    await page.route('**/auth/v1/token*', (route) =>
      route.fulfill(json({ msg: 'Invalid login credentials' }, 400)),
    );

    await page.goto('/portal/sign-in');
    await expect(page.getByTestId('sign-in-form')).toBeVisible();
    await page.getByTestId('sign-in-email').fill('buyer@example.test');
    await page.getByTestId('sign-in-password').fill('wrong-password');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toBeVisible();
    await expect(page.getByTestId('sign-in-error')).toContainText('Invalid login');
    // No redirect on failure.
    await expect(page).toHaveURL(/\/portal\/sign-in/);
  });

  test('sign-in validates an empty form before any request', async ({ page }) => {
    await page.goto('/portal/sign-in');
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('sign-in-error')).toContainText('email and password');
  });

  test('sign-in succeeds and lands on the conversation timeline', async ({ page }) => {
    let tokenCalls = 0;
    await page.route('**/auth/v1/token*', (route) => {
      tokenCalls += 1;
      route.fulfill(
        json({
          access_token: 'e2e-customer-token',
          refresh_token: 'e2e-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { email: 'buyer@example.test' },
        }),
      );
    });
    await page.route('**/auth/session*', (route) => route.fulfill(json(sessionResponse)));
    await page.route('**/conversations?*', (route) => route.fulfill(json(conversations)));
    await page.route('**/conversations/conv-1*', (route) => route.fulfill(json(timeline)));

    await page.goto('/portal/sign-in');
    await page.getByTestId('sign-in-email').fill('buyer@example.test');
    await page.getByTestId('sign-in-password').fill('correct-password');
    await page.getByTestId('sign-in-submit').click();

    await expect(page).toHaveURL(/\/portal\/conversations/);
    expect(tokenCalls).toBe(1);
    await expect(page.getByTestId('portal-conversation')).toHaveCount(1);
    await page.getByTestId('portal-conversation').click();
    await expect(page.getByTestId('portal-timeline')).toBeVisible();
    await expect(page.getByTestId('portal-timeline')).toContainText(
      'We are on it, checking with logistics.',
    );
    // The API serialized the customer view: two visible messages, and the
    // customer page never renders an internal-note marker.
    await expect(page.getByTestId('portal-timeline').locator('li')).toHaveCount(2);
  });

  test('the conversations list shows the empty state', async ({ page }) => {
    await seedSession(page);
    await page.route('**/auth/session*', (route) => route.fulfill(json(sessionResponse)));
    await page.route('**/conversations?*', (route) => route.fulfill(json([])));

    await page.goto('/portal/conversations');
    await expect(page.getByTestId('portal-empty')).toBeVisible();
  });

  test('the conversations list shows the error state on API failure', async ({ page }) => {
    await seedSession(page);
    await page.route('**/auth/session*', (route) => route.fulfill(json(sessionResponse)));
    await page.route('**/conversations?*', (route) =>
      route.fulfill(json({ message: 'boom' }, 500)),
    );

    await page.goto('/portal/conversations');
    await expect(page.getByTestId('portal-error')).toBeVisible();
  });
});
