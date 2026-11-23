#!/usr/bin/env node
/**
 * Live synthetic password-reset check (T6.08, D-58, D-71).
 *
 * This check uses real infrastructure: one disposable Mail.tm inbox, one
 * synthetic tenant created through POST /auth/signup, the project's real
 * Supabase Auth recovery email, and the local production web build driving
 * /auth/callback and the password reset gate. It then cleans up the account,
 * the tenant rows and the inbox.
 *
 * What it proves, step by step:
 *   1. the sign-in form requests a recovery email for a real address
 *   2. a real email arrives at a real mailbox
 *   3. the emailed link lands on /auth/callback with type=recovery
 *   4. the callback accepts a new password and stores the link session
 *   5. the link alone does not clear `users.password_reset_required`, so the
 *      workspace opens the gate (the API read decides, not the link)
 *   6. the gate clears the flag through POST /auth/password and ends the session
 *   7. the account signs in with the new password and the gate stays closed
 *
 * Usage (web must be built and both servers running):
 *   node --env-file=.env.livecheck scripts/live-password-reset.mjs
 *   node --env-file=.env.livecheck scripts/live-password-reset.mjs --generated-link
 *
 * `--generated-link` asks the provider's admin API for the same recovery link
 * the email carries, instead of waiting for a message. Use it when the built-in
 * mailer's two-emails-per-hour limit blocks another send: the callback, gate and
 * sign-in steps are unchanged, and only the delivery claim is skipped.
 *
 * Environment: SUPABASE_URL, SB_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY),
 * SB_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY), DATABASE_URL.
 * Optional: LIVECHECK_WEB_ORIGIN (default http://localhost:3001),
 * LIVECHECK_API_ORIGIN (default http://localhost:3000),
 * LIVECHECK_EMAIL_TIMEOUT_MS (default 180000).
 *
 * No password, token, link or recovery token is printed or written to disk.
 * The synthetic account and inbox are removed in a finally block.
 */

