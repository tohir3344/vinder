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

const BANNER_SRC = require("../../../assets/images/banner1.png");
const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);

// API helper
const url = (p: string) =>
  (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

// ===== key untuk menyimpan "terakhir dilihat" agar popup tidak spam
const LS_LAST_SEEN_WD_ID = "ev:admin:last_seen_wd_id";

type ReqRow = { id: number; user_id: number; request_amount?: number; created_at?: string; status: string };

export default function HomeAdmin() {
  const [userName, setUserName] = useState<string>("Admin");
  const [showCalendar, setShowCalendar] = useState(false);

  // ====== Notifikasi WD
  const [showWdModal, setShowWdModal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [latestPendingId, setLatestPendingId] = useState<number>(0);

  const formatIDR = (n: number) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

  // ambil user
  useEffect(() => {
    (async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const u = JSON.parse(authData);
          setUserName(u?.name || u?.username || "Admin");
        }
      } catch (e) {
        // silent
      }
    })();
  }, []);

  // cek pending withdraw (dipanggil saat fokus & saat mount)
  const checkPendingWithdraw = useCallback(async () => {
    try {
      const r = await fetch(url("event/points.php?action=requests&status=pending"));
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { throw new Error(t); }

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

      // bandingkan dengan "terakhir dilihat"
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

  useEffect(() => { checkPendingWithdraw(); }, [checkPendingWithdraw]);

  useFocusEffect(
    useCallback(() => {
      checkPendingWithdraw();
      return () => {};
    }, [checkPendingWithdraw])
  );

  const markSeenAndClose = useCallback(async () => {
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

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor="#2196F3" barStyle="light-content" />

      <ScrollView style={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Halo, {userName}</Text>
            <Text style={styles.role}>Admin</Text>
          </View>

          {/* Logo */}
          <Image
            source={require("../../../assets/images/logo.png")}
            style={{ width: 100, height: 40 }}
            resizeMode="contain"
          />
        </View>

        {/* BANNER */}
        <View style={styles.bannerCard}>
          <View style={styles.bannerInner}>
            <Image
              source={BANNER_SRC}
              style={styles.bannerImage}
              resizeMode="contain"
            />
          </View>
        </View>

        {/* MENU UTAMA */}
        <View style={styles.menuContainer}>
          <Text style={styles.menuTitle}>Menu Utama</Text>
          <View style={styles.menuGrid}>
            <MenuItem
              onPress={() => router.push("/src/admin/Absensi" as never)}
              icon="fingerprint"
              label="Absen"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Lembur" as never)}
              icon="clock-outline"
              label="Lembur"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Izin" as never)}
              icon="file-document-edit-outline"
              label="Izin"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Profile_user" as never)}
              icon="account-outline"
              label="Profil User"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Galeri" as never)}
              icon="image-multiple"
              label="Galeri"
              color="#1976D2"
            />

            {/* Angsuran Karyawan */}
            <MenuItem
              onPress={() => router.push("/src/admin/Angsuran" as never)}
              icon="account-cash-outline"
              label="Angsuran Karyawan"
              color="#1976D2"
            />

            {/* Kalender (Popup) */}
            <MenuItem
              onPress={() => setShowCalendar(true)}
              icon="calendar-month"
              label="Kalender"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/admin/Gaji" as never)}
              icon="cash-multiple"
              label="Slip Gaji"
              color="#1976D2"
            />
          </View>
        </View>
      </ScrollView>

      {/* MODAL KALENDER */}
      <Modal
        visible={showCalendar}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCalendar(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Kalender</Text>
            <Calendar
              onDayPress={(day) => {
                console.log("Tanggal dipilih:", day.dateString);
                setShowCalendar(false);
              }}
              theme={{
                todayTextColor: "#2196F3",
                arrowColor: "#2196F3",
              }}
              markingType="custom"
            />

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowCalendar(false)}
            >
              <Text style={styles.closeText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL NOTIFIKASI WITHDRAW */}
      <Modal
        visible={showWdModal}
        animationType="fade"
        transparent
        onRequestClose={markSeenAndClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.wdCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MaterialCommunityIcons name="bell-alert" size={24} color="#0A84FF" />
              <Text style={styles.wdTitle}>Pengajuan Withdraw</Text>
            </View>
            <Text style={styles.wdDesc}>
              Ada <Text style={{ fontWeight: "900" }}>{pendingCount}</Text> pengajuan withdraw yang{" "}
              <Text style={{ fontWeight: "900" }}>menunggu persetujuan</Text>.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: "#E6ECF5" }]} onPress={markSeenAndClose}>
                <Text style={[styles.btnTx, { color: "#0B1A33" }]}>Nanti Saja</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: "#0A84FF" }]}
                onPress={goToPenukaran}
              >
                <Text style={styles.btnTx}>Lihat Sekarang</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BottomNavbar preset="admin" active="left" />
    </View>
  );
}

type MenuItemProps = {
  icon: MCIName;
  label: string;
  color: string;
  onPress?: () => void;
};

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, color, onPress }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress}>
    <MaterialCommunityIcons name={icon} size={32} color={color} />
    <Text style={styles.menuLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#F2F6FF" },
  scrollContent: { flex: 1 },
  header: {
    backgroundColor: "#2196F3",
    width: "100%",
    paddingTop: StatusBar.currentHeight || 40,
    paddingBottom: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greeting: { fontSize: 18, fontWeight: "700", color: "#fff" },
  role: { fontSize: 16, color: "#E3F2FD", fontWeight: "600" },
  bannerCard: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: "#488FCC",
    elevation: 6,
  },
  bannerInner: {
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  bannerImage: {
    width: "100%",
    height: undefined,
    aspectRatio: BANNER_AR,
    backgroundColor: "#488FCC",
  },
  menuContainer: { marginTop: 16, marginHorizontal: 16 },
  menuTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0D47A1",
    marginBottom: 10,
  },
  menuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  menuItem: {
    width: "47%",
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
    marginBottom: 12,
    elevation: 3,
  },
  menuLabel: { marginTop: 8, color: "#0D47A1", fontWeight: "600" },

  // Modal umum
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    width: "90%",
    elevation: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0D47A1",
    marginBottom: 10,
    textAlign: "center",
  },
  closeButton: {
    backgroundColor: "#2196F3",
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  closeText: {
    color: "#fff",
    textAlign: "center",
    fontWeight: "600",
  },

  // Notif WD
  wdCard: {
    width: "88%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    elevation: 8,
  },
  wdTitle: { fontWeight: "900", color: "#0B1A33", fontSize: 16 },
  wdDesc: { color: "#334155", marginTop: 4, lineHeight: 20 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  btnTx: { color: "#fff", fontWeight: "900" },
});
