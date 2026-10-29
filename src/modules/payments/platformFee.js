const LEGACY_PLATFORM_FEE_CONFIG = Object.freeze({
  id: 1,
  feeType: 'PERCENTAGE',
  percentageRate: 0.2,
  fixedAmount: null,
  isActive: true,
  version: 1,
  persistenceAvailable: false,
});

function normalizePlatformFeeConfig(config) {
  const source = config || LEGACY_PLATFORM_FEE_CONFIG;
  return {
    id: Number(source.id || 1),
    feeType: source.feeType === 'FIXED' ? 'FIXED' : 'PERCENTAGE',
    percentageRate: source.percentageRate == null ? null : Number(source.percentageRate),
    fixedAmount: source.fixedAmount == null ? null : Number(source.fixedAmount),
    isActive: source.isActive !== false,
    version: Number(source.version || 1),
    updatedAt: source.updatedAt || null,
    updatedById: source.updatedById || null,
    persistenceAvailable: source.persistenceAvailable !== false,
  };
}

function computeSettlementBreakdown(totalAmount, config = LEGACY_PLATFORM_FEE_CONFIG) {
  const total = Number(totalAmount || 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw Object.assign(new Error('Settlement amount must be greater than zero'), { statusCode: 400 });
  }

  const normalized = normalizePlatformFeeConfig(config);
  const rawFee = !normalized.isActive
    ? 0
    : normalized.feeType === 'FIXED'
      ? Number(normalized.fixedAmount || 0)
      : total * Number(normalized.percentageRate || 0);
  const platformFeeAmount = Math.round(rawFee);
  if (!Number.isFinite(platformFeeAmount) || platformFeeAmount < 0 || platformFeeAmount >= total) {
    throw Object.assign(new Error('Configured platform fee must be less than the agreed price'), { statusCode: 409 });
  }

  return {
    totalAmount: total,
    escrowHeldAmount: total,
    platformFeeAmount,
    providerPayoutAmount: total - platformFeeAmount,
    feeConfig: normalized,
  };
}

function settlementFromDeposit(deposit, fallbackAmount) {
  const totalAmount = Number(deposit?.totalAmount ?? deposit?.amount ?? fallbackAmount ?? 0);
  const platformFeeAmount = Number(deposit?.platformFeeAmount);
  const providerPayoutAmount = Number(deposit?.providerPayoutAmount);
  if (Number.isFinite(totalAmount) && totalAmount > 0
    && Number.isFinite(platformFeeAmount) && platformFeeAmount >= 0
    && Number.isFinite(providerPayoutAmount) && providerPayoutAmount >= 0
    && platformFeeAmount + providerPayoutAmount === totalAmount) {
    return {
      totalAmount,
      escrowHeldAmount: Number(deposit?.escrowHeldAmount ?? totalAmount),
      platformFeeAmount,
      providerPayoutAmount,
    };
  }
  return computeSettlementBreakdown(totalAmount, LEGACY_PLATFORM_FEE_CONFIG);
}

module.exports = {
  LEGACY_PLATFORM_FEE_CONFIG,
  normalizePlatformFeeConfig,
  computeSettlementBreakdown,
  settlementFromDeposit,
};
