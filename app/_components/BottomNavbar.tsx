// app/_components/BottomNavbar.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TabKey = "left" | "center" | "right";
type PresetKey = "admin" | "user";

// 1. Update tipe data: Tambahin badge (optional)
type ItemConfig = { 
  icon: React.ComponentProps<typeof Ionicons>["name"]; 
  label: string; 
  route: string; 
  badge?: number; // <--- INI BARU
};

// 2. Bikin config jadi Partial biar kita bisa kirim badge-nya doang
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
const CIRCLE = 64;

export default function BottomNavbar({ active, preset = "admin", config }: Props) {
  const insets = useSafeAreaInsets();
  const SCALE = 0.55, MIN = 8, MAX = 20, FALLBACK = 16;
  const rawInset = insets.bottom > 0 ? insets.bottom : (Platform.OS === "android" ? FALLBACK : 0);
  const bottomPad = Math.min(MAX, Math.max(MIN, rawInset * SCALE));

  const BAR_BASE = 72;
  const barHeight = BAR_BASE + bottomPad;
  const fabBottom = 16 + bottomPad; 

  const base = PRESETS[preset];
  
  // Logic merge tetap aman, sekarang support partial override
  const merged = {
    left:   { ...base.left,   ...(config?.left   ?? {}) },
    center: { ...base.center, ...(config?.center ?? {}) },
    right:  { ...base.right,  ...(config?.right  ?? {}) },
  };

  const go = (path: string) => router.push(path as never);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View
        style={[
          styles.bottomNav,
          { height: barHeight, paddingBottom: Math.max(10, bottomPad) },
        ]}
      >
        <TouchableOpacity style={styles.navItem} onPress={() => go(merged.left.route)}>
          <Ionicons name={merged.left.icon} size={24} color={active === "left" ? COLORS.active : COLORS.inactive} />
          <Text style={[styles.navLabel, { color: active === "left" ? COLORS.active : COLORS.inactive }]}>
            {merged.left.label}
          </Text>
        </TouchableOpacity>

        <View style={styles.centerGap} />

        <TouchableOpacity style={styles.navItem} onPress={() => go(merged.right.route)}>
          <Ionicons name={merged.right.icon} size={24} color={active === "right" ? COLORS.active : COLORS.inactive} />
          <Text style={[styles.navLabel, { color: active === "right" ? COLORS.active : COLORS.inactive }]}>
            {merged.right.label}
          </Text>
        </TouchableOpacity>
      </View>

      {/* FAB CENTER BUTTON */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => go(merged.center.route)}
        style={[styles.centerBtnGlobal, { bottom: fabBottom }]}
      >
        <View style={styles.centerBtnCircle}>
          <Ionicons name={merged.center.icon} size={28} color="#fff" />
          
          {/* 3. LOGIC BADGE DI SINI */}
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
  },
  bottomNav: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bg,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 28,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    shadowColor: "#000", shadowOpacity: 0.08, shadowOffset: { width: 0, height: -2 },
    shadowRadius: 8, elevation: 12,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 12, marginTop: 2, fontWeight: "600" },
  centerGap: { width: 80 },
  centerBtnGlobal: {
    position: "absolute", left: "50%",
    transform: [{ translateX: -(CIRCLE / 2) }],
    zIndex: 10000, elevation: 10000,
    alignItems: "center", pointerEvents: "auto",
  },
  centerBtnCircle: {
    width: CIRCLE, height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: COLORS.active,
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: COLORS.bg,
    shadowColor: "#000", shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10, elevation: 16,
    // Penting buat positioning badge relative ke circle ini
    position: "relative", 
  },
  centerLabel: {
    marginTop: 6, fontSize: 12, fontWeight: "700", textAlign: "center", width: CIRCLE + 8,
  },
  
  // 4. STYLE BADGE BARU
  badgeContainer: {
    position: "absolute",
    top: -2,  // Mainin ini biar posisinya pas di pojok kanan atas lingkaran
    right: -2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#dc2626", // Merah cabe
    borderWidth: 2,
    borderColor: "#FFFFFF", // Kasih border putih biar misah sama background biru
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },
});