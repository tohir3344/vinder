import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Image,
  Dimensions,
  Platform,
  TouchableOpacity, // Tambah ini
  Modal,            // Tambah ini
  Pressable         // Tambah ini
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker"; 
import { API_BASE } from "../../config";

// --- KONFIGURASI ---
const TARGET_KOIN_TAHUNAN = 86400000;
const HEADER_HEIGHT = 120; 

// 🔥 FIX ANTI CRASH: HAPUS 'Intl', GANTI REGEX MANUAL
const formatNumber = (num: number) => {
  if (isNaN(num) || num === null) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Helper Format Tanggal Manual
const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

export default function UserPerformaPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalKoin, setTotalKoin] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  
  // State User Info
  const [userName, setUserName] = useState("User");
  const [userRole, setUserRole] = useState("Staff");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  // State Modal Info
  const [showInfo, setShowInfo] = useState(false);

  // --- FETCH DATA ---
  const fetchData = useCallback(async () => {
    try {
      const sess = await AsyncStorage.getItem("auth");
      if (!sess) return;
      const user = JSON.parse(sess);
      
      setUserName(user.nama_lengkap || user.name || user.username || "Karyawan");
      setUserRole(user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Staff");
      setUserAvatar(user.foto || null);

      const userId = user.id || user.user_id;
      const year = new Date().getFullYear();

      const cleanBase = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";
      const url = `${cleanBase}performa/user_performa.php?user_id=${userId}&year=${year}`;
      
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text);

      if (json.success) {
        setTotalKoin(Number(json.data.total_koin) || 0);
        setHistory(json.data.history || []);
      }
    } catch (e) {
      console.error("Gagal load performa user:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  // --- LOGIC GRADE ---
  const safeTotal = totalKoin || 0;
  const percentage = Math.min((safeTotal / TARGET_KOIN_TAHUNAN) * 100, 100);
  
  let grade = "C";
  let gradeColor = "#EF4444"; 
  let gradeBg = "#FEF2F2";
  let gradeText = "Perlu Ditingkatkan";

  if (percentage >= 75) {
    grade = "A";
    gradeColor = "#10B981"; 
    gradeBg = "#D1FAE5";
    gradeText = "Luar Biasa!";
  } else if (percentage >= 50) {
    grade = "B";
    gradeColor = "#F59E0B"; 
    gradeBg = "#FEF3C7";
    gradeText = "Kinerja Baik";
  }

  const sisa = Math.max(0, TARGET_KOIN_TAHUNAN - safeTotal);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#A51C24" />
      
      <View style={styles.headerBg}>
          {/* HEADER UPDATED: Flex Row biar ada tombol Info */}
          <View style={styles.headerRow}>
            <View>
                <Text style={styles.headerTitle}>Statistik Performa</Text>
                <Text style={styles.headerSubtitle}>Tahun {new Date().getFullYear()}</Text>
            </View>
            <TouchableOpacity onPress={() => setShowInfo(true)} style={styles.infoBtn}>
                <Ionicons name="information-circle-outline" size={26} color="#FFF" />
            </TouchableOpacity>
          </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
            <RefreshControl 
                refreshing={refreshing} 
                onRefresh={onRefresh} 
                progressViewOffset={HEADER_HEIGHT + 10} 
            />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* CARD UTAMA */}
        <View style={styles.mainCard}>
            
            <View style={styles.profileRow}>
                <View style={styles.profileInfo}>
                    <View style={[styles.avatar, { backgroundColor: gradeColor }]}>
                        {userAvatar ? (
                            <Image source={{ uri: userAvatar }} style={styles.avatarImg} />
                        ) : (
                            <Text style={styles.avatarText}>{userName.charAt(0).toUpperCase()}</Text>
                        )}
                    </View>
                    <View style={{flex: 1}}>
                        <Text style={styles.nameText} numberOfLines={1}>{userName}</Text>
                        <Text style={styles.roleText}>{userRole}</Text>
                    </View>
                </View>

                <View style={[styles.gradeBadge, { backgroundColor: gradeBg, borderColor: gradeColor }]}>
                    <Text style={[styles.gradeLabel, { color: gradeColor }]}>{grade}</Text>
                </View>
            </View>

            <View style={styles.divider} />

            <Text style={[styles.statusText, { color: gradeColor }]}>{gradeText}</Text>
            
            <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${percentage}%`, backgroundColor: gradeColor }]} />
            </View>
            
            <View style={styles.progressStats}>
                <Text style={styles.statSmall}>
                    Tercapai: <Text style={{fontWeight:'bold', color: gradeColor}}>{percentage.toFixed(2)}%</Text>
                </Text>
                <Text style={styles.statSmall}>Target: {formatNumber(TARGET_KOIN_TAHUNAN)}</Text>
            </View>

            <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Koin</Text>
                    <Text style={styles.statValue}>{formatNumber(safeTotal)}</Text>
                </View>
                <View style={styles.verticalLine} />
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Kurang</Text>
                    <Text style={[styles.statValue, { color: sisa > 0 ? '#64748B' : '#10B981' }]}>
                        {sisa > 0 ? formatNumber(sisa) : "Lunas!"}
                    </Text>
                </View>
            </View>
        </View>

        {/* RIWAYAT PENDAPATAN */}
        <Text style={styles.sectionTitle}>Riwayat Pendapatan</Text>
        
        {loading ? (
            <ActivityIndicator size="large" color="#1E3A8A" style={{marginTop: 20}} />
        ) : history.length === 0 ? (
            <View style={styles.emptyState}>
                <MaterialCommunityIcons name="chart-timeline-variant" size={48} color="#CBD5E1" />
                <Text style={styles.emptyText}>Belum ada riwayat koin earn.</Text>
            </View>
        ) : (
            history.map((item, idx) => (
                <View key={idx} style={styles.historyItem}>
                    <View style={styles.iconWrapper}>
                        <Ionicons name="arrow-up" size={18} color="#10B981" />
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={styles.historyNote} numberOfLines={1}>{item.note || "Bonus Kinerja"}</Text>
                        <Text style={styles.historyDate}>{formatDate(item.date)}</Text>
                    </View>
                    <Text style={styles.historyAmount}>+{formatNumber(Number(item.amount))}</Text>
                </View>
            ))
        )}
        
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal INFO FITUR (BARU) */}
      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, {maxHeight: '70%'}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                <Text style={styles.modalTitle}>Sistem Performa</Text>
                <Pressable onPress={() => setShowInfo(false)}>
                    <Ionicons name="close" size={24} color="#666" />
                </Pressable>
            </View>
            <ScrollView style={{marginBottom: 10}}>
                <Text style={styles.infoItem}>🎯 <Text style={{fontWeight:'bold'}}>Target:</Text> {formatNumber(TARGET_KOIN_TAHUNAN)} Koin / Tahun.</Text>
                <Text style={styles.infoItem}>💰 <Text style={{fontWeight:'bold'}}>Sumber Koin:</Text> Absensi tepat waktu, lembur, dan bonus kinerja dari admin.</Text>
                <Text style={styles.infoItem}>🏆 <Text style={{fontWeight:'bold'}}>Grade A (Hijau):</Text> Pencapaian di atas 75%.</Text>
                <Text style={styles.infoItem}>⚠️ <Text style={{fontWeight:'bold'}}>Grade B (Kuning):</Text> Pencapaian 50% - 74%.</Text>
                <Text style={styles.infoItem}>🚨 <Text style={{fontWeight:'bold'}}>Grade C (Merah):</Text> Pencapaian di bawah 50%.</Text>
            </ScrollView>
            
            {/* 🔥 TOMBOL MENGERTI FIX */}
            <Pressable 
                onPress={() => setShowInfo(false)} 
                style={styles.modalBtnFull}
            >
              <Text style={{color:'#fff', fontWeight:'bold'}}>Mengerti</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  
  headerBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    backgroundColor: "#A51C24",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingTop: Platform.OS === 'android' ? 40 : 50, 
    paddingHorizontal: 24,
    zIndex: 100, 
    elevation: 4,
  },
  
  headerRow: { 
      marginTop: 0,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center'
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#fff", marginBottom: 2 },
  headerSubtitle: { fontSize: 12, color: "#BFDBFE", fontWeight: "600" },
  infoBtn: { padding: 4 },

  scrollContent: { 
    paddingTop: HEADER_HEIGHT + 15, 
    paddingHorizontal: 20, 
    paddingBottom: 20,
    zIndex: 1,
  },

  mainCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 20,
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3, 
    marginBottom: 24,
  },
  
  profileRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  profileInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarImg: { width: 50, height: 50, borderRadius: 25 },
  avatarText: { fontSize: 22, fontWeight: "bold", color: "#fff" },
  
  nameText: { fontSize: 16, fontWeight: "bold", color: "#1E293B" },
  roleText: { fontSize: 13, color: "#64748B", marginTop: 2 },

  gradeBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
  },
  gradeLabel: { fontSize: 20, fontWeight: "900" },

  divider: { height: 1, backgroundColor: "#F1F5F9", marginVertical: 16 },

  statusText: { fontSize: 14, fontWeight: "700", marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  
  progressTrack: {
    height: 10,
    backgroundColor: "#E2E8F0",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressBar: { height: "100%", borderRadius: 5 },
  progressStats: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  statSmall: { fontSize: 11, color: "#64748B" },

  statsGrid: {
    flexDirection: "row",
    marginTop: 20,
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: "#F1F5F9"
  },
  statBox: { flex: 1, alignItems: 'center' },
  verticalLine: { width: 1, backgroundColor: "#E2E8F0", height: '70%', alignSelf: 'center' },
  statLabel: { fontSize: 11, color: "#64748B", marginBottom: 4, textTransform: 'uppercase', fontWeight: '600' },
  statValue: { fontSize: 15, fontWeight: "800", color: "#1E293B" },

  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#334155", marginBottom: 12, marginLeft: 4 },

  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    elevation: 1,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    backgroundColor: "#ECFDF5",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  historyNote: { fontSize: 14, fontWeight: "600", color: "#334155" },
  historyDate: { fontSize: 11, color: "#94A3B8", marginTop: 2 },
  historyAmount: { fontSize: 14, fontWeight: "700", color: "#10B981" },

  emptyState: { alignItems: "center", marginTop: 40 },
  emptyText: { color: "#94A3B8", marginTop: 8, fontSize: 14 },

  // MODAL STYLES
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalBox: { backgroundColor: "#fff", borderRadius: 12, width: "100%", maxWidth: 400, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  modalTitle: { fontWeight: "800", fontSize: 18, marginBottom: 8, color: "#111827" },
  modalBtnFull: { 
    backgroundColor: '#A51C24', 
      width: '100%', 
      alignItems: 'center', 
      paddingVertical: 12, 
      borderRadius: 8 
  },
  infoItem: { marginBottom: 10, color: "#374151", lineHeight: 20, fontSize: 14 },
});