/* ============================================================
   Fiches — Frontend (abonnement + génération IA)
   ============================================================ */
(function () {
  'use strict';

  // API sur la même origine (backend et frontend servis par le même service).
  const API = '';

  // Identifiant visiteur : généré une fois, conservé dans le navigateur.
  function getVisitorId() {
    let id = localStorage.getItem('fiches_visitor_id');
    if (!id) {
      id = 'v' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('fiches_visitor_id', id);
    }
    return id;
  }
  const VISITOR_ID = getVisitorId();

  const $ = (id) => document.getElementById(id);

  // ---------- API helpers ----------
  async function api(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': VISITOR_ID },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (data && data.detail) || `Erreur ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  // ---------- State ----------
  let fiches = [];
  let currentId = null;
  let plans = {};

  // ---------- Elements ----------
  const paywall = $('paywall');
  const app = $('app');
  const pricingEl = $('pricing');
  const planBadge = $('plan-badge');
  const listEl = $('fiche-list');
  const listEmpty = $('list-empty');
  const titleInput = $('fiche-title');
  const subjectInput = $('fiche-subject');
  const editor = $('editor');
  const preview = $('preview');
  const previewPane = $('preview-pane');
  const genSubject = $('gen-subject');
  const genMatiere = $('gen-matiere');
  const genNiveau = $('gen-niveau');
  const btnGenerate = $('btn-generate');
  const btnGenNew = $('btn-generate-new');

  // ---------- Markdown-lite parser ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
    return s;
  }
  function parseQA(line) {
    const m = line.match(/^(.+?\?)\s+(.+)$/);
    if (m) return { q: m[1].trim(), a: m[2].trim() };
    return null;
  }
  function render(text) {
    if (!text || !text.trim()) {
      return '<p class="preview-empty">Génère une fiche depuis un sujet, ou écris tes notes ci-contre.</p>';
    }
    const lines = text.split('\n');
    let html = '';
    let inUl = false;
    const flushUl = () => { if (inUl) { html += '</ul>'; inUl = false; } };

    for (let raw of lines) {
      const line = raw.trimEnd();
      const trimmed = line.trim();
      if (trimmed === '') { flushUl(); continue; }
      if (/^##\s+/.test(trimmed)) { flushUl(); html += `<h3>${inline(trimmed.replace(/^##\s+/, ''))}</h3>`; continue; }
      if (/^#\s+/.test(trimmed)) { flushUl(); html += `<h2>${inline(trimmed.replace(/^#\s+/, ''))}</h2>`; continue; }
      if (/^[-*]\s+/.test(trimmed)) {
        if (!inUl) { html += '<ul>'; inUl = true; }
        html += `<li>${inline(trimmed.replace(/^[-*]\s+/, ''))}</li>`;
        continue;
      }
      flushUl();
      const qa = parseQA(trimmed);
      if (qa) { html += `<div class="qa"><p class="q">${inline(qa.q)}</p><p class="a">${inline(qa.a)}</p></div>`; continue; }
      const def = trimmed.match(/^([^:]{1,40}?)\s*:\s+(.+)$/);
      if (def) { html += `<dl class="definition"><dt>${inline(def[1].trim())}</dt><dd>${inline(def[2].trim())}</dd></dl>`; continue; }
      html += `<p>${inline(trimmed)}</p>`;
    }
    flushUl();
    return html;
  }

  function renderPreview() {
    const f = current();
    const body = render(editor.value);
    preview.innerHTML = `
      <header class="fiche-head">
        ${f && f.subject_area ? `<span class="fiche-subject-tag">${escapeHtml(f.subject_area)}</span>` : ''}
        <h1 class="fiche-title">${f && f.title ? escapeHtml(f.title) : '<span style="color:var(--color-text-faint)">Sans titre</span>'}</h1>
      </header>
      <div class="fiche-body">${body}</div>`;
  }

  // ---------- Current fiche ----------
  function current() { return fiches.find((f) => f.id === currentId) || null; }

  function selectFiche(id) {
    currentId = id;
    const f = current();
    if (!f) return;
    titleInput.value = f.title || '';
    subjectInput.value = f.subject_area || '';
    editor.value = f.content || '';
    editor.scrollTop = 0;
    editor.setSelectionRange(0, 0);
    renderList();
    renderPreview();
  }

  function newBlankFiche() {
    const f = { id: null, title: '', subject_area: '', content: '', updated: Date.now() / 1000 };
    fiches.unshift(f);
    currentId = null;
    titleInput.value = ''; subjectInput.value = ''; editor.value = '';
    renderPreview();
    renderList();
    titleInput.focus();
    return f;
  }

  // ---------- List ----------
  function renderList() {
    if (!fiches.length) {
      listEl.innerHTML = '';
      listEmpty.style.display = 'block';
      return;
    }
    listEmpty.style.display = 'none';
    listEl.innerHTML = fiches
      .map((f) => {
        const d = f.updated ? new Date(f.updated * 1000) : null;
        const dateStr = d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
        return `<li class="fiche-item ${f.id === currentId ? 'active' : ''}" data-id="${f.id || ''}" role="button" tabindex="0">
          <span class="fiche-item-title">${escapeHtml(f.title || 'Sans titre')}</span>
          <span class="fiche-item-meta">${escapeHtml(f.subject_area || '—')} · ${dateStr}</span>
        </li>`;
      })
      .join('');
  }

  // ---------- Persist (debounced) ----------
  let saveTimer = null;
  function scheduleSave() {
    const f = current();
    if (!f) return;
    f.title = titleInput.value;
    f.subject_area = subjectInput.value;
    f.content = editor.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const saved = await api('POST', '/api/fiches', { id: f.id || undefined, title: f.title, subject_area: f.subject_area, content: f.content });
        if (!f.id && saved.id) {
          f.id = saved.id;
          f.updated = saved.updated;
          currentId = saved.id;
        } else {
          f.updated = saved.updated;
        }
        renderList();
      } catch (e) { /* ignore transient */ }
    }, 500);
  }

  // ---------- Generate ----------
  function setLoading(on) {
    btnGenerate.classList.toggle('loading', on);
    if (on) {
      btnGenerate.innerHTML = '<span class="spinner"></span><span class="btn-label">Génération…</span>';
      previewPane.classList.add('generating');
    } else {
      btnGenerate.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg><span class="btn-label">Générer</span>';
      previewPane.classList.remove('generating');
    }
  }

  async function generateFiche() {
    const subject = genSubject.value.trim();
    if (!subject) { genSubject.focus(); return; }
    setLoading(true);
    try {
      const out = await api('POST', '/api/generate', {
        subject,
        subject_area: genMatiere.value.trim() || undefined,
        niveau: genNiveau.value,
      });
      // Persist as a new fiche
      const saved = await api('POST', '/api/fiches', { title: out.title, subject_area: out.subject_area, content: out.content });
      const f = { id: saved.id, title: saved.title, subject_area: saved.subject_area, content: saved.content, updated: saved.updated };
      // Remove any blank pending fiche at top
      fiches = fiches.filter((x) => x.id);
      fiches.unshift(f);
      currentId = f.id;
      titleInput.value = f.title;
      subjectInput.value = f.subject_area;
      editor.value = f.content;
      editor.scrollTop = 0;
      renderList();
      renderPreview();
      genSubject.value = '';
    } catch (e) {
      alert('Génération impossible : ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Delete ----------
  async function deleteCurrent() {
    const f = current();
    if (!f) return;
    if (!confirm(`Supprimer la fiche « ${f.title || 'Sans titre'} » ?`)) return;
    if (f.id) {
      try { await api('DELETE', `/api/fiches/${f.id}`); } catch (e) {}
    }
    fiches = fiches.filter((x) => x.id !== f.id);
    currentId = fiches.length ? fiches[0].id : null;
    if (currentId) selectFiche(currentId);
    else { titleInput.value = ''; subjectInput.value = ''; editor.value = ''; renderList(); renderPreview(); }
    renderList();
  }

  // ---------- Flashcards / review ----------
  function buildCards(text) {
    const cards = [];
    for (let raw of (text || '').split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const qa = parseQA(t);
      if (qa) { cards.push({ front: qa.q, back: qa.a }); continue; }
      const def = t.match(/^([^:]{1,40}?)\s*:\s+(.+)$/);
      if (def) { cards.push({ front: def[1].trim(), back: def[2].trim() }); continue; }
    }
    return cards;
  }
  const modal = $('review-modal');
  const reviewBody = $('review-body');
  const reviewCounter = $('review-counter');
  let cards = [], cardIdx = 0, cardFlipped = false;

  function openReview() {
    cards = buildCards(editor.value);
    cardIdx = 0; cardFlipped = false;
    if (!cards.length) {
      reviewBody.innerHTML = '<p class="review-empty">Aucune carte trouvée.<br>Ajoute des lignes « Terme : définition » ou « Question ? Réponse ».</p>';
      reviewCounter.textContent = '';
      $('review-prev').style.display = 'none'; $('review-next').style.display = 'none';
    } else {
      $('review-prev').style.display = ''; $('review-next').style.display = '';
      renderCard();
    }
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
  }
  function closeReview() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
  function renderCard() {
    const c = cards[cardIdx];
    reviewBody.innerHTML = `<div class="flashcard" id="flashcard" role="button" tabindex="0" aria-label="Carte — cliquer pour retourner">
      <span class="flashcard-hint">${cardFlipped ? 'Réponse' : 'Question'} · clique pour retourner</span>
      <span class="flashcard-text ${cardFlipped ? 'answer' : ''}">${escapeHtml(cardFlipped ? c.back : c.front)}</span>
      <span class="flashcard-flip">${cardIdx + 1} / ${cards.length}</span></div>`;
    reviewCounter.textContent = `Carte ${cardIdx + 1} sur ${cards.length}`;
    const fc = $('flashcard');
    fc.addEventListener('click', flipCard);
    fc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); } });
  }
  function flipCard() { cardFlipped = !cardFlipped; renderCard(); }
  function nextCard() { if (!cards.length) return; cardIdx = (cardIdx + 1) % cards.length; cardFlipped = false; renderCard(); }
  function prevCard() { if (!cards.length) return; cardIdx = (cardIdx - 1 + cards.length) % cards.length; cardFlipped = false; renderCard(); }

  // ---------- Paywall ----------
  function renderPaywall() {
    const order = ['decouverte', 'pro', 'premium'];
    pricingEl.innerHTML = order.map((key) => {
      const p = plans[key];
      const featured = key === 'pro' ? ' featured' : '';
      const gens = p.generations;
      return `<div class="plan-card${featured}">
        <div class="plan-name">${p.name}</div>
        <div class="plan-price">${p.price}<span class="period"> ${p.period}</span></div>
        <div class="plan-desc">${gens} générations par mois · Fiches illimitées · Mode révision inclus</div>
        <button class="btn btn-primary plan-cta" data-plan="${key}">S'abonner</button>
      </div>`;
    }).join('');
    pricingEl.querySelectorAll('[data-plan]').forEach((b) =>
      b.addEventListener('click', () => subscribe(b.dataset.plan))
    );
  }

  async function subscribe(plan) {
    try {
      const r = await api('POST', '/api/subscribe', { plan });
      await enterApp(r.plan);
    } catch (e) {
      alert('Abonnement impossible : ' + e.message);
    }
  }

  async function enterApp(plan) {
    if (planBadge) {
      planBadge.textContent = plans[plan] ? plans[plan].name : plan;
      planBadge.hidden = false;
    }
    paywall.hidden = true;
    app.hidden = false;
    try {
      fiches = await api('GET', '/api/fiches');
    } catch (e) { fiches = []; }
    if (!fiches.length) {
      // start with a blank editable fiche
      fiches = [{ id: null, title: '', subject_area: '', content: '', updated: 0 }];
    }
    currentId = fiches[0].id;
    selectFiche(currentId);
    genSubject.focus();
  }

  // ---------- Wire events ----------
  btnGenerate.addEventListener('click', generateFiche);
  btnGenNew.addEventListener('click', () => { genSubject.focus(); genSubject.scrollIntoView({ block: 'nearest' }); });
  $('btn-delete').addEventListener('click', deleteCurrent);
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-review').addEventListener('click', openReview);
  $('review-next').addEventListener('click', nextCard);
  $('review-prev').addEventListener('click', prevCard);
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeReview));
  [titleInput, subjectInput, editor].forEach((el) => el.addEventListener('input', () => { scheduleSave(); renderPreview(); }));
  listEl.addEventListener('click', (e) => { const it = e.target.closest('.fiche-item'); if (it && it.dataset.id) selectFiche(it.dataset.id); });
  genSubject.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); generateFiche(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeReview();
    if (modal.classList.contains('open')) {
      if (e.key === 'ArrowRight') nextCard();
      if (e.key === 'ArrowLeft') prevCard();
    }
  });

  // ---------- Theme toggle ----------
  (function () {
    const t = document.querySelector('[data-theme-toggle]');
    const r = document.documentElement;
    let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    r.setAttribute('data-theme', d);
    function paint() {
      t.innerHTML = d === 'dark'
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      t.setAttribute('aria-label', 'Passer en mode ' + (d === 'dark' ? 'clair' : 'sombre'));
    }
    paint();
    t.addEventListener('click', () => { d = d === 'dark' ? 'light' : 'dark'; r.setAttribute('data-theme', d); paint(); });
  })();

  // ---------- Init ----------
  (async function init() {
    try {
      const me = await api('GET', '/api/me');
      plans = me.plans || {};
      if (me.subscribed) { await enterApp(me.plan); }
      else { renderPaywall(); paywall.hidden = false; app.hidden = true; }
    } catch (e) {
      // If backend unreachable, show paywall so the user sees something.
      plans = {
        decouverte: { name: 'Découverte', price: '0,99 €', period: '/ mois', generations: 10 },
        pro: { name: 'Pro', price: '4,99 €', period: '/ mois', generations: 100 },
        premium: { name: 'Premium', price: '9,99 €', period: '/ mois', generations: 1000 },
      };
      renderPaywall();
      paywall.hidden = false;
    }
  })();
})();
