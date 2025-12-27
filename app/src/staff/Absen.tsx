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
import { Ionicons } from "@expo/vector-icons";
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

const PRIMARY = "#2196F3";
const PRIMARY_DIM = "#90CAF9";
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

/* ===== [RHEZA FIX] Helper minggu (SABTU - JUMAT) ===== */
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

/* ===== [TAMBAHAN] Helper Bulan ===== */
function thisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
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

/* ===== Geofence multi-lokasi (DIJAGA UTUH) ===== */
type OfficePoint = { id: string; name: string; lat: number; lng: number; radius: number };
const OFFICES: OfficePoint[] = [
  { id: "PT-A", name: "PT Pordjo Steelindo Perkasa / Babelan", lat: -6.17716, lng: 107.02238, radius: 150 },
  { id: "PT-B", name: "PT Pordjo Steelindo Perkasa / Kaliabang", lat: -6.17315, lng: 106.99885, radius: 150 },
];

// [FIX TYPE Disini bray biar ga Error implicit any]
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
    await logInfo("ABSEN.ensureInside.service", { serviceOn });
    if (!serviceOn) {
      Alert.alert("Lokasi mati", "Aktifkan layanan lokasi (GPS) dulu.");
      return { ok: false };
    }

    let perm = await Location.getForegroundPermissionsAsync();
    await logInfo("ABSEN.ensureInside.perm", perm);
    if (perm.status !== "granted" && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync();
      await logInfo("ABSEN.ensureInside.perm.requested", perm);
    }
    if (perm.status !== "granted") {
      Alert.alert(
        "Izin lokasi ditolak",
        perm.canAskAgain
          ? "Tanpa izin lokasi, sistem tidak bisa memastikan Anda di area kantor. Tekan tombol absen lagi dan pilih Allow."
          : "Izin lokasi sudah ditolak permanen. Aktifkan kembali di Pengaturan > Aplikasi > Lokasi untuk bisa absen."
      );
      return { ok: false };
    }

    let pos = await Location.getLastKnownPositionAsync();
    if (!pos) pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    await logInfo("ABSEN.ensureInside.pos", pos?.coords ?? null);

    const here = { lat: pos!.coords.latitude, lng: pos!.coords.longitude };
    const best = nearestOffice(here);

    if (!best) {
      Alert.alert("Konfigurasi lokasi kosong", "Lokasi kantor belum dikonfigurasi.");
      return { ok: false };
    }

    const allowed = best.dist <= best.office.radius;
    await logInfo("ABSEN.ensureInside.eval", { allowed, nearest: best });

    if (!allowed) {
      const info = OFFICES.map((o) => {
        const d = Math.round(distanceMeters(here, { lat: o.lat, lng: o.lng }));
        return `• ${o.name}: ±${d} m (maks ${o.radius} m)`;
      }).join("\n");
      Alert.alert("Di luar area PT", `Anda berada di luar radius kantor.\n\n${info}`);
    }

    return { ok: allowed, nearest: best };
  } catch (e: any) {
    await logError("ABSEN.ensureInside.error", e);
    Alert.alert(
      "Lokasi error",
      e?.message || "Gagal membaca lokasi. Pastikan GPS aktif dan coba lagi."
    );
    return { ok: false };
  }
}

