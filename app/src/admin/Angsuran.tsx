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
    StatusBar,
    Platform,
    ActivityIndicator
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { API_BASE } from "../../config";

interface Angsuran {
    id: number;
    nama_user?: string;
    nominal: number;
    sisa: number;
    keterangan: string;
    tanggal: string; // YYYY-MM-DD
    status: string;
    is_arsip?: boolean;
}

interface Potongan {
    id: number;
    tanggal: string;
    potongan: number;
    sisa: number;
}

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";

const MONTHS = [
    { label: "Semua", value: "" },
    { label: "Jan", value: "01" },
    { label: "Feb", value: "02" },
    { label: "Mar", value: "03" },
    { label: "Apr", value: "04" },
    { label: "Mei", value: "05" },
    { label: "Jun", value: "06" },
    { label: "Jul", value: "07" },
    { label: "Agu", value: "08" },
    { label: "Sep", value: "09" },
    { label: "Okt", value: "10" },
    { label: "Nov", value: "11" },
    { label: "Des", value: "12" },
];

// 🔥 HELPER: Format Tanggal Indonesia
const formatTglIndo = (isoString: string) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString; 
    
    const day = date.getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    
    return `${day} ${month} ${year}`;
};

// Helper: Get Today YYYY-MM-DD Local
const getTodayLocal = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Helper Format Rupiah
const formatRupiah = (num: number) => {
    return "Rp " + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

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

    // 🗂 State Arsip & Filter
    const [arsipData, setArsipData] = useState<Angsuran[]>([]);
    const [arsipModalVisible, setArsipModalVisible] = useState(false);
    const [arsipQuery, setArsipQuery] = useState("");
    
    const [filterYear, setFilterYear] = useState(new Date().getFullYear());
    const [filterMonth, setFilterMonth] = useState(""); 

    const [riwayatLoading, setRiwayatLoading] = useState(false);
    const [printing, setPrinting] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${BASE}angsuran/angsuran.php`);
            const text = await res.text();
            const json = JSON.parse(text);

            if (Array.isArray(json)) {
                const aktif = json.filter(
                    (d: Angsuran) => d.status !== "ditolak" && (d.sisa ?? d.nominal) > 0
                );
                const lunas = json.filter((d: Angsuran) => (d.sisa ?? d.nominal) <= 0);

                setData(aktif);

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
            const json = await res.json();
            Alert.alert("Info", json.message ?? "Status diperbarui.");
            fetchData();
        } catch (e) {
            Alert.alert("Error", "Gagal memperbarui status");
        }
    };

    const fetchRiwayat = async (angsuranId: number) => {
        try {
            setRiwayatLoading(true);
            const res = await fetch(`${BASE}angsuran/riwayat.php?angsuran_id=${encodeURIComponent(String(angsuranId))}`);
            const json = await res.json();

            const toDateOnly = (r: any) => {
                const raw = r.tanggal || r.tanggal_potong || r.tgl_transaksi || "";
                let s = (raw).toString().trim();
                if (!s) return getTodayLocal(); 
                return s.split(" ")[0]; 
            };

            const toRows = (arr: any[]) =>
                arr.map((r: any, idx: number) => ({
                    id: Number(r.id ?? idx + 1),
                    tanggal: toDateOnly(r), 
                    potongan: Number(r.potongan ?? r.nominal ?? 0),
                    sisa: Number(r.sisa ?? r.sisa_setelah ?? 0),
                }));

            if (Array.isArray(json)) setRiwayatList(toRows(json).reverse());
            else if (Array.isArray(json?.data)) setRiwayatList(toRows(json.data).reverse());
            else setRiwayatList([]);
        } catch (e) {
            console.log("Err fetch riwayat:", e);
            setRiwayatList([]);
        } finally {
            setRiwayatLoading(false);
        }
    };

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

        setPotonganList([
            {
                id: 1,
                tanggal: getTodayLocal(), 
                potongan: 0,
                sisa: item.sisa ?? item.nominal,
            },
        ]);

        setRiwayatList([]);
        fetchRiwayat(item.id);
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
            Alert.alert("Info", "Angsuran sudah lunas.");
            return;
        }
        setEditPotongan("300000"); 
        setEditModalVisible(true);
    };

    const handleSavePotongan = async () => {
        if (!selected) return;

        const cleanValue = editPotongan.replace(/\./g, "");
        const potonganBaru = parseFloat(cleanValue);

        if (isNaN(potonganBaru) || potonganBaru <= 0) {
            Alert.alert("Peringatan", "Masukkan nilai potongan yang valid!");
            return;
        }
        if (potonganBaru > (selected.sisa ?? 0)) {
            Alert.alert("Peringatan", "Potongan melebihi sisa angsuran!");
            return;
        }

        const tanggalNow = getTodayLocal(); // 2025-11-26
        const angsuranId = Number(selected.id);

        const sisaHitung = (selected.sisa ?? 0) - potonganBaru;
        setSelected({ ...selected, sisa: sisaHitung });
        
        const newItem = { 
            id: Date.now(), 
            tanggal: tanggalNow, 
            potongan: potonganBaru, 
            sisa: sisaHitung 
        };
        setRiwayatList((prev) => [newItem, ...prev]);
        
        setEditModalVisible(false);

        try {
            const res = await fetch(`${BASE}angsuran/update_potongan.php`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    angsuran_id: angsuranId,
                    potongan: potonganBaru,
                    tanggal: tanggalNow, 
                }),
            });
            const json = await res.json();

            if (!json?.success) {
                Alert.alert("Gagal", json?.message || "Gagal menyimpan potongan");
                await fetchRiwayat(angsuranId);
                await fetchData();
                return;
            }

            const sisaServer = Number(json?.data?.sisa_baru ?? sisaHitung);
            setSelected((old) => (old ? { ...old, sisa: sisaServer } : old));
            
            await fetchRiwayat(angsuranId);
            fetchData();
        } catch (err) {
            console.log("❌ Error update potongan:", err);
            Alert.alert("Error", "Koneksi bermasalah.");
        }
    };

    const openArsipModal = () => setArsipModalVisible(true);
    const closeArsipModal = () => setArsipModalVisible(false);

    // 🔎 Logic Filter Arsip
    const filteredArsip = useMemo(() => {
        let result = arsipData;

        result = result.filter(it => it.tanggal.startsWith(String(filterYear)));

        if (filterMonth) {
            result = result.filter(it => {
                const parts = it.tanggal.split('-');
                if (parts.length > 1) return parts[1] === filterMonth;
                return false;
            });
        }

        const q = arsipQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((it) =>
                (it.nama_user || "").toLowerCase().includes(q) ||
                (it.keterangan || "").toLowerCase().includes(q)
            );
        }

        return result;
    }, [arsipQuery, arsipData, filterYear, filterMonth]);

    // --- FITUR CETAK PDF ARSIP ---
    const generateArsipPdf = async () => {
        if (filteredArsip.length === 0) {
            Alert.alert("Info", "Tidak ada data untuk dicetak.");
            return;
        }
        setPrinting(true);

        try {
            const d = new Date();
            const footerDate = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            const bulanLabel = filterMonth ? MONTHS.find(m => m.value === filterMonth)?.label : "Semua Bulan";
            
            // Hitung Total Nominal
            const totalNominal = filteredArsip.reduce((acc, item) => acc + Number(item.nominal), 0);

            const tableRows = filteredArsip.map((item, index) => `
                <tr>
                    <td style="text-align: center;">${index + 1}</td>
                    <td>${item.nama_user || '-'}</td>
                    <td>${item.keterangan || '-'}</td>
                    <td style="text-align: center;">${formatTglIndo(item.tanggal)}</td>
                    <td style="text-align: right;">${formatRupiah(item.nominal)}</td>
                    <td style="text-align: center; font-weight: bold; color: ${item.status === 'disetujui' ? 'green' : 'red'}">
                        ${item.status.toUpperCase()}
                    </td>
                </tr>
            `).join('');

            const htmlContent = `
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                      body { font-family: 'Helvetica', sans-serif; padding: 20px; }
                      h1 { text-align: center; color: #1E3A8A; margin-bottom: 5px; }
                      h3 { text-align: center; color: #64748B; margin-top: 0; font-weight: normal; }
                      .meta { text-align: center; margin-bottom: 30px; font-size: 14px; color: #475569; }
                      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
                      th, td { border: 1px solid #CBD5E1; padding: 8px; text-align: left; }
                      th { background-color: #F1F5F9; color: #0F172A; font-weight: bold; text-align: center; }
                      .total-row { font-weight: bold; background-color: #ECFEFF; }
                      .footer { text-align: right; margin-top: 40px; font-size: 10px; color: #94A3B8; }
                    </style>
                  </head>
                  <body>
                    <h1>Laporan Arsip Angsuran</h1>
                    <h3>PT Pordjo Steelindo Perkasa</h3>
                    
                    <div class="meta">
                      Periode: <b>${bulanLabel} ${filterYear}</b><br/>
                      Total Data: ${filteredArsip.length} Transaksi
                    </div>

                    <table>
                      <thead>
                        <tr>
                          <th style="width: 30px;">No</th>
                          <th>Nama Karyawan</th>
                          <th>Keterangan</th>
                          <th>Tanggal</th>
                          <th>Nominal</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${tableRows}
                        <tr class="total-row">
                            <td colspan="4" style="text-align: right;">TOTAL</td>
                            <td style="text-align: right;">${formatRupiah(totalNominal)}</td>
                            <td></td>
                        </tr>
                      </tbody>
                    </table>

                    <div class="footer">
                      Dicetak pada: ${footerDate}
                    </div>
                  </body>
                </html>
            `;

            const { uri } = await Print.printToFileAsync({ html: htmlContent });
            
            if (Platform.OS === "ios") {
                await Sharing.shareAsync(uri);
            } else {
                await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
            }

        } catch (error) {
            Alert.alert("Gagal Cetak", "Terjadi kesalahan saat membuat PDF.");
            console.error(error);
        } finally {
            setPrinting(false);
        }
    };

    // --- Render Component ---
    const renderCard = ({ item }: { item: Angsuran }) => {
        const sisa = item.sisa ?? item.nominal;
        const progress = ((item.nominal - sisa) / item.nominal) * 100;
        const isPending = item.status === "pending";

        return (
            <TouchableOpacity
                style={styles.card}
                onPress={() => openPopup(item)}
                activeOpacity={0.9}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.iconContainer}>
                        <Ionicons name="person" size={20} color="#fff" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.cardName}>{item.nama_user || `User #${item.id}`}</Text>
                        <Text style={styles.cardDate}>{formatTglIndo(item.tanggal)}</Text>
                    </View>
                    <View style={[styles.badge, isPending ? styles.bgOrange : styles.bgGreen]}>
                        <Text style={styles.badgeText}>{item.status}</Text>
                    </View>
                </View>

                <View style={styles.cardBody}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.label}>Nominal Awal</Text>
                        <Text style={styles.value}>{formatRupiah(item.nominal)}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.rowBetween}>
                        <Text style={styles.labelBold}>Sisa Tagihan</Text>
                        <Text style={[styles.valueBold, { color: sisa > 0 ? "#E53935" : "#43A047" }]}>
                            {formatRupiah(sisa)}
                        </Text>
                    </View>
                    <Text style={styles.keterangan} numberOfLines={1}>
                        {`"${item.keterangan || "-"}"`}
                    </Text>
                </View>

                <View style={styles.progressTrack}>
                    <View style={[styles.progressBar, { width: `${progress}%` }]} />
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#f4f9ff" />
            <View style={styles.headerContainer}>
                <Text style={styles.headerTitle}>Kelola Angsuran</Text>
                <TouchableOpacity style={styles.arsipButton} onPress={openArsipModal}>
                    <Ionicons name="archive-outline" size={20} color="#fff" />
                    <Text style={styles.arsipText}>Arsip</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={data}
                keyExtractor={(item) => item.id.toString()}
                refreshing={loading}
                onRefresh={fetchData}
                renderItem={renderCard}
                contentContainerStyle={{ paddingBottom: 80 }}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Ionicons name="documents-outline" size={64} color="#ccc" />
                        <Text style={styles.emptyText}>Tidak ada angsuran aktif</Text>
                    </View>
                }
            />

            {/* --- MODAL EDIT INPUT POTONGAN --- */}
            <Modal transparent visible={editModalVisible} animationType="fade">
                <View style={styles.overlayBlur}>
                    <View style={styles.editBox}>
                        <Text style={styles.editTitle}>Potong Saldo</Text>
                        <Text style={styles.editSubtitle}>Masukkan jumlah nominal pembayaran</Text>

                        <View style={styles.inputWrapper}>
                            <Text style={styles.prefix}>Rp</Text>
                            <TextInput
                                placeholder="0"
                                keyboardType="numeric"
                                value={editPotongan}
                                onChangeText={setEditPotongan}
                                style={styles.inputField}
                                autoFocus
                            />
                        </View>

                        <View style={styles.btnRow}>
                            <TouchableOpacity
                                onPress={() => setEditModalVisible(false)}
                                style={[styles.actionBtn, styles.btnOutline]}
                            >
                                <Text style={{ color: "#555" }}>Batal</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleSavePotongan} style={[styles.actionBtn, styles.btnPrimary]}>
                                <Text style={{ color: "#fff", fontWeight: "bold" }}>Simpan</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* --- MODAL DETAIL (Slide Up) --- */}
            <Modal transparent visible={modalVisible} animationType="none" onRequestClose={closePopup}>
                <View style={styles.overlay}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={closePopup} />
                    <Animated.View
                        style={[
                            styles.bottomSheet,
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
                        <View style={styles.sheetHeader}>
                            <View style={styles.sheetHandle} />
                            <View style={styles.sheetTitleRow}>
                                <Text style={styles.sheetTitle}>
                                    {selectedReadOnly ? "Riwayat Lunas" : "Rincian Angsuran"}
                                </Text>
                                <TouchableOpacity onPress={closePopup}>
                                    <Ionicons name="close-circle" size={28} color="#ddd" />
                                </TouchableOpacity>
                            </View>
                            <Text style={styles.sheetUser}>{selected?.nama_user}</Text>
                        </View>

                        <ScrollView style={{ flex: 1 }}>
                            <View style={styles.tableContainer}>
                                <View style={styles.tHead}>
                                    <Text style={[styles.tCell, { flex: 1 }]}>Tgl</Text>
                                    <Text style={[styles.tCell, { flex: 1.5 }]}>Bayar</Text>
                                    <Text style={[styles.tCell, { flex: 1.5 }]}>Sisa</Text>
                                    <Text style={[styles.tCell, { flex: 0.8, textAlign: "center" }]}>Aksi</Text>
                                </View>

                                {/* BARIS INPUT HARI INI */}
                                {potonganList.map((p) => (
                                    <View key={p.id} style={[styles.tRow, styles.tRowHighlight]}>
                                        <Text style={[styles.tCell, { flex: 1, fontSize: 11, fontWeight: 'bold', color: '#1976D2' }]}>
                                            {formatTglIndo(p.tanggal)}
                                        </Text>
                                        <Text style={[styles.tCell, { flex: 1.5 }]}>-</Text>
                                        <Text style={[styles.tCell, { flex: 1.5, fontWeight: "bold" }]}>
                                            {formatRupiah(p.sisa)}
                                        </Text>
                                        <View style={{ flex: 0.8, alignItems: "center" }}>
                                            {!selectedReadOnly && (
                                                <TouchableOpacity onPress={openEditModal} style={styles.iconBtn}>
                                                    <Ionicons name="create-outline" size={20} color="#1976D2" />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                ))}

                                {/* LIST RIWAYAT */}
                                {riwayatLoading ? (
                                    <Text style={{ padding: 20, textAlign: "center", color: "#888" }}>Memuat riwayat...</Text>
                                ) : (
                                    riwayatList.map((r) => (
                                        <View key={r.id} style={styles.tRow}>
                                            <Text style={[styles.tCell, { flex: 1, fontSize: 11 }]}>
                                                {formatTglIndo(r.tanggal)}
                                            </Text>
                                            <Text style={[styles.tCell, { flex: 1.5, color: "#43A047" }]}>
                                                {formatRupiah(r.potongan)}
                                            </Text>
                                            <Text style={[styles.tCell, { flex: 1.5 }]}>{formatRupiah(r.sisa)}</Text>
                                            <Text style={{ flex: 0.8, textAlign: "center" }}>-</Text>
                                        </View>
                                    ))
                                )}
                            </View>

                            {!selectedReadOnly && selected?.status === "pending" && (
                                <View style={styles.approvalBox}>
                                    <Text style={styles.approvalText}>Tindakan Diperlukan:</Text>
                                    <View style={styles.btnRow}>
                                        <TouchableOpacity
                                            onPress={() => {
                                                updateStatus(selected!.id, "disetujui");
                                                closePopup();
                                            }}
                                            style={[styles.actionBtn, styles.bgGreen, { flex: 1, marginRight: 8 }]}
                                        >
                                            <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                            <Text style={{ color: "#fff", fontWeight: "bold", marginLeft: 5 }}>Setujui</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={() => {
                                                updateStatus(selected!.id, "ditolak");
                                                closePopup();
                                            }}
                                            style={[styles.actionBtn, styles.bgRed, { flex: 1 }]}
                                        >
                                            <Ionicons name="close-circle" size={18} color="#fff" />
                                            <Text style={{ color: "#fff", fontWeight: "bold", marginLeft: 5 }}>Tolak</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </ScrollView>
                    </Animated.View>
                </View>
            </Modal>

            {/* --- MODAL ARSIP --- */}
            <Modal transparent visible={arsipModalVisible} animationType="fade">
                <View style={styles.overlayBlur}>
                    <View style={styles.arsipContainer}>
                        <View style={styles.arsipHeader}>
                            <Text style={styles.arsipTitle}>Arsip Lunas / Selesai</Text>
                            <TouchableOpacity onPress={closeArsipModal}>
                                <Ionicons name="close" size={24} color="#333" />
                            </TouchableOpacity>
                        </View>

                        {/* FILTER TAHUN & BULAN */}
                        <View style={styles.filterContainer}>
                            <View style={styles.yearSelector}>
                                <TouchableOpacity onPress={() => setFilterYear(prev => prev - 1)} style={styles.arrowBtn}>
                                    <Ionicons name="chevron-back" size={20} color="#1976D2" />
                                </TouchableOpacity>
                                <Text style={styles.yearText}>{filterYear}</Text>
                                <TouchableOpacity onPress={() => setFilterYear(prev => prev + 1)} style={styles.arrowBtn}>
                                    <Ionicons name="chevron-forward" size={20} color="#1976D2" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthScroll}>
                                {MONTHS.map((m) => (
                                    <TouchableOpacity
                                        key={m.value}
                                        onPress={() => setFilterMonth(m.value)}
                                        style={[
                                            styles.monthChip,
                                            filterMonth === m.value ? styles.monthChipActive : null
                                        ]}
                                    >
                                        <Text style={[
                                            styles.monthText,
                                            filterMonth === m.value ? styles.monthTextActive : null
                                        ]}>
                                            {m.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* TOMBOL CETAK PDF */}
                        <TouchableOpacity 
                            style={[styles.btnPdf, printing && {opacity: 0.7}]} 
                            onPress={generateArsipPdf}
                            disabled={printing}
                        >
                            {printing ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="print-outline" size={20} color="#fff" />}
                            <Text style={styles.btnPdfText}>{printing ? "Menyiapkan PDF..." : "Cetak Laporan PDF"}</Text>
                        </TouchableOpacity>

                        <TextInput
                            placeholder="Cari nama user di periode ini..."
                            value={arsipQuery}
                            onChangeText={setArsipQuery}
                            style={styles.searchBar}
                        />

                        <FlatList
                            data={filteredArsip}
                            keyExtractor={(it) => String(it.id)}
                            style={{ maxHeight: 400 }}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    onPress={() => {
                                        setArsipModalVisible(false);
                                        openPopup(item, { readOnly: true });
                                    }}
                                    style={styles.arsipItem}
                                >
                                    <View>
                                        <Text style={styles.arsipName}>{item.nama_user}</Text>
                                        <Text style={styles.arsipDate}>{formatTglIndo(item.tanggal)}</Text>
                                    </View>
                                    <View style={{ alignItems: 'flex-end' }}>
                                        <Text style={styles.arsipNominal}>Total: {formatRupiah(item.nominal)}</Text>
                                        <Text style={[styles.arsipStatus, { color: item.status === "disetujui" ? "green" : "red" }]}>
                                            {item.status}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                            ListEmptyComponent={
                                <View style={{ alignItems: 'center', marginTop: 30 }}>
                                    <Ionicons name="search-outline" size={40} color="#ddd" />
                                    <Text style={{ textAlign: "center", marginTop: 10, color: "#999" }}>
                                        Data tidak ditemukan pada{"\n"}
                                        {filterMonth ? MONTHS.find(m => m.value === filterMonth)?.label : "Semua Bulan"} {filterYear}
                                    </Text>
                                </View>
                            }
                        />
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// 🎨 STYLES MODERN
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#F4F6F8" },
    headerContainer: {
        paddingTop: Platform.OS === "android" ? 40 : 20,
        paddingHorizontal: 20,
        paddingBottom: 15,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: "#fff",
        elevation: 2,
    },
    headerTitle: { fontSize: 22, fontWeight: "800", color: "#1976D2" },
    arsipButton: {
        flexDirection: "row",
        backgroundColor: "#1976D2",
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        alignItems: "center",
    },
    arsipText: { color: "#fff", marginLeft: 5, fontWeight: "600", fontSize: 12 },

    // CARD STYLE
    card: {
        backgroundColor: "#fff",
        borderRadius: 16,
        marginHorizontal: 16,
        marginTop: 16,
        padding: 16,
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 8,
        elevation: 3,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: "#1976D2",
        justifyContent: "center",
        alignItems: "center",
    },
    cardName: { fontSize: 16, fontWeight: "700", color: "#333" },
    cardDate: { fontSize: 12, color: "#888" },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold", textTransform: "uppercase" },
    bgOrange: { backgroundColor: "#FF9800" },
    bgGreen: { backgroundColor: "#43A047" },
    bgRed: { backgroundColor: "#E53935" },

    cardBody: { marginTop: 5 },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
    label: { fontSize: 13, color: "#666" },
    value: { fontSize: 13, color: "#333", fontWeight: "600" },
    labelBold: { fontSize: 14, color: "#333", fontWeight: "bold" },
    valueBold: { fontSize: 14, fontWeight: "800" },
    divider: { height: 1, backgroundColor: "#F0F0F0", marginVertical: 8 },
    keterangan: { fontSize: 12, color: "#999", fontStyle: "italic", marginTop: 4 },

    progressTrack: {
        height: 6,
        backgroundColor: "#E0E0E0",
        borderRadius: 3,
        marginTop: 12,
        overflow: "hidden",
    },
    progressBar: { height: "100%", backgroundColor: "#4CAF50" },

    emptyState: { alignItems: "center", marginTop: 50 },
    emptyText: { color: "#999", marginTop: 10, fontSize: 16 },

    // MODAL EDIT
    overlayBlur: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
    editBox: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center" },
    editTitle: { fontSize: 18, fontWeight: "700", color: "#333", marginBottom: 5 },
    editSubtitle: { fontSize: 13, color: "#666", marginBottom: 20 },
    inputWrapper: {
        flexDirection: "row",
        alignItems: "center",
        borderBottomWidth: 2,
        borderBottomColor: "#1976D2",
        marginBottom: 25,
        width: "100%",
    },
    prefix: { fontSize: 20, fontWeight: "bold", color: "#333", marginRight: 5 },
    inputField: { flex: 1, fontSize: 24, fontWeight: "bold", color: "#1976D2", paddingVertical: 5 },
    btnRow: { flexDirection: "row", width: "100%", justifyContent: "space-between" },
    actionBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: "center", marginHorizontal: 5 },
    btnOutline: { backgroundColor: "#F5F5F5" },
    btnPrimary: { backgroundColor: "#1976D2" },

    // BOTTOM SHEET
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    bottomSheet: {
        backgroundColor: "#fff",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        height: "85%",
        paddingBottom: 20,
    },
    sheetHeader: { padding: 20, borderBottomWidth: 1, borderBottomColor: "#eee" },
    sheetHandle: {
        width: 40,
        height: 4,
        backgroundColor: "#ddd",
        borderRadius: 2,
        alignSelf: "center",
        marginBottom: 15,
    },
    sheetTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sheetTitle: { fontSize: 20, fontWeight: "bold", color: "#1976D2" },
    sheetUser: { fontSize: 14, color: "#666", marginTop: 4 },

    // TABLE
    tableContainer: { padding: 16 },
    tHead: { flexDirection: "row", backgroundColor: "#F5F7FA", padding: 10, borderRadius: 8, marginBottom: 8 },
    tCell: { fontSize: 12, color: "#555" },
    tRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f0f0f0", alignItems: "center" },
    tRowHighlight: { backgroundColor: "#E3F2FD", borderRadius: 8, paddingHorizontal: 8, borderBottomWidth: 0 },
    iconBtn: { padding: 4, backgroundColor: "#E3F2FD", borderRadius: 4 },

    // APPROVAL BOX
    approvalBox: { padding: 16, backgroundColor: "#FFF8E1", margin: 16, borderRadius: 12 },
    approvalText: { fontSize: 12, fontWeight: "bold", color: "#FF8F00", marginBottom: 10 },

    // ARSIP MODAL & FILTER
    arsipContainer: { backgroundColor: "#fff", borderRadius: 12, padding: 16, maxHeight: "85%" },
    arsipHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    arsipTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
    
    filterContainer: { marginBottom: 12 },
    yearSelector: { 
        flexDirection: 'row', 
        justifyContent: 'center', 
        alignItems: 'center', 
        marginBottom: 10 
    },
    arrowBtn: { padding: 8, backgroundColor: "#E3F2FD", borderRadius: 8 },
    yearText: { fontSize: 16, fontWeight: 'bold', color: '#1976D2', marginHorizontal: 15 },
    
    monthScroll: { paddingVertical: 5 },
    monthChip: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: "#F5F5F5",
        marginRight: 8,
        borderWidth: 1,
        borderColor: "transparent"
    },
    monthChipActive: {
        backgroundColor: "#E3F2FD",
        borderColor: "#1976D2"
    },
    monthText: { fontSize: 12, color: "#666" },
    monthTextActive: { color: "#1976D2", fontWeight: "bold" },

    searchBar: {
        backgroundColor: "#F5F5F5",
        borderRadius: 8,
        padding: 10,
        marginBottom: 10,
    },
    arsipItem: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: "#eee",
    },
    arsipName: { fontSize: 14, fontWeight: "bold", color: "#333" },
    arsipDate: { fontSize: 11, color: "#888", marginTop: 2 },
    arsipNominal: { fontSize: 12, color: "#666", fontWeight: "600" },
    arsipStatus: { fontSize: 10, fontWeight: "bold", textAlign: "right", marginTop: 2 },

    // TOMBOL PDF
    btnPdf: {
        backgroundColor: "#BE185D",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        borderRadius: 10,
        gap: 8,
        marginBottom: 12,
        shadowColor: "#BE185D",
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 3,
    },
    btnPdfText: {
        color: "#fff",
        fontWeight: "bold",
        fontSize: 14,
    }
});