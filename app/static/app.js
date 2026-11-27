// ConnectMyTask Fraud Task Detection AI - demo website (vanilla JS, talks to FastAPI)
const CATEGORIES = [
  { value: 'DELIVERY', label: 'Delivery', icon: '🚚' },
  { value: 'HOME_REPAIR', label: 'Home Repair', icon: '🔧' },
  { value: 'CLEANING', label: 'Cleaning', icon: '✨' },
  { value: 'IT_SUPPORT', label: 'IT Support', icon: '💻' },
  { value: 'PERSONAL_ASSISTANT', label: 'Personal Assistant', icon: '👤' },
  { value: 'MOVING', label: 'Moving', icon: '📦' },
  { value: 'TUTORING', label: 'Tutoring', icon: '📚' },
  { value: 'OTHER', label: 'Other', icon: '⭐' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, `${c.icon} ${c.label}`]));
const OUTCOME = {
  APPROVED: 'Looks safe. The task will be published to providers immediately.',
  NEEDS_REVIEW: 'Some risk signals. The task will be held for an admin to review before it goes live.',
  BLOCKED: 'High fraud risk. The task will be blocked and will not be shown to providers.',
};
const SAMPLES = {
  legit: { title: 'Fix leaking kitchen sink', category: 'HOME_REPAIR', district: 'Ben Thanh', streetName: '35 Bach Dang', budget: 450000, urgency: 'NORMAL', days: 3, images: 2,
    description: 'The sink has been leaking under the cabinet for two days. Please bring your own tools. Payment through ConnectMyTask escrow after completion.' },
  scam: { title: 'EASY PART-TIME DELIVERY JOB, HIGH PAY', category: 'DELIVERY', district: 'Tan Dinh', streetName: '12 Le Loi', budget: 3000000, urgency: 'URGENT', days: 0.1, images: 0,
    description: 'Provider must pay a 300,000 VND registration fee before starting. Contact me on Zalo 0912345678 for details, do not use app chat. Limited slots!!!' },
  subtle: { title: 'Help with grocery shopping', category: 'PERSONAL_ASSISTANT', district: 'Go Vap', streetName: '88 Quang Trung', budget: 400000, urgency: 'NORMAL', days: 2, images: 0,
    description: 'Should take around 2 hours. Text me for details, I reply faster that way: 09 12 34 56 78.' },
  underpay: { title: 'Help move 3-bedroom apartment', category: 'MOVING', district: 'Binh Thanh', streetName: '200 Xo Viet Nghe Tinh', budget: 150000, urgency: 'URGENT', days: 1, images: 0,
    description: 'Around 35 boxes plus a bed, wardrobe and desk. Old place is on the 4th floor with stairs. Whole house, all rooms. Provider pays for transport.' },
};

let options = null;
let model = null;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const form = $('#taskForm');
const fmtVnd = (n) => `${Number(n).toLocaleString('en-US')} VND`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => `${d.loc.slice(-1)[0]}: ${d.msg.replace('Value error, ', '')}`).join(' · ')
      : body.detail || res.statusText;
    throw new Error(detail);
  }
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ---------- tabs ----------
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'feed') loadFeed();
  if (name === 'review') loadQueue();
  if (name === 'model') renderModel();
}

// ---------- form setup ----------
function buildForm() {
  $('#categories').innerHTML = CATEGORIES.map((c) => `
    <label class="cat" data-value="${c.value}"><input type="radio" name="category" value="${c.value}" hidden />
      <span class="ico">${c.icon}</span>${c.label}</label>`).join('');
  $$('.cat').forEach((el) => el.addEventListener('click', () => selectCategory(el.dataset.value)));
  const sel = form.district;
  options.wardGroups.forEach((g) => {
    const og = document.createElement('optgroup');
    og.label = g.oldDistrict;
    g.wards.forEach((w) => og.append(new Option(w, w)));
    sel.append(og);
  });
  form.budget.addEventListener('input', () => {
    const digits = form.budget.value.replace(/\D/g, '');
    form.budget.value = digits ? Number(digits).toLocaleString('en-US') : '';
    budgetHint();
  });
  form.images.addEventListener('change', () => {
    const files = [...form.images.files].slice(0, 3);
    if (form.images.files.length > 3) toast('You can upload up to 3 task images');
    $('#thumbs').innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}" alt="" />`).join('');
    form.dataset.imageCount = files.length;
  });
  $$('[data-sample]').forEach((b) => b.addEventListener('click', () => fillSample(SAMPLES[b.dataset.sample])));
  $('#checkBtn').addEventListener('click', () => submit(false));
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(true); });
  const d = new Date(Date.now() + 3 * 864e5);
  form.deadline.value = toLocalInput(d);
}

