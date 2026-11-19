// =====================================================================
// LOGIKA UTAMA APLIKASI INFAQMU (app.js) - CHECKPOINT 1 STABLE
// =====================================================================

let supabaseClient = null;
let isCloudConnected = false;
let sbCredentials = { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_KEY };

let appSettings = {
    orgName: 'InfaqMU Peduli',
    orgHandle: 'prm.bandarmalela',
    orgBio: 'Laporan Transparansi Penerimaan & Penyaluran Infaq Sedekah • Terverifikasi Bendahara',
    viewerPin: '112233',
    adminPin: '999999'
};

let transactions = [];
let waReportsStore = {};
let likedTxIds = new Set();
let currentRole = null;
let selectedGateRole = 'viewer';
let currentMainView = 'feed';
let feedLayoutMode = 'feed';
let monthlyChartInstance = null;
let pendingDeleteId = null;
let isWaFormEditable = false;
let waEditSnapshot = null;
let currentStorySlide = 0;

let waFormState = {
    month: '10',
    year: '2026',
    incomes: [{ name: 'Kaleng Infaqmu', breakdown: '686.500 + 807.500 + 612.500' }],
    prevLabel: 'Sisa saldo bulan September',
    prevAmount: 12500,
    expenseGroupTitle: 'Belanja sembako',
    expenses: [
        { name: 'Beras Horas', qty: 19, unit: 'sak', price: 74000 },
        { name: 'Minyakita', qty: 19, unit: 'bks', price: 16500 },
        { name: 'Telur', qty: 190, unit: 'butir', price: 1650 }
    ]
};

// --- INISIALISASI INSTAN ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        loadLocalFallbackData();
        deduplicateMonthlyLedgerRecords();
        initSupabaseCredentials();
        setupPinInputListeners();
        applySettingsToUI();

        const firstPinBox = document.querySelector('.pin-box');
        if (firstPinBox) firstPinBox.focus();

        // Sinkronisasi latar belakang non-blocking (timeout 4 detik)
        setTimeout(() => {
            syncInitialData(false).catch(() => {});
        }, 150);
    } catch (err) {
        console.error('Init error:', err);
    }
});

// --- UTILITAS FORMATTER & PARSER INDONESIA ---
function formatIndoDots(num) {
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Math.round(Number(num) || 0));
}

function parseIndoNumber(val) {
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9-]/g, '');
    return Number(cleaned) || 0;
}

function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Math.round(Number(number) || 0));
}

function formatShortRupiah(number) {
    const abs = Math.abs(number);
    const sign = number < 0 ? '-' : '';
    if (abs >= 1000000) {
        const jt = (abs / 1000000).toFixed(1).replace(/\.0$/, '').replace('.', ',');
        return `${sign}Rp${jt}Jt`;
    }
    if (abs >= 1000) {
        return `${sign}Rp${Math.round(abs / 1000)}Rb`;
    }
    return `${sign}Rp${abs}`;
}

function formatDateIndo(dateStr) {
    if (!dateStr) return '-';
    const [y, m, d] = dateStr.split('-');
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${parseInt(d, 10)} ${monthShort[parseInt(m, 10) - 1]} ${y}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatMoneyInputOnBlur(inputEl) {
    const num = parseIndoNumber(inputEl.value);
    inputEl.value = formatIndoDots(num);
    updateWaLivePreview();
}

// --- KONEKSI SUPABASE (SDK + POSTGREST NATIVE FETCH DENGAN TIMEOUT) ---
function isJwtFormat(token) {
    return typeof token === 'string' && token.split('.').length === 3 && token.startsWith('eyJ');
}

function initSupabaseCredentials() {
    let savedCreds = null;
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.SB_CONFIG);
        if (raw) savedCreds = JSON.parse(raw);
    } catch (e) {}

    const url = (savedCreds && savedCreds.url) ? savedCreds.url.trim() : DEFAULT_SUPABASE_URL.trim();
    const key = (savedCreds && savedCreds.key) ? savedCreds.key.trim() : DEFAULT_SUPABASE_KEY.trim();
    sbCredentials = { url: url.replace(/\/+$/, ''), key };

    if (sbCredentials.url && sbCredentials.key && window.supabase && isJwtFormat(sbCredentials.key)) {
        try {
            supabaseClient = window.supabase.createClient(sbCredentials.url, sbCredentials.key);
        } catch (e) {
            supabaseClient = null;
        }
    } else {
        supabaseClient = null;
    }
}

