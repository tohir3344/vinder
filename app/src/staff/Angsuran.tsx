// app/user/Angsuran.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
    TextInput,
    Modal,
    Image,
    ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";
const API_URL = `${BASE}angsuran/angsuran.php`;
const API_RIWAYAT = (id: number | string) =>
    `${BASE}angsuran/riwayat.php?angsuran_id=${encodeURIComponent(String(id))}`;

// ❗ Ganti sesuai lokasi file stamp kamu
const STAMP_LUNAS = require("../../../assets/images/lunas.jpeg");

/** ===== Types ===== */
type AngsuranRow = {
    id: number;
    user_id?: number;
    nama_user?: string;
    nominal: number;
    sisa: number;
    keterangan?: string | null;
    tanggal: string;       // YYYY-MM-DD
    status?: string | null; // pending | disetujui | ditolak | lunas
};

type RiwayatRow = {
    id: number;
    tanggal: string; // YYYY-MM-DD
    potongan: number;
    sisa: number;
};

export default function AngsuranUserPage() {
    const [data, setData] = useState<AngsuranRow[]>([]);
    const [loading, setLoading] = useState(true);

    const [authUserId, setAuthUserId] = useState<number | null>(null);
    const [role, setRole] = useState<string | null>(null);

    // pengajuan modal
    const [showModal, setShowModal] = useState(false);
    const [nominal, setNominal] = useState("");
    const [keterangan, setKeterangan] = useState("");
    const [tanggal, setTanggal] = useState("");

    // riwayat modal
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailTarget, setDetailTarget] = useState<AngsuranRow | null>(null);
    const [riwayat, setRiwayat] = useState<RiwayatRow[]>([]);
    const [riwayatLoading, setRiwayatLoading] = useState(false);

    // =========================================================
    // Auth boot
    useEffect(() => {
        (async () => {
            try {
                const raw = await AsyncStorage.getItem("auth");
                if (raw) {
                    const j = JSON.parse(raw);
                    setAuthUserId(Number(j.user_id ?? j.id ?? 0) || null);
                    setRole(String(j.role ?? "staff"));
                }
            } catch (e) {
                console.log("Auth read fail:", e);
            }
        })();
    }, []);

    // Load list
    useEffect(() => {
        if (authUserId == null) return;
        fetchList();
    }, [authUserId]);

    const fetchList = async () => {
        setLoading(true);
        try {
            let url = API_URL;
            // user melihat hanya miliknya
            if (authUserId) `url += ?user_id=${authUserId}`;

            const res = await fetch(url);
            const text = await res.text();
            let json: any = [];
            try { json = JSON.parse(text); } catch { }
            if (Array.isArray(json)) {
                setData(
                    json.map((r: any) => ({
                        id: Number(r.id),
                        user_id: Number(r.user_id ?? authUserId),
                        nama_user: r.nama_user,
                        nominal: Number(r.nominal ?? 0),
                        sisa: Number(r.sisa ?? r.nominal ?? 0),
                        keterangan: r.keterangan ?? "",
                        tanggal: (r.tanggal ?? "").toString().split("T")[0],
                        status: (r.status ?? "").toString().toLowerCase(),
                    }))
                );
            } else {
                setData([]);
            }
        } catch (e) {
            console.log("fetchList err:", e);
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    // =========================================================
    // RULE: blok pengajuan kalau masih ada yang belum lunas & bukan ditolak
    const hasActiveDebt = useMemo(() => {
        return data.some(
            (d) => (d.status ?? "pending") !== "ditolak" && Number(d.sisa ?? d.nominal) > 0
        );
    }, [data]);

    const openAddModal = () => {
        // tanggal auto hari ini
        const today = new Date().toISOString().split("T")[0];
        setTanggal(today);
        setNominal("");
        setKeterangan("");
        setShowModal(true);
    };

    const handleSubmit = async () => {
        if (!authUserId) {
            Alert.alert("Gagal", "User tidak valid.");
            return;
        }
        if (!nominal) {
            Alert.alert("Gagal", "Nominal wajib diisi.");
            return;
        }
        try {
            const res = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_id: authUserId,
                    nominal: Number(nominal),
                    keterangan,
                    tanggal, // otomatis dari openAddModal
                }),
            });
            const text = await res.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { }
            if (json?.success) {
                Alert.alert("Berhasil", json.message ?? "Pengajuan terkirim.");
                setShowModal(false);
                await fetchList();
            } else {
                Alert.alert("Gagal", json?.message ?? "Tidak dapat menambah angsuran.");
            }
        } catch (e) {
            console.log("submit err:", e);
            Alert.alert("Error", "Koneksi gagal.");
        }
    };

    // =========================================================
    // Detail / Riwayat
    const openDetail = async (row: AngsuranRow) => {
        setDetailTarget(row);
        setRiwayat([]);
        setDetailOpen(true);
        await loadRiwayat(row.id);
    };

    const loadRiwayat = async (angsuranId: number) => {
        setRiwayatLoading(true);
        try {
            const res = await fetch(API_RIWAYAT(angsuranId));
            const text = await res.text();
            let json: any = null;
            try { json = JSON.parse(text); } catch { }

            const toDateOnly = (v: any) => {
                const s = (v ?? "").toString();
                if (s.includes("T")) return s.split("T")[0];
                if (s.includes(" ")) return s.split(" ")[0];
                return s;
            };

            let rows: RiwayatRow[] = [];
            if (Array.isArray(json)) {
                rows = json.map((r: any, i: number) => ({
                    id: Number(r.id ?? i + 1),
                    tanggal: toDateOnly(r.tanggal ?? r.tanggal_potong ?? r.created_at),
                    potongan: Number(r.potongan ?? 0),
                    sisa: Number(r.sisa ?? r.sisa_setelah ?? 0),
                }));
            } else if (Array.isArray(json?.data)) {
                rows = json.data.map((r: any, i: number) => ({
                    id: Number(r.id ?? i + 1),
                    tanggal: toDateOnly(r.tanggal ?? r.tanggal_potong ?? r.created_at),
                    potongan: Number(r.potongan ?? 0),
                    sisa: Number(r.sisa ?? r.sisa_setelah ?? 0),
                }));
            }
            setRiwayat(rows);
        } catch (e) {
            console.log("riwayat err:", e);
            setRiwayat([]);
        } finally {
            setRiwayatLoading(false);
        }
    };

    // =========================================================
    // Delete rule: boleh kalau ditolak ATAU sisa <= 0
    const canDelete = (row: AngsuranRow) => {
        const isDitolak = (row.status ?? "").toLowerCase() === "ditolak";
        const isLunas = Number(row.sisa ?? 0) <= 0 || (row.status ?? "").toLowerCase() === "lunas";
        return isDitolak || isLunas;
    };

    const handleDelete = async (id: number) => {
        Alert.alert("Hapus", "Yakin hapus pengajuan ini?", [
            { text: "Batal" },
            {
                text: "Hapus",
                style: "destructive",
                onPress: async () => {
                    try {
                        const res = await fetch(API_URL, {
                            method: "DELETE",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            body: `id=${encodeURIComponent(String(id))}`,
                        });
                        const text = await res.text();
                        let json: any = null; try { json = JSON.parse(text); } catch { }
                        if (json?.success) {
                            await fetchList();
                        } else {
                            Alert.alert("Gagal", json?.message ?? "Tidak dapat menghapus.");
                        }
                    } catch (e) {
                        console.log("del err:", e);
                        Alert.alert("Error", "Koneksi gagal.");
                    }
                },
            },
        ]);
    };

    // =========================================================
    // UI
    if (loading || authUserId == null) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" />
                <Text>Memuat data…</Text>
            </View>
        );
    }

    const renderItem = ({ item }: { item: AngsuranRow }) => {
        const sisa = Number(item.sisa ?? item.nominal ?? 0);
        const status = (item.status ?? "pending").toLowerCase();
        const isLunas = sisa <= 0 || status === "lunas";
        const isDitolak = status === "ditolak";

        // KARTU LUNAS: hijau polos + stamp + tombol
        if (isLunas) {
            return (
                <View style={[styles.card, styles.cardLunas]}>
                    <View style={{ height: 110 }} />
                    <View style={styles.lunasOverlay}>
                        <Image source={STAMP_LUNAS} style={styles.lunasStamp} resizeMode="contain" />
                    </View>
                    <View style={styles.actionsRow}>
                        <TouchableOpacity
                            onPress={() => openDetail(item)}
                            style={[styles.actionBtn, { backgroundColor: "#1976D2" }]}
                        >
                            <Text style={styles.actionText}>Riwayat</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            disabled={!canDelete(item)}
                            onPress={() => handleDelete(item.id)}
                            style={[
                                styles.actionBtn,
                                canDelete(item) ? { backgroundColor: "#D32F2F" } : { backgroundColor: "#B0BEC5" },
                            ]}
                        >
                            <Text style={styles.actionText}>
                                {canDelete(item) ? "Hapus" : "Tidak bisa hapus"}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        // KARTU NORMAL / DITOLAK
        return (
            <View style={[styles.card, isDitolak ? styles.cardTolak : null]}>
                <View style={styles.cardRow}>
                    <Text style={styles.name}>#{item.id}</Text>
                    <Text style={[styles.badge, isDitolak ? styles.badgeTolak : styles.badgeProses]}>
                        {status}
                    </Text>
                </View>

                <Text>
                    Nominal: <Text style={styles.bold}>Rp {Number(item.nominal).toLocaleString()}</Text>
                </Text>
                <Text>
                    Sisa: <Text style={styles.bold}>Rp {sisa.toLocaleString()}</Text>
                </Text>
                {!!item.keterangan && <Text>Keterangan: {item.keterangan}</Text>}
                <Text>Tanggal: {item.tanggal}</Text>

                <View style={styles.actionsRow}>
                    <TouchableOpacity
                        onPress={() => openDetail(item)}
                        style={[styles.actionBtn, { backgroundColor: "#1976D2" }]}
                    >
                        <Text style={styles.actionText}>Riwayat</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        disabled={!canDelete(item)}
                        onPress={() => handleDelete(item.id)}
                        style={[
                            styles.actionBtn,
                            canDelete(item) ? { backgroundColor: "#D32F2F" } : { backgroundColor: "#B0BEC5" },
                        ]}
                    >
                        <Text style={styles.actionText}>
                            {canDelete(item) ? "Hapus" : "Tidak bisa hapus"}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Angsuran Saya</Text>

            {/* Tombol Ajukan (disabled jika masih ada aktif) */}
            <TouchableOpacity
                disabled={hasActiveDebt}
                onPress={openAddModal}
                style={[
                    styles.addButton,
                    hasActiveDebt ? { backgroundColor: "#B0BEC5" } : { backgroundColor: "#007bff" },
                ]}
            >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={styles.addButtonText}>
                    {hasActiveDebt ? "Selesaikan angsuran yang ada terlebih dahulu" : "Ajukan Angsuran"}
                </Text>
            </TouchableOpacity>

            <FlatList
                data={data}
                keyExtractor={(it) => String(it.id)}
                renderItem={renderItem}
                ListEmptyComponent={<Text style={{ textAlign: "center" }}>Belum ada data.</Text>}
                refreshing={loading}
                onRefresh={fetchList}
            />

            {/* Modal Pengajuan */}
            <Modal visible={showModal} animationType="slide">
                <View style={styles.modalContainer}>
                    <Text style={styles.modalTitle}>Pengajuan Angsuran</Text>

                    <TextInput
                        style={styles.input}
                        placeholder="Nominal"
                        keyboardType="numeric"
                        value={nominal}
                        onChangeText={setNominal}
                    />
                    <TextInput
                        style={styles.input}
                        placeholder="Keterangan (opsional)"
                        value={keterangan}
                        onChangeText={setKeterangan}
                    />
                    <TextInput
                        style={[styles.input, { color: "#666" }]}
                        value={tanggal}
                        editable={false}
                    />

                    <View style={styles.modalButtons}>
                        <TouchableOpacity
                            disabled={!nominal}
                            style={[
                                styles.submitButton,
                                nominal ? null : { backgroundColor: "#B0BEC5" },
                            ]}
                            onPress={handleSubmit}
                        >
                            <Text style={styles.submitText}>Kirim</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.cancelButton}
                            onPress={() => setShowModal(false)}
                        >
                            <Text style={styles.cancelText}>Batal</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Modal Detail/Riwayat */}
            <Modal visible={detailOpen} transparent animationType="fade">
                <View style={styles.detailOverlay}>
                    <View style={styles.detailBox}>
                        <View style={styles.detailHead}>
                            <Text style={styles.detailTitle}>
                                Riwayat — #{detailTarget?.id}
                            </Text>
                            <TouchableOpacity onPress={() => setDetailOpen(false)}>
                                <Text style={{ color: "#D32F2F", fontWeight: "700" }}>Tutup ✕</Text>
                            </TouchableOpacity>
                        </View>

                        {!detailTarget ? (
                            <Text>Tidak ada data.</Text>
                        ) : (
                            <ScrollView>
                                <View style={styles.tableHeader}>
                                    <Text style={styles.th}>Tanggal</Text>
                                    <Text style={styles.th}>Potongan</Text>
                                    <Text style={styles.th}>Sisa</Text>
                                </View>
                                {riwayatLoading ? (
                                    <ActivityIndicator style={{ marginTop: 12 }} />
                                ) : riwayat.length === 0 ? (
                                    <Text style={{ marginTop: 8, color: "#666" }}>Belum ada riwayat.</Text>
                                ) : (
                                    riwayat.map((r) => (
                                        <View key={r.id} style={styles.tableRow}>
                                            <Text style={styles.td}>{r.tanggal}</Text>
                                            <Text style={styles.td}>Rp {r.potongan.toLocaleString()}</Text>
                                            <Text style={styles.td}>Rp {r.sisa.toLocaleString()}</Text>
                                        </View>
                                    ))
                                )}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

/* ================== Styles ================== */
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f9f9f9", padding: 16, paddingTop: 45 },
    title: { fontSize: 20, fontWeight: "bold", marginBottom: 16 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },

    card: {
        backgroundColor: "#fff",
        padding: 12,
        borderRadius: 10,
        marginBottom: 12,
        elevation: 2,
        borderWidth: 1,
        borderColor: "#CFD8DC",
        overflow: "hidden",
    },
    cardLunas: {
        backgroundColor: "#C8E6C9", // hijau polos
        borderColor: "#66BB6A",
    },
    cardTolak: {
        backgroundColor: "#FFEBEE",
        borderColor: "#EF5350",
    },

    lunasOverlay: {
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 48, // sisakan ruang tombol
        justifyContent: "center",
        alignItems: "center",
    },
    lunasStamp: {
        width: "70%",
        height: 120,
        opacity: 0.9,
        transform: [{ rotate: "-15deg" }],
    },

    cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
    name: { fontWeight: "700", color: "#263238" },
    bold: { fontWeight: "700" },

    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        color: "#fff",
        fontWeight: "700",
        overflow: "hidden",
        textTransform: "capitalize",
    },
    badgeProses: { backgroundColor: "#0277BD" },
    badgeTolak: { backgroundColor: "#E65100" },

    actionsRow: { flexDirection: "row", gap: 10, marginTop: 10 },
    actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
    actionText: { color: "#fff", fontWeight: "700" },

    addButton: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        justifyContent: "center",
    },
    addButtonText: { color: "#fff", fontWeight: "bold", marginLeft: 6 },

    modalContainer: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "#fff" },
    modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 20 },
    input: {
        borderWidth: 1,
        borderColor: "#ccc",
        borderRadius: 8,
        padding: 10,
        marginBottom: 12,
    },
    modalButtons: { flexDirection: "row", justifyContent: "space-between" },
    submitButton: {
        backgroundColor: "#28a745",
        padding: 10,
        borderRadius: 8,
        flex: 1,
        marginRight: 10,
    },
    cancelButton: {
        backgroundColor: "#dc3545",
        padding: 10,
        borderRadius: 8,
        flex: 1,
    },
    submitText: { color: "#fff", textAlign: "center", fontWeight: "700" },
    cancelText: { color: "#fff", textAlign: "center", fontWeight: "700" },

    detailOverlay: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.4)",
        justifyContent: "center",
        alignItems: "center",
        padding: 14,
    },
    detailBox: {
        width: "100%",
        maxWidth: 560,
        maxHeight: "80%",
        backgroundColor: "#fff",
        borderRadius: 12,
        padding: 14,
    },
    detailHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    detailTitle: { fontSize: 16, fontWeight: "700", color: "#1976D2" },

    tableHeader: {
        flexDirection: "row",
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderColor: "#cfd8dc",
    },
    th: { flex: 1, fontWeight: "700", color: "#1976D2" },
    tableRow: {
        flexDirection: "row",
        paddingVertical: 6,
        borderBottomWidth: 0.5,
        borderColor: "#eceff1",
    },
    td: { flex: 1, color: "#263238" },
});