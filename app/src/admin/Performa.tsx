import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  StatusBar,
  Alert,
  RefreshControl,
  Image,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { API_BASE } from "../../config";
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

const TARGET_KOIN_TAHUNAN = 86400000; 

interface EmployeePerformance {
  user_id: number;
  nama: string;
  total_koin: number;
  jabatan?: string;
  avatar?: string;
}

const formatNumber = (num: number) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// 🔥 Updated: Removed compact logic, now just uses standard formatting
const formatFullNumber = (num: number) => {
    return formatNumber(num);
};

const getApiUrl = (path: string) => {
    const baseUrl = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
    return `${baseUrl}${path.replace(/^\/+/, "")}`;
};

export default function AdminPerformaPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EmployeePerformance[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const url = getApiUrl(`performa/admin_performa.php?year=${selectedYear}`);
      const res = await fetch(url);
      const json = await res.json();

      if (json.success && Array.isArray(json.data)) {
        setData(json.data);
      } else {
        setData([]);
      }
    } catch (error) {
      console.error("❌ Error fetch performa:", error);
      Alert.alert("Error", "Gagal memuat data performa.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const calculateGrade = (points: number) => {
    const percentage = (points / TARGET_KOIN_TAHUNAN) * 100;
    if (percentage >= 75) return { grade: "A", color: "#10B981", bg: "#D1FAE5", label: "Kinerja Baik" };
    if (percentage >= 50) return { grade: "B", color: "#F59E0B", bg: "#FEF3C7", label: "Luar Biasa" };
    return { grade: "C", color: "#EF4444", bg: "#FEE2E2", label: "Perlu Ditingkatkan!" };
  };

  const generatePDF = async () => {
      if (data.length === 0) return Alert.alert("Info", "Tidak ada data untuk dicetak.");
      setPrinting(true);

      try {
          const rows = data.map((item, index) => {
              const { grade, label } = calculateGrade(item.total_koin);
              const pct = ((item.total_koin / TARGET_KOIN_TAHUNAN) * 100).toFixed(1);
              return `
                <tr>
                    <td style="text-align:center">${index + 1}</td>
                    <td><b>${item.nama}</b><br/><span style="font-size:10px;color:#666">${item.jabatan || '-'}</span></td>
                    <td style="text-align:right">${formatNumber(item.total_koin)}</td>
                    <td style="text-align:center">${pct}%</td>
                    <td style="text-align:center"><b>${grade}</b> (${label})</td>
                </tr>
              `;
          }).join('');

          const html = `
            <html>
              <head>
                <style>
                  body { font-family: 'Helvetica', sans-serif; padding: 20px; }
                  h1 { text-align: center; color: #1E3A8A; margin-bottom: 5px; }
                  h3 { text-align: center; color: #555; margin-top: 0; font-weight: normal; }
                  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                  th, td { border: 1px solid #ccc; padding: 8px; font-size: 12px; }
                  th { background-color: #f0f0f0; color: #333; }
                  .footer { margin-top: 30px; text-align: right; font-size: 10px; color: #888; }
                </style>
              </head>
              <body>
                <h1>Laporan Performa Karyawan</h1>
                <h3>Tahun Evaluasi: ${selectedYear}</h3>
                <table>
                  <thead>
                    <tr>
                      <th style="width: 40px;">Rank</th>
                      <th>Nama Karyawan</th>
                      <th>Total Koin</th>
                      <th>Pencapaian</th>
                      <th>Grade</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
                <div class="footer">Dicetak pada: ${new Date().toLocaleString('id-ID')}</div>
              </body>
            </html>
          `;

          const { uri } = await Print.printToFileAsync({ html });
          if (Platform.OS === 'ios') {
              await Sharing.shareAsync(uri);
          } else {
              await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
          }
      } catch (error) {
          Alert.alert("Error", "Gagal mencetak PDF");
      } finally {
          setPrinting(false);
      }
  };

  const filteredData = useMemo(() => {
    return data
      .filter((item) => item.nama.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => b.total_koin - a.total_koin); 
  }, [data, searchQuery]);

  const summary = useMemo(() => {
    return {
        A: data.filter(d => calculateGrade(d.total_koin).grade === 'A').length,
        B: data.filter(d => calculateGrade(d.total_koin).grade === 'B').length,
        C: data.filter(d => calculateGrade(d.total_koin).grade === 'C').length,
    }
  }, [data]);

  const renderItem = ({ item, index }: { item: EmployeePerformance; index: number }) => {
    const { grade, color, bg, label } = calculateGrade(item.total_koin);
    const percentage = Math.min((item.total_koin / TARGET_KOIN_TAHUNAN) * 100, 100);

    return (
      <View style={styles.card}>
        <View style={styles.rankBadge}>
            <Text style={styles.rankText}>#{index + 1}</Text>
        </View>
        <View style={styles.cardHeader}>
          <View style={styles.userInfo}>
            <View style={[styles.avatar, { backgroundColor: color }]}>
                {item.avatar ? (
                      <Image source={{ uri: item.avatar }} style={{ width: 48, height: 48, borderRadius: 24 }} />
                ) : (
                    <Text style={styles.avatarText}>
                        {item.nama ? item.nama.charAt(0).toUpperCase() : "?"}
                    </Text>
                )}
            </View>
            <View>
              <Text style={styles.userName}>{item.nama}</Text>
              <Text style={styles.userRole}>{item.jabatan || "Karyawan"}</Text>
            </View>
          </View>
          <View style={[styles.gradeBadge, { backgroundColor: bg, borderColor: color }]}>
            <Text style={[styles.gradeText, { color: color }]}>{grade}</Text>
          </View>
        </View>
        <View style={styles.progressContainer}>
          <View style={styles.statsRow}>
            <Text style={styles.statsLabel}>Pencapaian ({percentage.toFixed(1)}%)</Text>
            <Text style={[styles.statsValue, { color: color }]}>{label}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${percentage}%`, backgroundColor: color }]} />
          </View>
          <View style={styles.koinRow}>
            <Text style={styles.currentKoin}>
              {/* 🔥 Updated: Display full number */}
              {formatFullNumber(item.total_koin)} 
              <Text style={styles.koinUnit}> Koin</Text>
            </Text>
            {/* 🔥 Updated: Display full number for target as well */}
            <Text style={styles.targetKoin}>Target: {formatFullNumber(TARGET_KOIN_TAHUNAN)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1E3A8A" />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Performa Karyawan</Text>
          <Text style={styles.headerSubtitle}>Evaluasi Tahunan {selectedYear}</Text>
        </View>
        <TouchableOpacity style={styles.headerIcon} onPress={generatePDF} disabled={printing}>
           {printing ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="printer" size={24} color="#fff" />}
        </TouchableOpacity>
      </View>
      <View style={styles.filterSection}>
        <View style={styles.searchBox}>
            <Ionicons name="search" size={20} color="#9CA3AF" />
            <TextInput 
                style={styles.searchInput}
                placeholder="Cari nama karyawan..."
                value={searchQuery}
                onChangeText={setSearchQuery}
            />
        </View>
        <View style={styles.yearBadge}>
            <Text style={styles.yearText}>{selectedYear}</Text>
        </View>
      </View>
      <View style={styles.summaryContainer}>
         <View style={[styles.summaryCard, { backgroundColor: "#ECFDF5", borderColor: "#10B981" }]}>
            <Text style={[styles.summaryLabel, { color: "#065F46" }]}>Grade A</Text>
            <Text style={[styles.summaryCount, { color: "#059669" }]}>{summary.A}</Text>
         </View>
         <View style={[styles.summaryCard, { backgroundColor: "#FFFBEB", borderColor: "#F59E0B" }]}>
            <Text style={[styles.summaryLabel, { color: "#92400E" }]}>Grade B</Text>
            <Text style={[styles.summaryCount, { color: "#D97706" }]}>{summary.B}</Text>
         </View>
         <View style={[styles.summaryCard, { backgroundColor: "#FEF2F2", borderColor: "#EF4444" }]}>
            <Text style={[styles.summaryLabel, { color: "#991B1B" }]}>Grade C</Text>
            <Text style={[styles.summaryCount, { color: "#DC2626" }]}>{summary.C}</Text>
         </View>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#1E3A8A" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
            data={filteredData}
            keyExtractor={(item) => item.user_id.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
                <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="account-search-outline" size={60} color="#D1D5DB" />
                    <Text style={styles.emptyText}>Data tidak ditemukan</Text>
                </View>
            }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F3F4F6" },
  header: {
    backgroundColor: "#A51C24",
    paddingTop: 50,
    paddingBottom: 25,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  headerTitle: { fontSize: 24, fontWeight: "800", color: "#fff" },
  headerSubtitle: { fontSize: 14, color: "#BFDBFE", marginTop: 4 },
  headerIcon: { backgroundColor: '#A51C24', padding: 10, borderRadius: 12 },
  filterSection: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: -20,
    marginBottom: 10,
    gap: 10
  },
  searchBox: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: "#374151" },
  yearBadge: {
    backgroundColor: "#fff",
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 16,
    height: 44,
    elevation: 3,
  },
  yearText: { fontWeight: '800', color: "#1E3A8A" },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 10,
    justifyContent: 'space-between'
  },
  summaryCard: {
    width: '31%',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 1
  },
  summaryLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  summaryCount: { fontSize: 20, fontWeight: '800' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    position: 'relative',
    overflow: 'hidden'
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  userInfo: { flexDirection: "row", alignItems: "center", flex: 1 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  userName: { fontSize: 16, fontWeight: "700", color: "#1F2937" },
  userRole: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  gradeBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  gradeText: { fontSize: 18, fontWeight: "900" },
  progressContainer: { marginTop: 0 },
  statsRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  statsLabel: { fontSize: 12, color: "#6B7280" },
  statsValue: { fontSize: 12, fontWeight: "700" },
  track: { height: 8, backgroundColor: "#E5E7EB", borderRadius: 4, overflow: "hidden", marginBottom: 8 },
  bar: { height: "100%", borderRadius: 4 },
  koinRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  currentKoin: { fontSize: 16, fontWeight: "800", color: "#111827" },
  koinUnit: { fontSize: 12, fontWeight: "normal", color: "#6B7280" },
  targetKoin: { fontSize: 10, color: "#9CA3AF" },
  rankBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#F3F4F6',
    borderBottomRightRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  rankText: { fontSize: 10, fontWeight: 'bold', color: '#6B7280' },
  emptyState: { alignItems: "center", marginTop: 50, opacity: 0.5 },
  emptyText: { marginTop: 10, fontSize: 14, color: "#6B7280" },
});