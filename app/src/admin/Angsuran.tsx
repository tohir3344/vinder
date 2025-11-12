import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    Alert,
    StyleSheet,
    Modal,
    TextInput,
    ScrollView,
    Animated,
    Easing,
} from "react-native";
import { API_BASE } from "../../config";

interface Angsuran {
    id: number;
    nama_user?: string;
    nominal: number;
    sisa: number;
    keterangan: string;
    tanggal: string;
    status: string; // "pending" | "disetujui" | "ditolak"
    is_arsip?: boolean;
}

interface Potongan {
    id: number;
    tanggal: string;
    potongan: number;
    sisa: number;
}

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";

export default function AngsuranAdminPage() {
    const [data, setData] = useState<Angsuran[]>([]);
    const [loading, setLoading] = useState(false);

    const [selected, setSelected] = useState<Angsuran | null>(null);
    const [selectedReadOnly, setSelectedReadOnly] = useState(false);

    const [potonganList, setPotonganList] = useState<Potongan[]>([]);
    const [riwayatList, setRiwayatList] = useState<Potongan[]>([]);

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editPotongan, setEditPotongan] = useState("");

    const [slideAnim] = useState(new Animated.Value(0));
    const [modalVisible, setModalVisible] = useState(false);

    // 🗂 Arsip
    const [arsipData, setArsipData] = useState<Angsuran[]>([]);
    const [arsipModalVisible, setArsipModalVisible] = useState(false);
    const [arsipQuery, setArsipQuery] = useState("");

    // Guard untuk memastikan riwayat yang dipasang sesuai item terakhir diminta
    const lastFetchIdRef = useRef<number | null>(null);
    const [riwayatLoading, setRiwayatLoading] = useState(false);


    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${BASE}angsuran/angsuran.php`);
            const text = await res.text();
            console.log("📦 Respon admin:", text);
            const json = JSON.parse(text);

            if (Array.isArray(json)) {
                const aktif = json.filter(
                    (d: Angsuran) => d.status !== "ditolak" && (d.sisa ?? d.nominal) > 0
                );
                const lunas = json.filter((d: Angsuran) => (d.sisa ?? d.nominal) <= 0);

                setData(aktif);

                // Merge arsip (hindari duplikat)
                setArsipData((prev) => {
                    const merged = [...prev];
                    const pushIfNew = (x: Angsuran) => {
                        if (!merged.some((a) => a.id === x.id)) merged.push({ ...x, is_arsip: true });
                    };
                    lunas.forEach(pushIfNew);
                    json.filter((j: Angsuran) => j.is_arsip).forEach(pushIfNew);
                    return merged;
                });
            } else {
                setData([]);
            }
        } catch (e) {
            console.log("❌ Gagal fetch admin:", e);
            Alert.alert("Error", "Gagal memuat data angsuran");
        } finally {
            setLoading(false);
        }
    };

    const updateStatus = async (id: number, status: "disetujui" | "ditolak") => {
        try {
            if (status === "ditolak") {
                setData((prev) => prev.filter((it) => it.id !== id));
            }
            const res = await fetch(`${BASE}angsuran/angsuran.php`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status }),
            });
            const text = await res.text();
            console.log("PUT status:", text);
            const json = JSON.parse(text);
            Alert.alert("Info", json.message ?? "Status diperbarui.");
            fetchData();
        } catch (e) {
            console.log("❌ PUT error:", e);
            Alert.alert("Error", "Gagal memperbarui status");
        }
    };

    const fetchRiwayat = async (angsuranId: number) => {
        try {
            setRiwayatLoading(true);
            const res = await fetch(`${BASE}angsuran/riwayat.php?angsuran_id=${encodeURIComponent(String(angsuranId))}`);
            const text = await res.text();
            console.log("📜 Riwayat:", text);
            const json = JSON.parse(text);

            const toDateOnly = (v: any) => {
                let s = (v ?? "").toString().trim();
                if (!s) return "";
                if (s.includes("T")) return s.split("T")[0];
                if (s.includes(" ")) return s.split(" ")[0];
                return s;
            };

            const toRows = (arr: any[]) =>
                arr.map((r: any, idx: number) => ({
                    id: Number(r.id ?? idx + 1),
                    tanggal: toDateOnly(r.tanggal ?? r.tanggal_potong ?? r.created_at ?? r.tgl),
                    potongan: Number(r.potongan ?? r.nominal ?? 0),
                    sisa: Number(r.sisa ?? r.sisa_setelah ?? 0),
                }));

            if (Array.isArray(json)) setRiwayatList(toRows(json));
            else if (Array.isArray(json?.data)) setRiwayatList(toRows(json.data));
            else setRiwayatList([]);
        } catch (e) {
            console.log("❌ Riwayat fetch error:", e);
            setRiwayatList([]);
        } finally {
            setRiwayatLoading(false);
        }
    };

    // === Open Detail (list utama & arsip) ===
    const openPopup = (item: Angsuran, opts?: { readOnly?: boolean }) => {
        const readOnly = !!opts?.readOnly;

        setSelected(item);
        setSelectedReadOnly(readOnly);
        setModalVisible(true);

        Animated.timing(slideAnim, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
        }).start();

        // Baris ringkasan di atas
        setPotonganList([
            {
                id: 1,
                tanggal: new Date().toISOString().split("T")[0],
                potongan: 0,
                sisa: item.sisa ?? item.nominal,
            },
        ]);

        // ✅ Selalu muat riwayat pas buka modal (fix: biar gak “hilang” saat buka lagi)
        setRiwayatList([]);
        fetchRiwayat(item.id);
    };

    const openPopupFromArsip = (item: Angsuran) => {
        setArsipModalVisible(false); // tutup modal arsip biar gak double-layer
        openPopup(item, { readOnly: true });
    };

    const closePopup = () => {
        Animated.timing(slideAnim, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
        }).start(() => setModalVisible(false));
    };

    const openEditModal = () => {
        if (!selected) return;
        if (selected.sisa <= 0) {
            Alert.alert("Info", "Angsuran sudah lunas, tidak bisa dipotong lagi.");
            return;
        }
        setEditPotongan("");
        setEditModalVisible(true);
    };

    const handleSavePotongan = async () => {
        if (!selected) {
            Alert.alert("Error", "Tidak ada angsuran yang dipilih.");
            return;
        }

        const angsuranId = Number(selected.id ?? 0);
        if (!Number.isFinite(angsuranId) || angsuranId <= 0) {
            Alert.alert("Error", "ID angsuran tidak valid (selected.id kosong).");
            return;
        }

        const potonganBaru = parseFloat(editPotongan);
        if (isNaN(potonganBaru) || potonganBaru <= 0) {
            Alert.alert("Peringatan", "Masukkan nilai potongan yang valid!");
            return;
        }
        if (potonganBaru > (selected.sisa ?? 0)) {
            Alert.alert("Peringatan", "Potongan melebihi sisa angsuran!");
            return;
        }

        const tanggalNow = new Date().toISOString().split("T")[0];

        // === DEBUG: pastikan payload benar ===
        const payload = {
            angsuran_id: angsuranId,
            potongan: potonganBaru,
            tanggal: tanggalNow,
        };
        console.log("[UPDATE_POTONGAN] payload:", payload);

        // === OPTIMISTIC UI ===
        const sisaHitung = (selected.sisa ?? 0) - potonganBaru;
        setSelected({ ...selected, sisa: sisaHitung });
        setRiwayatList((prev) => [
            ...prev,
            { id: Date.now(), tanggal: tanggalNow, potongan: potonganBaru, sisa: sisaHitung },
        ]);
        setEditModalVisible(false);

        try {
            const res = await fetch(`${BASE}angsuran/update_potongan.php`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const text = await res.text();
            console.log("📤 Respon update potongan:", text);

            let json: any = null;
            try { json = JSON.parse(text); } catch { }

            if (!json?.success) {
                Alert.alert("Gagal", json?.message || "Gagal menyimpan potongan");
                // Sinkron ulang biar state balik benar
                await fetchRiwayat(angsuranId);
                await fetchData();
                return;
            }

            // Sinkron sisa dari server bila ada
            const sisaServer = Number(json?.data?.sisa_baru ?? sisaHitung);
            setSelected((old) => (old ? { ...old, sisa: sisaServer } : old));

            await fetchRiwayat(angsuranId);
            fetchData(); // pindahkan ke arsip bila lunas
        } catch (err) {
            console.log("❌ Error update potongan:", err);
            Alert.alert("Error", "Tidak dapat menghubungi server. Perubahan ditampilkan lokal sementara.");
        }
    };

    const getBorderColor = (sisa: number) => (sisa > 0 ? "#E53935" : "#2E7D32");

    const openArsipModal = () => setArsipModalVisible(true);
    const closeArsipModal = () => setArsipModalVisible(false);

    // 🔎 Filter arsip berdasar query
    const filteredArsip = useMemo(() => {
        const q = arsipQuery.trim().toLowerCase();
        if (!q) return arsipData;
        return arsipData.filter((it) => {
            const fields = [
                it.nama_user ?? "",
                it.keterangan ?? "",
                it.status ?? "",
                it.tanggal ?? "",
                String(it.nominal ?? ""),
                String(it.sisa ?? ""),
            ]
                .join(" ")
                .toLowerCase();
            return fields.includes(q);
        });
    }, [arsipQuery, arsipData]);

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Daftar Pengajuan Angsuran</Text>

            <FlatList
                data={data}
                refreshing={loading}
                onRefresh={fetchData}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                    <TouchableOpacity onPress={() => openPopup(item)}>
                        <View style={[styles.card, { borderColor: getBorderColor(item.sisa), borderWidth: 2 }]}>
                            <Text style={styles.name}>{item.nama_user || "User #" + item.id}</Text>
                            <Text>Nominal: Rp {item.nominal.toLocaleString()}</Text>
                            <Text>Sisa: Rp {(item.sisa ?? item.nominal).toLocaleString()}</Text>
                            <Text>Keterangan: {item.keterangan || "-"}</Text>
                            <Text>Tanggal: {item.tanggal}</Text>
                            <Text
                                style={[
                                    styles.status,
                                    item.status === "pending"
                                        ? { color: "orange" }
                                        : item.status === "disetujui"
                                            ? { color: "green" }
                                            : { color: "red" },
                                ]}
                            >
                                Status: {item.status}
                            </Text>
                        </View>
                    </TouchableOpacity>
                )}
            />

            {/* 🔹 Tombol Arsip (buka modal arsipkan) */}
            <TouchableOpacity style={styles.arsipBtn} onPress={openArsipModal}>
                <Text style={{ color: "#fff", fontWeight: "bold" }}>📁 Arsipkan</Text>
            </TouchableOpacity>

            {/* 🔹 MODAL ARSIP: dengan SEARCH */}
            <Modal transparent visible={arsipModalVisible} animationType="fade">
                <View style={styles.overlayCenter}>
                    <View style={styles.arsipBox}>
                        <View style={styles.arsipHeader}>
                            <Text style={styles.modalTitle}>Angsuran sudah lunas</Text>
                            <TouchableOpacity onPress={closeArsipModal}>
                                <Text style={{ color: "red", fontWeight: "700" }}>Tutup ✕</Text>
                            </TouchableOpacity>
                        </View>

                        {/* 🔎 Search input */}
                        <TextInput
                            placeholder="Cari di arsip (nama, keterangan, status, tanggal, nominal, sisa)"
                            value={arsipQuery}
                            onChangeText={setArsipQuery}
                            style={styles.searchInput}
                            placeholderTextColor="#777"
                        />

                        {filteredArsip.length === 0 ? (
                            <Text style={{ textAlign: "center", color: "#555", marginTop: 8 }}>
                                {arsipData.length === 0 ? "Belum ada data di arsip." : "Tidak ada yang cocok dengan pencarian."}
                            </Text>
                        ) : (
                            <FlatList
                                data={filteredArsip}
                                keyExtractor={(it) => String(it.id)}
                                renderItem={({ item }) => (
                                    <TouchableOpacity onPress={() => openPopupFromArsip(item)}>
                                        <View
                                            style={[
                                                styles.card,
                                                { borderColor: "#2E7D32", borderWidth: 2, backgroundColor: "#E8F5E9" },
                                            ]}
                                        >
                                            <Text style={styles.name}>{item.nama_user || `User #${item.id}`}</Text>
                                            <Text>Nominal: Rp {item.nominal.toLocaleString()}</Text>
                                            <Text>Sisa: Rp {(item.sisa ?? item.nominal).toLocaleString()}</Text>
                                            <Text>Status: {item.status}</Text>
                                            <Text style={{ marginTop: 6, fontStyle: "italic", color: "#2E7D32" }}>
                                                Ketuk untuk lihat riwayat angsuran
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                )}
                            />
                        )}
                    </View>
                </View>
            </Modal>

            {/* 🔹 Modal Detail & Edit Potongan / Riwayat */}
            <Modal transparent visible={modalVisible} animationType="none">
                <View style={styles.modalOverlay}>
                    <Animated.View
                        style={[
                            styles.modalContent,
                            {
                                transform: [
                                    {
                                        translateY: slideAnim.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [600, 0],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>
                                {selectedReadOnly ? "Riwayat Angsuran" : "Detail Angsuran"} — {selected?.nama_user || "User"}
                            </Text>
                            <TouchableOpacity onPress={closePopup}>
                                <Text style={{ color: "red", fontWeight: "bold" }}>Tutup ✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView>
                            <View style={styles.tableHeader}>
                                <Text style={styles.th}>Tanggal</Text>
                                <Text style={styles.th}>Potongan</Text>
                                <Text style={styles.th}>Sisa</Text>
                                <Text style={styles.th}>Aksi</Text>
                            </View>

                            {potonganList.map((p) => (
                                <View key={p.id} style={styles.tableRow}>
                                    <Text style={styles.td}>{p.tanggal}</Text>
                                    <Text style={styles.td}>Rp {p.potongan.toLocaleString()}</Text>
                                    <Text style={styles.td}>Rp {p.sisa.toLocaleString()}</Text>

                                    {selectedReadOnly ? (
                                        <Text style={[styles.td, { textAlign: "right", color: "#888" }]}>—</Text>
                                    ) : (
                                        <TouchableOpacity onPress={openEditModal}>
                                            <Text style={{ color: "blue", fontWeight: "bold" }}>✏ Edit</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ))}

                            <Text style={styles.subtitle}>Riwayat Potongan</Text>
                            {riwayatList.length === 0 ? (
                                <Text style={{ color: "#666", marginTop: 6 }}>
                                    {selectedReadOnly ? "Tidak ada riwayat atau belum dimuat." : "Belum ada riwayat potongan."}
                                </Text>
                            ) : (
                                riwayatList.map((r) => (
                                    <View key={r.id} style={styles.historyRow}>
                                        <Text>
                                            {r.tanggal} — Potongan Rp {r.potongan.toLocaleString()} — Sisa Rp {r.sisa.toLocaleString()}
                                        </Text>
                                    </View>
                                ))
                            )}

                            {!selectedReadOnly && selected?.status === "pending" && (
                                <View style={styles.statusButtons}>
                                    <TouchableOpacity
                                        onPress={() => {
                                            updateStatus(selected.id, "disetujui");
                                            closePopup();
                                        }}
                                        style={[styles.statusBtn, { backgroundColor: "green" }]}
                                    >
                                        <Text style={{ color: "#fff", fontWeight: "bold" }}>✅ Setujui</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={() => {
                                            updateStatus(selected.id, "ditolak");
                                            closePopup();
                                        }}
                                        style={[styles.statusBtn, { backgroundColor: "red" }]}
                                    >
                                        <Text style={{ color: "#fff", fontWeight: "bold" }}>❌ Tolak</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* 🔹 Modal Input Potongan */}
            <Modal transparent visible={editModalVisible} animationType="fade">
                <View style={styles.overlayCenter}>
                    <View style={styles.editBox}>
                        <Text style={styles.editTitle}>Input Potongan Baru</Text>
                        <TextInput
                            placeholder="Masukkan jumlah potongan"
                            keyboardType="numeric"
                            value={editPotongan}
                            onChangeText={setEditPotongan}
                            style={styles.input}
                        />
                        <View style={styles.editButtons}>
                            <TouchableOpacity
                                onPress={() => setEditModalVisible(false)}
                                style={[styles.btn, { backgroundColor: "#ccc" }]}
                            >
                                <Text>Batal</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleSavePotongan} style={styles.btn}>
                                <Text style={{ color: "#fff" }}>Simpan</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// 🎨 Styles
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f4f9ff", padding: 16 },
    title: { fontSize: 20, fontWeight: "700", color: "#1976D2", marginVertical: 10 },
    card: {
        backgroundColor: "#fff",
        padding: 12,
        borderRadius: 10,
        marginBottom: 10,
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 2,
    },
    name: { fontWeight: "700", color: "#0D47A1" },
    status: { fontWeight: "bold", textTransform: "capitalize", marginTop: 5 },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-end" },
    modalContent: {
        backgroundColor: "#fff",
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 16,
        height: "70%",
    },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
    modalTitle: { fontSize: 18, fontWeight: "700", color: "#1976D2" },
    tableHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderColor: "#ccc",
    },
    tableRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
        borderBottomWidth: 0.5,
        borderColor: "#eee",
        alignItems: "center",
    },
    th: { flex: 1, fontWeight: "700", color: "#1976D2" },
    td: { flex: 1, color: "#333" },
    subtitle: {
        marginTop: 16,
        fontWeight: "700",
        color: "#444",
        borderBottomWidth: 1,
        borderColor: "#ccc",
        paddingBottom: 4,
    },
    historyRow: { paddingVertical: 4, borderBottomWidth: 0.5, borderColor: "#eee" },
    overlayCenter: {
        flex: 1,
        backgroundColor: "rgba(0,0,0,0.4)",
        justifyContent: "center",
        alignItems: "center",
        padding: 16,
    },
    editBox: {
        backgroundColor: "#fff",
        padding: 20,
        borderRadius: 10,
        width: "100%",
        maxWidth: 420,
    },
    arsipBox: {
        backgroundColor: "#fff",
        padding: 16,
        borderRadius: 10,
        width: "100%",
        maxWidth: 540,
        maxHeight: "80%",
    },
    arsipHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
    },
    searchInput: {
        borderWidth: 1,
        borderColor: "#cfd8dc",
        backgroundColor: "#f8fbff",
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
    },
    editTitle: { fontWeight: "700", fontSize: 16, marginBottom: 10, textAlign: "center" },
    input: {
        borderWidth: 1,
        borderColor: "#ccc",
        borderRadius: 8,
        padding: 10,
        marginBottom: 15,
        textAlign: "center",
    },
    editButtons: { flexDirection: "row", justifyContent: "space-around" },
    btn: {
        backgroundColor: "#1976D2",
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 6,
    },
    statusButtons: {
        flexDirection: "row",
        justifyContent: "space-around",
        marginTop: 20,
        marginBottom: 10,
    },
    statusBtn: {
        flex: 1,
        marginHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: "center",
    },
    arsipBtn: {
        backgroundColor: "#1565C0",
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: "center",
        marginVertical: 10,
    },
});