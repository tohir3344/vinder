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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

const { width } = Dimensions.get("window");
type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const BANNER_SRC = require("../../../assets/images/banner.jpg");
const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);

export default function HomeScreen() {
  const [userName, setUserName] = useState<string>("Pengguna");

  // 🔹 Ambil data user dari AsyncStorage
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const user = JSON.parse(authData);
          setUserName(user.name || user.username || "Pengguna");
        }
      } catch (e) {
        console.log("Gagal ambil data user:", e);
      }
    };
    fetchUser();
  }, []);

  const images: number[] = [
    require("../../../assets/images/1.jpg"),
    require("../../../assets/images/2.jpg"),
    require("../../../assets/images/3.jpg"),
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
    }, 3000);
    return () => clearInterval(id);
  }, [images.length]);

  const onViewRef = useRef((info: { viewableItems: ViewToken[] }) => {
    if (info.viewableItems.length > 0) {
      const idx = info.viewableItems[0].index ?? 0;
      setCurrentIndex(idx);
    }
  });
  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 });

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
            <Text style={styles.greeting}>Halo, {userName}</Text>
            <Text style={styles.role}>Karyawan</Text>
          </View>
          {/* 🔹 Ganti icon dengan logo */}
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
              onPress={() => router.push("/src/staff/Izin" as never)}
              icon="file-document-edit-outline"
              label="Izin"
              color="#1976D2"
            />
            <MenuItem icon="cash-multiple" label="Slip Gaji" color="#1976D2" />
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

      {/* BOTTOM NAV */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push("/src/staff/Home" as never)}
        >
          <Ionicons name="home" size={26} color="#0D47A1" />
          <Text style={[styles.navLabel, { color: "#0D47A1" }]}>Beranda</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push("/src/staff/Profile" as never)}
        >
          <Ionicons name="person-outline" size={26} color="#0D47A1" />
          <Text style={[styles.navLabel, { color: "#0D47A1" }]}>Profil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ===== Komponen Menu ===== */
type MenuItemProps = { icon: MCIName; label: string; color: string; onPress?: () => void };
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

  menuContainer: { marginTop: 16, marginHorizontal: 16 },
  menuTitle: { fontSize: 16, fontWeight: "700", color: "#0D47A1", marginBottom: 10 },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
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

  sliderTitleContainer: { marginTop: 16, marginHorizontal: 16, marginBottom: 8 },
  sliderTitle: { fontSize: 18, fontWeight: "700", color: "#0D47A1" },
  sliderContainer: { marginTop: 4, paddingVertical: 4 },
  sliderImageWrapper: { width, alignItems: "center" },
  sliderImage: { width: width - 24, height: undefined, borderRadius: 12, backgroundColor: "#fff" },
  dotContainer: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#90CAF9", marginHorizontal: 4 },
  activeDot: { backgroundColor: "#1976D2" },

  bottomNav: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    backgroundColor: "#fff",
    paddingVertical: 8,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 10,
  },
  navItem: { alignItems: "center" },
  navLabel: { fontSize: 12, marginTop: 2 },
});