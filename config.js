// =====================================================================
// KONFIGURASI UTAMA APLIKASI INFAQMU (config.js)
// =====================================================================

const DEFAULT_SUPABASE_URL = "https://pmcqlufrsrfkfblljdzb.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_D0xmTYa3K7pO2d15zsdD_A_Tx-7bh9y";

const STORAGE_KEYS = {
    SB_CONFIG: 'infaqmu_supabase_creds_v5',
    SETTINGS: 'infaqmu_local_settings_v5',
    TRANSACTIONS: 'infaqmu_local_transactions_v5',
    LIKED_IDS: 'infaqmu_local_liked_v5',
    WA_REPORTS: 'infaqmu_wa_reports_v5'
};

const CATEGORIES = {
    news: [
        'Penyaluran Sembako',
        'Santunan Yatim & Dhuafa',
        'Laporan Keuangan Bulanan',
        'Program Kesehatan & Sosial',
        'Kegiatan Dakwah & TPQ',
        'Pengumuman Lembaga'
    ],
    in: [
        'Kaleng Infaqmu',
        'Sisa Saldo Bulan Lalu',
        'Kotak Amal Jumat',
        'Donatur Tetap Bulanan',
        'Transfer Rekening Infaq',
        'Infaq Hamba Allah'
    ],
    out: [
        'Belanja Sembako',
        'Santunan Anak Yatim & Piatu',
        'Bantuan Fakir Miskin & Dhuafa',
        'Bantuan Kesehatan & Pengobatan',
        'Bantuan Tanggap Bencana',
        'Operasional Dakwah & TPQ'
    ]
};

const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function getDefaultDummyData() {
    return [
        {
            id: 'local-1001',
            tx_date: '2026-10-25',
            type: 'in',
            category: 'Kaleng Infaqmu',
            title: 'Penerimaan Infaq Bulan Oktober 2026',
            description: '- Kaleng Infaqmu = 686.500 + 807.500 + 612.500 = 2.106.500. Sisa saldo bulan September = Rp 12.500,- (Total Penerimaan: Rp 2.119.000,-).',
            amount: 2119000,
            theme: 'emerald',
            aamiin_count: 54
        },
        {
            id: 'local-1002',
            tx_date: '2026-10-28',
            type: 'out',
            category: 'Belanja Sembako',
            title: 'Belanja sembako (Oktober 2026)',
            description: 'Rincian Belanja sembako: - Beras Horas 19 sak x 74.000 = 1.406.000,- - Minyakita 19 bks x 16.500 = 313.500,- - Telur 190 butir x 1.650 = 313.500,- (Total Pengeluaran: Rp 2.033.000,- | Saldo Akhir: Rp 86.000,-).',
            amount: 2033000,
            theme: 'amber',
            aamiin_count: 82
        },
        {
            id: 'local-1003',
            tx_date: '2026-10-29',
            type: 'news',
            category: 'Penyaluran Sembako',
            title: 'Distribusi 19 Paket Sembako untuk Keluarga Dhuafa',
            description: 'Alhamdulillah, amanah dari kotak Kaleng Infaqmu bulan Oktober 2026 telah disalurkan dalam bentuk 19 paket sembako (Beras Horas, Minyakita, dan Telur) kepada warga yang membutuhkan. Jazakumullahu khairan katsiran kepada seluruh donatur.',
            amount: 0,
            theme: 'emerald',
            aamiin_count: 96
        }
    ];
}

function getDefaultWaReports() {
    return {
        '2026-10': {
            month: '10',
            year: '2026',
            incomes: [
                { name: 'Kaleng Infaqmu', breakdown: '686.500 + 807.500 + 612.500' }
            ],
            prevLabel: 'Sisa saldo bulan September',
            prevAmount: 12500,
            expenseGroupTitle: 'Belanja sembako',
            expenses: [
                { name: 'Beras Horas', qty: 19, unit: 'sak', price: 74000 },
                { name: 'Minyakita', qty: 19, unit: 'bks', price: 16500 },
                { name: 'Telur', qty: 190, unit: 'butir', price: 1650 }
            ]
        }
    };
}
