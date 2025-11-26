// app/user/Home.tsx
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  ComponentProps,
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
  ViewToken,
  Modal,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Calendar } from "react-native-calendars";
import BottomNavbar from "../../_components/BottomNavbar";
import { API_BASE } from "../../config";
import ConfettiCannon from "react-native-confetti-cannon";

const { width } = Dimensions.get("window");
type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const BANNER_SRC = require("../../../assets/images/banner.png");
const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);

// helper URL API
const apiUrl = (p: string) =>
  (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

// Helper tanggal buat badge logic
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

// tipe minimal user detail
type UserDetail = {
  id?: number | string;
  username?: string;
  nama_lengkap?: string;
  tanggal_lahir?: string;
  tanggal_masuk?: string | null;
  created_at?: string | null;
};

// ====== Notif izin (shared) ======
type IzinStatus = "pending" | "disetujui" | "ditolak";

const IZIN_SEEN_KEY = "izin_seen_status"; 

async function getSeenMap(): Promise<Record<string, IzinStatus>> {
  try {
    const s = await AsyncStorage.getItem(IZIN_SEEN_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

async function setSeenMap(map: Record<string, IzinStatus>) {
  try {
    await AsyncStorage.setItem(IZIN_SEEN_KEY, JSON.stringify(map));
  } catch {}
}

function normStatus(s: any): IzinStatus {
  const t = String(s ?? "pending").trim().toLowerCase();
  if (["disetujui","approve","approved","acc","accepted","setuju","ok"].includes(t)) return "disetujui";
  if (["ditolak","reject","rejected","tolak","no","denied"].includes(t)) return "ditolak";
  return "pending";
}

// cek masa kerja minimal 2 tahun
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

  const [isCalendarVisible, setCalendarVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // POPUP ULTAH GLOBAL
  const [birthdayVisible, setBirthdayVisible] = useState(false);
  const [birthdayNames, setBirthdayNames] = useState<string[]>([]);

  // boleh akses menu Izin kalau masa kerja >= 2 tahun
  const [canAccessIzin, setCanAccessIzin] = useState(false);
  const IZIN_LIST_URL = apiUrl("izin/izin_list.php");

  // === STATE BARU BUAT BADGE EVENT (Request + Kerapihan) ===
  const [requestBadge, setRequestBadge] = useState(0);
  const [kerTotal, setKerTotal] = useState(0);
  const [kerClaimedToday, setKerClaimedToday] = useState(false);

  // 🔔 Cek badge izin (Logic lama)
  const checkIzinBadge = useCallback(
    async (uid: number) => {
      try {
        const url = `${IZIN_LIST_URL}?user_id=${encodeURIComponent(String(uid))}`;
        const res = await fetch(url);
        const text = await res.text();
        let j: any = null;
        try { j = JSON.parse(text); } catch { setHasIzinNotif(false); return; }

        const raw: any[] = j.rows ?? j.data ?? j.list ?? [];
        const seen = await getSeenMap();
        const finals = raw
          .map((r) => ({ id: Number(r.id), status: normStatus(r.status) }))
          .filter((r) => r.status === "disetujui" || r.status === "ditolak");
        const unseen = finals.filter((it) => seen[String(it.id)] !== it.status);
        setHasIzinNotif(unseen.length > 0);
      } catch (e) {
        setHasIzinNotif(false);
      }
    },
    [IZIN_LIST_URL]
  );

  // 🔔 Cek Badge EVENT (Logic Baru: Request + Kerapihan)
  const refreshEventBadge = useCallback(async () => {
    if (!userId) return;
    const BASE = String(API_BASE).replace(/\/+$/, "") + "/";
    try {
      // 1. Cek Request Pending
      const r1 = await fetch(`${BASE}event/points.php?action=requests&user_id=${userId}&status=open`);
      const t1 = await r1.text();
      let j1: any; try { j1 = JSON.parse(t1); } catch {}
      if (j1?.success && Array.isArray(j1?.data)) {
        setRequestBadge(j1.data.length);
      } else {
        setRequestBadge(0);
      }

      // 2. Cek Kerapihan (Ada poin tapi belum klaim?)
      const r2 = await fetch(`${BASE}event/kerapihan.php?action=user_status&user_id=${userId}&date=${todayISO()}`);
      const t2 = await r2.text();
      let j2: any; try { j2 = JSON.parse(t2); } catch {}
      
      const localKerKey = `ev:ker:${userId}:${todayISO()}`;
      const localClaimed = (await AsyncStorage.getItem(localKerKey)) === "1";

      if (j2?.success) {
        let tpoints = 0;
        if (Array.isArray(j2.data?.items)) {
           j2.data.items.forEach((it: any) => { tpoints += Number(it.point_value || 0); });
        }
        setKerTotal(tpoints);
        setKerClaimedToday(!!j2.data?.claimed_today || localClaimed);
      }
    } catch (e) {
      console.log("Badge fetch error:", e);
    }
  }, [userId]);

  // 🎂 CEK SIAPA YANG ULTAH HARI INI (GLOBAL) - CUKUP SEKALI SEHARI
  const checkBirthdayToday = useCallback(async () => {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      const lastShown = await AsyncStorage.getItem("last_birthday_popup_date");

      if (lastShown === todayStr) {
        return; 
      }

      const res = await fetch(apiUrl("auth/birthday_today.php"));
      const j = await res.json();
      
      if (j?.success && j?.has_birthday && Array.isArray(j?.names) && j.names.length > 0) {
        setBirthdayNames(j.names);
        setBirthdayVisible(true);
        await AsyncStorage.setItem("last_birthday_popup_date", todayStr);
      } else {
        setBirthdayNames([]);
        setBirthdayVisible(false);
      }
    } catch (e) {
      console.log("Gagal cek ulang tahun:", e);
    }
  }, []);

  // Ambil data user + Cek Ultah
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const user = JSON.parse(authData);
          
          // Default: Ambil nama dari session dulu
          const rawName = user.nama_lengkap || user.name || user.username || "Pengguna";
          setUserName(rawName);

          const id = Number(user.id ?? user.user_id ?? 0);
          if (id > 0) {
            setUserId(id);
            try {
              const res = await fetch(apiUrl(`auth/get_user.php?id=${id}`));
              const j = await res.json();
              if (j?.success && j?.data) {
                const d = j.data as UserDetail;
                setUserDetail(d);
                
                // Update dengan data terbaru dari DB (Prioritas Nama Lengkap)
                if (d.nama_lengkap) {
                    setUserName(d.nama_lengkap);
                } else if (d.username) {
                    setUserName(d.username); 
                }

                // Logic Masa Kerja 2 Tahun
                const joinDate = d.tanggal_masuk || d.created_at || null;
                setCanAccessIzin(hasAtLeastTwoYears(joinDate));

                await checkIzinBadge(id);
              }
            } catch (e) {
              console.log("Gagal fetch detail user:", e);
            }
          }
        }
      } catch (e) {
        console.log("Gagal ambil data user:", e);
      }
    };

    fetchUser();
    checkBirthdayToday();

  }, [checkIzinBadge, checkBirthdayToday]);

  // REFRESH BADGE SAAT LAYAR DIFOKUSKAN
  useFocusEffect(
    useCallback(() => {
      if (userId != null) {
          checkIzinBadge(userId);
          refreshEventBadge(); // <--- Refresh badge event juga
      }
    }, [userId, checkIzinBadge, refreshEventBadge])
  );

  // HITUNG FINAL BADGE (Logic Pinter)
  const finalBadge = useMemo(() => {
    let count = requestBadge;
    if (kerTotal > 0 && !kerClaimedToday) {
        count += 1;
    }
    return count;
  }, [requestBadge, kerTotal, kerClaimedToday]);

  const images: number[] = [
    require("../../../assets/images/1.png"),
    require("../../../assets/images/2.png"),
    require("../../../assets/images/3.png"),
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

  const onViewRef = useRef((info: { viewableItems: ViewToken[] }) => {
    if (info.viewableItems.length > 0) {
      const idx = info.viewableItems[0].index ?? 0;
      setCurrentIndex(idx);
    }
  });
  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 });

  // === FIX: TAMPILKAN NAMA LENGKAP DI HEADER (TANPA SPLIT) ===
  const displayName = userDetail?.nama_lengkap || userName || "User";

  // Handle klik Izin (Cek 2 tahun)
  const handleOpenIzin = () => {
    if (!canAccessIzin) {
      Alert.alert(
        "Belum Bisa Mengajukan Izin",
        "Fitur izin hanya dapat digunakan jika masa kerja Anda minimal 2 tahun."
      );
      return;
    }
    setHasIzinNotif(false); // hilangkan badge
    router.push("/src/staff/Izin" as never);
  };

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor="#2196F3" barStyle="light-content" />

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: 88 }}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            {/* Menampilkan Nama Lengkap Full */}
            <Text style={styles.greeting} numberOfLines={1} ellipsizeMode="tail">
              Halo, {displayName}
            </Text>
            <Text style={styles.role}>Karyawan</Text>
          </View>
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
              onPress={() => router.push("/src/staff/Absen" as never)}
              icon="fingerprint"
              label="Absen"
              color="#1976D2"
            />
            <MenuItem
              onPress={() => router.push("/src/staff/Lembur" as never)}
              icon="clock-outline"
              label="Lembur"
              color="#1976D2"
            />
            <MenuItem
              onPress={handleOpenIzin}
              icon="file-document-edit-outline"
              label="Izin"
              color={canAccessIzin ? "#1976D2" : "#9CA3AF"}
              badge={canAccessIzin && hasIzinNotif}
            />
            <MenuItem
              onPress={() => router.push("/src/staff/Angsuran" as never)}
              icon="bank-outline"
              label="Angsuran"
              color="#1976D2"
            />
            <MenuItem
              icon="calendar-month-outline"
              label="Kalender"
              color="#1976D2"
              onPress={() => setCalendarVisible(true)}
            />
            <MenuItem
              onPress={() => router.push("/src/staff/Gaji" as never)}
              icon="cash-multiple"
              label="Slip Gaji"
              color="#1976D2"
            />
          </View>
        </View>

        {/* SLIDER BAWAH */}
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
            keyExtractor={(_, i) => String(i)}
            onViewableItemsChanged={onViewRef.current}
            viewabilityConfig={viewConfigRef.current}
            renderItem={({ item }) => {
              const meta = Image.resolveAssetSource(item);
              const ar = (meta?.width ?? 16) / (meta?.height ?? 9);
              return (
                <View style={styles.sliderImageWrapper}>
                  <Image
                    source={item}
                    style={[styles.sliderImage, { aspectRatio: ar }]}
                    resizeMode="contain"
                  />
                </View>
              );
            }}
          />
          <View style={styles.dotContainer}>
            {images.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, currentIndex === i && styles.activeDot]}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomNavbar 
            preset="user" 
            active="left" 
            config={{
                // Logic badge pinter (muncul di navbar home juga!)
                center: { badge: finalBadge > 0 ? finalBadge : undefined }
            }}
        />

      {/* MODAL KALENDER */}
      <Modal visible={isCalendarVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Kalender</Text>
            <Calendar
              onDayPress={(day) => {
                setSelectedDate(day.dateString);
                alert(`Tanggal dipilih: ${day.dateString}`);
                setCalendarVisible(false);
              }}
              markedDates={
                selectedDate
                  ? {
                      [selectedDate]: {
                        selected: true,
                        selectedColor: "#2196F3",
                      },
                    }
                  : {}
              }
              theme={{
                selectedDayBackgroundColor: "#2196F3",
                todayTextColor: "#1976D2",
                arrowColor: "#1976D2",
              }}
            />
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setCalendarVisible(false)}
            >
              <Text style={styles.closeText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* POPUP ULANG TAHUN + CONFETTI */}
      <Modal
        visible={birthdayVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.birthdayOverlay}>
          <View pointerEvents="none" style={styles.confettiWrapper}>
            <ConfettiCannon
              count={120}
              origin={{ x: width / 2, y: 0 }}
              fadeOut
              fallSpeed={2500}
            />
          </View>

          <View style={styles.birthdayPopup}>
            <Text style={styles.birthdayBigEmoji}>🎉🎂🎁</Text>
            <Text style={styles.birthdayPopupTitle}>
              Happy Birthday!
            </Text>
            
            <Text style={styles.birthdaySubText}>
              Hari ini ada yang ulang tahun nih:
            </Text>

            <View style={{marginVertical: 12, alignItems: 'center'}}>
                {birthdayNames.map((name, index) => (
                    <Text key={index} style={styles.birthdayName}>
                        ✨ {name} ✨
                    </Text>
                ))}
            </View>

            <Text style={styles.birthdayPopupText}>
              Semoga panjang umur, sehat selalu, dan semakin sukses dalam
              karier di PT Pordjo Steelindo Perkasa. 🥳
            </Text>

            <TouchableOpacity
              style={styles.birthdayCloseBtn}
              onPress={() => setBirthdayVisible(false)}
            >
              <Text style={styles.birthdayCloseText}>Ucapkan Selamat 🎂</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ===== Komponen Menu ===== */
