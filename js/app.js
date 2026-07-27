import { categories, nationalResources, quickQuestions } from '../data/resources.js';

const state = {
  location: localStorage.getItem('bridgeaid-location') || '',
  category: 'all',
  chatOpen: false
};

const app = document.querySelector('#app');
const esc = value => String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function mapsUrl(query) {
  const where = state.location ? ` near ${state.location}` : ' near me';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query + where)}`;
}

function webSearchUrl(query, site = '') {
  const where = state.location ? ` ${state.location}` : ' near me';
  const prefix = site ? `site:${site} ` : '';
  return `https://www.google.com/search?q=${encodeURIComponent(prefix + query + where)}`;
}

function resourceUrl(resource) {
  if (resource.mapQuery) return mapsUrl(resource.mapQuery);
  return resource.url;
}

function filteredResources() {
  return nationalResources.filter(r => state.category === 'all' || r.category === 'all' || r.category === state.category);
}

function render() {
  const active = categories.find(c => c.id === state.category);
  app.innerHTML = `
    <header class="topbar">
      <nav class="wrap nav" aria-label="Main">
        <button class="brand" data-home>BridgeAid</button>
        <div class="nav-actions">
          <a class="small-btn" href="tel:211">☎ <span class="label">Call </span>211</a>
          <button class="small-btn" data-location>📍 <span class="label">Location</span></button>
        </div>
      </nav>
    </header>

    <main id="main">
      <section class="hero wrap">
        <h1>Find help now.</h1>
        <p>Free help across the U.S.</p>
        <form class="location-box" id="locationForm">
          <input id="locationInput" aria-label="City or ZIP code" placeholder="City or ZIP" value="${esc(state.location)}">
          <button type="button" class="secondary" id="useLocation" aria-label="Use current location">◎ Use GPS</button>
          <button class="primary" type="submit">Search</button>
        </form>
        <div class="emergency">
          <a class="danger" href="tel:911">Emergency: 911</a>
          <a href="tel:988">Crisis: 988</a>
          <a href="tel:211">Local help: 211</a>
        </div>
      </section>

      <section class="section wrap" aria-labelledby="need-title">
        <div class="section-head"><h2 id="need-title">What do you need?</h2></div>
        <div class="category-grid">
          ${categories.map(c => `
            <button class="category ${state.category === c.id ? 'active' : ''}" data-category="${c.id}">
              <span>${c.icon}</span>${c.label}
            </button>`).join('')}
        </div>
      </section>

      <section class="section wrap" aria-labelledby="help-title">
        <div class="section-head">
          <div><h2 id="help-title">${active ? active.label : 'Help'} resources</h2><div class="muted">${state.location ? esc(state.location) : 'Enter a location for nearby results'}</div></div>
        </div>
        <div class="controls">
          <button class="pill ${state.category === 'all' ? 'active' : ''}" data-category="all">All</button>
          ${active ? `<a class="pill" target="_blank" rel="noopener" href="${mapsUrl(active.query)}">Nearby map ↗</a>` : ''}
        </div>
        <div class="resource-list">
          ${filteredResources().map(r => `
            <article class="resource-card">
              <span class="tag">${r.category === 'all' ? 'Many needs' : r.category}</span>
              <h3>${esc(r.name)}</h3>
              <p>${esc(r.short)}</p>
              <div class="card-actions">
                <a class="primary" target="_blank" rel="noopener" href="${resourceUrl(r)}">${esc(r.action)} ↗</a>
                ${r.phone ? `<a class="secondary" href="tel:${r.phone.replace(/[^\d+]/g, '')}">Call</a>` : ''}
              </div>
            </article>`).join('')}
        </div>
      </section>

      <section class="section wrap">
        <div class="web-help">
          <h2>More online help</h2>
          <div>Live searches for local posts, videos, and programs.</div>
          <div class="web-links">
            <a target="_blank" rel="noopener" href="${webSearchUrl((active?.query || 'free help resources') + ' nonprofit government')}">Web results ↗</a>
            <a target="_blank" rel="noopener" href="${webSearchUrl(active?.query || 'free help resources', 'youtube.com')}">Videos ↗</a>
            <a target="_blank" rel="noopener" href="${webSearchUrl((active?.query || 'free help resources') + ' community recommendation', 'reddit.com')}">Community posts ↗</a>
            <a target="_blank" rel="noopener" href="${webSearchUrl(active?.query || 'free help resources', '.gov')}">Government ↗</a>
          </div>
        </div>
      </section>
    </main>

    <button class="ai-button" id="aiButton" aria-label="Open BridgeAI" aria-expanded="${state.chatOpen}">💬</button>
    ${chatMarkup()}
    <div id="toast" class="toast hidden" role="status"></div>
  `;
  bind();
}