function selectCategory(v) {
  $$('.cat').forEach((el) => {
    el.classList.toggle('sel', el.dataset.value === v);
    $('input', el).checked = el.dataset.value === v;
  });
  budgetHint();
}

function budgetHint() {
  const cat = form.querySelector('input[name=category]:checked')?.value;
  const min = cat && options.categoryMinBudgetVnd[cat];
  $('#budgetHint').textContent = min ? `Typical minimum for this category: ${fmtVnd(min)}` : '';
}

const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

function fillSample(s) {
  form.title.value = s.title;
  form.description.value = s.description;
  selectCategory(s.category);
  form.district.value = s.district;
  form.streetName.value = s.streetName;
  form.budget.value = s.budget.toLocaleString('en-US');
  form.maxBids.value = 30;
  form.deadline.value = toLocalInput(new Date(Date.now() + s.days * 864e5));
  form.querySelector(`input[name=urgency][value=${s.urgency}]`).checked = true;
  form.dataset.imageCount = s.images;
  $('#thumbs').innerHTML = s.images ? `<span class="muted" style="font-size:13px">${s.images} sample image(s) attached</span>` : '';
  budgetHint();
  submit(false);
}

function payload() {
  const deadline = form.deadline.value ? new Date(form.deadline.value).toISOString() : null;
  return {
    title: form.title.value.trim(),
    description: form.description.value.trim(),
    category: form.querySelector('input[name=category]:checked')?.value,
    district: form.district.value,
    streetName: form.streetName.value.trim(),
    budget: Number(form.budget.value.replace(/\D/g, '')) || 0,
    maxBids: Number(form.maxBids.value) || 30,
    deadline,
    urgency: form.querySelector('input[name=urgency]:checked').value,
    imageCount: Number(form.dataset.imageCount || 0),
  };
}

function clientErrors(p) {
  const errs = [];
  if (p.title.length < 5) errs.push('Title must be at least 5 characters');
  if (p.description.length < 10) errs.push('Description must be at least 10 characters');
  if (!p.category) errs.push('Category is required');
  if (!p.district) errs.push('District is required');
  if (p.streetName.length < 3) errs.push('Street address is required');
  if (!p.budget) errs.push('Budget is required');
  return errs;
}