async function supabaseRestFetch(path, options = {}) {
    if (!sbCredentials.url || !sbCredentials.key) throw new Error('Kredensial Supabase kosong');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const headers = {
        'apikey': sbCredentials.key,
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (isJwtFormat(sbCredentials.key)) {
        headers['Authorization'] = `Bearer ${sbCredentials.key}`;
    }

    try {
        const res = await fetch(`${sbCredentials.url}/rest/v1/${path}`, {
            method: options.method || 'GET',
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

async function syncInitialData(showNotification = false) {
    updateSyncStatusUI('syncing');
    try {
        const settingsRows = await supabaseRestFetch('infaq_settings?id=eq.1&select=*');
        if (Array.isArray(settingsRows) && settingsRows.length > 0) {
            const s = settingsRows[0];
            appSettings = {
                orgName: s.org_name || appSettings.orgName,
                orgHandle: (s.org_handle || appSettings.orgHandle).replace(/^@/, ''),
                orgBio: s.org_bio || appSettings.orgBio,
                viewerPin: String(s.visitor_pin || appSettings.viewerPin),
                adminPin: String(s.admin_pin || appSettings.adminPin)
            };
        }

        const txRows = await supabaseRestFetch('infaq_transactions?select=*&order=tx_date.desc,id.desc');
        if (Array.isArray(txRows) && txRows.length > 0) {
            const cloudMapped = txRows.map(r => ({
                id: r.id,
                type: r.type,
                category: r.category,
                title: r.title,
                description: r.description || '',
                amount: Number(r.amount) || 0,
                tx_date: r.tx_date,
                theme: r.theme || 'emerald',
                aamiin_count: Number(r.aamiin_count) || 0
            }));
            const localOnly = transactions.filter(t => String(t.id).startsWith('local-'));
            transactions = [...cloudMapped, ...localOnly];
            deduplicateMonthlyLedgerRecords();
        }

        isCloudConnected = true;
        saveLocalCache();
        applySettingsToUI();
        updateSyncStatusUI('cloud');
        updateDiagnosticBox('Terhubung ke Supabase Cloud.');

        if (currentRole) {
            populateYearFilter();
            refreshDashboard();
        }
        if (showNotification) showToast('Berhasil sinkronisasi dengan Supabase Cloud!', 'success');
        return true;
    } catch (err) {
        isCloudConnected = false;
        updateSyncStatusUI('local');
        updateDiagnosticBox(`Mode Lokal Aktif (${err.name === 'AbortError' ? 'Timeout jaringan' : err.message}).`);
        if (showNotification) showToast('Berjalan dalam Mode Lokal (Cloud tidak terjangkau).', 'info');
        return false;
    }
}

function updateSyncStatusUI(state) {
    const gateBadge = document.getElementById('gate-sync-badge');
    const headerPill = document.getElementById('connection-status-pill');

    if (state === 'syncing') {
        if (gateBadge) gateBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span><span>Menyinkronkan...</span>';
        if (headerPill) headerPill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span><span>Sinkron</span>';
    } else if (state === 'cloud') {
        if (gateBadge) gateBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Cloud Terhubung</span>';
        if (headerPill) headerPill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>Cloud</span>';
    } else {
        if (gateBadge) gateBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span><span>Mode Lokal</span>';
        if (headerPill) headerPill.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Lokal</span>';
    }
}

function updateDiagnosticBox(msg) {
    const el = document.getElementById('sb-diagnostic-box');
    if (el) el.textContent = msg;
}

// --- PENYIMPANAN LOKAL & DEDUPLIKASI ---
function loadLocalFallbackData() {
    try {
        const s = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (s) appSettings = { ...appSettings, ...JSON.parse(s) };

        const t = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
        transactions = t ? JSON.parse(t) : getDefaultDummyData();

        const w = localStorage.getItem(STORAGE_KEYS.WA_REPORTS);
        waReportsStore = w ? JSON.parse(w) : getDefaultWaReports();

        const l = localStorage.getItem(STORAGE_KEYS.LIKED_IDS);
        if (l) likedTxIds = new Set(JSON.parse(l));
    } catch (e) {
        transactions = getDefaultDummyData();
        waReportsStore = getDefaultWaReports();
    }
}

function saveLocalCache() {
    try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(appSettings));
        localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
        localStorage.setItem(STORAGE_KEYS.WA_REPORTS, JSON.stringify(waReportsStore));
    } catch (e) {}
}

function deduplicateMonthlyLedgerRecords() {
    const seenMonthlyKey = new Set();
    const cleaned = [];
    const sorted = [...transactions].sort((a, b) => String(b.id).localeCompare(String(a.id)));

    for (const tx of sorted) {
        if ((tx.type === 'in' || tx.type === 'out') && tx.tx_date) {
            const ym = tx.tx_date.substring(0, 7);
            const titleNorm = (tx.title || '').toLowerCase();
            if (titleNorm.includes('penerimaan infaq bulan') || titleNorm.includes('belanja sembako') || titleNorm.includes('kaleng infaqmu')) {
                const key = `${ym}-${tx.type}`;
                if (seenMonthlyKey.has(key)) continue;
                seenMonthlyKey.add(key);
            }
        }
        cleaned.push(tx);
    }
    transactions = cleaned;
}

// --- PERHITUNGAN SALDO KAS AKURAT (ANTI DOUBLE-COUNTING) ---
function extractCarryOverAndPureIncome(tx) {
    const amount = Number(tx.amount) || 0;
    if (tx.type !== 'in') return { pureIn: 0, carryOver: 0 };

    const desc = tx.description || '';
    const carryMatch = desc.match(/sisa\s+saldo[^=]*=\s*(?:rp\.?\s*)?([0-9.]+)/i);
    if (carryMatch) {
        const carryVal = parseIndoNumber(carryMatch[1]);
        if (carryVal > 0 && carryVal <= amount) {
            return { pureIn: amount - carryVal, carryOver: carryVal };
        }
    }
    return { pureIn: amount, carryOver: 0 };
}

function computeAccurateCashLedger() {
    const financialTx = transactions
        .filter(t => t.type === 'in' || t.type === 'out')
        .sort((a, b) => new Date(a.tx_date) - new Date(b.tx_date));

    let totalPureIn = 0;
    let totalOut = 0;
    let initialCarryOver = 0;
    let hasRecordedInitialCarry = false;

    financialTx.forEach(tx => {
        if (tx.type === 'in') {
            const { pureIn, carryOver } = extractCarryOverAndPureIncome(tx);
            if (!hasRecordedInitialCarry && carryOver > 0) {
                initialCarryOver = carryOver;
                hasRecordedInitialCarry = true;
            }
            totalPureIn += pureIn;
        } else if (tx.type === 'out') {
            totalOut += Number(tx.amount) || 0;
        }
    });

    const overallBalance = initialCarryOver + totalPureIn - totalOut;
    return { initialCarryOver, totalPureIn, totalOut, overallBalance };
}

// --- GERBANG PIN 6 DIGIT ---
function applySettingsToUI() {
    const cleanHandle = appSettings.orgHandle.replace(/^@/, '');
    document.getElementById('gate-org-name').textContent = appSettings.orgName;
    document.getElementById('gate-org-handle').textContent = `@${cleanHandle} • Berita & Transparansi`;
    document.getElementById('header-org-name').textContent = appSettings.orgName;
    document.getElementById('header-org-handle').textContent = cleanHandle;
    document.getElementById('header-org-bio').textContent = appSettings.orgBio;
    document.getElementById('hint-viewer-pin').textContent = appSettings.viewerPin;
    document.getElementById('hint-admin-pin').textContent = appSettings.adminPin;
}

function switchGateRole(role) {
    selectedGateRole = role;
    const tabViewer = document.getElementById('tab-role-viewer');
    const tabAdmin = document.getElementById('tab-role-admin');
    const promptLabel = document.getElementById('pin-prompt-label');
    const btnUnlock = document.getElementById('btn-unlock');

    if (role === 'viewer') {
        tabViewer.className = 'flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all bg-white text-emerald-800 shadow-sm';
        tabAdmin.className = 'flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-500 hover:text-slate-900';
        promptLabel.textContent = 'Masukkan Kode PIN 6 Digit dari Admin';
        btnUnlock.className = 'w-full py-3.5 px-5 rounded-2xl bg-slate-900 hover:bg-emerald-800 text-white font-bold text-sm shadow-lg transition-all';
        btnUnlock.innerHTML = '<span>Buka Berita & Transparansi</span>';
    } else {
        tabAdmin.className = 'flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold transition-all bg-white text-amber-800 shadow-sm';
        tabViewer.className = 'flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all text-slate-500 hover:text-slate-900';
        promptLabel.textContent = 'Masukkan PIN 6 Digit Khusus Panitia / Admin';
        btnUnlock.className = 'w-full py-3.5 px-5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-sm shadow-lg transition-all';
        btnUnlock.innerHTML = '<span>Masuk sebagai Admin</span>';
    }
    clearPinInputs();
}

function pressKeypad(digit) {
    const boxes = document.querySelectorAll('.pin-box');
    document.getElementById('pin-error-msg').classList.add('hidden');
    for (let i = 0; i < boxes.length; i++) {
        if (!boxes[i].value) {
            boxes[i].value = digit;
            if (i < boxes.length - 1) boxes[i + 1].focus();
            else {
                const fullPin = Array.from(boxes).map(b => b.value).join('');
                if (fullPin.length === 6) verifyAndUnlock(fullPin);
            }
            break;
        }
    }
}

function backspaceKeypad() {
    const boxes = document.querySelectorAll('.pin-box');
    for (let i = boxes.length - 1; i >= 0; i--) {
        if (boxes[i].value) {
            boxes[i].value = '';
            boxes[i].focus();
            break;
        }
    }
}

function setupPinInputListeners() {
    const boxes = document.querySelectorAll('.pin-box');
    boxes.forEach((box, idx) => {
        box.addEventListener('input', (e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = val;
            if (val && idx < boxes.length - 1) boxes[idx + 1].focus();
            if (idx === boxes.length - 1 && val) {
                const fullPin = Array.from(boxes).map(b => b.value).join('');
                if (fullPin.length === 6) verifyAndUnlock(fullPin);
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && idx > 0) boxes[idx - 1].focus();
        });
    });
}

function clearPinInputs() {
    document.querySelectorAll('.pin-box').forEach(b => b.value = '');
    document.getElementById('pin-error-msg').classList.add('hidden');
}

function togglePinVisibility() {
    const show = document.getElementById('toggle-show-pin').checked;
    document.querySelectorAll('.pin-box').forEach(b => b.type = show ? 'text' : 'password');
}

function autoFillDemoPin(role) {
    switchGateRole(role);
    const pin = role === 'admin' ? appSettings.adminPin : appSettings.viewerPin;
    const boxes = document.querySelectorAll('.pin-box');
    pin.split('').forEach((d, i) => { if (boxes[i]) boxes[i].value = d; });
    verifyAndUnlock(pin);
}

function handlePinSubmit(e) {
    e.preventDefault();
    const enteredPin = Array.from(document.querySelectorAll('.pin-box')).map(b => b.value).join('');
    verifyAndUnlock(enteredPin);
}

function verifyAndUnlock(enteredPin) {
    const errorEl = document.getElementById('pin-error-msg');
    if (enteredPin.length !== 6) {
        errorEl.textContent = 'Harap lengkapi 6 digit angka PIN.';
        errorEl.classList.remove('hidden');
        return;
    }

    if (enteredPin === appSettings.adminPin) {
        grantAccess('admin');
    } else if (enteredPin === appSettings.viewerPin) {
        grantAccess('viewer');
    } else {
        errorEl.textContent = 'Kode PIN 6 digit salah. Silakan coba lagi.';
        errorEl.classList.remove('hidden');
        clearPinInputs();
    }
}

function grantAccess(role) {
    currentRole = role;
    document.getElementById('access-gate').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');

    const isAdmin = role === 'admin';
    document.getElementById('role-badge').textContent = isAdmin ? 'Admin' : 'Publik';
    document.getElementById('role-badge-mobile').textContent = isAdmin ? 'Admin' : 'Publik';
    document.getElementById('btn-open-security').classList.toggle('hidden', !isAdmin);
    document.getElementById('fab-create-post').classList.toggle('hidden', !isAdmin);
    document.getElementById('fab-create-post').classList.toggle('flex', isAdmin);
    document.getElementById('nav-btn-wa').classList.toggle('hidden', !isAdmin);
    document.getElementById('nav-btn-wa').classList.toggle('flex', isAdmin);
    document.getElementById('story-highlight-wa').classList.toggle('hidden', !isAdmin);
    document.getElementById('story-highlight-wa').classList.toggle('flex', isAdmin);

    const btnSecondary = document.getElementById('btn-profile-secondary');
    if (isAdmin) {
        btnSecondary.textContent = 'Rekap Laporan WA';
        btnSecondary.onclick = () => switchMainView('wa');
    } else {
        btnSecondary.textContent = 'Grafik Transparansi';
        btnSecondary.onclick = () => switchMainView('stats');
    }

    populateYearFilter();
    document.getElementById('filter-month').value = 'all';
    loadWaReportForPeriod('2026', '10');
    switchMainView('feed');
    showToast(isAdmin ? 'Selamat datang, Admin!' : 'Selamat datang di Portal Transparansi INFAQMU.', 'success');
}

function lockApplication() {
    currentRole = null;
    clearPinInputs();
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('access-gate').classList.remove('hidden');
}

// --- NAVIGASI & BERANDA ALA INSTAGRAM ---
function populateYearFilter() {
    const select = document.getElementById('filter-year');
    const years = new Set(['2026', '2025']);
    transactions.forEach(t => { if (t.tx_date) years.add(t.tx_date.substring(0, 4)); });
    const sorted = Array.from(years).sort((a, b) => b - a);
    select.innerHTML = sorted.map(y => `<option value="${y}">${y}</option>`).join('');
}

function toggleSearchBar() {
    const el = document.getElementById('search-bar-wrapper');
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) document.getElementById('search-input').focus();
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('search-bar-wrapper').classList.add('hidden');
    refreshDashboard();
}

function switchMainView(view) {
    if (view === 'wa' && currentRole !== 'admin') {
        showToast('Menu Rekap WA khusus untuk Panitia / Admin.', 'error');
        return;
    }
    currentMainView = view;

    const activeCls = 'flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/15 text-emerald-400 font-bold text-xs transition-all';
    const inactiveCls = 'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-slate-400 hover:text-white font-semibold text-xs transition-all';

    document.getElementById('nav-btn-feed').className = view === 'feed' ? activeCls : inactiveCls;
    document.getElementById('nav-btn-stats').className = view === 'stats' ? activeCls : inactiveCls;
    if (currentRole === 'admin') {
        document.getElementById('nav-btn-wa').className = view === 'wa' ? activeCls : inactiveCls;
    }

    document.getElementById('feed-mode-tabs').classList.toggle('hidden', view !== 'feed');
    refreshDashboard();
}

function setFeedLayoutMode(mode) {
    feedLayoutMode = mode;
    document.getElementById('tab-subview-feed').className = mode === 'feed'
        ? 'py-2.5 flex items-center justify-center gap-1.5 border-b-2 border-slate-900 text-slate-900 font-bold text-xs'
        : 'py-2.5 flex items-center justify-center gap-1.5 border-b-2 border-transparent text-slate-400 font-semibold text-xs';
    document.getElementById('tab-subview-grid').className = mode === 'grid'
        ? 'py-2.5 flex items-center justify-center gap-1.5 border-b-2 border-slate-900 text-slate-900 font-bold text-xs'
        : 'py-2.5 flex items-center justify-center gap-1.5 border-b-2 border-transparent text-slate-400 font-semibold text-xs';
    refreshDashboard();
}

function refreshDashboard() {
    const selectedMonth = document.getElementById('filter-month').value;
    const selectedYear = document.getElementById('filter-year').value;
    const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();

    const ledger = computeAccurateCashLedger();

    // Update Metrik Profil & Story Highlights
    const newsPostsAll = transactions.filter(t => t.type === 'news');
    document.getElementById('profile-stat-posts').textContent = newsPostsAll.length;
    document.getElementById('profile-stat-balance').textContent = formatShortRupiah(ledger.overallBalance);
    document.getElementById('profile-stat-out').textContent = formatShortRupiah(ledger.totalOut);

    document.getElementById('story-balance-short').textContent = formatShortRupiah(ledger.overallBalance);
    document.getElementById('story-in-short').textContent = formatShortRupiah(ledger.totalPureIn);
    document.getElementById('story-out-short').textContent = formatShortRupiah(ledger.totalOut);
    const totalAvailable = ledger.initialCarryOver + ledger.totalPureIn;
    const ratio = totalAvailable > 0 ? Math.round((ledger.totalOut / totalAvailable) * 100) : 0;
    document.getElementById('story-ratio-short').textContent = `${ratio}%`;

    const periodLabel = selectedMonth === 'all'
        ? `Tahun ${selectedYear}`
        : `${MONTH_NAMES[parseInt(selectedMonth, 10) - 1]} ${selectedYear}`;
    document.getElementById('active-period-badge').textContent = periodLabel;

    document.getElementById('feed-view').classList.add('hidden');
    document.getElementById('grid-view').classList.add('hidden');
    document.getElementById('wa-view').classList.add('hidden');
    document.getElementById('stats-view').classList.add('hidden');
    document.getElementById('empty-state').classList.add('hidden');

    if (currentMainView === 'wa') {
        document.getElementById('wa-view').classList.remove('hidden');
        renderPublishedMonthsBar();
        updateWaLivePreview();
        return;
    }

    if (currentMainView === 'stats') {
        document.getElementById('stats-view').classList.remove('hidden');
        renderStatsView(selectedYear, selectedMonth, periodLabel, ledger);
        return;
    }

    // Filter khusus Postingan Berita & Kegiatan
    const filteredNews = newsPostsAll
        .filter(tx => {
            if (!tx.tx_date) return false;
            const matchYear = tx.tx_date.startsWith(selectedYear);
            const matchMonth = selectedMonth === 'all' || tx.tx_date.substring(5, 7) === selectedMonth;
            return matchYear && matchMonth;
        })
        .filter(tx => {
            if (!searchQuery) return true;
            return (tx.title || '').toLowerCase().includes(searchQuery) ||
                   (tx.description || '').toLowerCase().includes(searchQuery) ||
                   (tx.category || '').toLowerCase().includes(searchQuery);
        })
        .sort((a, b) => new Date(b.tx_date) - new Date(a.tx_date));

    if (filteredNews.length === 0) {
        document.getElementById('empty-state').classList.remove('hidden');
        return;
    }

    if (feedLayoutMode === 'grid') {
        document.getElementById('grid-view').classList.remove('hidden');
        renderInstagramGrid(filteredNews);
    } else {
        document.getElementById('feed-view').classList.remove('hidden');
        renderInstagramFeed(filteredNews);
    }
}

function getThemeGradient(theme) {
    const map = {
        emerald: 'from-emerald-600 via-emerald-700 to-teal-900',
        blue: 'from-blue-600 via-indigo-700 to-slate-900',
        amber: 'from-amber-500 via-orange-600 to-amber-900',
        rose: 'from-rose-600 via-pink-700 to-rose-950',
        purple: 'from-purple-600 via-violet-700 to-indigo-950'
    };
    return map[theme] || map.emerald;
}

function renderInstagramFeed(list) {
    const container = document.getElementById('feed-view');
    const isAdmin = currentRole === 'admin';
    const handle = appSettings.orgHandle.replace(/^@/, '');

    container.innerHTML = list.map(tx => {
        const txKey = String(tx.id);
        const isLiked = likedTxIds.has(txKey);
        const grad = getThemeGradient(tx.theme);

        const adminActions = isAdmin ? `
            <div class="flex items-center gap-1">
                <button type="button" onclick="openNewsModal('${txKey}')" class="px-2 py-1 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-700">Edit</button>
                <button type="button" onclick="promptDeleteTransaction('${txKey}')" class="px-2 py-1 rounded-lg bg-rose-50 text-[11px] font-bold text-rose-600">Hapus</button>
            </div>
        ` : `<span class="text-[11px] text-slate-400">${formatDateIndo(tx.tx_date)}</span>`;

        return `
            <article class="bg-white py-4 px-4">
                <div class="flex items-center justify-between mb-2.5">
                    <div class="flex items-center gap-2.5">
                        <div class="w-9 h-9 rounded-full story-ring-ig">
                            <div class="w-full h-full rounded-full bg-slate-900 text-emerald-300 font-display font-extrabold text-[10px] flex items-center justify-center border border-white">MU</div>
                        </div>
                        <div>
                            <div class="text-xs font-bold text-slate-900">${escapeHtml(handle)}</div>
                            <div class="text-[11px] text-slate-500">${escapeHtml(tx.category)}</div>
                        </div>
                    </div>
                    ${adminActions}
                </div>

                <!-- Poster Visual Ala Instagram dengan Double-Tap Heart -->
                <div ondblclick="handleDoubleTapPoster('${txKey}', this)" class="rounded-2xl bg-gradient-to-br ${grad} p-6 text-white relative overflow-hidden select-none cursor-pointer shadow-sm">
                    <span class="inline-block px-2.5 py-1 rounded-full bg-white/20 text-[10px] font-extrabold uppercase tracking-wider mb-3">
                        ${escapeHtml(tx.category)}
                    </span>
                    <h3 class="font-display font-extrabold text-lg sm:text-xl leading-snug">
                        ${escapeHtml(tx.title)}
                    </h3>
                    <div class="mt-4 pt-3 border-t border-white/15 flex items-center justify-between text-[11px] text-white/85">
                        <span>Terverifikasi Lembaga</span>
                        <span>${formatDateIndo(tx.tx_date)}</span>
                    </div>
                    <div class="double-tap-overlay hidden absolute inset-0 flex items-center justify-center pointer-events-none">
                        <svg class="w-20 h-20 text-white drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    </div>
                </div>

                <!-- Baris Aksi Instagram -->
                <div class="flex items-center justify-between mt-3 mb-2">
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="toggleAamiin('${txKey}')" class="px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${isLiked ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-slate-100 text-slate-700'}">
                            ${isLiked ? '♥' : '♡'} Aamiin (${tx.aamiin_count || 0})
                        </button>
                        <button type="button" onclick="sharePostDetail('${txKey}')" class="px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                            Bagikan
                        </button>
                    </div>
                    <span class="text-[11px] font-semibold text-emerald-700">#InfaqmuPeduli</span>
                </div>

                <!-- Caption -->
                <div class="text-xs text-slate-800 leading-relaxed">
                    <span class="font-bold mr-1">${escapeHtml(handle)}</span>
                    <span>${escapeHtml(tx.description)}</span>
                </div>
            </article>
        `;
    }).join('');
}

function renderInstagramGrid(list) {
    const container = document.getElementById('grid-view');
    container.innerHTML = list.map(tx => {
        const grad = getThemeGradient(tx.theme);
        return `
            <button type="button" onclick="setFeedLayoutMode('feed')" class="aspect-square bg-gradient-to-br ${grad} p-2.5 text-left text-white flex flex-col justify-between overflow-hidden relative">
                <span class="text-[9px] font-bold uppercase bg-black/25 px-1.5 py-0.5 rounded w-fit">${escapeHtml(tx.category)}</span>
                <div class="font-display font-bold text-[11px] leading-tight line-clamp-3">${escapeHtml(tx.title)}</div>
            </button>
        `;
    }).join('');
}

function handleDoubleTapPoster(txId, el) {
    const overlay = el.querySelector('.double-tap-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('animate-double-tap-heart');
        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('animate-double-tap-heart');
        }, 750);
    }
    if (!likedTxIds.has(String(txId))) toggleAamiin(txId);
}

