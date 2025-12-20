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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLemburList, type LemburRow, type LemburSummary } from "../../../services/lembur";
import { Ionicons } from "@expo/vector-icons";

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

/* ===== Konstanta & util upah lembur ===== */
const UPAH_PER_JAM = 10_000;
const RATE_PER_MENIT = UPAH_PER_JAM / 60; // ≈ 166.666...
function upahFromMinutes(totalMenit: number): number {
  return Math.round((Math.max(0, totalMenit) * UPAH_PER_JAM) / 60);
}

/* ===== Util waktu ===== */
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

// 🔥 [RHEZA FIX] LOGIC CARRY-OVER SABTU 🔥
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0); // Bersihkan sisa jam
  const dow = x.getDay(); // 0=Minggu, 1=Senin ... 6=Sabtu

  /**
   * Syarat Rheza: Data minggu lalu tetap ada sampai Sabtu 23:59.
   * Kalau hari Sabtu (6), kita mundur 7 hari (ke Sabtu minggu lalu).
   * Kalau hari Minggu-Jumat, mundur ke Sabtu terdekat.
   */
  const diffToSaturday = (dow === 6) ? 7 : (dow + 1) % 7;

  x.setDate(x.getDate() - diffToSaturday);
  return x;
};

const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6); // Sabtu + 6 = Jumat
  e.setHours(23, 59, 59, 999);
  return e;
};

