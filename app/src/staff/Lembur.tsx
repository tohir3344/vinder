// app/src/staff/Lembur.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
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

// Aktifin animasi buat Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// 🔥 KONSTANTA WARNA TEMA (MERAH #A51C24)
const PRIMARY = "#A51C24";
const PRIMARY_DIM = "#D67D82";
const PRIMARY_LIGHT = "#FDF2F2"; // Merah sangat muda untuk background badge/header
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

const UPAH_PER_JAM = 10_000;
const RATE_PER_MENIT = UPAH_PER_JAM / 60;
function upahFromMinutes(totalMenit: number): number {
  return Math.round((Math.max(0, totalMenit) * UPAH_PER_JAM) / 60);
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

const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = x.getDay();
  const diffToSaturday = (dow === 6) ? 7 : (dow + 1) % 7;
  x.setDate(x.getDate() - diffToSaturday);
  return x;
};

const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
};

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
  upahPerMenit: 120,
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
  COLS.upahPerMenit +
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

  function thisWeekRange() {
    const s = startOfWeek(new Date());
    const e = endOfWeek(new Date());
    return { start: toYmd(s), end: toYmd(e) };
  }
  const initWeek = thisWeekRange();
  const [start, setStart] = useState<string | undefined>(initWeek.start);
  const [end, setEnd] = useState<string | undefined>(initWeek.end);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filters = useMemo(() => ({ start, end }), [start, end]);

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
        const alasMasuk = r.alasan_masuk ?? r.alasanMasuk ?? r.alasan ?? "";
        const alasKeluar = r.alasan_keluar ?? r.alasanKeluar ?? "";
        const totalMenit = Number.isFinite(Number(r.total_menit))
          ? Number(r.total_menit)
          : Number(r.total_menit_masuk || 0) + Number(r.total_menit_keluar || 0);
        return {
          ...r,
          alasan_masuk: String(alasMasuk).trim(),
          alasan_keluar: String(alasKeluar).trim(),
          total_menit: totalMenit,
        };
      });
      const realLembur = normalized.filter((item: any) => item.total_menit > 0);
      setRows(realLembur);
      setSummary(res.summary ?? null);
    } catch (e: any) {
      setErr(e?.message || "Gagal memuat data lembur");
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, start, end]);

  const loadExtraData = useCallback(async (type: "weekly" | "monthly") => {
    if (!userId) return;
    setLoadingExtra(true);
    try {
      const range = type === "weekly" ? thisWeekRange() : thisMonthRange();
      const res = await getLemburList({ user_id: userId, start: range.start, end: range.end, limit: 300 });
      const mapped = (res.data ?? []).map((r: any) => ({
        ...r,
        alasan_masuk: String(r.alasan_masuk || r.alasanMasuk || r.alasan || "").trim(),
        alasan_keluar: String(r.alasan_keluar || r.alasanKeluar || "").trim(),
        total_menit: Number.isFinite(Number(r.total_menit))
          ? Number(r.total_menit)
          : Number(r.total_menit_masuk || 0) + Number(r.total_menit_keluar || 0)
      })).filter((r: any) => r.total_menit > 0);
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

  useEffect(() => {
    if (!userId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current!);
    debounceRef.current = setTimeout(() => load(), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current!); };
  }, [userId, filters, load]);

  const jamMingguHHMM = useMemo(() => {
    const m = rows.reduce((acc, r) => acc + Number(r.total_menit ?? 0), 0);
    return hhmmFromMinutes(m);
  }, [rows]);

  const weeklySubtotalUpah = useMemo(() => {
    const menit = rows.reduce((acc, r) => acc + Number(r.total_menit ?? 0), 0);
    return upahFromMinutes(menit);
  }, [rows]);

  const onRefresh = useCallback(() => {
    const wk = thisWeekRange();
    setStart(wk.start);
    setEnd(wk.end);
    setRefreshing(true);
    load();
    if (isHistoryExpanded) loadExtraData(filterType);
  }, [load, isHistoryExpanded, filterType]);

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

        <Text style={s.sectionLabel}>MINGGU BERJALAN (SAB - JUM)</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={{ width: TABLE_WIDTH }}>
            <TableHeader />
            {rows.map((item) => (
              <TableRow key={item.id} item={item} />
            ))}
            {rows.length === 0 && !loading && <Text style={s.empty}>Tidak ada data lembur minggu ini.</Text>}
            {loading && <ActivityIndicator style={{ marginTop: 10 }} color={PRIMARY} />}
          </View>
        </ScrollView>

        <View style={{ gap: 12, marginTop: 14 }}>
          <Card title="Upah Mingguan">
            <View style={s.kpiWrap}>
              <Badge label={`Tarif/menit: Rp ${formatIDRDec(RATE_PER_MENIT, 2)}`} />
              <Badge label={`Total jam: ${jamMingguHHMM}`} />
              <Badge label={`Total upah: Rp ${formatIDR(weeklySubtotalUpah)}`} />
            </View>
          </Card>
        </View>

        <View style={s.accordionCard}>
          <Pressable onPress={toggleAccordion} style={s.accordionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isHistoryExpanded ? "chevron-down" : "chevron-forward"} size={20} color={PRIMARY} />
              <Text style={s.accordionTitle}>RIWAYAT LAINNYA</Text>
            </View>
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeText}>{filterType === 'weekly' ? '7 Hari' : 'Bulan Ini'}</Text>
            </View>
          </Pressable>

          {isHistoryExpanded && (
            <View style={{ marginTop: 15 }}>
              <View style={s.tabRow}>
                <Pressable onPress={() => { setFilterType("weekly"); loadExtraData("weekly"); }} style={[s.tabItem, filterType === "weekly" && s.tabItemActive]}>
                  <Text style={[s.tabText, filterType === "weekly" && s.tabTextActive]}>Mingguan</Text>
                </Pressable>
                <Pressable onPress={() => { setFilterType("monthly"); loadExtraData("monthly"); }} style={[s.tabItem, filterType === "monthly" && s.tabItemActive]}>
                  <Text style={[s.tabText, filterType === "monthly" && s.tabTextActive]}>Bulanan</Text>
                </Pressable>
              </View>

              {loadingExtra ? (
                <ActivityIndicator color={PRIMARY} style={{ marginVertical: 20 }} />
              ) : (
                <View>
                  {extraRows.map((item, idx) => {
                    const menit = Number(item.total_menit ?? 0);
                    return (
                      <View key={idx} style={s.extraRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.extraDate}>{new Date(item.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                          <Text style={s.extraSub} numberOfLines={1}>{item.alasan_masuk || item.alasan_keluar || "Lembur"}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.extraTime}>{hhmmFromMinutes(menit)} Jam</Text>
                          <Text style={s.extraMoney}>Rp {formatIDR(upahFromMinutes(menit))}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {extraRows.length === 0 && <Text style={s.emptySmall}>Belum ada riwayat lembur bray.</Text>}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={m.overlay}>
          <View style={[m.box, { maxHeight: "70%" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Text style={m.title}>Info Lembur</Text>
              <Pressable onPress={() => setShowInfo(false)}><Ionicons name="close" size={24} color="#666" /></Pressable>
            </View>
            <ScrollView style={{ marginBottom: 10 }}>
              <Text style={m.infoItem}>💰 <Text style={{ fontWeight: "bold" }}>Tarif:</Text> Rp 10.000 / jam.</Text>
              <Text style={m.infoItem}>📅 <Text style={{ fontWeight: "bold" }}>Periode:</Text> Sabtu s/d Jumat.</Text>
              <Text style={m.infoItem}>📂 <Text style={{ fontWeight: "bold" }}>Riwayat:</Text> Cek riwayat lama di bagian bawah bray.</Text>
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

function TableHeader() {
  return (
    <View style={[s.thead, { width: TABLE_WIDTH }]}>
      <Text style={th(COLS.tanggal)}>Tanggal</Text>
      <Text style={th(COLS.jamMasuk)}>Jam Masuk</Text>
      <Text style={th(COLS.jamKeluar)}>Jam Keluar</Text>
      <Text style={th(COLS.alasanMasuk)}>Alasan Masuk</Text>
      <Text style={th(COLS.alasanKeluar)}>Alasan Keluar</Text>
      <Text style={th(COLS.totalMenit)}>Total Menit</Text>
      <Text style={th(COLS.totalJam)}>Total Jam</Text>
      <Text style={th(COLS.upahPerMenit)}>Upah/menit</Text>
      <Text style={th(COLS.totalUpah)}>Total Upah</Text>
    </View>
  );
}

function TableRow({ item }: { item: LemburRow }) {
  const menit = Number(item.total_menit ?? 0);
  return (
    <View style={[s.trow, { width: TABLE_WIDTH }]}>
      <Text style={td(COLS.tanggal)}>{item.tanggal}</Text>
      <Text style={td(COLS.jamMasuk)}>{item.jam_masuk ?? "-"}</Text>
      <Text style={td(COLS.jamKeluar)}>{item.jam_keluar ?? "-"}</Text>
      <Text style={td(COLS.alasanMasuk)} numberOfLines={1}>{item.alasan_masuk || "-"}</Text>
      <Text style={td(COLS.alasanKeluar)} numberOfLines={1}>{item.alasan_keluar || "-"}</Text>
      <Text style={td(COLS.totalMenit)}>{menit}</Text>
      <Text style={td(COLS.totalJam)}>{hhmmFromMinutes(menit)}</Text>
      <Text style={td(COLS.upahPerMenit)}>Rp {formatIDRDec(RATE_PER_MENIT, 2)}</Text>
      <Text style={td(COLS.totalUpah)}>Rp {formatIDR(upahFromMinutes(menit))}</Text>
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
  sectionLabel: { fontSize: 11, fontWeight: "900", color: "#64748B", marginTop: 10, letterSpacing: 0.5 },
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
  emptySmall: { textAlign: 'center', color: '#94A3B8', fontSize: 12, marginTop: 10 }
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