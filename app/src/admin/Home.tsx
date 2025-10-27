import React, { useEffect, useState, ComponentProps } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  // Dimensions,
  StatusBar,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const BANNER_SRC = require("../../../assets/images/banner.jpg");
const BANNER_META = Image.resolveAssetSource(BANNER_SRC);
const BANNER_AR = (BANNER_META?.width ?? 1200) / (BANNER_META?.height ?? 400);
// const { width } = Dimensions.get("window");

export default function HomeAdmin() {
  const [userName, setUserName] = useState<string>("Admin");

  // 🔹 Ambil data user dari AsyncStorage
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const authData = await AsyncStorage.getItem("auth");
        if (authData) {
          const user = JSON.parse(authData);
          setUserName(user.name || user.username || "Admin");
        }
      } catch (e) {
        console.log("Gagal ambil data user:", e);
      }
    };
    fetchUser();
  }, []);

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

          {/* 🔹 Logo */}
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
              onPress={() => router.push("/src/admin/SlipGaji" as never)}
              icon="cash-multiple"
              label="Slip Gaji"
              color="#1976D2"
            />

            {/* 🔹 Profil User */}
            <MenuItem
              onPress={() => router.push("/src/admin/Profile_user" as never)}
              icon="account-outline"
              label="Profil User"
              color="#1976D2"
            />

            {/* 🔹 Galeri */}
            <MenuItem
              onPress={() => router.push("/src/admin/Galeri" as never)}
              icon="image-multiple"
              label="Galeri"
              color="#1976D2"
            />
          </View>
        </View>
      </ScrollView>

      {/* BOTTOM NAV */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push("/src/admin/Home" as never)}
        >
          <Ionicons name="home" size={26} color="#0D47A1" />
          <Text style={[styles.navLabel, { color: "#0D47A1" }]}>Beranda</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push("/src/admin/Profile" as never)}
        >
          <Ionicons name="person-outline" size={26} color="#0D47A1" />
          <Text style={[styles.navLabel, { color: "#0D47A1" }]}>Profil</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Komponen MenuItem
type MenuItemProps = { icon: MCIName; label: string; color: string; onPress?: () => void };
const MenuItem: React.FC<MenuItemProps> = ({ icon, label, color, onPress }) => (
  <TouchableOpacity style={styles.menuItem} onPress={onPress}>
    <MaterialCommunityIcons name={icon} size={32} color={color} />
    <Text style={styles.menuLabel}>{label}</Text>
  </TouchableOpacity>
);

// Styles sama seperti sebelumnya
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
  bannerCard: { marginHorizontal: 12, marginTop: 10, borderRadius: 12, backgroundColor: "#488FCC", elevation: 6 },
  bannerInner: { borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", paddingVertical: 8 },
  bannerImage: { width: "100%", height: undefined, aspectRatio: BANNER_AR, backgroundColor: "#488FCC" },
  menuContainer: { marginTop: 16, marginHorizontal: 16 },
  menuTitle: { fontSize: 16, fontWeight: "700", color: "#0D47A1", marginBottom: 10 },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  menuItem: { width: "47%", backgroundColor: "#fff", borderRadius: 16, paddingVertical: 20, alignItems: "center", marginBottom: 12, elevation: 3 },
  menuLabel: { marginTop: 8, color: "#0D47A1", fontWeight: "600" },
  bottomNav: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: 1, borderTopColor: "#ddd", backgroundColor: "#fff", paddingVertical: 8, position: "absolute", bottom: 0, left: 0, right: 0, elevation: 10 },
  navItem: { alignItems: "center" },
  navLabel: { fontSize: 12, marginTop: 2 },
});