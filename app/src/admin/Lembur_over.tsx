import React, { useEffect, useState, useCallback } from "react";
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    Image,
    StatusBar,
    Modal,
    Alert,
    ActivityIndicator,
    RefreshControl,
    TextInput,
    ScrollView,
    Platform
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import { API_BASE } from "../../config";

// --- TYPE DATA ---
interface UserItem {
    id: string | number;
    nama?: string;
    nama_lengkap?: string;
    jabatan?: string;
}

interface LemburItem {
    id: string | number;
    user_id: string | number;
    nama_lengkap: string;
    tanggal: string;
    jam_masuk?: string;
    jam_keluar?: string;
    jam_selesai?: string;
    total_jam: string;
    total_upah: number;
    tarif_lembur: number;
    status: string;
    foto_bukti?: string;
}

interface ApiResponse {
    success: boolean;
    data: LemburItem[];
    message?: string;
}

const formatRupiah = (num: number): string => {
    return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
    }).format(num);
};

export default function AdminLemburOver() {
    // --- STATE UTAMA ---
    const [data, setData] = useState<LemburItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [refreshing, setRefreshing] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string>('pending');

    // --- STATE FILTER & PRINT ---
    const [filterDate, setFilterDate] = useState<Date>(new Date());
    const [showFilterModal, setShowFilterModal] = useState<boolean>(false);

    // --- STATE MODAL & FORM ---
    const [selectedItem, setSelectedItem] = useState<LemburItem | null>(null);
    const [modalVisible, setModalVisible] = useState<boolean>(false);
    const [modalInputVisible, setModalInputVisible] = useState<boolean>(false);

    // --- STATE USER ---
    const [users, setUsers] = useState<UserItem[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<UserItem[]>([]);
    const [searchText, setSearchText] = useState<string>("");
    const [modalUserSelectVisible, setModalUserSelectVisible] = useState<boolean>(false);

    const [formUser, setFormUser] = useState<UserItem | null>(null);
    const [formKet, setFormKet] = useState<string>("");
    const [formTotalJam, setFormTotalJam] = useState<string>("0");
    const [date, setDate] = useState<Date>(new Date());
    const [time, setTime] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
    const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
    const [loadingSubmit, setLoadingSubmit] = useState<boolean>(false);

    // --- HELPER JAM (Agar Tampil Benar) ---
    const getJamKeluarDisplay = (item: LemburItem) => {
        if (item.jam_selesai && item.jam_selesai !== "00:00:00" && item.jam_selesai.length >= 5) {
            return item.jam_selesai.substring(0, 5);
        }
        if (item.jam_keluar && item.jam_keluar !== "0000-00-00 00:00:00") {
            if (item.jam_keluar.includes(" ")) {
                const parts = item.jam_keluar.split(" ");
                if (parts[1]) return parts[1].substring(0, 5);
            } else if (item.jam_keluar.length >= 5) {
                return item.jam_keluar.substring(0, 5);
            }
        }
        return "00:00";
    };

    // --- LOAD DATA ---
    const fetchData = async (isBackground: boolean = false): Promise<void> => {
        try {
            if (!isBackground) setLoading(true);
            const response = await fetch(`${API_BASE}/lembur/list_lembur_over.php`);
            const json: ApiResponse = await response.json();
            if (json.success) setData(json.data); else setData([]);
        } catch (error) { console.error("Fetch Error:", error); }
        finally { setLoading(false); setRefreshing(false); }
    };

    const fetchUsers = async (): Promise<void> => {
        try {
            const response = await fetch(`${API_BASE}/gaji/gaji_users.php`);
            const json = await response.json();
            const userData = json.data || json;
            setUsers(userData);
            setFilteredUsers(userData);
        } catch (error) { console.log("Gagal load user", error); }
    };

    useEffect(() => {
        fetchData(); fetchUsers();
        const interval = setInterval(() => { fetchData(true); }, 10000);
        return () => clearInterval(interval);
    }, []);

    const onRefresh = useCallback((): void => {
        setRefreshing(true); fetchData(); fetchUsers();
    }, []);

    // --- SEARCH USER LOGIC ---
    const handleSearchUser = (text: string): void => {
        setSearchText(text);
        if (text) {
            const newData = users.filter((item: UserItem) => {
                const nameStr = item.nama || item.nama_lengkap || "";
                return nameStr.toUpperCase().indexOf(text.toUpperCase()) > -1;
            });
            setFilteredUsers(newData);
        } else {
            setFilteredUsers(users);
        }
    };

    // --- DATE & TIME HANDLERS + HITUNG TOTAL JAM OTOMATIS ---
    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date): void => {
        const currentDate = selectedDate || date;
        setShowDatePicker(Platform.OS === 'ios');
        setDate(currentDate);
    };

    const onTimeChange = (event: DateTimePickerEvent, selectedTime?: Date): void => {
        if (event.type === 'dismissed') {
            setShowTimePicker(false);
            return;
        }
        const currentTime = selectedTime || time;
        setShowTimePicker(Platform.OS === 'ios');

        if (selectedTime) {
            setTime(currentTime);
            // Hitung Selisih dari jam 20:00
            const jamMulai = 20; const menitMulai = 0;
            let startMinutes = (jamMulai * 60) + menitMulai;
            let endMinutes = (currentTime.getHours() * 60) + currentTime.getMinutes();
            if (endMinutes < startMinutes) endMinutes += (24 * 60);
            let diffMinutes = endMinutes - startMinutes;
            let diffHours = (diffMinutes / 60).toFixed(2);
            setFormTotalJam(String(diffHours));
        }
    };

    const handleSimpanManual = async (): Promise<void> => {
        if (!formUser || !formTotalJam || !formKet) {
            Alert.alert("Gagal", "Lengkapi Data!");
            return;
        }
        setLoadingSubmit(true);
        try {
            const formData = new FormData();
            formData.append("user_id", String(formUser.id));
            formData.append("tanggal", date.toISOString().split('T')[0]);
            formData.append("jam_mulai", "20:00");
            formData.append("jam_selesai", `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`);
            formData.append("total_jam", formTotalJam);
            formData.append("total_menit", String(Math.round(parseFloat(formTotalJam) * 60)));
            formData.append("keterangan", formKet + " (Input Admin)");
            formData.append("status", "pending");

            const response = await fetch(`${API_BASE}/lembur/save_lembur_over.php`, { method: "POST", body: formData });
            const json = await response.json();

            if (json.success) {
                Alert.alert("Sukses", "Data disimpan.");
                setModalInputVisible(false);
                fetchData();
                setFormUser(null); setFormKet(""); setFormTotalJam("0");
                setActiveTab('pending');
            } else { Alert.alert("Gagal", json.message); }
        } catch (error) { Alert.alert("Error", "Koneksi Bermasalah"); }
        finally { setLoadingSubmit(false); }
    };

    // --- ACTIONS: DELETE & APPROVE/REJECT ---
    const handleDelete = (id: string | number) => {
        Alert.alert("Hapus Data", "Yakin hapus permanen?", [{ text: "Batal" }, {
            text: "Hapus", style: "destructive", onPress: async () => {
                try {
                    const fd = new FormData(); fd.append("id", String(id));
                    const res = await fetch(`${API_BASE}/lembur/delete_lembur_over.php`, { method: "POST", body: fd });
                    const json = await res.json();
                    if (json.success) { Alert.alert("Sukses", "Data dihapus"); fetchData(); }
                    else Alert.alert("Gagal", json.message);
                } catch (e) { Alert.alert("Error", "Koneksi Bermasalah"); }
            }
        }]);
    };

    const handleAction = (id: string | number, action: 'approve' | 'reject') => {
        Alert.alert("Konfirmasi", `Yakin ingin ${action}?`, [{ text: "Batal" }, {
            text: "Ya", onPress: async () => {
                try {
                    const fd = new FormData(); fd.append("id", String(id)); fd.append("action", action);
                    const res = await fetch(`${API_BASE}/lembur/action_lembur.php`, { method: "POST", body: fd });
                    const json = await res.json();
                    if (json.success) { Alert.alert("Sukses", json.message); fetchData(); setModalVisible(false); }
                    else Alert.alert("Gagal", json.message);
                } catch (e) { Alert.alert("Error", "Gagal koneksi"); }
            }
        }]);
    };

    // --- FILTER & PRINT ---
    const displayedData = data.filter((item: LemburItem) => {
        const s = item.status ? item.status.toLowerCase() : '';
        const isPending = s === 'pending' || s === 'menunggu';
        if (activeTab === 'pending') return isPending;
        else {
            if (isPending) return false;
            const itemDate = new Date(item.tanggal);
            return itemDate.getMonth() === filterDate.getMonth() && itemDate.getFullYear() === filterDate.getFullYear();
        }
    });

    const handlePrint = async () => {
        if (displayedData.length === 0) { Alert.alert("Data Kosong", "Tidak ada data arsip."); return; }
        const totalPengeluaran = displayedData.reduce((sum, item) => sum + Number(item.total_upah || 0), 0);
        const bulanTahun = filterDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
        const htmlContent = `
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #A51C24; padding-bottom: 10px; }
                        h1 { color: #A51C24; margin: 0; font-size: 20px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 10px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #A51C24; color: white; }
                        .footer { margin-top: 20px; text-align: right; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="header"><h1>LAPORAN LEMBUR LANJUTAN</h1><p>Periode: ${bulanTahun}</p></div>
                    <table>
                        <thead><tr><th>No</th><th>Nama</th><th>Tanggal</th><th>Jam Kerja</th><th>Durasi</th><th>Upah</th></tr></thead>
                        <tbody>${displayedData.map((item, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${item.nama_lengkap}</td>
                                <td>${new Date(item.tanggal).toLocaleDateString('id-ID')}</td>
                                <td>20:00 - ${getJamKeluarDisplay(item)}</td>
                                <td>${item.total_jam} Jam</td>
                                <td>${formatRupiah(item.total_upah)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                    <div class="footer">Total: ${formatRupiah(totalPengeluaran)}</div>
                </body>
            </html>`;
        try { await Print.printAsync({ html: htmlContent }); } catch (e) { Alert.alert("Error", "Gagal print"); }
    };

    const renderItem = ({ item }: { item: LemburItem }) => {
        const s = item.status.toLowerCase();
        const isPending = s === 'pending' || s === 'menunggu';
        const jamKeluar = getJamKeluarDisplay(item);
        let statusBg = '#fff7ed', statusTxt = '#c2410c', statusBorder = '#ffedd5';
        if (s === 'approved') { statusBg = '#dcfce7'; statusTxt = '#166534'; statusBorder = '#bbf7d0'; }
        else if (s === 'rejected') { statusBg = '#fee2e2'; statusTxt = '#991b1b'; statusBorder = '#fecaca'; }

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View>
                        <Text style={styles.name}>{item.nama_lengkap}</Text>
                        <Text style={styles.date}>{new Date(item.tanggal).toLocaleDateString("id-ID", { dateStyle: 'full' })}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: statusBg, borderColor: statusBorder }]}>
                        <Text style={[styles.badgeText, { color: statusTxt }]}>{item.status.toUpperCase()}</Text>
                    </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.rowInfo}>
                    <View style={styles.infoBox}><Text style={styles.label}>Jam Kerja</Text><Text style={[styles.value, { fontSize: 12 }]}>20:00 - {jamKeluar}</Text></View>
                    <View style={styles.infoBox}><Text style={styles.label}>Durasi</Text><Text style={styles.value}>{item.total_jam} Jam</Text></View>
                    <View style={styles.infoBox}><Text style={[styles.label, { color: '#e11d48' }]}>Tarif x2</Text><Text style={[styles.value, { color: '#64748b' }]}>{formatRupiah(item.tarif_lembur || 0)}</Text></View>
                    <View style={styles.infoBox}><Text style={styles.label}>Total</Text><Text style={[styles.value, { color: '#16a34a' }]}>{formatRupiah(item.total_upah)}</Text></View>
                </View>
                <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.btnDetail} onPress={() => { setSelectedItem(item); setModalVisible(true); }}>
                        <MaterialCommunityIcons name="image-search" size={20} color="#fff" />
                        <Text style={styles.btnText}>Bukti</Text>
                    </TouchableOpacity>
                    {isPending ? (
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity style={[styles.btnAction, { backgroundColor: '#ef4444' }]} onPress={() => handleAction(item.id, 'reject')}><MaterialCommunityIcons name="close" size={24} color="#fff" /></TouchableOpacity>
                            <TouchableOpacity style={[styles.btnAction, { backgroundColor: '#22c55e' }]} onPress={() => handleAction(item.id, 'approve')}><MaterialCommunityIcons name="check" size={24} color="#fff" /></TouchableOpacity>
                        </View>
                    ) : (
                        <TouchableOpacity style={[styles.btnAction, { backgroundColor: '#fee2e2', width: 'auto', paddingHorizontal: 12 }]} onPress={() => handleDelete(item.id)}>
                            <MaterialCommunityIcons name="trash-can-outline" size={20} color="#991b1b" />
                            <Text style={{ color: '#991b1b', fontWeight: 'bold', marginLeft: 5, fontSize: 12 }}>Hapus</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar backgroundColor="#A51C24" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 15 }}>
                    <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}><Text style={styles.headerTitle}>LEMBUR LANJUTAN</Text></View>
                {activeTab === 'history' && (
                    <TouchableOpacity onPress={handlePrint} style={[styles.filterBtn, { marginRight: 10 }]}>
                        <MaterialCommunityIcons name="printer" size={24} color="#fff" />
                    </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowFilterModal(true)} style={styles.filterBtn}>
                    <MaterialCommunityIcons name="calendar-month" size={24} color="#fff" />
                </TouchableOpacity>
            </View>

            <View style={styles.tabContainer}>
                <TouchableOpacity style={[styles.tabButton, activeTab === 'pending' && styles.tabActive]} onPress={() => setActiveTab('pending')}><Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>Menunggu</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.tabButton, activeTab === 'history' && styles.tabActive]} onPress={() => setActiveTab('history')}>
                    <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
                        Riwayat {activeTab === 'history' ? `(${filterDate.toLocaleString('default', { month: 'short' })})` : ''}
                    </Text>
                </TouchableOpacity>
            </View>

            {loading ? <ActivityIndicator size="large" color="#A51C24" style={{ marginTop: 50 }} /> : (
                <FlatList data={displayedData} keyExtractor={item => item.id.toString()} renderItem={renderItem} contentContainerStyle={{ padding: 20, paddingBottom: 100 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#A51C24"]} />} ListEmptyComponent={<View style={styles.emptyContainer}><MaterialCommunityIcons name="file-document-outline" size={60} color="#ccc" /><Text style={{ color: "#888", marginTop: 10 }}>{activeTab === 'pending' ? "Tidak ada pengajuan baru." : `Tidak ada data bulan ${filterDate.toLocaleString('default', { month: 'long', year: 'numeric' })}.`}</Text></View>} />
            )}

            <TouchableOpacity style={styles.fab} onPress={() => setModalInputVisible(true)}><MaterialCommunityIcons name="plus" size={32} color="#fff" /></TouchableOpacity>

            {/* MODAL FILTER BULAN */}
            <Modal visible={showFilterModal} transparent animationType="fade" onRequestClose={() => setShowFilterModal(false)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { alignItems: 'center' }]}>
                        <Text style={styles.modalTitle}>Pilih Periode Arsip</Text>
                        <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center', marginBottom: 20 }}>
                            <TouchableOpacity style={styles.datePickerBtn} onPress={() => { const d = new Date(filterDate); d.setMonth(d.getMonth() - 1); setFilterDate(d); }}><MaterialCommunityIcons name="chevron-left" size={28} color="#333" /></TouchableOpacity>
                            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#A51C24', minWidth: 120, textAlign: 'center' }}>{filterDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}</Text>
                            <TouchableOpacity style={styles.datePickerBtn} onPress={() => { const d = new Date(filterDate); d.setMonth(d.getMonth() + 1); setFilterDate(d); }}><MaterialCommunityIcons name="chevron-right" size={28} color="#333" /></TouchableOpacity>
                        </View>
                        <TouchableOpacity style={[styles.btnSubmit, { width: '100%', marginTop: 0 }]} onPress={() => { setShowFilterModal(false); setActiveTab('history'); }}>
                            <Text style={styles.btnText}>TAMPILKAN</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* MODAL INPUT MANUAL */}
            <Modal visible={modalInputVisible} animationType="slide" transparent={true} onRequestClose={() => setModalInputVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContentInput}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Input Lembur Manual</Text>
                            <TouchableOpacity onPress={() => setModalInputVisible(false)}><MaterialCommunityIcons name="close" size={24} color="#333" /></TouchableOpacity>
                        </View>
                        <ScrollView style={{ padding: 20 }}>
                            <Text style={styles.inputLabel}>Nama Karyawan</Text>
                            <TouchableOpacity style={styles.inputBox} onPress={() => { setSearchText(""); setFilteredUsers(users); setModalUserSelectVisible(true); }}>
                                {/* INI YANG DIREQUEST: TAMPILKAN NAMA BENAR */}
                                <Text style={{ color: formUser ? '#000' : '#888' }}>
                                    {formUser ? (formUser.nama || formUser.nama_lengkap) : "Pilih Karyawan..."}
                                </Text>
                                <MaterialCommunityIcons name="chevron-down" size={20} color="#888" />
                            </TouchableOpacity>

                            <Text style={styles.inputLabel}>Tanggal</Text>
                            <TouchableOpacity style={styles.inputBox} onPress={() => setShowDatePicker(true)}><Text style={{ color: '#000' }}>{date.toLocaleDateString('id-ID')}</Text><MaterialCommunityIcons name="calendar" size={20} color="#A51C24" /></TouchableOpacity>
                            {showDatePicker && <DateTimePicker value={date} mode="date" display="default" onChange={(e, d) => { setShowDatePicker(Platform.OS === 'ios'); if (d) setDate(d); }} />}
                            <Text style={styles.inputLabel}>Jam Selesai</Text>
                            <TouchableOpacity style={styles.inputBox} onPress={() => setShowTimePicker(true)}><Text style={{ color: '#000', fontWeight: 'bold' }}>{String(time.getHours()).padStart(2, '0')}:{String(time.getMinutes()).padStart(2, '0')}</Text><MaterialCommunityIcons name="clock-outline" size={20} color="#A51C24" /></TouchableOpacity>
                            {showTimePicker && <DateTimePicker value={time} mode="time" display="default" is24Hour={true} onChange={onTimeChange} />}
                            <Text style={styles.inputLabel}>Total Jam</Text>
                            <TextInput style={styles.inputBox} value={formTotalJam} onChangeText={setFormTotalJam} keyboardType="numeric" />
                            <Text style={styles.inputLabel}>Keterangan</Text>
                            <TextInput style={[styles.inputBox, { height: 80, textAlignVertical: 'top' }]} value={formKet} onChangeText={setFormKet} placeholder="Alasan..." multiline />
                            <TouchableOpacity style={[styles.btnSubmit, loadingSubmit && { backgroundColor: '#ccc' }]} onPress={handleSimpanManual} disabled={loadingSubmit}>{loadingSubmit ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>SIMPAN</Text>}</TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* MODAL USER SELECT (TAMPILAN DIKEMBALIKAN KE AWAL) */}
            <Modal visible={modalUserSelectVisible} animationType="slide" onRequestClose={() => setModalUserSelectVisible(false)}>
                <View style={{ flex: 1, backgroundColor: '#fff' }}>
                    <View style={[styles.header, { paddingTop: 15, paddingBottom: 15 }]}>
                        <Text style={styles.headerTitle}>Pilih Karyawan</Text>
                        <TouchableOpacity onPress={() => setModalUserSelectVisible(false)}><MaterialCommunityIcons name="close" size={24} color="#fff" /></TouchableOpacity>
                    </View>
                    <View style={{ padding: 10, backgroundColor: '#f8fafc' }}>
                        <View style={styles.searchBox}>
                            <MaterialCommunityIcons name="magnify" size={20} color="#888" />
                            <TextInput style={{ flex: 1, marginLeft: 10 }} placeholder="Cari Nama..." value={searchText} onChangeText={handleSearchUser} />
                        </View>
                    </View>
                    <FlatList data={filteredUsers} keyExtractor={i => String(i.id)} renderItem={({ item }) => (
                        <TouchableOpacity style={styles.userItem} onPress={() => { setFormUser(item); setModalUserSelectVisible(false); }}>
                            <View style={styles.avatar}><Text style={{ color: '#fff', fontWeight: 'bold' }}>{(item.nama || item.nama_lengkap || "?").charAt(0)}</Text></View>
                            <View><Text style={{ fontWeight: 'bold', fontSize: 16 }}>{item.nama || item.nama_lengkap}</Text><Text style={{ color: '#666', fontSize: 12 }}>{item.jabatan || 'Staff'}</Text></View>
                        </TouchableOpacity>
                    )} />
                </View>
            </Modal>

            <Modal visible={modalVisible} transparent onRequestClose={() => setModalVisible(false)}><View style={styles.modalOverlay}><View style={styles.modalContent}><View style={styles.modalHeader}><Text style={styles.modalTitle}>Bukti</Text><TouchableOpacity onPress={() => setModalVisible(false)}><MaterialCommunityIcons name="close" size={24} /></TouchableOpacity></View>{selectedItem?.foto_bukti ? <Image source={{ uri: `${API_BASE.replace('/api', '')}/uploads/lembur/${selectedItem.foto_bukti}` }} style={styles.modalImage} resizeMode="contain" /> : <Text style={{ padding: 20 }}>Tidak ada foto</Text>}</View></View></Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f8fafc" },
    header: { backgroundColor: "#A51C24", paddingTop: StatusBar.currentHeight || 40, paddingBottom: 20, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: 'space-between' },
    headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
    filterBtn: { padding: 5 },
    tabContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', elevation: 2 },
    tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: '#A51C24' },
    tabText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
    tabTextActive: { color: '#A51C24', fontWeight: 'bold' },
    card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, elevation: 3 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    name: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
    date: { fontSize: 12, color: '#64748b', marginTop: 2 },
    badge: { padding: 4, borderRadius: 4, borderWidth: 1 },
    badgeText: { fontSize: 10, fontWeight: 'bold' },
    divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 12 },
    rowInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    infoBox: { alignItems: 'center', flex: 1 },
    label: { fontSize: 11, color: '#94a3b8', marginBottom: 2, fontWeight: '600' },
    value: { fontSize: 13, fontWeight: 'bold', color: '#334155', textAlign: 'center' },
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    btnDetail: { flexDirection: 'row', backgroundColor: '#3b82f6', padding: 8, borderRadius: 8, alignItems: 'center', gap: 5 },
    btnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
    btnAction: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    fab: { position: 'absolute', bottom: 30, right: 30, backgroundColor: '#A51C24', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', maxHeight: '80%', padding: 20 },
    modalContentInput: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
    modalTitle: { fontSize: 16, fontWeight: 'bold' },
    modalImageContainer: { height: 300, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    modalImage: { width: '100%', height: '100%' },
    inputLabel: { fontSize: 12, fontWeight: 'bold', color: '#334155', marginBottom: 5, marginTop: 10 },
    inputBox: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12, fontSize: 14, backgroundColor: "#f8fafc", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    btnSubmit: { backgroundColor: "#A51C24", padding: 15, borderRadius: 10, alignItems: "center", marginTop: 25, marginBottom: 20 },
    searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, height: 45, marginBottom: 10 },
    userItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#A51C24', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
    datePickerBtn: { padding: 10, backgroundColor: '#f1f5f9', borderRadius: 8 }
});