async function submit(post) {
  const p = payload();
  const err = $('#formError');
  const errs = clientErrors(p);
  if (errs.length) { err.textContent = errs.join(' · '); err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  const buttons = $$('.actions button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    if (post) {
      const t = await api('/api/tasks', { method: 'POST', body: JSON.stringify(p) });
      showResult(t.assessment);
      const msg = { OPEN: 'Task posted and live', PENDING_REVIEW: 'Task held for admin review', BLOCKED: 'Task blocked by Fraud AI' }[t.status];
      toast(`#${t.id}: ${msg}`);
      refreshReviewCount();
    } else {
      showResult(await api('/api/validate', { method: 'POST', body: JSON.stringify(p) }));
    }
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

function showResult(a) {
  $('#resultEmpty').classList.add('hidden');
  $('#resultBody').classList.remove('hidden');
  $('#gaugeFill').style.width = `${Math.round(a.fraudScore * 100)}%`;
  $('#score').textContent = `${(a.fraudScore * 100).toFixed(1)}%`;
  const d = $('#decision');
  d.textContent = a.decision.replace('_', ' ');
  d.className = `badge b-${a.decision}`;
  $('#outcome').textContent = OUTCOME[a.decision];
  $('#reasons').innerHTML = a.reasons.length ? a.reasons.map((r) => `<li>${esc(r)}</li>`).join('') : '<li class="muted">No risk signals found</li>';
  $('#ruleScore').textContent = a.ruleScore;
  $('#riskLevel').textContent = a.riskLevel || 'none';
  $('#engineUsed').textContent = `${a.engine}${a.modelVersion ? ` · v${a.modelVersion}` : ''}`;
}

// ---------- lists ----------
function taskCard(t, admin) {
  const x = t.task;
  const a = t.assessment;
  const deadline = x.deadline ? new Date(x.deadline).toLocaleString() : '-';
  return `<div class="item">
    <h3>${esc(x.title)}</h3><span class="badge b-${t.status}">${t.status.replace('_', ' ')}</span>
    <p>${esc(x.description)}</p>
    <div class="facts"><span>${CAT_LABEL[x.category] || x.category}</span><span>📍 ${esc(x.district)}, ${esc(x.oldDistrict)}</span>
      <span>💰 ${fmtVnd(x.budget)}</span><span>⏰ ${deadline}</span><span>${x.urgency}</span><span>🖼 ${x.imageCount}</span>
      <span>AI score ${(a.fraudScore * 100).toFixed(1)}%</span>${t.reviewAction ? `<span>admin: ${t.reviewAction}</span>` : ''}</div>
    ${admin && a.reasons.length ? `<div class="why">⚠ ${a.reasons.map(esc).join(' · ')}</div>` : ''}
    ${admin && ['PENDING_REVIEW', 'BLOCKED'].includes(t.status) ? `<div class="btns">
      <button class="btn-bad" data-review="${t.id}" data-action="reject">Reject</button>
      <button class="btn-ok" data-review="${t.id}" data-action="approve">Approve &amp; publish</button></div>` : ''}
  </div>`;
}

async function loadFeed() {
  const tasks = await api('/api/tasks?status=OPEN');
  $('#feed').innerHTML = tasks.length ? tasks.map((t) => taskCard(t, false)).join('') : '<div class="empty">No open tasks yet - post one!</div>';
}

let queueStatus = 'PENDING_REVIEW';
$$('.filters button').forEach((b) => b.addEventListener('click', () => {
  queueStatus = b.dataset.status;
  $$('.filters button').forEach((x) => x.classList.toggle('active', x === b));
  loadQueue();
}));
async function loadQueue() {
  const tasks = await api(`/api/tasks?status=${queueStatus}`);
  $('#queue').innerHTML = tasks.length ? tasks.map((t) => taskCard(t, true)).join('') : '<div class="empty">Nothing here.</div>';
  $$('[data-review]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/tasks/${b.dataset.review}/review`, { method: 'POST', body: JSON.stringify({ action: b.dataset.action }) });
    toast(`Task #${b.dataset.review} ${b.dataset.action}d`);
    loadQueue();
    refreshReviewCount();
  }));
}

async function refreshReviewCount() {
  const n = (await api('/api/tasks?status=PENDING_REVIEW')).length;
  const pill = $('#reviewCount');
  pill.textContent = n;
  pill.classList.toggle('hidden', n === 0);
}

// ---------- model ----------
function renderModel() {
  if (!model || !model.test_metrics) {
    $('#modelStats').innerHTML = '<div class="empty">No trained model found - the API is running the rule-based fallback. Run <code>python -m ai.train</code>.</div>';
    return;
  }
  const m = model.test_metrics;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const stats = [
    ['Selected model', model.model_name.split(' (')[0]], ['PR-AUC', m.pr_auc.toFixed(3)], ['ROC-AUC', m.roc_auc.toFixed(3)],
    ['Precision', pct(m.precision)], ['Recall', pct(m.recall)], ['F1', m.f1.toFixed(3)], ['False-positive rate', pct(m.false_positive_rate)],
    ['Latency', `${model.latency_ms_single_task.toFixed(1)} ms`],
  ];
  $('#modelStats').innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const rows = [[model.model_name, m, true], ...Object.entries(model.baseline_test_metrics).map(([k, v]) => [k, v, false])];
  $('#baselineTable').innerHTML = `<table><thead><tr><th>Model</th><th class="num">PR-AUC</th><th class="num">Precision</th><th class="num">Recall</th><th class="num">F1</th><th class="num">FPR</th></tr></thead><tbody>
    ${rows.map(([n, v, s]) => `<tr class="${s ? 'sel' : ''}"><td>${esc(n)}${s ? ' (selected)' : ''}</td><td class="num">${v.pr_auc.toFixed(3)}</td><td class="num">${pct(v.precision)}</td>
      <td class="num">${pct(v.recall)}</td><td class="num">${v.f1.toFixed(3)}</td><td class="num">${pct(v.false_positive_rate)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- boot ----------
(async function init() {
  [options, model] = await Promise.all([api('/api/options'), api('/api/model')]);
  $('#engine').textContent = model.engine === 'ml+rules' ? `AI engine: ML + rules · v${model.version}` : 'AI engine: rule-based fallback';
  const t = model.thresholds || {};
  if (t.needs_review != null) {
    $('#markReview').style.left = `${t.needs_review * 100}%`;
    $('#markBlock').style.left = `${Math.min(t.blocked, 1) * 100}%`;
  }
  buildForm();
  refreshReviewCount();
})();