import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const WEB_ORIGIN = (process.env.LIVECHECK_WEB_ORIGIN ?? 'http://localhost:3001').replace(/\/$/, '');
const API_ORIGIN = (process.env.LIVECHECK_API_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL_TIMEOUT_MS = Number(process.env.LIVECHECK_EMAIL_TIMEOUT_MS ?? 180_000);
const USE_ADMIN_LINK = process.argv.includes('--generated-link');
const MAILTM = 'https://api.mail.tm';

const SUPABASE_URL = requireEnvironment('SUPABASE_URL').replace(/\/$/, '');
const ANON_KEY =
  process.env.SB_ANON_KEY ?? requireEnvironment('SUPABASE_PUBLISHABLE_KEY');
const SERVICE_KEY =
  process.env.SB_SERVICE_ROLE_KEY ?? requireEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = requireEnvironment('DATABASE_URL');

let stepNumber = 0;

/** Run one step: log PASS with its detail, or log FAIL and stop the check. */
async function check(name, fn) {
  stepNumber += 1;
  try {
    const detail = await fn();
    console.log(`PASS  step ${stepNumber}: ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    console.log(`FAIL  step ${stepNumber}: ${name}`);
    throw error;
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** A throwaway password with mixed classes, never logged. */
function newPassword() {
  return `Lc-${randomBytes(18).toString('base64url')}`;
}

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

async function jsonRequest(url, init, label) {
  const response = await fetch(url, init);
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`${label} answered HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/* ---------------------------------------------------------------- mailbox */

async function openMailbox() {
  const domains = await jsonRequest(`${MAILTM}/domains?page=1`, {}, 'Mail.tm domains');
  const domain = (domains['hydra:member'] ?? []).find((entry) => entry.isActive)?.domain;
  if (!domain) throw new Error('Mail.tm returned no active domain');
  const address = `livecheck-reset-${Date.now()}@${domain}`;
  const password = randomBytes(24).toString('base64url');
  const account = await jsonRequest(
    `${MAILTM}/accounts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    },
    'Mail.tm account create',
  );
  const token = await jsonRequest(
    `${MAILTM}/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    },
    'Mail.tm token',
  );
  console.log(`mailbox opened (${address})`);
  return { address, token: token.token, id: account.id };
}

async function closeMailbox(mailbox) {
  if (!mailbox?.id) return;
  // Mail.tm rate-limits account deletion; retry a few times before giving up.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`${MAILTM}/accounts/${mailbox.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${mailbox.token}` },
    });
    console.log(`mailbox delete attempt ${attempt}: HTTP ${response.status}`);
    if (response.ok || response.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
  }
}

/** Mail.tm returns a body as an array of parts, or a single string. */
function textOf(part) {
  if (typeof part === 'string') return part;
  return Array.isArray(part) ? part.join('\n') : '';
}

/** Ask the provider for the recovery link the email would carry. */
async function generatedRecoveryLink(email) {
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/admin/generate_link`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        type: 'recovery',
        email,
        redirect_to: `${WEB_ORIGIN}/auth/callback`,
      }),
    },
    'POST /auth/v1/admin/generate_link',
  );
  const link = body?.action_link ?? body?.properties?.action_link;
  if (!link) throw new Error('the provider returned no recovery link');
  return link;
}

/** Wait for the recovery message and return its verification link. */
async function recoverLinkFromInbox(mailbox) {
  const deadline = Date.now() + EMAIL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const list = await jsonRequest(
      `${MAILTM}/messages?page=1`,
      { headers: { Authorization: `Bearer ${mailbox.token}` } },
      'Mail.tm message list',
    );
    for (const summary of list['hydra:member'] ?? []) {
      const message = await jsonRequest(
        `${MAILTM}/messages/${summary.id}`,
        { headers: { Authorization: `Bearer ${mailbox.token}` } },
        'Mail.tm message read',
      );
      const body = `${textOf(message.text)}\n${textOf(message.html)}`
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
      // The plaintext part wraps the URL in brackets, so the character class
      // excludes closing punctuation as well as whitespace and HTML quotes.
      const match = body.match(/https:\/\/[^\s"'<>\[\]()]+\/auth\/v1\/verify[^\s"'<>\[\]()]*/);
      if (match) return { link: match[0], subject: message.subject ?? '' };
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return null;
}

/* ----------------------------------------------------------------- account */

async function createSyntheticAccount(prisma, email) {
  const password = newPassword();
  const result = await jsonRequest(
    `${API_ORIGIN}/auth/signup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        tenantName: `Live check ${Date.now()}`,
      }),
    },
    'POST /auth/signup',
  );
  // The route answers {tenantId, slug, email}; the owner row carries the ids
  // the check needs for the flag and for cleanup.
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId: result.tenantId },
    include: { user: true },
  });
  if (!membership) throw new Error('signup created no owner membership');
  return {
    password,
    tenantId: result.tenantId,
    slug: result.slug,
    userId: membership.user.id,
    authSubject: membership.user.externalSubject,
  };
}