function chatMarkup() {
  return `
    <aside class="chat ${state.chatOpen ? '' : 'hidden'}" id="chat" role="dialog" aria-label="BridgeAI">
      <div class="chat-head"><strong>BridgeAI</strong><button id="closeChat" aria-label="Close">×</button></div>
      <div class="messages" id="messages">
        <div class="msg bot">What help do you need?</div>
      </div>
      <div class="quick">${quickQuestions.map(q => `<button data-question="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="chat-form" id="chatForm">
        <input id="chatInput" aria-label="Message" placeholder="Food, shelter, clinic…" required>
        <button class="primary">Send</button>
      </form>
    </aside>`;
}

function bind() {
  document.querySelector('[data-home]').onclick = () => { state.category = 'all'; window.scrollTo({top: 0, behavior: 'smooth'}); render(); };
  document.querySelector('[data-location]').onclick = () => document.querySelector('#locationInput').focus();

  document.querySelectorAll('[data-category]').forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      render();
      document.querySelector('#help-title')?.scrollIntoView({behavior: 'smooth', block: 'start'});
    };
  });

  document.querySelector('#locationForm').onsubmit = event => {
    event.preventDefault();
    setLocation(document.querySelector('#locationInput').value.trim());
  };

  document.querySelector('#useLocation').onclick = useGPS;
  document.querySelector('#aiButton').onclick = () => { state.chatOpen = !state.chatOpen; render(); if (state.chatOpen) document.querySelector('#chatInput')?.focus(); };
  document.querySelector('#closeChat')?.addEventListener('click', () => { state.chatOpen = false; render(); });
  document.querySelectorAll('[data-question]').forEach(button => button.onclick = () => answer(button.dataset.question));
  document.querySelector('#chatForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const input = document.querySelector('#chatInput');
    answer(input.value);
    input.value = '';
  });
}

function setLocation(value) {
  state.location = value;
  localStorage.setItem('bridgeaid-location', value);
  render();
  showToast(value ? `Location: ${value}` : 'Location cleared');
}

function useGPS() {
  if (!navigator.geolocation) return showToast('GPS is not available');
  showToast('Getting location…');
  navigator.geolocation.getCurrentPosition(
    pos => setLocation(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`),
    () => showToast('GPS blocked. Enter a city or ZIP.'),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}

function answer(question) {
  const messages = document.querySelector('#messages');
  if (!messages) return;
  const safe = esc(question);
  messages.insertAdjacentHTML('beforeend', `<div class="msg user">${safe}</div>`);
  const text = question.toLowerCase();

  if (/211/.test(text)) {
    messages.insertAdjacentHTML('beforeend', `<div class="msg bot">Call <a href="tel:211"><strong>211</strong></a> for local help.</div>`);
  } else {
    const category = categories.find(c => text.includes(c.label.toLowerCase()) || text.includes(c.id) || c.query.split(' ').some(word => word.length > 4 && text.includes(word)));
    const query = category?.query || question;
    const label = category?.label || 'help';
    messages.insertAdjacentHTML('beforeend', `
      <div class="msg bot">
        <strong>${esc(label)}</strong><br>
        <a target="_blank" rel="noopener" href="${mapsUrl(query)}">See nearby places ↗</a><br>
        <a target="_blank" rel="noopener" href="${webSearchUrl(query)}">Search more help ↗</a>
      </div>`);
  }
  messages.scrollTop = messages.scrollHeight;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

render();
