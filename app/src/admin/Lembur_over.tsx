import React, { useEffect, useState, useCallback, useRef } from "react";
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
import { API_BASE } from "../../config";

// --- 1. DEFINISI KTP (TYPE) DATA ---

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
    jam_selesai: string;
    total_jam: string;
    total_upah: number;
    tarif_lembur: number;
    status: 'pending' | 'approved' | 'rejected';
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

    // --- STATE MODAL & ALERT NOTIF ---
    const [selectedItem, setSelectedItem] = useState<LemburItem | null>(null); 
    const [modalVisible, setModalVisible] = useState<boolean>(false);
    const [modalInputVisible, setModalInputVisible] = useState<boolean>(false);

    const [newRequestAlert, setNewRequestAlert] = useState<boolean>(false);
    const [lastPendingCount, setLastPendingCount] = useState<number>(0);
    const isFirstLoad = useRef<boolean>(true); 

    // --- STATE USER & SEARCH ---
    const [users, setUsers] = useState<UserItem[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<UserItem[]>([]);
    const [searchText, setSearchText] = useState<string>("");
    const [modalUserSelectVisible, setModalUserSelectVisible] = useState<boolean>(false);

    // --- FORM DATA ---
    const [formUser, setFormUser] = useState<UserItem | null>(null);
    const [formKet, setFormKet] = useState<string>("");
    const [formTotalJam, setFormTotalJam] = useState<string>("0");
    const [date, setDate] = useState<Date>(new Date());
    const [time, setTime] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
    const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
    const [loadingSubmit, setLoadingSubmit] = useState<boolean>(false);

    // --- 1. LOAD DATA ---
    const fetchData = async (isBackground: boolean = false): Promise<void> => {
        try {
            if (!isBackground) setLoading(true);
            const response = await fetch(`${API_BASE}/lembur/list_lembur_over.php`);
            const json: ApiResponse = await response.json();
            
            if (json.success) {
                const currentPending = json.data.filter((i: LemburItem) => i.status === 'pending').length;

                if (!isFirstLoad.current && currentPending > lastPendingCount) {
                    setNewRequestAlert(true);
                }

                setData(json.data);
                setLastPendingCount(currentPending);
                isFirstLoad.current = false;
            } else {
                setData([]);
            }
        } catch (error) {
            console.error("Fetch Error:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // --- 2. LOAD USER ---
    const fetchUsers = async (): Promise<void> => {
        try {
            const response = await fetch(`${API_BASE}/gaji/gaji_users.php`);
            const json = await response.json();
            const userData: UserItem[] = json.data || json;
            setUsers(userData);
            setFilteredUsers(userData);
        } catch (error) { 
            console.log("Gagal load user", error); 
        }
    };

    useEffect(() => { 
        fetchData(); 
        fetchUsers(); 

        const interval = setInterval(() => {
            fetchData(true);
        }, 30000);

        return () => clearInterval(interval);
    }, [lastPendingCount]);

    const onRefresh = useCallback((): void => { 
        setRefreshing(true); 
        fetchData(); 
        fetchUsers(); 
    }, [lastPendingCount]);

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

    const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date): void => {
        const currentDate = selectedDate || date;
        setShowDatePicker(Platform.OS === 'ios');
        setDate(currentDate);
    };

    const onTimeChange = (event: DateTimePickerEvent, selectedTime?: Date): void => {
        const currentTime = selectedTime || time;
        setShowTimePicker(Platform.OS === 'ios');
        if (selectedTime) {
            setTime(currentTime);
            const jamMulai = 20; const menitMulai = 0;
            let startMinutes = (jamMulai * 60) + menitMulai;
            let endMinutes = (currentTime.getHours() * 60) + currentTime.getMinutes();
            if (endMinutes < startMinutes) endMinutes += (24 * 60);
            let diffHours = ((endMinutes - startMinutes) / 60).toFixed(2);
            setFormTotalJam(String(diffHours));
        }
    };

    const handleSimpanManual = async (): Promise<void> => {
        if (!formUser || !formTotalJam || !formKet) {
            Alert.alert("Gagal", "Lengkapi Data!");
            return;
        }
        const formattedDate = date.toISOString().split('T')[0];
        const hours = String(time.getHours()).padStart(2, '0');
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const formattedTime = `${hours}:${minutes}`;

        setLoadingSubmit(true);
        try {
            const formData = new FormData();
            formData.append("user_id", String(formUser.id));
            formData.append("tanggal", formattedDate);
            formData.append("jam_mulai", "20:00");
            formData.append("jam_selesai", formattedTime);
            formData.append("total_jam", formTotalJam);
            formData.append("total_menit", String(Math.round(parseFloat(formTotalJam) * 60)));
            formData.append("keterangan", formKet + " (Input Admin)");
            formData.append("status", "pending");

            const response = await fetch(`${API_BASE}/lembur/save_lembur_over.php`, {
                method: "POST", body: formData,
            });
            const text = await response.text();
            try {
                const json = JSON.parse(text);
                if (json.success) {
                    Alert.alert("Sukses", "Data disimpan ke tab MENUNGGU.");
                    setModalInputVisible(false);
                    fetchData();
                    setFormUser(null); setFormKet(""); setFormTotalJam("0");
                    setActiveTab('pending');
                } else { Alert.alert("Gagal", json.message); }
            } catch (e) { Alert.alert("Error", "Respon server invalid"); }
        } catch (error) { Alert.alert("Error", "Koneksi Bermasalah"); }
        finally { setLoadingSubmit(false); }
    };

    const handleAction = (id: string | number, action: 'approve' | 'reject'): void => {
        Alert.alert("Konfirmasi", `Yakin ingin ${action === 'approve' ? 'menyetujui' : 'menolak'}?`, [
            { text: "Batal", style: "cancel" },
            {
                text: "Ya", onPress: async () => {
                    try {
                        const formData = new FormData();
                        formData.append("id", String(id));
                        formData.append("action", action);
                        const response = await fetch(`${API_BASE}/lembur/action_lembur.php`, { method: "POST", body: formData });
                        const json = await response.json();
                        if (json.success) {
                            Alert.alert("Sukses", json.message);
                            fetchData();
                            setModalVisible(false);
                        } else { Alert.alert("Gagal", json.message); }
                    } catch (err) { Alert.alert("Error", "Gagal koneksi"); }
                }
            }
        ]);
    };

    const displayedData = data.filter((item: LemburItem) => {
        if (activeTab === 'pending') return item.status === 'pending';
        return item.status !== 'pending';
    });

    const renderItem = ({ item }: { item: LemburItem }) => (
        <View style={styles.card}>
            <View style={styles.cardHeader}>
                <View>
                    <Text style={styles.name}>{item.nama_lengkap}</Text>
                    <Text style={styles.date}>{new Date(item.tanggal).toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                </View>
                <View style={[styles.badge, item.status === 'approved' ? { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' } : (item.status === 'rejected' ? { backgroundColor: '#fee2e2', borderColor: '#fecaca' } : {})]}>
                    <Text style={[styles.badgeText, item.status === 'approved' ? { color: '#166534' } : (item.status === 'rejected' ? { color: '#991b1b' } : {})]}>
                        {item.status.toUpperCase()}
                    </Text>
                </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.rowInfo}>
                <View style={styles.infoBox}><Text style={styles.label}>Jam</Text><Text style={styles.value}>{item.jam_selesai ? item.jam_selesai.substring(0, 5) : '00:00'}</Text></View>
                <View style={styles.infoBox}><Text style={styles.label}>Durasi</Text><Text style={styles.value}>{item.total_jam} Jam</Text></View>
                <View style={styles.infoBox}><Text style={[styles.label, { color: '#e11d48' }]}>Tarif x2</Text><Text style={[styles.value, { color: '#64748b' }]}>{formatRupiah(item.tarif_lembur || 0)}</Text></View>
                <View style={styles.infoBox}><Text style={styles.label}>Total</Text><Text style={[styles.value, { color: '#16a34a' }]}>{formatRupiah(item.total_upah)}</Text></View>
            </View>
            <View style={styles.actionRow}>
                <TouchableOpacity style={styles.btnDetail} onPress={() => { setSelectedItem(item); setModalVisible(true); }}>
                    <MaterialCommunityIcons name="image-search" size={20} color="#fff" />
                    <Text style={styles.btnText}>Bukti</Text>
                </TouchableOpacity>
                {activeTab === 'pending' && (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity style={[styles.btnAction, { backgroundColor: '#ef4444' }]} onPress={() => handleAction(item.id, 'reject')}><MaterialCommunityIcons name="close" size={24} color="#fff" /></TouchableOpacity>
                        <TouchableOpacity style={[styles.btnAction, { backgroundColor: '#22c55e' }]} onPress={() => handleAction(item.id, 'approve')}><MaterialCommunityIcons name="check" size={24} color="#fff" /></TouchableOpacity>
                    </View>
                )}
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <StatusBar backgroundColor="#A51C24" barStyle="light-content" />
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 15 }}>
                    <MaterialCommunityIcons name="arrow-left" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>LEMBUR LANJUTAN</Text>
            </View>

            <View style={styles.tabContainer}>
                <TouchableOpacity style={[styles.tabButton, activeTab === 'pending' && styles.tabActive]} onPress={() => setActiveTab('pending')}>
                    <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>Menunggu ({data.filter((i: LemburItem) => i.status === 'pending').length})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tabButton, activeTab === 'history' && styles.tabActive]} onPress={() => setActiveTab('history')}>
                    <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>Riwayat</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <ActivityIndicator size="large" color="#A51C24" style={{ marginTop: 50 }} />
            ) : (
                <FlatList
                    data={displayedData}
                    keyExtractor={(item: LemburItem) => item.id.toString()}
                    renderItem={renderItem}
                    contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#A51C24"]} />}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <MaterialCommunityIcons name="check-all" size={60} color="#ccc" />
                            <Text style={{ color: "#888", marginTop: 10 }}>
                                {activeTab === 'pending' ? "Tidak ada pengajuan baru." : "Belum ada riwayat."}
                            </Text>
                        </View>
                    }
                />
            )}

            <TouchableOpacity style={styles.fab} onPress={() => setModalInputVisible(true)}>
                <MaterialCommunityIcons name="plus" size={32} color="#fff" />
            </TouchableOpacity>

            <Modal visible={newRequestAlert} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.notifAlertContent}>
                        <View style={styles.notifIconContainer}>
                            <MaterialCommunityIcons name="bell-ring" size={50} color="#A51C24" />
                        </View>
                        <Text style={styles.notifTitle}>Pengajuan Baru!</Text>
                        <Text style={styles.notifSub}>Ada user yang baru saja mengajukan lembur lanjutan. Silakan periksa.</Text>
                        <TouchableOpacity 
                            style={styles.notifBtn} 
                            onPress={() => {
                                setNewRequestAlert(false);
                                setActiveTab('pending');
                            }}
                        >
                            <Text style={styles.notifBtnText}>LIHAT SEKARANG</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

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
                                <Text style={{ color: formUser ? '#000' : '#888' }}>{formUser ? (formUser.nama || formUser.nama_lengkap) : "Pilih Karyawan..."}</Text>
                                <MaterialCommunityIcons name="chevron-down" size={20} color="#888" />
                            </TouchableOpacity>

                            <Text style={styles.inputLabel}>Tanggal</Text>
                            <TouchableOpacity style={styles.inputBox} onPress={() => setShowDatePicker(true)}>
                                <Text style={{ color: '#000' }}>{date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                                <MaterialCommunityIcons name="calendar" size={20} color="#A51C24" />
                            </TouchableOpacity>
                            {showDatePicker && <DateTimePicker value={date} mode="date" display="default" onChange={onDateChange} />}

                            <Text style={styles.inputLabel}>Jam Selesai (Start 20:00)</Text>
                            <TouchableOpacity style={styles.inputBox} onPress={() => setShowTimePicker(true)}>
                                <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 16 }}>{String(time.getHours()).padStart(2, '0')}:{String(time.getMinutes()).padStart(2, '0')}</Text>
                                <MaterialCommunityIcons name="clock-outline" size={20} color="#A51C24" />
                            </TouchableOpacity>
                            {showTimePicker && <DateTimePicker value={time} mode="time" display="default" is24Hour={true} onChange={onTimeChange} />}

                            <Text style={styles.inputLabel}>Total Jam</Text>
                            <TextInput style={styles.inputBox} value={formTotalJam} onChangeText={setFormTotalJam} keyboardType="numeric" />

                            <Text style={styles.inputLabel}>Keterangan</Text>
                            <TextInput style={[styles.inputBox, { height: 80, textAlignVertical: 'top' }]} value={formKet} onChangeText={setFormKet} placeholder="Alasan..." multiline />

                            <TouchableOpacity style={[styles.btnSubmit, loadingSubmit && { backgroundColor: '#ccc' }]} onPress={handleSimpanManual} disabled={loadingSubmit}>
                                {loadingSubmit ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>SIMPAN (PENDING)</Text>}
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>

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
                    <FlatList data={filteredUsers} keyExtractor={(item: UserItem) => item.id.toString()} contentContainerStyle={{ padding: 10 }} renderItem={({ item }: { item: UserItem }) => (
                        <TouchableOpacity style={styles.userItem} onPress={() => { setFormUser(item); setModalUserSelectVisible(false); }}>
                            <View style={styles.avatar}><Text style={{ color: '#fff', fontWeight: 'bold' }}>{(item.nama || item.nama_lengkap || "?").charAt(0)}</Text></View>
                            <View><Text style={{ fontWeight: 'bold', fontSize: 16 }}>{item.nama || item.nama_lengkap}</Text><Text style={{ color: '#666', fontSize: 12 }}>{item.jabatan || 'Staff'}</Text></View>
                        </TouchableOpacity>
                    )} />
                </View>
            </Modal>

            <Modal visible={modalVisible} animationType="slide" transparent={true} onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Bukti Lembur</Text>
                            <TouchableOpacity onPress={() => setModalVisible(false)}><MaterialCommunityIcons name="close-circle" size={30} color="#ccc" /></TouchableOpacity>
                        </View>
                        {selectedItem && (
                            <View style={styles.modalImageContainer}>
                                {selectedItem.foto_bukti ? (
                                    <Image source={{ uri: `${API_BASE.replace('/api', '')}/uploads/lembur/${selectedItem.foto_bukti}` }} style={styles.modalImage} resizeMode="contain" />
                                ) : <Text style={{ color: '#fff' }}>Tidak ada foto</Text>}
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#f8fafc" },
    header: { backgroundColor: "#A51C24", paddingTop: StatusBar.currentHeight || 40, paddingBottom: 20, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: 'space-between' },
    headerTitle: { color: "#fff", fontSize: 18, fontWeight: "bold" },
    tabContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', elevation: 2 },
    tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: '#A51C24' },
    tabText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
    tabTextActive: { color: '#A51C24', fontWeight: 'bold' },
    card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, elevation: 3 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    name: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
    date: { fontSize: 12, color: '#64748b', marginTop: 2 },
    badge: { backgroundColor: '#fef2f2', padding: 4, borderRadius: 4, borderWidth: 1, borderColor: '#fecaca' },
    badgeText: { fontSize: 10, fontWeight: 'bold', color: '#A51C24' },
    divider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 12 },
    rowInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
    infoBox: { alignItems: 'center', flex: 1 },
    label: { fontSize: 11, color: '#94a3b8', marginBottom: 2, fontWeight: '600' },
    value: { fontSize: 13, fontWeight: 'bold', color: '#334155', textAlign: 'center' },
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    btnDetail: { flexDirection: 'row', backgroundColor: '#3b82f6', padding: 8, borderRadius: 8, alignItems: 'center', gap: 5 },
    btnText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
    btnAction: { width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    emptyContainer: { alignItems: 'center', marginTop: 100 },
    fab: { position: 'absolute', bottom: 30, right: 30, backgroundColor: '#A51C24', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
    modalContent: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', maxHeight: '80%' },
    modalContentInput: { backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
    modalTitle: { fontSize: 16, fontWeight: 'bold' },
    modalImageContainer: { height: 300, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    modalImage: { width: '100%', height: '100%' },
    inputLabel: { fontSize: 12, fontWeight: 'bold', color: '#334155', marginBottom: 5, marginTop: 10 },
    inputBox: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, padding: 12, fontSize: 14, backgroundColor: "#f8fafc", flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    btnSubmit: { backgroundColor: "#A51C24", padding: 15, borderRadius: 10, alignItems: "center", marginTop: 25, marginBottom: 20 },
    searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, height: 45 },
    userItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#A51C24', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
    notifAlertContent: { backgroundColor: '#fff', borderRadius: 20, padding: 30, alignItems: 'center', elevation: 10 },
    notifIconContainer: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#fef2f2', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    notifTitle: { fontSize: 22, fontWeight: 'bold', color: '#1e293b', marginBottom: 10 },
    notifSub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 25, lineHeight: 20 },
    notifBtn: { backgroundColor: '#A51C24', paddingHorizontal: 30, paddingVertical: 15, borderRadius: 12, width: '100%', alignItems: 'center' },
    notifBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});