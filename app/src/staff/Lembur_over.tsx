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

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

const getLocalTodayYMD = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export default function LemburOverStaff() {
    const [keterangan, setKeterangan] = useState("");
    const [foto, setFoto] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // User State
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
    const [distance, setDistance] = useState<number | null>(null);
    const [inRadius, setInRadius] = useState(false);
    const [locationLoading, setLocationLoading] = useState(true);
    const [hasClockedOut, setHasClockedOut] = useState(false);
    const [checkingAbsen, setCheckingAbsen] = useState(true);

    const JAM_MULAI = 20;
    const MENIT_MULAI = 0;

    useEffect(() => {
        const loadInitialData = async () => {
            let userIdFound = null;
            try {
                const authData = await AsyncStorage.getItem("auth");
                if (authData) {
                    const user = JSON.parse(authData);
                    userIdFound = user.id || user.user_id || (user.data && user.data.id);
                    setCurrentUserId(userIdFound);

                    const realName = user.nama_lengkap || user.nama || user.name || user.username || "Staff";
                    setUserName(realName);

                    // Ambil upah dari field 'lembur' di tabel users (sesuai req lo kemarin)
                    let rate = parseInt(user.lembur || "0");
                    const gajiPokok = user.gaji_pokok || (user.data && user.data.gaji_pokok);
                    if (rate === 0 && gajiPokok) {
                        rate = Math.floor(parseInt(gajiPokok) / 173);
                    }
                    setUserRate(rate);
                }
            } catch (e) { console.log("Error load user", e); }

            if (userIdFound) {
                // Cek status lokal
                const todayStr = new Date().toLocaleDateString("id-ID");
                const savedStatus = await AsyncStorage.getItem(`last_lembur_over_date_${userIdFound}`);
                setHasSubmitted(savedStatus === todayStr);

                // Cek status absen pulang ke server
                try {
                    const todayYMD = getLocalTodayYMD();
                    const res = await fetch(`${API_BASE}/absen/check_absen_today.php?user_id=${userIdFound}&tanggal=${todayYMD}`);
                    const json = await res.json();
                    if (json.success && json.data) {
                        const jk = json.data.jam_keluar;
                        setHasClockedOut(jk && jk !== "00:00:00" && jk !== "00:00");
                    }
                } catch (e) { console.log("Gagal cek status pulang", e); }
                finally { setCheckingAbsen(false); }
            } else { setCheckingAbsen(false); }

            // Cek Lokasi
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                    const dist = getDistance(loc.coords.latitude, loc.coords.longitude, OFFICE_LAT, OFFICE_LONG);
                    setDistance(dist);
                    setInRadius(dist <= MAX_RADIUS_METER);
                }
            } catch (error) { console.log("GPS Error", error); }
            finally { setLocationLoading(false); }
        };

        loadInitialData();

        const timer = setInterval(() => {
            const d = new Date();
            setCurrentTime(d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }));
            setCurrentDate(d.toLocaleDateString("id-ID", { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));

            const jamSekarang = d.getHours();
            setIsLate(jamSekarang >= 8 && jamSekarang < 20);

            const currentMinutesTotal = (jamSekarang * 60) + d.getMinutes();
            const startMinutesTotal = (JAM_MULAI * 60) + MENIT_MULAI;
            let diffMinutes = currentMinutesTotal - startMinutesTotal;
            if (diffMinutes < 0) diffMinutes += (24 * 60);

            setTotalMenit(diffMinutes);
            setTotalJamEstimasi((diffMinutes / 60).toFixed(2));
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    const ambilFoto = async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.granted) {
            const result = await ImagePicker.launchCameraAsync({
                allowsEditing: true, aspect: [3, 4], quality: 0.5,
            });
            if (!result.canceled) setFoto(result.assets[0]);
        } else {
            Alert.alert("Izin Ditolak", "Akses kamera dibutuhkan.");
        }
    };

    const handleSubmit = async () => {
        if (checkingAbsen) return;
        if (hasClockedOut) return Alert.alert("Akses Ditolak", "Anda sudah absen pulang hari ini.");
        if (hasSubmitted) return Alert.alert("Sudah Kirim", "Anda sudah input lembur hari ini.");
        if (isLate) return Alert.alert("Waktu Habis", "Batas input jam 08:00 pagi.");
        if (!inRadius) return Alert.alert("Lokasi Salah", "Di luar radius kantor.");
        if (!foto) return Alert.alert("Error", "Foto bukti wajib diisi!");
        if (!keterangan.trim()) return Alert.alert("Error", "Isi keterangan.");

        setLoading(true);
        try {
            const formData = new FormData();
            formData.append("user_id", String(currentUserId));
            formData.append("tanggal", getLocalTodayYMD());
            formData.append("jam_mulai", "20:00");
            formData.append("jam_selesai", currentTime);
            formData.append("keterangan", keterangan);
            formData.append("total_jam", totalJamEstimasi);
            formData.append("total_menit", String(totalMenit));
            
            // 🔥 KRUSIAL: Kirim status 'pending' biar Admin dapet modal notif
            formData.append("status", "pending");

            const estimasiPendapatan = Math.ceil(parseFloat(totalJamEstimasi) * userRate * 2);
            formData.append("total_upah", String(estimasiPendapatan));

            const filename = foto.uri.split("/").pop();
            const match = /\.(\w+)$/.exec(filename || "");
            const type = match ? `image/${match[1]}` : `image/jpeg`;
            formData.append("foto_bukti", { uri: foto.uri, name: filename || "bukti.jpg", type } as any);

            // Tambahin parameter user_id biar filternya jalan
            const response = await fetch(`${API_BASE}/lembur/list_lembur_over.php?user_id=${currentUserId}`, {
                method: "POST", body: formData, headers: { "Content-Type": "multipart/form-data" },
            });

            const result = await response.json();
            if (result.success) {
                await AsyncStorage.setItem(`last_lembur_over_date_${currentUserId}`, new Date().toLocaleDateString("id-ID"));
                setHasSubmitted(true);
                Alert.alert("Sukses", "Lembur berhasil diajukan! Menunggu persetujuan admin.", [{ text: "OK", onPress: () => router.back() }]);
            } else {
                Alert.alert("Gagal", result.message);
            }
        } catch (error) {
            Alert.alert("Error", "Gagal koneksi ke server.");
        } finally {
            setLoading(false);
        }
    };

    const isButtonDisabled = loading || isLate || hasSubmitted || !inRadius || locationLoading || hasClockedOut || checkingAbsen;

    return (
        <View style={styles.container}>
            <StatusBar backgroundColor="#A51C24" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Lembur Lanjutan</Text>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.userSection}>
                    <Text style={styles.greeting}>Halo, {userName}</Text>
                    <Text style={styles.userName}>Ayo semangat lemburnya!</Text>
                </View>

                {/* Radius Box */}
                <View style={[styles.radiusBox, inRadius ? styles.radiusOk : styles.radiusFail]}>
                    <MaterialCommunityIcons name={inRadius ? "map-marker-check" : "map-marker-remove"} size={24} color={inRadius ? "#15803d" : "#b91c1c"} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.radiusTitle, { color: inRadius ? "#15803d" : "#b91c1c" }]}>
                            {locationLoading ? "Mencari Lokasi..." : (inRadius ? "Dalam Radius Kantor" : "Di Luar Radius Kantor")}
                        </Text>
                        <Text style={styles.radiusSubtitle}>Jarak: {distance?.toFixed(0) || 0}m (Max {MAX_RADIUS_METER}m)</Text>
                    </View>
                </View>

                {hasClockedOut && (
                    <View style={styles.warningBox}>
                        <MaterialCommunityIcons name="clock-remove-outline" size={24} color="#b91c1c" />
                        <Text style={styles.warningText}>Anda sudah absen pulang. Akses input lembur ditutup.</Text>
                    </View>
                )}

                <View style={styles.card}>
                    <View style={styles.dateContainer}>
                        <MaterialCommunityIcons name="calendar-month" size={20} color="#A51C24" />
                        <Text style={styles.dateText}>{currentDate}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.rowInfo}>
                        <View><Text style={styles.label}>Mulai</Text><Text style={styles.timeValueMain}>20:00</Text></View>
                        <MaterialCommunityIcons name="arrow-right" size={24} color="#ccc" />
                        <View><Text style={styles.label}>Selesai</Text><Text style={[styles.timeValueMain, { color: isLate ? "#94a3b8" : "#A51C24" }]}>{currentTime || "--:--"}</Text></View>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>Aktivitas Lembur</Text>
                <TextInput style={styles.inputArea} placeholder="Apa yang kamu kerjakan?" multiline value={keterangan} onChangeText={setKeterangan} editable={!isButtonDisabled} />

                <Text style={styles.sectionTitle}>Bukti Kerja</Text>
                <TouchableOpacity style={[styles.photoBox, isButtonDisabled && { backgroundColor: '#f1f5f9' }]} onPress={!isButtonDisabled ? ambilFoto : undefined} disabled={isButtonDisabled}>
                    {foto ? <Image source={{ uri: foto.uri }} style={styles.previewImage} /> : (
                        <View style={styles.photoPlaceholder}>
                            <MaterialCommunityIcons name="camera" size={40} color={isButtonDisabled ? "#cbd5e1" : "#64748b"} />
                            <Text style={[styles.photoText, isButtonDisabled && { color: "#cbd5e1" }]}>Ambil Foto Bukti</Text>
                        </View>
                    )}
                </TouchableOpacity>

                <View style={styles.summaryContainer}>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Total Durasi:</Text>
                        <Text style={[styles.summaryValue, isButtonDisabled && { color: '#64748b' }]}>{totalMenit} Menit</Text>
                    </View>
                    <Text style={{ textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>(Setara {totalJamEstimasi} Jam)</Text>
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={[styles.submitBtn, isButtonDisabled && { backgroundColor: "#94a3b8" }]} onPress={handleSubmit} disabled={isButtonDisabled}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>KIRIM PENGAJUAN LEMBUR</Text>}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f8fafc" },
    header: { backgroundColor: "#A51C24", paddingTop: 50, paddingBottom: 20, paddingHorizontal: 20, flexDirection: "row", alignItems: "center" },
    backBtn: { marginRight: 15 },
    headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
    content: { flex: 1, padding: 20 },
    userSection: { marginBottom: 20 },
    greeting: { fontSize: 14, color: "#64748b" },
    userName: { fontSize: 20, fontWeight: "bold", color: "#1e293b" },
    card: { backgroundColor: "#fff", borderRadius: 16, padding: 20, marginBottom: 20, elevation: 3 },
    radiusBox: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 20, borderWidth: 1 },
    radiusOk: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
    radiusFail: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
    radiusTitle: { fontWeight: 'bold', fontSize: 14 },
    radiusSubtitle: { fontSize: 12, color: '#475569' },
    warningBox: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: '#fef2f2', borderColor: '#f87171', borderWidth: 1, marginBottom: 20, gap: 10 },
    warningText: { color: '#b91c1c', fontSize: 13, flex: 1, fontWeight: '600' },
    dateContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    dateText: { fontSize: 16, fontWeight: "bold", color: "#334155", marginLeft: 8 },
    divider: { height: 1, backgroundColor: "#f1f5f9", marginBottom: 15 },
    rowInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { fontSize: 12, color: "#64748b", marginBottom: 4 },
    timeValueMain: { fontSize: 24, fontWeight: "900", color: "#1e293b" },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: "#334155", marginBottom: 10, marginTop: 10 },
    inputArea: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 15, fontSize: 14, minHeight: 80 },
    photoBox: { height: 200, backgroundColor: "#e2e8f0", borderRadius: 12, overflow: "hidden", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#cbd5e1", borderStyle: "dashed" },
    photoPlaceholder: { alignItems: "center" },
    photoText: { color: "#64748b", marginTop: 5, fontWeight: "600" },
    previewImage: { width: "100%", height: "100%", resizeMode: "cover" },
    summaryContainer: { marginTop: 25, backgroundColor: "#fff", borderRadius: 12, padding: 15, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 20 },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    summaryLabel: { fontSize: 16, color: "#64748b", fontWeight: "600" },
    summaryValue: { fontSize: 24, color: "#A51C24", fontWeight: "bold" },
    footer: { padding: 20, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#f1f5f9" },
    submitBtn: { backgroundColor: "#A51C24", paddingVertical: 16, borderRadius: 14, alignItems: "center" },
    submitText: { color: "#fff", fontWeight: "900", fontSize: 16 },
});