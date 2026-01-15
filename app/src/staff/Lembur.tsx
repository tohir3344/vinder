import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Platform,
  Modal,
  Pressable,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
// @ts-ignore
import { getLemburList, type LemburSummary } from "../../../services/lembur";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 🔥 KONSTANTA WARNA TEMA
const PRIMARY = "#A51C24";
const PRIMARY_DIM = "#D67D82";
const PRIMARY_LIGHT = "#FDF2F2";
const PRIMARY_BORDER = "#FAD2D2";

type LemburRow = {
  id: number | string;
  tanggal: string;
  jam_masuk: string | null;
  jam_keluar: string | null;
  alasan_masuk?: string;
  alasan_keluar?: string;
  total_menit: number;
  total_jam?: string;
  total_upah?: number;
  jenis_lembur?: string;
};

/* ===== Util formatting ===== */
function formatIDR(x: number) {
  try {
    return new Intl.NumberFormat("id-ID").format(x);
  } catch {
    return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}
function formatIDRDec(x: number, decimals = 2) {
  try {
    return new Intl.NumberFormat("id-ID", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(x);
  } catch {
    return Number(x).toFixed(decimals).replace(".", ",");
  }
}

function hhmmFromMinutes(totalMenit: number): string {
  const m = Math.max(0, Math.floor(totalMenit || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}`;
}

function toYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Fungsi bantu cari hari Sabtu terdekat sebelumnya
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay(); // 0 (Sun) - 6 (Sat)
  const diffToSaturday = (dow === 6) ? 0 : (dow + 1);
  x.setDate(x.getDate() - diffToSaturday);
  return x;
};

const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6); // Sabtu + 6 hari = Jumat
  e.setHours(23, 59, 59, 999);
  return e;
};

// MINGGU LALU (Sabtu - Jumat sebelumnya)
function lastWeekRange() {
  const d = new Date();
  d.setDate(d.getDate() - 7); 
  const s = startOfWeek(d);
  const e = endOfWeek(d);
  return { start: toYmd(s), end: toYmd(e) };
}

// MINGGU INI (Sabtu - Jumat sekarang)
function thisWeekRange() {
  const d = new Date();
  const s = startOfWeek(d);
  const e = endOfWeek(d);
  return { start: toYmd(s), end: toYmd(e) };
}

function thisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toYmd(start), end: toYmd(end) };
}

const COLS = {
  tanggal: 110,
  jamMasuk: 100,
  jamKeluar: 100,
  alasanMasuk: 220,
  alasanKeluar: 220,
  totalMenit: 90,
  totalJam: 100,
  upahPerJam: 140,
  jenis: 90,
  totalUpah: 160,
};

const TABLE_WIDTH =
  COLS.tanggal +
  COLS.jamMasuk +
  COLS.jamKeluar +
  COLS.alasanMasuk +
  COLS.alasanKeluar +
  COLS.totalMenit +
  COLS.totalJam +
  COLS.upahPerJam +
  COLS.jenis +
  COLS.totalUpah;

async function getCurrentUserIdFromStorage(): Promise<number | null> {
  const candidateKeys = ["user_id", "id_user", "userId", "user", "profile", "account", "auth_user", "auth"];
  for (const key of candidateKeys) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    if (/^\d+$/.test(raw)) {
      const id = parseInt(raw, 10);
      if (id > 0) return id;
      continue;
    }
    try {
      const obj = JSON.parse(raw);
      const cand = [obj?.user_id, obj?.id_user, obj?.id, obj?.user?.id, obj?.data?.id];
      for (const c of cand) {
        const id = typeof c === "string" ? parseInt(c, 10) : Number(c);
        if (Number.isInteger(id) && id > 0) return id;
      }
    } catch { }
  }
  return null;
}

export default function LemburScreen() {
  const [userId, setUserId] = useState<number | null>(null);
  const [upahPerJam, setUpahPerJam] = useState<number>(0);
  const [rows, setRows] = useState<LemburRow[]>([]);
  const [summary, setSummary] = useState<LemburSummary | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  
  const [filterType, setFilterType] = useState<"weekly" | "monthly">("weekly");
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [extraRows, setExtraRows] = useState<LemburRow[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const ratePerMenit = upahPerJam / 60;

  // 🔥 DEFAULT: Sekarang set ke MINGGU INI (Sesuai request Rheza)
  const rangeMingguIni = useMemo(() => thisWeekRange(), []);
  const [start, setStart] = useState<string | undefined>(rangeMingguIni.start);
  const [end, setEnd] = useState<string | undefined>(rangeMingguIni.end);

  const fetchUserRate = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}auth/get_user_detail.php?id=${id}`);
      const data = await res.json();
      if (data.success && data.data.lembur) {
        setUpahPerJam(Number(data.data.lembur));
      } else {
        setUpahPerJam(10000);
      }
    } catch {
      setUpahPerJam(10000);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        setInitializing(true);
        const id = await getCurrentUserIdFromStorage();
        if (!id) {
          setErr("Anda belum login. Silakan login ulang.");
          setUserId(null);
        } else {
          setUserId(id);
          await fetchUserRate(id);
        }
      } catch (e: any) {
        setErr(e?.message || "Gagal membaca sesi pengguna");
        setUserId(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setErr(null);
      setLoading(true);
      const res = await getLemburList({ user_id: userId, start, end, limit: 300 });

      const normalized = (res.data ?? []).map((r: any) => {
        const totalMenit = Number.isFinite(Number(r.total_menit))
          ? Number(r.total_menit)
          : Number(r.total_menit_masuk || 0) + Number(r.total_menit_keluar || 0);

        return {
          ...r,
          alasan_masuk: String(r.alasan_masuk ?? r.alasanMasuk ?? r.alasan ?? "").trim(),
          alasan_keluar: String(r.alasan_keluar ?? r.alasanKeluar ?? "").trim(),
          total_menit: totalMenit,
          total_upah: Number(r.total_upah || 0),
          jenis_lembur: r.jenis_lembur ? String(r.jenis_lembur) : "biasa",
        };
      });

      const realLembur = normalized.filter((item: any) => item.total_menit > 0);
      setRows(realLembur);
      setSummary(res.summary ?? null);
    } catch (e: any) {
      setErr(e?.message || "Gagal memuat data lembur");
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, start, end]);

  const loadExtraData = useCallback(async (type: "weekly" | "monthly") => {
    if (!userId) return;
    setLoadingExtra(true);
    try {
      // 🔥 Logic Ditukar: Kalau weekly di accordion, nampilin MINGGU LALU
      const range = type === "weekly" ? lastWeekRange() : thisMonthRange();
      const res = await getLemburList({ user_id: userId, start: range.start, end: range.end, limit: 300 });

      const mapped = (res.data ?? []).map((r: any) => {
        const totalMenit = Number.isFinite(Number(r.total_menit))
          ? Number(r.total_menit)
          : Number(r.total_menit_masuk || 0) + Number(r.total_menit_keluar || 0);

        return {
          ...r,
          alasan_masuk: String(r.alasan_masuk || r.alasanMasuk || r.alasan || "").trim(),
          alasan_keluar: String(r.alasan_keluar || r.alasanKeluar || "").trim(),
          total_menit: totalMenit,
          total_upah: Number(r.total_upah || 0),
          jenis_lembur: r.jenis_lembur ? String(r.jenis_lembur) : "biasa",
        };
      }).filter((r: any) => r.total_menit > 0);

      setExtraRows(mapped);
    } catch (e) {
      setExtraRows([]);
    } finally {
      setLoadingExtra(false);
    }
  }, [userId]);

  const toggleAccordion = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isHistoryExpanded) loadExtraData(filterType);
    setIsHistoryExpanded(!isHistoryExpanded);
  };

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  const jamMingguHHMM = useMemo(() => {
    const m = rows.reduce((acc, r) => acc + Number(r.total_menit ?? 0), 0);
    return hhmmFromMinutes(m);
  }, [rows]);

  const weeklySubtotalUpah = useMemo(() => {
    return rows.reduce((acc, r) => acc + Number(r.total_upah || 0), 0);
  }, [rows]);

  const onRefresh = useCallback(() => {
    // 🔥 Refresh set ke Minggu Ini
    const wk = thisWeekRange(); 
    setStart(wk.start);
    setEnd(wk.end);
    setRefreshing(true);
    if (userId) {
        fetchUserRate(userId);
        load();
        if (isHistoryExpanded) loadExtraData(filterType);
    }
  }, [load, isHistoryExpanded, filterType, userId]);

  if (initializing) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color={PRIMARY} />
          <Text style={{ marginTop: 8 }}>Menyiapkan sesi…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />}
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        <View style={s.headerRow}>
          <Text style={s.title}>Lembur Saya</Text>
          <Pressable onPress={() => setShowInfo(true)} style={s.infoBtn}>
            <Ionicons name="information-circle-outline" size={24} color={PRIMARY} />
          </Pressable>
        </View>

        {err && <View style={s.errBox}><Text style={s.errText}>{err}</Text></View>}

        {/* 🔥 LABEL MINGGU INI */}
        <View style={s.rangeInfo}>
            <Text style={s.sectionLabel}>REKAP MINGGU INI</Text>
            <Text style={s.dateRangeText}>{start} s/d {end}</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={{ width: TABLE_WIDTH }}>
            <TableHeader />
            {rows.map((item) => (
              <TableRow key={item.id} item={item} ratePerMenit={ratePerMenit} />
            ))}
            {rows.length === 0 && !loading && <Text style={s.empty}>Belum ada data lembur di minggu ini.</Text>}
            {loading && <ActivityIndicator style={{ marginTop: 10 }} color={PRIMARY} />}
          </View>
        </ScrollView>

        <View style={{ gap: 12, marginTop: 14 }}>
          <Card title="Estimasi Upah">
            <View style={s.kpiWrap}>
              <Badge label={`Tarif/jam: Rp ${formatIDR(upahPerJam)}`} />
              <Badge label={`Total jam: ${jamMingguHHMM}`} />
              <Badge label={`Total upah: Rp ${formatIDR(weeklySubtotalUpah)}`} />
            </View>
          </Card>
        </View>

        <View style={s.accordionCard}>
          <Pressable onPress={toggleAccordion} style={s.accordionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isHistoryExpanded ? "chevron-down" : "chevron-forward"} size={20} color={PRIMARY} />
              <Text style={s.accordionTitle}>CEK PERIODE LAIN</Text>
            </View>
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeText}>{filterType === 'weekly' ? 'Minggu Lalu' : 'Bulan Ini'}</Text>
            </View>
          </Pressable>

          {isHistoryExpanded && (
            <View style={{ marginTop: 15 }}>
              <View style={s.tabRow}>
                <Pressable onPress={() => { setFilterType("weekly"); loadExtraData("weekly"); }} style={[s.tabItem, filterType === "weekly" && s.tabItemActive]}>
                  <Text style={[s.tabText, filterType === "weekly" && s.tabTextActive]}>Minggu Lalu</Text>
                </Pressable>
                <Pressable onPress={() => { setFilterType("monthly"); loadExtraData("monthly"); }} style={[s.tabItem, filterType === "monthly" && s.tabItemActive]}>
                  <Text style={[s.tabText, filterType === "monthly" && s.tabTextActive]}>Bulan Ini</Text>
                </Pressable>
              </View>

              {loadingExtra ? (
                <ActivityIndicator color={PRIMARY} style={{ marginVertical: 20 }} />
              ) : (
                <View>
                  {extraRows.map((item, idx) => {
                    const menit = Number(item.total_menit ?? 0);
                    const isOver = item.jenis_lembur?.toLowerCase() === 'over';
                    return (
                      <View key={idx} style={s.extraRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.extraDate}>{new Date(item.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                          <Text style={s.extraSub} numberOfLines={1}>{item.alasan_masuk || item.alasan_keluar || "Lembur"}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.extraTime}>{hhmmFromMinutes(menit)} Jam</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text style={{ fontSize: 10, fontWeight: 'bold', color: isOver ? '#16a34a' : '#94a3b8' }}>
                              {isOver ? 'LANJUTAN' : 'BIASA'}
                            </Text>
                            <Text style={s.extraMoney}>Rp {formatIDR(Number(item.total_upah || 0))}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {extraRows.length === 0 && <Text style={s.emptySmall}>Belum ada riwayat di periode ini.</Text>}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* MODAL INFO */}
      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={m.overlay}>
          <View style={[m.box, { maxHeight: "70%" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Text style={m.title}>Info Lembur</Text>
              <Pressable onPress={() => setShowInfo(false)}><Ionicons name="close" size={24} color="#666" /></Pressable>
            </View>
            <ScrollView style={{ marginBottom: 10 }}>
              <Text style={m.infoItem}>💰 <Text style={{ fontWeight: "bold" }}>Tarif Lu:</Text> Rp {formatIDR(upahPerJam)} / jam.</Text>
              <Text style={m.infoItem}>🕒 <Text style={{ fontWeight: "bold" }}>Per Menit:</Text> Rp {formatIDRDec(ratePerMenit, 2)} / menit.</Text>
              <Text style={m.infoItem}>📅 <Text style={{ fontWeight: "bold" }}>Siklus:</Text> Sabtu s/d Jumat.</Text>
              <Text style={m.infoItem}>ℹ️ <Text style={{ fontWeight: "bold" }}>Tampilan:</Text> Tabel atas menampilkan riwayat minggu ini yang sedang berjalan. Cek periode lain untuk lihat minggu lalu.</Text>
            </ScrollView>
            <Pressable onPress={() => setShowInfo(false)} style={[m.btn, { backgroundColor: PRIMARY, width: "100%", alignItems: "center" }]}>
              <Text style={m.btnText}>Mengerti</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Komponen Pendukung
function TableHeader() {
  return (
    <View style={[s.thead, { width: TABLE_WIDTH }]}>
      <Text style={th(COLS.tanggal)}>Tanggal</Text>
      <Text style={th(COLS.jamMasuk)}>Masuk</Text>
      <Text style={th(COLS.jamKeluar)}>Keluar</Text>
      <Text style={th(COLS.alasanMasuk)}>Alasan Masuk</Text>
      <Text style={th(COLS.alasanKeluar)}>Alasan Keluar</Text>
      <Text style={th(COLS.totalMenit)}>Menit</Text>
      <Text style={th(COLS.totalJam)}>Total Jam</Text>
      <Text style={th(COLS.upahPerJam)}>Rate/Jam</Text>
      <Text style={th(COLS.jenis)}>Jenis</Text>
      <Text style={th(COLS.totalUpah)}>Upah</Text>
    </View>
  );
}

function TableRow({ item, ratePerMenit }: { item: LemburRow; ratePerMenit: number }) {
  const mnt = Number(item.total_menit ?? 0);
  const isOver = item.jenis_lembur?.toLowerCase() === 'over';
  const hourlyRate = ratePerMenit * 60;

  return (
    <View style={[s.trow, { width: TABLE_WIDTH }]}>
      <Text style={td(COLS.tanggal)}>{item.tanggal}</Text>
      <Text style={td(COLS.jamMasuk)}>{item.jam_masuk ?? "-"}</Text>
      <Text style={td(COLS.jamKeluar)}>{item.jam_keluar ?? "-"}</Text>
      <Text style={td(COLS.alasanMasuk)} numberOfLines={1}>{item.alasan_masuk || "-"}</Text>
      <Text style={td(COLS.alasanKeluar)} numberOfLines={1}>{item.alasan_keluar || "-"}</Text>
      <Text style={td(COLS.totalMenit)}>{mnt}</Text>
      <Text style={td(COLS.totalJam)}>{hhmmFromMinutes(mnt)}</Text>
      <View style={[td(COLS.upahPerJam), { flexDirection: 'row', alignItems: 'center' }]}>
        <Text style={{ fontSize: 13 }}>Rp {formatIDR(hourlyRate)}</Text>
        {isOver && <Text style={{ fontSize: 10, color: '#16a34a', fontWeight: 'bold' }}> (x2)</Text>}
      </View>
      <Text style={[td(COLS.jenis), { color: isOver ? '#16a34a' : '#64748b', fontWeight: 'bold' }]}>
        {isOver ? "LANJUTAN" : "BIASA"}
      </Text>
      <Text style={[td(COLS.totalUpah), { fontWeight: '700' }]}>Rp {formatIDR(Number(item.total_upah || 0))}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>;
}
function Badge({ label }: { label: string }) {
  return <View style={s.badge}><Text style={s.badgeText}>{label}</Text></View>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  page: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "800", color: PRIMARY },
  rangeInfo: { marginTop: 10, marginBottom: 5 },
  sectionLabel: { fontSize: 11, fontWeight: "900", color: "#64748B", letterSpacing: 0.5 },
  dateRangeText: { fontSize: 12, color: PRIMARY, fontWeight: "700" },
  infoBtn: { padding: 4 },
  errBox: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },
  errText: { color: "#B91C1C" },
  thead: { backgroundColor: PRIMARY_LIGHT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: PRIMARY_BORDER, flexDirection: "row", gap: 8, alignItems: "center" },
  trow: { backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 10, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#EEF1F6", flexDirection: "row", gap: 8, alignItems: "center" },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 18 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EEF1F6" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 8 },
  kpiWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  badge: { backgroundColor: PRIMARY_LIGHT, borderWidth: 1, borderColor: PRIMARY_BORDER, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: PRIMARY, fontWeight: "600", fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabRow: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 4, marginBottom: 15 },
  tabItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabItemActive: { backgroundColor: '#FFFFFF', elevation: 2 },
  tabText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  tabTextActive: { color: PRIMARY },
  accordionCard: { marginTop: 16, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2, borderWidth: 1, borderColor: "#E2E8F0" },
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accordionTitle: { color: "#0F172A", fontWeight: "800", fontSize: 14, marginLeft: 4 },
  filterBadge: { backgroundColor: PRIMARY_LIGHT, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  filterBadgeText: { fontSize: 10, fontWeight: '800', color: PRIMARY },
  extraRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  extraDate: { color: "#1E293B", fontWeight: "700", fontSize: 13 },
  extraSub: { color: "#64748B", fontSize: 11, marginTop: 2 },
  extraTime: { fontWeight: "800", color: PRIMARY, fontSize: 13 },
  extraMoney: { color: "#10B981", fontSize: 11, fontWeight: "700", marginTop: 2 },
  emptySmall: { textAlign: 'center', color: '#94A3B8', fontSize: 12, marginTop: 10 },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 400, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontWeight: "800", fontSize: 18, marginBottom: 8, color: "#111827" },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "800" },
  infoItem: { marginBottom: 10, color: "#374151", lineHeight: 20, fontSize: 14 },
});

function th(width: number) { return { width, fontWeight: "800", color: PRIMARY, fontSize: 12 } as const; }
function td(width: number) { return { width, color: "#111827", fontSize: 13 } as const; }