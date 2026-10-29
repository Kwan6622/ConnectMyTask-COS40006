const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSettlementBreakdown, settlementFromDeposit } = require('./platformFee');

test('platform fee supports percentage, fixed and inactive settings', () => {
  assert.equal(computeSettlementBreakdown(600000, { feeType: 'PERCENTAGE', percentageRate: 0.2, isActive: true }).platformFeeAmount, 120000);
  assert.equal(computeSettlementBreakdown(600000, { feeType: 'FIXED', fixedAmount: 25000, isActive: true }).providerPayoutAmount, 575000);
  assert.equal(computeSettlementBreakdown(600000, { feeType: 'FIXED', fixedAmount: 25000, isActive: false }).platformFeeAmount, 0);
});

test('release uses stored deposit breakdown after settings change', () => {
  const settlement = settlementFromDeposit({ totalAmount: 600000, escrowHeldAmount: 600000, platformFeeAmount: 120000, providerPayoutAmount: 480000 }, 600000);
  assert.deepEqual(settlement, { totalAmount: 600000, escrowHeldAmount: 600000, platformFeeAmount: 120000, providerPayoutAmount: 480000 });
});

test('fee cannot consume the full accepted bid', () => {
  assert.throws(() => computeSettlementBreakdown(1000, { feeType: 'FIXED', fixedAmount: 1000, isActive: true }), error => error.statusCode === 409);
});
