let services = [];
let logs = [];

// Auth Check
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/login.html';
}

async function fetchWithAuth(url, options = {}) {
  const headers = options.headers || {};
  headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  return res;
}

const el = {
  servicesList: document.getElementById('servicesList'),
  logsList: document.getElementById('logsList'),
  statusFilter: document.getElementById('statusFilter'),
  categoryFilter: document.getElementById('categoryFilter'),
  searchInput: document.getElementById('searchInput'),
  logLevelFilter: document.getElementById('logLevelFilter'),
  logServiceFilter: document.getElementById('logServiceFilter'),
  nextCheck: document.getElementById('nextCheck'),
  filtersToggle: document.getElementById('filtersToggle'),
  headerControls: document.getElementById('headerControls'),
};

function renderServices() {
  const query = el.searchInput.value.toLowerCase();
  const status = el.statusFilter.value;
  const category = el.categoryFilter.value;

  const filtered = services.filter(s => {
    const matchText = s.name.toLowerCase().includes(query);
    const matchStatus = !status || s.status === status;
    const matchCategory = !category || s.category === category;
    return matchText && matchStatus && matchCategory;
  });

  el.servicesList.innerHTML = filtered.map(s => serviceCard(s)).join('');
}

function serviceCard(s) {
  const statusCls = s.status === 'up' ? 'status-up'
                  : s.status === 'degraded' ? 'status-degraded'
                  : 'status-down';
  const since = timeAgo(s.lastChecked);
  return `
    <div class="card">
      <div class="name">${s.name}</div>
      <div class="meta">Category: ${capitalize(s.category)} ${s.vendor ? ' • Vendor: ' + s.vendor : s.location ? ' • Location: ' + s.location : ''}</div>
      <div class="status-pill ${statusCls}">
        <span>${capitalize(s.status)}</span>
        <span>•</span>
        <span>Checked ${since}</span>
      </div>
    </div>
  `;
}

function renderLogs() {
  const level = el.logLevelFilter.value;
  const service = el.logServiceFilter.value;
  const filtered = logs.filter(l => {
    // Normalization
    if (!l.level) l.level = (l.status === 'down' || l.status === 'error') ? 'error' : (l.status === 'degraded' ? 'warn' : 'info');
    if (!l.service) l.service = (l.services && l.services[0] && l.services[0].name) ? l.services[0].name : 'System';
    if (!l.message) l.message = (l.level === 'error') ? 'Health check failed or timeout' : (l.level === 'warn' ? 'Service responding slowly or partially degraded' : 'Health check OK');
    if (!l.timestamp) l.timestamp = Date.now();

    const matchLevel = !level || l.level === level;
    const matchService = !service || l.service === service;
    return matchLevel && matchService;
  }).sort((a, b) => b.timestamp - a.timestamp);

  el.logsList.innerHTML = filtered.map(l => logItem(l)).join('');
}

function logItem(l) {
  const levelCls = l.level === 'info' ? 'badge-info'
                 : l.level === 'warn' ? 'badge-warn'
                 : 'badge-error';
  return `
    <div class="log-item">
      <div class="log-top">
        <div class="log-badges">
          <span class="badge ${levelCls}">${l.level}</span>
          <span class="log-service">${l.service}</span>
        </div>
        <div class="log-meta">${new Date(l.timestamp).toLocaleString()}</div>
      </div>
      <div class="log-message">${l.message}</div>
    </div>
  `;
}

function populateLogServiceFilter() {
  const servicesNames = Array.from(new Set(logs.map(l => l.service)));
  el.logServiceFilter.innerHTML = `<option value="">All Services</option>` +
    servicesNames.map(n => `<option value="${n}">${n}</option>`).join('');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m ago`;
}
function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }

function startCountdown() {
  const target = Date.now() + 60_000;
  const tick = () => {
    const remaining = target - Date.now();
    if (remaining <= 0) {
      el.nextCheck.textContent = 'Next check in: 0s (demo)';
      return;
    }
    const s = Math.ceil(remaining / 1000);
    el.nextCheck.textContent = `Next check in: ${s}s (demo)`;
    requestAnimationFrame(tick);
  };
  tick();
}

el.searchInput.addEventListener('input', renderServices);
el.statusFilter.addEventListener('change', renderServices);
el.categoryFilter.addEventListener('change', renderServices);
el.logLevelFilter.addEventListener('change', renderLogs);
el.logServiceFilter.addEventListener('change', renderLogs);

async function loadInitial() {
  const re = await fetchWithAuth('/api/recheck').then(r => r.json()).catch(() => null);
  services = (re && re.services) ? re.services.map(s => ({
    name: s.name,
    category: s.category || 'internal',
    status: s.status,
    lastChecked: Date.now(),
    location: s.category === 'internal' ? (s.location || 'eu-west-1') : undefined,
    vendor: s.category === 'external' ? (s.vendor || s.name) : undefined
  })) : [];
  const l = await fetchWithAuth('/api/logs').then(r => r.json());
  logs = l.logs || [];
  populateLogServiceFilter();
  renderServices();
  renderLogs();
}
function subscribeEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === 'service_update') {
      const idx = services.findIndex(x => x.name === data.service.name);
      if (idx >= 0) services[idx] = data.service; else services.push(data.service);
      renderServices();
    } else if (data.type === 'log_new') {
      logs.unshift(data.log);
      populateLogServiceFilter();
      renderLogs();
    }
  };
}
loadInitial();
// subscribeEvents(); // disabled: rely on on-demand checks suitable for serverless
startCountdown();
const recheckBtn = document.getElementById('recheckBtn');
if (recheckBtn) {
  recheckBtn.addEventListener('click', async () => {
    recheckBtn.disabled = true;
    try {
      const re = await fetchWithAuth('/api/recheck').then(r => r.json());
      if (re && re.services) {
        services = re.services.map(s => ({
          name: s.name,
          category: s.category || 'internal',
          status: s.status,
          lastChecked: Date.now(),
          location: s.category === 'internal' ? (s.location || 'eu-west-1') : undefined,
          vendor: s.category === 'external' ? (s.vendor || s.name) : undefined
        }));
        renderServices();
        const l = await fetchWithAuth('/api/logs').then(r => r.json());
        logs = l.logs || [];
        populateLogServiceFilter();
        renderLogs();
      }
    } finally {
      recheckBtn.disabled = false;
    }
  });
}
if (el.filtersToggle && el.headerControls) {
  el.filtersToggle.addEventListener('click', () => {
    const isShown = el.headerControls.classList.toggle('show');
    el.filtersToggle.setAttribute('aria-expanded', String(isShown));
  });
}
