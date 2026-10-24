// Human-approval gate for pull requests (AGENTS.md sections 3.3 and 3.4).
//
// The pull request passes only when a human approval exists:
//   1. the PR carries the `owner-approved` label, or
//   2. a GitHub review with state APPROVED exists from a user who is not the
//      PR author (GitHub blocks self-approval; the check repeats it anyway).
//
// Environment inputs:
//   PR_LABELS   JSON array of label names (from the event payload).
//   PR_AUTHOR   login of the PR author.
//   PR_NUMBER   pull request number (needed only for the reviews lookup).
//   GITHUB_REPOSITORY  owner/repo (needed only for the reviews lookup).
//   GH_TOKEN    token for the reviews lookup (provided by the workflow).
//   REVIEWS_JSON  raw reviews JSON; skips the `gh` lookup when set (tests).
//
// Exit codes: 0 = approval exists, 1 = no approval, 2 = inputs broken
// (fails closed, so a broken gate never reads as approved).

import { execSync } from 'node:child_process';

let labels;
try {
  labels = JSON.parse(process.env.PR_LABELS ?? '[]');
  if (!Array.isArray(labels)) throw new Error('not an array');
} catch (error) {
  console.error(`check-pr-approval: PR_LABELS is not a JSON array: ${error.message}`);
  process.exit(2);
}
const author = process.env.PR_AUTHOR ?? '';
if (!author) {
  console.error('check-pr-approval: PR_AUTHOR is missing.');
  process.exit(2);
}

if (labels.includes('owner-approved')) {
  console.log('check-pr-approval: PASS - PR carries the owner-approved label.');
  process.exit(0);
}

// The number reaches a shell command below; digits only.
if (process.env.PR_NUMBER !== undefined && !/^\d+$/.test(process.env.PR_NUMBER)) {
  console.error('check-pr-approval: PR_NUMBER is not numeric; failing closed.');
  process.exit(2);
}

let reviewsRaw = process.env.REVIEWS_JSON;
if (reviewsRaw === undefined) {
  const number = process.env.PR_NUMBER;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!number || !repository || !process.env.GH_TOKEN) {
    console.error('check-pr-approval: no label and no way to read reviews; failing closed.');
    process.exit(2);
  }
  try {
    reviewsRaw = execSync(`gh api repos/${repository}/pulls/${number}/reviews`, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`check-pr-approval: reviews lookup failed; failing closed: ${error.message}`);
    process.exit(2);
  }
}

let reviews;
try {
  reviews = JSON.parse(reviewsRaw);
} catch {
  console.error('check-pr-approval: reviews payload is not valid JSON; failing closed.');
  process.exit(2);
}
if (!Array.isArray(reviews)) {
  console.error('check-pr-approval: reviews payload is not an array; failing closed.');
  process.exit(2);
}

const approvals = reviews.filter(
  (review) => review?.state === 'APPROVED' && review?.user?.login && review.user.login !== author,
);

if (approvals.length > 0) {
  console.log(
    `check-pr-approval: PASS - ${approvals.length} approving review(s) from a user other than the PR author.`,
  );
  process.exit(0);
}

console.error(
  'check-pr-approval: FAIL - human approval is missing. Add the owner-approved label after human review, or request an approving review.',
);
process.exit(1);