async function toggleAamiin(txId) {
    const idx = transactions.findIndex(t => String(t.id) === String(txId));
    if (idx === -1) return;

    const key = String(txId);
    const liked = likedTxIds.has(key);
    const nextCount = liked ? Math.max(0, (transactions[idx].aamiin_count || 0) - 1) : (transactions[idx].aamiin_count || 0) + 1;

    if (liked) likedTxIds.delete(key);
    else likedTxIds.add(key);

    transactions[idx].aamiin_count = nextCount;
    try { localStorage.setItem(STORAGE_KEYS.LIKED_IDS, JSON.stringify(Array.from(likedTxIds))); } catch (e) {}
    saveLocalCache();
    refreshDashboard();

    if (isCloudConnected && !key.startsWith('local-')) {
        supabaseRestFetch(`infaq_transactions?id=eq.${transactions[idx].id}`, {
            method: 'PATCH',
            body: { aamiin_count: nextCount }
        }).catch(() => {});
    }
}

function sharePostDetail(txId) {
    const tx = transactions.find(t => String(t.id) === String(txId));
    if (!tx) return;
    const text = `*${appSettings.orgName}*
_${tx.category} (${formatDateIndo(tx.tx_date)})_

*${tx.title}*
${tx.description}`;
    copyTextFallback(text, 'Berita berhasil disalin untuk dibagikan!');
}

