  // app/user/Home.tsx
  import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
  } from "react";
  import {
    View,
    Text,
    Image,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Dimensions,
    FlatList,
    StatusBar,
    Modal,
    Alert,
  } from "react-native";
  import AsyncStorage from "@react-native-async-storage/async-storage";
  import { MaterialCommunityIcons } from "@expo/vector-icons";
  import { router } from "expo-router";
  import { useFocusEffect } from "@react-navigation/native";
  import BottomNavbar from "../../_components/BottomNavbar";
  import { API_BASE } from "../../config";
  import ConfettiCannon from "react-native-confetti-cannon";

  const { width } = Dimensions.get("window");

  // WARNA TEMA
  const THEME_RED = "#A51C24";
  const LIGHT_RED_BG = "#FFF1F1";
  const DISABLED_GRAY = "#9CA3AF";

  const BANNER_SRC = require("../../../assets/images/banner.png");
  const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
  const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);

  const apiUrl = (p: string) =>
    (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

  const fmtIDR = (n: number) => (n ?? 0).toLocaleString("id-ID");

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  type UserDetail = {
    id?: number | string;
    username?: string;
    nama_lengkap?: string;
    tanggal_lahir?: string;
    tanggal_masuk?: string | null;
    created_at?: string | null;
  };

  const IZIN_SEEN_KEY = "izin_seen_status";
  const ANGSURAN_SEEN_KEY = "angsuran_seen_status";
  const GAJI_LAST_SEEN_ID_KEY = "gaji_last_seen_id";

  async function getSeenMap(key: string): Promise<Record<string, string>> {
    try {
      const s = await AsyncStorage.getItem(key);
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  }

  function normStatus(s: any): string {
    return String(s ?? "pending").trim().toLowerCase();
  }

  function hasAtLeastTwoYears(startDate?: string | null) {
    if (!startDate) return false;
    const d = new Date(startDate);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    let months = now.getMonth() - d.getMonth();
    let days = now.getDate() - d.getDate();
    if (days < 0) months -= 1;
    if (months < 0) { years -= 1; months += 12; }
    return years >= 2;
  }

  export default function HomeScreen() {
    const [userName, setUserName] = useState<string>("Pengguna");
    const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
    const [userId, setUserId] = useState<number | null>(null);
    const [hasIzinNotif, setHasIzinNotif] = useState(false);
    const [hasAngsuranNotif, setHasAngsuranNotif] = useState(false);

    // State Modal Gaji
    const [gajiModalVisible, setGajiModalVisible] = useState(false);
    const [newGajiData, setNewGajiData] = useState<any>(null);

    const [birthdayVisible, setBirthdayVisible] = useState(false);
    const [birthdayNames, setBirthdayNames] = useState<string[]>([]);
    const [canAccessIzin, setCanAccessIzin] = useState(false);

    // 🔥 STATE PENTING: ABSEN & LEMBUR
    const [isLemburOverActive, setIsLemburOverActive] = useState(false);
    const [hasClockedOut, setHasClockedOut] = useState(false);

    const IZIN_LIST_URL = apiUrl("izin/izin_list.php");
    const ANGSURAN_URL = apiUrl("angsuran/angsuran.php");
    const GAJI_ARCH_URL = apiUrl("gaji/gaji_archive.php");
    const ABSEN_CHECK_URL = apiUrl("absen/today.php");

    // // 1. CEK JAM
    // useEffect(() => {
    //   const checkTime = () => {
    //     const now = new Date();
    //     const hour = now.getHours();
        
    //     // --- KODE LAMA (DIBATASI JAM) ---
    //     // const isActive = hour >= 20 || hour < 8; 

    //     // --- KODE BARU (BISA AKSES KAPAN SAJA) ---
    //     const isActive = true; // Set ke true agar selalu aktif 24 jam

    //     setIsLemburOverActive(isActive);
    //   };
    //   checkTime();
    //   // Interval bisa dimatikan jika selalu true, tapi dibiarkan juga tidak apa-apa
    //   const interval = setInterval(checkTime, 60000);
    //   return () => clearInterval(interval);
    // }, []);

    // 1. CEK JAM
    useEffect(() => {
      const checkTime = () => {
        const now = new Date();
        const hour = now.getHours();
        // Lembur over aktif jika jam >= 20 ATAU jam < 8 pagi
        const isActive = hour >= 7 || hour < 20;
        setIsLemburOverActive(isActive);   
      };
      checkTime();
      const interval = setInterval(checkTime, 60000);
      return () => clearInterval(interval);
    }, []);

    // 2. CEK STATUS ABSEN KE DATABASE
    const checkAbsenStatus = useCallback(async (uid: number) => {
      try {
        const tgl = todayISO();
        const url = `${ABSEN_CHECK_URL}?user_id=${uid}&tanggal=${tgl}`;
        const res = await fetch(url);
        const json = await res.json();

        if (json && json.success && json.data) {
          const d = json.data;
          const jk = String(d.jam_keluar || "").trim();
          const isClockedOut =
            jk !== "" &&
            jk !== "00:00:00" &&
            jk !== "00:00" &&
            jk !== "null";

          setHasClockedOut(isClockedOut);
        } else {
          setHasClockedOut(false);
        }
      } catch (e) {
        console.log("Error cek absen:", e);
        setHasClockedOut(false);
      }
    }, [ABSEN_CHECK_URL]);

    // 3. LOGIKA TOMBOL KLIK (DENGAN POP-UP)
    const handleLemburOverClick = () => {
      // KONDISI 1: Sudah Absen Pulang
      if (hasClockedOut) {
        Alert.alert(
          "Akses Dibatasi",
          "Anda tidak bisa melanjutkan absen."
        );
        return;
      }

      // KONDISI 2: Belum Waktunya (Bukan jam 20:00 - 08:00)
      if (!isLemburOverActive) {
        Alert.alert(
          "Belum Waktunya",
          "Lembur lanjutan hanya dapat diakses mulai pukul 20:00 malam sampai 08:00 pagi."
        );
        return;
      }

      // KONDISI 3: Lolos (Boleh Masuk)
      Alert.alert(
        "Konfirmasi",
        "Apakah kamu akan melanjutkan lembur?",
        [
          { text: "Tidak", style: "cancel" },
          {
            text: "Ya",
            onPress: () => router.push("/src/staff/Lembur_over" as never)
          }
        ]
      );
    };

    const checkIzinBadge = useCallback(async (uid: number) => {
      try {
        const url = `${IZIN_LIST_URL}?user_id=${encodeURIComponent(String(uid))}`;
        const res = await fetch(url);
        const j = await res.json();
        const raw: any[] = j.rows ?? j.data ?? j.list ?? [];
        const seen = await getSeenMap(IZIN_SEEN_KEY);
        const finals = raw.filter((r) => {
          const st = normStatus(r.status);
          return st === 'disetujui' || st === 'ditolak';
        });
        const unseen = finals.filter((it) => seen[String(it.id)] !== normStatus(it.status));
        setHasIzinNotif(unseen.length > 0);
      } catch (e) { setHasIzinNotif(false); }
    }, [IZIN_LIST_URL]);

    const checkAngsuranBadge = useCallback(async (uid: number) => {
      try {
        const url = `${ANGSURAN_URL}?user_id=${encodeURIComponent(String(uid))}`;
        const res = await fetch(url);
        const j = await res.json();
        if (!Array.isArray(j)) { setHasAngsuranNotif(false); return; }
        const seen = await getSeenMap(ANGSURAN_SEEN_KEY);
        const relevantItems = j.filter((it: any) => {
          const st = normStatus(it.status);
          return st === 'disetujui' || st === 'ditolak';
        });
        const unseen = relevantItems.filter((it: any) => seen[String(it.id)] !== normStatus(it.status));
        setHasAngsuranNotif(unseen.length > 0);
      } catch (e) { setHasAngsuranNotif(false); }
    }, [ANGSURAN_URL]);

    const checkNewGaji = useCallback(async (uid: number) => {
      try {
        const now = new Date(), y = now.getFullYear();
        const url = `${GAJI_ARCH_URL}?user_id=${uid}&start=${y}-01-01&end=${y}-12-31&limit=1`;
        const res = await fetch(url);
        const json = await res.json();
        let latestSlip = null;
        if (json.success) {
          const data = Array.isArray(json.data) ? json.data : (json.data?.rows || []);
          if (data.length > 0) latestSlip = data[0];
        }
        if (latestSlip) {
          const lastSeenId = await AsyncStorage.getItem(GAJI_LAST_SEEN_ID_KEY);
          if (!lastSeenId || Number(latestSlip.id) > Number(lastSeenId)) {
            setNewGajiData(latestSlip);
            setGajiModalVisible(true);
          }
        }
      } catch (e) { console.log("Cek gaji error:", e); }
    }, [GAJI_ARCH_URL]);

    const markGajiAsSeen = async () => {
      if (newGajiData?.id) {
        await AsyncStorage.setItem(GAJI_LAST_SEEN_ID_KEY, String(newGajiData.id));
      }
      setGajiModalVisible(false);
    };

    const checkBirthdayToday = useCallback(async () => {
      try {
        const todayStr = todayISO();
        const lastShown = await AsyncStorage.getItem("last_birthday_popup_date");
        if (lastShown === todayStr) return;

        const res = await fetch(apiUrl("auth/birthday_today.php"));
        const j = await res.json();
        if (j?.success && j?.has_birthday && Array.isArray(j?.names) && j.names.length > 0) {
          setBirthdayNames(j.names);
          setTimeout(() => setBirthdayVisible(true), 1500);
          await AsyncStorage.setItem("last_birthday_popup_date", todayStr);
        }
      } catch (e) { console.log("Gagal cek ulang tahun:", e); }
    }, []);

    useEffect(() => {
      const fetchUser = async () => {
        try {
          const authData = await AsyncStorage.getItem("auth");
          if (authData) {
            const user = JSON.parse(authData);
            const id = Number(user.id ?? user.user_id ?? 0);
            if (id > 0) {
              setUserId(id);
              const res = await fetch(apiUrl(`auth/get_user.php?id=${id}`));
              const j = await res.json();
              if (j?.success && j?.data) {
                const d = j.data as UserDetail;
                setUserDetail(d);
                setUserName(d.nama_lengkap || d.username || "Pengguna");
                setCanAccessIzin(hasAtLeastTwoYears(d.tanggal_masuk || d.created_at || null));

                checkIzinBadge(id);
                checkAngsuranBadge(id);
                checkNewGaji(id);
                checkAbsenStatus(id);
              }
            }
          }
        } catch (e) { console.log("Gagal ambil data user:", e); }
      };
      fetchUser(); checkBirthdayToday();
    }, [checkIzinBadge, checkAngsuranBadge, checkBirthdayToday, checkNewGaji, checkAbsenStatus]);

    useFocusEffect(
      useCallback(() => {
        if (userId != null) {
          checkIzinBadge(userId);
          checkAngsuranBadge(userId);
          checkNewGaji(userId);
          checkBirthdayToday();
          checkAbsenStatus(userId);
        }
      }, [userId, checkIzinBadge, checkAngsuranBadge, checkNewGaji, checkBirthdayToday, checkAbsenStatus])
    );

    const images: number[] = [
      require("../../../assets/images/1.png"),
      require("../../../assets/images/2.png"),
    ];

    const [currentIndex, setCurrentIndex] = useState(0);
    const flatListRef = useRef<FlatList<number> | null>(null);

    useEffect(() => {
      const id = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = (prev + 1) % images.length;
          flatListRef.current?.scrollToIndex({ index: next, animated: true });
          return next;
        });
      }, 10000);
      return () => clearInterval(id);
    }, [images.length]);

    const displayName = userDetail?.nama_lengkap || userName || "User";

    return (
      <View style={styles.mainContainer}>
        <StatusBar backgroundColor={THEME_RED} barStyle="light-content" />

        <ScrollView style={styles.scrollContent} contentContainerStyle={{ paddingBottom: 130 }}>
          <View style={styles.header}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.greeting} numberOfLines={1}>Halo, {displayName}</Text>
              <Text style={styles.role}>Karyawan</Text>
            </View>
            <Image source={require("../../../assets/images/logo.png")} style={{ width: 100, height: 40 }} resizeMode="contain" />
          </View>

          <View style={styles.bannerCard}>
            <View style={styles.bannerInner}>
              <Image source={BANNER_SRC} style={styles.bannerImage} resizeMode="contain" />
            </View>
          </View>

          <View style={styles.menuContainer}>
            <Text style={styles.menuTitle}>Menu Utama</Text>
            <View style={styles.menuGrid}>
              <MenuItem onPress={() => router.push("/src/staff/Absen" as never)} icon="fingerprint" label="Absen" color={THEME_RED} />
              <MenuItem onPress={() => router.push("/src/staff/Lembur" as never)} icon="clock-outline" label="Lembur" color={THEME_RED} />

              {/* === MENU LEMBUR LANJUTAN (FIXED: Selalu Merah) === */}
              <MenuItem
                onPress={handleLemburOverClick}
                icon="clock-plus-outline"
                label="Lembur Lanjutan"
                color={THEME_RED}  // 🔥 Selalu merah
                disabled={false}   // 🔥 Selalu bisa diklik
              />

              <MenuItem
                onPress={() => !canAccessIzin ? Alert.alert("Akses Dibatasi", "Fitur izin tersedia setelah 2 tahun masa kerja.") : router.push("/src/staff/Izin" as never)}
                icon="file-document-edit-outline" label="Izin"
                color={canAccessIzin ? THEME_RED : "#9CA3AF"} badge={canAccessIzin && hasIzinNotif}
              />
              <MenuItem onPress={() => router.push("/src/staff/Angsuran" as never)} icon="bank-outline" label="Angsuran" color={THEME_RED} badge={hasAngsuranNotif} />
              <MenuItem onPress={() => router.push("/src/staff/Gaji" as never)} icon="cash-multiple" label="Slip Gaji" color={THEME_RED} />
            </View>
          </View>

          <View style={styles.sliderTitleContainer}>
            <Text style={styles.sliderTitle}>Perhatikan</Text>
          </View>

          <View style={styles.sliderContainer}>
            <FlatList
              ref={flatListRef}
              data={images}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <View style={styles.sliderImageWrapper}>
                  <Image source={item} style={[styles.sliderImage, { aspectRatio: 16 / 9 }]} resizeMode="contain" />
                </View>
              )}
            />
          </View>
        </ScrollView>

        <BottomNavbar preset="user" active="left" />

        <Modal visible={gajiModalVisible} transparent animationType="fade">
          <View style={styles.proModalOverlay}>
            <View style={styles.proModalContainer}>
              <View style={styles.proModalHeader}>
                <MaterialCommunityIcons name="wallet-giftcard" size={24} color="white" style={{ marginRight: 10 }} />
                <Text style={styles.proModalTitle}>Slip Gaji Tersedia</Text>
              </View>
              <View style={styles.proModalBody}>
                <Text style={styles.proBodyText}>Halo, Laporan gaji terbaru Anda telah diterbitkan.</Text>
                {newGajiData && (
                  <View style={styles.proInfoBox}>
                    <Text style={styles.proInfoLabel}>Periode:</Text>
                    <Text style={styles.proInfoValue}>{newGajiData.periode_start} s/d {newGajiData.periode_end}</Text>
                    <View style={styles.proDivider} />
                    <Text style={styles.proInfoAmount}>Rp {fmtIDR(Number(newGajiData.total_gaji_rp))}</Text>
                  </View>
                )}
              </View>
              <View style={styles.proModalFooter}>
                <TouchableOpacity style={styles.btnSecondary} onPress={markGajiAsSeen}>
                  <Text style={styles.btnSecondaryText}>Tutup</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={async () => {
                    await markGajiAsSeen();
                    router.push("/src/staff/Gaji" as never);
                  }}
                >
                  <Text style={styles.btnPrimaryText}>Rincian</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={birthdayVisible} transparent animationType="fade">
          <View style={styles.birthdayOverlay}>
            <View pointerEvents="none" style={styles.confettiWrapper}>
              <ConfettiCannon count={120} origin={{ x: width / 2, y: 0 }} fadeOut fallSpeed={2500} />
            </View>
            <View style={styles.birthdayPopup}>
              <Text style={styles.birthdayBigEmoji}>🎉🎂🎁</Text>
              <Text style={styles.birthdayPopupTitle}>Happy Birthday!</Text>
              <Text style={styles.birthdaySubText}>Hari ini ada yang ulang tahun nih:</Text>
              <View style={{ marginVertical: 12, alignItems: 'center' }}>
                {birthdayNames.map((name, index) => (
                  <Text key={index} style={styles.birthdayName}>✨ {name} ✨</Text>
                ))}
              </View>
              <TouchableOpacity style={styles.birthdayCloseBtn} onPress={() => setBirthdayVisible(false)}>
                <Text style={styles.birthdayCloseText}>Ucapkan Selamat 🎂</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // 🔥 COMPONENT MENU ITEM (Prop disabled dikembalikan ke default untuk MenuItem lain, tapi untuk Lembur Lanjutan dikirim false)
  const MenuItem = ({ icon, label, color, onPress, badge, disabled }: any) => (
    <TouchableOpacity
      style={[
        styles.menuItem,
        { opacity: disabled ? 0.6 : 1 } // Tetap ada logic opacity jika ada menu lain yg butuh
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {badge && <View style={styles.badgeDot}><Text style={styles.badgeDotText}>!</Text></View>}
      <MaterialCommunityIcons name={icon} size={32} color={color} />
      <Text style={[styles.menuLabel, { color: color === "#9CA3AF" ? "#9CA3AF" : THEME_RED }]}>{label}</Text>
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    mainContainer: { flex: 1, backgroundColor: "#F9FAFB" },
    scrollContent: { flex: 1 },
    header: {
      backgroundColor: THEME_RED,
      width: "100%",
      paddingTop: StatusBar.currentHeight || 40,
      paddingBottom: 16,
      paddingHorizontal: 20,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    greeting: { fontSize: 18, fontWeight: "700", color: "#fff" },
    role: { fontSize: 16, color: "#FEE2E2", fontWeight: "600" },
    bannerCard: { marginHorizontal: 12, marginTop: 10, borderRadius: 12, backgroundColor: THEME_RED, elevation: 3 },
    bannerInner: { borderRadius: 12, overflow: "hidden", paddingVertical: 8 },
    bannerImage: { width: "100%", height: undefined, aspectRatio: BANNER_AR },
    menuContainer: { marginTop: 16, marginHorizontal: 16 },
    menuTitle: { fontSize: 16, fontWeight: "700", color: THEME_RED, marginBottom: 10 },
    menuGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
    menuItem: { width: "47%", backgroundColor: "#fff", borderRadius: 16, paddingVertical: 20, alignItems: "center", marginBottom: 12, elevation: 2 },
    menuLabel: { marginTop: 8, fontWeight: "600" },
    badgeDot: { position: "absolute", top: 6, right: 8, backgroundColor: "#FFB300", borderRadius: 999, paddingHorizontal: 5, minWidth: 16, alignItems: "center", zIndex: 10 },
    badgeDotText: { color: "#000", fontSize: 10, fontWeight: "900" },
    sliderTitleContainer: { marginTop: 16, marginHorizontal: 16, marginBottom: 8 },
    sliderTitle: { fontSize: 18, fontWeight: "700", color: THEME_RED },
    sliderContainer: { marginTop: 4, paddingVertical: 4 },
    sliderImageWrapper: { width, alignItems: "center" },
    sliderImage: { width: width - 24, height: undefined, borderRadius: 12, backgroundColor: "#fff" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
    modalContent: { width: "90%", backgroundColor: "#fff", borderRadius: 12, padding: 16 },
    modalTitle: { fontSize: 18, fontWeight: "700", color: THEME_RED, marginBottom: 8, textAlign: "center" },
    closeButton: { backgroundColor: THEME_RED, paddingVertical: 10, borderRadius: 8, marginTop: 10 },
    closeText: { color: "#fff", textAlign: "center", fontWeight: "600" },
    proModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center" },
    proModalContainer: { width: "90%", backgroundColor: "#fff", borderRadius: 12, overflow: "hidden" },
    proModalHeader: { backgroundColor: THEME_RED, paddingVertical: 16, paddingHorizontal: 20, flexDirection: "row" },
    proModalTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
    proModalBody: { padding: 24 },
    proBodyText: { color: "#4B5563", fontSize: 15, marginBottom: 20 },
    proInfoBox: { backgroundColor: LIGHT_RED_BG, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: "#FCA5A5" },
    proInfoLabel: { fontSize: 12, color: THEME_RED, textAlign: 'center' },
    proInfoValue: { fontSize: 14, color: "#111827", fontWeight: "600", textAlign: 'center' },
    proDivider: { height: 1, backgroundColor: "#FCA5A5", marginVertical: 8 },
    proInfoAmount: { fontSize: 20, color: THEME_RED, fontWeight: "bold", textAlign: 'center' },
    proModalFooter: { flexDirection: "row", padding: 16, borderTopWidth: 1, borderTopColor: "#F3F4F6", justifyContent: "flex-end", gap: 12 },
    btnSecondary: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6, borderWidth: 1, borderColor: "#D1D5DB" },
    btnSecondaryText: { color: "#4B5563", fontWeight: "600" },
    btnPrimary: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6, backgroundColor: THEME_RED },
    btnPrimaryText: { color: "#fff", fontWeight: "600" },
    birthdayOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center" },
    confettiWrapper: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    birthdayPopup: { width: "85%", backgroundColor: "#FFF", borderRadius: 18, padding: 24, alignItems: "center", borderTopWidth: 6, borderTopColor: THEME_RED },
    birthdayBigEmoji: { fontSize: 40, marginBottom: 8, textAlign: 'center' },
    birthdayPopupTitle: { fontSize: 22, fontWeight: "900", color: THEME_RED },
    birthdaySubText: { fontSize: 14, color: "#7C2D12", textAlign: "center", marginBottom: 4 },
    birthdayName: { fontSize: 18, fontWeight: "800", color: THEME_RED, marginVertical: 2 },
    birthdayCloseBtn: { marginTop: 18, backgroundColor: THEME_RED, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999 },
    birthdayCloseText: { color: "#fff", fontWeight: "700" },
  });