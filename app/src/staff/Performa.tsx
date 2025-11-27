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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

// --- KONFIGURASI ---
const TARGET_KOIN_TAHUNAN = 86400000;
// Tinggi Header Biru
const HEADER_HEIGHT = 150; 

// Helper Format Angka
const formatNumber = (num: number) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Helper Format Tanggal
const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
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

      const url = `${API_BASE}/performa/user_performa.php?user_id=${userId}&year=${year}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.success) {
        setTotalKoin(json.data.total_koin);
        setHistory(json.data.history);
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
  const percentage = Math.min((totalKoin / TARGET_KOIN_TAHUNAN) * 100, 100);
  let grade = "C";
  let gradeColor = "#EF4444"; // Merah
  let gradeBg = "#FEF2F2";
  let gradeText = "Perlu Ditingkatkan";

  if (percentage >= 85) {
    grade = "A";
    gradeColor = "#10B981"; // Hijau
    gradeBg = "#D1FAE5";
    gradeText = "Luar Biasa!";
  } else if (percentage >= 74) {
    grade = "B";
    gradeColor = "#F59E0B"; // Kuning
    gradeBg = "#FEF3C7";
    gradeText = "Kinerja Baik";
  }

  const sisa = Math.max(0, TARGET_KOIN_TAHUNAN - totalKoin);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2196F3" />
      
      {/* HEADER BACKGROUND (FIXED DI ATAS & LAYER PALING DEPAN) */}
      <View style={styles.headerBg}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Statistik Performa</Text>
            <Text style={styles.headerSubtitle}>Tahun {new Date().getFullYear()}</Text>
          </View>
      </View>

      {/* KONTEN SCROLL (JALAN DI BELAKANG HEADER) */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={HEADER_HEIGHT} />}
        showsVerticalScrollIndicator={false}
      >
        {/* CARD UTAMA */}
        <View style={styles.mainCard}>
            
            {/* PROFILE ROW */}
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

                {/* GRADE BADGE */}
                <View style={[styles.gradeBadge, { backgroundColor: gradeBg, borderColor: gradeColor }]}>
                    <Text style={[styles.gradeLabel, { color: gradeColor }]}>{grade}</Text>
                </View>
            </View>

            <View style={styles.divider} />

            {/* PROGRESS SECTION */}
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

            {/* STATS GRID */}
            <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Total Koin</Text>
                    <Text style={styles.statValue}>{formatNumber(totalKoin)}</Text>
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
                    <Text style={styles.historyAmount}>+{formatNumber(item.amount)}</Text>
                </View>
            ))
        )}
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  
  // 🔥 HEADER FIX DI ATAS (Z-INDEX TINGGI)
  headerBg: {
    position: 'absolute', // Diem di tempat
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    backgroundColor: "#2196F3",
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingTop: 50, // Buat status bar
    paddingHorizontal: 24,
    zIndex: 100, // Paling Depan (Nutupin ScrollView pas discroll ke atas)
    elevation: 5, // Bayangan di Android
  },
  
  headerContent: { marginTop: 10 },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: "#93C5FD", fontWeight: "600" },

  // 🔥 SCROLL CONTENT (PADDING TOP BIAR GAK KEPOTONG PAS AWAL)
  scrollContent: { 
    paddingTop: HEADER_HEIGHT + 20, // Turun ke bawah header + jarak dikit
    paddingHorizontal: 20, 
    paddingBottom: 20,
    zIndex: 1, // Di belakang header
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
});