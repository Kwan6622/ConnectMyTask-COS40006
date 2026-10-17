const DISTRICT_ALIASES = [
  'district 1',
  'district 2',
  'district 3',
  'district 4',
  'district 5',
  'district 6',
  'district 7',
  'district 8',
  'district 9',
  'district 10',
  'district 11',
  'district 12',
  'thu duc',
  'phu nhuan',
  'binh thanh',
  'go vap',
  'tan binh',
  'tan phu',
  'nha be',
  'hoc mon',
  'binh chanh',
  'cu chi',
];

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function roundSgd(value) {
  // Round to the nearest whole SGD dollar
  return Math.max(1, Math.round(value));
}

function extractFirstNumber(text) {
  const match = text.match(/\b(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

function detectUrgency(text) {
  const urgentKeywords = [
    'urgent',
    'asap',
    'today',
    'now',
    'immediately',
    'same day',
  ];
  return urgentKeywords.some((word) => text.includes(word));
}

function detectDistanceHint(locationText, descriptionText) {
  const merged = `${locationText} ${descriptionText}`;
  const districtMentions = DISTRICT_ALIASES.filter((district) => merged.includes(district));
  const kmMatch = merged.match(/(\d{1,2})\s?(km|kilometer|kilometre)/);
  if (kmMatch) {
    return Math.max(1, Math.min(30, Number(kmMatch[1])));
  }
  if (districtMentions.length >= 2) return 12;
  if (districtMentions.length === 1) return 5;
  return 6;
}

function estimateCleaningBudget({ titleText, descText }) {
  let min = 18; // SGD
  let max = 35; // SGD
  const factors = [];

  const roomCount = extractFirstNumber(`${titleText} ${descText}`);
  if (roomCount && roomCount >= 2) {
    const add = Math.min(roomCount, 6) * 7;
    min += add;
    max += add + 7;
    factors.push(`${roomCount} room(s) mentioned`);
  }

  if (titleText.includes('deep') || descText.includes('deep') || descText.includes('full')) {
    min += 18;
    max += 35;
    factors.push('deep/full cleaning scope');
  }

  if (descText.includes('kitchen') || descText.includes('bathroom')) {
    min += 9;
    max += 17;
    factors.push('kitchen/bathroom included');
  }

  return { min, max, factors };
}

function estimateDeliveryBudget({ titleText, descText, locationText, urgent }) {
  let min = 8;
  let max = 18;
  const factors = [];

  const distanceKm = detectDistanceHint(locationText, `${titleText} ${descText}`);
  min += distanceKm * 0.6;
  max += distanceKm * 1.2;
  factors.push(`estimated distance around ${distanceKm}km`);

  if (titleText.includes('document') || descText.includes('document')) {
    min += 2;
    max += 5;
    factors.push('document handling');
  }

  if (titleText.includes('heavy') || descText.includes('heavy') || descText.includes('fragile')) {
    min += 4;
    max += 9;
    factors.push('special package handling');
  }

  if (urgent) {
    min += 8;
    max += 15;
    factors.push('urgent delivery');
  }

  return { min, max, factors };
}

function estimateRepairBudget({ titleText, descText, isElectrical }) {
  let min = isElectrical ? 25 : 22;
  let max = isElectrical ? 60 : 55;
  const factors = [];

  const issueCount = extractFirstNumber(`${titleText} ${descText}`);
  if (issueCount && issueCount >= 2) {
    const add = Math.min(issueCount, 6) * 9;
    min += add;
    max += add + 12;
    factors.push(`${issueCount} issues/points mentioned`);
  }

  if (titleText.includes('install') || descText.includes('install')) {
    min += 8;
    max += 17;
    factors.push('installation work included');
  }

  if (titleText.includes('leak') || descText.includes('leak') || descText.includes('water')) {
    min += 6;
    max += 13;
    factors.push('technical troubleshooting required');
  }

  return { min, max, factors };
}

function estimatePlumbingBudget({ titleText, descText }) {
  let min = 26;
  let max = 62;
  const factors = [];

  const issueCount = extractFirstNumber(`${titleText} ${descText}`);
  if (issueCount && issueCount >= 2) {
    const add = Math.min(issueCount, 6) * 8.5;
    min += add;
    max += add + 12;
    factors.push(`${issueCount} plumbing issues/points mentioned`);
  } else {
    factors.push('single plumbing issue scope');
  }

  if (descText.includes('leak')) {
    min += 6;
    max += 13;
    factors.push('leak troubleshooting');
  }

  if (descText.includes('toilet') || descText.includes('sink')) {
    min += 4;
    max += 9;
    factors.push('fixture-specific repair');
  }

  return { min, max, factors };
}

function estimateInstallationBudget({ titleText, descText }) {
  let min = 22;
  let max = 52;
  const factors = [];

  const itemCount = extractFirstNumber(`${titleText} ${descText}`);
  if (itemCount && itemCount >= 2) {
    const add = Math.min(itemCount, 8) * 7;
    min += add;
    max += add + 11;
    factors.push(`${itemCount} installation items mentioned`);
  } else {
    factors.push('single installation item scope');
  }

  if (descText.includes('wall') || descText.includes('ceiling') || descText.includes('drill')) {
    min += 5;
    max += 11;
    factors.push('mounting/drilling complexity');
  }

  return { min, max, factors };
}

function detectSubServiceByKeywords(titleText, descText) {
  const title = normalizeText(titleText);
  const desc = normalizeText(descText);
  const combined = `${title} ${desc}`;

  const plumbingKeywords = [
    'pipe', 'sink', 'toilet', 'leak', 'water', 'faucet', 'drain',
  ];
  const electricalKeywords = [
    'switch', 'outlet', 'socket', 'wiring', 'wire', 'fan', 'light', 'power',
  ];
  const installationKeywords = [
    'install', 'mount', 'assemble', 'set up',
  ];

  const countMatches = (keywords) => keywords.reduce((acc, keyword) => acc + (combined.includes(keyword) ? 1 : 0), 0);
  const titleBoost = (keywords) => keywords.reduce((acc, keyword) => acc + (title.includes(keyword) ? 2 : 0), 0);

  const plumbingScore = countMatches(plumbingKeywords) + titleBoost(plumbingKeywords);
  const electricalScore = countMatches(electricalKeywords) + titleBoost(electricalKeywords);
  const installationScore = countMatches(installationKeywords) + titleBoost(installationKeywords);

  const scored = [
    { key: 'PLUMBING', score: plumbingScore },
    { key: 'ELECTRICAL', score: electricalScore },
    { key: 'INSTALLATION', score: installationScore },
  ].sort((a, b) => b.score - a.score);

  if (scored[0].score <= 0) return { key: 'GENERAL_REPAIR', reason: 'no strong title keywords matched' };
  return { key: scored[0].key, reason: `title/description keywords matched ${scored[0].key.toLowerCase()}` };
}

function estimateMovingBudget({ titleText, descText, locationText }) {
  let min = 30;
  let max = 70;
  const factors = [];

  const itemCount = extractFirstNumber(`${titleText} ${descText}`);
  if (itemCount && itemCount >= 3) {
    const add = Math.min(itemCount, 20) * 4.5;
    min += add;
    max += add + 15;
    factors.push(`${itemCount} items/furniture mentioned`);
  }

  const distanceKm = detectDistanceHint(locationText, `${titleText} ${descText}`);
  min += distanceKm * 1.2;
  max += distanceKm * 2.2;
  factors.push(`moving distance around ${distanceKm}km`);

  if (descText.includes('stairs') || descText.includes('no lift')) {
    min += 12;
    max += 22;
    factors.push('stairs/no-lift condition');
  }

  if (descText.includes('fragile') || descText.includes('heavy')) {
    min += 9;
    max += 18;
    factors.push('fragile/heavy handling');
  }

  return { min, max, factors };
}

function estimateTechSupportBudget({ titleText, descText }) {
  let min = 15;
  let max = 40;
  const factors = [];

  const issueCount = extractFirstNumber(`${titleText} ${descText}`);
  if (issueCount && issueCount >= 2) {
    const add = Math.min(issueCount, 5) * 6;
    min += add;
    max += add + 9;
    factors.push(`${issueCount} issues to fix`);
  }

  if (descText.includes('hardware') || descText.includes('install') || descText.includes('replace')) {
    min += 7;
    max += 15;
    factors.push('hardware-level support');
  }

  if (descText.includes('onsite') || descText.includes('at home')) {
    min += 5;
    max += 9;
    factors.push('onsite support required');
  }

  return { min, max, factors };
}

function estimateOtherBudget({ titleText, descText }) {
  let min = 18;
  let max = 45;
  const factors = [];

  if ((titleText + descText).length > 180) {
    min += 5;
    max += 12;
    factors.push('detailed scope indicates medium-high complexity');
  }

  return { min, max, factors };
}

function categoryEstimator(category, context) {
  const value = String(category || '').toUpperCase();
  if (value === 'CLEANING') return estimateCleaningBudget(context);
  if (value === 'DELIVERY') return estimateDeliveryBudget(context);
  if (value === 'MOVING') return estimateMovingBudget(context);
  if (value === 'IT_SUPPORT' || value === 'TECH_SUPPORT') return estimateTechSupportBudget(context);
  if (value === 'HOME_REPAIR') return estimateRepairBudget({ ...context, isElectrical: false });
  if (value === 'ELECTRICAL') return estimateRepairBudget({ ...context, isElectrical: true });
  if (value === 'PLUMBING') return estimatePlumbingBudget(context);
  if (value === 'INSTALLATION') return estimateInstallationBudget(context);
  return estimateOtherBudget(context);
}

function buildBudgetSuggestion(payload, aiRecommendation) {
  const titleText = normalizeText(payload.title);
  const descText = normalizeText(payload.description);
  const locationText = normalizeText(payload.location);
  const urgent = detectUrgency(`${titleText} ${descText}`);

  const category = String(payload.category || '').toUpperCase();
  const subService = category === 'HOME_REPAIR'
    ? detectSubServiceByKeywords(titleText, descText)
    : null;

  const effectiveCategory =
    subService?.key === 'GENERAL_REPAIR'
      ? category
      : (subService?.key || category);

  const base = categoryEstimator(effectiveCategory, {
    titleText,
    descText,
    locationText,
    urgent,
  });

  let min = base.min;
  let max = base.max;
  const factorsUsed = [
    `category input: ${category || 'OTHER'}`,
    `pricing logic used: ${effectiveCategory || 'OTHER'}`,
    ...base.factors,
  ];

  if (subService) {
    factorsUsed.push(`sub-service detection: ${subService.reason}`);
  }

  if (urgent) {
    min += 6;
    max += 12;
    factorsUsed.push('urgent keyword detected in title/description');
  }

  // If the Python AI model provided an SGD recommendation, blend it seamlessly
  if (aiRecommendation && Number.isFinite(aiRecommendation.suggestedPrice)) {
    const aiSgd = Math.max(10, aiRecommendation.suggestedPrice); // Safely ingest raw SGD from Python
    const ruleMid = (min + max) / 2;
    const blendedMid = ruleMid * 0.8 + aiSgd * 0.2;
    const spread = Math.max(6, (max - min) * 0.6); // Minimum spread of 6 SGD
    min = blendedMid - spread / 2;
    max = blendedMid + spread / 2;
    factorsUsed.push('blended with existing AI model signal');
  }

  const suggestedMin = roundSgd(min);
  const suggestedMax = roundSgd(Math.max(suggestedMin + 2, max)); // Ensure max is at least 2 SGD higher
  const suggestedBudget = roundSgd((suggestedMin + suggestedMax) / 2);

  return {
    suggestedMin,
    suggestedMax,
    suggestedBudget,
    currency: 'SGD', // Correctly returning SGD to the frontend
    factorsUsed,
    explanation: `Suggested from ${effectiveCategory || 'OTHER'} job type detected mainly from title, then refined by description${urgent ? ', including urgency' : ''}.`,
  };
}

module.exports = {
  buildBudgetSuggestion,
};
