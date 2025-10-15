import React, { useEffect, useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "../config";
import * as Location from "expo-location";

type Log = { tanggal: string; jam_masuk: string | null; jam_keluar: string | null };
const PROSES_ABSEN_PATH = "/src/staff/ProsesAbsen" as const; // biarin ada (legacy)

/* ===== Utility: tanggal lokal YYYY-MM-DD (bukan UTC) ===== */
function todayLocalKey(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

/* ===== Utility: fetch dengan timeout (signal terpasang) ===== */
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
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`Bukan JSON (${res.status})`);
  }
  if (!res.ok || j?.success === false) throw new Error(j?.message || `HTTP ${res.status}`);
  return j;
}

// ===== Koordinat kantor/PT (ISI sesuai lokasi PT-mu) =====
// const OFFICE = { lat: -6.17715357963973, lng: 107.0223626808636 }; // kantor
const OFFICE = { lat: -6.177108, lng: 107.022475 }; // tengah tengah

const GEOFENCE_RADIUS_M = 2;    
const GPS_TOLERANCE_M   = 15;        // toleransi jitter GPS indoor

// Haversine distance (meter)
function distanceMeters(a: {lat:number; lng:number}, b: {lat:number; lng:number}) {
  const toRad = (x:number)=>x*Math.PI/180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

// Minta izin lokasi + cek posisi saat ini di dalam radius kantor
async function ensureInsideOffice(): Promise<boolean> {
  const serviceOn = await Location.hasServicesEnabledAsync();
  if (!serviceOn) {
    Alert.alert("Lokasi mati", "Aktifkan layanan lokasi (GPS) dulu.");
    return false;
  }
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") {
    Alert.alert("Izin lokasi ditolak", "App butuh akses lokasi untuk absensi area PT.");
    return false;
  }
  let pos = await Location.getLastKnownPositionAsync(); // cepat, bisa null
  if (!pos) {
    pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
  }

  const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  const dist = distanceMeters(here, OFFICE);
  const allowed = dist <= (GEOFENCE_RADIUS_M + GPS_TOLERANCE_M);

  if (!allowed) {
    Alert.alert("Di luar area PT", `Jarak Anda ±${Math.round(dist)} m dari area PT (maks ${GEOFENCE_RADIUS_M} m).`);
  }
  return allowed;
}

export default function Absen() {
  const [userId, setUserId] = useState<number | null>(null);
  const [booting, setBooting] = useState(true);

  const [now, setNow] = useState(new Date());
  const todayKey = useMemo(() => todayLocalKey(now), [now]);

  const [today, setToday] = useState<Log>({ tanggal: todayKey, jam_masuk: null, jam_keluar: null });
  const [history, setHistory] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);

  // Ambil user aktif
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem("auth");
      const auth = raw ? JSON.parse(raw) : null;
      setUserId(auth?.user_id ?? null);
      setBooting(false);
    })();
  }, []);

  // Jam realtime
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load data untuk user tertentu
  const loadData = useCallback(async (uid: number) => {
    setLoading(true);
    try {
      const j1 = await getJson(`${API_BASE}/absen/today.php?user_id=${uid}`);
      const tgl = j1.data?.tanggal ?? todayKey;
      setToday({
        tanggal: tgl,
        jam_masuk: j1.data?.jam_masuk ?? null,
        jam_keluar: j1.data?.jam_keluar ?? null,
      });

      try {
        const j2 = await getJson(`${API_BASE}/absen/history.php?user_id=${uid}&limit=7`);
        setHistory(j2.data ?? []);
      } catch { setHistory([]); }
    } catch (e: any) {
      Alert.alert("Gagal", e?.message ?? "Tidak dapat memuat data");
    } finally {
      setLoading(false);
    }
  }, [todayKey]);

  // panggil saat userId berubah
  useEffect(() => {
    if (!userId) return;
    setToday({ tanggal: todayKey, jam_masuk: null, jam_keluar: null });
    setHistory([]);
    loadData(userId);
  }, [userId, todayKey, loadData]);

  // refetch saat screen fokus
  useFocusEffect(
    useCallback(() => {
      if (userId) loadData(userId);
    }, [userId, loadData])
  );

// === Handler tombol (versi SIMPLE, seperti sebelumnya) ===
const goProses = (type: "masuk" | "keluar") => {
  router.push((`${PROSES_ABSEN_PATH}?type=${type}`) as never);
};

// ====== NEW: versi async yang dipanggil diam-diam ======
const doMasuk = async () => {
  if (today.jam_masuk) return;
  const ok = await ensureInsideOffice();
  if (!ok) return;
  goProses("masuk");
};

const doKeluar = async () => {
  if (!today.jam_masuk || today.jam_keluar) return;
  const ok = await ensureInsideOffice();
  if (!ok) return;
  goProses("keluar");
};

