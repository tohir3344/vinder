// app/_components/BottomNavbar.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TabKey = "left" | "center" | "right";
type PresetKey = "admin" | "user";

type ItemConfig = { 
  icon: React.ComponentProps<typeof Ionicons>["name"]; 
  label: string; 
  route: string; 
  badge?: number;
};

type Config = { 
  left?: Partial<ItemConfig>; 
  center?: Partial<ItemConfig>; 
  right?: Partial<ItemConfig>; 
};

type Props = { active: TabKey; preset?: PresetKey; config?: Config; };

const PRESETS: Record<PresetKey, { left: ItemConfig; center: ItemConfig; right: ItemConfig }> = {
  admin: {
    left:   { icon: "home",   label: "Beranda", route: "/src/admin/Home" },
    center: { icon: "trophy", label: "Event",   route: "/src/admin/Event" },
    right:  { icon: "person", label: "Profil",  route: "/src/admin/Profile" },
  },
  user: {
    left:   { icon: "home",   label: "Home",    route: "/src/staff/Home" },
    center: { icon: "trophy", label: "Event",   route: "/src/staff/Event" },
    right:  { icon: "person", label: "Akun",    route: "/src/staff/Profile" },
  },
};

const COLORS = { active: "#0D47A1", inactive: "#9BA4B5", bg: "#FFFFFF" };
const CIRCLE_SIZE = 60; // Ukuran lingkaran (sedikit dikecilin biar proporsional)
const BTN_WIDTH = 100;  // Lebar area tombol tengah (fixed biar center akurat)

export default function BottomNavbar({ active, preset = "admin", config }: Props) {
  const insets = useSafeAreaInsets();

  // Padding bawah dinamis (aman buat Android & iPhone poni)
  const extraPad = Platform.OS === 'android' ? 16 : 0; 
  const safeBottom = Math.max(insets.bottom, extraPad);

  const BAR_BASE = 64; 
  const barHeight = BAR_BASE + safeBottom;
  
  // Posisi vertikal tombol tengah (makin besar angkanya, makin naik ke atas)
  const fabBottom = 15 + safeBottom; 

  const base = PRESETS[preset];
  
  const merged = {
    left:   { ...base.left,   ...(config?.left   ?? {}) },
    center: { ...base.center, ...(config?.center ?? {}) },
    right:  { ...base.right,  ...(config?.right  ?? {}) },
  };

  const go = (path: string) => router.push(path as never);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      
      {/* BAR PUTIH DI BAWAH */}
      <View
        style={[
          styles.bottomNav,
          { 
              height: barHeight, 
              paddingBottom: safeBottom - 5 
          },
        ]}
      >
        <TouchableOpacity style={styles.navItem} onPress={() => go(merged.left.route)}>
          <Ionicons name={merged.left.icon} size={24} color={active === "left" ? COLORS.active : COLORS.inactive} />
          <Text style={[styles.navLabel, { color: active === "left" ? COLORS.active : COLORS.inactive }]}>
            {merged.left.label}
          </Text>
        </TouchableOpacity>

        {/* Gap di tengah buat tempat tombol bulat */}
        <View style={styles.centerGap} />

        <TouchableOpacity style={styles.navItem} onPress={() => go(merged.right.route)}>
          <Ionicons name={merged.right.icon} size={24} color={active === "right" ? COLORS.active : COLORS.inactive} />
          <Text style={[styles.navLabel, { color: active === "right" ? COLORS.active : COLORS.inactive }]}>
            {merged.right.label}
          </Text>
        </TouchableOpacity>
      </View>

      {/* TOMBOL BULAT TENGAH (Floating) */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => go(merged.center.route)}
        style={[
            styles.centerBtnGlobal, 
            { bottom: fabBottom }
        ]}
      >
        <View style={styles.centerBtnCircle}>
          <Ionicons name={merged.center.icon} size={28} color="#fff" />
          
          {/* Badge Merah */}
          {merged.center.badge && merged.center.badge > 0 ? (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>
                {merged.center.badge > 99 ? "99+" : merged.center.badge}
              </Text>
            </View>
          ) : null}

        </View>
        <Text style={[styles.centerLabel, { color: COLORS.active }]}>{merged.center.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 0,
    zIndex: 9999, elevation: 9999,
    backgroundColor: 'transparent'
  },
  bottomNav: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bg,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 30,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: "#000", shadowOpacity: 0.08, shadowOffset: { width: 0, height: -4 },
    shadowRadius: 10, elevation: 20,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 11, marginTop: 4, fontWeight: "600" },
  
  // Gap lebih lebar dikit biar tombol bulat gak nempel
  centerGap: { width: 70 }, 

  // 🔥 STYLE TENGAH DIPERBAIKI 🔥
  centerBtnGlobal: {
    position: "absolute", 
    left: "50%", // Mulai dari tengah layar
    width: BTN_WIDTH, // Lebar container harus FIX (100)
    marginLeft: -(BTN_WIDTH / 2), // Geser kiri setengah lebar (100/2 = -50)
    zIndex: 10000, 
    elevation: 25,
    alignItems: "center", 
    justifyContent: "flex-end", // Align item ke bawah container
    pointerEvents: "auto",
  },
  centerBtnCircle: {
    width: CIRCLE_SIZE, height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: COLORS.active,
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: COLORS.bg,
    shadowColor: "#000", shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6, elevation: 8,
    position: "relative", 
  },
  centerLabel: {
    marginTop: 4, fontSize: 12, fontWeight: "700", textAlign: "center", 
    width: "100%", // Text ngikutin lebar container (100)
    textShadowColor: 'rgba(255, 255, 255, 0.8)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 2
  },
  
  badgeContainer: {
    position: "absolute",
    top: -2, 
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#dc2626",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
});