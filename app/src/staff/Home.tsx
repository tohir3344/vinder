import React, { useState, useRef, useEffect } from "react";
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
} from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type {
  ComponentProps,
  // types buat FlatList & viewability
} from "react";
import type {
  ViewToken,
  ViewabilityConfig,
  FlatList as FlatListType,
} from "react-native";

const { width } = Dimensions.get("window");

// union nama ikon yang valid
type MCIName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export default function HomeScreen() {
  const images: number[] = [
    require("../../../assets/images/1.jpg"),
    require("../../../assets/images/2.jpg"),
    require("../../../assets/images/3.jpg"),
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatListType<number> | null>(null);

  // Auto slide setiap 3 detik
  useEffect(() => {
    const i = setInterval(() => {
      const nextIndex = (currentIndex + 1) % images.length;
      setCurrentIndex(nextIndex);
      flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    }, 3000);
    return () => clearInterval(i);
  }, [currentIndex, images.length]);

  // ketik callback biar gak any
  const onViewRef = useRef(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      if (info.viewableItems.length > 0) {
        setCurrentIndex(info.viewableItems[0].index ?? 0);
      }
    }
  );

  const viewConfigRef = useRef<ViewabilityConfig>({
    viewAreaCoveragePercentThreshold: 50,
  });

  return (
    <View style={styles.mainContainer}>
      <StatusBar backgroundColor="#2196F3" barStyle="light-content" />

      <ScrollView style={styles.scrollContent}>
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Halo, Tohir</Text>
          <Text style={styles.role}>Karyawan</Text>
        </View>

        {/* BANNER */}
        <View style={styles.bannerContainer}>
          <Image
            source={require("../../../assets/images/3.jpg")}
            style={styles.bannerImage}
          />
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
            <MenuItem icon="clock-outline" label="Lembur" color="#1976D2" />
            <MenuItem icon="file-document-edit-outline" label="Izin" color="#1976D2" />
            <MenuItem icon="cash-multiple" label="Slip Gaji" color="#1976D2" />
          </View>
        </View>

        {/* SLIDER DI BAWAH MENU */}
        <View style={styles.sliderTitleContainer}>
          <Text style={styles.sliderTitle}>Peraturan</Text>
        </View>
        <View style={styles.sliderContainer}>
          <FlatList
            ref={flatListRef}
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(_, index) => index.toString()}
            onViewableItemsChanged={onViewRef.current}
            viewabilityConfig={viewConfigRef.current}
            renderItem={({ item }) => (
              <View style={styles.sliderImageWrapper}>
                <Image source={item} style={styles.sliderImage} />
              </View>
            )}
          />
          {/* DOT INDICATOR */}
          <View style={styles.dotContainer}>
            {images.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, currentIndex === index && styles.activeDot]}
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
          <Ionicons name="home" size={26} color="#757575" />
          <Text style={[styles.navLabel, { color: "#757575" }]}>Beranda</Text>
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

// Komponen MenuItem (sekarang nerima onPress & ketik proper)
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

// Styles
const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: "#F2F6FF",
  },
  scrollContent: {
    flex: 1,
  },
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
  greeting: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  role: {
    fontSize: 16,
    color: "#E3F2FD",
    fontWeight: "600",
  },
  bannerContainer: {
    marginHorizontal: 7,
    marginTop: 10,
    borderRadius: 10,
    overflow: "hidden",
    elevation: 6,
  },
  bannerImage: {
    width: "100%",
    height: 180,
    resizeMode: "cover",
  },
  menuContainer: {
    marginTop: 16,
    marginHorizontal: 16,
  },
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
  menuLabel: {
    marginTop: 8,
    color: "#0D47A1",
    fontWeight: "600",
  },
  sliderContainer: {
    height: 180,
    marginTop: 16,
    padding: 5,
  },
  sliderImageWrapper: {
    borderRadius: 15,
    overflow: "hidden",
    marginHorizontal: 5,
  },
  sliderImage: {
    width: width - 20,
    height: 180,
    resizeMode: "cover",
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
  activeDot: {
    backgroundColor: "#1976D2",
  },
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
  navItem: {
    alignItems: "center",
  },
  navLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  sliderTitleContainer: {
    marginTop: 16,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sliderTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0D47A1",
  },
});