// ====== KEEP API: onPress masih pakai onMasuk/onKeluar (NON-async) ======
const onMasuk = () => { void doMasuk(); };
const onKeluar = () => { void doKeluar(); };



  const fmtJamFull = now
    .toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .replace(/\./g, ":");
  const fmtTanggalJudul = now.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  if (booting) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Menyiapkan sesi…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#E9F0ED" }}>
      <View style={s.header}>
        <Text style={s.clock}>{fmtJamFull}</Text>
        <Text style={s.headerTitle}>Absensi</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.panel}>
        <View style={s.panelHeader}>
          <Text style={[s.panelLabel, { flex: 2 }]}>JADWAL</Text>
          <Text style={[s.panelLabel, { flex: 1, textAlign: "center", color: "#1B7F4C" }]}>MASUK</Text>
          <Text style={[s.panelLabel, { flex: 1, textAlign: "right", color: "#CC3A3A" }]}>KELUAR</Text>
        </View>
        <View style={s.divider} />
        <FlatList
          data={history}
          keyExtractor={(it) => it.tanggal}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => userId && loadData(userId)} />}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={{ flex: 2 }}>
                <Text style={s.dateTop}>{formatTanggalList(item.tanggal)}</Text>
                <Text style={s.dateBottom}>08:00 - 17:00</Text>
              </View>
              <Text style={[s.time, { flex: 1, textAlign: "center", color: "#1B7F4C" }]}>
                {item.jam_masuk ?? "-"}
              </Text>
              <Text style={[s.time, { flex: 1, textAlign: "right", color: "#CC3A3A" }]}>
                {item.jam_keluar ?? "-"}
              </Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={!loading ? <Text style={{ textAlign: "center", color: "#6B7280" }}>Belum ada riwayat</Text> : null}
        />
      </View>

      <View style={s.card}>
        <Text style={s.todayTitle}>{fmtTanggalJudul.replace(/\./g, "")}</Text>
        <Text style={s.todayRange}>08:00 - 17:00</Text>

        <View style={s.todayStatus}>
          <View style={{ flex: 1 }}>
            {today.jam_masuk ? (
              <>
                <Text style={[s.statusLabel, { color: "#1B7F4C" }]}>Masuk</Text>
                <Text style={[s.statusTime, { color: "#1B7F4C" }]}>{today.jam_masuk}</Text>
              </>
            ) : (
              <Text style={[s.statusLabel, { color: "#9CA3AF" }]}>Belum absen</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            {today.jam_keluar ? (
              <>
                <Text style={[s.statusLabel, { color: "#CC3A3A", textAlign: "right" }]}>Keluar</Text>
                <Text style={[s.statusTime, { color: "#CC3A3A", textAlign: "right" }]}>{today.jam_keluar}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={s.btnRow}>
          <Pressable onPress={onMasuk} disabled={!!today.jam_masuk} style={[s.btn, { backgroundColor: today.jam_masuk ? "#A7D7BE" : "#1B7F4C" }]}>
            <Text style={s.btnText}>Masuk</Text>
          </Pressable>
          <Pressable
            onPress={onKeluar}
            disabled={!today.jam_masuk || !!today.jam_keluar}
            style={[s.btn, { backgroundColor: !today.jam_masuk || today.jam_keluar ? "#F0A6A6" : "#CC3A3A" }]}
          >
            <Text style={s.btnText}>Keluar</Text>
          </Pressable>
        </View>

        <View style={{ alignItems: "center", marginTop: 12 }}>
          <Text style={{ color: "#6B7280" }}>Durasi kehadiran</Text>
          <Text style={{ color: "#1B7F4C", fontSize: 24, fontWeight: "800", marginTop: 6 }}>
            {today.jam_masuk && today.jam_keluar ? hitungDurasi(today.jam_masuk, today.jam_keluar) : "00 : 00"}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function formatTanggalList(isoDate: string) {
  const d = new Date(isoDate + "T00:00:00");
  const t = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  return t.replace(/\./g, "");
}
function hitungDurasi(masuk: string, keluar: string) {
  const [hm, mm] = masuk.split(":").map(Number);
  const [hk, mk] = keluar.split(":").map(Number);
  const total = hk * 60 + mk - (hm * 60 + mm);
  const jam = Math.max(0, Math.floor(total / 60)).toString().padStart(2, "0");
  const menit = Math.max(0, total % 60).toString().padStart(2, "0");
  return `${jam} : ${menit}`;
}

const s = StyleSheet.create({
  header: {
    backgroundColor: "#1B7F4C",
    paddingTop: 8,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  clock: {
    color: "#E6FFED",
    fontSize: 28,
    fontWeight: "800",
  },
  headerTitle: {
    color: "#E6FFED",
    textAlign: "center",
    fontWeight: "700",
    marginTop: 6,
  },

  panel: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    elevation: 2,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  panelLabel: {
    color: "#6B7280",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  divider: {
    height: 2,
    backgroundColor: "#D1D5DB",
    marginTop: 10,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  dateTop: {
    color: "#111827",
    fontWeight: "700",
  },
  dateBottom: {
    color: "#6B7280",
    fontSize: 12,
    marginTop: 2,
  },
  time: {
    fontWeight: "700",
  },

  card: {
    margin: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    elevation: 2,
  },
  todayTitle: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "800",
  },
  todayRange: {
    textAlign: "center",
    color: "#6B7280",
    marginTop: 2,
    marginBottom: 8,
  },
  todayStatus: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  statusLabel: {
    fontWeight: "700",
  },
  statusTime: {
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: {
    color: "#fff",
    fontWeight: "800",
  },
});
