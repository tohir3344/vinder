// app/staff/ProsesAbsen.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { router, useLocalSearchParams, type Href } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import NetInfo from "@react-native-community/netinfo";
import { compressImageTo, getFileSize } from "../utils/image"; // <— path dari app/staff ke app/utils

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, ""); // steril trailing slash
const ABSEN_PATH: Href = "/src/staff/Absen";

export default function ProsesAbsen() {
  const { type } = useLocalSearchParams<{ type?: "masuk" | "keluar" }>();
  const isMasuk = (type ?? "masuk") === "masuk";

  const [now, setNow] = useState(new Date());
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [userId, setUserId] = useState<number | null>(null);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationPerm, setLocationPerm] = useState(false);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();

  const mapRef = useRef<MapView | null>(null);
  const camRef = useRef<React.ElementRef<typeof CameraView> | null>(null);

  const MAX_BYTES = 400 * 1024; // 400KB target aman di jaringan pas-pasan

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  function fetchWithTimeout(url: string, opt: RequestInit, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t));
}

  // ===== Ambil user aktif dari storage =====
  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem("auth");
        const a = s ? JSON.parse(s) : null;
        setUserId(a?.user_id ?? null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // jam realtime (sekadar display)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // izin + live tracking lokasi + izin kamera
  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const loc = await Location.requestForegroundPermissionsAsync();
        setLocationPerm(loc.status === "granted");
        if (loc.status !== "granted") throw new Error("Izin lokasi ditolak");

        if (!cameraPerm?.granted) {
          const cam = await requestCameraPerm();
          if (!cam?.granted) {
            Alert.alert("Izin Kamera Ditolak", "Kamu harus mengizinkan kamera untuk absen.");
            return;
          }
        }

        watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1500, distanceInterval: 2 },
          (pos) => {
            const { latitude, longitude } = pos.coords;
            setCoords({ latitude, longitude });
            const region: Region = { latitude, longitude, latitudeDelta: 0.0015, longitudeDelta: 0.0015 };
            mapRef.current?.animateToRegion(region, 600);
          }
        );
      } catch (e: any) {
        Alert.alert("Gagal", e?.message ?? "Tidak bisa mendapatkan lokasi/kamera");
      } finally {
        setLoading(false);
      }
    })();

    return () => watcher?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const takePhoto = async () => {
  try {
    setShowCamera(true);
    setTimeout(async () => {
      const pic = await camRef.current?.takePictureAsync({
        quality: 0.6,          // turunin dikit
        skipProcessing: true,  // biar cepat
      });
      setShowCamera(false);
      if (!pic?.uri) return;

      const out = await compressImageTo(pic.uri, MAX_BYTES);
      if (out.size > MAX_BYTES) {
        Alert.alert(
          "Foto Terlalu Besar",
          "Ukuran foto melebihi batas. Tolong ambil ulang dengan jarak sedikit lebih jauh atau pencahayaan lebih baik.",
          [{ text: "Ambil Ulang" }]
        );
        setPhotoUri(null);
        return;
      }
      setPhotoUri(out.uri);
      // console.log("Size akhir (KB):", (out.size/1024).toFixed(1));
    }, 350);
  } catch (e: any) {
    setShowCamera(false);
    Alert.alert("Gagal", e?.message ?? "Gagal mengambil foto");
  }
};


  // Ambil & hapus stash alasan (kalau ada)
  const popReasonFromStash = async (): Promise<string | null> => {
    try {
      const val = await AsyncStorage.getItem("lembur_alasan_today");
      if (val) await AsyncStorage.removeItem("lembur_alasan_today");
      return val ? val.trim() : null;
    } catch {
      return null;
    }
  };

  // ====== PANGGIL LEMBUR UPSERT (INI YANG HILANG SEBELUMNYA) ======
  async function callUpsertLembur(opts: {
    userId: number;
    tanggal?: string | null;
    isMasuk: boolean;
    reason: string | null;
    jamMasuk?: string | null;
    jamKeluar?: string | null;
  }) {
    const { userId, tanggal, isMasuk, reason, jamMasuk, jamKeluar } = opts;

    // tanggal fallback: format "YYYY-MM-DD"
    const fallbackDate = new Date().toLocaleDateString("sv-SE"); // sv-SE → 2025-10-22
    const payload: Record<string, any> = {
      user_id: userId,
      tanggal: (tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)) ? tanggal : fallbackDate,
    };

    if (isMasuk) {
      if (reason && reason.trim()) payload.alasan = reason.trim();
    } else {
      if (reason && reason.trim()) payload.alasan_keluar = reason.trim();
    }

    // kirim jam kalau kamu punya (optional)
    if (jamMasuk)  payload.jam_masuk  = jamMasuk;
    if (jamKeluar) payload.jam_keluar = jamKeluar;

    const url = `${API_BASE}/lembur/upsert.php`;
    console.log("[UPsert] POST", url, payload);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    console.log("[UPsert] status", res.status, txt);
    if (!res.ok) throw new Error(`upsert gagal: ${txt}`);
  }

  // === Handler tombol Kirim ===
 const handlePressKirim = async () => {
  if (!userId) return Alert.alert("Gagal", "User belum terbaca, coba login ulang.");
  if (!coords) return Alert.alert("Gagal", "Lokasi belum terbaca");
  if (!photoUri) return Alert.alert("Gagal", "Ambil foto dulu ya");

  // 1) cek koneksi
  const state = await NetInfo.fetch();
  if (!state.isConnected) {
    return Alert.alert("Tidak Ada Internet", "Periksa koneksi kamu ya.");
  }

  // 2) cek size real (jaga-jaga)
  const size = await getFileSize(photoUri);
  if (size > MAX_BYTES) {
    return Alert.alert(
      "Foto Terlalu Besar",
      `Ukuran foto ${(size/1024).toFixed(0)} KB, batas ${(MAX_BYTES/1024).toFixed(0)} KB. Tolong ambil ulang.`,
      [{ text: "OK", onPress: () => setPhotoUri(null) }]
    );
  }

  const alasan = await popReasonFromStash();

  // 3) retry sekali kalau network fail
  try {
    await submit(alasan);
  } catch (e: any) {
    // coba sekali lagi dengan timeout sedikit lebih longgar
    try {
      await new Promise(r => setTimeout(r, 800));
      await submit(alasan, { retry: true });
    } catch (e2: any) {
      return Alert.alert("Gagal", e2?.message ?? "Jaringan bermasalah. Coba lagi.");
    }
  }
};

  // === Submit ke endpoint (upload + upsert lembur) ===
 const submit = async (alasan: string | null, opt?: { retry?: boolean }) => {
  if (!userId || !coords || !photoUri) throw new Error("Data belum lengkap");

  setSending(true);
  try {
    const fd = new FormData();
    fd.append("user_id", String(userId));
    // selalu kirim lat/lng umum + keluar_lat/lng saat checkout
    fd.append("lat", String(coords.latitude));
    fd.append("lng", String(coords.longitude));
    if (!isMasuk) {
      fd.append("keluar_lat", String(coords.latitude));
      fd.append("keluar_lng", String(coords.longitude));
    }
    const alasanFinal = (alasan ?? "").trim();
    if (alasanFinal) {
      fd.append(isMasuk ? "alasan" : "alasan_keluar", alasanFinal);
    }
    // @ts-ignore RN FormData
    fd.append("foto", { uri: photoUri, name: `${isMasuk ? "masuk" : "keluar"}.jpg`, type: "image/jpeg" } as any);

    const url = `${API_BASE}/absen/${isMasuk ? "checkin" : "checkout"}.php`;
    // console.log("[UPLOAD]", url);

    const res = await fetchWithTimeout(url, { method: "POST", body: fd }, opt?.retry ? 25000 : 20000);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

    let j: any; try { j = JSON.parse(text); } catch { throw new Error(`Server tidak mengirim JSON: ${text.slice(0, 200)}`); }
    if (!j?.success) throw new Error(j?.message || "Gagal mengirim absen");

    // lanjut ke upsert lembur (kodenya tetap yang kamu punya)
    const tanggalFromServer: string | null = j?.tanggal ?? null;
    const jamMasukFromServer: string | null = j?.jam_masuk ?? j?.jamMasuk ?? j?.jam ?? null;
    const jamKeluarFromServer: string | null = j?.jam_keluar ?? j?.jamKeluar ?? j?.jam ?? (isMasuk ? null : new Date().toLocaleTimeString("id-ID", { hour12:false }).replace(/\./g, ":"));

    await callUpsertLembur({
      userId: userId!,
      tanggal: tanggalFromServer,
      isMasuk,
      reason: alasanFinal || null,
      jamMasuk: jamMasukFromServer,
      jamKeluar: jamKeluarFromServer,
    });

    await AsyncStorage.multiRemove(["lembur_alasan_today", "lembur_action"]);
    Alert.alert("Sukses", `Absen ${isMasuk ? "masuk" : "keluar"} terekam`, [
      { text: "OK", onPress: () => router.replace(ABSEN_PATH) },
    ]);
  } finally {
    setSending(false);
  }
};

  const fmtJam = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":");
  const fmtTanggal = now
    .toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    .replace(/\./g, "");

  // booting: belum baca user
  if (booting) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Menyiapkan sesi pengguna…</Text>
      </SafeAreaView>
    );
  }

  // kalau user tidak ada, paksa balik ke login
  if (!userId) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
        <Text style={{ textAlign: "center", marginBottom: 12 }}>Sesi tidak ditemukan. Silakan login lagi.</Text>
        <Pressable onPress={() => router.replace("/Login/LoginScreen")} style={{ padding: 10, backgroundColor: "#1B7F4C", borderRadius: 10 }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Ke Halaman Login</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Menyiapkan lokasi & kamera…</Text>
      </SafeAreaView>
    );
  }

  if (!locationPerm || !cameraPerm?.granted) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
        <Text style={{ textAlign: "center" }}>
          Aplikasi butuh izin lokasi dan kamera untuk melanjutkan.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#2196F3" }}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.clock}>{fmtJam}</Text>
        <Text style={s.headerTitle}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Peta posisi user */}
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          provider={PROVIDER_GOOGLE}
          initialRegion={{
            latitude: coords?.latitude ?? -6.2,
            longitude: coords?.longitude ?? 106.8,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation
          showsMyLocationButton
          showsCompass
          toolbarEnabled
          zoomControlEnabled
          rotateEnabled
          pitchEnabled
        >
          {coords && <Marker coordinate={coords} />}
        </MapView>
      </View>

      {/* Card bawah: foto + info + kirim */}
      <View style={s.card}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={s.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={{ width: 72, height: 72, borderRadius: 36 }} />
            ) : (
              <View style={[s.emptyAvatar]} />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: "800" }}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
            <Text style={{ color: "#6B7280", marginTop: 2 }}>Tanggal dan jam</Text>
            <Text style={{ marginTop: 2 }}>{fmtTanggal} | {fmtJam}</Text>
          </View>
          <Pressable style={s.iconBtn} onPress={takePhoto}>
            <Text style={{ color: "#2196F3", fontWeight: "700" }}>📷</Text>
          </Pressable>
        </View>

        <Pressable onPress={handlePressKirim} disabled={sending || !photoUri} style={[s.submitBtn, (!photoUri || sending) && { opacity: 0.6 }]}>
          <Text style={s.submitText}>{sending ? "Mengirim..." : "Kirim"}</Text>
        </Pressable>
      </View>

     {/* Modal kamera */}
    <Modal visible={showCamera && cameraPerm?.granted} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {cameraPerm?.granted ? (
          <CameraView ref={camRef} facing="front" style={{ flex: 1 }} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff" }}>Izin kamera belum diberikan</Text>
          </View>
        )}
        <View style={{ position: "absolute", bottom: 40, width: "100%", alignItems: "center" }}>
          <Text style={{ color: "#fff" }}>Memotret…</Text>
        </View>
      </View>
    </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    backgroundColor: "#2196F3",
    paddingTop: 8,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  clock: {
    color: "#E6FFED",
    fontSize: 24,
    fontWeight: "800",
  },
  headerTitle: {
    color: "#E6FFED",
    textAlign: "center",
    fontWeight: "700",
    marginTop: 6,
  },

  card: {
    backgroundColor: "#fff",
    margin: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    elevation: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    backgroundColor: "#E5E7EB",
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#E5E7EB",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2196F3",
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: "#488FCC",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontWeight: "800",
  },
});