/* ===== Jam kerja ===== */
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

  const [nearestName, setNearestName] = useState<string | null>(null);
  const [nearestDist, setNearestDist] = useState<number | null>(null);

  const [showInfo, setShowInfo] = useState(false);

  // --- STATE ACCORDION & FILTER ---
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [filterType, setFilterType] = useState<'weekly' | 'monthly'>('weekly');
  const [extraHistory, setExtraHistory] = useState<Log[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);

  useEffect(() => {
    installGlobalErrorHandler();
    logInfo("ABSEN.mount", { logFile: getLogFileUri() });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        let auth: any = null;

        if (raw) {
          try {
            auth = JSON.parse(raw);
          } catch (e) {
            await logError("ABSEN.parseAuth", e);
          }
        }
        const uid = auth?.user_id ?? auth?.id ?? null;
        await logInfo("ABSEN.user", { uid });
        setUserId(uid);
      } catch (e) {
        await logError("ABSEN.loadAuth", e);
        setUserId(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isOutsideWorkingNow = useCallback(
    (action: "masuk" | "keluar", d = new Date()) => {
      const nowS = secondsNowLocal(d);
      const start = toSeconds(workStart);
      const end = toSeconds(workEnd);
      const grace = GRACE_MINUTES * 60;

      if (action === "masuk") return nowS < start - grace;
      if (action === "keluar") return nowS > end + grace;
      return nowS < start - grace || nowS > end + grace;
    },
    [workStart, workEnd]
  );

  const workingRangeLabel = useCallback(
    () => `${workStart.slice(0, 5)} - ${workEnd.slice(0, 5)}`,
    [workStart, workEnd]
  );

  const loadData = useCallback(
    async (uid: number) => {
      setLoading(true);
      try {
        await logInfo("ABSEN.loadData.start", { uid });

        try {
          const cfg = await getJson(`${API_BASE}lembur/lembur_list.php?action=config`);
          const cutStart = normalizeHMS(cfg?.start_cutoff) || "07:30:00";
          const cutEnd = normalizeHMS(cfg?.end_cutoff) || "17:30:00";
          setWorkStart(cutStart);
          setWorkEnd(cutEnd);
        } catch (e) {}

        const j1 = await getJson(`${API_BASE}absen/today.php?user_id=${uid}`);
        const tgl = j1.data?.tanggal ?? todayKey;
        const todayFromApi: Log = {
          tanggal: tgl,
          jam_masuk: j1.data?.jam_masuk ?? null,
          jam_keluar: j1.data?.jam_keluar ?? null,
        };
        setToday(todayFromApi);

        const range = thisWeekRange(); 
        const qs = `user_id=${uid}&start=${range.start}&end=${range.end}&limit=30`; 

        let rowsRaw: any[] = [];
        try {
          const j2 = await getJson(`${API_BASE}absen/history.php?${qs}`);
          rowsRaw = (j2.data ?? j2.rows ?? []);
        } catch (eHist) {
           rowsRaw = [];
        }

        const mappedAndCleaned = rowsRaw
            .map((r: any): Log => ({
              tanggal: String(r.tanggal),
              jam_masuk: r.jam_masuk ? String(r.jam_masuk).slice(0, 5) : null,
              jam_keluar: r.jam_keluar ? String(r.jam_keluar).slice(0, 5) : null,
            }))
            .filter((r: Log) => {
              if (!r.jam_masuk && !r.jam_keluar) return false;
              return r.tanggal >= range.start;
            });

        // [FIX TYPE Disini bray]
        mappedAndCleaned.sort((a: Log, b: Log) => (a.tanggal < b.tanggal ? 1 : -1));
        setHistory(mappedAndCleaned);
        
      } catch (e: any) {
        await logError("ABSEN.loadData.error", e);
        Alert.alert("Gagal", e?.message ?? "Tidak dapat memuat data");
      } finally {
        setLoading(false);
      }
    },
    [todayKey]
  );

  const fetchExtraHistory = async (type: 'weekly' | 'monthly') => {
    if (!userId) return;
    setLoadingExtra(true);
    try {
      const range = type === 'weekly' ? thisWeekRange() : thisMonthRange();
      const qs = `user_id=${userId}&start=${range.start}&end=${range.end}&limit=50`;
      const j = await getJson(`${API_BASE}absen/history.php?${qs}`);
      const rows = (j.data ?? j.rows ?? [])
        .map((r: any): Log => ({
          tanggal: String(r.tanggal),
          jam_masuk: r.jam_masuk ? String(r.jam_masuk).slice(0, 5) : null,
          jam_keluar: r.jam_keluar ? String(r.jam_keluar).slice(0, 5) : null,
        }));
      // [FIX TYPE Disini bray]
      rows.sort((a: Log, b: Log) => (a.tanggal < b.tanggal ? 1 : -1));
      setExtraHistory(rows);
    } catch (e) {
      logError("ABSEN.fetchExtra.error", e);
    } finally {
      setLoadingExtra(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    loadData(userId);
  }, [userId, todayKey, loadData]);

  useFocusEffect(
    useCallback(() => {
      if (userId) loadData(userId);
    }, [userId, loadData])
  );

  const toggleAccordion = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isAccordionOpen) fetchExtraHistory(filterType);
    setIsAccordionOpen(!isAccordionOpen);
  };

  const onFilterChange = (type: 'weekly' | 'monthly') => {
    setFilterType(type);
    fetchExtraHistory(type);
  };

  async function stashReasonOnce(reason: string) {
    if (!reason) return;
    try { await AsyncStorage.setItem("lembur_alasan_today", reason); } catch (e) { await logError("ABSEN.stashReason", e); }
  }
  async function stashOfficeUsed(id: string, name: string) {
    try { await AsyncStorage.setItem("absen_office_used", JSON.stringify({ id, name, at: Date.now() })); } catch (e) { await logError("ABSEN.stashOffice", e); }
  }

  const goProses = (type: "masuk" | "keluar") => {
    const target = `${PROSES_ABSEN_PATH}?type=${type}`;
    try { 
        logInfo("NAV.goProses", { type, path: target }); 
        router.push(target as any); 
    } catch (e) { 
        logError("NAV.goProses.error", e); 
    }
  };

  const doMasuk = async () => {
    try {
      if (today.jam_masuk) return;
      const res = await ensureInsideAnyOffice();
      if (!res.ok) return;
      if (res.nearest) await stashOfficeUsed(res.nearest.office.id, res.nearest.office.name);
      if (isOutsideWorkingNow("masuk")) {
        setPendingType("masuk");
        setShowReason(true);
        return;
      }
      goProses("masuk");
    } catch (e: any) { Alert.alert("Error", e?.message || "Gagal absen masuk."); }
  };

  const doKeluar = async () => {
    try {
      if (!today.jam_masuk || today.jam_keluar) return;
      const res = await ensureInsideAnyOffice();
      if (!res.ok) return;
      if (res.nearest) await stashOfficeUsed(res.nearest.office.id, res.nearest.office.name);
      if (isOutsideWorkingNow("keluar")) {
        setPendingType("keluar");
        setShowReason(true);
        return;
      }
      goProses("keluar");
    } catch (e: any) { Alert.alert("Error", e?.message || "Gagal absen keluar."); }
  };

  const onConfirmReason = async () => {
    const val = reasonText.trim();
    if (val.length < 3) { Alert.alert("Alasan wajib", "Minimal 3 karakter."); return; }
    try {
      if (!pendingType) return;
      await AsyncStorage.setItem("lembur_action", pendingType);
      await stashReasonOnce(val);
      setShowReason(false); setReasonText("");
      goProses(pendingType); setPendingType(null);
    } catch (e: any) { Alert.alert("Error", "Gagal menyimpan alasan."); }
  };

  const onCancelReason = () => { setShowReason(false); setReasonText(""); setPendingType(null); };

  const fmtJamFull = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\./g, ":");
  const fmtTanggalJudul = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).replace(/\./g, "");

  if (booting) {
    return ( <SafeAreaView style={s.center}><ActivityIndicator /><Text style={{ marginTop: 8 }}>Menyiapkan sesi…</Text></SafeAreaView> );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F4F6F8" }}>
      <View style={s.header}>
        <View style={s.headerRow}>
          <Pressable onPress={() => router.back()} style={s.iconBtn} hitSlop={12}>
            <Text style={s.backIcon}>←</Text>
          </Pressable>
          <View style={{flex: 1, alignItems: 'center'}}>
            <Text style={s.headerTitle}>Absensi</Text>
          </View>
          <Pressable onPress={() => setShowInfo(true)} style={s.iconBtn}>
             <Ionicons name="information-circle-outline" size={24} color="#FFF" />
          </Pressable>
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 20 }}
        refreshControl={ <RefreshControl refreshing={loading} onRefresh={() => userId && loadData(userId)} /> }
      >
        <View style={s.panel}>
          <View style={s.panelHeader}>
            <Text style={[s.panelLabel, { flex: 2 }]}>RIWAYAT MINGGU INI</Text>
            <Text style={[s.panelLabel, { flex: 1, textAlign: "center", color: PRIMARY }]}>MASUK</Text>
            <Text style={[s.panelLabel, { flex: 1, textAlign: "right", color: DANGER }]}>KELUAR</Text>
          </View>
          <View style={s.divider} />
          {history.map((item, index) => (
            <View key={index} style={[s.row, { marginTop: 12 }]}>
              <View style={{ flex: 2 }}>
                <Text style={s.dateTop}>
                  {new Date(item.tanggal + "T00:00:00")
                    .toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
                    .replace(/\./g, "")}
                </Text>
                <Text style={s.dateBottom}>{workingRangeLabel()}</Text>
              </View>
              <Text style={[s.time, { flex: 1, textAlign: "center", color: PRIMARY }]}>{item.jam_masuk ?? "-"}</Text>
              <Text style={[s.time, { flex: 1, textAlign: "right", color: DANGER }]}>{item.jam_keluar ?? "-"}</Text>
            </View>
          ))}
          {history.length === 0 && !loading && (
            <Text style={{ textAlign: "center", color: "#6B7280", marginTop: 10 }}>Belum ada riwayat periode ini</Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.todayTitle}>{fmtTanggalJudul}</Text>
          <Text style={s.liveClock}>{fmtJamFull}</Text>
          {isSunday && (
              <View style={s.sundayBadge}>
                  <Ionicons name="star" size={16} color="#F57F17" />
                  <Text style={{color: '#F57F17', fontWeight: 'bold', fontSize: 12}}>Minggu: Absen Tepat Waktu = Bonus Poin!</Text>
              </View>
          )}
          <Text style={s.todayRange}>{workingRangeLabel()}</Text>
          <View style={s.todayStatus}>
            <View style={{ flex: 1 }}>
              {today.jam_masuk ? (
                <><Text style={[s.statusLabel, { color: PRIMARY }]}>Masuk</Text><Text style={[s.statusTime, { color: PRIMARY }]}>{today.jam_masuk}</Text></>
              ) : ( <Text style={[s.statusLabel, { color: "#9CA3AF" }]}>Belum absen</Text> )}
            </View>
            <View style={{ flex: 1 }}>
              {today.jam_keluar ? (
                <><Text style={[s.statusLabel, { color: DANGER, textAlign: "right" }]}>Keluar</Text><Text style={[s.statusTime, { color: DANGER, textAlign: "right" }]}>{today.jam_keluar}</Text></>
              ) : null}
            </View>
          </View>
          <View style={s.btnRow}>
            <Pressable onPress={doMasuk} disabled={!!today.jam_masuk} style={[s.btn, { backgroundColor: today.jam_masuk ? PRIMARY_DIM : PRIMARY }]}>
              <Text style={s.btnText}>Masuk</Text>
            </Pressable>
            <Pressable onPress={doKeluar} disabled={!today.jam_masuk || !!today.jam_keluar} style={[s.btn, { backgroundColor: !today.jam_masuk || today.jam_keluar ? "#F7B7B7" : DANGER }]}>
              <Text style={s.btnText}>Keluar</Text>
            </Pressable>
          </View>

          <View style={{ alignItems: "center", marginTop: 14 }}>
            <Text style={{ color: "#6B7280" }}>Durasi kehadiran</Text>
            <Text style={{ color: PRIMARY, fontSize: 24, fontWeight: "800", marginTop: 6 }}>
              {today.jam_masuk && today.jam_keluar ? (() => {
                    const [hm, mm] = today.jam_masuk.split(":").map(Number);
                    const [hk, mk] = today.jam_keluar.split(":").map(Number);
                    const total = hk * 60 + mk - (hm * 60 + mm);
                    const jam = Math.max(0, Math.floor(total / 60)).toString().padStart(2, "0");
                    const menit = Math.max(0, total % 60).toString().padStart(2, "0");
                    return `${jam} : ${menit}`;
                  })() : "00 : 00"}
            </Text>
          </View>
        </View>

        <View style={s.accordionCard}>
          <Pressable onPress={toggleAccordion} style={s.accordionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={isAccordionOpen ? "chevron-down" : "chevron-forward"} size={20} color={PRIMARY} />
              <Text style={s.accordionTitle}>RIWAYAT LAINNYA</Text>
            </View>
            <View style={s.activeFilterBadge}>
              <Text style={s.activeFilterText}>{filterType === 'weekly' ? '7 Hari' : 'Bulan Ini'}</Text>
            </View>
          </Pressable>

          {isAccordionOpen && (
            <View style={{ marginTop: 15 }}>
              <View style={s.filterContainer}>
                <Pressable onPress={() => onFilterChange('weekly')} style={[s.filterBtn, filterType === 'weekly' && s.filterBtnActive]}>
                  <Text style={[s.filterBtnText, filterType === 'weekly' && s.filterBtnTextActive]}>Mingguan</Text>
                </Pressable>
                <Pressable onPress={() => onFilterChange('monthly')} style={[s.filterBtn, filterType === 'monthly' && s.filterBtnActive]}>
                  <Text style={[s.filterBtnText, filterType === 'monthly' && s.filterBtnTextActive]}>Bulanan</Text>
                </Pressable>
              </View>

              {loadingExtra ? (
                <ActivityIndicator color={PRIMARY} style={{ marginVertical: 20 }} />
              ) : (
                <View>
                  {extraHistory.map((item, idx) => (
                    <View key={idx} style={s.extraRow}>
                      <View style={{ flex: 2 }}>
                        <Text style={s.dateTop}>{new Date(item.tanggal + "T00:00:00").toLocaleDateString("id-ID", { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                      </View>
                      <Text style={[s.time, { flex: 1, textAlign: "center", color: PRIMARY }]}>{item.jam_masuk ?? "-"}</Text>
                      <Text style={[s.time, { flex: 1, textAlign: "right", color: DANGER }]}>{item.jam_keluar ?? "-"}</Text>
                    </View>
                  ))}
                  {extraHistory.length === 0 && (
                    <Text style={s.emptyText}>Tidak ada data untuk periode ini</Text>
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modals dijaga utuh */}
      <Modal transparent visible={showReason} animationType="fade" onRequestClose={onCancelReason}>
        <View style={m.overlay}>
          <View style={m.box}>
            <Text style={m.title}>Di luar jam kerja</Text>
            <TextInput value={reasonText} onChangeText={setReasonText} placeholder="Contoh: meeting / deadline" style={m.input} multiline />
            <View style={m.actions}>
              <Pressable onPress={onCancelReason} style={[m.btn, { backgroundColor: "#9CA3AF" }]}><Text style={m.btnText}>Batal</Text></Pressable>
              <Pressable onPress={onConfirmReason} style={[m.btn, { backgroundColor: PRIMARY }]}><Text style={m.btnText}>Kirim</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={m.overlay}>
          <View style={[m.box, {maxHeight: '80%'}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <Text style={m.title}>Panduan Absensi</Text>
                <Pressable onPress={() => setShowInfo(false)}><Ionicons name="close" size={24} color="#666" /></Pressable>
            </View>
            <ScrollView style={{marginBottom: 10}}>
                <Text style={m.infoItem}>📍 <Text style={{fontWeight:'bold'}}>Lokasi:</Text> Wajib di radius kantor.</Text>
                <Text style={m.infoItem}>🕒 <Text style={{fontWeight:'bold'}}>Jam Kerja:</Text> Absen di luar {workStart.slice(0,5)} - {workEnd.slice(0,5)} wajib alasan lembur.</Text>
                <Text style={m.infoItem}>📅 <Text style={{fontWeight:'bold'}}>Riwayat:</Text> Sabtu - Jumat. Reset Minggu jam 00:00.</Text>
                <Text style={m.infoItem}>📸 <Text style={{fontWeight:'bold'}}>Foto:</Text> Wajib selfie.</Text>
                <Text style={m.infoItem}>✨ <Text style={{fontWeight:'bold'}}>Minggu:</Text> Bonus poin hadir tepat waktu!</Text>
            </ScrollView>
            <Pressable onPress={() => setShowInfo(false)} style={[m.btn, { backgroundColor: PRIMARY, width:'100%', alignItems:'center' }]}>
              <Text style={m.btnText}>Saya Paham</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: PRIMARY, paddingTop: 12, paddingBottom: 12, paddingHorizontal: 12, elevation: 2 },
  headerRow: { flexDirection: "row", alignItems: "center" }, 
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  backIcon: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  headerTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 18, letterSpacing: 0.3 },
  panel: { marginHorizontal: 16, marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2, borderWidth: 1, borderColor: "#E5E7EB" },
  panelHeader: { flexDirection: "row", alignItems: "center" },
  panelLabel: { color: "#6B7280", fontWeight: "700", letterSpacing: 0.5, fontSize: 12 },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  dateTop: { color: "#111827", fontWeight: "700" },
  dateBottom: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  time: { fontWeight: "700" },
  card: { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", elevation: 2 },
  todayTitle: { textAlign: "center", fontSize: 20, fontWeight: "800", color: "#111827" },
  liveClock: { textAlign: "center", fontSize: 26, fontWeight: "800", color: PRIMARY, marginTop: 2 },
  todayRange: { textAlign: "center", color: "#6B7280", marginTop: 4, marginBottom: 10 },
  todayStatus: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginBottom: 8 },
  statusLabel: { fontWeight: "700" },
  statusTime: { fontSize: 16, fontWeight: "800", marginTop: 2 },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 6 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", elevation: 1 },
  btnText: { color: "#fff", fontWeight: "800" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  sundayBadge: { backgroundColor: '#FFF9C4', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignSelf: 'center', marginTop: 10, borderWidth: 1, borderColor: '#FBC02D', flexDirection: 'row', alignItems: 'center', gap: 5 },
  accordionCard: { marginHorizontal: 16, marginBottom: 10, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2, borderWidth: 1, borderColor: "#E5E7EB" },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accordionTitle: { fontWeight: '800', color: '#374151', marginLeft: 8, fontSize: 14 },
  activeFilterBadge: { backgroundColor: PRIMARY_DIM, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  activeFilterText: { color: PRIMARY, fontWeight: '800', fontSize: 10 },
  filterContainer: { flexDirection: 'row', backgroundColor: '#F3F4F6', padding: 4, borderRadius: 10, marginBottom: 15 },
  filterBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  filterBtnActive: { backgroundColor: '#FFFFFF', elevation: 2 },
  filterBtnText: { color: '#6B7280', fontWeight: '700', fontSize: 12 },
  filterBtnTextActive: { color: PRIMARY },
  extraRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  emptyText: { textAlign: 'center', color: '#9CA3AF', marginVertical: 20, fontSize: 13, fontStyle: 'italic' }
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  box: { backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 480, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  title: { fontWeight: "800", fontSize: 16, marginBottom: 8, color: "#111827" },
  desc: { color: "#374151", marginBottom: 8 },
  input: { minHeight: 80, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, textAlignVertical: "top", backgroundColor: "#F9FAFB" },
  actions: { flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "flex-end" },
  btn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "800" },
  infoItem: { marginBottom: 8, color: "#374151", lineHeight: 20 },
});