/* ===== Kolom tabel (DIJAGA UTUH) ===== */
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
    } catch {
      /* ignore */
    }
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

  // State Modal Info
  const [showInfo, setShowInfo] = useState(false);

  // Filter API: kunci ke MINGGU BERJALAN (SABTU - JUMAT)
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
        const alasMasuk = r.alasan_masuk ?? r.alasanMasuk ?? r.alasan ?? r.alasan_masuk_text ?? "";
        const alasKeluar = r.alasan_keluar ?? r.alasanKeluar ?? r.alasan_keluar_text ?? r.alasanKeluarText ?? "";

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

      const realLembur = normalized.filter((item) => item.total_menit > 0);
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

  useEffect(() => {
    if (userId) load();
  }, [userId, load]);

  useEffect(() => {
    if (!userId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current!);
    debounceRef.current = setTimeout(() => load(), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current!);
    };
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
  }, [load]);

  if (initializing) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8 }}>Menyiapkan sesi…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!userId) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.page}>
          <Text style={s.title}>Lembur Saya</Text>
          <View style={s.errBox}>
            <Text style={s.errText}>{err ?? "Anda belum login. Silakan login ulang."}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.page}>
        <View style={s.headerRow}>
          <Text style={s.title}>Lembur Saya</Text>
          <Pressable onPress={() => setShowInfo(true)} style={s.infoBtn}>
            <Ionicons name="information-circle-outline" size={24} color="#0B57D0" />
          </Pressable>
        </View>

        {err && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={{ width: TABLE_WIDTH }}>
            <FlatList
              style={{ marginTop: 12 }}
              data={rows}
              keyExtractor={(it) => String(it.id)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              stickyHeaderIndices={[0]}
              ListHeaderComponent={<TableHeader />}
              renderItem={({ item }) => <TableRow item={item} />}
              ListEmptyComponent={!loading ? <Text style={s.empty}>Tidak ada data lembur minggu ini.</Text> : null}
              contentContainerStyle={{ paddingBottom: 12 }}
            />
          </View>
        </ScrollView>

        <View style={{ gap: 12, marginTop: 14, marginBottom: Platform.OS === "ios" ? 10 : 4 }}>
          <Card title="Upah Mingguan">
            <View style={s.kpiWrap}>
              <Badge label={`Tarif/menit: Rp ${formatIDRDec(RATE_PER_MENIT, 2)}`} />
              <Badge label={`Total jam (minggu ini): ${jamMingguHHMM}`} />
              <Badge label={`Total upah: Rp ${formatIDR(weeklySubtotalUpah)}`} />
            </View>
          </Card>
        </View>
      </View>

      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={m.overlay}>
          <View style={[m.box, { maxHeight: "70%" }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <Text style={m.title}>Info Lembur</Text>
              <Pressable onPress={() => setShowInfo(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </Pressable>
            </View>
            <ScrollView style={{ marginBottom: 10 }}>
              <Text style={m.infoItem}>💰 <Text style={{ fontWeight: "bold" }}>Tarif:</Text> Rp 10.000 / jam (dihitung per menit).</Text>
              <Text style={m.infoItem}>📅 <Text style={{ fontWeight: "bold" }}>Periode:</Text> Perhitungan dimulai hari Sabtu s/d Jumat.</Text>
              <Text style={m.infoItem}>⏱️ <Text style={{ fontWeight: "bold" }}>Hitungan:</Text> Lembur dihitung dari selisih jam kerja normal.</Text>
              <Text style={m.infoItem}>🔄 <Text style={{ fontWeight: "bold" }}>Reset:</Text> Data di halaman ini otomatis reset setiap hari Minggu jam 00:00 (Periode Baru).</Text>
            </ScrollView>
            <Pressable onPress={() => setShowInfo(false)} style={[m.btn, { backgroundColor: "#2196F3", width: "100%", alignItems: "center" }]}>
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

function TableRow({ item }: { item: any }) {
  const menit = Number(item.total_menit ?? 0);
  const upah = upahFromMinutes(menit);
  const jamHHMM = hhmmFromMinutes(menit);
  const alasanMasuk = item.alasan_masuk ?? item.alasan ?? "";
  const alasanKeluar = item.alasan_keluar ?? item.alasanKeluar ?? "";

  return (
    <View style={[s.trow, { width: TABLE_WIDTH }]}>
      <Text style={td(COLS.tanggal)}>{item.tanggal}</Text>
      <Text style={td(COLS.jamMasuk)}>{item.jam_masuk ?? "-"}</Text>
      <Text style={td(COLS.jamKeluar)}>{item.jam_keluar ?? "-"}</Text>
      <Text style={td(COLS.alasanMasuk)} numberOfLines={1}>{alasanMasuk || "-"}</Text>
      <Text style={td(COLS.alasanKeluar)} numberOfLines={1}>{alasanKeluar || "-"}</Text>
      <Text style={td(COLS.totalMenit)}>{menit}</Text>
      <Text style={td(COLS.totalJam)}>{jamHHMM}</Text>
      <Text style={td(COLS.upahPerMenit)}>Rp {formatIDRDec(RATE_PER_MENIT, 2)}</Text>
      <Text style={td(COLS.totalUpah)}>Rp {formatIDR(upah)}</Text>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Badge({ label }: { label: string }) {
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  page: { flex: 1, backgroundColor: "#F8FAFC", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "800", color: "#0B57D0" },
  infoBtn: { padding: 4 },
  errBox: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },
  errText: { color: "#B91C1C" },
  thead: { backgroundColor: "#EEF3FF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#DBE5FF", flexDirection: "row", gap: 8, alignItems: "center" },
  trow: { backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 10, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#EEF1F6", flexDirection: "row", gap: 8, alignItems: "center" },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 18 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EEF1F6" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 8 },
  kpiWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  badge: { backgroundColor: "#EEF3FF", borderWidth: 1, borderColor: "#DBE5FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: "#1D4ED8", fontWeight: "600", fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 400, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontWeight: "800", fontSize: 18, marginBottom: 8, color: "#111827" },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "800" },
  infoItem: { marginBottom: 10, color: "#374151", lineHeight: 20, fontSize: 14 },
});

function th(width: number) { return { width, fontWeight: "800", color: "#1E3A8A", fontSize: 12 } as const; }
function td(width: number) { return { width, color: "#111827", fontSize: 13 } as const; }