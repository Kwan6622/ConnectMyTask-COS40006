// Unit tests for the rule-based fraud/risk flag (riskEvaluator.js).
// A task is flagged only when its budget is below the category minimum,
// raised by keyword multipliers found in the title/description.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORY_MIN_BUDGET_VND, KEYWORD_BUDGET_MODIFIERS, evaluateTaskRisk } = require('./riskEvaluator');

const plain = (category, budget) => evaluateTaskRisk({ category, budget, title: 'Help needed', description: 'Simple job' });

test('every category: budget at the minimum passes, just below is MEDIUM, under half is HIGH', () => {
  for (const [category, min] of Object.entries(CATEGORY_MIN_BUDGET_VND)) {
    const atMin = plain(category, min);
    assert.equal(atMin.isSuspicious, false, `${category} at ${min}`);
    assert.equal(atMin.riskLevel, null);
    assert.equal(atMin.suspiciousReason, null);

    const below = plain(category, min - 1);
    assert.equal(below.isSuspicious, true, `${category} at ${min - 1}`);
    assert.equal(below.riskLevel, 'MEDIUM');
    assert.equal(below.suspiciousReason, 'Budget is unusually low for this type of job');
    assert.equal(below.expectedMinBudget, min);

    assert.equal(plain(category, Math.floor(min * 0.5) - 1).riskLevel, 'HIGH', `${category} under 50%`);
  }
});

test('HIGH/MEDIUM boundary is exactly 50% of the expected minimum', () => {
  assert.equal(plain('CLEANING', 125000).riskLevel, 'MEDIUM'); // ratio 0.5
  assert.equal(plain('CLEANING', 124999).riskLevel, 'HIGH');
});

test('category is case-insensitive; unknown or missing category falls back to OTHER', () => {
  assert.equal(plain('cleaning', 249999).expectedMinBudget, CATEGORY_MIN_BUDGET_VND.CLEANING);
  assert.equal(plain(' moving ', 699999).isSuspicious, true);
  assert.equal(plain('GARDENING', 199999).expectedMinBudget, CATEGORY_MIN_BUDGET_VND.OTHER);
  assert.equal(plain(undefined, 199999).isSuspicious, true);
  assert.equal(plain('GARDENING', 200000).isSuspicious, false);
});

test('missing, zero or non-numeric budget is never flagged (API validation requires a positive budget)', () => {
  for (const budget of [0, null, undefined, 'abc']) {
    assert.equal(plain('MOVING', budget).isSuspicious, false, String(budget));
  }
});

test('each keyword rule raises the minimum and becomes the flag reason', () => {
  for (const rule of KEYWORD_BUDGET_MODIFIERS) {
    const expected = Math.round(CATEGORY_MIN_BUDGET_VND.OTHER * rule.multiplier);
    for (const keyword of rule.keywords) {
      const risk = evaluateTaskRisk({ category: 'OTHER', budget: expected - 1, title: 'Job', description: `Need this ${keyword}` });
      assert.equal(risk.expectedMinBudget, expected, keyword);
      assert.equal(risk.isSuspicious, true, keyword);
      assert.equal(risk.suspiciousReason, `${rule.reason}. Budget looks unusually low for this task.`);
      assert.deepEqual(risk.riskHints, [rule.reason]);
      // The plain category minimum alone would not have flagged this budget.
      assert.equal(plain('OTHER', expected - 1).isSuspicious, false, keyword);
    }
  }
});

test('keyword rules stack in order with rounding; the reason uses the first matched rule', () => {
  const risk = evaluateTaskRisk({
    category: 'CLEANING',
    budget: 700000,
    title: 'URGENT deep clean',
    description: 'Fragile glass items, install new curtain rail',
  });
  // 250000 x1.6 = 400000 x1.25 = 500000 x1.2 = 600000 x1.3 = 780000
  assert.equal(risk.expectedMinBudget, 780000);
  assert.equal(risk.baseExpectedMinBudget, 250000);
  assert.equal(risk.riskHints.length, 4);
  assert.equal(risk.isSuspicious, true);
  assert.equal(risk.riskLevel, 'MEDIUM');
  assert.match(risk.suspiciousReason, /^Task scope suggests a more intensive service/);
});

test('several keywords of the same rule count once', () => {
  const risk = evaluateTaskRisk({ category: 'DELIVERY', budget: 1, title: 'urgent asap', description: 'today, tonight, immediately' });
  assert.equal(risk.expectedMinBudget, 120000);
  assert.equal(risk.riskHints.length, 1);
});

test('keywords are matched case-insensitively in both title and description', () => {
  assert.equal(evaluateTaskRisk({ category: 'MOVING', budget: 800000, title: 'HEAVY sofa' }).expectedMinBudget, 875000);
  assert.equal(evaluateTaskRisk({ category: 'MOVING', budget: 800000, description: 'Up the STAIRS' }).isSuspicious, true);
});

test('unflagged results still report the expected minimum and matched hints', () => {
  const risk = evaluateTaskRisk({ category: 'IT_SUPPORT', budget: 500000, title: 'Install printer' });
  assert.equal(risk.isSuspicious, false);
  assert.equal(risk.expectedMinBudget, 390000);
  assert.equal(risk.riskHints.length, 1);
});

test('current behaviour: keywords are plain substrings, so related words also raise the minimum', () => {
  assert.equal(evaluateTaskRisk({ category: 'OTHER', budget: 1, title: 'Clean my glasses' }).expectedMinBudget, 250000);
  assert.equal(evaluateTaskRisk({ category: 'OTHER', budget: 1, title: 'Reinstall Windows' }).expectedMinBudget, 260000);
});

test('current behaviour: an unusually high budget is never flagged', () => {
  assert.equal(plain('DELIVERY', 1e12).isSuspicious, false);
});

test('Vietnamese urgency words also raise the minimum', {
  todo: 'GAP: keyword rules are English only ("gấp", "khẩn cấp", "hôm nay" are ignored)',
}, () => {
  assert.equal(evaluateTaskRisk({ category: 'DELIVERY', budget: 110000, title: 'Giao hàng gấp hôm nay' }).isSuspicious, true);
});
