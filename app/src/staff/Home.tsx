import React, { useEffect, useRef, useState, ComponentProps } from "react";
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
import { Calendar } from "react-native-calendars";
import BottomNavbar from "../../_components/BottomNavbar";
import { API_BASE } from "../../config";
import ConfettiCannon from "react-native-confetti-cannon"; // 🎉 efek petasan

const { width } = Dimensions.get("window");
type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const BANNER_SRC = require("../../../assets/images/banner.png");
const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);

// helper URL API
const apiUrl = (p: string) =>
  (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

// tipe minimal user detail
type UserDetail = {
  id?: number | string;
  nama_lengkap?: string;
  tanggal_lahir?: string;
  tanggal_masuk?: string | null;
  created_at?: string | null;
};

// cek apakah hari ini ulang tahun
function isTodayBirthday(tanggal_lahir?: string | null) {
  if (!tanggal_lahir) return false;
  const raw = String(tanggal_lahir).trim();
  if (!raw || raw === "-" || raw.toLowerCase() === "null") return false;

  // support "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM:SS"
  const datePart = raw.split(" ")[0];
  const parts = datePart.split("-");
  if (parts.length < 3) return false;

  const [, mStr, dStr] = parts; // [year, month, day]
  const birthMonth = Number(mStr);
  const birthDay = Number(dStr);
  if (!birthMonth || !birthDay) return false;

  const now = new Date();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();

  return todayMonth === birthMonth && todayDay === birthDay;
}

// cek apakah masa kerja minimal 1 tahun
function hasAtLeastOneYear(startDate?: string | null) {
  if (!startDate) return false;

  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();

  let years = now.getFullYear() - d.getFullYear();
  let months = now.getMonth() - d.getMonth();
  let days = now.getDate() - d.getDate();

  if (days < 0) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return years >= 1;
}

export default function HomeScreen() {
  const [userName, setUserName] = useState<string>("Pengguna");
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);

  const [isCalendarVisible, setCalendarVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // popup ultah
  const [birthdayVisible, setBirthdayVisible] = useState(false);

  // boleh akses menu Izin kalau masa kerja >= 1 tahun
  const [canAccessIzin, setCanAccessIzin] = useState(false);

  // 🔹 Ambil data user dari AsyncStorage + detail dari API
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const user = JSON.parse(authData);
          const rawName = user.name || user.username || "Pengguna";
          setUserName(rawName);

          const idRaw = user.id ?? user.user_id;
          const id = idRaw ? Number(idRaw) : 0;
          if (id > 0) {
            try {
              const res = await fetch(
                apiUrl(`auth/get_user.php?id=${encodeURIComponent(String(id))}`)
              );
              const j = await res.json();
              if ((j?.success ?? j?.status) && j?.data) {
                const d = j.data as UserDetail;
                setUserDetail(d);

                if (d.nama_lengkap) {
                  setUserName(d.nama_lengkap);
                }

                // hitung masa kerja dari tanggal_masuk (fallback ke created_at)
                const joinDate = d.tanggal_masuk || d.created_at || null;
                setCanAccessIzin(hasAtLeastOneYear(joinDate));

                // kalau hari ini ulang tahun → tampilkan popup
                if (isTodayBirthday(d.tanggal_lahir)) {
                  setBirthdayVisible(true);
                }
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
  }, []);

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

  const isBirthdayToday = isTodayBirthday(userDetail?.tanggal_lahir);
  const firstName = String(userDetail?.nama_lengkap || userName || "User")
    .trim()
    .split(" ")[0];

  // handler untuk buka menu Izin dengan pengecekan masa kerja
  const handleOpenIzin = () => {
    if (!canAccessIzin) {
      Alert.alert(
        "Belum Bisa Mengajukan Izin",
        "Fitur izin hanya dapat digunakan jika masa kerja Anda minimal 1 tahun."
      );
      return;
    }
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
          <View>
            <Text style={styles.greeting}>Halo, {firstName}</Text>
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
              color={canAccessIzin ? "#1976D2" : "#9CA3AF"} // opsional: abu-abu kalau belum 1 tahun
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

      <BottomNavbar preset="user" active="left" />

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
        visible={isBirthdayToday && birthdayVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.birthdayOverlay}>
          {/* Confetti "petasan" */}
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
              Selamat Ulang Tahun, {firstName}!
            </Text>
            <Text style={styles.birthdayPopupText}>
              Semoga panjang umur, sehat selalu, dan semakin sukses dalam
              karier di PT Pordjo Steelindo Perkasa. Terima kasih atas kerja
              keras dan kontribusimu! 💙
            </Text>

            <TouchableOpacity
              style={styles.birthdayCloseBtn}
              onPress={() => setBirthdayVisible(false)}
            >
              <Text style={styles.birthdayCloseText}>Terima kasih 🎂</Text>
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
};
const MenuItem: React.FC<MenuItemProps> = ({ icon, label, color, onPress }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress}>
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
  },
  menuLabel: { marginTop: 8, color: "#0D47A1", fontWeight: "600" },

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
    fontSize: 18,
    fontWeight: "800",
    color: "#7C2D12",
    textAlign: "center",
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
