import React, { useState, useEffect } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
    ScrollView,
    Image,
    Alert,
    ActivityIndicator
} from "react-native";
import { router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from 'expo-location';
import { API_BASE } from "../../config";

// --- KONFIGURASI KANTOR ---
const OFFICE_LAT = -6.1771499;
const OFFICE_LONG = 107.0225339;
const MAX_RADIUS_METER = 500;

// Fungsi Hitung Jarak
const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// 🔥 FUNGSI TANGGAL LOKAL (WIB AMAN) 🔥
// Mengambil YYYY-MM-DD sesuai jam HP, bukan jam server/UTC
const getLocalTodayYMD = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export default function LemburOverStaff() {
    const [keterangan, setKeterangan] = useState("");
    const [foto, setFoto] = useState(null);
    const [loading, setLoading] = useState(false);

    // User State
    const [currentUserId, setCurrentUserId] = useState(null);
    const [userName, setUserName] = useState("Staff");
    const [userRate, setUserRate] = useState(0);

    // Waktu
    const [currentTime, setCurrentTime] = useState("");
    const [currentDate, setCurrentDate] = useState("");
    const [totalJamEstimasi, setTotalJamEstimasi] = useState("0.00");
    const [totalMenit, setTotalMenit] = useState(0);

    // Status Validasi
    const [isLate, setIsLate] = useState(false);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const [distance, setDistance] = useState(null);
    const [inRadius, setInRadius] = useState(false);
    const [locationLoading, setLocationLoading] = useState(true);
    const [hasClockedOut, setHasClockedOut] = useState(false); // 🔥 STATUS ABSEN PULANG
    const [checkingAbsen, setCheckingAbsen] = useState(true); // Loading cek absen

    const JAM_MULAI = 20;
    const MENIT_MULAI = 0;

    useEffect(() => {
        const loadInitialData = async () => {
            let userIdFound = null;
            try {
                const authData = await AsyncStorage.getItem("auth");
                if (authData) {
                    const user = JSON.parse(authData);

                    // 1. Cari ID
                    userIdFound = user.id || user.user_id || (user.data && user.data.id);
                    setCurrentUserId(userIdFound);

                    const realName = user.nama_lengkap || user.nama || user.name || user.username || (user.data && user.data.nama_lengkap) || "Staff";
                    setUserName(realName);

                    let rate = parseInt(user.lembur || "0");
                    const gajiPokok = user.gaji_pokok || (user.data && user.data.gaji_pokok);
                    if (rate === 0 && gajiPokok) {
                        rate = Math.floor(parseInt(gajiPokok) / 173);
                    }
                    setUserRate(rate);
                }
            } catch (e) { console.log("Error load user", e); }

            // 2. Cek Status Kirim (Lokal)
            if (userIdFound) {
                try {
                    const todayStr = new Date().toLocaleDateString("id-ID");
                    const storageKey = `last_lembur_over_date_${userIdFound}`;
                    const savedStatus = await AsyncStorage.getItem(storageKey);

                    if (savedStatus === todayStr) {
                        setHasSubmitted(true);
                    } else {
                        setHasSubmitted(false);
                    }
                } catch (e) { console.log("Error cek status lokal", e); }

                // 3. 🔥 CEK STATUS ABSEN PULANG KE SERVER 🔥
                try {
                    setCheckingAbsen(true);
                    // Gunakan fungsi getLocalTodayYMD() biar tanggalnya akurat
                    const todayYMD = getLocalTodayYMD();

                    const url = `${API_BASE}/absen/check_absen_today.php?user_id=${userIdFound}&tanggal=${todayYMD}`;
                    console.log("Cek Absen:", url);

                    const res = await fetch(url);
                    const json = await res.json();
                    console.log("Respon Absen:", json);

                    if (json.success && json.data) {
                        const jk = json.data.jam_keluar;
                        // Jika jam_keluar BUKAN null dan BUKAN "00:00:00", berarti SUDAH PULANG
                        if (jk && jk !== "00:00:00" && jk !== "00:00") {
                            setHasClockedOut(true);
                        } else {
                            setHasClockedOut(false);
                        }
                    }
                } catch (e) {
                    console.log("Gagal cek status pulang", e);
                } finally {
                    setCheckingAbsen(false);
                }
            } else {
                setCheckingAbsen(false);
            }

            // 4. Cek Lokasi
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    Alert.alert("Izin Ditolak", "Aplikasi butuh akses lokasi.");
                    setInRadius(false);
                    setLocationLoading(false);
                    return;
                }

                let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                const dist = getDistance(loc.coords.latitude, loc.coords.longitude, OFFICE_LAT, OFFICE_LONG);
                setDistance(dist);
                setInRadius(dist <= MAX_RADIUS_METER);
            } catch (error) {
                Alert.alert("GPS Error", "Pastikan GPS aktif.");
            } finally {
                setLocationLoading(false);
            }
        };

        loadInitialData();

        // Timer
        const now = new Date();
        setCurrentDate(now.toLocaleDateString("id-ID", {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }));

        const interval = setInterval(() => {
            const d = new Date();
            setCurrentTime(d.toLocaleTimeString("id-ID", {
                hour: "2-digit", minute: "2-digit", hour12: false,
            }));

            const jamSekarang = d.getHours();
            const menitSekarang = d.getMinutes();

            // Kunci 08:00 - 19:59
            if (jamSekarang >= 8 && jamSekarang < 20) {
                setIsLate(true);
            } else {
                setIsLate(false);
            }

            const currentMinutesTotal = (jamSekarang * 60) + menitSekarang;
            const startMinutesTotal = (JAM_MULAI * 60) + MENIT_MULAI;
            let diffMinutes = currentMinutesTotal - startMinutesTotal;
            if (diffMinutes < 0) { diffMinutes += (24 * 60); }

            setTotalMenit(diffMinutes);
            const durasiJam = diffMinutes / 60;
            setTotalJamEstimasi(durasiJam.toFixed(2));
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const ambilFoto = async () => {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (permissionResult.granted === false) {
            Alert.alert("Izin Ditolak", "Akses kamera dibutuhkan.");
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [3, 4],
            quality: 0.5,
        });
        if (!result.canceled) setFoto(result.assets[0]);
    };

    const handleSubmit = async () => {
        // 🔥 VALIDASI KUAT 🔥
        if (checkingAbsen) return Alert.alert("Tunggu", "Sedang memuat status absen...");
        if (hasClockedOut) return Alert.alert("Akses Ditolak", "Anda sudah absen pulang hari ini.");
        if (hasSubmitted) return Alert.alert("Sudah Kirim", "Anda sudah input lembur hari ini.");
        if (isLate) return Alert.alert("Waktu Habis", "Batas input jam 08:00 pagi.");
        if (!inRadius) return Alert.alert("Lokasi Salah", "Di luar radius kantor.");

        if (!currentUserId) return Alert.alert("Error", "ID User tidak valid, login ulang.");
        if (!foto) return Alert.alert("Error", "Foto bukti wajib diisi!");
        if (!keterangan.trim()) return Alert.alert("Error", "Isi keterangan.");

        setLoading(true);
        try {
            const formData = new FormData();
            formData.append("user_id", String(currentUserId));
            // Gunakan tanggal lokal untuk kirim data juga
            formData.append("tanggal", getLocalTodayYMD());
            formData.append("jam_masuk", "20:00");
            formData.append("jam_keluar", currentTime);
            formData.append("jam_mulai", "20:00");
            formData.append("jam_selesai", currentTime);
            formData.append("keterangan", keterangan);
            formData.append("total_jam", totalJamEstimasi);
            const estimasiPendapatan = Math.ceil(parseFloat(totalJamEstimasi) * userRate * 2);
            formData.append("total_upah", String(estimasiPendapatan));
            formData.append("total_menit", String(totalMenit));

            const filename = foto.uri.split("/").pop();
            const match = /\.(\w+)$/.exec(filename || "");
            const type = match ? `image/${match[1]}` : `image/jpeg`;
            formData.append("foto_bukti", { uri: foto.uri, name: filename || "bukti.jpg", type });

            const response = await fetch(`${API_BASE}/lembur/save_lembur_over.php`, {
                method: "POST",
                body: formData,
                headers: { "Content-Type": "multipart/form-data" },
            });

            const result = await response.json();
            if (result.success) {
                const todayStr = new Date().toLocaleDateString("id-ID");
                const storageKey = `last_lembur_over_date_${currentUserId}`;
                await AsyncStorage.setItem(storageKey, todayStr);

                setHasSubmitted(true);
                Alert.alert("Sukses", "Data tersimpan!", [{ text: "OK", onPress: () => router.back() }]);
            } else {
                Alert.alert("Gagal", result.message);
            }
        } catch (error) {
            Alert.alert("Error", "Gagal koneksi ke server.");
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIKA TEXT TOMBOL & WARNA ---
    const getButtonText = () => {
        if (loading) return "Mengirim...";
        if (checkingAbsen) return "Memuat Status Absen...";
        if (hasClockedOut) return "ANDA TIDAK BISA INPUT (Sudah Pulang)"; // 🔥 INI TEXT YG BAPAK MAU
        if (hasSubmitted) return "SUDAH DIKIRIM (Terkunci)";
        if (isLate) return "MAKSIMAL JAM 08.00";
        if (locationLoading) return "Mencari Lokasi...";
        if (!inRadius) return "DI LUAR RADIUS KANTOR";
        return "SIMPAN LEMBUR LANJUTAN";
    };

    // 🔥 TOMBOL DISABLE JIKA SUDAH PULANG (hasClockedOut)
    const isButtonDisabled = loading || isLate || hasSubmitted || !inRadius || locationLoading || hasClockedOut || checkingAbsen;

    return (
        <View style={styles.container}>
            <StatusBar backgroundColor="#A51C24" barStyle="light-content" />

            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Lembur Over</Text>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.userSection}>
                    <Text style={styles.greeting}>Halo,</Text>
                    <Text style={styles.userName}>{userName}</Text>
                </View>

                {/* Radius Box */}
                <View style={[styles.radiusBox, inRadius ? styles.radiusOk : styles.radiusFail]}>
                    <MaterialCommunityIcons
                        name={inRadius ? "map-marker-check" : "map-marker-remove"}
                        size={24}
                        color={inRadius ? "#15803d" : "#b91c1c"}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.radiusTitle, { color: inRadius ? "#15803d" : "#b91c1c" }]}>
                            {locationLoading ? "Mencari Lokasi..." : (inRadius ? "Dalam Radius Kantor" : "Di Luar Radius Kantor")}
                        </Text>
                        {!locationLoading && (
                            <Text style={styles.radiusSubtitle}>
                                Jarak: {distance ? distance.toFixed(0) : 0} meter (Max {MAX_RADIUS_METER}m)
                            </Text>
                        )}
                    </View>
                </View>

                {/* Info Status Absen */}
                {hasClockedOut && (
                    <View style={styles.warningBox}>
                        <MaterialCommunityIcons name="clock-remove-outline" size={24} color="#b91c1c" />
                        <Text style={styles.warningText}>Anda terdeteksi sudah absen pulang hari ini. Tidak dapat melakukan input lembur over.</Text>
                    </View>
                )}

                <View style={styles.card}>
                    <View style={styles.dateContainer}>
                        <MaterialCommunityIcons name="calendar-month" size={20} color="#A51C24" />
                        <Text style={styles.dateText}>{currentDate}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.rowInfo}>
                        <View>
                            <Text style={styles.label}>Mulai</Text>
                            <Text style={styles.timeValueMain}>20:00</Text>
                        </View>
                        <MaterialCommunityIcons name="arrow-right" size={24} color="#ccc" />
                        <View>
                            <Text style={styles.label}>Sekarang</Text>
                            <Text style={[styles.timeValueMain, { color: isLate ? "#94a3b8" : "#A51C24" }]}>
                                {currentTime || "--:--"}
                            </Text>
                        </View>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Keterangan</Text>
                <TextInput
                    style={styles.inputArea}
                    placeholder="Tulis aktivitas lembur..."
                    multiline
                    value={keterangan}
                    onChangeText={setKeterangan}
                    editable={!isButtonDisabled}
                />

                <Text style={styles.sectionTitle}>Foto Bukti</Text>
                <TouchableOpacity
                    style={[styles.photoBox, isButtonDisabled && { backgroundColor: '#f1f5f9' }]}
                    onPress={!isButtonDisabled ? ambilFoto : null}
                    disabled={isButtonDisabled}
                >
                    {foto ? (
                        <Image source={{ uri: foto.uri }} style={styles.previewImage} />
                    ) : (
                        <View style={styles.photoPlaceholder}>
                            <MaterialCommunityIcons name="camera" size={40} color={isButtonDisabled ? "#cbd5e1" : "#64748b"} />
                            <Text style={[styles.photoText, isButtonDisabled && { color: "#cbd5e1" }]}>
                                {isButtonDisabled ? "Terkunci" : "Ambil Foto"}
                            </Text>
                        </View>
                    )}
                </TouchableOpacity>

                <View style={styles.summaryContainer}>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Total Durasi:</Text>
                        <Text style={[styles.summaryValue, isButtonDisabled && { color: '#64748b' }]}>
                            {totalMenit} Menit
                        </Text>
                    </View>
                    <Text style={{ textAlign: 'right', color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                        (Setara {totalJamEstimasi} Jam)
                    </Text>
                </View>

            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity
                    style={[
                        styles.submitBtn,
                        isButtonDisabled && { backgroundColor: "#94a3b8" }
                    ]}
                    onPress={handleSubmit}
                    disabled={isButtonDisabled}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.submitText}>{getButtonText()}</Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f8fafc" },
    header: {
        backgroundColor: "#A51C24",
        paddingTop: StatusBar.currentHeight || 40,
        paddingBottom: 20,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
    },
    backBtn: { marginRight: 15 },
    headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
    content: { flex: 1, padding: 20 },
    userSection: { marginBottom: 20 },
    greeting: { fontSize: 14, color: "#64748b" },
    userName: { fontSize: 22, fontWeight: "bold", color: "#1e293b" },
    card: {
        backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, elevation: 3,
    },
    radiusBox: {
        flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 20,
        borderWidth: 1,
    },
    radiusOk: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
    radiusFail: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
    radiusTitle: { fontWeight: 'bold', fontSize: 14 },
    radiusSubtitle: { fontSize: 12, color: '#475569' },
    // 🔥 Warning Box Style
    warningBox: {
        flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12,
        backgroundColor: '#fef2f2', borderColor: '#f87171', borderWidth: 1, marginBottom: 20, gap: 10
    },
    warningText: { color: '#b91c1c', fontSize: 13, flex: 1, fontWeight: '600' },

    dateContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    dateText: { fontSize: 16, fontWeight: "bold", color: "#334155", marginLeft: 8 },
    divider: { height: 1, backgroundColor: "#f1f5f9", marginBottom: 15 },
    rowInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { fontSize: 12, color: "#64748b", marginBottom: 4 },
    timeValueMain: { fontSize: 24, fontWeight: "900", color: "#1e293b" },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: "#334155", marginBottom: 10, marginTop: 10 },
    inputArea: {
        backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0",
        borderRadius: 12, padding: 15, fontSize: 14, color: "#334155", minHeight: 100,
    },
    photoBox: {
        height: 250,
        backgroundColor: "#e2e8f0", borderRadius: 12,
        overflow: "hidden", justifyContent: "center", alignItems: "center",
        borderWidth: 1, borderColor: "#cbd5e1", borderStyle: "dashed",
    },
    photoPlaceholder: { alignItems: "center" },
    photoText: { color: "#64748b", marginTop: 5, fontWeight: "600" },
    previewImage: { width: "100%", height: "100%", resizeMode: "cover" },
    summaryContainer: {
        marginTop: 25, backgroundColor: "#fff", borderRadius: 12, padding: 20,
        borderWidth: 1, borderColor: "#e2e8f0", elevation: 2, marginBottom: 20
    },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    summaryLabel: { fontSize: 16, color: "#64748b", fontWeight: "600" },
    summaryValue: { fontSize: 24, color: "#A51C24", fontWeight: "bold" },
    footer: { padding: 20, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#f1f5f9" },
    submitBtn: { backgroundColor: "#A51C24", paddingVertical: 16, borderRadius: 14, alignItems: "center" },
    submitText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});