async function removeSyntheticAccount(prisma, account) {
  if (!account) return;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.deleteMany({ where: { tenantId: account.tenantId } });
      await tx.retentionPolicy.deleteMany({ where: { tenantId: account.tenantId } });
      await tx.membershipRole.deleteMany({
        where: { membership: { tenantId: account.tenantId } },
      });
      await tx.tenantMembership.deleteMany({ where: { tenantId: account.tenantId } });
      await tx.role.deleteMany({ where: { tenantId: account.tenantId } });
      const tenant = await tx.tenant.findUnique({
        where: { id: account.tenantId },
        select: { enterpriseOrganizationId: true },
      });
      await tx.tenant.delete({ where: { id: account.tenantId } });
      if (tenant) {
        await tx.enterpriseOrganization.delete({
          where: { id: tenant.enterpriseOrganizationId },
        });
      }
      await tx.user.deleteMany({ where: { id: account.userId } });
    });
    console.log('database rows removed');
  } catch (error) {
    console.error(
      `database cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(account.authSubject)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  console.log(`auth account removed: HTTP ${response.status}`);

  const [users, tenants] = await Promise.all([
    prisma.user.count({ where: { id: account.userId } }),
    prisma.tenant.count({ where: { id: account.tenantId } }),
  ]);
  console.log(`cleanup verified: users=${users}, tenants=${tenants}`);
}

/* -------------------------------------------------------------------- main */

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  });
  let mailbox = null;
  let address = '';
  let account = null;
  let browser = null;

  try {
    if (USE_ADMIN_LINK) {
      address = `livecheck-reset-${Date.now()}@velaris.test`;
      console.log(`generated-link mode: no mailbox, account ${address}`);
    } else {
      mailbox = await openMailbox();
      address = mailbox.address;
    }

    await check('a synthetic tenant and account are created', async () => {
      account = await createSyntheticAccount(prisma, address);
      return `tenant ${account.slug}`;
    });

    await check('the account starts with a required password reset', async () => {
      await prisma.user.update({
        where: { id: account.userId },
        data: { passwordResetRequired: true },
      });
      const row = await prisma.user.findUnique({
        where: { id: account.userId },
        select: { passwordResetRequired: true },
      });
      if (!row?.passwordResetRequired) throw new Error('flag not set');
      return 'users.password_reset_required = true';
    });

    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    if (!USE_ADMIN_LINK) {
      await check('the sign-in form requests a recovery email', async () => {
        await page.goto(`${WEB_ORIGIN}/`);
        await page.locator('header').getByRole('button', { name: 'Sign In' }).click();
        await page.getByTestId('sign-in-email').fill(address);
        await page.getByTestId('forgot-password').click();
        try {
          await page
            .getByRole('status')
            .filter({ hasText: 'If an account exists for that address' })
            .waitFor({ timeout: 20_000 });
        } catch (error) {
          const alert = await page
            .getByTestId('sign-in-error')
            .textContent()
            .catch(() => null);
          throw new Error(
            `no confirmation notice; form reported: "${(alert ?? '').trim()}"; ` +
              (error instanceof Error ? error.message.split('\n')[0] : ''),
          );
        }
        return 'request accepted without revealing whether the account exists';
      });
    }

    // The link session sets the first new password; the gate then sets the
    // final one, so the two differ exactly as the policy requires.
    const recovered = { link: '', password: newPassword(), finalPassword: newPassword() };
    if (USE_ADMIN_LINK) {
      await check('the provider issues a recovery link for the account', async () => {
        recovered.link = await generatedRecoveryLink(address);
        return 'admin-generated link (same verify contract as the email)';
      });
    } else {
      await check('a real recovery email reaches the mailbox', async () => {
        const found = await recoverLinkFromInbox(mailbox);
        if (!found) throw new Error(`no recovery email within ${EMAIL_TIMEOUT_MS} ms`);
        recovered.link = found.link;
        // The inbox has served its purpose; remove it before the browser work so
        // a later failure cannot leave the mailbox behind.
        await closeMailbox(mailbox);
        mailbox = null;
        return `subject "${found.subject}"`;
      });
    }

    await check('the emailed link opens the callback with type=recovery', async () => {
      const target = new URL(recovered.link);
      console.log(
        `       link target: ${target.origin}${target.pathname} params=${[...target.searchParams.keys()].join(',')}`,
      );
      await page.goto(recovered.link);
      try {
        await page
          .getByRole('heading', { name: 'Choose a new password' })
          .waitFor({ timeout: 30_000 });
      } catch (error) {
        // Report the landing page shape only: the fragment holds live tokens.
        const landed = new URL(page.url());
        const heading = await page
          .locator('h1, h2')
          .first()
          .textContent()
          .catch(() => null);
        const alert = await page
          .locator('[role="alert"]')
          .first()
          .textContent()
          .catch(() => null);
        throw new Error(
          `landed on ${landed.origin}${landed.pathname} ` +
            `(fragment=${Boolean(landed.hash)}); heading="${heading ?? ''}"; ` +
            `alert="${alert ?? ''}"; ${error instanceof Error ? error.message.split('\n')[0] : ''}`,
        );
      }
      if (!page.url().startsWith(`${WEB_ORIGIN}/auth/callback`)) {
        throw new Error(`link landed on ${new URL(page.url()).origin}, not the local web origin`);
      }
      return 'callback form rendered, fragment removed';
    });

    await check('the callback accepts a new password', async () => {
      await page.getByTestId('new-password').fill(recovered.password);
      await page.getByTestId('confirm-password').fill(recovered.password);
      await page.getByTestId('update-password').click();
      await page
        .getByRole('status')
        .filter({ hasText: 'Password updated.' })
        .waitFor({ timeout: 20_000 });
      return 'provider password changed from the link session';
    });

    await check('the link does not clear the API flag, so the gate opens', async () => {
      const sessionReads = [];
      page.on('response', (response) => {
        if (response.url().includes('/auth/session')) {
          sessionReads.push(response.status());
        }
      });
      await page.getByRole('button', { name: 'Continue to workspace' }).click();
      try {
        await page.waitForURL(/\/admin/, { timeout: 30_000 });
        await page.getByTestId('password-reset').waitFor({ timeout: 20_000 });
      } catch (error) {
        const stored = await page.evaluate(
          (key) => Boolean(window.localStorage.getItem(key)),
          'velaris.auth.session.v1',
        );
        throw new Error(
          `landed on ${new URL(page.url()).pathname}; ` +
            `session reads=[${sessionReads.join(',')}]; storedSession=${stored}; ` +
            (error instanceof Error ? error.message.split('\n')[0] : ''),
        );
      }
      return 'landed on /admin with the reset dialog open';
    });

    await check('the gate clears the flag and ends the session', async () => {
      await page.getByTestId('password-reset-current').fill(recovered.password);
      await page.getByTestId('password-reset-new').fill(recovered.finalPassword);
      await page.getByTestId('password-reset-submit').click();
      await page.waitForURL(/\?signin=1/, { timeout: 30_000 });
      return 'POST /auth/password succeeded and the session ended';
    });

    await check('the account signs in with the new password, gate closed', async () => {
      // `/?signin=1` opens the modal itself; the header button is the fallback.
      const emailInput = page.getByTestId('sign-in-email');
      const opened = await emailInput
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        await page.locator('header').getByRole('button', { name: 'Sign In' }).click();
        await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
      }
      await emailInput.fill(address);
      await page.getByTestId('sign-in-password').fill(recovered.finalPassword);
      await page.getByTestId('sign-in-submit').click();
      await page.waitForURL(/\/admin/, { timeout: 30_000 });
      await page.waitForTimeout(1_500);
      if (await page.getByTestId('password-reset').isVisible().catch(() => false)) {
        throw new Error('the reset dialog is still open after sign-in');
      }
      return 'landed on /admin without the reset dialog';
    });

    await check('GET /auth/session reports a cleared, protected account', async () => {
      const session = await page.evaluate(
        async ({ api, key }) => {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          const { accessToken } = JSON.parse(raw);
          const response = await fetch(`${api}/auth/session`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          return { status: response.status, body: await response.json() };
        },
        { api: API_ORIGIN, key: 'velaris.auth.session.v1' },
      );
      if (!session || session.status !== 200) {
        throw new Error(`session read answered HTTP ${session?.status ?? 'none'}`);
      }
      if (session.body.passwordResetRequired !== false) {
        throw new Error('passwordResetRequired is still true');
      }
      if (session.body.role !== 'R-tenant-admin') {
        throw new Error(`role is ${String(session.body.role)}`);
      }
      return 'role R-tenant-admin, passwordResetRequired false';
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await removeSyntheticAccount(prisma, account);
    await closeMailbox(mailbox);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
