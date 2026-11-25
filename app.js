'use strict';

/*
 * Jelastic Control — PWA pour démarrer/arrêter les environnements Jelastic.
 *
 * API REST Jelastic 1.0 (https://docs.jelastic.com/api/) :
 *   POST {host}/1.0/users/authentication/rest/signin   login, password -> session
 *   POST {host}/1.0/environment/control/rest/getenvs   session         -> infos[]
 *   POST {host}/1.0/environment/control/rest/startenv  session, envName
 *   POST {host}/1.0/environment/control/rest/stopenv   session, envName
 *
 * Les appels sont des POST application/x-www-form-urlencoded : des requêtes
 * « simples » au sens CORS, donc sans pré-vol OPTIONS.
 */

const STORAGE_KEY = 'jelastic-control:v1';
const DEFAULT_HOST = 'https://app.jpc.infomaniak.com';
const POLL_MS = 5000;
const POLL_MAX = 60; // 5 min max de suivi après une action

// Statuts d'environnement Jelastic (ENV_STATUS_TYPE_*)
const STATUS = {
  1: { label: 'En marche', cls: 's-running' },
  2: { label: 'Arrêté', cls: 's-down' },
  3: { label: 'Démarrage…', cls: 's-transit' },
  4: { label: 'En veille', cls: 's-down' },
  6: { label: 'Création…', cls: 's-transit' },
  7: { label: 'Clonage…', cls: 's-transit' },
  9: { label: 'Export…', cls: 's-transit' },
  10: { label: 'Migration…', cls: 's-transit' },
  11: { label: 'En panne', cls: 's-broken' },
  12: { label: 'Mise à jour…', cls: 's-transit' },
  13: { label: 'Arrêt…', cls: 's-transit' },
  14: { label: 'Mise en veille…', cls: 's-transit' },
  15: { label: 'Restauration…', cls: 's-transit' },
};
const RUNNING = 1;
const STARTABLE = new Set([2, 4, 11]);

const $ = (sel) => document.querySelector(sel);

const state = {
  cfg: loadCfg(),
  envs: [],
  busy: new Set(), // envName en cours d'action
  pollTimer: null,
  pollCount: 0,
};

/* ---------- Stockage local (propre à cet appareil) ---------- */

function loadCfg() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveCfg(cfg) {
  state.cfg = cfg;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* mode privé */ }
}

/* ---------- Client API ---------- */

class ApiError extends Error {
  constructor(message, { auth = false } = {}) {
    super(message);
    this.auth = auth;
  }
}

async function api(path, params = {}, host = state.cfg.host) {
  const url = `${host.replace(/\/+$/, '')}/1.0/${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new ApiError(
      `Impossible de joindre ${new URL(url).host}.\n` +
      'Hors ligne, ou le serveur refuse les appels depuis un navigateur (CORS) : ' +
      'dans ce cas, renseigne l\'URL du proxy (voir README).'
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Réponse inattendue (HTTP ${res.status}).`);
  }
  if (data.result !== 0) {
    // 702/701 : session invalide ou expirée ; 6 : accès refusé
    const auth = [6, 701, 702].includes(data.result) || /session/i.test(data.error || '');
    throw new ApiError(data.error || data.reason || `Erreur Jelastic ${data.result}`, { auth });
  }
  return data;
}

const session = () => state.cfg.session;

