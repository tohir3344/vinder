// app/src/staff/ProsesAbsen.tsx
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
  Dimensions,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import NetInfo from "@react-native-community/netinfo";
import { compressImageTo, getFileSize } from "../utils/image";
import { logError, logInfo, logWarn } from "../utils/logger";

import { captureRef } from "react-native-view-shot";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "");
const ABSEN_PATH: Href = "/src/staff/Absen";

export default function ProsesAbsen() {
  const { type } = useLocalSearchParams<{ type?: "masuk" | "keluar" }>();
  const isMasuk = (type ?? "masuk") === "masuk";

  const [now, setNow] = useState(new Date());
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [userId, setUserId] = useState<number | null>(null);

  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  // 🔥 STATE BARU: Buat nyimpen alamat teks (Jalan, Kota, dll)
  const [addressText, setAddressText] = useState<string | null>(null);

  const [locationPerm, setLocationPerm] = useState(false);
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();

  const mapRef = useRef<MapView | null>(null);
  const camRef = useRef<React.ElementRef<typeof CameraView> | null>(null);
  const watermarkRef = useRef<View | null>(null);

  const MAX_BYTES = 400 * 1024;

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const [rawImage, setRawImage] = useState<string | null>(null);
  const [processingWatermark, setProcessingWatermark] = useState(false);
  const [screenFlash, setScreenFlash] = useState(false);

  function fetchWithTimeout(url: string, opt: RequestInit, ms = 60000) {
    const hasAbort = typeof AbortController !== "undefined";
    const hasBody = !!opt?.body;

    if (!hasAbort || (Platform.OS === "android" && hasBody)) {
      return fetch(url, opt);
    }

    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const finalOpt: RequestInit = { ...opt, signal: c.signal };

    return fetch(url, finalOpt).finally(() => clearTimeout(t));
  }

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem("auth");
        const a = s ? JSON.parse(s) : null;
        const uid = a?.user_id ?? a?.id ?? null;
        setUserId(uid);
        await logInfo("PROSES.loadAuth", { userId: uid });
      } catch (e) {
        await logError("PROSES.loadAuth", e);
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

  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;

    (async () => {
      try {
        await logInfo("PROSES.init", { isMasuk });

        const loc = await Location.requestForegroundPermissionsAsync();
        setLocationPerm(loc.status === "granted");
        if (loc.status !== "granted") throw new Error("Izin lokasi ditolak. Aktifkan GPS dan izinkan aplikasi.");

        if (!cameraPerm?.granted) {
          const cam = await requestCameraPerm();
          if (!cam?.granted) {
            Alert.alert("Izin Kamera Ditolak", "Kamu harus mengizinkan kamera untuk absen.");
            return;
          }
        }

        // Watch Location
        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 2000, // Cek tiap 2 detik
            distanceInterval: 5, // Atau geser 5 meter
          },
          async (pos) => {
            const { latitude, longitude } = pos.coords;
            setCoords({ latitude, longitude });

            // 🔥 FITUR BARU: REVERSE GEOCODE (Cari Nama Jalan)
            try {
                const addresses = await Location.reverseGeocodeAsync({ latitude, longitude });
                if (addresses.length > 0) {
                    const addr = addresses[0];
                    // Susun format alamat yang enak dibaca
                    // Contoh: Jl. Sudirman, Jakarta Selatan
                    const parts = [
                        addr.street, 
                        addr.district, 
                        addr.city, 
                        addr.region
                    ].filter(Boolean); // Hapus yang null/kosong
                    
                    if (parts.length > 0) {
                        setAddressText(parts.join(", "));
                    }
                }
            } catch (err) {
                // Kalo gagal geocode (misal ga ada internet), biarin addressText null (nanti fallback ke angka lat/long)
                console.log("Reverse geocode error:", err);
            }

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
        Alert.alert("Gagal Lokasi/Kamera", e?.message ?? "Tidak bisa mendapatkan lokasi/kamera. Cek izin aplikasi.");
      } finally {
        setLoading(false);
      }
    })();

    return () => watcher?.remove();
  }, []);

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
      tanggal:
        tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? tanggal : fallbackDate,
    };

    if (isMasuk) {
      if (reason && reason.trim()) payload.alasan = reason.trim();
    } else {
      if (reason && reason.trim()) payload.alasan_keluar = reason.trim();
    }

    if (jamMasuk) payload.jam_masuk = jamMasuk;
    if (jamKeluar) payload.jam_keluar = jamKeluar;

    const url = `${API_BASE}/lembur/upsert.php`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`Upsert lembur gagal: ${txt}`);
    } catch (err) {
      console.log("Upsert lembur silent fail:", err);
    }
  }

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
      setRawImage(null);
      setCameraReady(false);
      setShowCamera(true);
      setScreenFlash(false); 
      await logInfo("PROSES.openCamera");
    } catch (e: any) {
      await logError("PROSES.openCamera", e);
      Alert.alert("Gagal", e?.message ?? "Tidak dapat membuka kamera.");
    }
  };

  // PROCESS 1 - AMBIL FOTO + FLASH MANUAL
  useEffect(() => {
    if (!(showCamera && cameraReady)) return;

    let cancelled = false;
    (async () => {
      try {
        await new Promise((r) => setTimeout(r, 500));
        if (cancelled) return;

        setScreenFlash(true);
        
        await new Promise((r) => setTimeout(r, 600)); 
        if (cancelled) return;

        const camera = camRef.current;
        if (!camera) return;

        const pic = await camera.takePictureAsync({
          quality: 0.8,
          skipProcessing: true,
        });

        setScreenFlash(false);

        if (!pic?.uri) return;

        if (!cancelled) {
            setRawImage(pic.uri);
        }

      } catch (e: any) {
        setScreenFlash(false);
        Alert.alert("Gagal", e?.message ?? "Gagal mengambil foto");
        setShowCamera(false);
      }
    })();

    return () => { cancelled = true; };
  }, [showCamera, cameraReady]);

  // PROCESS 2 - WATERMARKING
  useEffect(() => {
    if (!rawImage) return;

    const processWatermark = async () => {
        setProcessingWatermark(true);
        try {
            await new Promise((r) => setTimeout(r, 1000));

            const uriWatermarked = await captureRef(watermarkRef, {
                format: "jpg",
                quality: 0.8,
                result: "tmpfile"
            });

            const out = await compressImageTo(uriWatermarked, MAX_BYTES);
            
            setPhotoUri(out.uri);
            setShowCamera(false);
            setRawImage(null);

        } catch (e) {
            console.error("Watermark Error:", e);
            Alert.alert("Gagal", "Gagal memproses watermark foto.");
            setShowCamera(false);
        } finally {
            setProcessingWatermark(false);
        }
    };

    processWatermark();
  }, [rawImage]);


  const handlePressKirim = async () => {
    if (!userId) return Alert.alert("Gagal", "User belum terbaca, coba login ulang.");
    if (!coords) return Alert.alert("Gagal", "Lokasi belum terbaca. Cek GPS.");
    if (!photoUri) return Alert.alert("Gagal", "Ambil foto dulu ya");

    const state = await NetInfo.fetch();
    if (!state.isConnected) {
      return Alert.alert("Tidak Ada Internet", "Periksa koneksi kamu ya.");
    }

    const size = await getFileSize(photoUri);
    if (size > MAX_BYTES + 50000) {
      return Alert.alert(
        "Foto Terlalu Besar",
        "Ukuran foto melebihi batas. Tolong ambil ulang.",
        [{ text: "OK", onPress: () => setPhotoUri(null) }]
      );
    }

    const alasan = await popReasonFromStash();

    try {
      await submit(alasan);
    } catch (e: any) {
      const errorMsg = e?.message || String(e);
      console.error("🔥 ERROR KIRIM ABSEN:", errorMsg); 
      
      if (errorMsg.includes("Network request failed")) {
          Alert.alert(
              "Koneksi Lambat", 
              "Absen mungkin sudah terkirim tapi respon server lambat. Cek riwayat absen sebelum mencoba lagi.",
              [{ text: "Cek Riwayat", onPress: () => router.replace(ABSEN_PATH) }]
          );
      } else {
          Alert.alert("Gagal Kirim", errorMsg);
      }
    }
  };

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
      
      const res = await fetchWithTimeout(
        url,
        { method: "POST", body: fd },
        opt?.retry ? 90000 : 60000 
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${text.slice(0, 100)}`);

      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        throw new Error(`Server error (not JSON): ${text.slice(0, 100)}`);
      }
      if (!j?.success) throw new Error(j?.message || "Gagal mengirim absen");

      const tanggalFromServer: string | null = j?.tanggal ?? null;
      const jamMasukFromServer: string | null = j?.jam_masuk ?? j?.jamMasuk ?? null;
      const jamKeluarFromServer: string | null = j?.jam_keluar ?? j?.jamKeluar ?? (isMasuk ? null : new Date().toLocaleTimeString("id-ID").replace(/\./g, ":"));

      callUpsertLembur({
        userId: userId!,
        tanggal: tanggalFromServer,
        isMasuk,
        reason: alasanFinal || null,
        jamMasuk: jamMasukFromServer,
        jamKeluar: jamKeluarFromServer,
      }).catch(e => console.log("Lembur ignore:", e));

      await AsyncStorage.multiRemove(["lembur_alasan_today", "lembur_action"]);

      Alert.alert("Sukses", `Absen ${isMasuk ? "masuk" : "keluar"} terekam`, [
        { text: "OK", onPress: () => router.replace(ABSEN_PATH) },
      ]);
    } catch (e: any) {
      throw e;
    } finally {
      setSending(false);
    }
  };

  const fmtJam = now.toLocaleTimeString("id-ID", { hour12: false, hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":");
  const fmtTanggal = now.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).replace(/\./g, "");

  const watermarkTime = `${now.toLocaleDateString("id-ID")} ${now.toLocaleTimeString("id-ID")}`;
  
  // 🔥 UPDATE: Gunakan Alamat kalau ada, kalau belum ada baru pakai Angka
  const watermarkLoc = addressText 
    ? addressText // Tampilkan Nama Jalan/Kota
    : (coords ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}` : "Mencari lokasi...");

  if (booting) return <ActivityIndicator style={{flex:1}} />;
  if (!userId) return <View style={{flex:1, justifyContent:'center'}}><Text style={{textAlign:'center'}}>User tidak ditemukan</Text></View>;
  if (loading) return <ActivityIndicator style={{flex:1}} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#2196F3" }}>
      <View style={styles.header}>
        <Text style={styles.clock}>{fmtJam}</Text>
        <Text style={styles.headerTitle}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={{ flex: 1 }}>
        {coords ? (
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            initialRegion={{
              latitude: coords.latitude,
              longitude: coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            showsUserLocation
            showsMyLocationButton
          >
            <Marker coordinate={coords} />
          </MapView>
        ) : (
          <ActivityIndicator style={{marginTop: 50}} />
        )}
      </View>

      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={styles.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={{ width: 72, height: 72, borderRadius: 36 }} />
            ) : (
              <View style={styles.emptyAvatar} />
            )}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: "800" }}>{`Absen ${isMasuk ? "Masuk" : "Keluar"}`}</Text>
            {/* Tampilkan juga alamat di UI biar user tau */}
            <Text style={{ color: "#444", fontSize: 11, marginTop:2 }} numberOfLines={1}>{addressText || "Mencari alamat..."}</Text>
            <Text style={{ marginTop: 2 }}>{fmtTanggal} | {fmtJam}</Text>
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
        onRequestClose={() => { if(!processingWatermark) setShowCamera(false); }}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          {cameraPerm?.granted ? (
            <CameraView
              ref={camRef}
              facing="front"
              style={{ flex: 1 }}
              onCameraReady={() => setCameraReady(true)}
            />
          ) : null}
          
          {screenFlash && (
            <View 
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                    backgroundColor: 'white', zIndex: 99 
                }} 
            />
          )}

          <View style={{ position: "absolute", bottom: 40, width: "100%", alignItems: "center", zIndex: 100 }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: 'bold' }}>
              {processingWatermark ? "Memproses Watermark..." : (cameraReady ? "Tahan sebentar..." : "Menyiapkan...")}
            </Text>
          </View>
        </View>
      </Modal>

      {/* AREA RAHASIA BUAT WATERMARK */}
      {rawImage && (
        <View
            ref={watermarkRef}
            collapsable={false}
            style={{
                position: "absolute",
                top: 0,
                left: -9999,
                width: 800,  
                height: 1066, 
                backgroundColor: "black",
                justifyContent: 'center',
                alignItems: 'center',
            }}
        >
            <Image 
                source={{ uri: rawImage }} 
                fadeDuration={0}
                style={{ position: 'absolute', width: "100%", height: "100%", resizeMode: "cover" }} 
            />
            
            {/* 🔥 WATERMARK UPDATE: TENGAH, ALAMAT JELAS, TANPA ID 🔥 */}
            <View style={{
                backgroundColor: 'rgba(0,0,0,0.6)', 
                paddingVertical: 25,
                paddingHorizontal: 30,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                width: '85%' // Biar ga terlalu mepet pinggir
            }}>
                {/* JAM GEDE */}
                <Text style={{color:'white', fontWeight:'900', fontSize: 40, marginBottom: 10, textAlign: 'center', textShadowColor:'rgba(0,0,0,0.8)', textShadowRadius: 5}}>
                    {now.toLocaleTimeString("id-ID")}
                </Text>
                
                {/* TANGGAL */}
                <Text style={{color:'#ddd', fontWeight:'600', fontSize: 22, marginBottom: 15, textAlign: 'center'}}>
                    {now.toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>

                {/* LOKASI (ALAMAT / KOORDINAT) */}
                <Text style={{color:'#E6FFED', fontSize: 20, fontWeight:'bold', textAlign: 'center', lineHeight: 28}}>
                    📍 {watermarkLoc}
                </Text>
                
                {/* Label IN/OUT Simpel */}
                <Text style={{color:'yellow', fontSize: 24, fontWeight:'900', marginTop: 15, textAlign: 'center'}}>
                    {isMasuk ? "CHECK IN" : "CHECK OUT"}
                </Text>
            </View>
        </View>
      )}

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