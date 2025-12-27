// app/src/staff/Absen.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "../../config";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons"; // PERBAIKAN DI SINI
import {
  logInfo,
  logWarn,
  logError,
  installGlobalErrorHandler,
  getLogFileUri,
} from "../utils/logger";

// Aktifin animasi buat Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Log = { tanggal: string; jam_masuk: string | null; jam_keluar: string | null };

const PROSES_ABSEN_PATH = "/src/staff/ProsesAbsen" as const;

/* ===== WARNA MERAH (#A51C24) ===== */
const PRIMARY = "#A51C24";
const PRIMARY_DIM = "#D67D82";
const DANGER = "#CC3A3A";

/* ===== Utility ===== */
function todayLocalKey(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

const fmtYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function startOfSaturdayWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = (day === 6) ? 7 : (day + 1);
  x.setDate(x.getDate() - diff);
  return x;
}

function thisWeekRange() {
  const s = startOfSaturdayWeek(new Date());
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return { start: fmtYMD(s), end: fmtYMD(e) };
}

function lastWeekRange() {
  const s = startOfSaturdayWeek(new Date());
  s.setDate(s.getDate() - 7);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return { start: fmtYMD(s), end: fmtYMD(e) };
}

function getSpecificMonthRange(monthKey: string) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { start: fmtYMD(start), end: fmtYMD(end) };
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 8000) {
  if (typeof AbortController === "undefined") {
    return fetch(url, opts);
  }
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function getJson(url: string) {
  const res = await fetchWithTimeout(url);
  const txt = await res.text();
  let j: any;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`Bukan JSON (${res.status})`);
  }
  if (!res.ok || j?.success === false)
    throw new Error(j?.message || `HTTP ${res.status}`);
  return j;
}

const OFFICES: OfficePoint[] = [
  { id: "PT-A", name: "PT Vinder Wynart Indonesia", lat: -6.31375, lng: 107.02238, radius: 150 },
  { id: "PT-B", name: "PT Vinder Wynart Indonesia / brondong", lat: -7.57438, lng: 109.92092, radius: 150 },
];

type OfficePoint = { id: string; name: string; lat: number; lng: number; radius: number };

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestOffice(here: { lat: number; lng: number }) {
  let best: { office: OfficePoint; dist: number } | null = null;
  for (const o of OFFICES) {
    const d = distanceMeters(here, { lat: o.lat, lng: o.lng });
    if (!best || d < best.dist) best = { office: o, dist: d };
  }
  return best;
}

async function ensureInsideAnyOffice(): Promise<{ ok: boolean; nearest?: { office: OfficePoint; dist: number } }> {
  try {
    const serviceOn = await Location.hasServicesEnabledAsync();
    if (!serviceOn) {
      Alert.alert("Lokasi mati", "Aktifkan layanan lokasi (GPS) dulu.");
      return { ok: false };
    }

    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted" && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== "granted") {
      Alert.alert("Izin lokasi ditolak", "Izin lokasi diperlukan untuk absensi.");
      return { ok: false };
    }

    let pos = await Location.getLastKnownPositionAsync();
    if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });

    const here = { lat: pos!.coords.latitude, lng: pos!.coords.longitude };
    const best = nearestOffice(here);

    if (!best) {
      Alert.alert("Konfigurasi lokasi kosong", "Lokasi kantor belum dikonfigurasi.");
      return { ok: false };
    }

    const allowed = best.dist <= best.office.radius;

    if (!allowed) {
      const info = OFFICES.map((o) => {
        const d = Math.round(distanceMeters(here, { lat: o.lat, lng: o.lng }));
        return `• ${o.name}: ±${d} m (maks ${o.radius} m)`;
      }).join("\n");
      Alert.alert("Di luar area PT", `Anda berada di luar radius kantor.\n\n${info}`);
    }

    return { ok: allowed, nearest: best };
  } catch (e: any) {
    Alert.alert("Lokasi error", "Gagal membaca lokasi.");
    return { ok: false };
  }
}