type MenuItemProps = {
  icon: MCIName;
  label: string;
  color: string;
  onPress?: () => void;
  badge?: boolean;
};

const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  label,
  color,
  onPress,
  badge,
}) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress}>
    {/* Badge di pojok kanan atas kartu */}
    {badge && (
      <View style={styles.badgeDot}>
        <Text style={styles.badgeDotText}>!</Text>
      </View>
    )}
    <MaterialCommunityIcons name={icon} size={32} color={color} />
    <Text style={styles.menuLabel}>{label}</Text>
  </TouchableOpacity>
);

/* ===== Styles ===== */
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

  // MENU
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
    position: "relative", 
  },
  menuLabel: { marginTop: 8, color: "#0D47A1", fontWeight: "600" },

  badgeDot: {
    position: "absolute",
    top: 6,
    right: 8,
    backgroundColor: "#EF4444",
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  badgeDotText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  },

  // SLIDER
  sliderTitleContainer: {
    marginTop: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sliderTitle: { fontSize: 18, fontWeight: "700", color: "#0D47A1" },
  sliderContainer: { marginTop: 4, paddingVertical: 4 },
  sliderImageWrapper: { width, alignItems: "center" },
  sliderImage: {
    width: width - 24,
    height: undefined,
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  dotContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#90CAF9",
    marginHorizontal: 4,
  },
  activeDot: { backgroundColor: "#1976D2" },

  // Modal kalender
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0D47A1",
    marginBottom: 8,
    textAlign: "center",
  },
  closeButton: {
    backgroundColor: "#2196F3",
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  closeText: { color: "#fff", textAlign: "center", fontWeight: "600" },

  // Popup ulang tahun
  birthdayOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  confettiWrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  birthdayPopup: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFF7ED",
    borderRadius: 18,
    paddingVertical: 24,
    paddingHorizontal: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FDBA74",
    elevation: 8,
  },
  birthdayBigEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  birthdayPopupTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#EA580C",
    textAlign: "center",
    marginBottom: 4,
  },
  birthdaySubText: {
    fontSize: 14,
    color: "#9A3412",
    textAlign: "center",
    marginBottom: 4,
  },
  birthdayName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#C2410C",
    textAlign: "center",
    marginVertical: 2,
  },
  birthdayPopupText: {
    fontSize: 14,
    color: "#7C2D12",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 20,
  },
  birthdayCloseBtn: {
    marginTop: 18,
    backgroundColor: "#F97316",
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  birthdayCloseText: {
    color: "#fff",
    fontWeight: "700",
  },
});