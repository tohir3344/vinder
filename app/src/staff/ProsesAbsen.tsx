// app/staff/ProsesAbsen.tsx
import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image, Alert, ActivityIndicator, Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import * as Location from "expo-location";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, router, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "../../src/config";

// ==== GANTI kalau Absen.tsx kamu tidak di dalam /src ====
const ABSEN_PATH: Href = "/src/staff/Absen";
// const ABSEN_PATH: Href = "/staff/Absen";

export default function ProsesAbsen() {
  const { type } = useLocalSearchParams<{ type?: "masuk" | "keluar" }>();
  const isMasuk = (type ?? "masuk") === "masuk";

  const [now, setNow] = useState(new Date());
  const [booting, setBooting] = useState(true);   // baca auth dari storage
  const [loading, setLoading] = useState(true);   // izin + lokasi/kamera
  const [sending, setSending] = useState(false);

  const [userId, setUserId] = useState<number | null>(null);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationPerm, setLocationPerm] = useState(false);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();

  const mapRef = useRef<MapView | null>(null);
  const camRef = useRef<React.ElementRef<typeof CameraView> | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);

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

  // jam realtime
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
          if (!cam?.granted) throw new Error("Izin kamera ditolak");
        }

        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1500,
            distanceInterval: 2,
          },
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
        const pic = await camRef.current?.takePictureAsync({ quality: 0.7 });
        setShowCamera(false);
        if (!pic?.uri) return;
        setPhotoUri(pic.uri);
      }, 350);
    } catch (e: any) {
      setShowCamera(false);
      Alert.alert("Gagal", e?.message ?? "Gagal mengambil foto");
    }
  };

  const submit = async () => {
    if (!userId) return Alert.alert("Gagal", "User belum terbaca, coba login ulang.");
    if (!coords) return Alert.alert("Gagal", "Lokasi belum terbaca");
    if (!photoUri) return Alert.alert("Gagal", "Ambil foto dulu ya");

    try {
      setSending(true);
      const fd = new FormData();
      fd.append("user_id", String(userId));
      fd.append("lat", String(coords.latitude));
      fd.append("lng", String(coords.longitude));
      // @ts-ignore RN FormData file
      fd.append("foto", { uri: photoUri, name: `${isMasuk ? "masuk" : "keluar"}.jpg`, type: "image/jpeg" });

      const url = `${API_BASE}/absen/${isMasuk ? "checkin" : "checkout"}.php`;
      const res = await fetch(url, { method: "POST", body: fd });
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { throw new Error(`Server tidak mengirim JSON. ${text.slice(0,120)}`); }
      if (!j?.success) throw new Error(j?.message || "Gagal mengirim absen");

      Alert.alert("Sukses", `Absen ${isMasuk ? "masuk" : "keluar"} terekam`, [
        { text: "OK", onPress: () => router.replace(ABSEN_PATH) },
      ]);
    } catch (e: any) {
      Alert.alert("Gagal", e?.message ?? "Terjadi kesalahan");
    } finally {
      setSending(false);
    }
  };

  const fmtJam = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":");
  const fmtTanggal = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#E9F0ED" }}>
      {/* Header hijau */}
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
            <Text style={{ color: "#1B7F4C", fontWeight: "700" }}>📷</Text>
          </Pressable>
        </View>

        <Pressable onPress={submit} disabled={sending || !photoUri} style={[s.submitBtn, (!photoUri || sending) && { opacity: 0.6 }]}>
          <Text style={s.submitText}>{sending ? "Mengirim..." : "Kirim"}</Text>
        </Pressable>
      </View>

      {/* Modal kamera */}
      <Modal visible={showCamera} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView ref={camRef} facing="front" style={{ flex: 1 }} />
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
    backgroundColor: "#1B7F4C",
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
    borderColor: "#1B7F4C",
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: "#1B7F4C",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontWeight: "800",
  },
});