// --- STORY VIEWER INTERAKTIF ---
function openStoryViewer(slideIdx = 0) {
    currentStorySlide = slideIdx;
    document.getElementById('story-viewer-modal').classList.remove('hidden');
    document.getElementById('story-viewer-modal').classList.add('flex');
    renderStorySlide();
}

function closeStoryViewer() {
    document.getElementById('story-viewer-modal').classList.add('hidden');
    document.getElementById('story-viewer-modal').classList.remove('flex');
}

function nextStorySlide() {
    if (currentStorySlide < 3) {
        currentStorySlide++;
        renderStorySlide();
    } else {
        closeStoryViewer();
    }
}

function prevStorySlide() {
    if (currentStorySlide > 0) {
        currentStorySlide--;
        renderStorySlide();
    }
}

function renderStorySlide() {
    for (let i = 0; i < 4; i++) {
        const bar = document.getElementById(`story-prog-${i}`);
        if (bar) bar.style.width = i <= currentStorySlide ? '100%' : '0%';
    }

    const ledger = computeAccurateCashLedger();
    const titleEl = document.getElementById('story-viewer-title');
    const subEl = document.getElementById('story-viewer-subtitle');
    const bodyEl = document.getElementById('story-viewer-body');

    if (currentStorySlide === 0) {
        titleEl.textContent = 'Saldo Kas Tersedia';
        subEl.textContent = 'Perhitungan Anti-Ganda';
        bodyEl.innerHTML = `
            <div class="text-center space-y-3">
                <div class="text-xs uppercase tracking-wider text-emerald-300 font-bold">Total Saldo Kas Aktif</div>
                <div class="font-display font-extrabold text-3xl text-white">${formatRupiah(ledger.overallBalance)}</div>
                <div class="p-3.5 rounded-2xl bg-white/10 text-left text-xs space-y-1.5">
                    <div class="flex justify-between"><span>Saldo Awal Pindahan:</span><span class="font-bold">${formatRupiah(ledger.initialCarryOver)}</span></div>
                    <div class="flex justify-between"><span>Penerimaan Baru Murni:</span><span class="font-bold text-emerald-300">+ ${formatRupiah(ledger.totalPureIn)}</span></div>
                    <div class="flex justify-between"><span>Total Penyaluran:</span><span class="font-bold text-amber-300">- ${formatRupiah(ledger.totalOut)}</span></div>
                </div>
            </div>
        `;
    } else if (currentStorySlide === 1) {
        titleEl.textContent = 'Penerimaan Dana';
        subEl.textContent = 'Akumulasi Donasi Masuk';
        bodyEl.innerHTML = `
            <div class="text-center space-y-3">
                <div class="text-xs uppercase tracking-wider text-sky-300 font-bold">Penerimaan Baru Murni</div>
                <div class="font-display font-extrabold text-3xl text-white">${formatRupiah(ledger.totalPureIn)}</div>
                <p class="text-xs text-slate-300 leading-relaxed">Seluruh pemasukan kotak infaq dan donatur dicatat secara transparan tanpa menghitung ulang sisa saldo bulan sebelumnya.</p>
            </div>
        `;
    } else if (currentStorySlide === 2) {
        titleEl.textContent = 'Dana Tersalurkan';
        subEl.textContent = 'Realisasi Program Umat';
        bodyEl.innerHTML = `
            <div class="text-center space-y-3">
                <div class="text-xs uppercase tracking-wider text-amber-300 font-bold">Total Tersalurkan</div>
                <div class="font-display font-extrabold text-3xl text-white">${formatRupiah(ledger.totalOut)}</div>
                <p class="text-xs text-slate-300 leading-relaxed">Disalurkan untuk belanja sembako dhuafa, santunan yatim, dan program sosial kemasyarakatan.</p>
            </div>
        `;
    } else {
        titleEl.textContent = 'Indeks Penyaluran Amanah';
        subEl.textContent = 'Efektivitas Distribusi';
        const totalAvail = ledger.initialCarryOver + ledger.totalPureIn;
        const pct = totalAvail > 0 ? Math.round((ledger.totalOut / totalAvail) * 100) : 0;
        bodyEl.innerHTML = `
            <div class="text-center space-y-3">
                <div class="font-display font-extrabold text-4xl text-emerald-400">${pct}%</div>
                <div class="text-xs font-bold text-white">Dana Umat Telah Diterima Manfaatnya</div>
                <p class="text-xs text-slate-300 leading-relaxed">Sisa kas sebesar ${formatRupiah(ledger.overallBalance)} disimpan sebagai cadangan penyaluran bulan berikutnya.</p>
            </div>
        `;
    }
}

