// app/src/admin/Home.tsx
import React, { useEffect, useState, ComponentProps, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Calendar } from "react-native-calendars";
import { router, useFocusEffect } from "expo-router";
import BottomNavbar from "../../_components/BottomNavbar";
import { API_BASE } from "../../config";

type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

// Helper URL
const url = (p: string) =>
  (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

// --- CONSTANTS UNTUK PENYIMPANAN ID TERAKHIR ---
const LS_LAST_SEEN_WD_ID = "ev:admin:last_seen_wd_id";
const LS_LAST_SEEN_LEMBUR_OVER_ID = "ev:admin:last_seen_lembur_over_id"; // Baru

type ReqRow = { id: number; user_id: number; request_amount?: number; created_at?: string; status: string };

export default function HomeAdmin() {
  const [userName, setUserName] = useState<string>("Admin");
  const [showCalendar, setShowCalendar] = useState(false);

  // --- STATE WITHDRAW ---
  const [showWdModal, setShowWdModal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [latestPendingId, setLatestPendingId] = useState<number>(0);

  // --- STATE COUNTERS LAINNYA ---
  const [pendingIzin, setPendingIzin] = useState(0);
  const [pendingAngsuran, setPendingAngsuran] = useState(0);

  // --- STATE LEMBUR OVER (BARU) ---
  const [pendingLemburOver, setPendingLemburOver] = useState(0);
  const [showLemburOverModal, setShowLemburOverModal] = useState(false);
  const [latestLemburOverId, setLatestLemburOverId] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const u = JSON.parse(authData);
          setUserName(u?.name || u?.username || "Admin");
        }
      } catch (e) { /* silent */ }
    })();
  }, []);

  // 1. CEK PENDING WITHDRAW
  const checkPendingWithdraw = useCallback(async () => {
    try {
      const r = await fetch(url("event/points.php?action=requests&status=pending"));
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { return; }

      if (!j?.success || !Array.isArray(j?.data)) {
        setPendingCount(0);
        setLatestPendingId(0);
        return;
      }

      const rows: ReqRow[] = j.data;
      const cnt = rows.length;
      const maxId = rows.reduce((mx, it) => Math.max(mx, Number(it?.id || 0)), 0);

      setPendingCount(cnt);
      setLatestPendingId(maxId);

      const lastSeenRaw = await AsyncStorage.getItem(LS_LAST_SEEN_WD_ID);
      const lastSeen = Number(lastSeenRaw || 0);
      if (cnt > 0 && maxId > lastSeen) {
        setShowWdModal(true);
      }
    } catch {
      setPendingCount(0);
      setLatestPendingId(0);
    }
  }, []);

  // 2. CEK PENDING LEMBUR OVER (BARU)
  const checkPendingLemburOver = useCallback(async () => {
    try {
      const r = await fetch(url("lembur/list_lembur_over.php"));
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { return; }

      if (j?.success && Array.isArray(j?.data)) {
        // Filter status pending
        const pendingRows = j.data.filter((row: any) => row.status === 'pending');
        const count = pendingRows.length;

        // Cari ID tertinggi untuk notifikasi
        const maxId = pendingRows.reduce((mx: number, it: any) => Math.max(mx, Number(it?.id || 0)), 0);

        setPendingLemburOver(count);
        setLatestLemburOverId(maxId);

        // Cek Local Storage untuk pop-up notifikasi
        const lastSeenRaw = await AsyncStorage.getItem(LS_LAST_SEEN_LEMBUR_OVER_ID);
        const lastSeen = Number(lastSeenRaw || 0);

        if (count > 0 && maxId > lastSeen) {
          setShowLemburOverModal(true);
        }
      } else {
        setPendingLemburOver(0);
      }
    } catch (e) {
      console.log("Error check lembur over:", e);
      setPendingLemburOver(0);
    }
  }, []);

  // 3. CEK PENDING IZIN
  const checkPendingIzin = useCallback(async () => {
    try {
      const r = await fetch(url("izin/izin_list.php?limit=100"));
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { return; }
      if (j?.success && Array.isArray(j?.data)) {
        const count = j.data.filter((row: any) => row.status === 'pending').length;
        setPendingIzin(count);
      }
    } catch (e) { console.log(e); }
  }, []);

  // 4. CEK PENDING ANGSURAN
  const checkPendingAngsuran = useCallback(async () => {
    try {
      const r = await fetch(url("angsuran/angsuran.php"));
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { return; }
      if (Array.isArray(j)) {
        const count = j.filter((row: any) => row.status === 'pending').length;
        setPendingAngsuran(count);
      }
    } catch (e) { console.log(e); }
  }, []);

  // REFRESH SEMUA DATA
  const refreshAll = useCallback(() => {
    checkPendingWithdraw();
    checkPendingIzin();
    checkPendingAngsuran();
    checkPendingLemburOver(); // Tambahkan ini
  }, [checkPendingWithdraw, checkPendingIzin, checkPendingAngsuran, checkPendingLemburOver]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
      return () => { };
    }, [refreshAll])
  );

  // --- HANDLER MODAL WITHDRAW ---
  const markSeenAndCloseWd = useCallback(async () => {
    if (latestPendingId > 0) {
      await AsyncStorage.setItem(LS_LAST_SEEN_WD_ID, String(latestPendingId));
    }
    setShowWdModal(false);
  }, [latestPendingId]);

  const goToPenukaran = useCallback(async () => {
    if (latestPendingId > 0) {
      await AsyncStorage.setItem(LS_LAST_SEEN_WD_ID, String(latestPendingId));
    }
    setShowWdModal(false);
    router.push({ pathname: "/src/admin/Event", params: { tab: "penukaran" } } as never);
  }, [latestPendingId]);

  // --- HANDLER MODAL LEMBUR OVER (BARU) ---
  const markSeenAndCloseLemburOver = useCallback(async () => {
    if (latestLemburOverId > 0) {
      await AsyncStorage.setItem(LS_LAST_SEEN_LEMBUR_OVER_ID, String(latestLemburOverId));
    }
    setShowLemburOverModal(false);
  }, [latestLemburOverId]);

  const goToLemburOver = useCallback(async () => {
    if (latestLemburOverId > 0) {
      await AsyncStorage.setItem(LS_LAST_SEEN_LEMBUR_OVER_ID, String(latestLemburOverId));
    }
    setShowLemburOverModal(false);
    router.push("/src/admin/Lembur_over" as never);
  }, [latestLemburOverId]);

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor="#A51C24" barStyle="light-content" />

      <ScrollView style={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Halo, {userName}</Text>
            <Text style={styles.role}>Admin</Text>
          </View>
          <Image
            source={require("../../../assets/images/logo.png")}
            style={{ width: 100, height: 40 }}
            resizeMode="contain"
          />
        </View>

        {/* MENU UTAMA */}
        <View style={styles.menuContainer}>
          <Text style={styles.menuTitle}>Menu Utama</Text>
          <View style={styles.menuGrid}>
            <MenuItem
              onPress={() => router.push("/src/admin/Absensi" as never)}
              icon="fingerprint"
              label="Absen"
              color="#A51C24"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Lembur" as never)}
              icon="clock-outline"
              label="Lembur"
              color="#A51C24"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Lembur_over" as never)}
              icon="clock-plus-outline"
              label="Lembur Lanjutan"
              color="#A51C24"
              badge={pendingLemburOver} // ADDED BADGE HERE
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Izin" as never)}
              icon="file-document-edit-outline"
              label="Izin"
              color="#A51C24"
              badge={pendingIzin}
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Profile_user" as never)}
              icon="account-outline"
              label="Profil User"
              color="#A51C24"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Galeri" as never)}
              icon="image-multiple"
              label="Galeri"
              color="#A51C24"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Angsuran" as never)}
              icon="account-cash-outline"
              label="Angsuran"
              color="#A51C24"
              badge={pendingAngsuran}
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Gaji" as never)}
              icon="cash-multiple"
              label="Slip Gaji"
              color="#A51C24"
            />
          </View>
        </View>
      </ScrollView>

      {/* MODAL KALENDER */}
      <Modal visible={showCalendar} animationType="slide" transparent={true} onRequestClose={() => setShowCalendar(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Kalender</Text>
            <Calendar
              onDayPress={(day) => setShowCalendar(false)}
              theme={{
                todayTextColor: "#A51C24",
                arrowColor: "#A51C24",
              }}
              markingType="custom"
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowCalendar(false)}>
              <Text style={styles.closeText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL NOTIFIKASI WITHDRAW */}
      <Modal visible={showWdModal} animationType="fade" transparent onRequestClose={markSeenAndCloseWd}>
        <View style={styles.modalOverlay}>
          <View style={styles.wdCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialCommunityIcons name="bell-alert" size={24} color="#A51C24" />
              <Text style={styles.wdTitle}>Pengajuan Withdraw</Text>
            </View>
            <Text style={styles.wdDesc}>
              Ada <Text style={{ fontWeight: "900" }}>{pendingCount}</Text> pengajuan withdraw yang{" "}
              <Text style={{ fontWeight: "900" }}>menunggu persetujuan</Text>.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#f1f5f9" }]} onPress={markSeenAndCloseWd}>
                <Text style={[styles.btnTx, { color: "#475569" }]}>Nanti Saja</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#A51C24" }]} onPress={goToPenukaran}>
                <Text style={styles.btnTx}>Lihat Sekarang</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL NOTIFIKASI LEMBUR OVER (BARU) */}
      <Modal visible={showLemburOverModal} animationType="fade" transparent onRequestClose={markSeenAndCloseLemburOver}>
        <View style={styles.modalOverlay}>
          <View style={styles.wdCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialCommunityIcons name="clock-alert-outline" size={24} color="#A51C24" />
              <Text style={styles.wdTitle}>Lembur Lanjutan Baru</Text>
            </View>
            <Text style={styles.wdDesc}>
              Ada <Text style={{ fontWeight: "900" }}>{pendingLemburOver}</Text> pengajuan lembur lanjutan yang{" "}
              <Text style={{ fontWeight: "900" }}>menunggu persetujuan</Text>.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#f1f5f9" }]} onPress={markSeenAndCloseLemburOver}>
                <Text style={[styles.btnTx, { color: "#475569" }]}>Nanti Saja</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#A51C24" }]} onPress={goToLemburOver}>
                <Text style={styles.btnTx}>Lihat Sekarang</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNavbar preset="admin" active="left" config={{ center: { badge: pendingCount } }} />
    </View>
  );
}

type MenuItemProps = {
  icon: MCIName;
  label: string;
  color: string;
  onPress?: () => void;
  badge?: number;
};

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, color, onPress, badge }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress}>
    {badge && badge > 0 ? (
      <View style={styles.badgeContainer}>
        <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
      </View>
    ) : null}
    <MaterialCommunityIcons name={icon} size={32} color={color} />
    <Text style={styles.menuLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { flex: 1 },
  header: {
    backgroundColor: "#A51C24",
    width: "100%",
    paddingTop: StatusBar.currentHeight || 45,
    paddingBottom: 25,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  greeting: { fontSize: 18, fontWeight: "900", color: "#fff" },
  role: { fontSize: 14, color: "#fca5a5", fontWeight: "700" },
  menuContainer: { marginTop: 25, marginHorizontal: 20 },
  menuTitle: { fontSize: 16, fontWeight: "900", color: "#1e293b", marginBottom: 15 },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  menuItem: {
    width: "47%",
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 25,
    alignItems: "center",
    marginBottom: 15,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9'
  },
  menuLabel: { marginTop: 10, color: "#475569", fontWeight: "800", fontSize: 13 },
  badgeContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    zIndex: 10,
    elevation: 2
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.6)", justifyContent: "center", alignItems: "center" },
  modalContainer: { backgroundColor: "#fff", borderRadius: 24, padding: 20, width: "90%", elevation: 10 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: "#1e293b", marginBottom: 15, textAlign: "center" },
  closeButton: { backgroundColor: "#A51C24", paddingVertical: 12, borderRadius: 12, marginTop: 15 },
  closeText: { color: "#fff", textAlign: "center", fontWeight: "800" },
  wdCard: { width: "90%", backgroundColor: "#fff", borderRadius: 24, padding: 20, elevation: 20 },
  wdTitle: { fontWeight: "900", color: "#1e293b", fontSize: 18 },
  wdDesc: { color: "#64748b", marginTop: 8, lineHeight: 22 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  btnTx: { color: "#fff", fontWeight: "800" },
});