async function fetchEnvs() {
  const data = await api('environment/control/rest/getenvs', { session: session() });
  return (data.infos || []).map((info) => {
    const env = info.env || {};
    const nodes = info.nodes || [];
    const cloudlets = nodes.reduce((n, x) => n + (x.flexibleCloudlets || 0), 0);
    return {
      envName: env.envName,
      displayName: env.displayName || env.envName,
      status: env.status,
      domain: env.domain,
      nodes: nodes.length,
      groups: [...new Set(nodes.map((x) => x.nodeGroup).filter(Boolean))],
      cloudlets,
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/* ---------- Vues ---------- */

function showSettings(show) {
  $('#view-settings').hidden = !show;
  $('#view-envs').hidden = show;
  $('#btn-refresh').hidden = show || !session();
}

function fillSettingsForm() {
  const c = state.cfg;
  $('#f-host').value = c.host || DEFAULT_HOST;
  const mode = c.authMode || 'token';
  document.querySelector(`input[name=auth][value=${mode}]`).checked = true;
  $('#f-token').value = mode === 'token' ? (c.session || '') : '';
  $('#f-login').value = c.login || '';
  $('#f-password').value = '';
  $('#btn-logout').hidden = !c.session;
  $('#settings-error').hidden = true;
  toggleAuthFields();
}

function toggleAuthFields() {
  const mode = document.querySelector('input[name=auth]:checked').value;
  $('#auth-token').hidden = mode !== 'token';
  $('#auth-password').hidden = mode !== 'password';
}

function setError(el, msg) {
  el.textContent = msg || '';
  el.hidden = !msg;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function confirmDialog(text, okLabel) {
  const dlg = $('#confirm');
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

function render() {
  const list = $('#env-list');
  const filter = $('#f-filter').value.trim().toLowerCase();
  const tpl = $('#env-item');
  const envs = state.envs.filter((e) =>
    !filter || `${e.displayName} ${e.envName} ${e.domain}`.toLowerCase().includes(filter));

  list.replaceChildren(...envs.map((e) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    const st = STATUS[e.status] || { label: `Statut ${e.status}`, cls: 's-down' };
    li.classList.add(st.cls);
    li.querySelector('.env-name').textContent = e.displayName;
    const a = li.querySelector('.env-domain');
    if (e.domain) {
      a.textContent = e.domain;
      a.href = `https://${e.domain}`;
    } else {
      a.remove();
    }
    li.querySelector('.badge').textContent = st.label;
    const meta = [`${e.nodes} nœud${e.nodes > 1 ? 's' : ''}`];
    if (e.groups.length) meta.push(e.groups.join(', '));
    if (e.status === RUNNING && e.cloudlets) meta.push(`${e.cloudlets} cloudlets max`);
    if (e.displayName !== e.envName) meta.push(e.envName);
    li.querySelector('.env-meta').textContent = meta.join(' · ');

    const busy = state.busy.has(e.envName);
    const start = li.querySelector('.act-start');
    const stop = li.querySelector('.act-stop');
    start.disabled = busy || !STARTABLE.has(e.status);
    stop.disabled = busy || e.status !== RUNNING;
    if (busy) (e.status === RUNNING ? stop : start).classList.add('busy');
    start.addEventListener('click', () => act(e, 'start'));
    stop.addEventListener('click', () => act(e, 'stop'));
    return li;
  }));

  $('#envs-empty').hidden = envs.length > 0;
}

/* ---------- Actions ---------- */

async function refresh({ quiet = false } = {}) {
  if (!session()) return;
  const btn = $('#btn-refresh');
  btn.classList.add('spin');
  try {
    state.envs = await fetchEnvs();
    setError($('#envs-error'), '');
    $('#last-update').textContent =
      `Mis à jour ${new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`;
    render();
    schedulePoll();
  } catch (err) {
    if (err.auth) return sessionExpired(err);
    if (!quiet) setError($('#envs-error'), err.message);
  } finally {
    btn.classList.remove('spin');
  }
}

// Tant qu'un environnement est en transition, on rafraîchit périodiquement.
function schedulePoll() {
  clearTimeout(state.pollTimer);
  const transit = state.envs.some((e) => STATUS[e.status]?.cls === 's-transit') || state.busy.size;
  if (!transit || document.hidden) { state.pollCount = 0; return; }
  if (++state.pollCount > POLL_MAX) return;
  state.pollTimer = setTimeout(() => refresh({ quiet: true }), POLL_MS);
}

async function act(env, action) {
  const verb = action === 'start' ? 'Démarrer' : 'Arrêter';
  const msg = action === 'start'
    ? `Démarrer « ${env.displayName} » ? La facturation des ressources reprend.`
    : `Arrêter « ${env.displayName} » ? Les applications de cet environnement ne répondront plus.`;
  if (!(await confirmDialog(msg, verb))) return;

  state.busy.add(env.envName);
  // Affichage optimiste de l'état de transition
  env.status = action === 'start' ? 3 : 13;
  render();
  try {
    // startenv/stopenv rendent la main une fois l'opération terminée (peut durer plusieurs minutes)
    await api(`environment/control/rest/${action}env`, { session: session(), envName: env.envName });
    toast(`${env.displayName} : ${action === 'start' ? 'démarré' : 'arrêté'}.`);
  } catch (err) {
    if (err.auth) { state.busy.delete(env.envName); return sessionExpired(err); }
    // Une coupure réseau pendant une longue opération ne veut pas dire qu'elle a échoué.
    toast(`${env.displayName} : ${err.message.split('\n')[0]}`);
  } finally {
    state.busy.delete(env.envName);
    state.pollCount = 0;
    await refresh({ quiet: true });
  }
}

function sessionExpired(err) {
  const cfg = { ...state.cfg };
  delete cfg.session;
  saveCfg(cfg);
  fillSettingsForm();
  setError($('#settings-error'), `Session refusée ou expirée : ${err.message}`);
  showSettings(true);
}

async function onSubmitSettings(ev) {
  ev.preventDefault();
  const submit = ev.submitter || ev.target.querySelector('[type=submit]');
  const errEl = $('#settings-error');
  setError(errEl, '');

  let host;
  try {
    const u = new URL($('#f-host').value.trim());
    host = u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return setError(errEl, 'Hôte invalide.');
  }
  const mode = document.querySelector('input[name=auth]:checked').value;
  submit.classList.add('busy');
  submit.disabled = true;
  try {
    let sess;
    const cfg = { host, authMode: mode };
    if (mode === 'token') {
      sess = $('#f-token').value.trim();
      if (!sess) throw new ApiError('Renseigne un jeton.');
    } else {
      const login = $('#f-login').value.trim();
      const password = $('#f-password').value;
      if (!login || !password) throw new ApiError('Identifiant et mot de passe requis.');
      const data = await api('users/authentication/rest/signin', { login, password }, host);
      sess = data.session;
      cfg.login = login;
    }
    // Vérifie que la session donne bien accès aux environnements
    await api('environment/control/rest/getenvs', { session: sess }, host);
    saveCfg({ ...cfg, session: sess });
    $('#f-password').value = '';
    showSettings(false);
    await refresh();
  } catch (err) {
    setError(errEl, err.message);
  } finally {
    submit.classList.remove('busy');
    submit.disabled = false;
  }
}

async function logout() {
  const { host, session: sess, authMode } = state.cfg;
  if (authMode === 'password' && sess) {
    api('users/authentication/rest/signout', { session: sess }, host).catch(() => {});
  }
  const cfg = { ...state.cfg };
  delete cfg.session;
  saveCfg(cfg);
  state.envs = [];
  render();
  fillSettingsForm();
}

/* ---------- Démarrage ---------- */

function init() {
  $('#btn-settings').addEventListener('click', () => {
    const open = $('#view-settings').hidden;
    if (open) fillSettingsForm();
    showSettings(open || !session());
  });
  $('#btn-refresh').addEventListener('click', () => refresh());
  $('#settings-form').addEventListener('submit', onSubmitSettings);
  $('#btn-logout').addEventListener('click', logout);
  document.querySelectorAll('input[name=auth]').forEach((r) => r.addEventListener('change', toggleAuthFields));
  $('#f-filter').addEventListener('input', render);

  // Retour au premier plan : on rafraîchit
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session() && $('#view-settings').hidden) refresh({ quiet: true });
  });

  if (session()) {
    showSettings(false);
    refresh();
  } else {
    fillSettingsForm();
    showSettings(true);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
