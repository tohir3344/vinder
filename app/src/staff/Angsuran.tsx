// app/user/Angsuran.tsx
import React, { useEffect, useMemo, useState } from "react";
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
  ScrollView,
  StatusBar,
  Platform,
  Pressable 
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";
const API_URL = `${BASE}angsuran/angsuran.php`;
const API_RIWAYAT = (id: number | string) =>
  `${BASE}angsuran/riwayat.php?angsuran_id=${encodeURIComponent(String(id))}`;

/** ===== Types ===== */
type AngsuranRow = {
  id: number;
  user_id?: number;
  nama_user?: string;
  nominal: number;
  sisa: number;
  keterangan?: string | null;
  tanggal: string; // YYYY-MM-DD
  status?: string | null; // pending | disetujui | ditolak | lunas
};

type RiwayatRow = {
  id: number;
  tanggal: string; // YYYY-MM-DD
  potongan: number;
  sisa: number;
};

// Helper Format Rupiah
const formatRupiah = (num: number) => {
  return "Rp " + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Helper Tanggal Indo
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

export default function AngsuranUserPage() {
  const [data, setData] = useState<AngsuranRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [authUserId, setAuthUserId] = useState<number | null>(null);
  
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

  // Info Modal
  const [showInfo, setShowInfo] = useState(false);

  // Auth boot
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        if (raw) {
          const j = JSON.parse(raw);
          setAuthUserId(Number(j.user_id ?? j.id ?? 0) || null);
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
    if (authUserId == null) return;

    setLoading(true);
    try {
      let url = API_URL;
      if (authUserId) {
        url += `?user_id=${encodeURIComponent(String(authUserId))}`;
      }

      const res = await fetch(url);
      const text = await res.text();
      let json: any = [];
      try {
        json = JSON.parse(text);
      } catch {}

      if (Array.isArray(json)) {
        const myId = Number(authUserId);
        const onlyMine = json.filter((r: any) => Number(r.user_id ?? myId) === myId);

        setData(
          onlyMine.map((r: any) => ({
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

  const hasActiveDebt = useMemo(() => {
    return data.some(
      (d) => (d.status ?? "pending") !== "ditolak" && Number(d.sisa ?? d.nominal) > 0
    );
  }, [data]);

  const openAddModal = () => {
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
    const cleanNominal = nominal.replace(/\./g, "");
    
    if (!cleanNominal || isNaN(Number(cleanNominal))) {
      Alert.alert("Gagal", "Nominal wajib diisi angka valid.");
      return;
    }
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: authUserId,
          nominal: Number(cleanNominal),
          keterangan,
          tanggal,
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
      Alert.alert("Error", "Koneksi gagal.");
    }
  };

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
      const json = await res.json();
      
      const toDateOnly = (v: any) => {
        const s = (v ?? "").toString();
        if (s.includes("T")) return s.split("T")[0];
        return s.split(" ")[0];
      };

      let rows: RiwayatRow[] = [];
      const rawData = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
      
      rows = rawData.map((r: any, i: number) => ({
        id: Number(r.id ?? i + 1),
        tanggal: toDateOnly(r.tanggal ?? r.tanggal_potong ?? r.created_at),
        potongan: Number(r.potongan ?? 0),
        sisa: Number(r.sisa ?? r.sisa_setelah ?? 0),
      }));
      
      setRiwayat(rows.reverse());
    } catch (e) {
      setRiwayat([]);
    } finally {
      setRiwayatLoading(false);
    }
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
            const json = await res.json();
            if (json?.success) {
              await fetchList();
            } else {
              Alert.alert("Gagal", json?.message ?? "Tidak dapat menghapus.");
            }
          } catch (e) {
            Alert.alert("Error", "Koneksi gagal.");
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: AngsuranRow }) => {
    const sisa = Number(item.sisa ?? item.nominal ?? 0);
    const status = (item.status ?? "pending").toLowerCase();
    const progress = ((item.nominal - sisa) / item.nominal) * 100;
    const isPending = status === "pending";
    const isDitolak = status === "ditolak";
    const isLunas = sisa <= 0 || status === "lunas";

    let badgeStyle = styles.badgeProcess;
    if (isDitolak) badgeStyle = styles.badgeReject;
    if (isLunas) badgeStyle = styles.badgeSuccess;
    if (isPending) badgeStyle = styles.badgeWarning;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => openDetail(item)}
        activeOpacity={0.9}
      >
        <View style={styles.cardHeader}>
          <View style={styles.iconContainer}>
            <Ionicons name="wallet-outline" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.cardTitle}>Pinjaman #{item.id}</Text>
            <Text style={styles.cardDate}>{formatTglIndo(item.tanggal)}</Text>
          </View>
          <View style={[styles.badge, badgeStyle]}>
            <Text style={styles.badgeText}>{isLunas ? "LUNAS" : status.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Nominal</Text>
            <Text style={styles.value}>{formatRupiah(item.nominal)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.rowBetween}>
            <Text style={styles.labelBold}>Sisa Tagihan</Text>
            <Text style={[styles.valueBold, { color: sisa > 0 ? "#E53935" : "#43A047" }]}>
              {formatRupiah(sisa)}
            </Text>
          </View>
          {item.keterangan ? (
            <Text style={styles.keterangan} numberOfLines={1}>{`"${item.keterangan}"`}</Text>
          ) : null}
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity 
            onPress={() => openDetail(item)} 
            style={styles.detailBtn}
          >
            <Text style={{color: '#1976D2', fontWeight: 'bold'}}>Lihat Riwayat</Text>
          </TouchableOpacity>
          
          {(isDitolak || isLunas) && (
            <TouchableOpacity onPress={() => handleDelete(item.id)}>
              <Text style={{color: '#D32F2F', fontWeight: 'bold'}}>Hapus Arsip</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F8" />
      
      <View style={styles.headerContainer}>
        <Text style={styles.headerTitle}>Angsuran Saya</Text>
        <View style={{flexDirection:'row', gap: 10}}>
            {/* Tombol Info */}
            <TouchableOpacity onPress={() => setShowInfo(true)} style={styles.infoBtn}>
                <Ionicons name="information-circle-outline" size={26} color="#1976D2" />
            </TouchableOpacity>
            {/* Tombol Ajukan */}
            <TouchableOpacity
                disabled={hasActiveDebt}
                onPress={openAddModal}
                style={[
                    styles.addButton,
                    hasActiveDebt ? { backgroundColor: "#B0BEC5" } : { backgroundColor: "#1976D2" },
                ]}
            >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addButtonText}>Ajukan Baru</Text>
            </TouchableOpacity>
        </View>
      </View>

      {hasActiveDebt && (
        <View style={styles.warningBox}>
          <Ionicons name="information-circle" size={20} color="#E65100" />
          <Text style={styles.warningText}>
            Anda memiliki angsuran aktif. Lunasi dulu sebelum mengajukan lagi.
          </Text>
        </View>
      )}

      <FlatList
        data={data}
        keyExtractor={(it) => String(it.id)}
        refreshing={loading}
        onRefresh={fetchList}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="documents-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Belum ada riwayat angsuran.</Text>
          </View>
        }
      />

      {/* Modal Pengajuan */}
      <Modal visible={showModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Ajukan Pinjaman</Text>
            <Text style={styles.modalSub}>Masukkan detail pengajuan anda</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Nominal (Rp)</Text>
              <TextInput
                style={styles.input}
                placeholder="Contoh: 500000"
                keyboardType="numeric"
                value={nominal}
                onChangeText={setNominal}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Keterangan</Text>
              <TextInput
                style={styles.input}
                placeholder="Keperluan..."
                value={keterangan}
                onChangeText={setKeterangan}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.btnOutline]}
                onPress={() => setShowModal(false)}
              >
                <Text style={{color: '#555'}}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.btnPrimary]}
                onPress={handleSubmit}
              >
                <Text style={{color: '#fff', fontWeight: 'bold'}}>Kirim</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Riwayat */}
      <Modal visible={detailOpen} transparent animationType="slide" onRequestClose={() => setDetailOpen(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{flex:1}} onPress={() => setDetailOpen(false)} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitle}>Riwayat Pembayaran</Text>
                <TouchableOpacity onPress={() => setDetailOpen(false)}>
                  <Ionicons name="close-circle" size={28} color="#ddd" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={{ flex: 1, padding: 16 }}>
               <View style={styles.tableRowHeader}>
                  <Text style={[styles.tCell, {flex:1}]}>Tanggal</Text>
                  <Text style={[styles.tCell, {flex:1.2}]}>Bayar</Text>
                  <Text style={[styles.tCell, {flex:1.2}]}>Sisa</Text>
               </View>

               {riwayatLoading ? (
                  <ActivityIndicator style={{marginTop: 20}} />
               ) : riwayat.length === 0 ? (
                  <Text style={{textAlign: 'center', marginTop: 20, color: '#888'}}>Belum ada pembayaran.</Text>
               ) : (
                  riwayat.map((r) => (
                    <View key={r.id} style={styles.tableRow}>
                        <Text style={[styles.tCell, {flex:1, fontSize: 12}]}>{formatTglIndo(r.tanggal)}</Text>
                        <Text style={[styles.tCell, {flex:1.2, color: '#43A047'}]}>{formatRupiah(r.potongan)}</Text>
                        <Text style={[styles.tCell, {flex:1.2, fontWeight: 'bold'}]}>{formatRupiah(r.sisa)}</Text>
                    </View>
                  ))
               )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal Info (BARU) */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, {maxHeight: '70%'}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <Text style={styles.modalTitle}>Info Angsuran</Text>
                <Pressable onPress={() => setShowInfo(false)}>
                    <Ionicons name="close" size={24} color="#666" />
                </Pressable>
            </View>
            <ScrollView style={{marginBottom: 10}}>
                <Text style={styles.infoItem}>💸 <Text style={{fontWeight:'bold'}}>Potongan:</Text> Gaji Anda akan otomatis dipotong setiap minggu/bulan untuk mencicil pinjaman.</Text>
                <Text style={styles.infoItem}>📝 <Text style={{fontWeight:'bold'}}>Status:</Text> Pengajuan baru akan diperiksa Admin terlebih dahulu.</Text>
                <Text style={styles.infoItem}>🔒 <Text style={{fontWeight:'bold'}}>Limit:</Text> Anda hanya bisa memiliki 1 pinjaman aktif dalam satu waktu.</Text>
                <Text style={styles.infoItem}>📊 <Text style={{fontWeight:'bold'}}>Riwayat:</Text> Klik Lihat Riwayat untuk memantau sisa tagihan Anda.</Text>
            </ScrollView>
            
            {/* 🔥 FIX TOMBOL MENGERTI: Pake style manual biar gak kena flex:1 */}
            <Pressable 
                onPress={() => setShowInfo(false)} 
                style={[styles.modalBtn, styles.btnPrimary, { flex: 0, width: '100%', marginHorizontal: 0 }]}
            >
              <Text style={{color:'#fff', fontWeight:'bold'}}>Mengerti</Text>
            </Pressable>
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
  
  infoBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    alignItems: "center",
  },
  addButtonText: { color: "#fff", marginLeft: 4, fontWeight: "600", fontSize: 12 },

  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFE0B2'
  },
  warningText: { marginLeft: 8, color: '#E65100', fontSize: 12, flex: 1 },

  // CARD
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
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#333" },
  cardDate: { fontSize: 12, color: "#888" },
  
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold", textTransform: "uppercase" },
  badgeProcess: { backgroundColor: "#1976D2" }, 
  badgeSuccess: { backgroundColor: "#43A047" }, 
  badgeWarning: { backgroundColor: "#FFA000" }, 
  badgeReject: { backgroundColor: "#D32F2F" }, 

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
    marginBottom: 12,
    overflow: "hidden",
  },
  progressBar: { height: "100%", backgroundColor: "#4CAF50" },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12
  },
  detailBtn: { paddingVertical: 4 },

  emptyState: { alignItems: "center", marginTop: 50 },
  emptyText: { color: "#999", marginTop: 10, fontSize: 16 },

  // MODAL PENGAJUAN & INFO
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: "#fff", borderRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#333", marginBottom: 4 },
  modalSub: { fontSize: 13, color: "#666", marginBottom: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { fontSize: 12, color: "#333", fontWeight: '600', marginBottom: 6 },
  input: { 
    borderWidth: 1, 
    borderColor: "#ddd", 
    borderRadius: 8, 
    padding: 12, 
    fontSize: 16,
    backgroundColor: '#FAFAFA' 
  },
  modalActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  modalBtn: { flex: 1, padding: 12, borderRadius: 8, alignItems: "center", marginHorizontal: 5 },
  btnOutline: { backgroundColor: "#F5F5F5" },
  btnPrimary: { backgroundColor: "#1976D2" },
  infoItem: { marginBottom: 10, color: "#374151", lineHeight: 20, fontSize: 14 },

  // BOTTOM SHEET RIWAYAT
  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "70%",
    marginTop: 'auto',
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
  sheetTitle: { fontSize: 18, fontWeight: "bold", color: "#1976D2" },

  tableRowHeader: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#ddd", paddingBottom: 8, marginBottom: 8 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#f0f0f0", paddingVertical: 10 },
  tCell: { color: "#333" },
});