let GRACE_MINUTES = 0;

function normalizeHMS(x?: string | null) {
  const s = (x || "").trim();
  if (!s) return "00:00:00";
  const parts = s.split(":");
  if (parts.length === 2) return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:00`;
  if (parts.length >= 3) return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}:${parts[2].padStart(2, "0")}`;
  return "00:00:00";
}

function toSeconds(hhmmss: string) {
  const [hh = "0", mm = "0", ss = "0"] = hhmmss.split(":");
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function secondsNowLocal(d = new Date()) {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export default function Absen() {
  const [userId, setUserId] = useState<number | null>(null);
  const [booting, setBooting] = useState(true);
  const [now, setNow] = useState(new Date());
  const todayKey = useMemo(() => todayLocalKey(now), [now]);
  const isSunday = now.getDay() === 0;
  const [today, setToday] = useState<Log>({ tanggal: todayKey, jam_masuk: null, jam_keluar: null });
  const [history, setHistory] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);
  const [workStart, setWorkStart] = useState<string>("07:30:00");
  const [workEnd, setWorkEnd] = useState<string>("17:30:00");
  const [showReason, setShowReason] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [pendingType, setPendingType] = useState<"masuk" | "keluar" | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [filterType, setFilterType] = useState<'weekly' | 'monthly'>('weekly');
  const [extraHistory, setExtraHistory] = useState<Log[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const monthOptions = useMemo(() => {
    const opts = [];
    const d = new Date();
    for (let i = 0; i < 6; i++) {
      const past = new Date(d.getFullYear(), d.getMonth() - i, 1);
      opts.push({
        label: past.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
        value: `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, "0")}`,
      });
    }
    return opts;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        let auth = raw ? JSON.parse(raw) : null;
        setUserId(auth?.user_id ?? auth?.id ?? null);
      } catch (e) { setUserId(null); } finally { setBooting(false); }
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isOutsideWorkingNow = useCallback((action: "masuk" | "keluar", d = new Date()) => {
    const nowS = secondsNowLocal(d);
    const start = toSeconds(workStart);
    const end = toSeconds(workEnd);
    return action === "masuk" ? nowS < start : nowS > end;
  }, [workStart, workEnd]
  );

  const workingRangeLabel = useCallback(() => `${workStart.slice(0, 5)} - ${workEnd.slice(0, 5)}`, [workStart, workEnd]);

  const loadData = useCallback(async (uid: number) => {
    setLoading(true);
    try {
      const cfg = await getJson(`${API_BASE}lembur/lembur_list.php?action=config`);
      setWorkStart(normalizeHMS(cfg?.start_cutoff) || "07:30:00");
      setWorkEnd(normalizeHMS(cfg?.end_cutoff) || "17:30:00");

      const j1 = await getJson(`${API_BASE}absen/today.php?user_id=${uid}`);
      setToday({
        tanggal: j1.data?.tanggal ?? todayKey,
        jam_masuk: j1.data?.jam_masuk ?? null,
        jam_keluar: j1.data?.jam_keluar ?? null,
      });

      const range = thisWeekRange();
      const j2 = await getJson(`${API_BASE}absen/history.php?user_id=${uid}&start=${range.start}&end=${range.end}&limit=30`);
      const rows = (j2.data ?? j2.rows ?? [])
        .map((r: any): Log => ({
          tanggal: String(r.tanggal),
          jam_masuk: r.jam_masuk ? String(r.jam_masuk).slice(0, 5) : null,
          jam_keluar: r.jam_keluar ? String(r.jam_keluar).slice(0, 5) : null,
        }))
        .filter((r: Log) => r.jam_masuk || r.jam_keluar);

      rows.sort((a: Log, b: Log) => (a.tanggal < b.tanggal ? 1 : -1));
      setHistory(rows);
    } catch (e: any) { Alert.alert("Gagal", "Tidak dapat memuat data"); } finally { setLoading(false); }
  }, [todayKey]
  );

  const fetchExtraHistory = async (type: 'weekly' | 'monthly', monthKey?: string) => {
    if (!userId) return;
    setLoadingExtra(true);
    try {
      const range = type === 'weekly' ? lastWeekRange() : getSpecificMonthRange(monthKey || selectedMonth);
      const j = await getJson(`${API_BASE}absen/history.php?user_id=${userId}&start=${range.start}&end=${range.end}&limit=35`);
      const rows = (j.data ?? j.rows ?? []).map((r: any) => ({
        tanggal: String(r.tanggal),
        jam_masuk: r.jam_masuk ? String(r.jam_masuk).slice(0, 5) : null,
        jam_keluar: r.jam_keluar ? String(r.jam_keluar).slice(0, 5) : null,
      }));
      rows.sort((a: Log, b: Log) => (a.tanggal < b.tanggal ? 1 : -1));
      setExtraHistory(rows);
    } catch (e) { console.log(e); } finally { setLoadingExtra(false); }
  };

  useFocusEffect(useCallback(() => { if (userId) loadData(userId); }, [userId, loadData]));

  const toggleAccordion = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isAccordionOpen) fetchExtraHistory(filterType);
    setIsAccordionOpen(!isAccordionOpen);
  };

  const onFilterChange = (type: 'weekly' | 'monthly') => { setFilterType(type); fetchExtraHistory(type); };

  const onSelectMonth = (val: string) => { setSelectedMonth(val); setShowMonthPicker(false); fetchExtraHistory('monthly', val); };

  const goProses = (type: "masuk" | "keluar") => router.push(`${PROSES_ABSEN_PATH}?type=${type}` as any);

  const doMasuk = async () => {
    if (today.jam_masuk) return;
    const res = await ensureInsideAnyOffice();
    if (!res.ok) return;
    if (isOutsideWorkingNow("masuk")) { setPendingType("masuk"); setShowReason(true); return; }
    goProses("masuk");
  };

  const doKeluar = async () => {
    if (!today.jam_masuk || today.jam_keluar) return;
    const res = await ensureInsideAnyOffice();
    if (!res.ok) return;
    if (isOutsideWorkingNow("keluar")) { setPendingType("keluar"); setShowReason(true); return; }
    goProses("keluar");
  };

  const onConfirmReason = async () => {
    if (reasonText.trim().length < 3) { Alert.alert("Alasan wajib", "Minimal 3 karakter."); return; }
    await AsyncStorage.setItem("lembur_action", pendingType!);
    await AsyncStorage.setItem("lembur_alasan_today", reasonText);
    setShowReason(false); setReasonText(""); goProses(pendingType!);
  };

  const fmtJamFull = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":");
  const fmtTanggalJudul = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  if (booting) return <SafeAreaView style={s.center}><ActivityIndicator /><Text>Menyiapkan...</Text></SafeAreaView>;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F4F6F8" }}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} style={s.iconBtn} hitSlop={12}><Text style={s.backIcon}>←</Text></Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}><Text style={s.headerTitle}>Absensi</Text></View>
          <Pressable onPress={() => setShowInfo(true)} style={s.iconBtn}><Ionicons name="information-circle-outline" size={24} color="#FFF" /></Pressable>
        </View>
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={() => userId && loadData(userId)} />}>
        <View style={s.panel}>
          <View style={s.panelHeader}>
            <Text style={[s.panelLabel, { flex: 2 }]}>MINGGU BERJALAN</Text>
            <Text style={[s.panelLabel, { flex: 1, textAlign: "center", color: PRIMARY }]}>MASUK</Text>
            <Text style={[s.panelLabel, { flex: 1, textAlign: "right", color: DANGER }]}>KELUAR</Text>
          </View>
          <View style={s.divider} />
          {history.map((item, index) => (
            <View key={index} style={[s.row, { marginTop: 12 }]}>
              <View style={{ flex: 2 }}>
                <Text style={s.dateTop}>{new Date(item.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</Text>
                <Text style={s.dateBottom}>{workingRangeLabel()}</Text>
              </View>
              <Text style={[s.time, { flex: 1, textAlign: "center", color: PRIMARY }]}>{item.jam_masuk ?? "-"}</Text>
              <Text style={[s.time, { flex: 1, textAlign: "right", color: DANGER }]}>{item.jam_keluar ?? "-"}</Text>
            </View>
          ))}
        </View>

        <View style={s.card}>
          <Text style={s.todayTitle}>{fmtTanggalJudul}</Text>
          <Text style={s.liveClock}>{fmtJamFull}</Text>
          {isSunday && (
            <View style={s.sundayBadge}>
              <Ionicons name="star" size={16} color="#F57F17" />
              <Text style={{ color: '#F57F17', fontWeight: 'bold', fontSize: 12 }}>Bonus Poin Minggu!</Text>
            </View>
          )}
          <Text style={s.todayRange}>{workingRangeLabel()}</Text>
          <View style={s.todayStatus}>
            <View style={{ flex: 1 }}>
              {today.jam_masuk ? (
                <><Text style={[s.statusLabel, { color: PRIMARY }]}>Masuk</Text><Text style={[s.statusTime, { color: PRIMARY }]}>{today.jam_masuk}</Text></>
              ) : <Text style={{ color: "#9CA3AF" }}>Belum absen</Text>}
            </View>
            <View style={{ flex: 1 }}>
              {today.jam_keluar && <><Text style={[s.statusLabel, { color: DANGER, textAlign: "right" }]}>Keluar</Text><Text style={[s.statusTime, { color: DANGER, textAlign: "right" }]}>{today.jam_keluar}</Text></>}
            </View>
          </View>
          <View style={s.btnRow}>
            <Pressable onPress={doMasuk} disabled={!!today.jam_masuk} style={[s.btn, { backgroundColor: today.jam_masuk ? PRIMARY_DIM : PRIMARY }]}><Text style={s.btnText}>Masuk</Text></Pressable>
            <Pressable onPress={doKeluar} disabled={!today.jam_masuk || !!today.jam_keluar} style={[s.btn, { backgroundColor: !today.jam_masuk || today.jam_keluar ? "#F7B7B7" : DANGER }]}><Text style={s.btnText}>Keluar</Text></Pressable>
          </View>
        </View>

        <View style={s.accordionCard}>
          <Pressable onPress={toggleAccordion} style={s.accordionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isAccordionOpen ? "chevron-down" : "chevron-forward"} size={20} color={PRIMARY} />
              <Text style={s.accordionTitle}>RIWAYAT LAINNYA</Text>
            </View>
          </Pressable>
          {isAccordionOpen && (
            <View style={{ marginTop: 15 }}>
              <View style={s.filterContainer}>
                <Pressable onPress={() => onFilterChange('weekly')} style={[s.filterBtn, filterType === 'weekly' && s.filterBtnActive]}><Text style={[s.filterBtnText, filterType === 'weekly' && { color: PRIMARY }]}>Minggu Lalu</Text></Pressable>
                <Pressable onPress={() => onFilterChange('monthly')} style={[s.filterBtn, filterType === 'monthly' && s.filterBtnActive]}><Text style={[s.filterBtnText, filterType === 'monthly' && { color: PRIMARY }]}>Bulanan</Text></Pressable>
              </View>
              {filterType === 'monthly' && (
                <Pressable onPress={() => setShowMonthPicker(true)} style={s.monthSelector}><Text>Pilih Bulan: {monthOptions.find(o => o.value === selectedMonth)?.label}</Text><Ionicons name="calendar-outline" size={18} color={PRIMARY} /></Pressable>
              )}
              {loadingExtra ? <ActivityIndicator color={PRIMARY} /> : extraHistory.map((item, idx) => (
                <View key={idx} style={s.extraRow}>
                  <Text style={{ flex: 2, fontWeight: '700' }}>{item.tanggal}</Text>
                  <Text style={{ flex: 1, textAlign: "center", color: PRIMARY, fontWeight: '700' }}>{item.jam_masuk ?? "-"}</Text>
                  <Text style={{ flex: 1, textAlign: "right", color: DANGER, fontWeight: '700' }}>{item.jam_keluar ?? "-"}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* MODAL REASON */}
      <Modal transparent visible={showReason} animationType="fade">
        <View style={m.overlay}>
          <View style={m.box}>
            <Text style={m.title}>Di luar jam kerja</Text>
            <TextInput value={reasonText} onChangeText={setReasonText} placeholder="Alasan..." style={m.input} multiline />
            <View style={m.actions}>
              <Pressable onPress={() => setShowReason(false)} style={[m.btn, { backgroundColor: "#9CA3AF" }]}><Text style={m.btnText}>Batal</Text></Pressable>
              <Pressable onPress={onConfirmReason} style={[m.btn, { backgroundColor: PRIMARY }]}><Text style={m.btnText}>Kirim</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL MONTH */}
      <Modal transparent visible={showMonthPicker} animationType="slide">
        <View style={m.overlay}>
          <View style={m.box}>
            {monthOptions.map((opt) => (
              <Pressable key={opt.value} onPress={() => onSelectMonth(opt.value)} style={s.monthOption}>
                <Text style={[s.monthOptionText, selectedMonth === opt.value && { color: PRIMARY, fontWeight: '800' }]}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setShowMonthPicker(false)} style={[m.btn, { backgroundColor: '#666', marginTop: 10, width: '100%', alignItems: 'center' }]}><Text style={m.btnText}>Tutup</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: PRIMARY, paddingVertical: 12, paddingHorizontal: 12 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  backIcon: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  headerTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 18 },
  panel: { marginHorizontal: 16, marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2 },
  panelHeader: { flexDirection: "row", alignItems: "center" },
  panelLabel: { color: "#6B7280", fontWeight: "700", fontSize: 12 },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  dateTop: { color: "#111827", fontWeight: "700" },
  dateBottom: { color: "#6B7280", fontSize: 12 },
  time: { fontWeight: "700" },
  card: { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, elevation: 2 },
  todayTitle: { textAlign: "center", fontSize: 20, fontWeight: "800" },
  liveClock: { textAlign: "center", fontSize: 26, fontWeight: "800", color: PRIMARY },
  todayRange: { textAlign: "center", color: "#6B7280" },
  todayStatus: { flexDirection: "row", paddingHorizontal: 8, marginVertical: 10 },
  statusLabel: { fontWeight: "700" },
  statusTime: { fontSize: 16, fontWeight: "800" },
  btnRow: { flexDirection: "row", gap: 12 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  sundayBadge: { backgroundColor: '#FFF9C4', padding: 8, borderRadius: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 },
  accordionCard: { marginHorizontal: 16, marginBottom: 10, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2 },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accordionTitle: { fontWeight: '800', color: '#374151', marginLeft: 8 },
  filterContainer: { flexDirection: 'row', backgroundColor: '#F3F4F6', padding: 4, borderRadius: 10, marginBottom: 15 },
  filterBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  filterBtnActive: { backgroundColor: '#FFFFFF' },
  filterBtnText: { color: '#6B7280', fontWeight: '700' },
  extraRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  monthSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFB', padding: 12, borderRadius: 10, marginBottom: 10 },
  monthOption: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  monthOptionText: { fontSize: 15 }
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { backgroundColor: "#fff", borderRadius: 12, width: "100%", padding: 16 },
  title: { fontWeight: "800", fontSize: 16, marginBottom: 8 },
  input: { minHeight: 80, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "flex-end" },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "800" },
  infoItem: { marginBottom: 8, color: "#374151" },
});