// --- REKAP WA & FORM INPUT BULANAN (KHUSUS ADMIN) ---
function toggleWaFormEditMode(enableEdit) {
    if (currentRole !== 'admin') return;
    isWaFormEditable = enableEdit;

    const box = document.getElementById('wa-admin-editor-box');
    const statusBadge = document.getElementById('wa-lock-status-badge');
    const btnEdit = document.getElementById('btn-toggle-wa-edit');
    const btnCancel = document.getElementById('btn-cancel-wa-edit');
    const btnPublish = document.getElementById('btn-publish-wa-to-feed');

    if (enableEdit) {
        waEditSnapshot = JSON.parse(JSON.stringify(waFormState));
        box.classList.remove('wa-form-locked');
        statusBadge.innerHTML = '<span class="text-amber-700">Mode Edit Aktif</span>';
        btnEdit.classList.add('hidden');
        btnCancel.classList.remove('hidden');
        btnPublish.disabled = false;
    } else {
        box.classList.add('wa-form-locked');
        statusBadge.innerHTML = '<span>Terkunci (Mode Baca)</span>';
        btnEdit.classList.remove('hidden');
        btnCancel.classList.add('hidden');
        btnPublish.disabled = true;
    }

    document.getElementById('btn-add-wa-income').disabled = !enableEdit;
    document.getElementById('btn-add-wa-expense').disabled = !enableEdit;
    document.getElementById('wa-prev-label').disabled = !enableEdit;
    document.getElementById('wa-prev-amount').disabled = !enableEdit;
    document.getElementById('wa-expense-group-title').disabled = !enableEdit;

    renderWaIncomeRows();
    renderWaExpenseRows();
}

function cancelWaFormEdit() {
    if (waEditSnapshot) {
        waFormState = JSON.parse(JSON.stringify(waEditSnapshot));
        initWaEditorFromState();
    }
    toggleWaFormEditMode(false);
}

