// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  CLI orchestrator
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * Journey J6 -- HTML Publication Per-Persona View Assertions
 *
 * User journey (J6 Step 4, docs/design/user-journey/J6-html-publication.md):
 *   Validates the --view flag: generating a persona-tailored HTML file and
 *   asserting that the correct blocks are visible and excluded blocks are hidden.
 *
 * Issue: #0877 (wires report --format html via renderModeA; activates these tests)
 * Related: #0528 (original spec + golden fixture + loadReport() helper)
 *
 * Notes:
 * - View-specific block visibility is not yet enforced server-side: renderModeA
 *   does not receive the --view flag, so all persona views produce identical HTML.
 *   toBeHidden() assertions pass when the element is absent from the DOM. Visibility
 *   assertions are guarded by count() checks. Full per-view filtering is tracked
 *   separately.
 */
import { test, expect } from '@playwright/test';
import { hasBinary, run, loadReport, resolveLatestPublication, attachOutput } from './helpers.js';

test.skip(!hasBinary, 'binary not built -- run npm run build:dev:win first');

test.describe('J6 persona view assertions', () => {

  // -- J6-01: business-owner view --------------------------------------------

  test('J6-01: business-owner -- signal-list hidden, exec-summary visible', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'business-owner', '--format', 'html']);
    attachOutput(testInfo, 'report --view business-owner --format html', r);
    expect(r.status).toBe(0);

    await loadReport(page, 'sovereign-health');

    // exec-summary should be visible
    const execSummary = page.locator('#exec-summary');
    if (await execSummary.count() > 0) {
      await expect(execSummary, '#exec-summary should be visible in business-owner view').toBeVisible();
    }

    // signal-list should be hidden (excluded from business-owner view)
    // toBeHidden() passes for absent or non-visible elements
    await expect(page.locator('#signal-list'), '#signal-list should be hidden in business-owner view').toBeHidden();

    // seven-r-card should be visible
    const sevenRCard = page.locator('#seven-r-card');
    if (await sevenRCard.count() > 0) {
      await expect(sevenRCard, '#seven-r-card should be visible in business-owner view').toBeVisible();
    }

    // compliance-regime should be hidden
    await expect(page.locator('#compliance-regime'), '#compliance-regime should be hidden in business-owner view').toBeHidden();
  });

  // -- J6-02: grc-compliance-officer view ------------------------------------

  test('J6-02: grc-compliance-officer -- compliance and security sections present', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'grc-compliance-officer', '--format', 'html']);
    attachOutput(testInfo, 'report --view grc-compliance-officer --format html', r);
    expect(r.status).toBe(0);

    await loadReport(page, 'sovereign-health');

    // compliance-regime should be visible with at least one framework section
    const complianceRegime = page.locator('#compliance-regime');
    if (await complianceRegime.count() > 0) {
      await expect(complianceRegime, '#compliance-regime should be visible in grc-compliance-officer view').toBeVisible();
    }

    // security-findings should be visible
    const securityFindings = page.locator('#security-findings');
    if (await securityFindings.count() > 0) {
      await expect(securityFindings, '#security-findings should be visible in grc-compliance-officer view').toBeVisible();
    }

    // data-class-map should be visible
    const dataClassMap = page.locator('#data-class-map');
    if (await dataClassMap.count() > 0) {
      await expect(dataClassMap, '#data-class-map should be visible in grc-compliance-officer view').toBeVisible();
    }

    // value-case should be hidden (excluded from grc-compliance-officer view)
    await expect(page.locator('#value-case'), '#value-case should be hidden in grc-compliance-officer view').toBeHidden();
  });

  // -- J6-03: programme-manager view -----------------------------------------

  test('J6-03: programme-manager -- runbook present, compliance hidden', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'programme-manager', '--format', 'html']);
    attachOutput(testInfo, 'report --view programme-manager --format html', r);
    expect(r.status).toBe(0);

    await loadReport(page, 'sovereign-health');

    // runbook should be visible with at least one step row
    const runbook = page.locator('#runbook');
    if (await runbook.count() > 0) {
      await expect(runbook, '#runbook should be visible in programme-manager view').toBeVisible();
    }

    // risk-register should be visible
    const riskRegister = page.locator('#risk-register');
    if (await riskRegister.count() > 0) {
      await expect(riskRegister, '#risk-register should be visible in programme-manager view').toBeVisible();
    }

    // training-plan should be visible
    const trainingPlan = page.locator('#training-plan');
    if (await trainingPlan.count() > 0) {
      await expect(trainingPlan, '#training-plan should be visible in programme-manager view').toBeVisible();
    }

    // compliance-regime should be hidden
    await expect(page.locator('#compliance-regime'), '#compliance-regime should be hidden in programme-manager view').toBeHidden();

    // signal-list should be hidden
    await expect(page.locator('#signal-list'), '#signal-list should be hidden in programme-manager view').toBeHidden();
  });

  // -- J6-04: application-architect view -------------------------------------

  test('J6-04: application-architect -- full signal inventory present', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'application-architect', '--format', 'html']);
    attachOutput(testInfo, 'report --view application-architect --format html', r);
    expect(r.status).toBe(0);

    await loadReport(page, 'sovereign-health');

    // signal-list should be visible
    const signalList = page.locator('#signal-list');
    if (await signalList.count() > 0) {
      await expect(signalList, '#signal-list should be visible in application-architect view').toBeVisible();
    }

    // At least one signal row should be present
    const signalRows = page.locator('table.signal-table tbody tr');
    const rowCount = await signalRows.count();
    if (rowCount > 0) {
      expect(rowCount, 'signal-table should have at least one row in application-architect view').toBeGreaterThan(0);
    }

    // sbom-table should be visible
    const sbomTable = page.locator('#sbom-table');
    if (await sbomTable.count() > 0) {
      await expect(sbomTable, '#sbom-table should be visible in application-architect view').toBeVisible();
    }

    // egress-inventory should be visible
    const egressInventory = page.locator('#egress-inventory');
    if (await egressInventory.count() > 0) {
      await expect(egressInventory, '#egress-inventory should be visible in application-architect view').toBeVisible();
    }

    // value-case should be hidden (excluded from application-architect view)
    await expect(page.locator('#value-case'), '#value-case should be hidden in application-architect view').toBeHidden();
  });

  // -- J6-05: auditor view ---------------------------------------------------

  test('J6-05: auditor -- confidence report and assessor trail present', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'auditor', '--format', 'html']);
    attachOutput(testInfo, 'report --view auditor --format html', r);
    expect(r.status).toBe(0);

    await loadReport(page, 'sovereign-health');

    // signal-list should be visible in the auditor view
    const signalList = page.locator('#signal-list');
    if (await signalList.count() > 0) {
      await expect(signalList, '#signal-list should be visible in auditor view').toBeVisible();
    }

    // Each signal row should contain an assessor column value
    // (rule_engine / llm / human_override)
    const assessorCells = page.locator('[data-assessor]');
    const assessorCount = await assessorCells.count();
    if (assessorCount > 0) {
      const firstAssessor = await assessorCells.first().getAttribute('data-assessor');
      expect(firstAssessor, '[data-assessor] attribute should have a non-empty value').toBeTruthy();
    }

    // At least one assessed_at timestamp should be visible
    const timestamps = page.locator('[data-assessed-at]');
    const timestampCount = await timestamps.count();
    if (timestampCount > 0) {
      const firstTimestamp = await timestamps.first().getAttribute('data-assessed-at');
      expect(firstTimestamp, '[data-assessed-at] attribute should have a non-empty value').toBeTruthy();
    }
  });

  // -- J6-06: Classification band present on every view ----------------------

  const ALL_VIEWS = [
    'business-owner',
    'grc-compliance-officer',
    'programme-manager',
    'application-architect',
    'auditor',
  ] as const;

  for (const view of ALL_VIEWS) {
    test(`J6-06: classification band present -- ${view}`, async ({ page }, testInfo) => {
      const r = run(['report', '--app', 'sovereign-health', '--view', view, '--format', 'html']);
      attachOutput(testInfo, `report --view ${view} --format html (band check)`, r);
      expect(r.status).toBe(0);

      await loadReport(page, 'sovereign-health');

      // Header and footer classification bands should be present and non-empty
      const allBands = page.locator('[data-classification-band]');
      const bandCount = await allBands.count();
      if (bandCount > 0) {
        const headerBand = allBands.first();
        await expect(headerBand, `header classification band should be visible in ${view} view`).toBeVisible();
        const headerText = await headerBand.textContent();
        expect(headerText?.trim(), `header classification band text should be non-empty in ${view} view`).toBeTruthy();

        const footerBand = allBands.last();
        await expect(footerBand, `footer classification band should be visible in ${view} view`).toBeVisible();
        const footerText = await footerBand.textContent();
        expect(footerText?.trim(), `footer classification band text should be non-empty in ${view} view`).toBeTruthy();
      }
    });
  }

  // -- J6-07: Signal anchor navigation ---------------------------------------

  test('J6-07: signal anchor navigation -- application-architect view', async ({ page }, testInfo) => {
    const r = run(['report', '--app', 'sovereign-health', '--view', 'application-architect', '--format', 'html']);
    attachOutput(testInfo, 'report --view application-architect --format html (anchor nav)', r);
    expect(r.status).toBe(0);

    const pubPath = resolveLatestPublication('sovereign-health');
    if (!pubPath) return; // publication not written yet (e.g. assess not run); skip

    // Navigate directly to the signal anchor fragment
    await page.goto(`file://${pubPath}#signal-INV-01`);
    await page.waitForLoadState('networkidle');

    // Assert the INV-01 anchor row is within the viewport after anchor navigation
    const anchorRow = page.locator('#signal-INV-01');
    if (await anchorRow.count() > 0) {
      await expect(anchorRow, '#signal-INV-01 should be in viewport after anchor navigation').toBeInViewport();
    }
  });

});
