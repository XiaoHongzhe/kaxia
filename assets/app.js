/* =========================================================
   卡匣 · Switch 卡带管家
   本地优先数据层 / 工具函数 / 路由
   ========================================================= */
(() => {
  'use strict';

  const APP_VERSION = '1.3.9';
  const DB_NAME = 'kaxia-db';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv';
  const LS_KEY = 'kaxia.state.v1';
  const SCHEMA_VERSION = 1;

  const REGIONS = ['港版', '日版', '美版', '欧版', '台版', '国行', '韩版', '澳版', '亚洲版'];
  const REGION_SIGNATURES = [
    { label: '台版', patterns: [/\bTWN\b/, /\bNCC\b/, /\bBSMI\b/, /\bCHT\b/] },
    { label: '港版', patterns: [/\bHKG\b/, /\bHK\b/, /HONG\s*KONG/, /香港/, /\bCHT\b/] },
    { label: '日版', patterns: [/\bJPN\b/, /\bCERO\b/, /NTSC[-\s]?J/] },
    { label: '美版', patterns: [/\bUSA\b/, /\bESRB\b/, /NTSC[-\s]?U/] },
    { label: '欧版', patterns: [/\bEUR\b/, /\bPEGI\b/] },
    { label: '国行', patterns: [/\bCHN\b/, /TENCENT/i, /腾讯|騰訊/, /\bCHS\b/] },
    { label: '韩版', patterns: [/\bKOR\b/, /\bGRAC\b/] },
    { label: '澳版', patterns: [/\bAUS\b/, /\bACB\b/] },
    { label: '亚洲版', patterns: [/\bASI\b/, /\bASIA\b/, /\bSEA\b/, /\bCHS\b/] }
  ];
  const CONDITIONS = ['全新未拆', '拆封但卡带全新', '几乎全新', '正常使用', '有划痕'];
  const PHOTO_LABELS = ['卡带盒', '正面', '背面', '侧面', '划痕', '其他'];
  const PLATFORM_OPTIONS = [
    { key: 'NS1', label: '仅 NS1', short: 'NS1' },
    { key: 'BOTH', label: 'NS1 / NS2 通用', short: 'NS1+2' },
    { key: 'NS2', label: '仅 NS2', short: 'NS2' }
  ];
  const PLATFORM_LABELS = { NS1: '仅 NS1', BOTH: 'NS1 / NS2 通用', NS2: '仅 NS2' };
  const CARTRIDGE_OPTIONS = [
    { key: 'NS1', label: 'NS1 实体卡', short: 'NS1 卡' },
    { key: 'NS2', label: 'NS2 实体卡', short: 'NS2 卡' },
    { key: 'NS2_EDITION', label: 'NS2 Edition 卡', short: 'NS2E 卡' },
    { key: 'NS2_KEY', label: 'NS2 钥匙卡', short: 'NS2 钥匙卡' }
  ];
  const CARTRIDGE_LABELS = { NS1: 'NS1 实体卡', NS2: 'NS2 实体卡', NS2_EDITION: 'NS2 Edition 卡', NS2_KEY: 'NS2 钥匙卡' };
  const CARTRIDGE_CODE_RULES = {
    LA: { platformSupport: 'BOTH', cartridgeType: 'NS1', label: 'LA 开头 · NS1 实体卡，NS1 / NS2 都能玩' },
    LN: { platformSupport: 'BOTH', cartridgeType: 'NS2_EDITION', label: 'LN 开头 · NS2 Edition 卡，NS1 / NS2 都能玩' },
    LB: { platformSupport: 'NS2', cartridgeType: 'NS2', label: 'LB 开头 · NS2 独占实体卡，仅支持 NS2' },
    LP: { platformSupport: 'NS2', cartridgeType: 'NS2_KEY', label: 'LP 开头 · NS2 钥匙卡，仅支持 NS2' },
    'HAC-008': { platformSupport: 'BOTH', cartridgeType: 'NS1', label: 'HAC-008 · Switch 1 实体卡，NS1 / NS2 都能玩' }
  };

  function parseCartridgeCode(value) {
    const text = String(value || '').normalize('NFKC').toUpperCase();
    if (!text.trim()) return null;
    const match = text.match(/(?:^|[^A-Z0-9])(L[ABNP])(?=$|[^A-Z0-9])/);
    if (match) {
      const rule = CARTRIDGE_CODE_RULES[match[1]];
      return rule ? { prefix: match[1], ...rule } : null;
    }
    if (/(?:^|[^A-Z0-9])HAC[-\s]?008(?=$|[^A-Z0-9])/.test(text)) {
      return { prefix: 'HAC-008', ...CARTRIDGE_CODE_RULES['HAC-008'] };
    }
    return null;
  }
  const ROUTE_TITLES = { home: '总览', library: '卡带库', loans: '出借', stats: '统计' };
  const STATUS_LABELS = { owned: '在库', lent: '已出借', overdue: '已逾期', sold: '已售出' };

  const PALETTES = [
    ['#b7493d', '#591a17', '#f4bdb4'],
    ['#2f7060', '#123b32', '#a7d8c7'],
    ['#b27a26', '#5c390b', '#f0cf93'],
    ['#3e6388', '#172d43', '#b9d3e8'],
    ['#815571', '#3c2032', '#e0bcd2'],
    ['#65763b', '#2d3815', '#c8d79a'],
    ['#a95332', '#57220f', '#efb79e'],
    ['#3b6571', '#152f36', '#a8d2da'],
    ['#6f5c95', '#30264b', '#cec1e8'],
    ['#8a6a4a', '#3e2a18', '#ddc4a8']
  ];

  let state = {
    schemaVersion: SCHEMA_VERSION,
    games: [],
    preferences: { view: 'grid', sort: 'recent' },
    nintendo: { accounts: [], records: [], lastSyncAt: null },
    updatedAt: null
  };

  const filters = { q: '', status: 'all', region: 'all', platform: 'all', cartridge: 'all', tag: 'all', sort: 'recent' };
  let lanServers = [];
  let lanSelected = -1;
  let lanSyncBusy = false;
  let lanUpdateInfo = null;
  let lanAutoTimer = null;
  let lanAutoBusy = false;
  let currentRoute = 'home';
  let previousRoute = null;
  let storageMode = 'idb';
  let serverMode = false;
  let serverStateAt = null;
  let dbPromise = null;
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let savePending = false;
  let lastSaveAt = null;
  let detailId = null;
  let drawerOpen = false;
  let drawerReturnFocus = null;
  let modalStack = [];
  let nintendoBusy = false;
  let deferredInstallPrompt = null;
  let swRegistration = null;
  let updateWaiting = false;
  let updateReloading = false;
  let booted = false;

  /* ---------------------------------------------------------
     Small helpers
     --------------------------------------------------------- */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
  }

  function icon(name, className = '') {
    return '<svg class="icon ' + className + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function uid(prefix = 'g') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function asNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeSearch(value) {
    return String(value || '').normalize('NFKC').toLowerCase().trim();
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value || '卡匣');
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function paletteFor(title) {
    const palette = PALETTES[hashString(title) % PALETTES.length];
    return { c1: palette[0], c2: palette[1], c3: palette[2] };
  }

  function isNativeApp() {
    return Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  }

  function nativePlugin(name) {
    const cap = window.Capacitor;
    if (!cap) return null;
    const existing = cap.Plugins && cap.Plugins[name];
    if (existing) return existing;
    if (typeof cap.registerPlugin === 'function') {
      try { return cap.registerPlugin(name); } catch (error) { return null; }
    }
    return null;
  }

  function base64FromString(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }


  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        toast('已复制搜索词。', 'success');
        return true;
      }
    } catch (error) { /* fall through */ }
    try {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      toast('已复制搜索词。', 'success');
      return true;
    } catch (error) {
      toast('复制失败，请手动输入搜索词。', 'error');
      return false;
    }
  }

  function safeImage(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(url)) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch (error) {
      return '';
    }
    return '';
  }

  function todayISO() {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function addDaysISO(base, amount) {
    const date = typeof base === 'string' ? parseDate(base) : new Date(base);
    if (!date) return '';
    date.setDate(date.getDate() + Number(amount || 0));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function fmtDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? match[1] + '.' + match[2] + '.' + match[3] : '未记录';
  }

  function fmtDateLong(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? Number(match[1]) + '年' + Number(match[2]) + '月' + Number(match[3]) + '日' : '未记录';
  }

  function fmtDateTime(value) {
    if (!value) return '刚刚';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '刚刚';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function fmtMoney(value, empty = '—') {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return empty;
    return '¥' + number.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function fmtMoneyExact(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '¥0';
    return '¥' + number.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function hoursNumber(minutes) {
    const value = Math.max(0, Number(minutes) || 0) / 60;
    if (value === 0) return 0;
    if (value >= 100) return Math.round(value);
    return Math.round(value * 10) / 10;
  }

  function fmtHours(minutes) {
    if (!minutes) return '未记录';
    const hours = hoursNumber(minutes);
    if (hours < 1) return Math.max(1, Math.round(minutes)) + ' 分钟';
    return hours + ' 小时';
  }

  function fmtHoursShort(minutes) {
    if (!minutes) return '—';
    if (minutes < 60) return Math.round(minutes) + '分';
    return hoursNumber(minutes) + 'h';
  }

  function fmtBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  function daysFromToday(dateString) {
    const target = parseDate(dateString);
    if (!target) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function activeLoan(game) {
    if (!game || !Array.isArray(game.loans)) return null;
    return game.loans.find((loan) => !loan.returnedDate) || null;
  }

  function isOverdueLoan(loan) {
    if (!loan || loan.returnedDate || !loan.dueDate) return false;
    const days = daysFromToday(loan.dueDate);
    return days !== null && days < 0;
  }

  function gameStatus(game) {
    if (game.soldAt) return { key: 'sold', label: STATUS_LABELS.sold, loan: null };
    const loan = activeLoan(game);
    if (!loan) return { key: 'owned', label: STATUS_LABELS.owned, loan: null };
    if (isOverdueLoan(loan)) return { key: 'overdue', label: STATUS_LABELS.overdue, loan };
    return { key: 'lent', label: STATUS_LABELS.lent, loan };
  }

  function statusBadge(game) {
    const status = gameStatus(game);
    return '<span class="status-badge status-' + status.key + '">' + status.label + '</span>';
  }

  function duplicateGames(game) {
    const key = normalizeSearch(game && game.title);
    if (!key) return [];
    return state.games.filter((item) => normalizeSearch(item.title) === key);
  }

  function duplicateCount(game) {
    return duplicateGames(game).length;
  }

  function loanDueText(loan) {
    if (!loan) return '';
    if (loan.returnedDate) return '已于 ' + fmtDate(loan.returnedDate) + ' 归还';
    if (!loan.dueDate) return '暂无归还时间';
    const days = daysFromToday(loan.dueDate);
    if (days == null) return '暂无归还时间';
    if (days < 0) return '已逾期 ' + Math.abs(days) + ' 天';
    if (days === 0) return '今天到期';
    if (days === 1) return '明天到期';
    return '还有 ' + days + ' 天到期';
  }

  function totalSpent() {
    return state.games.reduce((sum, game) => sum + Math.max(0, Number(game.price) || 0), 0);
  }

  function totalSoldRevenue() {
    return state.games.reduce((sum, game) => sum + (game.soldAt ? Math.max(0, Number(game.soldPrice) || 0) : 0), 0);
  }

  function totalPlayMinutes() {
    return state.games.reduce((sum, game) => sum + Math.max(0, Number(game.playMinutes) || 0), 0);
  }

  function activeLoanRows() {
    const rows = [];
    state.games.forEach((game) => {
      if (game.soldAt) return;
      const loan = activeLoan(game);
      if (loan) rows.push({ game, loan });
    });
    return rows.sort((a, b) => {
      const ad = a.loan.dueDate ? daysFromToday(a.loan.dueDate) : 9999;
      const bd = b.loan.dueDate ? daysFromToday(b.loan.dueDate) : 9999;
      return (ad == null ? 9999 : ad) - (bd == null ? 9999 : bd);
    });
  }

  function returnedLoanRows() {
    const rows = [];
    state.games.forEach((game) => {
      (game.loans || []).forEach((loan) => {
        if (loan.returnedDate) rows.push({ game, loan });
      });
    });
    return rows.sort((a, b) => String(b.loan.returnedDate || '').localeCompare(String(a.loan.returnedDate || '')));
  }

  function sortedGames(list, sort) {
    const items = list.slice();
    const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
    switch (sort) {
      case 'purchase':
        return items.sort((a, b) => String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || '')) || byTitle(a, b));
      case 'play':
        return items.sort((a, b) => (Number(b.playMinutes) || 0) - (Number(a.playMinutes) || 0) || byTitle(a, b));
      case 'price':
        return items.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0) || byTitle(a, b));
      case 'title':
        return items.sort(byTitle);
      case 'recent':
      default:
        return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byTitle(a, b));
    }
  }

  function filteredGames() {
    const query = normalizeSearch(filters.q);
    return sortedGames(state.games.filter((game) => {
      const status = gameStatus(game);
      if (filters.status !== 'all' && status.key !== filters.status) return false;
      if (filters.region !== 'all' && (game.region || '未标注') !== filters.region) return false;
      if (filters.platform !== 'all' && (game.platformSupport || 'NS1') !== filters.platform) return false;
      if (filters.cartridge !== 'all' && (game.cartridgeType || 'NS1') !== filters.cartridge) return false;
      if (filters.tag !== 'all' && !(game.tags || []).includes(filters.tag)) return false;
      if (!query) return true;
      const loan = activeLoan(game);
      const haystack = normalizeSearch([
        game.title, game.subtitle, game.region, game.cartridgeCode, game.purchaseChannel, game.note, game.condition,
        (game.tags || []).join(' '), loan ? loan.borrower : '', loan ? loan.contact : ''
      ].join(' '));
      return haystack.includes(query);
    }), filters.sort);
  }

  /* ---------------------------------------------------------
     Storage
     --------------------------------------------------------- */

  function setSaveStatus(mode, text) {
    const pill = $('#savePill');
    const label = $('#saveText');
    const sidebar = $('#sidebarStorage');
    if (pill) {
      pill.classList.toggle('is-saving', mode === 'saving');
      pill.classList.toggle('is-error', mode === 'error');
    }
    if (label) label.textContent = text;
    if (sidebar) {
      if (mode === 'saving') sidebar.textContent = '正在保存…';
      else if (mode === 'error') sidebar.textContent = '保存失败，请导出备份';
      else sidebar.textContent = storageLabel() + ' · ' + text.replace('已保存 ', '已保存 ');
    }
  }

  function markSaved() {
    lastSaveAt = new Date();
    const time = lastSaveAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    setSaveStatus('saved', '已保存 ' + time);
  }

  function markSaving() {
    setSaveStatus('saving', '保存中…');
  }

  function markSaveError() {
    setSaveStatus('error', '保存失败');
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in window)) {
      dbPromise = Promise.reject(new Error('IndexedDB unavailable'));
      return dbPromise;
    }
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return dbPromise;
  }

  async function idbGet(key) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
  }

  async function idbSet(key, value) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
    });
  }

  function readLocalState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function writeLocalState(value) {
    localStorage.setItem(LS_KEY, JSON.stringify(value));
  }

  function storageLabel() {
    if (serverMode) return '电脑卡匣服务';
    return storageMode === 'idb' ? 'IndexedDB' : '浏览器存储';
  }

  async function detectServerMode() {
    if (isNativeApp() || !/^https?:$/.test(window.location.protocol)) return false;
    try {
      const response = await fetch('/api/sync/info', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return false;
      const info = await response.json();
      return Boolean(info && info.service === 'kaxia-sync');
    } catch (error) {
      return false;
    }
  }

  async function loadServerState(migrateLocal = true) {
    const response = await fetch('/api/sync', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 404) {
      if (migrateLocal) {
        const local = readLocalState();
        if (local && local.games.length) {
          await persistServerState(local);
          return local;
        }
      }
      serverStateAt = null;
      return blankState();
    }
    if (!response.ok) throw new Error(await lanResponseError(response));
    const parsed = await response.json();
    serverStateAt = parsed.receivedAt || null;
    return normalizeState(parsed && parsed.state ? parsed.state : parsed);
  }

  async function persistServerState(value) {
    const payload = JSON.stringify({
      app: 'kaxia',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      state: value
    });
    const response = await fetch('/api/sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    if (!response.ok) throw new Error(await lanResponseError(response));
    const info = await response.json();
    serverStateAt = info.updatedAt || new Date().toISOString();
    storageMode = 'server';
  }

  async function refreshServerState(manual = false) {
    if (!serverMode || modalStack.length || drawerOpen) return;
    if (!manual && (saveTimer || savePending)) return;
    try {
      const infoResponse = await fetch('/api/sync/info', { credentials: 'same-origin', cache: 'no-store' });
      if (!infoResponse.ok) return;
      const info = await infoResponse.json();
      if (info.updatedAt && info.updatedAt === serverStateAt) return;
      const next = await loadServerState(false);
      state = next;
      filters.sort = state.preferences.sort || 'recent';
      rerender({ keepScroll: true });
      markSaved();
      if (manual) toast('已从电脑服务刷新。', 'success');
    } catch (error) {
      if (manual) toast(error && error.message ? error.message : '刷新失败', 'error');
    }
  }

  async function loadState() {
    try {
      const stored = await idbGet('state');
      if (stored) {
        storageMode = 'idb';
        return normalizeState(stored);
      }
    } catch (error) {
      storageMode = 'local';
    }
    const local = readLocalState();
    if (local) return local;
    storageMode = ('indexedDB' in window) ? 'idb' : 'local';
    return blankState();
  }

  async function persistState() {
    if (serverMode) {
      await persistServerState(state);
      return;
    }
    try {
      await idbSet('state', state);
      storageMode = 'idb';
      return;
    } catch (error) {
      try {
        writeLocalState(state);
        storageMode = 'local';
        return;
      } catch (localError) {
        throw localError;
      }
    }
  }

  function scheduleSave(delay = 220) {
    state.updatedAt = new Date().toISOString();
    markSaving();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, delay);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (savePending) {
      saveChain = saveChain.then(() => persistAndMark());
      return saveChain;
    }
    savePending = true;
    saveChain = saveChain.then(() => persistAndMark()).finally(() => {
      savePending = false;
    });
    return saveChain;
  }

  async function persistAndMark() {
    try {
      await persistState();
      markSaved();
    } catch (error) {
      markSaveError();
      toast('数据保存失败，请尽快导出备份。', 'error');
    }
  }

  /* ---------------------------------------------------------
     Normalisation
     --------------------------------------------------------- */

  function blankState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      games: [],
      preferences: { view: 'grid', sort: 'recent' },
      nintendo: { accounts: [], records: [], lastSyncAt: null },
      updatedAt: null
    };
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return blankState();
    const source = raw.state && typeof raw.state === 'object' ? raw.state : raw;
    const gamesSource = Array.isArray(source) ? source : (Array.isArray(source.games) ? source.games : []);
    const games = gamesSource.map(normalizeGame).filter(Boolean);
    const prefs = source.preferences && typeof source.preferences === 'object' ? source.preferences : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      games,
      preferences: {
        view: prefs.view === 'list' ? 'list' : 'grid',
        sort: ['recent', 'purchase', 'play', 'price', 'title'].includes(prefs.sort) ? prefs.sort : 'recent'
      },
      nintendo: normalizeNintendo(source.nintendo),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null
    };
  }

  function normalizeGame(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = String(raw.title || '').trim().slice(0, 120);
    if (!title) return null;
    const now = new Date().toISOString();
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : now;
    const loans = Array.isArray(raw.loans) ? raw.loans.map(normalizeLoan).filter(Boolean) : [];
    const playLogs = Array.isArray(raw.playLogs) ? raw.playLogs.map(normalizePlayLog).filter(Boolean) : [];
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
      : String(raw.tags || '').split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
    return {
      id: String(raw.id || uid()),
      title,
      subtitle: String(raw.subtitle || '').trim().slice(0, 160),
      region: String(raw.region || '').trim().slice(0, 20),
      cartridgeCode: String(raw.cartridgeCode || '').trim().slice(0, 40),
      platformSupport: ['NS1', 'NS2', 'BOTH'].includes(raw.platformSupport) ? raw.platformSupport : 'NS1',
      cartridgeType: ['NS1', 'NS2', 'NS2_EDITION', 'NS2_KEY'].includes(raw.cartridgeType) ? raw.cartridgeType : 'NS1',
      soldAt: parseDate(raw.soldAt) ? String(raw.soldAt).slice(0, 10) : '',
      soldPrice: Math.max(0, asNumber(raw.soldPrice, 0)),
      soldTo: String(raw.soldTo || '').trim().slice(0, 80),
      saleNote: String(raw.saleNote || '').slice(0, 1000),
      copyLabel: String(raw.copyLabel || '').trim().slice(0, 30),
      marketPrice: Math.max(0, asNumber(raw.marketPrice, 0)),
      marketUpdatedAt: parseDate(raw.marketUpdatedAt) ? String(raw.marketUpdatedAt).slice(0, 10) : '',
      marketSource: String(raw.marketSource || '').trim().slice(0, 30),
      marketNote: String(raw.marketNote || '').slice(0, 500),
      condition: String(raw.condition || '').trim().slice(0, 20),
      purchaseDate: parseDate(raw.purchaseDate) ? String(raw.purchaseDate).slice(0, 10) : '',
      price: Math.max(0, asNumber(raw.price, 0)),
      purchaseChannel: String(raw.purchaseChannel || '').trim().slice(0, 80),
      playMinutes: Math.max(0, Math.round(asNumber(raw.playMinutes, 0))),
      nintendoAppIds: Array.isArray(raw.nintendoAppIds)
        ? raw.nintendoAppIds.map((id) => String(id).trim().toUpperCase()).filter(Boolean).slice(0, 20)
        : [],
      nintendoImportedMinutes: Math.max(0, Math.round(asNumber(raw.nintendoImportedMinutes, 0))),
      cover: safeImage(raw.cover),
      photos: Array.isArray(raw.photos) ? raw.photos.map(normalizeGamePhoto).filter(Boolean).slice(0, 12) : [],
      tags,
      note: String(raw.note || '').slice(0, 4000),
      loans,
      playLogs,
      createdAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt
    };
  }

  function normalizeLoan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || uid('l')),
      borrower: String(raw.borrower || '').trim().slice(0, 60),
      contact: String(raw.contact || '').trim().slice(0, 120),
      loanDate: parseDate(raw.loanDate) ? String(raw.loanDate).slice(0, 10) : '',
      dueDate: parseDate(raw.dueDate) ? String(raw.dueDate).slice(0, 10) : '',
      returnedDate: parseDate(raw.returnedDate) ? String(raw.returnedDate).slice(0, 10) : '',
      note: String(raw.note || '').slice(0, 1000),
      returnNote: String(raw.returnNote || '').slice(0, 1000)
    };
  }

  function normalizeGamePhoto(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const data = safeImage(raw.data);
    if (!data) return null;
    return {
      id: String(raw.id || uid('ph')),
      data,
      label: String(raw.label || '其他').slice(0, 20),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
    };
  }

  function normalizeNintendo(raw) {
    if (!raw || typeof raw !== 'object') return { accounts: [], records: [], lastSyncAt: null };
    const accounts = Array.isArray(raw.accounts) ? raw.accounts.map(normalizeNintendoAccount).filter(Boolean) : [];
    const sourceRecords = Array.isArray(raw.records)
      ? raw.records
      : (raw.records && typeof raw.records === 'object' ? Object.values(raw.records) : []);
    const recordMap = new Map();
    sourceRecords.forEach((record) => {
      const normalized = normalizeNintendoRecord(record);
      if (normalized) recordMap.set(nintendoRecordKey(normalized), normalized);
    });
    return {
      accounts,
      records: Array.from(recordMap.values()),
      lastSyncAt: raw.lastSyncAt || null
    };
  }

  function normalizeNintendoAccount(raw) {
    if (!raw || typeof raw !== 'object' || !raw.id) return null;
    const devices = Array.isArray(raw.devices)
      ? raw.devices.map((device) => ({
          deviceId: String(device.deviceId || ''),
          label: String(device.label || 'Nintendo Switch').slice(0, 80),
          serialNumber: String(device.serialNumber || '').slice(0, 80)
        })).filter((device) => device.deviceId)
      : [];
    return {
      id: String(raw.id),
      nickname: String(raw.nickname || '任天堂账号').slice(0, 80),
      avatarUrl: safeImage(raw.avatarUrl),
      country: String(raw.country || '').slice(0, 10),
      addedAt: asNumber(raw.addedAt, 0),
      lastSyncAt: asNumber(raw.lastSyncAt, 0),
      devices
    };
  }

  function normalizeNintendoRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const deviceId = String(raw.deviceId || '').trim();
    const date = parseDate(raw.date) ? String(raw.date).slice(0, 10) : '';
    const playerId = String(raw.playerId || 'device').trim();
    const applicationId = String(raw.applicationId || '').trim().toUpperCase();
    const minutes = Math.max(0, Math.round(asNumber(raw.minutes, 0)));
    if (!deviceId || !date || !applicationId || !minutes) return null;
    return {
      accountId: String(raw.accountId || ''),
      deviceId,
      deviceLabel: String(raw.deviceLabel || 'Nintendo Switch').slice(0, 80),
      date,
      playerId,
      playerName: String(raw.playerName || 'Switch 玩家').slice(0, 80),
      playerAvatar: safeImage(raw.playerAvatar),
      applicationId,
      title: String(raw.title || applicationId).slice(0, 160),
      minutes
    };
  }

  function nintendoRecordKey(record) {
    return [record.deviceId, record.date, record.playerId, record.applicationId].join('|');
  }

  function nintendoPlayerTotals(game) {
    const ids = new Set((game.nintendoAppIds || []).map((id) => String(id).toUpperCase()));
    const players = new Map();
    let total = 0;
    (state.nintendo.records || []).forEach((record) => {
      if (!ids.has(String(record.applicationId).toUpperCase())) return;
      total += record.minutes;
      const key = record.playerId || record.playerName;
      const current = players.get(key) || { name: record.playerName || 'Switch 玩家', minutes: 0 };
      current.minutes += record.minutes;
      players.set(key, current);
    });
    return { total, players: Array.from(players.values()).sort((a, b) => b.minutes - a.minutes) };
  }

  function normalizePlayLog(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const minutes = Math.max(0, Math.round(asNumber(raw.minutes, 0)));
    if (!minutes) return null;
    return {
      id: String(raw.id || uid('p')),
      date: parseDate(raw.date) ? String(raw.date).slice(0, 10) : todayISO(),
      minutes,
      note: String(raw.note || '').slice(0, 500)
    };
  }

  /* ---------------------------------------------------------
     Router + shell
     --------------------------------------------------------- */

  function parseHash() {
    const raw = String(window.location.hash || '').replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const route = ROUTE_TITLES[path] ? path : 'home';
    return { route, params: new URLSearchParams(query) };
  }

  function handleRoute(initial = false) {
    const { route, params } = parseHash();
    if (!window.location.hash) {
      history.replaceState(null, '', '#/home');
    }
    closeAllModals(true);
    closeDrawer(true);

    if (route === 'library') {
      if (params.has('status') && ['all', 'owned', 'lent', 'overdue', 'sold'].includes(params.get('status'))) {
        filters.status = params.get('status');
      } else if (previousRoute && previousRoute !== 'library') {
        filters.status = 'all';
        filters.q = '';
        filters.region = 'all';
        filters.platform = 'all';
        filters.cartridge = 'all';
        filters.tag = 'all';
      }
      if (params.has('region')) filters.region = params.get('region');
      if (params.has('platform') && ['all', 'NS1', 'NS2', 'BOTH'].includes(params.get('platform'))) filters.platform = params.get('platform');
      if (params.has('cartridge') && ['all', 'NS1', 'NS2', 'NS2_EDITION', 'NS2_KEY'].includes(params.get('cartridge'))) filters.cartridge = params.get('cartridge');
      if (params.has('tag')) filters.tag = params.get('tag');
    }

    previousRoute = currentRoute;
    currentRoute = route;
    if (!booted) {
      filters.sort = state.preferences.sort || 'recent';
    }
    renderRoute();
    if (!initial) window.scrollTo({ top: 0, behavior: 'auto' });
    booted = true;
  }

  function updateNav() {
    $$('[data-nav]').forEach((link) => {
      const active = link.dataset.nav === currentRoute;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    const total = state.games.length;
    const active = activeLoanRows().length;
    const libraryCount = $('#navCountLibrary');
    const loanCount = $('#navCountLoans');
    const mobileDot = $('#mobileLoanDot');
    if (libraryCount) {
      libraryCount.textContent = String(total);
      libraryCount.hidden = total === 0;
    }
    if (loanCount) {
      loanCount.textContent = String(active);
      loanCount.hidden = active === 0;
    }
    if (mobileDot) mobileDot.hidden = active === 0;

    const title = ROUTE_TITLES[currentRoute] || '总览';
    const topbarTitle = $('#topbarTitle');
    if (topbarTitle) topbarTitle.textContent = title;
    document.title = title + ' · 卡匣';
  }

  function renderRoute() {
    updateNav();
    const view = $('#view');
    if (!view) return;
    let html = '';
    switch (currentRoute) {
      case 'library':
        html = renderLibrary();
        break;
      case 'loans':
        html = renderLoans();
        break;
      case 'stats':
        html = renderStats();
        break;
      case 'home':
      default:
        html = renderHome();
    }
    view.innerHTML = html;
    if (currentRoute === 'library' && state.games.length) paintLibrary();
    updateNav();
  }

  function rerender(options = {}) {
    const keepScroll = options.keepScroll !== false;
    const y = window.scrollY;
    renderRoute();
    if (keepScroll) requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }

  function syncBodyLock() {
    const hasModal = modalStack.some((item) => !item.closed);
    document.body.classList.toggle('modal-open', hasModal || drawerOpen);
  }

  function openGame(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    closeDrawer(true);
    detailId = id;
    drawerReturnFocus = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'drawer-layer';
    layer.innerHTML = '<div class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(game.title) + '详情"></div>';
    document.body.appendChild(layer);
    layer.querySelector('.drawer').innerHTML = drawerHTML(game);
    drawerOpen = true;
    syncBodyLock();
    requestAnimationFrame(() => {
      layer.classList.add('open');
      const close = layer.querySelector('.drawer-close');
      if (close) close.focus({ preventScroll: true });
    });
    layer.addEventListener('mousedown', (event) => {
      if (event.target === layer) closeDrawer();
    });
  }

  function refreshDrawer() {
    if (!detailId) return;
    const layer = $('.drawer-layer');
    if (!layer) return;
    const drawer = layer.querySelector('.drawer');
    const game = state.games.find((item) => item.id === detailId);
    if (!game || !drawer) {
      closeDrawer(true);
      return;
    }
    const scrollTop = drawer.scrollTop;
    drawer.innerHTML = drawerHTML(game);
    drawer.scrollTop = scrollTop;
  }

  function closeDrawer(instant = false) {
    if (!drawerOpen) return;
    drawerOpen = false;
    const layer = $('.drawer-layer');
    if (layer) {
      if (instant) {
        layer.remove();
      } else {
        layer.classList.remove('open');
        setTimeout(() => layer.remove(), 320);
      }
    }
    detailId = null;
    syncBodyLock();
    if (drawerReturnFocus && typeof drawerReturnFocus.focus === 'function') {
      try { drawerReturnFocus.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
    }
    drawerReturnFocus = null;
  }

  /* ---------------------------------------------------------
     Modal primitives
     --------------------------------------------------------- */

  function createModal(options) {
    const item = { layer: null, closed: false, onClose: options.onClose || null, returnFocus: document.activeElement };
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    const modalClass = options.size === 'lg' ? 'modal-lg' : (options.size === 'sm' ? 'modal-sm' : '');
    layer.innerHTML =
      '<section class="modal ' + modalClass + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<div class="modal-head-copy"><h2>' + esc(options.title || '') + '</h2>' +
            (options.subtitle ? '<p>' + esc(options.subtitle) + '</p>' : '') +
          '</div>' +
          '<button type="button" class="modal-close" data-close aria-label="关闭">' + icon('close') + '</button>' +
        '</div>' +
        '<div class="modal-body">' + (options.body || '') + '</div>' +
        (options.footer ? '<div class="modal-foot">' + options.footer + '</div>' : '') +
      '</section>';
    document.body.appendChild(layer);
    item.layer = layer;
    modalStack.push(item);
    syncBodyLock();

    layer.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => closeModal(item));
    });
    layer.addEventListener('mousedown', (event) => {
      if (event.target === layer) closeModal(item);
    });

    if (typeof options.onMount === 'function') options.onMount(layer, () => closeModal(item));

    requestAnimationFrame(() => {
      const first = layer.querySelector('.modal-body input:not([type="hidden"]), .modal-body select, .modal-body textarea, .modal-body button, .modal-foot .btn-primary');
      if (first) first.focus({ preventScroll: true });
    });
    return item;
  }

  function closeModal(item, instant = false) {
    if (!item || item.closed) return;
    item.closed = true;
    const layer = item.layer;
    if (layer) {
      if (instant) {
        layer.remove();
      } else {
        layer.classList.add('is-closing');
        setTimeout(() => layer.remove(), 170);
      }
    }
    modalStack = modalStack.filter((entry) => entry !== item);
    syncBodyLock();
    if (typeof item.onClose === 'function') item.onClose();
    const focusTarget = item.returnFocus;
    if (focusTarget && typeof focusTarget.focus === 'function' && document.contains(focusTarget)) {
      setTimeout(() => {
        try { focusTarget.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
      }, 180);
    }
  }

  function closeTopModal() {
    const top = modalStack.filter((item) => !item.closed).slice(-1)[0];
    if (top) closeModal(top);
    return Boolean(top);
  }

  function closeAllModals(instant = false) {
    modalStack.slice().reverse().forEach((item) => closeModal(item, instant));
    modalStack = [];
    syncBodyLock();
  }

  function askConfirm(options) {
    return new Promise((resolve) => {
      let settled = false;
      const modal = createModal({
        title: options.title || '确认操作',
        subtitle: options.subtitle || '',
        size: 'sm',
        body:
          '<div class="confirm-icon">' + icon(options.danger ? 'alert' : 'info') + '</div>' +
          '<div class="confirm-title">' + esc(options.heading || options.title || '确认操作') + '</div>' +
          '<div class="confirm-text">' + (options.message || '') + '</div>',
        footer:
          '<button type="button" class="btn btn-ghost" data-cancel>取消</button>' +
          '<button type="button" class="btn ' + (options.danger ? 'btn-danger-solid' : 'btn-primary') + '" data-confirm>' + esc(options.confirmText || '确认') + '</button>',
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
        onMount: (layer, close) => {
          layer.querySelector('[data-cancel]').addEventListener('click', close);
          layer.querySelector('[data-confirm]').addEventListener('click', () => {
            settled = true;
            resolve(true);
            close();
          });
        }
      });
      modal.layer.addEventListener('mousedown', (event) => {
        if (event.target === modal.layer && !settled) {
          settled = true;
          resolve(false);
        }
      });
    });
  }

  function toast(message, type = 'success', action = null) {
    const root = $('#toast-root');
    if (!root) return;
    const element = document.createElement('div');
    element.className = 'toast toast-' + type;
    const iconName = type === 'error' ? 'alert' : (type === 'info' ? 'info' : 'check');
    element.innerHTML =
      icon(iconName, type === 'error' ? 'toast-alert' : (type === 'success' ? 'toast-check' : '')) +
      '<span>' + esc(message) + '</span>' +
      (action ? '<button type="button" class="toast-action">' + esc(action.label || '查看') + '</button>' : '');
    if (action && typeof action.onClick === 'function') {
      element.querySelector('.toast-action').addEventListener('click', () => {
        action.onClick();
        dismissToast(element);
      });
    }
    root.appendChild(element);
    const limit = 3;
    while (root.children.length > limit) root.firstElementChild.remove();
    const timeout = action ? 6500 : 3400;
    setTimeout(() => dismissToast(element), timeout);
    return element;
  }

  function dismissToast(element) {
    if (!element || !element.isConnected) return;
    element.classList.add('out');
    setTimeout(() => element.remove(), 230);
  }

  /* ---------------------------------------------------------
     Demo data
     --------------------------------------------------------- */

  function demoGames() {
    const date = (offset) => addDaysISO(todayISO(), offset);
    const base = [
      {
        title: '塞尔达传说 王国之泪',
        subtitle: 'The Legend of Zelda: Tears of the Kingdom',
        region: '港版',
        condition: '几乎全新',
        purchaseDate: '2023-05-12',
        price: 398,
        purchaseChannel: '任天堂官方店',
        playMinutes: 5190,
        tags: ['开放世界', '冒险'],
        note: '首发入的港版，地图太耐玩了。',
        playLogs: [
          { date: date(-38), minutes: 180, note: '把地下地图又推了一截。' },
          { date: date(-12), minutes: 120, note: '' }
        ]
      },
      {
        title: '超级马力欧 奥德赛',
        subtitle: 'Super Mario Odyssey',
        region: '日版',
        condition: '正常使用',
        purchaseDate: '2017-10-27',
        price: 328,
        purchaseChannel: '日本亚马逊',
        playMinutes: 2520,
        tags: ['平台跳跃', '箱庭'],
        note: '每到一个新国度都舍不得推主线。',
        playLogs: [{ date: date(-60), minutes: 90, note: '收集月之石。' }]
      },
      {
        title: '集合啦！动物森友会',
        subtitle: 'Animal Crossing: New Horizons',
        region: '港版',
        condition: '正常使用',
        purchaseDate: '2020-03-20',
        price: 358,
        purchaseChannel: '线下电玩店',
        playMinutes: 12600,
        tags: ['休闲', '建造'],
        note: '岛上种了很多绣球花，偶尔回去看看。',
        playLogs: [{ date: date(-4), minutes: 45, note: '上线收菜、浇花。' }]
      },
      {
        title: '斯普拉遁 3',
        subtitle: 'Splatoon 3',
        region: '港版',
        condition: '几乎全新',
        purchaseDate: '2022-09-09',
        price: 298,
        purchaseChannel: '香港任天堂',
        playMinutes: 3870,
        tags: ['射击', '联机'],
        note: '打工模式比排位还上头。',
        playLogs: []
      },
      {
        title: '火焰纹章 结合',
        subtitle: 'Fire Emblem Engage',
        region: '港版',
        condition: '几乎全新',
        purchaseDate: '2023-01-20',
        price: 368,
        purchaseChannel: '线下电玩店',
        playMinutes: 2280,
        tags: ['战棋', '角色扮演'],
        note: '经典角色集合，战斗动画很帅。',
        playLogs: []
      },
      {
        title: '星之卡比 探索发现',
        subtitle: 'Kirby and the Forgotten Land',
        region: '日版',
        condition: '全新未拆',
        purchaseDate: '2022-03-25',
        price: 298,
        purchaseChannel: '友都八喜',
        playMinutes: 1080,
        tags: ['动作', '轻松'],
        note: '粉色恶魔，适合周末放松。',
        playLogs: [],
        loans: [{
          borrower: '小林',
          contact: '微信：lin_switch',
          loanDate: date(-42),
          dueDate: date(-6),
          returnedDate: '',
          note: '说好一周，结果玩上头了。'
        }]
      },
      {
        title: '宝可梦传说 阿尔宙斯',
        subtitle: 'Pokémon Legends: Arceus',
        region: '港版',
        condition: '正常使用',
        purchaseDate: '2022-01-28',
        price: 358,
        purchaseChannel: '香港任天堂',
        playMinutes: 3300,
        tags: ['冒险', '收集'],
        note: '开放世界抓宝可梦，很有新鲜感。',
        playLogs: []
      },
      {
        title: '异度神剑 3',
        subtitle: 'Xenoblade Chronicles 3',
        region: '港版',
        condition: '几乎全新',
        purchaseDate: '2022-07-29',
        price: 398,
        purchaseChannel: '任天堂官方店',
        playMinutes: 4350,
        tags: ['角色扮演', '剧情'],
        note: '第六章之后完全停不下来。',
        playLogs: [{ date: date(-20), minutes: 150, note: '推进主线到第六章。' }],
        loans: [{
          borrower: '阿哲',
          contact: '微信：zhe_switch',
          loanDate: date(-12),
          dueDate: date(18),
          returnedDate: '',
          note: '借他补完主线，约好月底还。'
        }]
      },
      {
        title: '马力欧卡丁车 8 豪华版',
        subtitle: 'Mario Kart 8 Deluxe',
        region: '港版',
        condition: '正常使用',
        purchaseDate: '2017-04-28',
        price: 328,
        purchaseChannel: '线下电玩店',
        playMinutes: 7200,
        tags: ['竞速', '聚会'],
        note: '朋友来家里必开的游戏。',
        playLogs: [{ date: date(-8), minutes: 60, note: '四个人跑了半天。' }],
        loans: [{
          borrower: '老王',
          contact: '电话：138****2210',
          loanDate: date(-95),
          dueDate: date(-65),
          returnedDate: date(-70),
          note: '聚会借走，已按时归还。',
          returnNote: '卡带和盒子都完好。'
        }]
      },
      {
        title: '密特罗德 生存恐惧',
        subtitle: 'Metroid Dread',
        region: '美版',
        condition: '几乎全新',
        purchaseDate: '2021-10-08',
        price: 328,
        purchaseChannel: '亚马逊',
        playMinutes: 990,
        tags: ['动作', '探索'],
        note: '紧张感拉满，地图设计很妙。',
        playLogs: []
      }
    ];

    return base.map((entry, index) => {
      const createdAt = new Date(Date.now() - (index + 1) * 86400000 * 18).toISOString();
      return normalizeGame({
        ...entry,
        id: 'demo_' + (index + 1),
        cover: '',
        createdAt,
        updatedAt: createdAt,
        loans: (entry.loans || []).map((loan) => ({ ...loan, id: uid('l') })),
        playLogs: (entry.playLogs || []).map((log) => ({ ...log, id: uid('p') }))
      });
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------
     PWA registration
     --------------------------------------------------------- */

  async function registerServiceWorker() {
    if (isNativeApp()) return;
    if (!('serviceWorker' in navigator)) return;
    const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (!secure) return;
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
      if (swRegistration.waiting) notifyUpdate(swRegistration);
      swRegistration.addEventListener('updatefound', () => {
        const worker = swRegistration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(swRegistration);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateReloading) window.location.reload();
      });
    } catch (error) {
      /* Service worker is optional. */
    }
  }

  function notifyUpdate(registration) {
    if (updateWaiting) return;
    updateWaiting = true;
    toast('新版本已准备好，刷新后生效。', 'info', {
      label: '立即更新',
      onClick: () => {
        updateReloading = true;
        const worker = registration.waiting || registration.installing;
        if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => window.location.reload(), 800);
      }
    });
  }

  async function installApp() {
    if (isNativeApp()) {
      toast('当前已经在卡匣安卓 App 中运行，不需要再安装。', 'info');
      return;
    }
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      toast('卡匣已经在独立窗口中运行。', 'info');
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') toast('正在安装卡匣…', 'success');
      } catch (error) { /* ignore */ }
      deferredInstallPrompt = null;
      return;
    }
    openInstallHelp();
  }

  /* ---------------------------------------------------------
     Event plumbing (continued in part 2)
     --------------------------------------------------------- */


  /* ---------------------------------------------------------
     Cover artwork
     --------------------------------------------------------- */

  function coverHTML(game, extraClass = '') {
    const palette = paletteFor(game && game.title);
    const image = safeImage(game && game.cover);
    const title = esc((game && game.title) || '未命名卡带');
    const subtitle = esc(((game && game.subtitle) || '实体卡带收藏').slice(0, 70));
    const region = esc((game && game.region) || '卡带');
    const initial = esc(Array.from((game && game.title) || '卡')[0] || '卡');
    return '<div class="cover ' + (image ? 'has-img ' : '') + extraClass + '" style="--c1:' + palette.c1 + ';--c2:' + palette.c2 + ';--c3:' + palette.c3 + '">' +
      (image ? '<img class="cover-img" src="' + esc(image) + '" alt="" loading="lazy" decoding="async">' : '') +
      '<div class="cover-top"><span>NINTENDO SWITCH</span><span>' + region + '</span></div>' +
      '<div class="cover-glyph">' + initial + '</div>' +
      '<div class="cover-info"><div class="cover-title">' + title + '</div><div class="cover-sub">' + subtitle + '</div></div>' +
    '</div>';
  }

  function placeholderCover(index) {
    const labels = [
      ['卡', '从一张卡带开始'],
      ['匣', '记录每一次借出'],
      ['+', '把故事放进来']
    ];
    const item = labels[index % labels.length];
    const palettes = [['#2c2a24', '#171613'], ['#34251f', '#1a1310'], ['#202c29', '#111917']];
    const palette = palettes[index % palettes.length];
    return '<div class="cover empty-cover" style="--c1:' + palette[0] + ';--c2:' + palette[1] + '">' +
      '<div class="cover-top"><span>KAXIA COLLECTION</span><span>EMPTY</span></div>' +
      '<div class="cover-glyph">' + item[0] + '</div>' +
      '<div class="cover-info"><div class="cover-title">' + item[1] + '</div><div class="cover-sub">YOUR CART. YOUR STORY.</div></div>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     Home
     --------------------------------------------------------- */

  function renderHome() {
    const total = state.games.length;
    const spend = totalSpent();
    const minutes = totalPlayMinutes();
    const activeRows = activeLoanRows();
    const overdue = activeRows.filter((row) => isOverdueLoan(row.loan)).length;
    const soldCount = state.games.filter((game) => Boolean(game.soldAt)).length;
    const soldRevenue = totalSoldRevenue();
    const totalTags = new Set();
    const regions = new Set();
    state.games.forEach((game) => {
      (game.tags || []).forEach((tag) => totalTags.add(tag));
      if (game.region) regions.add(game.region);
    });
    const latest = sortedGames(state.games, 'recent').slice(0, 3);
    const coverStack = [0, 1, 2].map((index) => latest[index] ? coverHTML(latest[index]) : placeholderCover(index)).join('');
    const recent = sortedGames(state.games, 'recent').slice(0, 5);
    const recentHTML = recent.length
      ? recent.map((game) => {
          const status = gameStatus(game);
          return '<div class="recent-item" data-action="open-game" data-id="' + esc(game.id) + '" role="button" tabindex="0">' +
            '<div class="recent-cover">' + coverHTML(game, 'cover-mini') + '</div>' +
            '<div class="recent-copy">' +
              '<div class="recent-title">' + esc(game.title) + '</div>' +
              '<div class="recent-meta"><span>' + icon('calendar') + fmtDate(game.purchaseDate) + '</span><span>' + (status.key === 'owned' ? '在库' : status.label) + '</span></div>' +
            '</div>' +
            '<div class="recent-price">' + (game.price ? fmtMoney(game.price) : '—') + '</div>' +
            icon('chevron-right', 'recent-arrow') +
          '</div>';
        }).join('')
      : '<div class="empty-mini">' + icon('book') + '<strong>还没有最近入库</strong>添加第一张卡带后会出现在这里。</div>';

    const miniLoans = activeRows.slice(0, 3).map(({ game, loan }) => {
      const due = loanDueText(loan);
      const overdueClass = isOverdueLoan(loan) ? ' overdue' : '';
      return '<div class="loan-mini" data-action="open-game" data-id="' + esc(game.id) + '" role="button" tabindex="0">' +
        '<div class="recent-cover">' + coverHTML(game, 'cover-mini') + '</div>' +
        '<div class="loan-mini-main">' +
          '<div class="loan-mini-title">' + esc(game.title) + '</div>' +
          '<div class="loan-mini-person">' + icon('user') + esc(loan.borrower || '未填写') + '</div>' +
          '<div class="loan-mini-due' + overdueClass + '">' + due + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    const monthPrefix = todayISO().slice(0, 7);
    const monthMinutes = state.games.reduce((sum, game) => sum + (game.playLogs || []).reduce((logSum, log) => {
      return log.date && log.date.slice(0, 7) === monthPrefix ? logSum + (Number(log.minutes) || 0) : logSum;
    }, 0), 0);
    const topGame = state.games.slice().sort((a, b) => (b.playMinutes || 0) - (a.playMinutes || 0))[0];
    const quickNote = monthMinutes
      ? '<strong>本月已记录 ' + fmtHours(monthMinutes) + '。</strong>' + (topGame && topGame.playMinutes ? '目前玩得最多的是《' + esc(topGame.title) + '》，累计 ' + fmtHours(topGame.playMinutes) + '。' : '继续保持记录，慢慢就能看到自己的游戏轨迹。')
      : '<strong>还没有游玩记录</strong>打开任意一张卡带，点「记录游玩」，就可以按次累计时长。';

    const stats = '<div class="stats-grid">' +
      '<div class="stat-card">' +
        '<span class="stat-icon stat-icon-red">' + icon('grid') + '</span>' +
        '<div class="stat-body"><div class="stat-label">收藏卡带</div><div class="stat-value">' + total + '<small>张</small></div><div class="stat-foot">' + regions.size + ' 个版本 · ' + totalTags.size + ' 个标签' + (soldCount ? ' · ' + soldCount + ' 张已售出' : '') + '</div></div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<span class="stat-icon stat-icon-green">' + icon('wallet') + '</span>' +
        '<div class="stat-body"><div class="stat-label">购入总价</div><div class="stat-value">' + fmtMoneyExact(spend) + '</div><div class="stat-foot">' + (total ? '平均每张 ' + fmtMoney(spend / total) : '还没有购入记录') + (soldRevenue ? ' · 已售出回血 ' + fmtMoney(soldRevenue) : '') + '</div></div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<span class="stat-icon stat-icon-blue">' + icon('clock') + '</span>' +
        '<div class="stat-body"><div class="stat-label">累计游玩</div><div class="stat-value">' + hoursNumber(minutes) + '<small>小时</small></div><div class="stat-foot">' + (total ? '平均每张 ' + hoursNumber(minutes / total) + ' 小时' : '从一次记录开始') + '</div></div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<span class="stat-icon stat-icon-amber">' + icon('handoff') + '</span>' +
        '<div class="stat-body"><div class="stat-label">正在出借</div><div class="stat-value">' + activeRows.length + '<small>张</small></div><div class="stat-foot">' + (overdue ? '<span class="overdue">其中 ' + overdue + ' 张已逾期</span>' : (activeRows.length ? '记得约定归还日期' : '目前没有外借')) + '</div></div>' +
      '</div>' +
    '</div>';

    if (total === 0) {
      return '<div class="page">' +
        '<section class="hero">' +
          '<div class="hero-copy">' +
            '<div class="eyebrow"><span class="eyebrow-dot"></span>LOCAL COLLECTION · ' + new Date().getFullYear() + '</div>' +
            '<h1>每一张卡带，<br><span class="accent">都有它的故事。</span></h1>' +
            '<p class="hero-desc">记录买下它的日期和价格，记下一起玩过的时长，也记下它借给了谁。<strong>数据只留在你的设备上。</strong></p>' +
            '<div class="hero-actions">' +
              '<button type="button" class="btn btn-primary btn-lg" data-action="add-game">' + icon('plus') + '添加第一张卡带</button>' +
              '<button type="button" class="btn btn-secondary btn-lg" data-action="load-demo">' + icon('sparkle') + '先看看示例</button>' +
            '</div>' +
          '</div>' +
          '<div class="hero-visual"><div class="hero-caption">' + icon('sparkle') + '从第一张开始</div><div class="hero-stack">' + coverStack + '</div></div>' +
        '</section>' +
        stats +
        '<section class="empty-state" style="margin-top:28px">' +
          '<div class="empty-art">' + icon('book') + '</div>' +
          '<h3>你的卡带柜还是空的</h3>' +
          '<p>手动添加第一张卡带，记录购买时间、价格和游玩时长。之后还可以登记借出、归还，所有记录都会留在这台设备上。</p>' +
          '<div class="empty-actions">' +
            '<button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加卡带</button>' +
            '<button type="button" class="btn btn-secondary" data-action="load-demo">' + icon('sparkle') + '载入示例数据</button>' +
          '</div>' +
          '<p class="empty-hint">示例数据只是演示，之后可以在设置里清空。</p>' +
        '</section>' +
      '</div>';
    }

    return '<div class="page">' +
      '<section class="hero">' +
        '<div class="hero-copy">' +
          '<div class="eyebrow"><span class="eyebrow-dot"></span>LOCAL COLLECTION · ' + new Date().getFullYear() + '</div>' +
          '<h1>每一张卡带，<br><span class="accent">都有它的故事。</span></h1>' +
          '<p class="hero-desc">已经收藏了 <strong>' + total + '</strong> 张卡带，为它们投入 <strong>' + fmtMoneyExact(spend) + '</strong>，累计游玩 <strong>' + fmtHours(minutes) + '</strong>。每一笔记录，都是你玩过的证明。</p>' +
          '<div class="hero-actions">' +
            '<button type="button" class="btn btn-primary btn-lg" data-action="add-game">' + icon('plus') + '添加卡带</button>' +
            '<a class="btn btn-secondary btn-lg" href="#/library">' + icon('grid') + '查看卡带库</a>' +
          '</div>' +
        '</div>' +
        '<div class="hero-visual"><div class="hero-caption">' + icon('sparkle') + '最近入库</div><div class="hero-stack">' + coverStack + '</div></div>' +
      '</section>' +
      stats +
      '<div class="home-cols">' +
        '<div class="home-col">' +
          '<section class="section" style="margin-top:0">' +
            '<div class="section-head"><div><h2 class="section-title">最近入库 <span class="count">' + Math.min(recent.length, 5) + '</span></h2><p class="section-sub">刚刚加入卡带柜的收藏</p></div><a class="text-link" href="#/library">全部卡带 ' + icon('arrow-right') + '</a></div>' +
            '<div class="recent-list">' + recentHTML + '</div>' +
          '</section>' +
          '<div class="quick-note">' + quickNote + '</div>' +
        '</div>' +
        '<div class="home-col side-col">' +
          '<section class="section" style="margin-top:0">' +
            '<div class="section-head"><div><h2 class="section-title">正在出借 <span class="count">' + activeRows.length + '</span></h2><p class="section-sub">记得在归还时登记</p></div><a class="text-link" href="#/loans">出借记录 ' + icon('arrow-right') + '</a></div>' +
            (miniLoans || '<div class="empty-mini">' + icon('handoff') + '<strong>目前没有外借</strong>卡带都在柜子里，安心。</div>') +
          '</section>' +
          (activeRows.length ? '<div class="quick-note"><strong>' + (overdue ? '有 ' + overdue + ' 张已经逾期。' : '所有借出都还在约定时间内。') + '</strong>点击“出借记录”可以查看完整的借出人和归还日期。</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     Library
     --------------------------------------------------------- */

  function statusCounts() {
    const counts = { all: state.games.length, owned: 0, lent: 0, overdue: 0, sold: 0 };
    state.games.forEach((game) => {
      const key = gameStatus(game).key;
      if (key === 'sold') counts.sold += 1;
      else if (key === 'overdue') { counts.overdue += 1; counts.lent += 1; }
      else if (key === 'lent') counts.lent += 1;
      else counts.owned += 1;
    });
    return counts;
  }

  function tagOptions() {
    const counts = {};
    state.games.forEach((game) => {
      (game.tags || []).forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; });
    });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'zh-CN')).map((name) => ({ name, count: counts[name] }));
  }

  function regionOptions() {
    const counts = {};
    state.games.forEach((game) => {
      const key = game.region || '未标注';
      counts[key] = (counts[key] || 0) + 1;
    });
    const names = Array.from(new Set(REGIONS.concat(Object.keys(counts))));
    return names.map((name) => ({ name, count: counts[name] || 0 }));
  }

  function renderLibrary() {
    if (!state.games.length) {
      return '<div class="page">' +
        '<div class="page-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>MY CARTridge SHELF</div><h1 class="page-title">卡带库</h1><p class="page-sub">所有实体卡带，都在这里。</p></div><div class="page-head-actions"><button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加卡带</button></div></div>' +
        '<div class="empty-state"><div class="empty-art">' + icon('grid') + '</div><h3>还没有卡带</h3><p>从第一张开始，把购买价格、游玩时间、借出记录都收进同一个地方。</p><div class="empty-actions"><button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加第一张</button><button type="button" class="btn btn-secondary" data-action="load-demo">' + icon('sparkle') + '载入示例</button></div></div>' +
      '</div>';
    }

    const counts = statusCounts();
    const options = regionOptions();
    const regionSelect = options.map((option) => '<option value="' + esc(option.name) + '"' + (filters.region === option.name ? ' selected' : '') + '>' + esc(option.name) + (option.count ? ' (' + option.count + ')' : '') + '</option>').join('');
    const platformSelect = PLATFORM_OPTIONS.map((platform) => '<option value="' + platform.key + '"' + (filters.platform === platform.key ? ' selected' : '') + '>' + platform.label + '</option>').join('');
    const cartridgeSelect = CARTRIDGE_OPTIONS.map((cartridge) => '<option value="' + cartridge.key + '"' + (filters.cartridge === cartridge.key ? ' selected' : '') + '>' + cartridge.label + '</option>').join('');
    const tagSelect = tagOptions().map((tag) => '<option value="' + esc(tag.name) + '"' + (filters.tag === tag.name ? ' selected' : '') + '>' + esc(tag.name) + ' (' + tag.count + ')</option>').join('');
    const initialGrid = gameGridHTML(filteredGames());
    return '<div class="page">' +
      '<div class="page-head">' +
        '<div><div class="eyebrow"><span class="eyebrow-dot"></span>MY CARTRIDGE SHELF</div><h1 class="page-title">卡带库</h1><p class="page-sub">' + state.games.length + ' 张卡带 · ' + (totalSpent() ? '购入总价 ' + fmtMoneyExact(totalSpent()) : '还没有填写购买价格') + '</p></div>' +
        '<div class="page-head-actions"><button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加卡带</button></div>' +
      '</div>' +
      '<div class="library-toolbar">' +
        '<form id="librarySearchForm" class="search-box" role="search">' + icon('search') + '<input id="librarySearch" class="search-input" type="search" enterkeyhint="search" inputmode="search" placeholder="搜索游戏、标签、借出人…" value="' + esc(filters.q) + '" autocomplete="off" aria-label="搜索卡带" aria-controls="libraryGrid"><button type="button" id="searchClear" class="search-clear" data-action="clear-query" aria-label="清除搜索"' + (filters.q ? '' : ' hidden') + '>' + icon('close') + '</button></form>' +
        '<div class="segmented" role="group" aria-label="筛选状态">' +
          '<button type="button" data-filter-status="all" class="' + (filters.status === 'all' ? 'active' : '') + '">全部 ' + counts.all + '</button>' +
          '<button type="button" data-filter-status="owned" class="' + (filters.status === 'owned' ? 'active' : '') + '">在库 ' + counts.owned + '</button>' +
          '<button type="button" data-filter-status="lent" class="' + (filters.status === 'lent' ? 'active' : '') + '">已出借 ' + counts.lent + (counts.overdue ? '<i class="count-dot"></i>' : '') + '</button>' +
          '<button type="button" data-filter-status="overdue" class="' + (filters.status === 'overdue' ? 'active' : '') + '">逾期 ' + counts.overdue + '</button>' +
          '<button type="button" data-filter-status="sold" class="' + (filters.status === 'sold' ? 'active' : '') + '">已售出 ' + counts.sold + '</button>' +
        '</div>' +
        '<div class="select-wrap"><select id="regionFilter" class="select" aria-label="按版本筛选"><option value="all">全部版本</option>' + regionSelect + '</select>' + icon('chevron-down') + '</div>' +
        '<div class="select-wrap"><select id="platformFilter" class="select" aria-label="按平台筛选"><option value="all">全部平台</option>' + platformSelect + '</select>' + icon('chevron-down') + '</div>' +
        '<div class="select-wrap"><select id="cartridgeFilter" class="select" aria-label="按卡带版本筛选"><option value="all">全部卡带</option>' + cartridgeSelect + '</select>' + icon('chevron-down') + '</div>' +
        '<div class="select-wrap"><select id="tagFilter" class="select" aria-label="按标签筛选"><option value="all">全部标签</option>' + tagSelect + '</select>' + icon('chevron-down') + '</div>' +
        '<div class="select-wrap"><select id="sortSelect" class="select" aria-label="排序方式">' +
          '<option value="recent"' + (filters.sort === 'recent' ? ' selected' : '') + '>最近入库</option>' +
          '<option value="purchase"' + (filters.sort === 'purchase' ? ' selected' : '') + '>购入时间</option>' +
          '<option value="play"' + (filters.sort === 'play' ? ' selected' : '') + '>游玩时长</option>' +
          '<option value="price"' + (filters.sort === 'price' ? ' selected' : '') + '>购入价格</option>' +
          '<option value="title"' + (filters.sort === 'title' ? ' selected' : '') + '>名称</option>' +
        '</select>' + icon('chevron-down') + '</div>' +
        '<div class="view-toggle" role="group" aria-label="视图">' +
          '<button type="button" data-action="toggle-view" data-view="grid" class="' + (state.preferences.view === 'grid' ? 'active' : '') + '" aria-label="网格视图">' + icon('grid-view') + '</button>' +
          '<button type="button" data-action="toggle-view" data-view="list" class="' + (state.preferences.view === 'list' ? 'active' : '') + '" aria-label="列表视图">' + icon('list') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="library-meta" id="libraryMeta">' + libraryMetaHTML() + '</div>' +
      '<div id="libraryGrid" class="game-grid' + (state.preferences.view === 'list' ? ' is-list' : '') + '">' + initialGrid + '</div>' +
    '</div>';
  }

  function libraryMetaHTML() {
    const rows = filteredGames();
    const tags = [];
    if (filters.q) tags.push('<span class="filter-tag">“' + esc(filters.q) + '”<button type="button" data-action="remove-filter" data-filter="q" aria-label="移除搜索">' + icon('close') + '</button></span>');
    if (filters.status !== 'all') tags.push('<span class="filter-tag">' + (STATUS_LABELS[filters.status] || filters.status) + '<button type="button" data-action="remove-filter" data-filter="status" aria-label="移除状态筛选">' + icon('close') + '</button></span>');
    if (filters.region !== 'all') tags.push('<span class="filter-tag">' + esc(filters.region) + '<button type="button" data-action="remove-filter" data-filter="region" aria-label="移除版本筛选">' + icon('close') + '</button></span>');
    if (filters.platform !== 'all') tags.push('<span class="filter-tag">' + (PLATFORM_LABELS[filters.platform] || filters.platform) + '<button type="button" data-action="remove-filter" data-filter="platform" aria-label="移除平台筛选">' + icon('close') + '</button></span>');
    if (filters.cartridge !== 'all') tags.push('<span class="filter-tag">' + (CARTRIDGE_LABELS[filters.cartridge] || filters.cartridge) + '<button type="button" data-action="remove-filter" data-filter="cartridge" aria-label="移除卡带版本筛选">' + icon('close') + '</button></span>');
    if (filters.tag !== 'all') tags.push('<span class="filter-tag">' + esc(filters.tag) + '<button type="button" data-action="remove-filter" data-filter="tag" aria-label="移除标签筛选">' + icon('close') + '</button></span>');
    return '<span>当前显示 <strong>' + rows.length + '</strong> / ' + state.games.length + ' 张' + tags.join('') + '</span>' +
      '<span>' + (state.preferences.view === 'list' ? '列表视图' : '网格视图') + '</span>';
  }

  function gameGridHTML(games) {
    if (!games.length) return emptyFilteredHTML();
    return games.map((game) => gameCardHTML(game, state.preferences.view === 'list')).join('');
  }

  function gameCardHTML(game, listMode) {
    const status = gameStatus(game);
    const loan = activeLoan(game);
    const cover = coverHTML(game);
    const platform = PLATFORM_OPTIONS.find((item) => item.key === (game.platformSupport || 'NS1')) || PLATFORM_OPTIONS[0];
    const cartridge = CARTRIDGE_OPTIONS.find((item) => item.key === (game.cartridgeType || 'NS1')) || CARTRIDGE_OPTIONS[0];
    const duplicates = duplicateCount(game);
    const cardBadges = '<div class="card-badges"><span class="card-region">' + esc(game.region || '未标注') + '</span><span class="card-platform">' + esc(platform.short) + '</span>' + (game.copyLabel ? '<span class="card-copy">' + esc(game.copyLabel) + '</span>' : '') + (duplicates > 1 ? '<span class="card-dup">同款 ×' + duplicates + '</span>' : '') + (game.marketPrice ? '<span class="card-market">二手 ' + fmtMoney(game.marketPrice) + '</span>' : '') + '</div>';
    const sub = game.subtitle ? '<div class="game-sub">' + esc(game.subtitle) + '</div>' : '';
    const price = '<span class="game-meta-item price">' + icon('wallet') + (game.price ? fmtMoney(game.price) : '—') + '</span>';
    const play = '<span class="game-meta-item play">' + icon('clock') + fmtHoursShort(game.playMinutes) + '</span>';
    const foot = game.soldAt
      ? '<span>售出 ' + fmtDate(game.soldAt) + (game.soldPrice ? ' · ' + fmtMoney(game.soldPrice) : '') + '</span>'
      : loan
        ? '<span class="lent-person">借给 ' + esc(loan.borrower || '朋友') + ' · ' + cartridge.short + '</span>'
        : '<span>' + fmtDate(game.purchaseDate) + ' · ' + esc(game.region || '未标注') + ' · ' + cartridge.short + '</span>';
    const more = !listMode
      ? '<button type="button" class="card-more" data-action="open-game" data-id="' + esc(game.id) + '" aria-label="查看详情">' + icon('more') + '</button>'
      : '';
    if (listMode) {
      return '<article class="game-card is-list" data-action="open-game" data-id="' + esc(game.id) + '" role="button" tabindex="0" aria-label="' + esc(game.title) + '">' +
        '<div class="card-cover-wrap">' + coverHTML(game, 'cover-bare') + '</div>' +
        '<div class="game-card-body">' +
          '<div><div class="game-title">' + esc(game.title) + '</div>' + sub + cardBadges + '</div>' +
          '<div class="game-meta">' + price + play + '</div>' +
          '<div class="game-foot">' + foot + '</div>' +
          '<div class="list-actions">' + statusBadge(game) + '</div>' +
          icon('chevron-right', 'list-arrow') +
        '</div>' +
      '</article>';
    }
    return '<article class="game-card" data-action="open-game" data-id="' + esc(game.id) + '" role="button" tabindex="0" aria-label="' + esc(game.title) + '">' +
      '<div class="card-cover-wrap"><span class="card-badge">' + statusBadge(game) + '</span>' + cover + more + '</div>' +
      '<div class="game-card-body">' +
        '<div class="game-title">' + esc(game.title) + '</div>' + sub + cardBadges +
        '<div class="game-meta">' + price + play + '</div>' +
        '<div class="game-foot">' + foot + '</div>' +
      '</div>' +
    '</article>';
  }

  function emptyFilteredHTML() {
    return '<div class="empty-state" style="grid-column:1/-1;min-height:260px"><div class="empty-art">' + icon('search') + '</div><h3>没有找到匹配的卡带</h3><p>换个关键词，或者清除筛选条件再看看。</p><div class="empty-actions"><button type="button" class="btn btn-secondary" data-action="clear-filters">' + icon('refresh') + '清除筛选</button></div></div>';
  }

  function paintLibrary() {
    const grid = $('#libraryGrid');
    if (!grid || !state.games.length) return;
    const rows = filteredGames();
    grid.className = 'game-grid' + (state.preferences.view === 'list' ? ' is-list' : '');
    grid.innerHTML = gameGridHTML(rows);
    const meta = $('#libraryMeta');
    if (meta) meta.innerHTML = libraryMetaHTML();
    const clear = $('#searchClear');
    if (clear) clear.hidden = !filters.q;
    $$('[data-filter-status]').forEach((button) => {
      button.classList.toggle('active', button.dataset.filterStatus === filters.status);
    });
    $$('[data-action="toggle-view"]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === state.preferences.view);
    });
    const region = $('#regionFilter');
    if (region) region.value = filters.region;
    const platform = $('#platformFilter');
    if (platform) platform.value = filters.platform;
    const cartridge = $('#cartridgeFilter');
    if (cartridge) cartridge.value = filters.cartridge;
    const tag = $('#tagFilter');
    if (tag) tag.value = filters.tag;
    const sort = $('#sortSelect');
    if (sort) sort.value = filters.sort;
  }

  /* ---------------------------------------------------------
     Loans
     --------------------------------------------------------- */

  function loanCardHTML(game, loan) {
    const overdue = isOverdueLoan(loan);
    return '<article class="loan-card' + (overdue ? ' overdue' : '') + '" data-action="open-game" data-id="' + esc(game.id) + '" role="button" tabindex="0">' +
      coverHTML(game, 'cover-mini') +
      '<div class="loan-game"><h3>' + esc(game.title) + '</h3><p>' + esc(game.region || '未标注版本') + ' · 借出 ' + fmtDate(loan.loanDate) + '</p><p class="loan-mobile-due' + (overdue ? ' overdue' : '') + '">' + loanDueText(loan) + (loan.dueDate ? ' · 约定 ' + fmtDate(loan.dueDate) : '') + '</p></div>' +
      '<div class="loan-person"><div class="loan-person-row"><span class="borrower-avatar">' + esc(Array.from(loan.borrower || '友')[0]) + '</span><span class="loan-person-name">' + esc(loan.borrower || '未填写') + '</span></div><div class="loan-person-contact">' + (loan.contact ? esc(loan.contact) : '未留联系方式') + '</div></div>' +
      '<div class="loan-dates"><span>约定归还</span><strong class="' + (overdue ? 'overdue-text' : '') + '">' + (loan.dueDate ? fmtDate(loan.dueDate) : '暂无') + '</strong><span class="' + (overdue ? 'overdue-text' : '') + '">' + loanDueText(loan) + '</span></div>' +
      '<div class="loan-actions"><button type="button" class="btn btn-secondary" data-action="return-loan" data-id="' + esc(game.id) + '">' + icon('check') + '<span>归还</span></button><button type="button" class="btn btn-ghost" data-action="open-game" data-id="' + esc(game.id) + '">' + icon('arrow-right') + '</button></div>' +
    '</article>';
  }

  function historyHTML(rows) {
    if (!rows.length) return '<div class="empty-mini">' + icon('clock') + '<strong>还没有归还记录</strong>登记归还后，这里会留下完整的历史。</div>';
    const table = '<table class="history-table"><thead><tr><th>卡带</th><th>借给</th><th>借出</th><th>归还</th><th>备注</th></tr></thead><tbody>' +
      rows.map(({ game, loan }) => '<tr data-action="open-game" data-id="' + esc(game.id) + '"><td><div class="history-game"><div class="thumb">' + coverHTML(game, 'cover-mini') + '</div><span>' + esc(game.title) + '</span></div></td><td>' + esc(loan.borrower || '—') + '</td><td class="muted">' + fmtDate(loan.loanDate) + '</td><td><span class="returned">' + fmtDate(loan.returnedDate) + '</span></td><td class="muted">' + (loan.returnNote || loan.note ? esc(loan.returnNote || loan.note).slice(0, 26) : '—') + '</td></tr>').join('') +
      '</tbody></table>';
    const mobile = '<div class="history-mobile">' + rows.map(({ game, loan }) => '<div class="history-mobile-card" data-action="open-game" data-id="' + esc(game.id) + '"><div class="history-mobile-top"><div class="thumb">' + coverHTML(game, 'cover-mini') + '</div><div class="history-mobile-title">' + esc(game.title) + '</div><span class="status-badge status-returned">已归还</span></div><div class="history-mobile-meta"><span>借给 ' + esc(loan.borrower || '—') + '</span><span>' + fmtDate(loan.loanDate) + ' → ' + fmtDate(loan.returnedDate) + '</span></div></div>').join('') + '</div>';
    return table + mobile;
  }

  function renderLoans() {
    const activeRows = activeLoanRows();
    const returnedRows = returnedLoanRows();
    const overdue = activeRows.filter((row) => isOverdueLoan(row.loan)).length;
    if (!state.games.length) {
      return '<div class="page">' +
        '<div class="page-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>LENDING LOG</div><h1 class="page-title">出借</h1><p class="page-sub">借给了谁、什么时候还，都记下来。</p></div></div>' +
        '<div class="empty-state"><div class="empty-art">' + icon('handoff') + '</div><h3>还没有卡带可借</h3><p>先添加一张卡带，之后就可以在卡带详情里登记借出和归还。</p><div class="empty-actions"><button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加卡带</button></div></div>' +
      '</div>';
    }

    const activeHTML = activeRows.length
      ? activeRows.map(({ game, loan }) => loanCardHTML(game, loan)).join('')
      : '<div class="empty-mini" style="padding:34px 18px">' + icon('check') + '<strong>所有卡带都在柜子里</strong>没有正在外借的卡带。想借给朋友时，打开卡带详情登记即可。</div>';

    return '<div class="page">' +
      '<div class="page-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>LENDING LOG</div><h1 class="page-title">出借</h1><p class="page-sub">把每一次借出和归还，都记得清清楚楚。</p></div><div class="page-head-actions"><a class="btn btn-secondary" href="#/library">' + icon('grid') + '去卡带库</a></div></div>' +
      '<div class="loan-summary">' +
        '<div class="loan-summary-card"><span class="stat-icon stat-icon-amber">' + icon('handoff') + '</span><div class="loan-summary-copy"><small>正在出借</small><strong>' + activeRows.length + ' <span>张</span></strong></div></div>' +
        '<div class="loan-summary-card' + (overdue ? ' warn' : '') + '"><span class="stat-icon ' + (overdue ? 'stat-icon-red' : 'stat-icon-green') + '">' + icon(overdue ? 'alert' : 'check') + '</span><div class="loan-summary-copy"><small>' + (overdue ? '已逾期' : '按时归还') + '</small><strong>' + overdue + ' <span>张</span></strong></div></div>' +
        '<div class="loan-summary-card"><span class="stat-icon stat-icon-blue">' + icon('clock') + '</span><div class="loan-summary-copy"><small>历史归还</small><strong>' + returnedRows.length + ' <span>次</span></strong></div></div>' +
      '</div>' +
      '<section class="section" style="margin-top:0"><div class="section-head"><div><h2 class="section-title">正在出借 <span class="count">' + activeRows.length + '</span></h2><p class="section-sub">逾期会在这里提醒你</p></div></div><div class="active-loans">' + activeHTML + '</div></section>' +
      '<section class="section"><div class="section-head"><div><h2 class="section-title">归还历史 <span class="count">' + returnedRows.length + '</span></h2><p class="section-sub">按归还日期倒序排列</p></div></div><div class="loan-history">' + historyHTML(returnedRows) + '</div></section>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     Statistics
     --------------------------------------------------------- */

  function yearChartHTML() {
    const map = new Map();
    state.games.forEach((game) => {
      if (!game.purchaseDate || !game.price) return;
      const year = game.purchaseDate.slice(0, 4);
      map.set(year, (map.get(year) || 0) + Number(game.price));
    });
    const years = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
    if (!years.length) return '<div class="empty-mini" style="padding:34px 16px">' + icon('wallet') + '<strong>还没有购入价格</strong>在编辑卡带时填上价格，就能看到年度花费。</div>';
    const max = Math.max.apply(null, years.map((entry) => entry[1])) || 1;
    return '<div class="bar-chart">' + years.map(([year, value]) => {
      const percent = Math.max(4, Math.round(value / max * 100));
      return '<div class="bar-col"><span class="bar-value">' + fmtMoney(value) + '</span><div class="bar-track"><div class="bar-fill" style="height:' + percent + '%"></div></div><span class="bar-label">' + year + '</span></div>';
    }).join('') + '</div>';
  }

  function rankHTML() {
    const rows = state.games.filter((game) => game.playMinutes > 0).sort((a, b) => b.playMinutes - a.playMinutes).slice(0, 5);
    if (!rows.length) return '<div class="empty-mini" style="padding:34px 16px">' + icon('clock') + '<strong>还没有游玩时长</strong>在卡带详情里记录一次，就会开始累积。</div>';
    const max = rows[0].playMinutes || 1;
    return '<div class="rank-list">' + rows.map((game, index) => '<div class="rank-item"><span class="rank-index">' + String(index + 1).padStart(2, '0') + '</span><div class="rank-main"><div class="rank-title"><span>' + esc(game.title) + '</span></div><div class="rank-bar"><i style="width:' + Math.max(6, Math.round(game.playMinutes / max * 100)) + '%"></i></div></div><span class="rank-hours">' + fmtHours(game.playMinutes) + '</span></div>').join('') + '</div>';
  }

  function donutHTML() {
    const map = new Map();
    state.games.forEach((game) => {
      const region = game.region || '未标注';
      map.set(region, (map.get(region) || 0) + 1);
    });
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const total = state.games.length || 1;
    const colors = ['var(--red)', 'var(--green)', 'var(--blue)', 'var(--amber)', '#8a6a4a', '#c9beb0'];
    let cursor = 0;
    const stops = entries.map((entry, index) => {
      const start = cursor / total * 100;
      cursor += entry[1];
      const end = cursor / total * 100;
      return colors[index % colors.length] + ' ' + start + '% ' + end + '%';
    }).join(', ');
    const legend = entries.map((entry, index) => '<div class="legend-row"><i class="legend-dot" style="background:' + colors[index % colors.length] + '"></i><span>' + esc(entry[0]) + '</span><b>' + entry[1] + ' 张</b></div>').join('');
    return '<div class="donut-wrap"><div class="donut" style="background:conic-gradient(' + stops + ')"><div class="donut-center"><strong>' + state.games.length + '</strong><span>张卡带</span></div></div><div class="donut-legend">' + (legend || '<div class="legend-row"><span>还没有版本信息</span></div>') + '</div></div>';
  }

  function insightsHTML() {
    const games = state.games;
    const priciest = games.slice().sort((a, b) => (b.price || 0) - (a.price || 0))[0];
    const mostPlayed = games.slice().sort((a, b) => (b.playMinutes || 0) - (a.playMinutes || 0))[0];
    const oldest = games.filter((game) => game.purchaseDate).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))[0];
    const newest = sortedGames(games, 'recent')[0];
    const items = [
      { label: '最贵的一张', title: priciest && priciest.price ? priciest.title : '还没记录价格', meta: priciest && priciest.price ? fmtMoney(priciest.price) : '填上价格后显示' },
      { label: '玩得最多', title: mostPlayed && mostPlayed.playMinutes ? mostPlayed.title : '还没记录游玩', meta: mostPlayed && mostPlayed.playMinutes ? fmtHours(mostPlayed.playMinutes) : '记录一次时长后显示' },
      { label: '最早购入', title: oldest ? oldest.title : '还没记录日期', meta: oldest ? fmtDateLong(oldest.purchaseDate) : '填上购入日期后显示' },
      { label: '最近入库', title: newest ? newest.title : '还没有卡带', meta: newest ? fmtDate(newest.createdAt) : '添加第一张卡带' }
    ];
    return '<div class="insight-grid">' + items.map((item) => '<div class="insight"><small>' + item.label + '</small><strong>' + esc(item.title) + '</strong><span>' + esc(item.meta) + '</span></div>').join('') + '</div>';
  }

  function renderStats() {
    if (!state.games.length) {
      return '<div class="page">' +
        '<div class="page-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>COLLECTION INSIGHTS</div><h1 class="page-title">统计</h1><p class="page-sub">看看你的收藏和游玩时间。</p></div></div>' +
        '<div class="empty-state"><div class="empty-art">' + icon('chart') + '</div><h3>还没有数据可以统计</h3><p>添加几张卡带并填上购入价格、游玩时长，这里会自动生成花费和游玩排行。</p><div class="empty-actions"><button type="button" class="btn btn-primary" data-action="add-game">' + icon('plus') + '添加卡带</button><button type="button" class="btn btn-secondary" data-action="load-demo">' + icon('sparkle') + '载入示例</button></div></div>' +
      '</div>';
    }
    const spend = totalSpent();
    const minutes = totalPlayMinutes();
    const avgPrice = state.games.length ? spend / state.games.length : 0;
    const costPerHour = minutes ? spend / (minutes / 60) : 0;
    const earliest = state.games.filter((game) => game.purchaseDate).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))[0];
    const earliestYear = earliest ? Number(earliest.purchaseDate.slice(0, 4)) : new Date().getFullYear();
    const spanYears = Math.max(1, new Date().getFullYear() - earliestYear + 1);
    return '<div class="page">' +
      '<div class="page-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span>COLLECTION INSIGHTS</div><h1 class="page-title">统计</h1><p class="page-sub">' + state.games.length + ' 张卡带 · ' + fmtHours(minutes) + ' 的游玩记录</p></div><div class="page-head-actions"><button type="button" class="btn btn-secondary" data-action="open-settings">' + icon('download') + '导出数据</button></div></div>' +
      '<div class="stats-layout">' +
        '<section class="stats-panel panel"><div class="stats-panel-head"><div><h3>年度购入花费</h3><p>按购买年份汇总</p></div><span class="pill">' + icon('wallet') + fmtMoneyExact(spend) + '</span></div>' + yearChartHTML() + '</section>' +
        '<section class="stats-panel panel"><div class="stats-panel-head"><div><h3>游玩时长排行</h3><p>最常打开的五张卡带</p></div><span class="pill">' + icon('clock') + fmtHours(minutes) + '</span></div>' + rankHTML() + '</section>' +
        '<section class="stats-panel panel"><div class="stats-panel-head"><div><h3>版本分布</h3><p>港版、日版还是其他？</p></div></div>' + donutHTML() + '</section>' +
        '<section class="stats-panel panel"><div class="stats-panel-head"><div><h3>收藏之最</h3><p>一些关于你的小事实</p></div></div>' + insightsHTML() + '</section>' +
      '</div>' +
      '<div class="stats-bottom">' +
        '<div class="metric-card"><small>平均购入价</small><strong>' + fmtMoney(avgPrice) + '</strong><p>按所有已填价格的卡带计算</p></div>' +
        '<div class="metric-card"><small>每小时成本</small><strong>' + (costPerHour ? fmtMoney(costPerHour) : '—') + '</strong><p>购入总价 ÷ 累计游玩小时</p></div>' +
        '<div class="metric-card"><small>平均游玩</small><strong>' + hoursNumber(minutes / state.games.length) + ' <em>小时</em></strong><p>每张卡带的平均时长</p></div>' +
        '<div class="metric-card"><small>收藏跨度</small><strong>' + spanYears + ' <em>年</em></strong><p>从 ' + earliestYear + ' 年开始的收藏</p></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     Detail drawer
     --------------------------------------------------------- */


  function nintendoDetailHTML(game) {
    const appIds = game.nintendoAppIds || [];
    const imported = Math.max(0, Number(game.nintendoImportedMinutes) || 0);
    if (!appIds.length && !imported) return '';
    const totals = nintendoPlayerTotals(game);
    const players = totals.players.length
      ? totals.players.map((player) => '<span class="chip">' + icon('user') + esc(player.name) + ' · ' + fmtHours(player.minutes) + '</span>').join('')
      : '<span class="chip">还没有玩家明细</span>';
    return '<section class="drawer-section"><div class="drawer-section-head"><h3>任天堂同步</h3>' +
      (nintendoApi() ? '<button type="button" class="text-link" data-action="nintendo-sync-all">' + icon('refresh') + '同步账号</button>' : '') +
      '</div><div class="nintendo-game-card">' +
        '<div class="nintendo-game-total"><strong>' + fmtHours(totals.total || imported) + '</strong><small>已从任天堂导入</small></div>' +
        '<div class="nintendo-players">' + players + '</div>' +
        '<p>按主机玩家分别统计。修改卡带资料不会清除这些记录；可以在设置里解除任天堂账号。</p>' +
      '</div></section>';
  }


  function photoLabelOptions(selected) {
    return PHOTO_LABELS.map((label) => '<option value="' + esc(label) + '"' + (label === selected ? ' selected' : '') + '>' + esc(label) + '</option>').join('');
  }

  function photosHTML(game) {
    const photos = game.photos || [];
    if (!photos.length) {
      return '<section class="drawer-section"><div class="drawer-section-head"><h3>卡带状态</h3>' +
        '<button type="button" class="text-link" data-action="manage-photos" data-id="' + esc(game.id) + '">' + icon('plus') + '添加图片</button></div>' +
        '<div class="photo-empty">' + icon('image') + '<span>还没有实物图片。可以保存卡带盒、正面、背面和侧面划痕，方便日后核对。</span></div></section>';
    }
    return '<section class="drawer-section"><div class="drawer-section-head"><h3>卡带状态 <span class="photo-count">' + photos.length + '</span></h3>' +
      '<button type="button" class="text-link" data-action="manage-photos" data-id="' + esc(game.id) + '">' + icon('edit') + '管理图片</button></div>' +
      '<div class="photo-strip">' + photos.slice(0, 6).map((photo, index) => {
        return '<button type="button" class="photo-strip-item" data-action="photo-view" data-id="' + esc(game.id) + '" data-index="' + index + '">' +
          '<img src="' + esc(photo.data) + '" alt="" loading="lazy">' +
          '<span>' + esc(photo.label || '其他') + '</span>' +
        '</button>';
      }).join('') + '</div></section>';
  }

  function photoManagerHTML(game) {
    const photos = game.photos || [];
    return '<div class="photo-manager-head"><div><strong>' + photos.length + ' / 12 张</strong><small>图片会压缩后保存在本机，不上传。</small></div>' +
      '<label class="btn btn-primary btn-sm" for="photoFiles">' + icon('plus') + '添加图片</label>' +
      '<input id="photoFiles" type="file" accept="image/*" multiple hidden' + (photos.length >= 12 ? ' disabled' : '') + '></div>' +
      (photos.length ? '<div class="photo-grid">' + photos.map((photo, index) => {
        return '<div class="photo-card">' +
          '<button type="button" class="photo-thumb" data-photo-view="' + index + '" aria-label="查看图片">' +
            '<img src="' + esc(photo.data) + '" alt="" loading="lazy">' +
          '</button>' +
          '<select class="photo-label" data-photo-label="' + esc(photo.id) + '" aria-label="图片类型">' + photoLabelOptions(photo.label) + '</select>' +
          '<button type="button" class="photo-delete" data-photo-delete="' + esc(photo.id) + '" aria-label="删除图片">' + icon('trash') + '</button>' +
        '</div>';
      }).join('') + '</div>' : '<div class="empty-mini" style="padding:30px 18px">' + icon('image') + '<strong>还没有图片</strong>添加卡带盒、正面、背面、侧面或划痕照片。</div>') +
      '<p class="photo-tip">建议分别拍一张卡带盒整体、卡带正面、卡带背面和侧面划痕。最多 12 张。</p>';
  }

  function openPhotoManager(gameId) {
    const game = state.games.find((item) => item.id === gameId);
    if (!game) return;
    let adding = false;
    createModal({
      title: '卡带实物图片',
      subtitle: '记录卡带盒状态、正反面和侧面划痕。',
      size: 'lg',
      body: '<div id="photoManagerBody"></div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>完成</button>',
      onMount: (layer) => {
        const mount = () => {
          const body = layer.querySelector('#photoManagerBody');
          body.innerHTML = photoManagerHTML(game);
          const input = body.querySelector('#photoFiles');
          if (input) {
            input.addEventListener('change', async () => {
              if (adding) return;
              const files = Array.from(input.files || []);
              if (!files.length) return;
              adding = true;
              const slots = Math.max(0, 12 - (game.photos || []).length);
              let count = 0;
              try {
                for (const file of files.slice(0, slots)) {
                  const data = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8, limit: 1000000 });
                  game.photos = Array.isArray(game.photos) ? game.photos : [];
                  game.photos.push({ id: uid('ph'), data, label: '其他', createdAt: new Date().toISOString() });
                  count += 1;
                }
                game.updatedAt = new Date().toISOString();
                scheduleSave(0);
                mount();
                if (detailId === gameId) refreshDrawer();
                toast(count ? '已添加 ' + count + ' 张实物图片。' : '最多保存 12 张图片。', count ? 'success' : 'info');
              } catch (error) {
                toast(error && error.message ? error.message : '图片添加失败', 'error');
              } finally {
                adding = false;
              }
            });
          }
          body.querySelectorAll('[data-photo-label]').forEach((select) => {
            select.addEventListener('change', () => {
              const photo = (game.photos || []).find((item) => item.id === select.dataset.photoLabel);
              if (!photo) return;
              photo.label = select.value;
              game.updatedAt = new Date().toISOString();
              scheduleSave(0);
              if (detailId === gameId) refreshDrawer();
            });
          });
          body.querySelectorAll('[data-photo-delete]').forEach((button) => {
            button.addEventListener('click', () => {
              game.photos = (game.photos || []).filter((item) => item.id !== button.dataset.photoDelete);
              game.updatedAt = new Date().toISOString();
              scheduleSave(0);
              mount();
              if (detailId === gameId) refreshDrawer();
              toast('已删除这张图片。', 'info');
            });
          });
          body.querySelectorAll('[data-photo-view]').forEach((button) => {
            button.addEventListener('click', () => openPhotoViewer(gameId, Number(button.dataset.photoView)));
          });
        };
        mount();
      }
    });
  }

  function openPhotoViewer(gameId, index) {
    const game = state.games.find((item) => item.id === gameId);
    if (!game || !(game.photos || []).length) return;
    let current = Math.max(0, Math.min(index, game.photos.length - 1));
    createModal({
      title: '实物图片',
      size: 'lg',
      body: '<div id="photoViewer"></div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>关闭</button>',
      onMount: (layer) => {
        const render = () => {
          const photo = game.photos[current];
          const viewer = layer.querySelector('#photoViewer');
          viewer.innerHTML = '<div class="photo-view-frame"><img src="' + esc(photo.data) + '" alt="' + esc(photo.label || '卡带实物') + '"></div>' +
            '<div class="photo-view-foot"><span class="chip">' + icon('tag') + esc(photo.label || '其他') + '</span><span>' + (current + 1) + ' / ' + game.photos.length + '</span></div>' +
            '<div class="photo-view-nav"><button type="button" class="btn btn-secondary btn-sm" data-photo-prev' + (current === 0 ? ' disabled' : '') + '>' + icon('arrow-left') + '上一张</button><button type="button" class="btn btn-secondary btn-sm" data-photo-next' + (current === game.photos.length - 1 ? ' disabled' : '') + '>下一张' + icon('arrow-right') + '</button></div>';
          const prev = viewer.querySelector('[data-photo-prev]');
          const next = viewer.querySelector('[data-photo-next]');
          if (prev) prev.addEventListener('click', () => { current = Math.max(0, current - 1); render(); });
          if (next) next.addEventListener('click', () => { current = Math.min(game.photos.length - 1, current + 1); render(); });
        };
        render();
      }
    });
  }

  function mostCommon(values) {
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    let best = '';
    let bestCount = 0;
    counts.forEach((count, value) => {
      if (count > bestCount) { best = value; bestCount = count; }
    });
    return best;
  }

  function parseCartridgeCodeFromOcr(value) {
    const direct = parseCartridgeCode(value);
    if (direct) return direct;
    const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = compact.match(/(L[ABNP])H/);
    if (match) {
      const rule = CARTRIDGE_CODE_RULES[match[1]];
      if (rule) return { prefix: match[1], ...rule };
    }
    if (compact.includes('HAC008')) {
      return { prefix: 'HAC-008', ...CARTRIDGE_CODE_RULES['HAC-008'] };
    }
    return null;
  }

  async function photoSourceForScan(value) {
    const source = String(value || '');
    if (/^data:image\//i.test(source)) return source;
    if (!/^https?:\/\//i.test(source)) throw new Error('照片不是可读取的图片数据');
    const response = await fetch(source, { mode: 'cors' });
    if (!response.ok) throw new Error('照片下载失败');
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('照片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function recognizeSavedPhotos(gameId) {
    const game = state.games.find((item) => item.id === gameId);
    if (!game) return;
    const photos = Array.isArray(game.photos) ? game.photos : [];
    if (!photos.length) {
      toast('这张卡带还没有保存照片，无法识别。请先添加卡带盒/标签照片。', 'error');
      return;
    }
    const scanner = isNativeApp() ? nativePlugin('RegionScanner') : null;
    if (!scanner) {
      toast('照片识别只在安卓 App 中可用。', 'error');
      return;
    }
    if (game._recognizing) return;
    game._recognizing = true;
    toast('正在逐张识别 ' + photos.length + ' 张保存的照片…', 'info');
    const regions = [];
    const codes = [];
    let readable = 0;
    let failed = 0;
    try {
      for (const photo of photos) {
        try {
          const image = await photoSourceForScan(photo.data);
          const result = await scanner.scan({ image });
          const text = result && result.text ? String(result.text) : '';
          if (!text.trim()) { failed += 1; continue; }
          readable += 1;
          detectRegionCandidates(text).forEach((label) => regions.push(label));
          const code = parseCartridgeCodeFromOcr(text);
          if (code) codes.push(code);
        } catch (error) {
          failed += 1;
        }
      }
      if (!readable) {
        toast('所有照片都没有识别出文字，无法判断版本或编号。', 'error');
        return;
      }
      const region = mostCommon(regions);
      const codePrefix = mostCommon(codes.map((item) => item.prefix));
      const code = codes.find((item) => item.prefix === codePrefix) || null;
      if (!region && !code) {
        toast('所有照片都没有识别到版本或卡带编号。', 'error');
        return;
      }
      const changes = [];
      if (region && game.region !== region) {
        game.region = region;
        changes.push('版本：' + region);
      }
      if (code) {
        game.cartridgeCode = code.prefix;
        game.platformSupport = code.platformSupport;
        game.cartridgeType = code.cartridgeType;
        changes.push('编号：' + code.prefix + '（' + code.label + '）');
      }
      if (!changes.length) {
        toast('识别结果和当前资料一致，没有需要修改的内容。', 'info');
        return;
      }
      game.updatedAt = new Date().toISOString();
      scheduleSave(0);
      refreshDrawer();
      toast('已从 ' + readable + ' 张照片识别：' + changes.join('；') + (failed ? '（' + failed + ' 张无文字）' : ''), 'success');
    } finally {
      delete game._recognizing;
    }
  }

  function drawerHTML(game) {
    const status = gameStatus(game);
    const loan = status.loan;
    const sold = Boolean(game.soldAt);
    const loans = (game.loans || []).slice().sort((a, b) => String(b.loanDate || '').localeCompare(String(a.loanDate || '')));
    const logs = (game.playLogs || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || ''))).slice(0, 5);
    const ring = clamp(Math.round((Number(game.playMinutes) || 0) / 6000 * 100), 0, 100);
    const tags = (game.tags || []).map((tag) => '<span class="chip">' + icon('tag') + esc(tag) + '</span>').join('');
    const activeAction = sold
      ? '<button type="button" class="btn btn-secondary" data-action="cancel-sale" data-id="' + esc(game.id) + '">' + icon('refresh') + '取消售出</button>'
      : loan
        ? '<button type="button" class="btn btn-primary" data-action="return-loan" data-id="' + esc(game.id) + '">' + icon('check') + '登记归还</button>'
        : '<button type="button" class="btn btn-primary" data-action="open-loan" data-id="' + esc(game.id) + '">' + icon('handoff') + '登记出借</button>';
    const logsHTML = logs.length
      ? '<div class="log-list">' + logs.map((log) => '<div class="log-row"><span class="log-icon">' + icon('clock') + '</span><div class="log-copy"><strong>' + esc(log.note || '游玩记录') + '</strong><small>' + fmtDate(log.date) + '</small></div><span class="log-time">+' + fmtHoursShort(log.minutes) + '</span></div>').join('') + '</div>'
      : '<div class="log-empty">还没有单次游玩记录。点「记录游玩」记下这一次。</div>';
    const marketDiff = game.marketPrice && game.price ? game.marketPrice - game.price : 0;
    const marketPercent = game.marketPrice && game.price ? Math.round(Math.abs(marketDiff) / game.price * 100) : 0;
    const marketHTML = '<section class="drawer-section"><div class="drawer-section-head"><h3>二手参考价</h3><button type="button" class="text-link" data-action="open-market" data-id="' + esc(game.id) + '">' + icon(game.marketPrice ? 'edit' : 'plus') + (game.marketPrice ? '更新' : '记录') + '</button></div>' + (game.marketPrice ? '<div class="market-card"><div class="market-price"><strong>' + fmtMoneyExact(game.marketPrice) + '</strong><small>' + esc(game.marketSource || '手动记录') + ' · ' + fmtDate(game.marketUpdatedAt) + '</small></div>' + (game.price ? '<div class="market-diff ' + (marketDiff > 0 ? 'up' : marketDiff < 0 ? 'down' : '') + '">' + (marketDiff > 0 ? '高于入手价 ' : marketDiff < 0 ? '低于入手价 ' : '与入手价持平') + (marketDiff ? fmtMoneyExact(Math.abs(marketDiff)) + ' (' + marketPercent + '%)' : '') + '</div>' : '') + (game.marketNote ? '<p>' + esc(game.marketNote) + '</p>' : '') + '</div>' : '<div class="market-empty">还没有记录当前二手价。可以复制搜索词去闲鱼/淘宝查询后填写。</div></section>');
    const sameGames = duplicateGames(game).filter((item) => item.id !== game.id).sort((a, b) => String(a.region || '').localeCompare(String(b.region || ''), 'zh-CN') || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const sameHTML = sameGames.length
      ? '<section class="drawer-section"><div class="drawer-section-head"><h3>同款卡带 <span class="photo-count">' + sameGames.length + '</span></h3></div><div class="same-copy-list">' + sameGames.map((item) => {
          const itemCartridge = CARTRIDGE_LABELS[item.cartridgeType] || CARTRIDGE_LABELS.NS1;
          return '<div class="same-copy-row" data-action="open-game" data-id="' + esc(item.id) + '" role="button" tabindex="0"><div class="same-copy-cover">' + coverHTML(item, 'cover-mini') + '</div><div class="same-copy-copy"><strong>' + esc(item.region || '未标注') + (item.copyLabel ? ' · ' + esc(item.copyLabel) : '') + '</strong><small>' + esc(itemCartridge) + ' · ' + esc(item.condition || '未标注成色') + '</small></div>' + statusBadge(item) + '</div>';
        }).join('') + '</div></section>'
      : '';
    const loansHTML = loans.length
      ? '<div class="loan-history-list">' + loans.map((entry) => {
          const returned = Boolean(entry.returnedDate);
          return '<div class="loan-history-item"><div class="loan-history-top"><div class="loan-history-person"><span class="borrower-avatar">' + esc(Array.from(entry.borrower || '友')[0]) + '</span>' + esc(entry.borrower || '未填写') + '</div><span class="status-badge ' + (returned ? 'status-returned' : (isOverdueLoan(entry) ? 'status-overdue' : 'status-lent')) + '">' + (returned ? '已归还' : (isOverdueLoan(entry) ? '已逾期' : '借出中')) + '</span></div><div class="loan-history-meta">' + fmtDate(entry.loanDate) + ' 借出' + (entry.dueDate ? ' · 约定 ' + fmtDate(entry.dueDate) + ' 归还' : '') + (returned ? ' · ' + fmtDate(entry.returnedDate) + ' 归还' : '') + '</div>' + (entry.note ? '<div class="loan-history-note">' + esc(entry.note) + '</div>' : '') + (entry.returnNote ? '<div class="loan-history-note">归还备注：' + esc(entry.returnNote) + '</div>' : '') + '</div>';
        }).join('') + '</div>'
      : '<div class="log-empty">还没有出借记录。' + (loan ? '' : '点「登记出借」开始记录。') + '</div>';

    return '<button type="button" class="drawer-close" data-action="close-drawer" aria-label="关闭详情">' + icon('close') + '</button>' +
      '<div class="drawer-hero">' +
        '<div class="drawer-hero-cover">' + coverHTML(game, 'cover-bare') + '</div>' +
        '<div class="drawer-hero-copy">' + statusBadge(game) + '<h2 class="drawer-title">' + esc(game.title) + '</h2><div class="drawer-sub">' + esc(game.subtitle || 'NINTENDO SWITCH CARTRIDGE') + '</div>' + (tags ? '<div class="drawer-tags">' + tags + '</div>' : '') + '</div>' +
      '</div>' +
      '<div class="drawer-body">' +
        '<div class="drawer-actions">' +
          '<button type="button" class="btn btn-secondary" data-action="edit-game" data-id="' + esc(game.id) + '">' + icon('edit') + '编辑资料</button>' +
          '<button type="button" class="btn btn-secondary" data-action="recognize-photos" data-id="' + esc(game.id) + '">' + icon('image') + '识别照片</button>' +
          '<button type="button" class="btn btn-secondary" data-action="add-play" data-id="' + esc(game.id) + '">' + icon('plus') + '记录游玩</button>' +
          activeAction +
          '<button type="button" class="btn btn-ghost" data-action="delete-game" data-id="' + esc(game.id) + '" aria-label="删除卡带">' + icon('trash') + '</button>' +
        '</div>' +
        (loan ? '<div class="form-note" style="margin-bottom:20px">' + icon('info') + '<span>当前借给 <b>' + esc(loan.borrower || '朋友') + '</b>，' + loanDueText(loan) + '。</span></div>' : '') +
        '<section class="drawer-section" style="margin-top:0"><div class="drawer-section-head"><h3>购入信息</h3><button type="button" class="text-link" data-action="open-sale" data-id="' + esc(game.id) + '">' + icon(sold ? 'edit' : 'tag') + (sold ? '编辑售出' : '标记售出') + '</button></div><div class="info-grid">' +
          '<div class="info-cell"><small>' + icon('calendar') + '购入日期</small><strong>' + fmtDateLong(game.purchaseDate) + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('wallet') + '购入价格</small><strong class="num">' + (game.price ? fmtMoneyExact(game.price) : '未记录') + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('book') + '购买渠道</small><strong>' + esc(game.purchaseChannel || '未记录') + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('grid') + '版本</small><strong>' + esc(game.region || '未标注') + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('tag') + '卡带编号</small><strong class="code-value">' + esc(game.cartridgeCode || '未记录') + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('gamepad') + '平台支持</small><strong>' + esc((PLATFORM_LABELS[game.platformSupport] || PLATFORM_LABELS.NS1)) + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('grid') + '卡带版本</small><strong>' + esc((CARTRIDGE_LABELS[game.cartridgeType] || CARTRIDGE_LABELS.NS1)) + '</strong></div>' +
          '<div class="info-cell"><small>' + icon('sparkle') + '成色</small><strong>' + esc(game.condition || '未标注') + '</strong></div>' +
        '</div></section>' +
        (sold ? '<section class="drawer-section"><div class="drawer-section-head"><h3>售出信息</h3><button type="button" class="text-link" data-action="open-sale" data-id="' + esc(game.id) + '">' + icon('edit') + '编辑</button></div><div class="info-grid"><div class="info-cell"><small>' + icon('calendar') + '售出日期</small><strong>' + fmtDateLong(game.soldAt) + '</strong></div><div class="info-cell"><small>' + icon('wallet') + '售出价格</small><strong class="num">' + (game.soldPrice ? fmtMoneyExact(game.soldPrice) : '未记录') + '</strong></div><div class="info-cell"><small>' + icon('user') + '去向</small><strong>' + esc(game.soldTo || '未记录') + '</strong></div><div class="info-cell full"><small>' + icon('book') + '备注</small><strong>' + esc(game.saleNote || '无') + '</strong></div></div></section>' : '') +
        marketHTML +
        sameHTML +
        photosHTML(game) +
        '<section class="drawer-section"><div class="drawer-section-head"><h3>游玩时长</h3><button type="button" class="text-link" data-action="add-play" data-id="' + esc(game.id) + '">' + icon('plus') + '记录一次</button></div>' +
          '<div class="play-summary"><div class="play-ring" style="--p:' + ring + '"><strong>' + ring + '%</strong></div><div class="play-copy"><small>累计游玩</small><strong>' + hoursNumber(game.playMinutes) + ' <span style="font-family:var(--sans);font-size:11px;color:var(--muted);letter-spacing:0">小时</span></strong><p>' + (game.playMinutes ? '按 100 小时进度环展示' : '还没有记录游玩时长') + '</p></div></div>' +
          logsHTML +
        '</section>' +
        nintendoDetailHTML(game) +
        '<section class="drawer-section"><div class="drawer-section-head"><h3>出借记录</h3><button type="button" class="text-link" data-action="' + (loan ? 'return-loan' : 'open-loan') + '" data-id="' + esc(game.id) + '">' + icon(loan ? 'check' : 'plus') + (loan ? '登记归还' : '登记出借') + '</button></div>' + loansHTML + '</section>' +
        '<section class="drawer-section"><div class="drawer-section-head"><h3>备注</h3></div><div class="note-box' + (game.note ? '' : ' note-empty') + '">' + (game.note ? esc(game.note) : '还没有备注。写下一点关于这张卡带的记忆吧。') + '</div></section>' +
        '<div style="margin-top:22px;font-size:9.5px;color:var(--muted-2)">添加于 ' + fmtDate(game.createdAt) + ' · 最近更新 ' + fmtDateTime(game.updatedAt) + '</div>' +
      '</div>';
  }


  /* ---------------------------------------------------------
     Add / edit game
     --------------------------------------------------------- */

  function openGameForm(id = null) {
    const existing = id ? state.games.find((game) => game.id === id) : null;
    const editing = Boolean(existing);
    const game = existing || {
      title: '', subtitle: '', region: '港版', cartridgeCode: '', platformSupport: 'NS1', cartridgeType: 'NS1', condition: '', purchaseDate: '', price: 0, copyLabel: '',
      purchaseChannel: '', playMinutes: 0, tags: [], note: '', cover: ''
    };
    let cover = game.cover || '';
    const formId = 'gameForm_' + Date.now();
    const loan = existing ? activeLoan(existing) : null;
    const regionNames = Array.from(new Set(REGIONS.concat(game.region ? [game.region] : [])));
    const regionOptions = regionNames.map((name) => '<option value="' + esc(name) + '"></option>').join('');
    const platformOptions = PLATFORM_OPTIONS.map((platform) => '<option value="' + platform.key + '"' + ((game.platformSupport || 'NS1') === platform.key ? ' selected' : '') + '>' + platform.label + '</option>').join('');
    const cartridgeOptions = CARTRIDGE_OPTIONS.map((cartridge) => '<option value="' + cartridge.key + '"' + ((game.cartridgeType || 'NS1') === cartridge.key ? ' selected' : '') + '>' + cartridge.label + '</option>').join('');
    const conditionOptions = ['', ...CONDITIONS].map((name) => '<option value="' + esc(name) + '"' + (game.condition === name ? ' selected' : '') + '>' + (name ? esc(name) : '未标注') + '</option>').join('');
    const hoursValue = game.playMinutes ? String(hoursNumber(game.playMinutes)) : '';
    const tagsValue = (game.tags || []).join('、');
    const activeNote = loan
      ? '<div class="form-note">' + icon('info') + '<span>这张卡带目前借给 <b>' + esc(loan.borrower || '朋友') + '</b>，' + loanDueText(loan) + '。编辑资料不会改变出借记录。</span></div>'
      : '';

    const body =
      '<form id="' + formId + '" novalidate>' +
        '<div class="form-layout">' +
          '<div class="cover-editor">' +
            '<div class="cover-preview" id="coverPreview">' + coverHTML({ ...game, cover }, '') + '</div>' +
            '<div class="cover-actions">' +
              '<label class="cover-upload" for="coverFile">' + icon('image') + '上传封面</label>' +
              '<input id="coverFile" type="file" accept="image/*" hidden>' +
              '<button type="button" class="cover-upload" id="removeCover">' + icon('trash') + '移除</button>' +
            '</div>' +
            '<div class="cover-url"><input id="coverUrl" class="input" type="url" placeholder="或粘贴图片链接"><button type="button" class="btn btn-secondary" id="applyCover">使用</button></div>' +
            '<p class="cover-help">推荐 3:4 竖图。上传的图片会压缩后保存在本机，不会上传到服务器。</p>' +
          '</div>' +
          '<div>' +
            '<div class="form-section-title">基本信息</div>' +
            '<div class="form-grid">' +
              '<div class="form-field full"><label for="fieldTitle">游戏名称 <span class="req">*</span><span class="hint">必填</span></label><input id="fieldTitle" class="input" maxlength="120" placeholder="例如：塞尔达传说 王国之泪" autocomplete="off" value="' + esc(game.title) + '"><span class="field-error" id="titleError">请填写游戏名称</span></div>' +
              '<div class="form-field full"><label for="fieldSubtitle">副标题 / 英文名</label><input id="fieldSubtitle" class="input" maxlength="160" placeholder="可选，例如：Tears of the Kingdom" autocomplete="off" value="' + esc(game.subtitle) + '"></div>' +
              '<div class="form-field full"><label for="fieldRegion">版本<span class="hint">可识别 / 手动输入</span></label><div class="region-edit-row"><input id="fieldRegion" class="input" list="regionList" maxlength="20" placeholder="例如：台版、欧版、美版" value="' + esc(game.region) + '"><button type="button" class="btn btn-secondary region-scan" id="scanRegion">' + icon('image') + '识别版本和编号</button><input id="regionScanFile" type="file" accept="image/*" capture="environment" hidden></div><datalist id="regionList">' + regionOptions + '</datalist><div id="regionScanResult" class="region-result" hidden></div></div>' +
              '<div class="form-field full"><label for="fieldCartridgeCode">卡带编号<span class="hint">识别照片时一起识别，也可手动输入</span></label><input id="fieldCartridgeCode" class="input" maxlength="40" placeholder="例如：LA-H-AVQYA-EUR、HAC-008" autocomplete="off" value="' + esc(game.cartridgeCode) + '"><div id="cartridgeCodeResult" class="region-result" hidden></div></div>' +
              '<div class="form-field"><label for="fieldPlatform">平台支持</label><select id="fieldPlatform" class="input">' + platformOptions + '</select></div>' +
              '<div class="form-field"><label for="fieldCartridge">卡带版本</label><select id="fieldCartridge" class="input">' + cartridgeOptions + '</select></div>' +
              '<div class="form-field"><label for="fieldCondition">成色</label><select id="fieldCondition" class="input">' + conditionOptions + '</select></div>' +
              '<div class="form-field full"><label for="fieldCopyLabel">副本标识<span class="hint">可选，用于区分同款重复卡带</span></label><input id="fieldCopyLabel" class="input" maxlength="30" placeholder="例如：首刷、再版、自用、收藏盒" value="' + esc(game.copyLabel) + '"></div>' +
              '<div class="form-field full"><label for="fieldTags">标签<span class="hint">用顿号或逗号分隔</span></label><input id="fieldTags" class="input" maxlength="120" placeholder="例如：开放世界、冒险、已通关" value="' + esc(tagsValue) + '"></div>' +
            '</div>' +
            '<div class="form-section-title">购买信息</div>' +
            '<div class="form-grid">' +
              '<div class="form-field"><label for="fieldPurchaseDate">购入日期</label><input id="fieldPurchaseDate" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + esc(game.purchaseDate) + '"></div>' +
              '<div class="form-field"><label for="fieldPrice">购入价格<span class="hint">人民币</span></label><div class="input-prefix"><span class="prefix">¥</span><input id="fieldPrice" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="' + (game.price ? esc(game.price) : '') + '"></div></div>' +
              '<div class="form-field full"><label for="fieldChannel">购买渠道</label><input id="fieldChannel" class="input" maxlength="80" placeholder="例如：任天堂官方店、线下电玩店、朋友转让" value="' + esc(game.purchaseChannel) + '"></div>' +
            '</div>' +
            '<div class="form-section-title">游玩与备注</div>' +
            '<div class="form-grid">' +
              '<div class="form-field full"><label for="fieldPlayHours">累计游玩时长<span class="hint">小时，可填小数</span></label><input id="fieldPlayHours" class="input" type="number" min="0" step="0.1" inputmode="decimal" placeholder="例如：12.5" value="' + esc(hoursValue) + '"></div>' +
              '<div class="form-field full"><label for="fieldNote">备注</label><textarea id="fieldNote" class="textarea" maxlength="4000" placeholder="记下一点关于这张卡带的记忆…">' + esc(game.note) + '</textarea></div>' +
            '</div>' +
            '<p class="photo-form-hint">保存后可以在卡带详情页添加卡带盒、正反面和侧面划痕图片。</p>' +
            activeNote +
          '</div>' +
        '</div>' +
      '</form>';

    const modal = createModal({
      title: editing ? '编辑卡带' : '添加卡带',
      subtitle: editing ? '修改购买、游玩或备注信息。' : '手动录入一张实体卡带，之后随时可以修改。',
      size: 'lg',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('check') + (editing ? '保存修改' : '加入卡带库') + '</button>',
      onMount: (layer, close) => {
        const form = layer.querySelector('#' + formId);
        const titleInput = layer.querySelector('#fieldTitle');
        const subtitleInput = layer.querySelector('#fieldSubtitle');
        const regionInput = layer.querySelector('#fieldRegion');
        const regionScanResult = layer.querySelector('#regionScanResult');
        const regionScanFile = layer.querySelector('#regionScanFile');
        const codeInput = layer.querySelector('#fieldCartridgeCode');
        const codeResult = layer.querySelector('#cartridgeCodeResult');
        const platformSelect = layer.querySelector('#fieldPlatform');
        const cartridgeSelect = layer.querySelector('#fieldCartridge');
        const preview = layer.querySelector('#coverPreview');
        const error = layer.querySelector('#titleError');
        const fileInput = layer.querySelector('#coverFile');
        const urlInput = layer.querySelector('#coverUrl');

        const cartCodeText = (detection) => '<span class="region-detected">' + icon('check') + '<span>编号对应 <strong>' + esc(PLATFORM_LABELS[detection.platformSupport]) + '</strong> · ' + esc(CARTRIDGE_LABELS[detection.cartridgeType]) + '。</span></span>';
        const applyCartridgeCode = (announce, apply = true) => {
          const value = codeInput.value.trim();
          const detection = parseCartridgeCode(value);
          if (!detection) {
            if (value || announce) {
              codeResult.hidden = false;
              codeResult.innerHTML = '<span class="region-failed">' + icon('alert') + (value
                ? '没有识别到这个编号。支持 LA / LN / LB / LP 开头，或 HAC-008。'
                : '请先输入卡带编号，例如 LA-H-AVQYA-EUR。') + '</span>';
            }
            return null;
          }
          if (apply) {
            platformSelect.value = detection.platformSupport;
            cartridgeSelect.value = detection.cartridgeType;
          }
          codeResult.hidden = false;
          codeResult.innerHTML = cartCodeText(detection) + (apply
            ? '<span class="region-code-applied">已自动填写平台支持和卡带版本，仍可手动修改。</span>'
            : '<span class="region-code-applied">当前记录以下拉框选择为准；点「识别」可按编号重新填写。</span>');
          if (announce) toast('已按编号识别：' + CARTRIDGE_CODE_RULES[detection.prefix].label, 'success');
          return detection;
        };

        const syncPreview = () => {
          preview.innerHTML = coverHTML({
            title: titleInput.value.trim() || '未命名卡带',
            subtitle: subtitleInput.value.trim(),
            region: regionInput.value,
            cover
          }, '');
        };
        const syncCoverButtons = () => {
          if (!urlInput) return;
          urlInput.value = cover && /^https?:/i.test(cover) ? cover : '';
        };

        titleInput.addEventListener('input', () => {
          titleInput.classList.remove('invalid');
          error.classList.remove('show');
          syncPreview();
        });
        subtitleInput.addEventListener('input', syncPreview);
        regionInput.addEventListener('input', syncPreview);
        if (codeInput.value.trim()) {
          const initialDetection = parseCartridgeCode(codeInput.value);
          if (initialDetection) {
            codeResult.hidden = false;
            codeResult.innerHTML = cartCodeText(initialDetection) + '<span class="region-code-applied">当前记录以下拉框选择为准；可在上方「识别版本和编号」时一起更新。</span>';
          }
        }
        codeInput.addEventListener('input', () => {
          if (!codeResult.hidden) codeResult.hidden = true;
        });
        codeInput.addEventListener('change', () => applyCartridgeCode(false));
        layer.querySelector('#scanRegion').addEventListener('click', () => {
          const scanner = isNativeApp() ? nativePlugin('RegionScanner') : null;
          if (!scanner) {
            toast('图片识别版本只在安卓 App 中可用，可以直接手动输入。', 'info');
            return;
          }
          regionScanFile.click();
        });
        regionScanFile.addEventListener('change', async () => {
          const file = regionScanFile.files && regionScanFile.files[0];
          if (!file) return;
          const scanner = isNativeApp() ? nativePlugin('RegionScanner') : null;
          if (!scanner) {
            toast('图片识别版本只在安卓 App 中可用。', 'info');
            regionScanFile.value = '';
            return;
          }
          regionScanResult.hidden = false;
          regionScanResult.innerHTML = '<span class="region-loading">' + icon('refresh') + '正在识别版本和卡带编号…</span>';
          try {
            const image = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.9, limit: 2500000 });
            const result = await scanner.scan({ image });
            const text = result && result.text ? String(result.text) : '';
            const candidates = detectRegionCandidates(text);
            const code = parseCartridgeCodeFromOcr(text);
            if (code) {
              codeInput.value = code.prefix;
              platformSelect.value = code.platformSupport;
              cartridgeSelect.value = code.cartridgeType;
              codeResult.hidden = false;
              codeResult.innerHTML = cartCodeText(code) + '<span class="region-code-applied">已按这张照片同时更新平台支持和卡带版本，仍可手动修改。</span>';
            }
            const parts = [];
            if (candidates.length === 1) {
              regionInput.value = candidates[0];
              syncPreview();
              parts.push('版本 <strong>' + esc(candidates[0]) + '</strong>');
            }
            if (code) parts.push('编号 <strong>' + esc(code.prefix) + '</strong>');
            const quickLabels = candidates.length ? candidates : REGIONS;
            const quickHTML = candidates.length === 1 ? '' : '<div class="region-quick">' + quickLabels.map((label) => '<button type="button" data-scan-region="' + esc(label) + '">' + esc(label) + '</button>').join('') + '</div>';
            if (parts.length) {
              const hint = candidates.length === 1 ? '' : '版本未唯一确定，请点选：';
              regionScanResult.innerHTML = '<span class="region-detected">' + icon('check') + '识别到 ' + parts.join('，') + '。请核对实物。</span>' +
                (hint ? '<div class="region-failed"><span>' + hint + '</span></div>' : '') + quickHTML;
            } else if (candidates.length) {
              regionScanResult.innerHTML = '<div class="region-failed">' + icon('alert') + '<span>识别到多个可能版本，请点选：</span></div>' + quickHTML;
            } else {
              regionScanResult.innerHTML = '<div class="region-failed">' + icon('alert') + '<span>没有识别到版本或卡带编号。可以手动输入，或点选版本：</span></div><div class="region-quick">' + quickLabels.map((label) => '<button type="button" data-scan-region="' + esc(label) + '">' + esc(label) + '</button>').join('') + '</div>' + (text ? '<p class="region-ocr-text">识别文字：' + esc(text.replace(/\s+/g, ' ').slice(0, 180)) + '</p>' : '');
            }
            regionScanResult.querySelectorAll('[data-scan-region]').forEach((button) => {
              button.addEventListener('click', () => {
                regionInput.value = button.dataset.scanRegion;
                syncPreview();
                regionScanResult.innerHTML = '<span class="region-detected">' + icon('check') + '已选择 ' + esc(button.dataset.scanRegion) + (code ? '，编号 ' + esc(code.prefix) : '') + '</span>';
              });
            });
          } catch (error) {
            regionScanResult.innerHTML = '<span class="region-failed">' + icon('alert') + esc(error && error.message ? error.message : '图片识别失败') + '</span>';
          } finally {
            regionScanFile.value = '';
          }
        });

        layer.querySelector('#removeCover').addEventListener('click', () => {
          cover = '';
          urlInput.value = '';
          syncPreview();
        });
        layer.querySelector('#applyCover').addEventListener('click', () => {
          const value = safeImage(urlInput.value);
          if (!value) {
            toast('请输入有效的图片链接（http 或 https）。', 'error');
            return;
          }
          cover = value;
          syncPreview();
          toast('已使用这张封面。', 'success');
        });
        urlInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            layer.querySelector('#applyCover').click();
          }
        });
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          try {
            cover = await compressImage(file);
            syncPreview();
            syncCoverButtons();
            toast('封面已准备好，保存后生效。', 'success');
          } catch (errorObject) {
            toast(errorObject.message || '图片读取失败，请换一张试试。', 'error');
          } finally {
            fileInput.value = '';
          }
        });

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const title = titleInput.value.trim();
          if (!title) {
            titleInput.classList.add('invalid');
            error.classList.add('show');
            titleInput.focus();
            return;
          }
          const now = new Date().toISOString();
          const priceValue = Math.max(0, asNumber(layer.querySelector('#fieldPrice').value, 0));
          const playValue = Math.max(0, asNumber(layer.querySelector('#fieldPlayHours').value, 0));
          const tags = layer.querySelector('#fieldTags').value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
          const data = {
            title,
            subtitle: subtitleInput.value.trim(),
            region: regionInput.value,
            cartridgeCode: codeInput.value.trim(),
            platformSupport: layer.querySelector('#fieldPlatform').value,
            cartridgeType: layer.querySelector('#fieldCartridge').value,
            condition: layer.querySelector('#fieldCondition').value,
            copyLabel: layer.querySelector('#fieldCopyLabel').value.trim(),
            purchaseDate: layer.querySelector('#fieldPurchaseDate').value || '',
            price: priceValue,
            purchaseChannel: layer.querySelector('#fieldChannel').value.trim(),
            playMinutes: Math.round(playValue * 60),
            tags,
            note: layer.querySelector('#fieldNote').value,
            cover,
            updatedAt: now
          };
          if (editing) {
            Object.assign(existing, data);
          } else {
            state.games.unshift({
              ...data,
              id: uid(),
              loans: [],
              playLogs: [],
              nintendoAppIds: [],
              nintendoImportedMinutes: 0,
              photos: [],
              createdAt: now
            });
          }
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast(editing ? '卡带资料已更新。' : '已加入「' + title + '」。', 'success');
        });
      }
    });
    return modal;
  }

  /* ---------------------------------------------------------
     Playtime
     --------------------------------------------------------- */

  function openPlayModal(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    const formId = 'playForm_' + Date.now();
    const body =
      '<div class="form-summary">' + coverHTML(game, 'cover-mini') + '<div><strong>' + esc(game.title) + '</strong><small>当前累计 ' + fmtHours(game.playMinutes) + '</small></div></div>' +
      '<form id="' + formId + '" novalidate>' +
        '<div class="form-grid">' +
          '<div class="form-field full"><label for="playMinutes">这次游玩了多久<span class="hint">分钟</span></label><input id="playMinutes" class="input" type="number" min="1" max="1440" step="1" inputmode="numeric" value="60"><div class="quick-chips"><button type="button" class="quick-chip" data-minutes="30">30 分钟</button><button type="button" class="quick-chip active" data-minutes="60">1 小时</button><button type="button" class="quick-chip" data-minutes="90">1.5 小时</button><button type="button" class="quick-chip" data-minutes="120">2 小时</button></div><span class="field-error" id="playError">请输入 1–1440 分钟</span></div>' +
          '<div class="form-field full"><label for="playDate">日期</label><input id="playDate" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + todayISO() + '" max="' + todayISO() + '"></div>' +
          '<div class="form-field full"><label for="playNote">备注<span class="hint">可选</span></label><textarea id="playNote" class="textarea" maxlength="500" placeholder="例如：推进到第六章、和朋友联机…"></textarea></div>' +
        '</div>' +
      '</form>';
    createModal({
      title: '记录游玩',
      subtitle: '这一次玩了多久？会自动累加到这张卡带。',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('check') + '记录这次游玩</button>',
      onMount: (layer, close) => {
        const form = layer.querySelector('#' + formId);
        const input = layer.querySelector('#playMinutes');
        const error = layer.querySelector('#playError');
        layer.querySelectorAll('[data-minutes]').forEach((button) => {
          button.addEventListener('click', () => {
            input.value = button.dataset.minutes;
            layer.querySelectorAll('[data-minutes]').forEach((item) => item.classList.toggle('active', item === button));
          });
        });
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const minutes = Math.round(asNumber(input.value, 0));
          if (minutes < 1 || minutes > 1440) {
            error.classList.add('show');
            input.focus();
            return;
          }
          const log = {
            id: uid('p'),
            date: layer.querySelector('#playDate').value || todayISO(),
            minutes,
            note: layer.querySelector('#playNote').value.trim()
          };
          game.playLogs = Array.isArray(game.playLogs) ? game.playLogs : [];
          game.playLogs.push(log);
          game.playMinutes = Math.max(0, Number(game.playMinutes) || 0) + minutes;
          game.updatedAt = new Date().toISOString();
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast('已记录 ' + fmtHours(minutes) + '。', 'success');
        });
      }
    });
  }

  /* ---------------------------------------------------------
     Loans
     --------------------------------------------------------- */



  function openDatePicker(input) {
    if (!input || input.disabled) return;
    const current = parseDate(input.value) ? input.value.slice(0, 10) : todayISO();
    const maxDate = input.getAttribute('max') || addDaysISO(todayISO(), 365 * 5);
    const nowParts = todayISO().split('-').map(Number);
    const valueParts = current.split('-').map(Number);
    let year = valueParts[0] || nowParts[0];
    let month = valueParts[1] || nowParts[1];
    let day = valueParts[2] || nowParts[2];
    const minYear = Math.min(1990, year);
    const maxYear = Math.max(Number(maxDate.slice(0, 4)) || nowParts[0], year);
    const years = [];
    for (let y = minYear; y <= maxYear; y += 1) years.push(y);
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const body =
      '<div class="date-picker">' +
        '<div class="date-picker-grid">' +
          '<label>年<select id="dpYear" class="input">' + years.map((y) => '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + ' 年</option>').join('') + '</select></label>' +
          '<label>月<select id="dpMonth" class="input">' + monthNames.map((name, index) => '<option value="' + (index + 1) + '"' + (index + 1 === month ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>' +
          '<label>日<select id="dpDay" class="input"></select></label>' +
        '</div>' +
        '<div class="date-picker-preview" id="dpPreview"></div>' +
        '<div class="date-picker-quick"><button type="button" class="btn btn-secondary btn-sm" id="dpToday">今天</button><button type="button" class="btn btn-ghost btn-sm" id="dpClear">清空</button></div>' +
      '</div>';
    createModal({
      title: '选择日期',
      subtitle: '可以直接切换年份，不用逐月翻阅。',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn-primary" id="dpConfirm">' + icon('check') + '确定</button>',
      onMount: (layer, close) => {
        const yearSelect = layer.querySelector('#dpYear');
        const monthSelect = layer.querySelector('#dpMonth');
        const daySelect = layer.querySelector('#dpDay');
        const preview = layer.querySelector('#dpPreview');
        const syncDays = (preferredDay) => {
          const y = Number(yearSelect.value);
          const m = Number(monthSelect.value);
          const total = new Date(y, m, 0).getDate();
          const selected = Math.min(total, Math.max(1, preferredDay || Number(daySelect.value) || 1));
          daySelect.innerHTML = Array.from({ length: total }, (_, index) => {
            const value = index + 1;
            return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + value + ' 日</option>';
          }).join('');
          syncPreview();
        };
        const syncPreview = () => {
          const y = Number(yearSelect.value);
          const m = Number(monthSelect.value);
          const d = Number(daySelect.value);
          const date = new Date(y, m - 1, d);
          preview.innerHTML = '<strong>' + y + ' 年 ' + monthNames[m - 1] + ' ' + d + ' 日</strong><small>星期' + weekdayNames[date.getDay()] + '</small>';
        };
        yearSelect.addEventListener('change', () => syncDays());
        monthSelect.addEventListener('change', () => syncDays());
        daySelect.addEventListener('change', syncPreview);
        layer.querySelector('#dpToday').addEventListener('click', () => {
          const parts = todayISO().split('-').map(Number);
          yearSelect.value = String(parts[0]);
          monthSelect.value = String(parts[1]);
          syncDays(parts[2]);
        });
        layer.querySelector('#dpClear').addEventListener('click', () => {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        layer.querySelector('#dpConfirm').addEventListener('click', () => {
          const y = Number(yearSelect.value);
          const m = Number(monthSelect.value);
          const d = Number(daySelect.value);
          let value = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          if (maxDate && value > maxDate) value = maxDate;
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        syncDays(day);
      }
    });
  }


  function openMarketModal(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    const formId = 'marketForm_' + Date.now();
    const sourceOptions = ['闲鱼', '淘宝', 'PriceCharting', '其他'].map((source) => '<option value="' + esc(source) + '"></option>').join('');
    const body =
      '<div class="form-summary">' + coverHTML(game, 'cover-mini') + '<div><strong>' + esc(game.title) + '</strong><small>记录你查到的当前二手参考价，用来和入手价对比。</small></div></div>' +
      '<div class="form-note" style="margin-bottom:14px">' + icon('info') + '<span>二手价格没有稳定的公开 API，卡匣不抓取闲鱼/淘宝页面。你可以复制搜索词去平台查询，再把价格填回来。</span></div>' +
      '<form id="' + formId + '" novalidate><div class="form-grid">' +
        '<div class="form-field"><label for="marketPrice">当前二手参考价<span class="hint">人民币</span></label><div class="input-prefix"><span class="prefix">¥</span><input id="marketPrice" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="' + (game.marketPrice ? esc(game.marketPrice) : '') + '"></div></div>' +
        '<div class="form-field"><label for="marketSource">来源<span class="hint">可选</span></label><input id="marketSource" class="input" list="marketSourceList" maxlength="30" placeholder="例如：闲鱼" value="' + esc(game.marketSource) + '"><datalist id="marketSourceList">' + sourceOptions + '</datalist></div>' +
        '<div class="form-field"><label for="marketDate">查询日期</label><input id="marketDate" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + esc(game.marketUpdatedAt || todayISO()) + '" max="' + todayISO() + '"></div>' +
        '<div class="form-field full"><label for="marketNote">备注<span class="hint">可选</span></label><textarea id="marketNote" class="textarea" maxlength="500" placeholder="例如：裸卡、盒说全、带特典，价格按品相估算…">' + esc(game.marketNote) + '</textarea></div>' +
      '</div></form>' +
      '<button type="button" class="btn btn-secondary btn-sm" id="copyMarketQuery" style="margin-top:10px">' + icon('search') + '复制搜索词</button>';
    createModal({
      title: '更新二手参考价',
      subtitle: '手动记录价格，避免第三方抓取失效。',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('check') + '保存参考价</button>',
      onMount: (layer, close) => {
        layer.querySelector('#copyMarketQuery').addEventListener('click', () => {
          copyToClipboard(game.title + ' Switch 卡带 二手 价格');
        });
        layer.querySelector('#' + formId).addEventListener('submit', (event) => {
          event.preventDefault();
          game.marketPrice = Math.max(0, Number(layer.querySelector('#marketPrice').value) || 0);
          game.marketSource = layer.querySelector('#marketSource').value.trim();
          game.marketUpdatedAt = layer.querySelector('#marketDate').value || todayISO();
          game.marketNote = layer.querySelector('#marketNote').value.trim();
          game.updatedAt = new Date().toISOString();
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast('已更新二手参考价。', 'success');
        });
      }
    });
  }

  function openSellModal(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    if (activeLoan(game)) {
      toast('这张卡带还在出借中，请先登记归还再标记售出。', 'info');
      return;
    }
    const formId = 'saleForm_' + Date.now();
    const body =
      '<div class="form-summary">' + coverHTML(game, 'cover-mini') + '<div><strong>' + esc(game.title) + '</strong><small>' + (game.soldAt ? '修改售出记录' : '标记为已售出后，仍会保留在卡带库') + '</small></div></div>' +
      '<form id="' + formId + '" novalidate>' +
        '<div class="form-grid">' +
          '<div class="form-field"><label for="soldDate">售出日期</label><input id="soldDate" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + esc(game.soldAt || todayISO()) + '" max="' + todayISO() + '"></div>' +
          '<div class="form-field"><label for="soldPrice">售出价格<span class="hint">人民币，可选</span></label><div class="input-prefix"><span class="prefix">¥</span><input id="soldPrice" class="input" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="' + (game.soldPrice ? esc(game.soldPrice) : '') + '"></div></div>' +
          '<div class="form-field full"><label for="soldTo">卖给谁 / 渠道<span class="hint">可选</span></label><input id="soldTo" class="input" maxlength="80" placeholder="例如：闲鱼、朋友、线下店" value="' + esc(game.soldTo) + '"></div>' +
          '<div class="form-field full"><label for="saleNote">售出备注<span class="hint">可选</span></label><textarea id="saleNote" class="textarea" maxlength="1000" placeholder="例如：盒说全、已面交、价格含运费…">' + esc(game.saleNote) + '</textarea></div>' +
        '</div>' +
      '</form>';
    createModal({
      title: game.soldAt ? '修改售出记录' : '标记已售出',
      subtitle: '记录卖出时间、价格和去向。',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('check') + (game.soldAt ? '保存售出信息' : '确认售出') + '</button>',
      onMount: (layer, close) => {
        const form = layer.querySelector('#' + formId);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          game.soldAt = layer.querySelector('#soldDate').value || todayISO();
          game.soldPrice = Math.max(0, Number(layer.querySelector('#soldPrice').value) || 0);
          game.soldTo = layer.querySelector('#soldTo').value.trim();
          game.saleNote = layer.querySelector('#saleNote').value.trim();
          game.updatedAt = new Date().toISOString();
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast('已标记售出：' + game.title, 'success');
        });
      }
    });
  }

  async function cancelSale(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game || !game.soldAt) return;
    const confirmed = await askConfirm({
      title: '取消售出',
      heading: '把「' + game.title + '」恢复为在库？',
      message: '售出日期、价格和去向会被清除，卡带重新计入在库。',
      confirmText: '恢复在库',
      danger: false
    });
    if (!confirmed) return;
    game.soldAt = '';
    game.soldPrice = 0;
    game.soldTo = '';
    game.saleNote = '';
    game.updatedAt = new Date().toISOString();
    scheduleSave(0);
    refreshAfterMutation();
    toast('已恢复为在库。', 'success');
  }

  function openLoanModal(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    if (game.soldAt) {
      toast('这张卡带已经标记为已售出，不能登记出借。', 'info');
      return;
    }
    if (activeLoan(game)) {
      toast('这张卡带已经在外借中，请先登记归还。', 'info');
      return;
    }
    const formId = 'loanForm_' + Date.now();
    const body =
      '<div class="form-summary">' + coverHTML(game, 'cover-mini') + '<div><strong>' + esc(game.title) + '</strong><small>' + esc(game.region || '未标注版本') + ' · 借出后会标记为「已出借」</small></div></div>' +
      '<form id="' + formId + '" novalidate>' +
        '<div class="form-note" style="margin-bottom:16px">' + icon('info') + '<span>登记后，这张卡带会从「在库」变成「已出借」。归还时再回来登记即可。</span></div>' +
        '<div class="form-grid">' +
          '<div class="form-field full"><label for="loanBorrower">借给谁 <span class="req">*</span></label><input id="loanBorrower" class="input" maxlength="60" placeholder="朋友的名字或昵称" autocomplete="off"><span class="field-error" id="borrowerError">请填写借出对象</span></div>' +
          '<div class="form-field full"><label for="loanContact">联系方式<span class="hint">可选</span></label><input id="loanContact" class="input" maxlength="120" placeholder="微信、电话或其他联系方式"></div>' +
          '<div class="form-field"><label for="loanDate">借出日期</label><input id="loanDate" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + todayISO() + '" max="' + todayISO() + '"></div>' +
          '<div class="form-field"><label for="loanDue">约定归还日期<span class="hint">可设为暂无</span></label><input id="loanDue" class="input date-input" type="text" readonly data-date-picker placeholder="YYYY-MM-DD" value="' + addDaysISO(todayISO(), 30) + '"><label class="checkbox-row"><input id="loanNoDue" type="checkbox"> 暂无归还时间</label><span class="field-error" id="dueError">归还日期不能早于借出日期</span></div>' +
          '<div class="form-field full"><label for="loanNote">备注<span class="hint">可选</span></label><textarea id="loanNote" class="textarea" maxlength="1000" placeholder="例如：说好月底还，卡带和盒子都完好…"></textarea></div>' +
        '</div>' +
      '</form>';
    createModal({
      title: '登记出借',
      subtitle: '记下借给谁、什么时候还。',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('handoff') + '确认借出</button>',
      onMount: (layer, close) => {
        const form = layer.querySelector('#' + formId);
        const borrower = layer.querySelector('#loanBorrower');
        const borrowerError = layer.querySelector('#borrowerError');
        const loanDate = layer.querySelector('#loanDate');
        const dueDate = layer.querySelector('#loanDue');
        const noDue = layer.querySelector('#loanNoDue');
        const dueError = layer.querySelector('#dueError');
        const syncDueState = () => {
          dueDate.disabled = noDue.checked;
          if (noDue.checked) {
            dueDate.value = '';
            dueError.classList.remove('show');
          } else if (!dueDate.value) {
            dueDate.value = addDaysISO(todayISO(), 30);
          }
        };
        noDue.addEventListener('change', syncDueState);
        borrower.addEventListener('input', () => {
          borrower.classList.remove('invalid');
          borrowerError.classList.remove('show');
        });
        dueDate.addEventListener('input', () => dueError.classList.remove('show'));
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (!borrower.value.trim()) {
            borrower.classList.add('invalid');
            borrowerError.classList.add('show');
            borrower.focus();
            return;
          }
          if (!noDue.checked && loanDate.value && dueDate.value && dueDate.value < loanDate.value) {
            dueError.classList.add('show');
            dueDate.focus();
            return;
          }
          const loan = {
            id: uid('l'),
            borrower: borrower.value.trim(),
            contact: layer.querySelector('#loanContact').value.trim(),
            loanDate: loanDate.value || todayISO(),
            dueDate: noDue.checked ? '' : (dueDate.value || ''),
            returnedDate: '',
            note: layer.querySelector('#loanNote').value.trim(),
            returnNote: ''
          };
          game.loans = Array.isArray(game.loans) ? game.loans : [];
          game.loans.push(loan);
          game.updatedAt = new Date().toISOString();
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast('已登记借给 ' + loan.borrower + '。', 'success');
        });
      }
    });
  }

  function openReturnDialog(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    const loan = activeLoan(game);
    if (!loan) {
      toast('没有找到正在进行的出借记录。', 'info');
      return;
    }
    const formId = 'returnForm_' + Date.now();
    const body =
      '<div class="form-summary">' + coverHTML(game, 'cover-mini') + '<div><strong>' + esc(game.title) + '</strong><small>借给 ' + esc(loan.borrower || '朋友') + ' · ' + fmtDate(loan.loanDate) + ' 借出</small></div></div>' +
      '<form id="' + formId + '">' +
        '<div class="form-note" style="margin-bottom:14px">' + icon('check') + '<span>' + (isOverdueLoan(loan) ? '这笔出借已经逾期，登记归还后会停止逾期提醒。' : '确认卡带已经回到你手上，再登记归还。') + '</span></div>' +
        '<div class="form-field"><label for="returnNote">归还备注<span class="hint">可选</span></label><textarea id="returnNote" class="textarea" maxlength="1000" placeholder="例如：卡带和盒子都完好，朋友说很好玩…"></textarea></div>' +
      '</form>';
    createModal({
      title: '登记归还',
      subtitle: '归还后，这张卡带会回到「在库」。',
      size: 'sm',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="submit" class="btn btn-primary" form="' + formId + '">' + icon('check') + '确认归还</button>',
      onMount: (layer, close) => {
        const form = layer.querySelector('#' + formId);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          loan.returnedDate = todayISO();
          loan.returnNote = layer.querySelector('#returnNote').value.trim();
          game.updatedAt = new Date().toISOString();
          scheduleSave(0);
          close();
          refreshAfterMutation();
          toast('已登记归还，卡带回到在库。', 'success');
        });
      }
    });
  }

  async function deleteGame(id) {
    const game = state.games.find((item) => item.id === id);
    if (!game) return;
    const confirmed = await askConfirm({
      title: '删除卡带',
      heading: '确定要删除这张卡带吗？',
      message: '「<strong>' + esc(game.title) + '</strong>」的购买信息、游玩记录和出借历史都会一起删除。这个操作可以撤销。',
      confirmText: '删除卡带',
      danger: true
    });
    if (!confirmed) return;
    const index = state.games.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = state.games.splice(index, 1)[0];
    if (detailId === id) closeDrawer();
    scheduleSave(0);
    refreshAfterMutation();
    toast('已删除「' + removed.title + '」。', 'info', {
      label: '撤销',
      onClick: () => {
        state.games.splice(Math.min(index, state.games.length), 0, removed);
        scheduleSave(0);
        refreshAfterMutation();
        toast('已恢复这张卡带。', 'success');
      }
    });
  }

  function refreshAfterMutation() {
    const y = window.scrollY;
    renderRoute();
    if (detailId && $('.drawer-layer')) refreshDrawer();
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }


  /* ---------------------------------------------------------
     Settings / data
     --------------------------------------------------------- */


  /* ---------------------------------------------------------
     Nintendo account sync
     --------------------------------------------------------- */

  function nintendoApi() {
    if (!isNativeApp()) return null;
    return nativePlugin('Nintendo');
  }

  function nintendoSyncTime(value) {
    if (!value) return '尚未同步';
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '尚未同步';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function nintendoAccountAvatar(account) {
    if (account.avatarUrl) {
      return '<span class="nintendo-avatar"><img src="' + esc(account.avatarUrl) + '" alt="" loading="lazy"></span>';
    }
    return '<span class="nintendo-avatar">' + esc(Array.from(account.nickname || '任')[0]) + '</span>';
  }

  function nintendoAccountsHTML() {
    const api = nintendoApi();
    if (!api) {
      return '<div class="settings-row"><span class="settings-row-icon">' + icon('gamepad') + '</span><div class="settings-row-copy"><strong>任天堂账号同步</strong><small>这项功能只在卡匣安卓 App 中可用。网页版无法直接登录任天堂账号。</small></div></div>' +
        '<button type="button" class="nintendo-guide-link" data-action="nintendo-guide">' + icon('book') + '查看详细教程与常见错误</button>';
    }
    const accounts = state.nintendo.accounts || [];
    let rows = '';
    if (!accounts.length) {
      rows = '<div class="settings-row"><span class="settings-row-icon">' + icon('gamepad') + '</span><div class="settings-row-copy"><strong>还没有绑定任天堂账号</strong><small>登录后可以读取家长控制中的每日游玩时长。支持多个账号。</small></div></div>';
    } else {
      rows = accounts.map((account) => {
        const devices = (account.devices || []).length;
        return '<div class="nintendo-account">' +
          nintendoAccountAvatar(account) +
          '<div class="nintendo-account-copy"><strong>' + esc(account.nickname) + '</strong>' +
            '<small>' + (devices ? devices + ' 台主机' : '还没有同步设备') + ' · ' + nintendoSyncTime(account.lastSyncAt) + '</small>' +
          '</div>' +
          '<div class="nintendo-account-actions">' +
            '<button type="button" class="btn btn-secondary btn-sm" data-action="nintendo-sync" data-id="' + esc(account.id) + '"' + (nintendoBusy ? ' disabled' : '') + '>同步</button>' +
            '<button type="button" class="icon-btn nintendo-remove" data-action="nintendo-remove" data-id="' + esc(account.id) + '" aria-label="解除绑定">' + icon('close') + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    return rows +
      '<div class="nintendo-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="nintendo-add"' + (nintendoBusy ? ' disabled' : '') + '>' + icon('plus') + (accounts.length ? '添加另一个任天堂账号' : '登录任天堂账号') + '</button>' +
        (accounts.length > 1 ? '<button type="button" class="btn btn-secondary btn-sm" data-action="nintendo-sync-all"' + (nintendoBusy ? ' disabled' : '') + '>' + icon('refresh') + '同步全部账号</button>' : '') +
      '</div>' +
      '<button type="button" class="nintendo-guide-link" data-action="nintendo-guide">' + icon('book') + '查看详细教程与常见错误</button>' +
      '<p class="nintendo-hint">非官方家长控制接口 · 只读取你自己的游玩记录，不保存任天堂密码。支持多个任天堂账号和同一主机上的多个 Switch 玩家。</p>';
  }

  function lanPayload() {
    return JSON.stringify({
      app: 'kaxia',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      state
    });
  }

  function lanServerListHTML() {
    if (!lanServers.length) {
      return '<div class="lan-empty">还没有搜索到电脑。请先在电脑上启动卡匣，再点「搜索电脑」。</div>';
    }
    return lanServers.map((server, index) => {
      return '<button type="button" class="lan-server' + (index === lanSelected ? ' active' : '') + '" data-action="lan-select" data-index="' + index + '">' +
        '<strong>' + esc(server.name || '卡匣电脑') + '</strong>' +
        '<small>' + esc(server.url || '') + '</small>' +
      '</button>';
    }).join('');
  }

  function lanSyncHTML() {
    const native = isNativeApp();
    if (serverMode) {
      return '<div class="lan-sync-card">' +
        '<p class="lan-sync-lead">当前网页直接读写电脑上的卡匣服务，数据文件就是电脑上的 <code>data/sync-data.json</code>；网页端不需要再上传或下载。</p>' +
        '<div id="lanUpdate" class="lan-update">正在检查更新…</div>' +
        '<div class="lan-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="server-refresh">' + icon('refresh') + '从服务器刷新</button></div>' +
        '<p class="lan-sync-hint">App 上传或合并后，点刷新即可看到电脑上的最新数据。</p>' +
      '</div>';
    }
    return '<div class="lan-sync-card">' +
      '<p class="lan-sync-lead">' + (native
        ? '在同一 Wi-Fi 下，用电脑上的卡匣服务上传或下载数据。App 会广播寻找电脑，不需要输入 IP。'
        : '当前网页由卡匣本地服务提供，可以在这里上传或下载电脑上的同步数据。') + '</p>' +
      (native
        ? '<div class="lan-actions"><button type="button" class="btn btn-secondary btn-sm" data-action="lan-discover">' + icon('search') + '搜索电脑</button></div>'
        : '') +
      '<div id="lanServers">' + (native ? lanServerListHTML() : '<div class="lan-empty">网页端已连接当前服务，可以直接上传或下载。</div>') + '</div>' +
      '<div id="lanUpdate" class="lan-update">正在检查更新…</div>' +
      '<div class="lan-auto-row"><select id="lanAutoMode" class="select"><option value="off">关闭自动上传</option><option value="interval">按间隔自动</option><option value="daily">每天定时</option><option value="connect">连接后自动</option></select><select id="lanAutoInterval" class="select"><option value="1">每 1 分钟</option><option value="5" selected>每 5 分钟</option><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option></select><input id="lanAutoTime" class="input" type="time" value="23:00"><span id="lanAutoStatus">未开启</span></div>' +
      '<div class="lan-actions"><button type="button" class="btn btn-primary btn-sm" data-action="lan-open-sync">' + icon('refresh') + '同步 / 合并</button></div>' +
      '<p class="lan-sync-hint">上传会覆盖电脑上的同步文件；下载会覆盖本机数据，操作前会再次确认。同步只包含卡带数据，不包含任天堂授权 token。</p>' +
    '</div>';
  }

  async function lanDiscover() {
    if (lanSyncBusy) return;
    const plugin = isNativeApp() ? nativePlugin('LanSync') : null;
    if (!plugin) {
      toast('网页端直接读写电脑服务，不需要搜索电脑。', 'info');
      return;
    }
    lanSyncBusy = true;
    toast('正在局域网内搜索电脑…', 'info');
    try {
      const result = await plugin.discover({ port: 8766 });
      lanServers = (result && Array.isArray(result.servers) ? result.servers : []).map((server) => ({
        name: String(server.name || '卡匣电脑'),
        url: String(server.url || ''),
        token: String(server.token || '')
      })).filter((server) => /^https?:\/\//i.test(server.url));
      lanSelected = lanServers.length ? 0 : -1;
      const box = $('#lanServers');
      if (box) box.innerHTML = lanServerListHTML();
      lanCheckUpdate();
      if (lanAutoConfig().mode === 'connect' && lanServers.length) lanAutoTick();
      toast(lanServers.length ? '找到 ' + lanServers.length + ' 个电脑端服务。' : '没有找到电脑。请确认电脑端卡匣已启动，且在同一个 Wi-Fi。', lanServers.length ? 'success' : 'info');
    } catch (error) {
      toast(error && error.message ? error.message : '搜索电脑失败', 'error');
    } finally {
      lanSyncBusy = false;
    }
    if (lanServers.length) {
      setTimeout(() => { if (!lanSyncBusy) lanOpenSync(); }, 80);
    }
  }

  async function lanUpload() {
    if (lanSyncBusy) return;
    const native = isNativeApp();
    const plugin = native ? nativePlugin('LanSync') : null;
    const server = native && lanSelected >= 0 ? lanServers[lanSelected] : null;
    if (native && !server) {
      toast('请先点「搜索电脑」并选择一个电脑。', 'info');
      return;
    }
    const confirmed = await askConfirm({
      title: '上传到电脑',
      heading: '用这台设备的数据覆盖电脑？',
      message: '电脑上的同步文件会被当前卡带数据覆盖。照片也会一起上传，数据较大时需要一点时间。',
      confirmText: '上传'
    });
    if (!confirmed) return;
    lanSyncBusy = true;
    try {
      const payload = lanPayload();
      if (native) {
        await plugin.upload({ serverUrl: server.url, token: server.token, payload });
      } else {
        const response = await fetch('/api/sync', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        if (!response.ok) throw new Error(await lanResponseError(response));
      }
      lanWriteBase(lanServerId(), state, state);
      toast('已上传到电脑。网页端现在可以下载这份数据。', 'success');
    } catch (error) {
      toast(error && error.message ? error.message : '上传失败', 'error');
    } finally {
      lanSyncBusy = false;
    }
  }

  async function lanDownload() {
    if (lanSyncBusy) return;
    const native = isNativeApp();
    const plugin = native ? nativePlugin('LanSync') : null;
    const server = native && lanSelected >= 0 ? lanServers[lanSelected] : null;
    if (native && !server) {
      toast('请先点「搜索电脑」并选择一个电脑。', 'info');
      return;
    }
    let text = '';
    try {
      lanSyncBusy = true;
      if (native) {
        const result = await plugin.download({ serverUrl: server.url, token: server.token });
        text = result && result.payload ? String(result.payload) : '';
      } else {
        const response = await fetch('/api/sync', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(await lanResponseError(response));
        text = await response.text();
      }
      const parsed = JSON.parse(text);
      const remote = normalizeState(parsed && parsed.state ? parsed.state : parsed);
      const confirmed = await askConfirm({
        title: '从电脑下载',
        heading: '用电脑数据覆盖本机？',
        message: '电脑上有 ' + remote.games.length + ' 张卡带。下载后会替换当前卡带库，操作不能撤销。',
        confirmText: '覆盖本机',
        danger: true
      });
      if (!confirmed) return;
      state = remote;
      filters.status = 'all';
      filters.q = '';
      filters.region = 'all';
      filters.platform = 'all';
      filters.cartridge = 'all';
      filters.tag = 'all';
      filters.sort = state.preferences.sort || 'recent';
      scheduleSave(0);
      closeAllModals(true);
      rerender({ keepScroll: false });
      lanWriteBase(lanServerId(), remote, remote);
      toast('已从电脑下载 ' + remote.games.length + ' 张卡带。', 'success');
    } catch (error) {
      toast(error && error.message ? error.message : '下载失败', 'error');
    } finally {
      lanSyncBusy = false;
    }
  }

  async function lanResponseError(response) {
    try {
      const data = await response.json();
      if (data && data.error) return data.error;
    } catch (error) { /* ignore */ }
    return 'HTTP ' + response.status + '。当前电脑端可能不是支持同步的卡匣服务。';
  }

  function compareVersions(a, b) {
    const left = String(a || '0').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
    const right = String(b || '0').replace(/^v/i, '').split('.').map((part) => Number(part) || 0);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  async function lanCheckUpdate() {
    const box = $('#lanUpdate');
    if (!box) return;
    const native = isNativeApp();
    const server = native && lanSelected >= 0 ? lanServers[lanSelected] : null;
    if (native && !server) {
      box.innerHTML = '<span>选择电脑后检查 App 更新。</span>';
      return;
    }
    box.innerHTML = '<span class="lan-update-loading">正在检查版本…</span>';
    try {
      let info = null;
      if (native) {
        const plugin = nativePlugin('LanSync');
        info = await plugin.getAppInfo({ serverUrl: server.url });
      } else {
        const response = await fetch('/api/app/info', { credentials: 'same-origin' });
        if (!response.ok) throw new Error('当前网页服务不支持更新检查');
        info = await response.json();
      }
      lanUpdateInfo = info && info.ok ? info : null;
      if (!lanUpdateInfo) {
        box.innerHTML = '<span>电脑服务没有返回版本信息。</span>';
        return;
      }
      const candidates = [];
      if (lanUpdateInfo.local && lanUpdateInfo.local.version) candidates.push({ version: lanUpdateInfo.local.version, source: '电脑本地' });
      if (lanUpdateInfo.github && !lanUpdateInfo.github.error && lanUpdateInfo.github.version) candidates.push({ version: lanUpdateInfo.github.version, source: 'GitHub' });
      candidates.sort((a, b) => compareVersions(b.version, a.version));
      if (!candidates.length) {
        box.innerHTML = '<span>电脑上没有可用的 App 版本。</span>';
        return;
      }
      const newest = candidates[0];
      const githubError = lanUpdateInfo.github && lanUpdateInfo.github.error ? String(lanUpdateInfo.github.error) : '';
      lanUpdateInfo.latest = newest;
      lanUpdateInfo.downloadUrl = native ? server.url + '/app/update.apk' : '/app/update.apk';
      if (compareVersions(newest.version, APP_VERSION) > 0) {
        box.innerHTML = '<span class="lan-update-new">发现新版本 <strong>' + esc(newest.version) + '</strong> · ' + esc(newest.source) + (githubError ? ' · GitHub 未连接' : '') + '</span><button type="button" class="btn btn-primary btn-sm" data-action="lan-update">下载更新</button>';
      } else if (githubError) {
        box.innerHTML = '<span class="lan-update-ok">本地版本 ' + esc(APP_VERSION) + '（已是最新）· GitHub 未连接：' + esc(githubError.slice(0, 80)) + '</span>';
      } else {
        box.innerHTML = '<span class="lan-update-ok">已是最新版本（' + esc(APP_VERSION) + '）</span>';
      }
    } catch (error) {
      lanUpdateInfo = null;
      const message = error && error.message ? error.message : '电脑服务不可用';
      box.innerHTML = '<span>' + (message.includes('404')
        ? '版本检查失败：电脑端服务是旧版或 PowerShell 回退。请关闭旧 CMD，用 Python 重新启动卡匣服务。'
        : '版本检查失败：' + esc(message)) + '</span>';
    }
  }

  async function lanOpenUpdate() {
    if (!lanUpdateInfo || !lanUpdateInfo.downloadUrl) return;
    const plugin = isNativeApp() ? nativePlugin('LanSync') : null;
    if (plugin && typeof plugin.openExternal === 'function') {
      try {
        await plugin.openExternal({ url: lanUpdateInfo.downloadUrl });
        toast('已打开下载链接，请用系统浏览器安装。', 'success');
      } catch (error) {
        toast(error && error.message ? error.message : '打开下载失败', 'error');
      }
      return;
    }
    window.open(lanUpdateInfo.downloadUrl, '_blank', 'noopener,noreferrer');
  }

  const LAN_BASE_KEY = 'kaxia.lan.base.v1';

  function lanServerId() {
    if (isNativeApp()) {
      return lanSelected >= 0 && lanServers[lanSelected] ? lanServers[lanSelected].url : '';
    }
    return window.location.origin;
  }

  function lanFingerprints(value) {
    const result = {};
    (value && Array.isArray(value.games) ? value.games : []).forEach((game) => {
      result[lanSyncKey(game)] = hashString(JSON.stringify(game));
    });
    return result;
  }

  function lanSameFingerprints(left, right) {
    if (!left || !right) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => left[key] === right[key]);
  }

  function lanReadBase(serverId) {
    if (!serverId) return null;
    try {
      const data = JSON.parse(localStorage.getItem(LAN_BASE_KEY) || 'null');
      if (!data || data.serverId !== serverId || !data.local || !data.remote) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function lanWriteBase(serverId, localState, remoteState) {
    if (!serverId) return;
    try {
      localStorage.setItem(LAN_BASE_KEY, JSON.stringify({
        serverId,
        local: lanFingerprints(localState),
        remote: lanFingerprints(remoteState),
        syncedAt: new Date().toISOString()
      }));
    } catch (error) { /* localStorage 不可用时只影响自动判断 */ }
  }

  function lanAutoConfig() {
    try {
      const data = JSON.parse(localStorage.getItem('kaxia.lan.auto.v1') || 'null');
      if (data) {
        const mode = ['off', 'interval', 'daily', 'connect'].includes(data.mode) ? data.mode : (data.enabled ? 'interval' : 'off');
        return {
          mode,
          interval: [1, 5, 15, 30].includes(Number(data.interval)) ? Number(data.interval) : 5,
          time: /^\d{2}:\d{2}$/.test(String(data.time || '')) ? String(data.time) : '23:00'
        };
      }
    } catch (error) { /* ignore */ }
    return { mode: 'off', interval: 5, time: '23:00' };
  }

  function lanSaveAutoConfig(config) {
    try {
      localStorage.setItem('kaxia.lan.auto.v1', JSON.stringify(config));
    } catch (error) { /* ignore */ }
  }

  function lanSetAutoStatus(text) {
    const target = $('#lanAutoStatus');
    if (target) target.textContent = text;
  }

  function bindLanAutoControls() {
    const mode = $('#lanAutoMode');
    const interval = $('#lanAutoInterval');
    const time = $('#lanAutoTime');
    if (!mode || !interval || !time) return;
    const config = lanAutoConfig();
    mode.value = config.mode;
    interval.value = String(config.interval);
    time.value = config.time;
    const updateVisibility = () => {
      interval.style.display = mode.value === 'interval' ? '' : 'none';
      time.style.display = mode.value === 'daily' ? '' : 'none';
    };
    const save = () => {
      const next = {
        mode: mode.value,
        interval: Number(interval.value) || 5,
        time: time.value || '23:00'
      };
      lanSaveAutoConfig(next);
      updateVisibility();
      startLanAutoSync();
    };
    mode.addEventListener('change', save);
    interval.addEventListener('change', save);
    time.addEventListener('change', save);
    updateVisibility();
    if (config.mode === 'interval') lanSetAutoStatus('每 ' + config.interval + ' 分钟检查');
    else if (config.mode === 'daily') lanSetAutoStatus('每天 ' + config.time + ' 检查');
    else if (config.mode === 'connect') lanSetAutoStatus('连接电脑后自动检查');
    else lanSetAutoStatus('未开启');
    startLanAutoSync();
  }

  function startLanAutoSync() {
    if (serverMode) return;
    if (lanAutoTimer) {
      clearTimeout(lanAutoTimer);
      lanAutoTimer = null;
    }
    const config = lanAutoConfig();
    if (config.mode === 'off') {
      lanSetAutoStatus('未开启');
      return;
    }
    if (config.mode === 'interval') {
      lanSetAutoStatus('每 ' + config.interval + ' 分钟检查');
      lanAutoTimer = setInterval(() => {
        lanAutoTick();
      }, Math.max(60, config.interval * 60) * 1000);
      return;
    }
    if (config.mode === 'daily') {
      lanSetAutoStatus('每天 ' + config.time + ' 检查');
      const parts = config.time.split(':');
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
      lanAutoTimer = setTimeout(async () => {
        await lanAutoTick();
        startLanAutoSync();
      }, next.getTime() - now.getTime());
      return;
    }
    lanSetAutoStatus('连接电脑后自动检查');
    lanAutoTimer = setTimeout(() => {
      lanAutoTick();
    }, 800);
  }

  async function lanAutoTick() {
    if (lanAutoBusy) return;
    const config = lanAutoConfig();
    if (config.mode === 'off') return;
    lanAutoBusy = true;
    lanSetAutoStatus('正在检查…');
    try {
      const native = isNativeApp();
      if (native && lanSelected < 0) {
        const plugin = nativePlugin('LanSync');
        if (!plugin) throw new Error('当前版本不支持局域网同步');
        const result = await plugin.discover({ port: 8766 });
        lanServers = (result && Array.isArray(result.servers) ? result.servers : []).map((server) => ({
          name: String(server.name || '卡匣电脑'),
          url: String(server.url || ''),
          token: String(server.token || '')
        })).filter((server) => /^https?:\/\//i.test(server.url));
        lanSelected = lanServers.length ? 0 : -1;
        const box = $('#lanServers');
        if (box) box.innerHTML = lanServerListHTML();
      }
      if (native && lanSelected < 0) {
        lanSetAutoStatus('没有找到电脑');
        return;
      }
      const serverId = lanServerId();
      const base = lanReadBase(serverId);
      if (!base) {
        lanSetAutoStatus('请先手动同步一次');
        return;
      }
      const remote = await lanFetchRemote();
      if (!remote) {
        lanSetAutoStatus('电脑还没有数据');
        return;
      }
      const localPrints = lanFingerprints(state);
      const remotePrints = lanFingerprints(remote);
      const localChanged = !lanSameFingerprints(localPrints, base.local);
      const remoteChanged = !lanSameFingerprints(remotePrints, base.remote);
      if (!localChanged && !remoteChanged) {
        lanSetAutoStatus('已同步 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
        return;
      }
      if (localChanged && !remoteChanged) {
        const keys = new Set(state.games.map((game) => lanSyncKey(game)));
        const next = lanMergeStates(remote, state, keys, true);
        await lanUploadState(next);
        lanWriteBase(serverId, state, next);
        lanSetAutoStatus('已自动上传 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }));
        return;
      }
      if (!localChanged && remoteChanged) {
        lanSetAutoStatus('电脑有新修改，请手动下载');
        return;
      }
      lanSetAutoStatus('两边都有修改，请手动合并');
    } catch (error) {
      lanSetAutoStatus('自动同步失败：' + (error && error.message ? error.message : '未知错误'));
    } finally {
      lanAutoBusy = false;
    }
  }

  function lanSyncKey(game) {
    if (!game) return '';
    if (game.id) return 'id:' + String(game.id);
    return 'name:' + normalizeSearch(game.title) + '|' + normalizeSearch(game.region) + '|' + normalizeSearch(game.copyLabel);
  }

  function lanCloneState(value) {
    return normalizeState(JSON.parse(JSON.stringify(value || blankState())));
  }

  function lanMergeStates(base, source, keys, overwrite) {
    const next = lanCloneState(base);
    const index = new Map(next.games.map((game, position) => [lanSyncKey(game), position]));
    source.games.forEach((game) => {
      const key = lanSyncKey(game);
      if (!keys.has(key)) return;
      if (index.has(key)) {
        if (overwrite) {
          next.games[index.get(key)] = game;
        }
      } else {
        index.set(key, next.games.length);
        next.games.push(game);
      }
    });
    return normalizeState(next);
  }

  function lanUnionGames(local, remote) {
    const all = new Map();
    local.games.forEach((game) => all.set(lanSyncKey(game), { key: lanSyncKey(game), local: game, remote: null }));
    remote.games.forEach((game) => {
      const key = lanSyncKey(game);
      const row = all.get(key) || { key, local: null, remote: null };
      row.remote = game;
      all.set(key, row);
    });
    return Array.from(all.values()).sort((a, b) => {
      const left = (a.local || a.remote || {}).title || '';
      const right = (b.local || b.remote || {}).title || '';
      return String(left).localeCompare(String(right), 'zh-CN');
    });
  }

  async function lanFetchRemote() {
    const native = isNativeApp();
    const plugin = native ? nativePlugin('LanSync') : null;
    const server = native && lanSelected >= 0 ? lanServers[lanSelected] : null;
    if (native && !server) throw new Error('请先搜索并选择电脑');
    if (native) {
      try {
        const result = await plugin.download({ serverUrl: server.url, token: server.token });
        const text = result && result.payload ? String(result.payload) : '';
        const parsed = JSON.parse(text);
        return normalizeState(parsed && parsed.state ? parsed.state : parsed);
      } catch (error) {
        const message = error && error.message ? error.message : '';
        if (message.includes('还没有同步数据') || message.includes('404')) return null;
        throw error;
      }
    }
    const response = await fetch('/api/sync', { credentials: 'same-origin' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await lanResponseError(response));
    const parsed = await response.json();
    return normalizeState(parsed && parsed.state ? parsed.state : parsed);
  }

  async function lanUploadState(next) {
    const native = isNativeApp();
    const plugin = native ? nativePlugin('LanSync') : null;
    const server = native && lanSelected >= 0 ? lanServers[lanSelected] : null;
    if (native && !server) throw new Error('请先搜索并选择电脑');
    const payload = JSON.stringify({ app: 'kaxia', version: APP_VERSION, exportedAt: new Date().toISOString(), state: next });
    if (native) {
      await plugin.upload({ serverUrl: server.url, token: server.token, payload });
      return;
    }
    const response = await fetch('/api/sync', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    if (!response.ok) throw new Error(await lanResponseError(response));
  }

  async function lanOpenSync(direction = '') {
    if (lanSyncBusy) return;
    const native = isNativeApp();
    if (native && lanSelected < 0) {
      toast('请先点「搜索电脑」并选择一个电脑。', 'info');
      return;
    }
    lanSyncBusy = true;
    toast('正在读取电脑数据…', 'info');
    try {
      const remote = await lanFetchRemote();
      openLanSyncPanel(remote, direction);
    } catch (error) {
      const message = error && error.message ? error.message : '读取电脑数据失败';
      toast(message.includes('404') ? '电脑端服务是旧版或不支持同步；请关闭旧 CMD，用 Python 重新启动卡匣服务。' : message, 'error');
    } finally {
      lanSyncBusy = false;
    }
  }

  function openLanSyncPanel(remoteState, direction) {
    const local = lanCloneState(state);
    let remote = remoteState ? lanCloneState(remoteState) : null;
    let rows = lanUnionGames(local, remote || blankState());
    const selected = new Set(rows.map((row) => row.key));
    const item = createModal({
      title: '详细同步',
      subtitle: direction === 'upload' ? '从本机选择要上传的卡带，然后合并或覆盖到电脑。' : (direction === 'download' ? '从电脑选择要下载的卡带，然后合并或覆盖到本机。' : '选择卡带后，可以合并或覆盖到本机 / 电脑。'),
      size: 'lg',
      body: '<div id="lanSyncPanel"></div>',
      footer: '<button type="button" class="btn btn-secondary" data-close>关闭</button>'
    });
    const root = item.layer.querySelector('#lanSyncPanel');

    const render = () => {
      rows = lanUnionGames(local, remote || blankState());
      const selectedCount = selected.size;
      root.innerHTML =
        '<div class="lan-sync-summary"><span>本机 <strong>' + local.games.length + '</strong> 张</span><span>电脑 <strong>' + (remote ? remote.games.length : 0) + '</strong> 张</span><span>已选 <strong>' + selectedCount + '</strong> 张</span></div>' +
        '<div class="lan-sync-bulk-title">全部一键</div>' +
        '<div class="lan-sync-buttons">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="merge-download">' + icon('download') + '全部合并到本机</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="merge-upload">' + icon('upload') + '全部合并到电脑</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="overwrite-download">' + icon('refresh') + '全部覆盖本机</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="overwrite-upload">' + icon('refresh') + '全部覆盖电脑</button>' +
        '</div>' +
        '<div class="lan-sync-list-head"><strong>卡带明细</strong><span><button type="button" class="text-link" data-lan-select="all">全选</button> · <button type="button" class="text-link" data-lan-select="none">全不选</button></span></div>' +
        (rows.length
          ? '<div class="lan-sync-list">' + rows.map((row) => {
            const game = row.local || row.remote;
            const badges = (row.local ? '<span class="lan-badge local">本机</span>' : '') + (row.remote ? '<span class="lan-badge remote">电脑</span>' : '');
            return '<label class="lan-sync-row"><input type="checkbox" data-lan-key="' + esc(row.key) + '"' + (selected.has(row.key) ? ' checked' : '') + '><span class="lan-sync-row-copy"><strong>' + esc(game.title || '未命名卡带') + '</strong><small>' + esc(game.region || '未标注') + ' · ' + esc(game.condition || '未标注成色') + '</small></span><span class="lan-sync-badges">' + badges + '</span></label>';
          }).join('') + '</div>'
          : '<div class="lan-empty">本机和电脑都还没有卡带。</div>') +
        '<div class="lan-sync-bulk-title">处理选中项</div>' +
        '<div class="lan-sync-buttons">' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="selected-merge-download">合并到本机</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="selected-overwrite-download">覆盖本机</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-lan-action="selected-merge-upload">合并到电脑</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" data-lan-action="selected-overwrite-upload">覆盖电脑</button>' +
        '</div>' +
        '<p class="lan-sync-hint">合并只补充缺失卡带；覆盖会用选中的来源卡带替换目标中的同款。全部覆盖会替换整个卡带库。</p>';

      root.querySelectorAll('[data-lan-key]').forEach((checkbox) => {
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(checkbox.dataset.lanKey);
          else selected.delete(checkbox.dataset.lanKey);
          render();
        });
      });
      root.querySelectorAll('[data-lan-select]').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.lanSelect === 'all') rows.forEach((row) => selected.add(row.key));
          else selected.clear();
          render();
        });
      });
      root.querySelectorAll('[data-lan-action]').forEach((button) => {
        button.addEventListener('click', () => handleLanAction(button.dataset.lanAction));
      });
    };

    const applyLocal = (next, remoteState) => {
      state = normalizeState(next);
      filters.status = 'all';
      filters.q = '';
      filters.region = 'all';
      filters.platform = 'all';
      filters.cartridge = 'all';
      filters.tag = 'all';
      filters.sort = state.preferences.sort || 'recent';
      scheduleSave(0);
      lanWriteBase(lanServerId(), state, remoteState || state);
      closeModal(item, true);
      rerender({ keepScroll: false });
      toast('已更新本机卡带库。', 'success');
    };

    const handleLanAction = async (action) => {
      const isAll = action.indexOf('selected-') !== 0;
      const isUpload = action.endsWith('upload');
      const overwrite = action.indexOf('overwrite') >= 0;
      const keys = isAll ? new Set(rows.map((row) => row.key)) : new Set(selected);
      if (!keys.size) {
        toast('请先选择卡带。', 'info');
        return;
      }
      if (isAll && overwrite) {
        const confirmed = await askConfirm({
          title: '全部覆盖',
          heading: isUpload ? '用本机数据覆盖电脑？' : '用电脑数据覆盖本机？',
          message: '这会替换' + (isUpload ? '电脑上的全部同步数据' : '本机全部卡带数据') + '，不能撤销。',
          confirmText: '覆盖',
          danger: true
        });
        if (!confirmed) return;
      }
      try {
        if (!isUpload && !remote) {
          toast('电脑上还没有可下载的数据。', 'info');
          return;
        }
        if (isUpload) {
          const base = remote || blankState();
          const next = isAll && overwrite ? lanCloneState(local) : lanMergeStates(base, local, keys, overwrite);
          await lanUploadState(next);
          lanWriteBase(lanServerId(), local, next);
          remote = next;
          render();
          toast('已上传到电脑。', 'success');
        } else {
          const next = isAll && overwrite ? lanCloneState(remote) : lanMergeStates(local, remote, keys, overwrite);
          applyLocal(next, remote);
        }
      } catch (error) {
        toast(error && error.message ? error.message : '同步失败', 'error');
      }
    };

    render();
  }

  async function refreshNintendoAccounts() {
    const api = nintendoApi();
    if (!api) return;
    try {
      const response = await api.listAccounts();
      const accounts = (response && Array.isArray(response.accounts) ? response.accounts : [])
        .map(normalizeNintendoAccount).filter(Boolean);
      const before = JSON.stringify(state.nintendo.accounts || []);
      if (JSON.stringify(accounts) !== before) {
        state.nintendo.accounts = accounts;
        scheduleSave(200);
      }
      const box = $('#nintendoAccounts');
      if (box) box.innerHTML = nintendoAccountsHTML();
    } catch (error) {
      /* 未登录或原生层不可用时保持现有展示 */
    }
  }

  function mergeNintendoAccount(account) {
    const normalized = normalizeNintendoAccount(account);
    if (!normalized) return null;
    const accounts = state.nintendo.accounts || [];
    const index = accounts.findIndex((item) => item.id === normalized.id);
    if (index >= 0) {
      const previous = accounts[index];
      accounts[index] = {
        ...previous,
        ...normalized,
        devices: normalized.devices.length ? normalized.devices : previous.devices,
        addedAt: previous.addedAt || normalized.addedAt
      };
    } else {
      accounts.push(normalized);
    }
    state.nintendo.accounts = accounts;
    return accounts.find((item) => item.id === normalized.id) || normalized;
  }

  async function nintendoAddAccount() {
    if (nintendoBusy) return;
    const api = nintendoApi();
    if (!api) {
      toast('任天堂账号同步只能在安卓 App 中使用。', 'info');
      return;
    }
    nintendoBusy = true;
    const box = $('#nintendoAccounts');
    if (box) box.innerHTML = nintendoAccountsHTML();
    try {
      const account = await api.addAccount();
      const merged = mergeNintendoAccount(account);
      if (merged) {
        scheduleSave(0);
        toast('已登录任天堂账号：' + merged.nickname, 'success');
      }
      await refreshNintendoAccounts();
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      if (!message.includes('取消')) toast(message || '任天堂登录失败', 'error');
    } finally {
      nintendoBusy = false;
      if (box && box.isConnected) box.innerHTML = nintendoAccountsHTML();
    }
  }

  async function nintendoSyncOne(accountId) {
    if (nintendoBusy) return;
    const api = nintendoApi();
    if (!api) {
      toast('任天堂账号同步只能在安卓 App 中使用。', 'info');
      return;
    }
    nintendoBusy = true;
    toast('正在从任天堂读取游玩记录…', 'info');
    try {
      const result = await api.sync({ accountId });
      if (result && result.account) mergeNintendoAccount(result.account);
      scheduleSave(0);
      openNintendoSyncPreview([result]);
    } catch (error) {
      toast(error && error.message ? error.message : '任天堂同步失败', 'error');
    } finally {
      nintendoBusy = false;
      const box = $('#nintendoAccounts');
      if (box) box.innerHTML = nintendoAccountsHTML();
    }
  }

  async function nintendoSyncAll() {
    if (nintendoBusy) return;
    const api = nintendoApi();
    const accounts = state.nintendo.accounts || [];
    if (!api || !accounts.length) {
      toast('还没有绑定任天堂账号。', 'info');
      return;
    }
    nintendoBusy = true;
    toast('正在同步 ' + accounts.length + ' 个任天堂账号…', 'info');
    const results = [];
    const failures = [];
    try {
      for (const account of accounts) {
        try {
          const result = await api.sync({ accountId: account.id });
          if (result && result.account) mergeNintendoAccount(result.account);
          results.push(result);
        } catch (error) {
          failures.push(account.nickname + '：' + (error && error.message ? error.message : '同步失败'));
        }
      }
      scheduleSave(0);
      if (results.length) openNintendoSyncPreview(results);
      if (failures.length) toast(failures[0], 'error');
      if (!results.length && !failures.length) toast('没有可以同步的账号。', 'info');
    } finally {
      nintendoBusy = false;
      const box = $('#nintendoAccounts');
      if (box) box.innerHTML = nintendoAccountsHTML();
    }
  }

  async function nintendoRemoveAccount(accountId) {
    if (nintendoBusy) return;
    const account = (state.nintendo.accounts || []).find((item) => item.id === accountId);
    if (!account) return;
    const confirmed = await askConfirm({
      title: '解除任天堂账号',
      heading: '解除「' + account.nickname + '」？',
      message: '会删除这台手机上保存的授权。已经同步到卡带里的游玩时长不会扣除。之后可以重新登录。',
      confirmText: '解除绑定',
      danger: true
    });
    if (!confirmed) return;
    const api = nintendoApi();
    if (!api) return;
    nintendoBusy = true;
    try {
      await api.removeAccount({ accountId });
      state.nintendo.accounts = (state.nintendo.accounts || []).filter((item) => item.id !== accountId);
      state.nintendo.records = (state.nintendo.records || []).filter((record) => record.accountId !== accountId);
      scheduleSave(0);
      const box = $('#nintendoAccounts');
      if (box) box.innerHTML = nintendoAccountsHTML();
      toast('已解除任天堂账号授权。', 'success');
    } catch (error) {
      toast(error && error.message ? error.message : '解除绑定失败', 'error');
    } finally {
      nintendoBusy = false;
      const box = $('#nintendoAccounts');
      if (box) box.innerHTML = nintendoAccountsHTML();
    }
  }

  function normalizeNintendoTitle(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[™®©]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  }


  function detectRegionCandidates(value) {
    const text = String(value || '').normalize('NFKC').toUpperCase();
    // OCR 常把 JPN 读成 J PN、HKG 读成 H KG；去掉分隔符后再匹配一次。
    const compact = text.replace(/[^A-Z0-9]/g, '');
    const found = [];
    REGION_SIGNATURES.forEach((signature) => {
      if (signature.patterns.some((pattern) => pattern.test(text) || pattern.test(compact))) found.push(signature.label);
    });
    let candidates = Array.from(new Set(found));
    if (candidates.includes('港版') && candidates.includes('台版')) {
      if (/\bHKG\b|HONG\s*KONG|香港/.test(text)) candidates = candidates.filter((label) => label !== '台版');
      else if (/\bTWN\b|\bNCC\b|\bBSMI\b/.test(text)) candidates = candidates.filter((label) => label !== '港版');
    }
    if (candidates.includes('国行') && candidates.includes('亚洲版')) {
      if (/\bCHN\b|TENCENT|腾讯|騰訊/.test(text)) candidates = candidates.filter((label) => label !== '亚洲版');
      else if (/\bASI\b|\bASIA\b|\bSEA\b/.test(text)) candidates = candidates.filter((label) => label !== '国行');
    }
    return candidates;
  }

  function detectRegionFromText(value) {
    return detectRegionCandidates(value)[0] || '';
  }

  function findNintendoMatch(title) {
    const needle = normalizeNintendoTitle(title);
    if (!needle) return null;
    const exact = state.games.filter((game) => normalizeNintendoTitle(game.title) === needle || normalizeNintendoTitle(game.subtitle) === needle);
    if (exact.length === 1) return exact[0];
    const partial = state.games.filter((game) => {
      const gameTitle = normalizeNintendoTitle(game.title);
      return gameTitle && (needle.includes(gameTitle) || gameTitle.includes(needle));
    });
    return partial.length === 1 ? partial[0] : null;
  }



  function openNintendoGuide() {
    const body =
      '<div class="guide-intro">' +
        '<span class="guide-eyebrow">NINTENDO SYNC GUIDE</span>' +
        '<h3>先弄清楚：卡匣读的是家长控制数据</h3>' +
        '<p>卡匣不会读取任天堂密码，也不使用 Nintendo Switch Online 的接口。它通过任天堂家长控制 App 的授权，读取已绑定主机的每日游玩记录，再把游戏和你的卡带库对应起来。</p>' +
      '</div>' +
      '<div class="guide-callout warn">' + icon('alert') + '<div><strong>两个 App 不是一回事</strong><p>在「Nintendo Switch Online」里能看到时间，不代表「Nintendo Switch Parental Controls」里已经绑定主机。卡匣只认后者。</p></div></div>' +
      '<section class="guide-section">' +
        '<h3>1. 能同步什么</h3>' +
        '<ul>' +
          '<li>同一台已绑定主机上的所有本地 Switch 玩家；</li>' +
          '<li>每个玩家、每天、每个游戏的游玩分钟数；</li>' +
          '<li>同步后按游戏名和应用 ID 自动匹配卡带，匹配不到可以手动选；</li>' +
          '<li>支持多个任天堂账号和多台主机。' +
        '</ul>' +
        '<p class="guide-muted">它不能直接给出“账号下所有主机的终身总时长”。每台主机都要先在官方家长控制 App 里绑定；多台主机分别同步。</p>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>2. 开始前要准备什么</h3>' +
        '<div class="guide-step"><span class="guide-step-num">1</span><div><strong>Switch 已开启家长控制</strong><p>在 Switch 的「系统设置 → 家长控制」里开启，并用手机上的 Nintendo Switch Parental Controls App 完成绑定。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">2</span><div><strong>用家长账号登录卡匣</strong><p>必须是绑定主机时的家长 / 监护人 Nintendo Account。孩子账号即使能登录，也可能读不到主机列表。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">3</span><div><strong>官方 App 里能看到主机和时间</strong><p>先打开官方家长控制 App，确认主机出现在列表里，并且能打开每日或每月游玩记录。</p></div></div>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>3. 第一次同步</h3>' +
        '<div class="guide-step"><span class="guide-step-num">1</span><div><strong>登录</strong><p>设置 → 任天堂账号同步 → 登录任天堂账号。登录页是任天堂官方页面，密码只输入在那里。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">2</span><div><strong>点「同步」</strong><p>卡匣会读取主机列表和每日记录。第一次可能需要几秒钟。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">3</span><div><strong>检查预览</strong><p>每行是一个游戏，会显示玩家和时长。自动匹配到的卡带会打勾；没有匹配上的，在右侧下拉框里手动选择。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">4</span><div><strong>选择写入方式</strong><p>「只增加新增时长」保留你现有的累计，只加这次新出现的部分；「用任天堂数据覆盖」会把选中卡带的累计改成任天堂的合计。</p></div></div>' +
        '<div class="guide-step"><span class="guide-step-num">5</span><div><strong>应用并核对</strong><p>点「应用到卡带库」，回到卡带详情查看累计时长和玩家明细。</p></div></div>' +
        '<div class="guide-callout">' + icon('info') + '<div><strong>第一次同步的建议</strong><p>如果你之前手动填过游玩时长，先看一眼预览里的数字。怕重复就选「覆盖」；想保留手动记录就选「只增加」，再把明显不对的卡带手动改一下。</p></div></div>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>4. 多账号、多玩家怎么算</h3>' +
        '<ul>' +
          '<li>一个卡匣可以绑定多个任天堂账号；每个账号可以有自己绑定的主机。</li>' +
          '<li>同一台 Switch 上的多个本地玩家会分别显示，不会被合并成一个人。</li>' +
          '<li>没有识别到 Nintendo Account 的访客玩家会归到「未识别玩家」或主机汇总。</li>' +
          '<li>同一个设备、日期、玩家、游戏的记录会自动去重，重复同步不会重复加。</li>' +
        '</ul>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>5. 常见错误</h3>' +
        '<div class="guide-error"><strong>找不到已绑定的 Switch 主机（404）</strong><p>任天堂返回的设备列表是空的。先确认登录的是家长账号，再确认官方家长控制 App 里能看到主机。如果官方 App 能看到但卡匣仍报 404：在官方 App 里解除主机绑定，重新配对，打开一次每日记录，然后回卡匣解除账号、重新登录、同步。</p></div>' +
        '<div class="guide-error"><strong>找不到某台主机的每日记录（404）</strong><p>主机在账号下，但这台主机没有可读取的每日数据。打开官方 App 同步一次，或换一个有过游玩记录的日期再试。</p></div>' +
        '<div class="guide-error"><strong>授权已失效（401 / 403）</strong><p>token 过期或被任天堂撤销。在设置里解除任天堂账号，再重新登录。</p></div>' +
        '<div class="guide-error"><strong>update_required</strong><p>任天堂要求更新家长控制接口版本。卡匣 1.3.1 已适配官方 2.7.0 / 740；如果仍提示，请确认安装的是最新版卡匣。</p></div>' +
        '<div class="guide-error"><strong>没有读取到游玩记录</strong><p>账号和主机正常，但最近没有可同步的游玩数据；先在 Switch 上玩一会儿，或打开官方 App 确认记录已经生成。</p></div>' +
        '<div class="guide-callout warn">' + icon('alert') + '<div><strong>官方 App 能看、卡匣 404</strong><p>优先检查三件事：登录邮箱是否同一个、官方 App 是否真的是 Parental Controls、主机是否重新绑定过。三者都确认后再重试。</p></div></div>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>6. 数据规则</h3>' +
        '<ul>' +
          '<li>同步只读取，不会修改任天堂账号或主机设置。</li>' +
          '<li>「只增加」使用增量记录，避免同一批数据重复累加。</li>' +
          '<li>「覆盖」会把选中卡带的累计时长改成任天堂统计的合计。</li>' +
          '<li>已同步的记录保存在本机，删除任天堂账号不会自动扣掉已经写入的时长。</li>' +
        '</ul>' +
      '</section>' +
      '<section class="guide-section">' +
        '<h3>7. 安全和限制</h3>' +
        '<ul>' +
          '<li>任天堂密码只输入在任天堂官方页面，卡匣不读取、不保存。</li>' +
          '<li>session_token 用 Android Keystore 加密保存，不进入 JavaScript，也不进入 JSON 备份。</li>' +
          '<li>这是非官方家长控制接口，任天堂改协议后可能失效。</li>' +
          '<li>同步是手动的；卡匣不会在后台自动上传或修改数据。</li>' +
          '<li>换手机后需要重新登录任天堂账号。</li>' +
        '</ul>' +
      '</section>' +
      '<p class="guide-version">卡匣 v' + APP_VERSION + ' · 任天堂账号同步教程</p>';
    createModal({
      title: '任天堂同步教程',
      subtitle: '从绑定主机到写入卡带，按步骤来。',
      size: 'lg',
      body,
      footer: '<button type="button" class="btn btn-secondary" data-close>知道了</button>'
    });
  }

  function openNintendoSyncPreview(results) {
    const newRecords = [];
    const accounts = [];
    (results || []).forEach((result) => {
      if (result && result.account) accounts.push(result.account);
      (result && Array.isArray(result.records) ? result.records : []).forEach((record) => {
        const normalized = normalizeNintendoRecord(record);
        if (normalized) newRecords.push(normalized);
      });
    });
    accounts.forEach((account) => mergeNintendoAccount(account));
    if (!newRecords.length) {
      scheduleSave(0);
      toast('这次没有读取到可同步的游玩记录。', 'info');
      return;
    }

    const appMap = new Map();
    newRecords.forEach((record) => {
      let app = appMap.get(record.applicationId);
      if (!app) {
        app = { id: record.applicationId, title: record.title, minutes: 0, players: new Map(), dates: new Set() };
        appMap.set(record.applicationId, app);
      }
      app.minutes += record.minutes;
      app.dates.add(record.date);
      const playerKey = record.playerId || record.playerName;
      const player = app.players.get(playerKey) || { name: record.playerName || 'Switch 玩家', minutes: 0 };
      player.minutes += record.minutes;
      app.players.set(playerKey, player);
    });

    const mergedMap = new Map();
    (state.nintendo.records || []).forEach((record) => mergedMap.set(nintendoRecordKey(record), record));
    newRecords.forEach((record) => mergedMap.set(nintendoRecordKey(record), record));

    const entries = Array.from(appMap.values()).map((app) => {
      let game = state.games.find((item) => (item.nintendoAppIds || []).map((id) => String(id).toUpperCase()).includes(app.id));
      if (!game) game = findNintendoMatch(app.title);
      let appTotal = 0;
      mergedMap.forEach((record) => {
        if (record.applicationId === app.id) appTotal += record.minutes;
      });
      const players = Array.from(app.players.values()).sort((a, b) => b.minutes - a.minutes);
      const dates = Array.from(app.dates).sort();
      return { app, game, appTotal, players, dates };
    }).sort((a, b) => {
      if (Boolean(a.game) !== Boolean(b.game)) return a.game ? -1 : 1;
      return b.app.minutes - a.app.minutes;
    });

    const gameOptions = state.games.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN')).map((game) => {
      return '<option value="' + esc(game.id) + '">' + esc(game.title) + '</option>';
    }).join('');
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.app.minutes, 0);
    const firstSync = !(state.nintendo.records || []).length;
    const accountLabel = accounts.map((account) => account.nickname || '').filter(Boolean).join('、');

    const body =
      '<div class="sync-summary">' +
        '<div class="sync-summary-icon">' + icon('gamepad') + '</div>' +
        '<div><strong>读取到 ' + entries.length + ' 个游戏 · ' + fmtHours(totalMinutes) + '</strong><small>' +
          esc(accountLabel || '任天堂账号') + (firstSync ? ' · 首次同步' : ' · 已有记录会去重') +
        '</small></div>' +
      '</div>' +
      '<div class="sync-list">' + entries.map((entry) => {
        const playerText = entry.players.slice(0, 3).map((player) => esc(player.name) + ' ' + fmtHours(player.minutes)).join(' · ');
        const dateText = entry.dates.length ? fmtDate(entry.dates[0]) + (entry.dates.length > 1 ? ' ~ ' + fmtDate(entry.dates[entry.dates.length - 1]) : '') : '日期未知';
        const selectedGame = entry.game ? entry.game.id : '';
        const options = '<option value="">不导入 / 选择卡带</option>' + gameOptions
          .replace('value="' + esc(selectedGame) + '"', 'value="' + esc(selectedGame) + '" selected');
        return '<div class="sync-row" data-sync-row data-app-id="' + esc(entry.app.id) + '">' +
          '<input type="checkbox" class="sync-check" data-sync-check aria-label="导入这个游戏"' + (entry.game ? ' checked' : '') + '>' +
          (entry.game ? '<div class="sync-cover">' + coverHTML(entry.game, 'cover-mini') + '</div>' : '<span class="sync-unknown">?</span>') +
          '<div class="sync-copy"><strong>' + esc(entry.app.title) + '</strong><small>' + esc(playerText || '没有玩家明细') + ' · ' + esc(dateText) + '</small></div>' +
          '<div class="sync-minutes">+' + fmtHours(entry.app.minutes) + '</div>' +
          '<select class="sync-select" data-sync-game aria-label="关联卡带">' + options + '</select>' +
        '</div>';
      }).join('') + '</div>' +
      '<div class="sync-mode">' +
        '<label><input type="radio" name="nintendo-sync-mode" value="add" checked> <span><strong>只增加新增时长</strong><small>保留现有累计，只把这次新出现的时长加进去。</small></span></label>' +
        '<label><input type="radio" name="nintendo-sync-mode" value="overwrite"> <span><strong>用任天堂数据覆盖</strong><small>把选中卡带的累计游玩时长改成任天堂的合计。</small></span></label>' +
      '</div>' +
      (firstSync ? '<div class="form-note" style="margin-top:14px">' + icon('info') + '<span>首次同步建议先确认数字。如果你之前已经手动填过相近的游玩时长，选择「只增加」可能会重复；想以任天堂数据为准可选择「覆盖」。</span></div>' : '') +
      '<div class="sync-hint">同一台主机上的多个 Switch 玩家会分别统计；同名游戏会自动匹配，也可以在这里手动选择卡带。</div>';

    createModal({
      title: '任天堂游玩时长',
      subtitle: '确认后才会写入卡带库。',
      size: 'lg',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn-primary" data-apply-sync>' + icon('check') + '应用到卡带库</button>',
      onMount: (layer, close) => {
        const applyButton = layer.querySelector('[data-apply-sync]');
        applyButton.addEventListener('click', () => {
          const rows = Array.from(layer.querySelectorAll('[data-sync-row]'));
          const mapping = [];
          rows.forEach((row) => {
            const check = row.querySelector('[data-sync-check]');
            const select = row.querySelector('[data-sync-game]');
            if (!check || !check.checked || !select || !select.value) return;
            mapping.push({ appId: row.dataset.appId, gameId: select.value });
          });
          if (!mapping.length) {
            toast('请至少选择一个要导入的卡带。', 'info');
            return;
          }
          const modeInput = layer.querySelector('input[name="nintendo-sync-mode"]:checked');
          const mode = modeInput ? modeInput.value : 'add';
          close();
          applyNintendoSync(newRecords, mapping, mode, accounts);
        });
      }
    });
  }

  function applyNintendoSync(records, mapping, mode, accounts) {
    const recordMap = new Map();
    (state.nintendo.records || []).forEach((record) => recordMap.set(nintendoRecordKey(record), record));
    records.forEach((record) => recordMap.set(nintendoRecordKey(record), record));
    state.nintendo.records = Array.from(recordMap.values());

    const byGame = new Map();
    mapping.forEach((item) => {
      if (!byGame.has(item.gameId)) byGame.set(item.gameId, new Set());
      byGame.get(item.gameId).add(item.appId);
    });

    let changed = 0;
    byGame.forEach((appIds, gameId) => {
      const game = state.games.find((item) => item.id === gameId);
      if (!game) return;
      const ids = new Set((game.nintendoAppIds || []).map((id) => String(id).toUpperCase()));
      appIds.forEach((id) => ids.add(String(id).toUpperCase()));
      game.nintendoAppIds = Array.from(ids);
      let total = 0;
      state.nintendo.records.forEach((record) => {
        if (ids.has(String(record.applicationId).toUpperCase())) total += record.minutes;
      });
      const previous = Math.max(0, Number(game.nintendoImportedMinutes) || 0);
      if (mode === 'overwrite') {
        game.playMinutes = total;
        game.nintendoImportedMinutes = total;
      } else {
        const delta = Math.max(0, total - previous);
        if (delta > 0) {
          game.playMinutes = Math.max(0, Number(game.playMinutes) || 0) + delta;
          game.playLogs = Array.isArray(game.playLogs) ? game.playLogs : [];
          game.playLogs.push({
            id: uid('p'),
            date: todayISO(),
            minutes: delta,
            note: '任天堂账号同步'
          });
          changed += delta;
        }
        game.nintendoImportedMinutes = Math.max(previous, total);
      }
      game.updatedAt = new Date().toISOString();
    });

    if (accounts && accounts.length) {
      accounts.forEach((account) => mergeNintendoAccount(account));
    }
    state.nintendo.lastSyncAt = new Date().toISOString();
    scheduleSave(0);
    rerender({ keepScroll: true });
    toast(mode === 'overwrite' ? '已用任天堂数据更新选中卡带。' : '已同步 ' + fmtHours(changed) + ' 到卡带库。', 'success');
  }

  function openSettings() {
    const modeLabel = serverMode ? '电脑卡匣服务（data/sync-data.json）' : (storageMode === 'idb' ? 'IndexedDB（浏览器数据库）' : 'localStorage（浏览器本地存储）');
    const installNote = deferredInstallPrompt ? '浏览器已准备好安装包。' : '在支持安装的浏览器里，可以把卡匣添加到桌面。';
    const installCard = isNativeApp()
      ? '<div class="install-card"><div class="eyebrow"><span class="eyebrow-dot" style="background:#ff8b80"></span>ANDROID APP</div><h3>卡匣安卓版</h3><p>当前已经在卡匣 App 中运行。数据保存在这台手机，完全离线可用。</p><p class="install-hint">v' + APP_VERSION + ' · com.kaxia.cartridge</p></div>'
      : '<div class="install-card"><div class="eyebrow"><span class="eyebrow-dot" style="background:#ff8b80"></span>INSTALL KAXIA</div><h3>把卡匣放到手机桌面</h3><p>安装后可以全屏打开，离线也能查看和管理收藏。</p><button type="button" class="btn btn-primary btn-sm" data-action="install-app">' + icon('install') + '安装到桌面</button><p class="install-hint">' + installNote + '</p></div>';
    const body =
      '<div class="settings-section">' + installCard + '</div>' +
      '<div class="settings-section"><div class="settings-title">' + icon('gamepad') + '任天堂账号同步（实验性）</div><div id="nintendoAccounts">' + nintendoAccountsHTML() + '</div></div>' +
      '<div class="settings-section"><div class="settings-title">' + icon('refresh') + '局域网同步</div>' + lanSyncHTML() + '</div>' +
      '<div class="settings-section"><div class="settings-title">' + icon('database') + '数据与备份</div>' +
        '<div class="settings-row"><span class="settings-row-icon">' + icon('database') + '</span><div class="settings-row-copy"><strong>本地保存</strong><small id="storageUsage">' + modeLabel + ' · 正在计算占用空间…</small></div></div>' +
        '<div class="settings-row"><span class="settings-row-icon">' + icon('download') + '</span><div class="settings-row-copy"><strong>导出 JSON 备份</strong><small>包含全部卡带、游玩和出借记录，可用于换设备恢复。</small></div><button type="button" class="btn btn-secondary" data-action="export-json">导出</button></div>' +
        '<div class="settings-row"><span class="settings-row-icon">' + icon('book') + '</span><div class="settings-row-copy"><strong>导出 CSV 表格</strong><small>用 Excel 或 Numbers 打开，适合打印和查看。</small></div><button type="button" class="btn btn-secondary" data-action="export-csv">导出</button></div>' +
        '<div class="settings-row"><span class="settings-row-icon">' + icon('upload') + '</span><div class="settings-row-copy"><strong>导入备份</strong><small>从之前导出的 JSON 文件恢复，可选择替换或合并。</small></div><button type="button" class="btn btn-secondary" data-action="open-import">导入</button></div>' +
        '<input id="importFile" type="file" accept=".json,application/json" hidden>' +
      '</div>' +
      '<div class="settings-section"><div class="settings-title">' + icon('sparkle') + '示例与重置</div>' +
        '<div class="settings-row"><span class="settings-row-icon">' + icon('sparkle') + '</span><div class="settings-row-copy"><strong>载入示例数据</strong><small>加入 10 张演示卡带，看看完整效果。已有数据时会追加。</small></div><button type="button" class="btn btn-secondary" data-action="load-demo">载入</button></div>' +
        '<div class="settings-row danger"><span class="settings-row-icon">' + icon('trash') + '</span><div class="settings-row-copy"><strong>清空全部数据</strong><small>删除所有卡带和记录。操作前建议先导出备份。</small></div><button type="button" class="btn btn-danger" data-action="reset-all">清空</button></div>' +
      '</div>' +
      '<div class="settings-section"><div class="settings-title">' + icon('info') + '关于</div><div class="about-block"><span class="about-mark"><svg viewBox="0 0 40 40" fill="none"><rect x="7" y="4.5" width="26" height="31" rx="6" fill="currentColor"/><path d="M14 4.5v7a2.5 2.5 0 0 0 2.5 2.5h7A2.5 2.5 0 0 0 26 11.5v-7" fill="#f5f1e8"/><rect x="12.5" y="21" width="15" height="2.6" rx="1.3" fill="#f5f1e8"/></svg></span><div class="about-copy"><strong>卡匣 · Switch 卡带管家</strong><small>中文 · 本地优先 · 数据只属于你</small></div><span class="about-version">v' + APP_VERSION + '</span></div></div>';
    createModal({
      title: '设置',
      subtitle: '数据、任天堂同步和备份。',
      size: 'lg',
      body,
      footer: '<button type="button" class="btn btn-secondary" data-close>完成</button>',
      onMount: (layer) => {
        const input = layer.querySelector('#importFile');
        input.addEventListener('change', () => {
          const file = input.files && input.files[0];
          if (file) handleImportFile(file);
          input.value = '';
        });
        updateStorageInfo();
        refreshNintendoAccounts();
        setTimeout(lanCheckUpdate, 0);
        bindLanAutoControls();
      }
    });
  }

  async function updateStorageInfo() {
    const target = $('#storageUsage');
    if (!target) return;
    let usage = '';
    if (navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const estimate = await navigator.storage.estimate();
        if (estimate && estimate.usage) usage = ' · 已用 ' + fmtBytes(estimate.usage);
      } catch (error) { /* ignore */ }
    }
    target.textContent = (serverMode ? '电脑卡匣服务（data/sync-data.json）' : (storageMode === 'idb' ? 'IndexedDB（浏览器数据库）' : 'localStorage（浏览器本地存储）')) + usage;
  }

  function openInstallHelp() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const steps = isIOS
      ? '<p><strong>iPhone / iPad</strong></p><p>1. 用 Safari 打开这个页面；<br>2. 点底部的「分享」按钮；<br>3. 选择「添加到主屏幕」；<br>4. 确认名称后点「添加」。</p>'
      : (isAndroid
        ? '<p><strong>Android</strong></p><p>1. 用 Chrome 打开这个页面；<br>2. 点右上角菜单；<br>3. 选择「安装应用」或「添加到主屏幕」；<br>4. 确认安装。</p>'
        : '<p><strong>电脑浏览器</strong></p><p>1. 用 Chrome 或 Edge 打开这个页面；<br>2. 点击地址栏右侧的安装图标；<br>3. 或在浏览器菜单中选择「安装卡匣」。</p>');
    createModal({
      title: '安装到桌面',
      subtitle: '像普通 App 一样打开卡匣。',
      size: 'sm',
      body: '<div class="confirm-icon">' + icon('install') + '</div><div class="confirm-title">添加到主屏幕</div><div class="confirm-text">' + steps + '<p style="margin-top:10px">安装需要 HTTPS 或 localhost。如果手机访问的是电脑局域网地址，建议先部署到 GitHub Pages 等静态托管服务。</p></div>',
      footer: '<button type="button" class="btn btn-primary" data-close>知道了</button>'
    });
  }

  async function exportJSON() {
    const payload = {
      app: 'kaxia',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      state
    };
    const saved = await downloadFile('卡匣备份-' + todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    if (saved) toast(isNativeApp() ? '备份已生成，请选择保存位置。' : 'JSON 备份已导出。', 'success');
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value).replace(/"/g, '""');
    return '"' + text + '"';
  }

  async function exportCSV() {
    const header = ['游戏名称', '副标题', '版本', '卡带编号', '平台支持', '卡带版本', '副本标识', '成色', '购入日期', '购入价格', '购买渠道', '游玩小时', '状态', '借出人', '借出日期', '约定归还', '备注', '售出日期', '售出价格', '售出去向', '售出备注', '二手参考价', '二手价日期', '二手来源', '二手备注'];
    const rows = state.games.map((game) => {
      const loan = activeLoan(game);
      return [
        game.title, game.subtitle, game.region, game.cartridgeCode, PLATFORM_LABELS[game.platformSupport] || PLATFORM_LABELS.NS1, CARTRIDGE_LABELS[game.cartridgeType] || CARTRIDGE_LABELS.NS1, game.copyLabel, game.condition, game.purchaseDate, game.price,
        game.purchaseChannel, hoursNumber(game.playMinutes), gameStatus(game).label,
        loan ? loan.borrower : '', loan ? loan.loanDate : '', loan ? loan.dueDate : '', game.note,
        game.soldAt, game.soldPrice, game.soldTo, game.saleNote,
        game.marketPrice, game.marketUpdatedAt, game.marketSource, game.marketNote
      ].map(csvCell).join(',');
    });
    const content = '\uFEFF' + [header.map(csvCell).join(','), ...rows].join('\r\n');
    const saved = await downloadFile('卡匣收藏-' + todayISO() + '.csv', content, 'text/csv;charset=utf-8');
    if (saved) toast(isNativeApp() ? 'CSV 已生成，请选择保存位置。' : 'CSV 已导出，可直接用 Excel 打开。', 'success');
  }

  async function downloadFile(filename, content, type) {
    if (isNativeApp()) {
      const filesystem = nativePlugin('Filesystem');
      const share = nativePlugin('Share');
      if (filesystem && share) {
        try {
          const result = await filesystem.writeFile({
            path: filename,
            data: base64FromString(content),
            directory: 'CACHE',
            recursive: true
          });
          await share.share({ title: filename, url: result.uri, dialogTitle: '保存或分享备份' });
          return true;
        } catch (error) {
          toast('系统分享失败，请重试。', 'error');
          return false;
        }
      }
    }
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1800);
    return true;
  }

  async function handleImportFile(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast('备份文件超过 30MB，无法导入。', 'error');
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeState(parsed);
      if (!normalized.games.length) {
        toast('这个备份里没有可导入的卡带。', 'error');
        return;
      }
      openImportChoice(normalized, file.name);
    } catch (error) {
      toast('备份文件读取失败，请确认是卡匣导出的 JSON。', 'error');
    }
  }

  function openImportChoice(imported, filename) {
    const count = imported.games.length;
    const body =
      '<div class="confirm-icon">' + icon('upload') + '</div>' +
      '<div class="confirm-title">找到 ' + count + ' 张卡带</div>' +
      '<div class="confirm-text">来自「' + esc(filename || '备份文件') + '」。当前卡带库有 ' + state.games.length + ' 张卡带。<br><br><strong>合并</strong>会跳过同名同版本的卡带；<strong>替换</strong>会先清空当前数据。</div>';
    createModal({
      title: '导入备份',
      size: 'sm',
      body,
      footer:
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn-secondary" data-import="merge">合并导入</button>' +
        '<button type="button" class="btn btn-primary" data-import="replace">替换全部</button>',
      onMount: (layer, close) => {
        layer.querySelectorAll('[data-import]').forEach((button) => {
          button.addEventListener('click', () => {
            if (button.dataset.import === 'replace') {
              state.games = imported.games;
              state.preferences = imported.preferences;
            } else {
              const existingKeys = new Set(state.games.map((game) => normalizeSearch(game.title) + '|' + normalizeSearch(game.region)));
              imported.games.forEach((game) => {
                const key = normalizeSearch(game.title) + '|' + normalizeSearch(game.region);
                if (existingKeys.has(key)) return;
                existingKeys.add(key);
                state.games.push({ ...game, id: state.games.some((item) => item.id === game.id) ? uid() : game.id });
              });
            }
            scheduleSave(0);
            close();
            closeAllModals(true);
            filters.status = 'all';
            filters.q = '';
            filters.region = 'all';
            filters.platform = 'all';
            filters.cartridge = 'all';
            filters.tag = 'all';
            rerender({ keepScroll: false });
            toast('导入完成，共 ' + count + ' 张卡带。', 'success');
          });
        });
      }
    });
  }

  async function loadDemoData() {
    if (state.games.some((game) => String(game.id).startsWith('demo_'))) {
      toast('示例数据已经在卡带库里了。', 'info');
      return;
    }
    if (state.games.length) {
      const confirmed = await askConfirm({
        title: '载入示例数据',
        heading: '要追加示例卡带吗？',
        message: '会加入 10 张演示卡带，不会删除你已有的记录。之后可以在设置里清空。',
        confirmText: '追加示例'
      });
      if (!confirmed) return;
    }
    state.games.push(...demoGames());
    scheduleSave(0);
    closeAllModals(true);
    rerender({ keepScroll: false });
    toast('已载入示例数据，随便看看吧。', 'success');
  }

  async function resetAllData() {
    const confirmed = await askConfirm({
      title: '清空全部数据',
      heading: '确定要清空卡带库吗？',
      message: '所有卡带、游玩记录和出借历史都会从这台设备上删除。这个操作不能撤销，建议先导出 JSON 备份。',
      confirmText: '清空全部',
      danger: true
    });
    if (!confirmed) return;
    state.games = [];
    state.preferences = { view: 'grid', sort: 'recent' };
    filters.status = 'all';
    filters.q = '';
    filters.region = 'all';
    filters.platform = 'all';
    filters.cartridge = 'all';
    filters.tag = 'all';
    filters.sort = 'recent';
    closeAllModals(true);
    closeDrawer(true);
    scheduleSave(0);
    rerender({ keepScroll: false });
    toast('卡带库已清空。', 'success');
  }

  /* ---------------------------------------------------------
     Image compression
     --------------------------------------------------------- */

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = source;
    });
  }

  async function compressImage(file, options = {}) {
    if (!file.type || !file.type.startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size > 15 * 1024 * 1024) throw new Error('图片不能超过 15MB');
    const dataUrl = await readFileAsDataURL(file);
    const image = await loadImage(dataUrl);
    const maxWidth = options.maxWidth || 800;
    const maxHeight = options.maxHeight || 1066;
    const quality = options.quality || 0.82;
    const limit = options.limit || 1200000;
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const ratio = Math.min(1, maxWidth / width, maxHeight / height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5f1e8';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let result = canvas.toDataURL('image/webp', quality);
    if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/jpeg', quality + 0.02);
    if (result.length > limit) {
      const smaller = document.createElement('canvas');
      const scale = Math.sqrt(limit / result.length);
      smaller.width = Math.max(1, Math.round(width * scale));
      smaller.height = Math.max(1, Math.round(height * scale));
      const smallContext = smaller.getContext('2d');
      smallContext.fillStyle = '#f5f1e8';
      smallContext.fillRect(0, 0, smaller.width, smaller.height);
      smallContext.drawImage(image, 0, 0, smaller.width, smaller.height);
      result = smaller.toDataURL('image/webp', Math.max(0.5, quality - 0.08));
      if (!result.startsWith('data:image/webp')) result = smaller.toDataURL('image/jpeg', Math.max(0.5, quality - 0.04));
    }
    return result;
  }


  /* ---------------------------------------------------------
     Event handling
     --------------------------------------------------------- */

  function onDocumentClick(event) {
    const dateInput = event.target.closest('[data-date-picker]');
    if (dateInput && !dateInput.disabled) {
      event.preventDefault();
      openDatePicker(dateInput);
      return;
    }
    const actionElement = event.target.closest('[data-action]');
    if (actionElement) {
      const action = actionElement.dataset.action;
      const id = actionElement.dataset.id;
      if (action === 'add-game') {
        event.preventDefault();
        openGameForm();
      } else if (action === 'open-game') {
        event.preventDefault();
        if (id) openGame(id);
      } else if (action === 'open-settings') {
        event.preventDefault();
        openSettings();
      } else if (action === 'close-drawer') {
        event.preventDefault();
        closeDrawer();
      } else if (action === 'edit-game') {
        event.preventDefault();
        openGameForm(id);
      } else if (action === 'delete-game') {
        event.preventDefault();
        deleteGame(id);
      } else if (action === 'add-play') {
        event.preventDefault();
        openPlayModal(id);
      } else if (action === 'manage-photos') {
        event.preventDefault();
        if (id) openPhotoManager(id);
      } else if (action === 'recognize-photos') {
        event.preventDefault();
        if (id) recognizeSavedPhotos(id);
      } else if (action === 'photo-view') {
        event.preventDefault();
        if (id) openPhotoViewer(id, Number(actionElement.dataset.index || 0));
      } else if (action === 'open-market') {
        event.preventDefault();
        openMarketModal(id);
      } else if (action === 'open-sale') {
        event.preventDefault();
        openSellModal(id);
      } else if (action === 'cancel-sale') {
        event.preventDefault();
        cancelSale(id);
      } else if (action === 'open-loan') {
        event.preventDefault();
        openLoanModal(id);
      } else if (action === 'return-loan') {
        event.preventDefault();
        openReturnDialog(id);
      } else if (action === 'toggle-view') {
        event.preventDefault();
        state.preferences.view = actionElement.dataset.view === 'list' ? 'list' : 'grid';
        scheduleSave(80);
        paintLibrary();
      } else if (action === 'clear-query') {
        event.preventDefault();
        filters.q = '';
        const search = $('#librarySearch');
        if (search) search.value = '';
        paintLibrary();
      } else if (action === 'clear-filters') {
        event.preventDefault();
        filters.q = '';
        filters.status = 'all';
        filters.region = 'all';
        filters.platform = 'all';
        filters.cartridge = 'all';
        filters.tag = 'all';
        rerender({ keepScroll: true });
      } else if (action === 'remove-filter') {
        event.preventDefault();
        const filter = actionElement.dataset.filter;
        if (filter === 'q') {
          filters.q = '';
          const search = $('#librarySearch');
          if (search) search.value = '';
        } else if (filter === 'status') filters.status = 'all';
        else if (filter === 'region') filters.region = 'all';
        else if (filter === 'platform') filters.platform = 'all';
        else if (filter === 'cartridge') filters.cartridge = 'all';
        else if (filter === 'tag') filters.tag = 'all';
        paintLibrary();
      } else if (action === 'export-json') {
        event.preventDefault();
        exportJSON();
      } else if (action === 'export-csv') {
        event.preventDefault();
        exportCSV();
      } else if (action === 'open-import') {
        event.preventDefault();
        const input = $('#importFile');
        if (input) input.click();
      } else if (action === 'load-demo') {
        event.preventDefault();
        loadDemoData();
      } else if (action === 'reset-all') {
        event.preventDefault();
        resetAllData();
      } else if (action === 'install-app') {
        event.preventDefault();
        installApp();
      } else if (action === 'nintendo-guide') {
        event.preventDefault();
        openNintendoGuide();
      } else if (action === 'nintendo-add') {
        event.preventDefault();
        nintendoAddAccount();
      } else if (action === 'nintendo-sync') {
        event.preventDefault();
        if (id) nintendoSyncOne(id);
      } else if (action === 'nintendo-sync-all') {
        event.preventDefault();
        nintendoSyncAll();
      } else if (action === 'nintendo-remove') {
        event.preventDefault();
        if (id) nintendoRemoveAccount(id);
      } else if (action === 'lan-discover') {
        event.preventDefault();
        lanDiscover();
      } else if (action === 'lan-select') {
        event.preventDefault();
        const index = Number(actionElement.dataset.index);
        if (Number.isInteger(index) && index >= 0 && index < lanServers.length) {
          lanSelected = index;
          const box = $('#lanServers');
          if (box) box.innerHTML = lanServerListHTML();
          lanCheckUpdate();
          setTimeout(() => { if (!lanSyncBusy) lanOpenSync(); }, 80);
        }
      } else if (action === 'lan-upload') {
        event.preventDefault();
        lanUpload();
      } else if (action === 'lan-download') {
        event.preventDefault();
        lanDownload();
      } else if (action === 'lan-update') {
        event.preventDefault();
        lanOpenUpdate();
      } else if (action === 'lan-open-sync') {
        event.preventDefault();
        lanOpenSync(actionElement.dataset.direction || '');
      } else if (action === 'server-refresh') {
        event.preventDefault();
        refreshServerState(true);
      }
      return;
    }

    const statusFilter = event.target.closest('[data-filter-status]');
    if (statusFilter && $('#libraryGrid')) {
      event.preventDefault();
      const value = statusFilter.dataset.filterStatus;
      filters.status = ['all', 'owned', 'lent', 'overdue', 'sold'].includes(value) ? value : 'all';
      paintLibrary();
    }
  }

  function onDocumentInput(event) {
    if (event.target && event.target.id === 'librarySearch') {
      filters.q = event.target.value;
      paintLibrary();
    }
  }

  function onDocumentSearch(event) {
    if (event.target && event.target.id === 'librarySearch') {
      filters.q = event.target.value;
      paintLibrary();
    }
  }

  function onDocumentSubmit(event) {
    const form = event.target;
    if (!form || form.id !== 'librarySearchForm') return;
    event.preventDefault();
    const input = $('#librarySearch');
    filters.q = input ? input.value : filters.q;
    paintLibrary();
    if (input) input.blur();
  }

  function onDocumentChange(event) {
    const target = event.target;
    if (!target) return;
    if (target.id === 'regionFilter') {
      filters.region = target.value;
      paintLibrary();
    } else if (target.id === 'platformFilter') {
      filters.platform = target.value;
      paintLibrary();
    } else if (target.id === 'cartridgeFilter') {
      filters.cartridge = target.value;
      paintLibrary();
    } else if (target.id === 'tagFilter') {
      filters.tag = target.value;
      paintLibrary();
    } else if (target.id === 'sortSelect') {
      filters.sort = target.value;
      state.preferences.sort = filters.sort;
      scheduleSave(80);
      paintLibrary();
    } else if (target.id === 'librarySearch') {
      filters.q = target.value;
      paintLibrary();
    }
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function onDocumentKeydown(event) {
    if (event.key === 'Enter' && event.target && event.target.id === 'librarySearch') {
      if (event.isComposing) return;
      event.preventDefault();
      const form = event.target.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        filters.q = event.target.value;
        paintLibrary();
        event.target.blur();
      }
      return;
    }

    if (event.key === 'Escape') {
      if (closeTopModal()) {
        event.preventDefault();
        return;
      }
      if (drawerOpen) {
        closeDrawer();
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Tab' && modalStack.length) {
      const top = modalStack.filter((item) => !item.closed).slice(-1)[0];
      if (!top) return;
      const focusable = $$('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', top.layer)
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (isTypingTarget(event.target) || modalStack.length) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === '/') {
      event.preventDefault();
      if (currentRoute !== 'library') {
        window.location.hash = '#/library';
        setTimeout(() => { const input = $('#librarySearch'); if (input) input.focus(); }, 80);
      } else {
        const input = $('#librarySearch');
        if (input) input.focus();
      }
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openGameForm();
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-action="open-game"]')) {
      event.preventDefault();
      event.target.closest('[data-action="open-game"]').click();
    }
  }

  function onImageError(event) {
    const image = event.target;
    if (image && image.tagName === 'IMG' && image.classList.contains('cover-img')) {
      image.style.display = 'none';
      if (image.parentElement) image.parentElement.classList.remove('has-img');
    }
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('input', onDocumentInput);
    document.addEventListener('change', onDocumentChange);
    document.addEventListener('submit', onDocumentSubmit);
    document.addEventListener('search', onDocumentSearch);
    document.addEventListener('keydown', onDocumentKeydown);
    document.addEventListener('error', onImageError, true);
    window.addEventListener('hashchange', () => handleRoute(false));
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      toast('卡匣已安装到桌面。', 'success');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && saveTimer) saveNow();
    });
    window.addEventListener('pagehide', () => {
      if (saveTimer) saveNow();
    });
  }

  async function initNativeShell() {
    if (!isNativeApp()) return;
    document.documentElement.classList.add('native-app');
    const statusBar = nativePlugin('StatusBar');
    const app = nativePlugin('App');
    if (statusBar) {
      try {
        if (typeof statusBar.setOverlaysWebView === 'function') {
          await statusBar.setOverlaysWebView({ overlay: false });
        }
        await statusBar.setBackgroundColor({ color: '#f4f0e7' });
        await statusBar.setStyle({ style: 'LIGHT' });
      } catch (error) { /* status bar is optional */ }
    }
    if (app && typeof app.addListener === 'function') {
      app.addListener('backButton', () => {
        if (modalStack.some((item) => !item.closed)) {
          closeTopModal();
          return;
        }
        if (drawerOpen) {
          closeDrawer();
          return;
        }
        if (currentRoute !== 'home') {
          window.location.hash = '#/home';
          return;
        }
        app.exitApp();
      });
    }
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */

  async function init() {
    bindEvents();
    serverMode = await detectServerMode();
    if (serverMode) {
      try {
        state = await loadServerState();
        storageMode = 'server';
      } catch (error) {
        serverMode = false;
        state = await loadState();
      }
    } else {
      try {
        state = await loadState();
      } catch (error) {
        state = blankState();
        storageMode = 'local';
      }
    }
    filters.sort = state.preferences.sort || 'recent';
    if (!window.location.hash) history.replaceState(null, '', '#/home');

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1' && state.games.length === 0) {
      state.games = demoGames();
      await saveNow();
      const url = new URL(window.location.href);
      url.searchParams.delete('demo');
      history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || '#/home'));
      setTimeout(() => toast('已载入 10 张示例卡带，随便看看。', 'info'), 500);
    }

    await initNativeShell();
    startLanAutoSync();
    handleRoute(true);
    markSaved();
    if (serverMode) {
      setInterval(() => { if (document.visibilityState === 'visible') refreshServerState(false); }, 15000);
    }
    registerServiceWorker();
  }

  init();




})();