function renderPublishedMonthsBar() {
    const bar = document.getElementById('wa-published-months-bar');
    const keys = Object.keys(waReportsStore).sort().reverse();
    if (keys.length === 0) {
        bar.innerHTML = '';
        return;
    }
    bar.innerHTML = keys.map(k => {
        const [y, m] = k.split('-');
        const label = `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
        const active = waFormState.year === y && waFormState.month === m;
        return `
            <button type="button" onclick="loadWaReportForPeriod('${y}', '${m}')" class="px-3 py-1 rounded-full text-[11px] font-bold shrink-0 ${active ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'}">
                ${label}
            </button>
        `;
    }).join('');
}

function loadWaReportForPeriod(year, month) {
    const key = `${year}-${month}`;
    if (waReportsStore[key]) {
        waFormState = JSON.parse(JSON.stringify(waReportsStore[key]));
    } else {
        const prevIdx = parseInt(month, 10) - 2;
        const prevName = prevIdx >= 0 ? MONTH_NAMES[prevIdx] : 'Desember';
        const ledger = computeAccurateCashLedger();
        waFormState = {
            month,
            year,
            incomes: [{ name: 'Kaleng Infaqmu', breakdown: '0' }],
            prevLabel: `Sisa saldo bulan ${prevName}`,
            prevAmount: Math.max(0, ledger.overallBalance),
            expenseGroupTitle: 'Belanja sembako',
            expenses: [{ name: 'Beras', qty: 1, unit: 'sak', price: 0 }]
        };
    }
    initWaEditorFromState();
    toggleWaFormEditMode(false);
}

function onWaPeriodSelectChange() {
    const m = document.getElementById('wa-input-month').value;
    const y = document.getElementById('wa-input-year').value || '2026';
    loadWaReportForPeriod(y, m);
    renderPublishedMonthsBar();
}

function loadOctoberSampleTemplate() {
    waFormState = getDefaultWaReports()['2026-10'];
    initWaEditorFromState();
    toggleWaFormEditMode(false);
    showToast('Contoh laporan Oktober 2026 dimuat.', 'info');
}

function initWaEditorFromState() {
    document.getElementById('wa-input-month').value = waFormState.month;
    document.getElementById('wa-input-year').value = waFormState.year;
    document.getElementById('wa-prev-label').value = waFormState.prevLabel;
    document.getElementById('wa-prev-amount').value = formatIndoDots(waFormState.prevAmount);
    document.getElementById('wa-expense-group-title').value = waFormState.expenseGroupTitle;

    renderWaIncomeRows();
    renderWaExpenseRows();
    updateWaLivePreview();
}

function renderWaIncomeRows() {
    const container = document.getElementById('wa-income-rows-container');
    const disAttr = isWaFormEditable ? '' : 'disabled';

    container.innerHTML = waFormState.incomes.map((item, idx) => {
        const { total } = parseSumExpression(item.breakdown);
        return `
            <div class="p-2.5 rounded-xl bg-white border border-emerald-200 space-y-1.5">
                <div class="flex items-center gap-1.5">
                    <input type="text" ${disAttr} value="${escapeHtml(item.name)}" oninput="updateWaIncomeField(${idx}, 'name', this.value)" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold outline-none">
                    ${isWaFormEditable && waFormState.incomes.length > 1 ? `<button type="button" onclick="removeWaIncomeRow(${idx})" class="px-2 py-1 text-xs font-bold text-rose-600">Hapus</button>` : ''}
                </div>
                <input type="text" ${disAttr} value="${escapeHtml(item.breakdown)}" oninput="updateWaIncomeField(${idx}, 'breakdown', this.value)" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 font-mono text-xs font-bold text-emerald-900 outline-none">
                <div class="text-[10px] font-bold text-emerald-700 text-right">Subtotal Pos: Rp ${formatIndoDots(total)},-</div>
            </div>
        `;
    }).join('');
}

function addWaIncomeRow() {
    if (!isWaFormEditable) return;
    waFormState.incomes.push({ name: 'Donatur / Kotak Infaq', breakdown: '0' });
    renderWaIncomeRows();
    updateWaLivePreview();
}

function removeWaIncomeRow(idx) {
    if (!isWaFormEditable) return;
    waFormState.incomes.splice(idx, 1);
    renderWaIncomeRows();
    updateWaLivePreview();
}

function updateWaIncomeField(idx, field, val) {
    if (!waFormState.incomes[idx]) return;
    waFormState.incomes[idx][field] = val;
    updateWaLivePreview();
}

function renderWaExpenseRows() {
    const container = document.getElementById('wa-expense-rows-container');
    const disAttr = isWaFormEditable ? '' : 'disabled';

    container.innerHTML = waFormState.expenses.map((item, idx) => {
        const sub = Math.round((Number(item.qty) || 0) * parseIndoNumber(item.price));
        return `
            <div class="p-2.5 rounded-xl bg-white border border-amber-200 space-y-1.5">
                <div class="flex items-center gap-1.5">
                    <input type="text" ${disAttr} value="${escapeHtml(item.name)}" oninput="updateWaExpenseField(${idx}, 'name', this.value)" placeholder="Nama barang" class="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold outline-none">
                    ${isWaFormEditable && waFormState.expenses.length > 1 ? `<button type="button" onclick="removeWaExpenseRow(${idx})" class="px-2 py-1 text-xs font-bold text-rose-600">Hapus</button>` : ''}
                </div>
                <div class="grid grid-cols-3 gap-1.5">
                    <input type="number" ${disAttr} value="${item.qty}" oninput="updateWaExpenseField(${idx}, 'qty', this.value)" class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold outline-none">
                    <input type="text" ${disAttr} value="${escapeHtml(item.unit)}" oninput="updateWaExpenseField(${idx}, 'unit', this.value)" class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs outline-none">
                    <input type="text" ${disAttr} inputmode="numeric" value="${formatIndoDots(item.price)}" oninput="updateWaExpenseField(${idx}, 'price', this.value)" onblur="formatMoneyInputOnBlur(this)" class="px-2 py-1.5 rounded-lg border border-slate-200 font-mono text-xs font-bold text-amber-950 outline-none">
                </div>
                <div id="wa-exp-subtotal-${idx}" class="text-[10px] font-bold text-amber-800 text-right">Subtotal: Rp ${formatIndoDots(sub)},-</div>
            </div>
        `;
    }).join('');
}

function addWaExpenseRow() {
    if (!isWaFormEditable) return;
    waFormState.expenses.push({ name: 'Barang Baru', qty: 1, unit: 'pcs', price: 0 });
    renderWaExpenseRows();
    updateWaLivePreview();
}

function removeWaExpenseRow(idx) {
    if (!isWaFormEditable) return;
    waFormState.expenses.splice(idx, 1);
    renderWaExpenseRows();
    updateWaLivePreview();
}

function updateWaExpenseField(idx, field, val) {
    if (!waFormState.expenses[idx]) return;
    if (field === 'qty') waFormState.expenses[idx].qty = Number(val) || 0;
    else if (field === 'price') waFormState.expenses[idx].price = parseIndoNumber(val);
    else waFormState.expenses[idx][field] = val;

    // Update subtotal langsung tanpa re-render input (mencegah keyboard HP tertutup)
    const item = waFormState.expenses[idx];
    const subEl = document.getElementById(`wa-exp-subtotal-${idx}`);
    if (subEl) {
        const sub = Math.round((Number(item.qty) || 0) * parseIndoNumber(item.price));
        subEl.textContent = `Subtotal: Rp ${formatIndoDots(sub)},-`;
    }
    updateWaLivePreview();
}

function parseSumExpression(exprStr) {
    if (!exprStr) return { parts: [], total: 0 };
    const parts = String(exprStr)
        .split('+')
        .map(s => parseIndoNumber(s))
        .filter(n => n > 0);
    const total = parts.reduce((acc, n) => acc + n, 0);
    return { parts, total };
}

function buildWaReportCalculationAndText() {
    if (currentRole === 'admin' && isWaFormEditable) {
        waFormState.month = document.getElementById('wa-input-month').value;
        waFormState.year = document.getElementById('wa-input-year').value || '2026';
        waFormState.prevLabel = document.getElementById('wa-prev-label').value.trim() || 'Sisa saldo bulan sebelumnya';
        waFormState.prevAmount = parseIndoNumber(document.getElementById('wa-prev-amount').value);
        waFormState.expenseGroupTitle = document.getElementById('wa-expense-group-title').value.trim() || 'Belanja sembako';
    }

    const monthName = MONTH_NAMES[parseInt(waFormState.month, 10) - 1] || 'Oktober';
    const yearStr = waFormState.year;

    let totalNewIncome = 0;
    const incomeLines = waFormState.incomes.map(item => {
        const { parts, total } = parseSumExpression(item.breakdown);
        totalNewIncome += total;
        if (parts.length > 1) {
            return `- ${item.name} = ${parts.map(p => formatIndoDots(p)).join(' + ')} = ${formatIndoDots(total)}.`;
        }
        return `- ${item.name} = ${formatIndoDots(total)}.`;
    });

    const prevAmt = parseIndoNumber(waFormState.prevAmount);
    const totalIncomeAll = totalNewIncome + prevAmt;

    let totalExpenseAll = 0;
    const expenseLines = waFormState.expenses.map(item => {
        const qty = Number(item.qty) || 0;
        const price = parseIndoNumber(item.price);
        const subtotal = Math.round(qty * price);
        totalExpenseAll += subtotal;
        const unitStr = item.unit ? ` ${item.unit}` : '';
        return `- ${item.name} ${qty}${unitStr} x ${formatIndoDots(price)} = ${formatIndoDots(subtotal)},-`;
    });

    const endingBalance = totalIncomeAll - totalExpenseAll;

    const waText = [
        `Assalamu'alaikum warohmatullahi wabarokatuh`,
        ``,
        `*LAPORAN INFAQMU BULAN ${monthName.toUpperCase()} ${yearStr}*`,
        `======================================`,
        `#Penerimaan :`,
        ...incomeLines,
        `- ${waFormState.prevLabel} = ${formatIndoDots(prevAmt)},-`,
        `Total penerimaan = Rp. ${formatIndoDots(totalIncomeAll)},-`,
        ``,
        `#Pengeluaran :`,
        `- ${waFormState.expenseGroupTitle} :`,
        ...expenseLines,
        `Total pengeluaran = Rp. ${formatIndoDots(totalExpenseAll)},- `,
        ``,
        `Saldo Infaqmu bulan ${monthName}= ${formatIndoDots(totalIncomeAll)} - ${formatIndoDots(totalExpenseAll)} = Rp. ${formatIndoDots(endingBalance)},-`,
        ``,
        `_Wassalamu'alaikum warohmatullahi wabarokatuh._ 🙏`
    ].join('
');

    return { monthName, yearStr, totalIncomeAll, prevAmt, totalExpenseAll, endingBalance, incomeLines, expenseLines, waText };
}

function updateWaLivePreview() {
    const calc = buildWaReportCalculationAndText();
    document.getElementById('wa-preview-period-tag').textContent = `${calc.monthName} ${calc.yearStr}`;
    document.getElementById('wa-generated-text').textContent = calc.waText;
}

async function saveAndPublishWaReport() {
    if (currentRole !== 'admin') return;
    const calc = buildWaReportCalculationAndText();
    const periodKey = `${waFormState.year}-${waFormState.month}`;
    waReportsStore[periodKey] = JSON.parse(JSON.stringify(waFormState));

    const txDateStr = `${waFormState.year}-${waFormState.month}-25`;
    const ymPrefix = `${waFormState.year}-${waFormState.month}`;

    // Hapus catatan kas lama pada bulan yang sama agar tidak dobel
    transactions = transactions.filter(t => !(t.tx_date && t.tx_date.startsWith(ymPrefix) && (t.type === 'in' || t.type === 'out')));

    const newRows = [
        {
            id: 'local-in-' + Date.now(),
            type: 'in',
            category: waFormState.incomes[0]?.name || 'Kaleng Infaqmu',
            title: `Penerimaan Infaq Bulan ${calc.monthName} ${calc.yearStr}`,
            description: `${calc.incomeLines.join(' ')} ${waFormState.prevLabel} = Rp ${formatIndoDots(calc.prevAmt)},- (Total Penerimaan: Rp ${formatIndoDots(calc.totalIncomeAll)},-).`,
            amount: calc.totalIncomeAll,
            tx_date: txDateStr,
            theme: 'emerald',
            aamiin_count: 1
        },
        {
            id: 'local-out-' + (Date.now() + 1),
            type: 'out',
            category: waFormState.expenseGroupTitle || 'Belanja Sembako',
            title: `${waFormState.expenseGroupTitle} (${calc.monthName} ${calc.yearStr})`,
            description: `Rincian ${waFormState.expenseGroupTitle}: ${calc.expenseLines.join(' ')} (Total Pengeluaran: Rp ${formatIndoDots(calc.totalExpenseAll)},- | Saldo Akhir: Rp ${formatIndoDots(calc.endingBalance)},-).`,
            amount: calc.totalExpenseAll,
            tx_date: txDateStr,
            theme: 'amber',
            aamiin_count: 1
        }
    ];

    transactions.push(...newRows);
    saveLocalCache();
    toggleWaFormEditMode(false);
    renderPublishedMonthsBar();
    refreshDashboard();

    if (isCloudConnected) {
        try {
            await supabaseRestFetch('infaq_transactions', {
                method: 'POST',
                headers: { 'Prefer': 'return=representation' },
                body: newRows.map(({ id, ...rest }) => rest)
            });
            showToast(`Laporan ${calc.monthName} ${calc.yearStr} tersimpan ke Cloud!`, 'success');
        } catch (e) {
            showToast('Tersimpan di perangkat (Cloud gagal dijangkau).', 'info');
        }
    } else {
        showToast(`Laporan ${calc.monthName} ${calc.yearStr} tersimpan!`, 'success');
    }
}

function copyWaReportText() {
    copyTextFallback(document.getElementById('wa-generated-text').textContent, 'Teks laporan WhatsApp berhasil disalin!');
}

function shareDirectToWhatsApp() {
    const text = document.getElementById('wa-generated-text').textContent;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

// --- STATISTIK & GRAFIK ---
function renderStatsView(year, month, periodLabel, ledger) {
    document.getElementById('stats-card-in').textContent = formatRupiah(ledger.totalPureIn);
    document.getElementById('stats-sub-in').textContent = `Saldo Awal: ${formatRupiah(ledger.initialCarryOver)}`;
    document.getElementById('stats-card-out').textContent = formatRupiah(ledger.totalOut);
    document.getElementById('stats-sub-out').textContent = `Sisa Kas: ${formatRupiah(ledger.overallBalance)}`;
    document.getElementById('chart-year-label').textContent = year;
    document.getElementById('category-period-subtitle').textContent = `Periode ${periodLabel}`;

    const totalAvail = ledger.initialCarryOver + ledger.totalPureIn;
    const ratio = totalAvail > 0 ? Math.round((ledger.totalOut / totalAvail) * 100) : 0;
    document.getElementById('disbursement-ratio').textContent = `${ratio}% Tersalurkan`;

    const inData = Array(12).fill(0);
    const outData = Array(12).fill(0);
    transactions.forEach(tx => {
        if (tx.tx_date && tx.tx_date.startsWith(year) && (tx.type === 'in' || tx.type === 'out')) {
            const mIdx = parseInt(tx.tx_date.substring(5, 7), 10) - 1;
            if (mIdx >= 0 && mIdx < 12) {
                if (tx.type === 'in') inData[mIdx] += extractCarryOverAndPureIncome(tx).pureIn;
                else outData[mIdx] += Number(tx.amount) || 0;
            }
        }
    });

    const canvas = document.getElementById('monthlyChart');
    const fallbackBox = document.getElementById('fallback-bar-chart');

    if (window.Chart && canvas) {
        canvas.classList.remove('hidden');
        fallbackBox.classList.add('hidden');
        if (monthlyChartInstance) monthlyChartInstance.destroy();
        monthlyChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
                datasets: [
                    { label: 'Masuk', data: inData, backgroundColor: '#10b981', borderRadius: 4 },
                    { label: 'Salur', data: outData, backgroundColor: '#f59e0b', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    } else if (fallbackBox) {
        canvas.classList.add('hidden');
        fallbackBox.classList.remove('hidden');
        const maxVal = Math.max(1, ...inData, ...outData);
        fallbackBox.innerHTML = inData.map((v, i) => {
            const hIn = Math.round((v / maxVal) * 100);
            const hOut = Math.round((outData[i] / maxVal) * 100);
            return `
                <div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div class="w-full flex items-end gap-0.5 h-32">
                        <div class="flex-1 bg-emerald-500 rounded-t" style="height:${hIn}%"></div>
                        <div class="flex-1 bg-amber-500 rounded-t" style="height:${hOut}%"></div>
                    </div>
                    <span class="text-[9px] text-slate-500">${i + 1}</span>
                </div>
            `;
        }).join('');
    }

    // Breakdown Kategori Penyaluran
    const outMap = {};
    transactions.filter(t => t.type === 'out').forEach(t => {
        outMap[t.category] = (outMap[t.category] || 0) + (Number(t.amount) || 0);
    });
    const listBox = document.getElementById('category-breakdown-list');
    const entries = Object.entries(outMap).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        listBox.innerHTML = '<div class="text-xs text-slate-400 text-center py-4">Belum ada data penyaluran.</div>';
    } else {
        listBox.innerHTML = entries.map(([cat, amt]) => {
            const pct = ledger.totalOut > 0 ? Math.round((amt / ledger.totalOut) * 100) : 0;
            return `
                <div>
                    <div class="flex justify-between text-xs mb-1">
                        <span class="font-bold text-slate-700">${escapeHtml(cat)}</span>
                        <span class="font-bold">${formatRupiah(amt)} (${pct}%)</span>
                    </div>
                    <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-emerald-600 rounded-full" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// --- MODAL BERITA (ADMIN) ---
function openNewsModal(editId = null) {
    if (currentRole !== 'admin') return;
    const catSelect = document.getElementById('news-category');
    catSelect.innerHTML = CATEGORIES.news.map(c => `<option value="${c}">${c}</option>`).join('');

    if (editId) {
        const tx = transactions.find(t => String(t.id) === String(editId));
        if (!tx) return;
        document.getElementById('modal-news-title').textContent = 'Edit Berita Kegiatan';
        document.getElementById('news-id').value = tx.id;
        document.getElementById('news-title').value = tx.title;
        document.getElementById('news-description').value = tx.description;
        document.getElementById('news-date').value = tx.tx_date;
        document.getElementById('news-category').value = tx.category;
        document.getElementById('news-theme').value = tx.theme || 'emerald';
    } else {
        document.getElementById('modal-news-title').textContent = 'Posting Berita Baru';
        document.getElementById('news-id').value = '';
        document.getElementById('news-form').reset();
        document.getElementById('news-date').value = new Date().toISOString().split('T')[0];
    }

    document.getElementById('news-modal').classList.remove('hidden');
    document.getElementById('news-modal').classList.add('flex');
}

function closeNewsModal() {
    document.getElementById('news-modal').classList.add('hidden');
    document.getElementById('news-modal').classList.remove('flex');
}

async function handleSaveNews(e) {
    e.preventDefault();
    if (currentRole !== 'admin') return;

    const id = document.getElementById('news-id').value;
    const payload = {
        type: 'news',
        title: document.getElementById('news-title').value.trim(),
        description: document.getElementById('news-description').value.trim(),
        tx_date: document.getElementById('news-date').value,
        category: document.getElementById('news-category').value,
        theme: document.getElementById('news-theme').value,
        amount: 0
    };

    if (id) {
        const idx = transactions.findIndex(t => String(t.id) === String(id));
        if (idx !== -1) transactions[idx] = { ...transactions[idx], ...payload };
    } else {
        transactions.unshift({ id: 'local-news-' + Date.now(), ...payload, aamiin_count: 1 });
        if (isCloudConnected) {
            supabaseRestFetch('infaq_transactions', {
                method: 'POST',
                body: [{ ...payload, aamiin_count: 1 }]
            }).catch(() => {});
        }
    }

    saveLocalCache();
    closeNewsModal();
    refreshDashboard();
    showToast('Berita kegiatan berhasil diterbitkan!', 'success');
}

function promptDeleteTransaction(id) {
    if (currentRole !== 'admin') return;
    pendingDeleteId = id;
    document.getElementById('delete-modal').classList.remove('hidden');
    document.getElementById('delete-modal').classList.add('flex');

    document.getElementById('confirm-delete-btn').onclick = () => {
        const target = String(pendingDeleteId);
        transactions = transactions.filter(t => String(t.id) !== target);
        saveLocalCache();
        closeDeleteModal();
        refreshDashboard();
        if (isCloudConnected && !target.startsWith('local-')) {
            supabaseRestFetch(`infaq_transactions?id=eq.${target}`, { method: 'DELETE' }).catch(() => {});
        }
        showToast('Postingan berhasil dihapus.', 'info');
    };
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.add('hidden');
    document.getElementById('delete-modal').classList.remove('flex');
}

// --- PENGATURAN ADMIN, SUPABASE & AUDIT SALDO ---
function openSecurityModal() {
    if (currentRole !== 'admin') return;
    document.getElementById('set-sb-url').value = sbCredentials.url;
    document.getElementById('set-sb-key').value = sbCredentials.key;
    document.getElementById('set-org-name').value = appSettings.orgName;
    document.getElementById('set-org-handle').value = appSettings.orgHandle;
    document.getElementById('set-org-bio').value = appSettings.orgBio;
    document.getElementById('set-viewer-pin').value = appSettings.viewerPin;
    document.getElementById('set-admin-pin').value = appSettings.adminPin;

    document.getElementById('security-modal').classList.remove('hidden');
    document.getElementById('security-modal').classList.add('flex');
}

function closeSecurityModal() {
    document.getElementById('security-modal').classList.add('hidden');
    document.getElementById('security-modal').classList.remove('flex');
}

async function testAndSyncSupabase() {
    sbCredentials = {
        url: document.getElementById('set-sb-url').value.trim().replace(/\/+$/, ''),
        key: document.getElementById('set-sb-key').value.trim()
    };
    localStorage.setItem(STORAGE_KEYS.SB_CONFIG, JSON.stringify(sbCredentials));
    initSupabaseCredentials();
    await syncInitialData(true);
}

async function pushLocalDataToCloud() {
    const localRows = transactions.filter(t => String(t.id).startsWith('local-'));
    if (localRows.length === 0) {
        showToast('Semua data sudah tersinkron di Cloud.', 'info');
        return;
    }
    try {
        await supabaseRestFetch('infaq_transactions', {
            method: 'POST',
            body: localRows.map(({ id, ...rest }) => rest)
        });
        showToast(`${localRows.length} data lokal berhasil diunggah ke Supabase!`, 'success');
        await syncInitialData(false);
    } catch (err) {
        showToast('Gagal mengunggah ke Supabase: ' + err.message, 'error');
    }
}

function runFullBalanceAudit() {
    deduplicateMonthlyLedgerRecords();
    saveLocalCache();
    const ledger = computeAccurateCashLedger();
    refreshDashboard();
    showToast(`Audit selesai! Saldo Kas Akurat: ${formatRupiah(ledger.overallBalance)}`, 'success');
}

async function handleSaveSecuritySettings(e) {
    e.preventDefault();
    const newViewerPin = document.getElementById('set-viewer-pin').value.trim();
    const newAdminPin = document.getElementById('set-admin-pin').value.trim();

    if (!/^\d{6}$/.test(newViewerPin) || !/^\d{6}$/.test(newAdminPin)) {
        showToast('PIN wajib 6 digit angka!', 'error');
        return;
    }

    sbCredentials = {
        url: document.getElementById('set-sb-url').value.trim().replace(/\/+$/, ''),
        key: document.getElementById('set-sb-key').value.trim()
    };
    localStorage.setItem(STORAGE_KEYS.SB_CONFIG, JSON.stringify(sbCredentials));

    appSettings = {
        orgName: document.getElementById('set-org-name').value.trim(),
        orgHandle: document.getElementById('set-org-handle').value.trim().replace(/^@/, ''),
        orgBio: document.getElementById('set-org-bio').value.trim(),
        viewerPin: newViewerPin,
        adminPin: newAdminPin
    };

    saveLocalCache();
    applySettingsToUI();
    closeSecurityModal();
    showToast('Pengaturan berhasil disimpan!', 'success');
}

function resetDemoData() {
    transactions = getDefaultDummyData();
    waReportsStore = getDefaultWaReports();
    saveLocalCache();
    closeSecurityModal();
    refreshDashboard();
    showToast('Data contoh dipulihkan.', 'info');
}

async function handleManualRefresh() {
    await syncInitialData(true);
}

function exportToCSV() {
    const rows = [['Tanggal', 'Jenis', 'Kategori', 'Judul', 'Nominal']];
    transactions.forEach(t => {
        rows.push([t.tx_date, t.type, `"${t.category}"`, `"${t.title}"`, t.amount || 0]);
    });
    const blob = new Blob(['﻿' + rows.map(r => r.join(',')).join('
')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Laporan_INFAQMU.csv';
    a.click();
}

function copyTextFallback(text, successMsg) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    try {
        document.execCommand('copy');
        showToast(successMsg, 'success');
    } catch (e) {
        showToast('Gagal menyalin teks.', 'error');
    }
    document.body.removeChild(el);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bg = type === 'error' ? 'bg-rose-900 border-rose-500/40' : 'bg-slate-900 border-emerald-500/40';
    toast.className = `${bg} text-white px-4 py-2.5 rounded-full shadow-xl border text-xs font-semibold text-center transition-opacity duration-300`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}
