// @ts-check
import { AxeBuilder } from "@axe-core/playwright";
import { expect } from "@playwright/test";

/**
 * Automated accessibility checks for the critical journeys (T6.02, NFR-08).
 *
 * NFR-08 targets WCAG 2.2 AA for the critical journeys and asks for automated
 * checks plus a manual review. This helper is the automated half: it runs
 * axe-core with the WCAG 2.0, 2.1 and 2.2 A/AA rule tags against the state the
 * journey has just rendered, and fails on a critical or serious violation.
 *
 * Serious and critical cover the failures that block a keyboard or
 * screen-reader user: missing names and labels, broken landmarks, unlabelled
 * form controls, invalid ARIA. Moderate and minor findings are reported in
 * the T6.02 evidence report with owners instead of failing a journey, because
 * they include stylistic contrast preferences that the design system review
 * owns.
 *
 * The tag list is deliberate: axe changes its default rule set between
 * versions, so a scan that relied on defaults could silently stop checking a
 * WCAG 2.2 rule.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Render a violation as one readable line for the failure message. */
function describe(violation) {
  const targets = violation.nodes
    .slice(0, 3)
    .map((node) => node.target.join(" "))
    .join(" | ");
  const more =
    violation.nodes.length > 3 ? ` (+${violation.nodes.length - 3} more)` : "";
  return `${violation.id} [${violation.impact}] ${violation.help} -> ${targets}${more}`;
}

/**
 * Assert that the current page has no critical or serious WCAG A/AA
 * violation. `label` names the journey state, so a failure says which screen
 * regressed.
 */
export async function expectNoSeriousA11yViolations(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(
    blocking.map(describe),
    `${label}: critical or serious WCAG 2.2 AA violations`,
  ).toEqual([]);
}
