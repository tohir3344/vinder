import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Ionicons } from "@expo/vector-icons";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

// ===== Endpoints =====
const API_USERS = `${API_BASE}gaji/gaji_users.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;
const API_SAVE = `${API_BASE}gaji/gaji_save.php`;
const API_ARCH = `${API_BASE}gaji/gaji_archive.php`;
const API_SLIP_STATUS = `${API_BASE}gaji/gaji_status.php`;

// ===== Types =====
type UserOpt = { id: number; nama: string; gaji?: number };

type PreviewResp = {
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  total_telat: number;
  lembur_rp: number;
  angsuran_rp: number;
  gaji_pokok_rp?: number;
  bonus_bulanan?: number;
  is_bonus_period?: boolean;
};

type ArchiveRow = {
  id: number;
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  total_telat?: number;
  lembur_rp: number;
  gaji_pokok_rp: number;
  angsuran_rp: number;
  potongan_telat_rp?: number | null;
  bonus_bulanan_rp?: number | null;
  others_total_rp?: number | null;
  total_gaji_rp: number;
  created_at?: string;
  others_json?: any;
  status_bayar?: string | null;
  is_accumulation?: boolean;
};

// ===== Helpers =====
const fmtIDR = (n: number) => (n ?? 0).toLocaleString("id-ID");

const toNum = (val: string | number) => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = val.toString().replace(/\D/g, "");
  return parseInt(cleaned) || 0;
};

const fmtInput = (val: string) => {
  const num = val.replace(/\D/g, "");
  return num ? parseInt(num).toLocaleString("id-ID") : "0";
};

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();
  let diffToSaturday = (dow + 1) % 7;
  if (dow === 6) { diffToSaturday = 7; }
  x.setDate(x.getDate() - diffToSaturday);
  return x;
};

const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};

// ============================================
// 1. GENERATOR SLIP GAJI (Mingguan & Bulanan)
// ============================================
const generateSlipHTML = (item: ArchiveRow) => {
  let others: { label: string; amount: number }[] = [];
  try {
    others = (typeof item.others_json === 'string' ? JSON.parse(item.others_json) : item.others_json) || [];
  } catch (e) { others = []; }

  const othersHtml = others.map(o => `
    <tr>
      <td>${o.label || 'Tambahan Lain'}</td>
      <td style="text-align:right;">Rp ${fmtIDR(Number(o.amount))}</td>
    </tr>
  `).join('');

  // Logika Judul & Warna
  const title = item.is_accumulation ? "LAPORAN GAJI BULANAN" : "SLIP GAJI MINGGUAN";
  const color = item.is_accumulation ? "#1e3a8a" : "#A51C24";

  return `
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>
        body { font-family: sans-serif; padding: 20px; color: #333; }
        .header { text-align: center; border-bottom: 3px solid ${color}; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { margin: 0; color: ${color}; font-size: 24px; text-transform: uppercase; }
        .header h3 { margin: 5px 0 0; color: #666; font-weight: normal; font-size: 14px; }
        .info { width: 100%; margin-bottom: 20px; font-size: 14px; }
        .details { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .details td { padding: 8px; border-bottom: 1px solid #eee; font-size: 14px; }
        .section { background-color: #f3f4f6; font-weight: bold; padding: 5px 8px; font-size: 12px; margin-top: 10px; color: #555; }
        .total { background-color: ${color}; color: white; font-weight: bold; font-size: 16px; }
        .total td { padding: 12px 8px; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${title}</h1>
        <h3>Periode: ${item.periode_start} s/d ${item.periode_end}</h3>
      </div>
      <table class="info">
        <tr><td><strong>Nama Karyawan:</strong></td><td align="right">${item.nama}</td></tr>
        <tr><td><strong>Status:</strong></td><td align="right">${item.status_bayar === 'paid' ? 'LUNAS / TRANSFER' : 'PENDING'}</td></tr>
      </table>

      <div class="section">PENERIMAAN</div>
      <table class="details">
        <tr><td>Gaji Pokok (${item.hadir_minggu} kehadiran)</td><td align="right">Rp ${fmtIDR(item.gaji_pokok_rp)}</td></tr>
        <tr><td>Lembur</td><td align="right">Rp ${fmtIDR(item.lembur_rp)}</td></tr>
        ${item.bonus_bulanan_rp ? `<tr><td>Bonus Bulanan</td><td align="right">Rp ${fmtIDR(item.bonus_bulanan_rp)}</td></tr>` : ''}
        ${othersHtml}
      </table>

      <div class="section">POTONGAN</div>
      <table class="details">
        ${item.potongan_telat_rp ? `<tr><td>Denda Telat (${item.total_telat}x)</td><td align="right" style="color:red">- Rp ${fmtIDR(item.potongan_telat_rp)}</td></tr>` : ''}
        ${item.angsuran_rp > 0 ? `<tr><td>Angsuran Kasbon</td><td align="right" style="color:red">- Rp ${fmtIDR(item.angsuran_rp)}</td></tr>` : ''}
        ${!item.potongan_telat_rp && item.angsuran_rp <= 0 ? '<tr><td colspan="2" align="center" style="color:#999; font-style:italic;">- Tidak ada potongan -</td></tr>' : ''}
      </table>

      <br>
      <table class="details">
        <tr class="total">
          <td>TOTAL BERSIH</td>
          <td align="right">Rp ${fmtIDR(item.total_gaji_rp)}</td>
        </tr>
      </table>

      <div class="footer">
        Dicetak otomatis oleh Sistem Penggajian pada ${new Date().toLocaleString('id-ID')}
      </div>
    </body>
  </html>
  `;
};

// ============================================
// 2. GENERATOR LAPORAN REKAPITULASI (UPDATE: ADA POTONGAN TELAT)
// ============================================
const generateRecapHTML = (list: ArchiveRow[], start: string, end: string, mode: string) => {
  const totalGaji = list.reduce((sum, item) => sum + item.total_gaji_rp, 0);
  const rows = list.map((item, idx) => `
    <tr>
      <td style="text-align:center;">${idx + 1}</td>
      <td>${item.nama}</td>
      <td style="text-align:center;">${item.hadir_minggu}</td>
      <td style="text-align:right;">${fmtIDR(item.gaji_pokok_rp)}</td>
      <td style="text-align:right;">${fmtIDR(item.lembur_rp)}</td>
      <td style="text-align:right;">${fmtIDR(item.bonus_bulanan_rp)}</td>
      
      <td style="text-align:right; color:red;">${fmtIDR(item.potongan_telat_rp || 0)}</td>
      
      <td style="text-align:right; color:red;">${fmtIDR(item.angsuran_rp)}</td>
      <td style="text-align:right; font-weight:bold;">${fmtIDR(item.total_gaji_rp)}</td>
    </tr>
  `).join('');

  return `
  <html>
    <head>
      <style>
        body { font-family: sans-serif; padding: 20px; font-size: 10px; }
        h2 { text-align: center; margin-bottom: 5px; }
        p { text-align: center; margin-top: 0; color: #666; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background: #333; color: #fff; padding: 8px; font-size: 10px; }
        td { border: 1px solid #ddd; padding: 6px; font-size: 10px; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .total-row td { font-weight: bold; background: #ddd; font-size: 11px; }
      </style>
    </head>
    <body>
      <h2>REKAPITULASI GAJI ${mode === 'month' ? 'BULANAN' : 'MINGGUAN'}</h2>
      <p>Periode: ${start} s/d ${end}</p>
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>Nama</th>
            <th>Hadir</th>
            <th>Gaji Pokok</th>
            <th>Lembur</th>
            <th>Bonus</th>
            <th>Denda Telat</th> <th>Pot. Kasbon</th>
            <th>Total Terima</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="8" style="text-align:right;">TOTAL PENGELUARAN:</td>
            <td style="text-align:right;">Rp ${fmtIDR(totalGaji)}</td>
          </tr>
        </tbody>
      </table>
    </body>
  </html>
  `;
};

// Fungsi Print Slip Individu
const printSlip = async (item: ArchiveRow) => {
  try {
    const html = generateSlipHTML(item);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Slip - ${item.nama}` });
  } catch (e: any) { Alert.alert("Error", e.message); }
};

// Fungsi Print Laporan Rekap
const printRecap = async (list: ArchiveRow[], start: Date, end: Date, mode: string) => {
  if (list.length === 0) return Alert.alert("Kosong", "Tidak ada data untuk dicetak.");
  try {
    const html = generateRecapHTML(list, iso(start), iso(end), mode);
    const { uri } = await Print.printToFileAsync({ html, base64: false, orientation: Print.Orientation.landscape });
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Laporan Gaji" });
  } catch (e: any) { Alert.alert("Error", e.message); }
};

const C = {
  primary: "#A51C24",
  primaryDark: "#0066CC",
  primarySoft: "#E8F1FF",
  text: "#0B1A33",
  muted: "#6B7A90",
  border: "#E3ECFF",
  bg: "#F6F9FF",
  card: "#FFFFFF",
};

function Row({ label, value, isDeduction, isBold }: { label: string; value: string, isDeduction?: boolean, isBold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
      <Text style={{ color: isBold ? C.text : C.muted, fontWeight: isBold ? "700" : "400", flex: 1 }}>{label}</Text>
      <Text style={{ fontWeight: isBold ? "700" : "600", color: isDeduction ? '#D32F2F' : C.text }}>{value}</Text>
    </View>
  );
}

const GajiDetailCard = ({ item }: { item: ArchiveRow }) => {
  return (
    <View style={st.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={st.h3}>{item.nama}</Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            {item.is_accumulation ? "Laporan 1 Bulan Full" : `${item.periode_start} s/d ${item.periode_end}`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {/* TOMBOL PRINT INDIVIDU */}
          <TouchableOpacity onPress={() => printSlip(item)} style={{ padding: 8, backgroundColor: '#f0f9ff', borderRadius: 8, borderWidth: 1, borderColor: '#bae6fd' }}>
            <Ionicons name="print-outline" size={20} color="#0284c7" />
          </TouchableOpacity>

          <View style={{ backgroundColor: item.status_bayar === 'paid' ? '#dcfce7' : '#fee2e2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
            <Text style={{ color: item.status_bayar === 'paid' ? '#166534' : '#b91c1c', fontSize: 10, fontWeight: '700' }}>
              {item.status_bayar === 'paid' ? 'Paid' : 'Pending'}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: '#eee', marginVertical: 10 }} />
      <Row label="Poin Hadir" value={`${item.hadir_minggu} poin`} />
      <Row label="Gaji Pokok" value={`Rp ${fmtIDR(item.gaji_pokok_rp)}`} />
      {item.total_telat ? <Row label="Jumlah Telat" value={`${item.total_telat} kali`} isDeduction /> : null}
      {item.potongan_telat_rp ? <Row label="Denda Telat" value={`- Rp ${fmtIDR(item.potongan_telat_rp)}`} isDeduction /> : null}
      <Row label="Lembur" value={`Rp ${fmtIDR(item.lembur_rp)}`} />
      {item.bonus_bulanan_rp ? <Row label="Bonus Bulanan" value={`Rp ${fmtIDR(item.bonus_bulanan_rp)}`} /> : null}
      {item.angsuran_rp > 0 && (<Row label="Potongan Angsuran" value={`- Rp ${fmtIDR(item.angsuran_rp)}`} isDeduction />)}

      <View style={{ height: 1, backgroundColor: '#eee', marginVertical: 10 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: "700", color: C.text }}>Total Diterima</Text>
        <Text style={{ fontWeight: "800", color: C.primaryDark }}>Rp {fmtIDR(item.total_gaji_rp)}</Text>
      </View>
    </View>
  );
};

export default function GajiAdmin() {
  const [tab, setTab] = useState<"hitung" | "slip" | "arsip">("hitung");
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [userModal, setUserModal] = useState({ visible: false, target: "hitung" as "hitung" | "slip" | "arsip" });

  // ===== STATE TAB HITUNG =====
  const [hitUser, setHitUser] = useState<UserOpt | null>(null);
  const [hitStart, setHitStart] = useState<Date>(startOfWeek(new Date()));
  const [hitEnd, setHitEnd] = useState<Date>(endOfWeek(new Date()));
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);
  const [hitLoading, setHitLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [gajiPokok, setGajiPokok] = useState("");
  const [angsuranInput, setAngsuranInput] = useState("0");
  const [bonusBulanan, setBonusBulanan] = useState("0");
  const [others, setOthers] = useState<{ id: string; label: string; amount: string }[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_USERS);
        const json = await res.json();
        if (json.success) setUsers(json.data || []);
      } catch (e) { console.log("Gagal muat user", e); }
    })();
  }, []);

  useEffect(() => {
    setPreview(null); setGajiPokok(""); setAngsuranInput("0"); setBonusBulanan("0"); setOthers([]);
  }, [hitUser?.id]);

  useEffect(() => {
    if (!hitUser) return;
    const load = async () => {
      setHitLoading(true);
      try {
        const url = `${API_PREVIEW}?user_id=${hitUser.id}&start=${iso(hitStart)}&end=${iso(hitEnd)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.success && json.data) {
          const d = json.data;
          setPreview({ ...d, periode_end: iso(hitEnd) });
          setGajiPokok((d.gaji_pokok_rp || hitUser.gaji || 0).toLocaleString("id-ID"));
          setBonusBulanan((d.bonus_bulanan || 0).toLocaleString("id-ID"));

          // OTOMATIS ISI ANGSURAN
          const sisaUtang = Number(d.angsuran_rp ?? 0);
          if (sisaUtang > 0) {
            const potValue = sisaUtang >= 300000 ? 300000 : sisaUtang;
            setAngsuranInput(potValue.toLocaleString("id-ID"));
          } else {
            setAngsuranInput("0");
          }
        } else { setPreview(null); }
      } catch (e) { setPreview(null); }
      finally { setHitLoading(false); }
    };
    load();
  }, [hitUser, hitStart, hitEnd]);

  const calculation = useMemo(() => {
    if (!preview) return { gpTotal: 0, denda: 0, total: 0, bonusVal: 0, angsuranVal: 0, othersSum: 0 };
    const gpHarian = toNum(gajiPokok);
    const bonusVal = toNum(bonusBulanan);
    const angsuranVal = toNum(angsuranInput);
    const othersSum = others.reduce((a, o) => a + toNum(o.amount), 0);

    const gpTotal = gpHarian * (preview.hadir_minggu || 0);
    const denda = (preview.total_telat || 0) * 20000;
    const total = gpTotal - denda - angsuranVal + (preview.lembur_rp || 0) + bonusVal + othersSum;

    return { gpTotal, denda, total, bonusVal, angsuranVal, othersSum };
  }, [preview, gajiPokok, angsuranInput, bonusBulanan, others]);

  const saveHitung = async () => {
    if (!hitUser || !preview) return;
    try {
      setHitLoading(true);

      const body = {
        user_id: hitUser.id,
        start: iso(hitStart),
        end: iso(hitEnd),
        hadir_minggu: preview.hadir_minggu,
        total_telat: preview.total_telat,
        gaji_pokok_harian: toNum(gajiPokok),
        gaji_pokok_rp: calculation.gpTotal,
        potongan_telat_rp: calculation.denda,
        angsuran_rp: calculation.angsuranVal,
        bonus_bulanan_rp: calculation.bonusVal,
        others: others.map(o => ({ label: o.label, amount: toNum(o.amount) })).filter(o => o.amount > 0),
        total_gaji_final: calculation.total
      };

      const res = await fetch(API_SAVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const json = await res.json();

      if (json.success) {
        Alert.alert("Berhasil", json.message);
        setTab("slip");
        loadSlip();
      } else {
        throw new Error(json.message);
      }
    } catch (e: any) {
      Alert.alert("Gagal Simpan", e.message);
    } finally {
      setHitLoading(false);
    }
  };

  // ===== SLIP & ARSIP Logic =====
  const [slipUser, setSlipUser] = useState<UserOpt | null>(null);
  const [slipPeriodMode, setSlipPeriodMode] = useState<"week" | "month">("week");
  const [slipStart, setSlipStart] = useState<Date>(startOfWeek(new Date()));
  const [slipEnd, setSlipEnd] = useState<Date>(endOfWeek(new Date()));
  const [slipLoading, setSlipLoading] = useState(false);
  const [slipList, setSlipList] = useState<ArchiveRow[]>([]);

  const loadSlip = async () => {
    setSlipLoading(true);
    try {
      const url = `${API_ARCH}?user_id=${slipUser ? slipUser.id : ''}&start=${iso(slipStart)}&end=${iso(slipEnd)}&mode=${slipPeriodMode}`;
      const res = await fetch(url);
      const json = await res.json();
      setSlipList(json.success ? (json.data || []) : []);
    } catch (e) { setSlipList([]); }
    finally { setSlipLoading(false); }
  };

  const markAllAsPaid = async () => {
    if (slipList.length === 0) return Alert.alert("Kosong", "Cari slip dulu.");
    const ids = slipList.map(s => s.id);
    Alert.alert("Konfirmasi", "Tandai transfer semua slip?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Ya", onPress: async () => {
          setSlipLoading(true);
          try {
            const res = await fetch(API_SLIP_STATUS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ids, status_bayar: 'paid' }) });
            const json = await res.json();
            if (json.success) { Alert.alert("Berhasil", "Status diperbarui."); loadSlip(); }
          } catch (e) { Alert.alert("Gagal", "Error server."); }
          finally { setSlipLoading(false); }
        }
      }
    ]);
  };

  const [arsipUser, setArsipUser] = useState<UserOpt | null>(null);
  const [arsipStart, setArsipStart] = useState<Date>(startOfWeek(new Date()));
  const [arsipEnd, setArsipEnd] = useState<Date>(endOfWeek(new Date()));
  const [arsip, setArsip] = useState<ArchiveRow[]>([]);

  const loadArsip = async () => {
    try {
      let url = `${API_ARCH}?start=${iso(arsipStart)}&end=${iso(arsipEnd)}&mode=week`;
      if (arsipUser) url += `&user_id=${arsipUser.id}`;
      const res = await fetch(url);
      const json = await res.json();
      setArsip(json.data || []);
    } catch (e) { setArsip([]); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={st.headerWrap}>
        <Text style={st.title}>Gaji Admin</Text>
        <View style={st.tabs}>
          {["hitung", "slip", "arsip"].map((t) => (
            <TouchableOpacity key={t} style={[st.tabBtn, tab === t && st.tabActive]} onPress={() => setTab(t as any)}>
              <Text style={[st.tabTx, tab === t && st.tabTxActive]}>
                {t === "hitung" ? "Hitung" : t === "slip" ? "Slip Gaji" : "Arsip"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={st.body}>
        {tab === "hitung" && (
          <View>
            <Text style={st.label}>Karyawan</Text>
            <TouchableOpacity style={st.select} onPress={() => setUserModal({ visible: true, target: "hitung" })}>
              <Text style={st.selectTx}>{hitUser ? hitUser.nama : "Pilih Karyawan..."}</Text>
              <Ionicons name="person" size={18} color={C.muted} />
            </TouchableOpacity>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={st.inputBtn} onPress={() => setShowPicker('start')}>
                <Text style={st.dateLabel}>Mulai</Text>
                <Text style={st.dateVal}>{iso(hitStart)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.inputBtn} onPress={() => setShowPicker('end')}>
                <Text style={st.dateLabel}>Selesai</Text>
                <Text style={st.dateVal}>{iso(hitEnd)}</Text>
              </TouchableOpacity>
            </View>

            {showPicker && (
              <DateTimePicker
                value={showPicker === 'start' ? hitStart : hitEnd}
                mode="date"
                onChange={(e, d) => { setShowPicker(null); if (d) { showPicker === 'start' ? setHitStart(d) : setHitEnd(d); } }}
              />
            )}

            {hitLoading && <ActivityIndicator style={{ marginTop: 20 }} color={C.primary} />}

            {preview && (
              <View style={[st.card, { marginTop: 20 }]}>
                <Text style={st.h3}>Input Variabel</Text>
                <Text style={st.label}>Gaji Pokok Harian</Text>
                <TextInput style={st.input} keyboardType="numeric" value={gajiPokok} onChangeText={v => setGajiPokok(fmtInput(v))} />

                <Text style={st.label}>Potongan Angsuran (Sisa: Rp {fmtIDR(preview.angsuran_rp)})</Text>
                <TextInput
                  style={[st.input, preview.angsuran_rp > 0 && { borderColor: '#D32F2F', borderWidth: 1.5 }]}
                  keyboardType="numeric"
                  value={angsuranInput}
                  onChangeText={v => setAngsuranInput(fmtInput(v))}
                  editable={preview.angsuran_rp > 0}
                />

                <Text style={st.label}>Bonus Bulanan {preview.is_bonus_period && "⭐"}</Text>
                <TextInput style={[st.input, preview.is_bonus_period && st.inputBonus]} keyboardType="numeric" value={bonusBulanan} onChangeText={v => setBonusBulanan(fmtInput(v))} />

                <TouchableOpacity onPress={() => setOthers([...others, { id: Date.now().toString(), label: "", amount: "" }])}>
                  <Text style={st.addOther}>+ Tambah Item Lainnya</Text>
                </TouchableOpacity>

                {others.map(o => (
                  <View key={o.id} style={{ flexDirection: 'row', gap: 5, marginBottom: 5 }}>
                    <TextInput style={[st.input, { flex: 1.5 }]} placeholder="Ket." value={o.label} onChangeText={v => setOthers(others.map(x => x.id === o.id ? { ...x, label: v } : x))} />
                    <TextInput style={[st.input, { flex: 1 }]} placeholder="Rp" keyboardType="numeric" value={o.amount} onChangeText={v => setOthers(others.map(x => x.id === o.id ? { ...x, amount: fmtInput(v) } : x))} />
                  </View>
                ))}

                <View style={st.breakdown}>
                  <Text style={st.breakdownTitle}>RINCIAN KERJA & KALKULASI</Text>
                  <Row label="Total Kehadiran" value={`${preview.hadir_minggu} Hadir`} isBold />
                  <Row label="Total Terlambat" value={`${preview.total_telat} Kali`} isDeduction={preview.total_telat > 0} isBold />
                  <View style={{ height: 1, backgroundColor: '#eee', marginVertical: 8 }} />
                  <Row label={`Gaji Pokok (${preview.hadir_minggu} x ${gajiPokok})`} value={`Rp ${fmtIDR(calculation.gpTotal)}`} />
                  <Row label="Denda (Total Telat x 20.000)" value={`- Rp ${fmtIDR(calculation.denda)}`} isDeduction />
                  <Row label="Lembur" value={`Rp ${fmtIDR(preview.lembur_rp)}`} />
                  <Row label="Angsuran" value={`- Rp ${fmtIDR(calculation.angsuranVal)}`} isDeduction />
                  <Row label="Bonus" value={`Rp ${fmtIDR(calculation.bonusVal)}`} />
                  {others.filter(o => toNum(o.amount) > 0).map(o => (
                    <Row key={o.id} label={o.label || "Lainnya"} value={`Rp ${fmtIDR(toNum(o.amount))}`} />
                  ))}
                </View>

                <View style={st.totalBox}>
                  <Text style={st.totalLabel}>TOTAL GAJI BERSIH</Text>
                  <Text style={st.totalVal}>Rp {fmtIDR(calculation.total)}</Text>
                </View>
                <TouchableOpacity style={st.btnPrimary} onPress={saveHitung}><Text style={st.btnText}>SIMPAN SLIP SEKARANG</Text></TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {tab === "slip" && (
          <View>
            <View style={st.segmentWrap}>
              <TouchableOpacity onPress={() => setSlipPeriodMode("week")} style={[st.segmentBtn, slipPeriodMode === "week" && st.segmentActive]}><Text>Mingguan</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setSlipPeriodMode("month")} style={[st.segmentBtn, slipPeriodMode === "month" && st.segmentActive]}><Text>Bulanan</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={st.select} onPress={() => setUserModal({ visible: true, target: "slip" })}><Text>{slipUser ? slipUser.nama : "Semua Karyawan"}</Text></TouchableOpacity>

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
              <TouchableOpacity style={[st.btnPrimary, { flex: 1 }]} onPress={loadSlip}><Text style={st.btnText}>Cari Slip</Text></TouchableOpacity>

              {/* TOMBOL PRINT REKAPITULASI (NEW) */}
              <TouchableOpacity style={[st.btnPrimary, { flex: 1, backgroundColor: '#374151' }]} onPress={() => printRecap(slipList, slipStart, slipEnd, slipPeriodMode)}>
                <Text style={st.btnText}>Cetak Laporan PDF</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[st.btnPrimary, { marginTop: 0, marginBottom: 10, backgroundColor: '#166534' }]} onPress={markAllAsPaid}><Text style={st.btnText}>Tandai Semua Lunas/Transfer</Text></TouchableOpacity>

            {slipLoading && <ActivityIndicator style={{ marginTop: 10 }} />}
            {slipList.map((item, idx) => (<GajiDetailCard key={idx} item={item} />))}
          </View>
        )}

        {tab === "arsip" && (
          <View>
            <TouchableOpacity style={st.select} onPress={() => setUserModal({ visible: true, target: "arsip" })}><Text>{arsipUser ? arsipUser.nama : "Pilih Karyawan"}</Text></TouchableOpacity>
            <TouchableOpacity style={st.btnPrimary} onPress={loadArsip}><Text style={st.btnText}>Tampilkan Arsip</Text></TouchableOpacity>
            {arsip.map((item, idx) => (<GajiDetailCard key={idx} item={item} />))}
          </View>
        )}
      </ScrollView>

      <Modal visible={userModal.visible} transparent animationType="slide">
        <View style={st.modalWrap}>
          <View style={st.modalBox}>
            <TouchableOpacity onPress={() => setUserModal({ ...userModal, visible: false })}><Text style={st.modalClose}>Tutup</Text></TouchableOpacity>
            <FlatList data={[{ id: 0, nama: "Semua Karyawan" }, ...users]} keyExtractor={i => i.id.toString()} renderItem={({ item }) => (
              <TouchableOpacity style={st.modalItem} onPress={() => {
                if (userModal.target === 'hitung') setHitUser(item.id === 0 ? null : item);
                if (userModal.target === 'slip') setSlipUser(item.id === 0 ? null : item);
                if (userModal.target === 'arsip') setArsipUser(item.id === 0 ? null : item);
                setUserModal({ ...userModal, visible: false });
              }}><Text style={{ fontSize: 16 }}>{item.nama}</Text></TouchableOpacity>
            )} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  headerWrap: { padding: 16, backgroundColor: C.primary, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  title: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 10 },
  tabs: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, padding: 10, alignItems: "center", borderRadius: 8 },
  tabActive: { backgroundColor: "#fff" },
  tabTx: { color: "#e0e0e0", fontWeight: "600" },
  tabTxActive: { color: C.primary, fontWeight: "bold" },
  body: { padding: 16 },
  label: { fontWeight: "700", marginVertical: 8, color: C.text, fontSize: 13 },
  h3: { fontWeight: "900", color: C.text, fontSize: 17, marginBottom: 10 },
  select: { padding: 14, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: "#fff", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectTx: { color: C.text, fontWeight: '600' },
  inputBtn: { padding: 12, borderWidth: 1, borderColor: C.border, borderRadius: 10, backgroundColor: "#fff", flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 10, color: C.muted, marginBottom: 2 },
  dateVal: { fontWeight: '700', color: C.primaryDark },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, backgroundColor: "#fff", marginBottom: 5, fontSize: 16, color: C.text },
  inputBonus: { borderColor: C.primaryDark, borderWidth: 1.5 },
  card: { backgroundColor: "#fff", padding: 16, borderRadius: 14, elevation: 4, marginBottom: 12 },
  addOther: { color: C.primary, fontWeight: 'bold', marginVertical: 10, fontSize: 13 },
  breakdown: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, marginTop: 15, borderLeftWidth: 4, borderLeftColor: C.primaryDark },
  breakdownTitle: { fontSize: 10, fontWeight: '900', color: C.muted, marginBottom: 8, letterSpacing: 1 },
  totalBox: { backgroundColor: C.primarySoft, padding: 18, borderRadius: 12, alignItems: 'center', marginVertical: 15 },
  totalLabel: { color: C.primaryDark, fontWeight: "bold", fontSize: 12 },
  totalVal: { fontSize: 24, fontWeight: "900", color: C.primaryDark },
  btnPrimary: { backgroundColor: C.primary, padding: 16, borderRadius: 12, alignItems: "center", marginTop: 10 },
  btnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  segmentWrap: { flexDirection: 'row', backgroundColor: '#eee', borderRadius: 10, padding: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: '#fff', elevation: 2 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%' },
  modalClose: { color: 'red', textAlign: 'center', padding: 15, fontWeight: '700' },
  modalItem: { padding: 18, borderBottomWidth: 1, borderColor: '#f0f0f0' }
});