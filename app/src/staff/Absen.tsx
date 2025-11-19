// app/staff/Absen.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, Pressable, StyleSheet, FlatList, RefreshControl,
  Alert, ActivityIndicator, Modal, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "../../config";
import * as Location from "expo-location";
import { logInfo as dbg, logError as dbgError } from "../utils/logger";

type Log = { tanggal: string; jam_masuk: string | null; jam_keluar: string | null };
// PERHATIKAN path rute: jika folder kamu tanpa "/src", ganti ke "/staff/ProsesAbsen"
const PROSES_ABSEN_PATH = "/src/staff/ProsesAbsen" as const;

const PRIMARY = "#2196F3";
const PRIMARY_DIM = "#90CAF9";
const DANGER = "#CC3A3A";

/* ===== Utility: tanggal lokal YYYY-MM-DD ===== */
function todayLocalKey(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/* ===== Helper minggu berjalan (Senin–Minggu) ===== */
function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function startOfMondayWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 0=Senin ... 6=Minggu
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function thisWeekRange() {
  const s = startOfMondayWeek(new Date());
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return { start: toYmd(s), end: toYmd(e) };
}
function withinWeek(tgl: string, start: string, end: string) {
  return tgl >= start && tgl <= end;
}

/* ===== fetch dengan timeout ===== */
async function fetchWithTimeout(url: string, opts: RequestInit = {}, ms = 8000) {
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
  try { j = JSON.parse(txt); } catch { throw new Error(`Bukan JSON (${res.status})`); }
  if (!res.ok || j?.success === false) throw new Error(j?.message || `HTTP ${res.status}`);
  return j;
}

/* ===== Geofence multi-lokasi ===== */
type OfficePoint = { id: string; name: string; lat: number; lng: number; radius: number };
const OFFICES: OfficePoint[] = [
  { id: "PT-A", name: "PT Pordjo Steelindo Perkasa / Babelan", lat: -6.17715, lng: 107.02237, radius: 40 },
  { id: "PT-B", name: "PT Pordjo Steelindo Perkasa / Kaliabang", lat: -6.17319, lng: 106.99887, radius: 40 },
];

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
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

/* ===== Jam kerja dari API (single source of truth) ===== */
let GRACE_MINUTES = 0;

function normalizeHMS(x?: string | null) {
  const s = (x || "").trim();
  if (!s) return "00:00:00";
  const parts = s.split(":");
  if (parts.length === 2) return `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}:00`;
  if (parts.length >= 3)  return `${parts[0].padStart(2,"0")}:${parts[1].padStart(2,"0")}:${parts[2].padStart(2,"0")}`;
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

  const [today, setToday] = useState<Log>({ tanggal: todayKey, jam_masuk: null, jam_keluar: null });

  const wk = useMemo(thisWeekRange, [now]);
  const [history, setHistory] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);

  const [workStart, setWorkStart] = useState<string>("08:00:00");
  const [workEnd, setWorkEnd] = useState<string>("17:00:00");

  const [showReason, setShowReason] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [pendingType, setPendingType] = useState<"masuk" | "keluar" | null>(null);

  const [nearestName, setNearestName] = useState<string | null>(null);
  const [nearestDist, setNearestDist] = useState<number | null>(null);

  // Global error handler aktif
  useEffect(() => {
    installGlobalErrorHandler();
    logInfo("ABSEN.mount", { logFile: getLogFileUri() });
  }, []);

  // Ambil user aktif
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

  // Jam realtime
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Helper: status luar jam kerja
  const isOutsideWorkingNow = useCallback((action: "masuk" | "keluar" | "any", d = new Date()) => {
    const nowS = secondsNowLocal(d);
    const start = toSeconds(workStart);
    const end = toSeconds(workEnd);
    const grace = GRACE_MINUTES * 60;

    if (action === "masuk") return nowS < start - grace;
    if (action === "keluar") return nowS > end + grace;
    return nowS < start - grace || nowS > end + grace;
  }, [workStart, workEnd]);

  const workingRangeLabel = useCallback(
    () => `${workStart.slice(0,5)} - ${workEnd.slice(0,5)}`,
    [workStart, workEnd]
  );

  // Load data user + cutoff; HISTORY difilter ke minggu berjalan
  const loadData = useCallback(
    async (uid: number) => {
      setLoading(true);
      try {
        await logInfo("ABSEN.loadData.start", { uid, range: wk });

        // 1) Ambil cutoff dari pusat
        try {
          const cfg = await getJson(`${API_BASE}lembur/lembur_list.php?action=config`);
          const cutStart = normalizeHMS(cfg?.start_cutoff) || "08:00:00";
          const cutEnd   = normalizeHMS(cfg?.end_cutoff)   || "17:00:00";
          setWorkStart(cutStart);
          setWorkEnd(cutEnd);
          await logInfo("ABSEN.loadData.cutoff", { cutStart, cutEnd });
        } catch (e) {
          await logWarn("ABSEN.loadData.cutoffFallback", String(e));
          try {
            const jCut = await getJson(`${API_BASE}lembur/get_list.php?user_id=${uid}&limit=1`);
            const cutStart = normalizeHMS(jCut?.summary?.cutoff_start) || "08:00:00";
            const cutEnd   = normalizeHMS(jCut?.summary?.cutoff_end)   || "17:00:00";
            setWorkStart(cutStart);
            setWorkEnd(cutEnd);
            await logInfo("ABSEN.loadData.cutoff.fromHistory", { cutStart, cutEnd });
          } catch (e2) {
            await logWarn("ABSEN.loadData.cutoff.keepDefault", String(e2));
          }
        }

        // 2) Today dari API
        const j1 = await getJson(`${API_BASE}absen/today.php?user_id=${uid}`);
        const tgl = j1.data?.tanggal ?? todayKey;
        const todayFromApi: Log = {
          tanggal: tgl,
          jam_masuk: j1.data?.jam_masuk ?? null,
          jam_keluar: j1.data?.jam_keluar ?? null,
        };
        setToday(todayFromApi);
        await logInfo("ABSEN.loadData.today", todayFromApi);

        // 3) History → minggu berjalan
        const qs = `user_id=${uid}&start=${wk.start}&end=${wk.end}&limit=14`;
        let rows: Log[] = [];
        try {
          const j2 = await getJson(`${API_BASE}absen/history.php?${qs}`);
          rows = (j2.data ?? j2.rows ?? []) as Log[];
        } catch (eHist) {
          await logWarn("ABSEN.loadData.history.rangeFail", String(eHist));
          try {
            const j2b = await getJson(`${API_BASE}absen/history.php?user_id=${uid}&limit=30`);
            rows = (j2b.data ?? j2b.rows ?? []) as Log[];
          } catch (eHist2) {
            rows = [];
            await logWarn("ABSEN.loadData.history.genericFail", String(eHist2));
          }
        }

        const filtered = rows.filter(r => withinWeek(r.tanggal, wk.start, wk.end));

        if (
          withinWeek(todayFromApi.tanggal, wk.start, wk.end) &&
          (todayFromApi.jam_masuk || todayFromApi.jam_keluar)
        ) {
          const idx = filtered.findIndex(r => r.tanggal === todayFromApi.tanggal);
          if (idx >= 0) {
            filtered[idx] = { ...filtered[idx], ...todayFromApi };
          } else {
            filtered.unshift(todayFromApi);
          }
        }

        filtered.sort((a, b) =>
          a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0
        );
        setHistory(filtered);
        await logInfo("ABSEN.loadData.done", { count: filtered.length });
      } catch (e: any) {
        await logError("ABSEN.loadData.error", e);
        Alert.alert("Gagal", e?.message ?? "Tidak dapat memuat data");
      } finally {
        setLoading(false);
      }
    },
    [todayKey, wk.start, wk.end]
  );

  useEffect(() => {
    if (!userId) return;
    setToday({ tanggal: todayKey, jam_masuk: null, jam_keluar: null });
    setHistory([]);
    loadData(userId);
  }, [userId, todayKey, loadData, wk.start, wk.end]);

  useFocusEffect(
    useCallback(() => {
      if (userId) loadData(userId);
    }, [userId, loadData])
  );

  async function stashReasonOnce(reason: string) {
    if (!reason) return;
    try {
      await AsyncStorage.setItem("lembur_alasan_today", reason);
    } catch (e) {
      await logError("ABSEN.stashReason", e);
    }
  }

  async function stashOfficeUsed(id: string, name: string) {
    try {
      await AsyncStorage.setItem("absen_office_used", JSON.stringify({ id, name, at: Date.now() }));
    } catch (e) {
      await logError("ABSEN.stashOffice", e);
    }
  }

  const goProses = (type: "masuk" | "keluar") => {
    try {
      logInfo("NAV.goProses", { type, path: PROSES_ABSEN_PATH });
      router.push((`${PROSES_ABSEN_PATH}?type=${type}`) as never);
    } catch (e) {
      logError("NAV.goProses.primary", e);
      // Fallback tanpa /src
      try {
        router.push((`/staff/ProsesAbsen?type=${type}`) as never);
      } catch (e2) {
        logError("NAV.goProses.fallback", e2);
        Alert.alert("Navigasi Gagal", "Tidak bisa membuka halaman proses absen.");
      }
    }
  };

  const doMasuk = async () => {
    try {
      await logInfo("ABSEN.onMasuk.tap");
      if (today.jam_masuk) {
        await logWarn("ABSEN.onMasuk.alreadyCheckedIn");
        return;
      }

      const res = await ensureInsideAnyOffice();
      if (!res.ok) {
        await logWarn("ABSEN.onMasuk.outsideOffice");
        return;
      }

      if (res.nearest) {
        setNearestName(res.nearest.office.name);
        setNearestDist(Math.round(res.nearest.dist));
        await stashOfficeUsed(res.nearest.office.id, res.nearest.office.name);
      }

      if (isOutsideWorkingNow("masuk")) {
        setPendingType("masuk");
        setShowReason(true);
        await logInfo("ABSEN.onMasuk.requireReason");
        return;
      }

      goProses("masuk");
    } catch (e: any) {
      await logError("ABSEN.onMasuk.error", e);
      Alert.alert("Error", e?.message || "Terjadi kesalahan saat absen masuk.");
    }
  };

  const doKeluar = async () => {
    try {
      await logInfo("ABSEN.onKeluar.tap");
      if (!today.jam_masuk || today.jam_keluar) {
        await logWarn("ABSEN.onKeluar.invalidState", today);
        return;
      }

      const res = await ensureInsideAnyOffice();
      if (!res.ok) return;

      if (res.nearest) {
        setNearestName(res.nearest.office.name);
        setNearestDist(Math.round(res.nearest.dist));
        await stashOfficeUsed(res.nearest.office.id, res.nearest.office.name);
      }

      if (isOutsideWorkingNow("keluar")) {
        setPendingType("keluar");
        setShowReason(true);
        await logInfo("ABSEN.onKeluar.requireReason");
        return;
      }

      goProses("keluar");
    } catch (e: any) {
      await logError("ABSEN.onKeluar.error", e);
      Alert.alert("Error", e?.message || "Terjadi kesalahan saat absen keluar.");
    }
  };

  const onMasuk = () => { void doMasuk(); };
  const onKeluar = () => { void doKeluar(); };

  const FALLBACK = "/src/staff";
  const onBack = () => {
    try {
      // @ts-ignore
      if (router.canGoBack?.()) return router.back();
    } catch {}
    router.replace(FALLBACK as never);
  };

  const onConfirmReason = async () => {
    const val = reasonText.trim();
    if (val.length < 3) {
      Alert.alert("Alasan wajib", "Minimal 3 karakter ya.");
      return;
    }

    try {
      if (!pendingType) {
        Alert.alert("Error", "Jenis absen tidak diketahui.");
        return;
      }

      await AsyncStorage.setItem("lembur_action", pendingType);
      await stashReasonOnce(val);

      setShowReason(false);
      setReasonText("");

      goProses(pendingType);
      setPendingType(null);
    } catch (e: any) {
      await logError("ABSEN.onConfirmReason", e);
      Alert.alert("Error", e?.message || "Gagal menyimpan alasan lembur.");
    }
  };

  const onCancelReason = () => {
    setShowReason(false);
    setReasonText("");
    setPendingType(null);
  };

  const fmtJamFull = now
    .toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .replace(/\./g, ":");
  const fmtTanggalJudul = now
    .toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .replace(/\./g, "");

  if (booting) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Menyiapkan sesi…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F4F6F8" }}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <Pressable onPress={onBack} style={s.backBtn} hitSlop={12}>
            <Text style={s.backIcon}>←</Text>
          </Pressable>
          <Text style={s.headerTitle}>Absensi</Text>
          <View style={{ width: 36 }} />
        </View>
      </View>

      {/* Panel riwayat singkat (MINGGU BERJALAN SAJA) */}
      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={[s.panelLabel, { flex: 2 }]}>JADWAL</Text>
          <Text style={[s.panelLabel, { flex: 1, textAlign: "center", color: PRIMARY }]}>MASUK</Text>
          <Text style={[s.panelLabel, { flex: 1, textAlign: "right", color: DANGER }]}>KELUAR</Text>
        </View>
        <View style={s.divider} />
        <FlatList
          data={history}
          keyExtractor={(it) => it.tanggal}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => userId && loadData(userId)}
            />
          }
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Text style={s.dateTop}>
                  {new Date(item.tanggal + "T00:00:00")
                    .toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
                    .replace(/\./g, "")}
                </Text>
                <Text style={s.dateBottom}>{workingRangeLabel()}</Text>
              </View>
              <Text style={[s.time, { flex: 1, textAlign: "center", color: PRIMARY }]}>
                {item.jam_masuk ?? "-"}
              </Text>
              <Text style={[s.time, { flex: 1, textAlign: "right", color: DANGER }]}>
                {item.jam_keluar ?? "-"}
              </Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={
            !loading ? (
              <Text style={{ textAlign: "center", color: "#6B7280" }}>
                Belum ada riwayat minggu ini
              </Text>
            ) : null
          }
        />
      </View>

      {/* Kartu hari ini */}
      <View style={s.card}>
        <Text style={s.todayTitle}>{fmtTanggalJudul}</Text>
        <Text style={s.liveClock}>{fmtJamFull}</Text>

        {nearestName ? (
          <View style={s.nearestBadge}>
            <Text style={s.nearestBadgeText}>
              Lokasi terdeteksi: {nearestName}
              {nearestDist !== null ? ` • ±${nearestDist} m` : ""}
            </Text>
          </View>
        ) : null}

        <Text style={s.todayRange}>{workingRangeLabel()}</Text>

        <View style={s.todayStatus}>
          <View style={{ flex: 1 }}>
            {today.jam_masuk ? (
              <>
                <Text style={[s.statusLabel, { color: PRIMARY }]}>Masuk</Text>
                <Text style={[s.statusTime, { color: PRIMARY }]}>{today.jam_masuk}</Text>
              </>
            ) : (
              <Text style={[s.statusLabel, { color: "#9CA3AF" }]}>Belum absen</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {today.jam_keluar ? (
              <>
                <Text style={[s.statusLabel, { color: DANGER, textAlign: "right" }]}>Keluar</Text>
                <Text style={[s.statusTime, { color: DANGER, textAlign: "right" }]}>{today.jam_keluar}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={s.btnRow}>
          <Pressable
            onPress={onMasuk}
            disabled={!!today.jam_masuk}
            style={[s.btn, { backgroundColor: today.jam_masuk ? PRIMARY_DIM : PRIMARY }]}
          >
            <Text style={s.btnText}>Masuk</Text>
          </Pressable>

          <Pressable
            onPress={onKeluar}
            disabled={!today.jam_masuk || !!today.jam_keluar}
            style={[
              s.btn,
              { backgroundColor: !today.jam_masuk || today.jam_keluar ? "#F7B7B7" : DANGER },
            ]}
          >
            <Text style={s.btnText}>Keluar</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: "center", marginTop: 14 }}>
          <Text style={{ color: "#6B7280" }}>Durasi kehadiran</Text>
          <Text style={{ color: PRIMARY, fontSize: 24, fontWeight: "800", marginTop: 6 }}>
            {today.jam_masuk && today.jam_keluar
              ? (() => {
                  const [hm, mm] = today.jam_masuk.split(":").map(Number);
                  const [hk, mk] = today.jam_keluar.split(":").map(Number);
                  const total = hk * 60 + mk - (hm * 60 + mm);
                  const jam = Math.max(0, Math.floor(total / 60))
                    .toString()
                    .padStart(2, "0");
                  const menit = Math.max(0, total % 60)
                    .toString()
                    .padStart(2, "0");
                  return `${jam} : ${menit}`;
                })()
              : "00 : 00"}
          </Text>
        </View>
      </View>

      {/* Modal Alasan */}
      <Modal transparent visible={showReason} animationType="fade" onRequestClose={onCancelReason}>
        <View style={m.overlay}>
          <View style={m.box}>
            <Text style={m.title}>Di luar jam kerja</Text>
            <Text style={m.desc}>
              Tulis alasan lembur untuk absen{" "}
              {pendingType === "masuk" ? "masuk" : "keluar"}:
            </Text>
            <TextInput
              value={reasonText}
              onChangeText={setReasonText}
              placeholder="Contoh: penyelesaian order / maintenance / rapat"
              placeholderTextColor="#9CA3AF"
              style={m.input}
              multiline
            />
            <View style={m.actions}>
              <Pressable
                onPress={onCancelReason}
                style={[m.btn, { backgroundColor: "#9CA3AF" }]}
              >
                <Text style={m.btnText}>Batal</Text>
              </Pressable>
              <Pressable
                onPress={onConfirmReason}
                style={[m.btn, { backgroundColor: PRIMARY }]}
              >
                <Text style={m.btnText}>Kirim</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: PRIMARY, paddingTop: 12, paddingBottom: 12, paddingHorizontal: 12, elevation: 2 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  backIcon: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  headerTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 18, letterSpacing: 0.3 },

  panel: { marginHorizontal: 16, marginTop: 12, backgroundColor: "#FFFFFF", borderRadius: 14, padding: 14, elevation: 2, borderWidth: 1, borderColor: "#E5E7EB" },
  panelHeader: { flexDirection: "row", alignItems: "center" },
  panelLabel: { color: "#6B7280", fontWeight: "700", letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginTop: 10 },

  row: { flexDirection: "row", alignItems: "center" },
  dateTop: { color: "#111827", fontWeight: "700" },
  dateBottom: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  time: { fontWeight: "700" },

  card: { margin: 16, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", elevation: 2 },
  todayTitle: { textAlign: "center", fontSize: 20, fontWeight: "800", color: "#111827" },
  liveClock: { textAlign: "center", fontSize: 26, fontWeight: "800", color: PRIMARY, marginTop: 2 },
  nearestBadge: { alignSelf: "center", marginTop: 8, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#E8F2FF", borderRadius: 999, borderWidth: 1, borderColor: "#CFE3FF" },
  nearestBadgeText: { color: "#0B57D0", fontWeight: "700", fontSize: 12 },
  todayRange: { textAlign: "center", color: "#6B7280", marginTop: 4, marginBottom: 10 },

  todayStatus: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginBottom: 8 },
  statusLabel: { fontWeight: "700" },
  statusTime: { fontSize: 16, fontWeight: "800", marginTop: 2 },

  btnRow: { flexDirection: "row", gap: 12, marginTop: 6 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", elevation: 1 },
  btnText: { color: "#fff", fontWeight: "800" },
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
});
