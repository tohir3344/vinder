// app/staff/ProsesAbsen.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { router, useLocalSearchParams, type Href } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import NetInfo from "@react-native-community/netinfo";
import { compressImageTo, getFileSize } from "../utils/image";
import { logError, logInfo } from "../utils/logger";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "");
const ABSEN_PATH: Href = "/src/staff/Absen"; // sesuaikan dengan struktur route kamu

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

  const MAX_BYTES = 400 * 1024;

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  // fetch dengan timeout — tanpa signal untuk upload FormData di Android
  function fetchWithTimeout(url: string, opt: RequestInit, ms = 20000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const finalOpt: RequestInit = {
      ...opt,
      ...(Platform.OS === "android" && opt?.body ? {} : { signal: c.signal }),
    };
    return fetch(url, finalOpt).finally(() => clearTimeout(t));
  }

  // ===== Ambil user aktif dari storage =====
  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem("auth");
        const a = s ? JSON.parse(s) : null;
        setUserId(a?.user_id ?? a?.id ?? null);
        await logInfo("PROSES.loadAuth", { userId: a?.user_id ?? a?.id ?? null });
      } catch (e) {
        await logError("PROSES.loadAuth", e);
        setUserId(null);
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
        await logInfo("PROSES.init", { isMasuk });

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
            const region: Region = {
              latitude,
              longitude,
              latitudeDelta: 0.0015,
              longitudeDelta: 0.0015,
            };
            mapRef.current?.animateToRegion(region, 600);
          }
        );
      } catch (e: any) {
        await logError("PROSES.init", e);
        Alert.alert("Gagal", e?.message ?? "Tidak bisa mendapatkan lokasi/kamera");
      } finally {
        setLoading(false);
      }
    })();

    return () => watcher?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== Ambil & hapus stash alasan (kalau ada) ======
  const popReasonFromStash = async (): Promise<string | null> => {
    try {
      const val = await AsyncStorage.getItem("lembur_alasan_today");
      if (val) await AsyncStorage.removeItem("lembur_alasan_today");
      return val ? val.trim() : null;
    } catch (e) {
      await logError("PROSES.popReasonFromStash", e);
      return null;
    }
  };

  // ====== Upsert lembur ke server ======
  async function callUpsertLembur(opts: {
    userId: number;
    tanggal?: string | null;
    isMasuk: boolean;
    reason: string | null;
    jamMasuk?: string | null;
    jamKeluar?: string | null;
  }) {
    const { userId, tanggal, isMasuk, reason, jamMasuk, jamKeluar } = opts;

    const fallbackDate = new Date().toLocaleDateString("sv-SE");
    const payload: Record<string, any> = {
      user_id: userId,
      tanggal: tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? tanggal : fallbackDate,
    };

    if (isMasuk) {
      if (reason && reason.trim()) payload.alasan = reason.trim();
    } else {
      if (reason && reason.trim()) payload.alasan_keluar = reason.trim();
    }

    if (jamMasuk) payload.jam_masuk = jamMasuk;
    if (jamKeluar) payload.jam_keluar = jamKeluar;

    const url = `${API_BASE}/lembur/upsert.php`;
    await logInfo("PROSES.upsertLembur.req", { url, payload });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (!res.ok) {
      await logError("PROSES.upsertLembur.httpError", null, { status: res.status, body: txt });
      throw new Error(`upsert gagal: ${txt}`);
    }

    await logInfo("PROSES.upsertLembur.ok", { status: res.status });
  }

  // ====== Kamera: buka & potret saat siap ======
  const openCamera = async () => {
    try {
      if (!cameraPerm?.granted) {
        const cam = await requestCameraPerm();
        if (!cam?.granted) {
          Alert.alert("Izin Kamera Ditolak", "Kamu harus mengizinkan kamera untuk absen.");
          return;
        }
      }
      setPhotoUri(null);
      setCameraReady(false);
      setShowCamera(true);
      await logInfo("PROSES.openCamera");
    } catch (e: any) {
      await logError("PROSES.openCamera", e);
      Alert.alert("Gagal", e?.message ?? "Tidak dapat membuka kamera.");
    }
  };

  // Begitu kamera siap (onCameraReady), langsung ambil 1 foto
  useEffect(() => {
    if (!(showCamera && cameraReady)) return;

    let cancelled = false;
    (async () => {
      try {
        const pic = await camRef.current?.takePictureAsync({
          quality: 0.6,
          skipProcessing: true,
        });

        if (!pic?.uri) return;

        const out = await compressImageTo(pic.uri, MAX_BYTES);
        if (out.size > MAX_BYTES) {
          Alert.alert(
            "Foto Terlalu Besar",
            "Ukuran foto melebihi batas. Tolong ambil ulang dengan jarak lebih jauh atau pencahayaan lebih baik."
          );
          setPhotoUri(null);
        } else if (!cancelled) {
          setPhotoUri(out.uri);
        }

        await logInfo("PROSES.cameraCaptured", { size: out.size });
      } catch (e: any) {
        await logError("PROSES.cameraCaptured", e);
        Alert.alert("Gagal", e?.message ?? "Gagal mengambil foto");
      } finally {
        if (!cancelled) setShowCamera(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showCamera, cameraReady]);

  // ====== Handler KIRIM ======
  const handlePressKirim = async () => {
    if (!userId) return Alert.alert("Gagal", "User belum terbaca, coba login ulang.");
    if (!coords) return Alert.alert("Gagal", "Lokasi belum terbaca");
    if (!photoUri) return Alert.alert("Gagal", "Ambil foto dulu ya");

    const state = await NetInfo.fetch();
    if (!state.isConnected) {
      return Alert.alert("Tidak Ada Internet", "Periksa koneksi kamu ya.");
    }

    const size = await getFileSize(photoUri);
    if (size > MAX_BYTES) {
      return Alert.alert(
        "Foto Terlalu Besar",
        `Ukuran foto ${(size / 1024).toFixed(0)} KB, batas ${(MAX_BYTES / 1024).toFixed(0)} KB. Tolong ambil ulang.`,
        [{ text: "OK", onPress: () => setPhotoUri(null) }]
      );
    }

    const alasan = await popReasonFromStash();

    try {
      await logInfo("PROSES.handlePressKirim.start", {
        userId,
        isMasuk,
        size,
        hasAlasan: !!alasan,
      });
      await submit(alasan);
    } catch (e: any) {
      await logError("PROSES.handlePressKirim.error1", e);
      try {
        await new Promise((r) => setTimeout(r, 800));
        await submit(alasan, { retry: true });
      } catch (e2: any) {
        await logError("PROSES.handlePressKirim.error2", e2);
        return Alert.alert("Gagal", e2?.message ?? "Jaringan bermasalah. Coba lagi.");
      }
    }
  };

  // ====== Submit ke endpoint (upload + upsert lembur) ======
  const submit = async (alasan: string | null, opt?: { retry?: boolean }) => {
    if (!userId || !coords || !photoUri) throw new Error("Data belum lengkap");

    setSending(true);
    try {
      const fd = new FormData();
      fd.append("user_id", String(userId));
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
      fd.append("foto", {
        uri: photoUri,
        name: `${isMasuk ? "masuk" : "keluar"}.jpg`,
        type: "image/jpeg",
      } as any);

      const url = `${API_BASE}/absen/${isMasuk ? "checkin" : "checkout"}.php`;
      await logInfo("PROSES.submit.req", { url, isMasuk, hasAlasan: !!alasanFinal });

      const res = await fetchWithTimeout(
        url,
        { method: "POST", body: fd },
        opt?.retry ? 25000 : 20000
      );
      const text = await res.text();
      if (!res.ok) {
        await logError("PROSES.submit.httpError", null, {
          status: res.status,
          body: text.slice(0, 200),
        });
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        await logError("PROSES.submit.notJson", null, text.slice(0, 200));
        throw new Error(`Server tidak mengirim JSON: ${text.slice(0, 200)}`);
      }
      if (!j?.success) {
        await logError("PROSES.submit.serverFail", null, j);
        throw new Error(j?.message || "Gagal mengirim absen");
      }

      const tanggalFromServer: string | null = j?.tanggal ?? null;
      const jamMasukFromServer: string | null =
        j?.jam_masuk ?? j?.jamMasuk ?? j?.jam ?? null;
      const jamKeluarFromServer: string | null =
        j?.jam_keluar ??
        j?.jamKeluar ??
        j?.jam ??
        (isMasuk
          ? null
          : new Date()
              .toLocaleTimeString("id-ID", { hour12: false })
              .replace(/\./g, ":"));

      await callUpsertLembur({
        userId: userId!,
        tanggal: tanggalFromServer,
        isMasuk,
        reason: alasanFinal || null,
        jamMasuk: jamMasukFromServer,
        jamKeluar: jamKeluarFromServer,
      });

      await AsyncStorage.multiRemove(["lembur_alasan_today", "lembur_action"]);
      await logInfo("PROSES.submit.success", {
        tanggalFromServer,
        jamMasukFromServer,
        jamKeluarFromServer,
      });

      Alert.alert("Sukses", `Absen ${isMasuk ? "masuk" : "keluar"} terekam`, [
        { text: "OK", onPress: () => router.replace(ABSEN_PATH) },
      ]);
    } catch (e: any) {
      await logError("PROSES.submit.error", e);
      throw e;
    } finally {
      setSending(false);
    }
  };

  const fmtJam = now
    .toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" })
    .replace(/\./g, ":");
  const fmtTanggal = now
    .toLocaleDateString("id-ID", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
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
        <Text style={{ textAlign: "center", marginBottom: 12 }}>
          Sesi tidak ditemukan. Silakan login lagi.
        </Text>
        <Pressable
          onPress={() => router.replace("/Login/LoginScreen")}
          style={{ padding: 10, backgroundColor: "#1B7F4C", borderRadius: 10 }}
        >
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
      <View style={styles.header}>
        <Text style={styles.clock}>{fmtJam}</Text>
        <Text style={styles.headerTitle}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Peta posisi user */}
      <View style={{ flex: 1 }}>
        {!showCamera && (
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
        )}
      </View>

      {/* Card bawah: foto + info + kirim */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={styles.avatar}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={{ width: 72, height: 72, borderRadius: 36 }}
              />
            ) : (
              <View style={styles.emptyAvatar} />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: "800" }}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
            <Text style={{ color: "#6B7280", marginTop: 2 }}>Tanggal dan jam</Text>
            <Text style={{ marginTop: 2 }}>
              {fmtTanggal} | {fmtJam}
            </Text>
          </View>
          <Pressable style={styles.iconBtn} onPress={openCamera}>
            <Text style={{ color: "#2196F3", fontWeight: "700" }}>📷</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handlePressKirim}
          disabled={sending || !photoUri}
          style={[styles.submitBtn, (!photoUri || sending) && { opacity: 0.6 }]}
        >
          <Text style={styles.submitText}>{sending ? "Mengirim..." : "Kirim"}</Text>
        </Pressable>
      </View>

      {/* Modal kamera */}
      <Modal
        visible={showCamera && cameraPerm?.granted}
        transparent={false}
        presentationStyle="fullScreen"
        animationType="slide"
        onRequestClose={() => setShowCamera(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {cameraPerm?.granted ? (
            <CameraView
              ref={camRef}
              facing="front"
              style={{ flex: 1 }}
              onCameraReady={() => setCameraReady(true)}
            />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff" }}>Izin kamera belum diberikan</Text>
            </View>
          )}
          <View
            style={{
              position: "absolute",
              bottom: 40,
              width: "100%",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff" }}>
              {cameraReady ? "Memotret…" : "Menyiapkan kamera…"}
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
