// app/_components/BottomNavbar.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/* ===== Types ===== */
type TabKey = "left" | "center" | "right";
type PresetKey = "admin" | "user";

type ItemConfig = {
  /** Ionicons name, contoh: "home", "trophy", "person-outline" */
  icon: React.ComponentProps<typeof Ionicons>["name"];
  /** Label di bawah icon */
  label: string;
  /** Rute expo-router saat ditekan */
  route: string;
};

type Config = {
  left: ItemConfig;
  center: ItemConfig;
  right: ItemConfig;
};

type Props = {
  /** tab aktif untuk highlight: "left" | "center" | "right" */
  active: TabKey;
  /** pilih preset: "admin" | "user" (default: "admin") */
  preset?: PresetKey;
  /** override sebagian/semua config kalau perlu */
  config?: Partial<Config>;
};

/* ===== Presets bawaan ===== */
const PRESETS: Record<PresetKey, Config> = {
  admin: {
    left:   { icon: "home",           label: "Beranda", route: "/src/admin/Home" },
    center: { icon: "trophy",         label: "Event",   route: "/src/admin/Event" },
    right:  { icon: "person",         label: "Profil",  route: "/src/admin/Profile" },
  },
  user: {
    left:   { icon: "home",           label: "Home",    route: "/src/staff/Home" },
    center: { icon: "trophy",         label: "Event",   route: "/src/staff/Event" },
    right:  { icon: "person",         label: "Akun",    route: "/src/staff/Profile" },
  },
};

/* ===== Colors & sizing ===== */
const COLORS = {
  active: "#0D47A1",
  inactive: "#9BA4B5",
  bg: "#FFFFFF",
};
const CIRCLE = 64; // diameter tombol tengah

/* ===== Component ===== */
export default function BottomNavbar({ active, preset = "admin", config }: Props) {
  const insets = useSafeAreaInsets();

  // gabungkan preset + override (kalau ada)
  const base = PRESETS[preset];
  const merged: Config = {
    left:   { ...base.left,   ...(config?.left   ?? {}) },
    center: { ...base.center, ...(config?.center ?? {}) },
    right:  { ...base.right,  ...(config?.right  ?? {}) },
  };

  const go = (path: string) => router.push(path as never);

  return (
    <View
      style={[
        styles.bottomNav,
        { paddingBottom: Math.max(10, insets.bottom) },
      ]}
    >
      {/* Left */}
      <TouchableOpacity style={styles.navItem} onPress={() => go(merged.left.route)}>
        <Ionicons
          name={merged.left.icon}
          size={24}
          color={active === "left" ? COLORS.active : COLORS.inactive}
        />
        <Text
          style={[
            styles.navLabel,
            { color: active === "left" ? COLORS.active : COLORS.inactive },
          ]}
        >
          {merged.left.label}
        </Text>
      </TouchableOpacity>

      {/* Gap untuk FAB tengah */}
      <View style={styles.centerGap} />

      {/* Right */}
      <TouchableOpacity style={styles.navItem} onPress={() => go(merged.right.route)}>
        <Ionicons
          name={merged.right.icon}
          size={24}
          color={active === "right" ? COLORS.active : COLORS.inactive}
        />
        <Text
          style={[
            styles.navLabel,
            { color: active === "right" ? COLORS.active : COLORS.inactive },
          ]}
        >
          {merged.right.label}
        </Text>
      </TouchableOpacity>

      {/* FAB Tengah */}
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => go(merged.center.route)}
        style={[
          styles.centerBtn,
          { bottom: 16 + insets.bottom / 2 },
        ]}
      >
        <View style={styles.centerBtnCircle}>
          <Ionicons name={merged.center.icon} size={28} color="#fff" />
        </View>
        <Text style={[styles.centerLabel, { color: COLORS.active }]}>
          {merged.center.label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/* ===== Styles ===== */
const styles = StyleSheet.create({
  bottomNav: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    height: 72,
    backgroundColor: COLORS.bg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 8,
    elevation: 12,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 12, marginTop: 2, fontWeight: "600" },
  centerGap: { width: 80 },

  // dead-center: left:'50%' + translateX(-CIRCLE/2)
  centerBtn: {
    position: "absolute",
    left: "57.5%",
    transform: [{ translateX: -(CIRCLE / 2) }],
    zIndex: 5,
    alignItems: "center",
  },
  centerBtnCircle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: COLORS.active,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: COLORS.bg,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 16,
  },
  centerLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    width: CIRCLE + 8,
  },
});
