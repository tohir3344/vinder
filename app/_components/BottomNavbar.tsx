// app/_components/BottomNavbar.tsx
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// TabKey sekarang hanya kiri dan kanan
type TabKey = "left" | "right";
type PresetKey = "admin" | "user";

type ItemConfig = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  route: string;
};

type Config = {
  left?: Partial<ItemConfig>;
  right?: Partial<ItemConfig>;
};

type Props = { active: TabKey; preset?: PresetKey; config?: Config; };

const PRESETS: Record<PresetKey, { left: ItemConfig; right: ItemConfig }> = {
  admin: {
    left: { icon: "home", label: "Beranda", route: "/src/admin/Home" },
    right: { icon: "person", label: "Profil", route: "/src/admin/Profile" },
  },
  user: {
    left: { icon: "home", label: "Home", route: "/src/staff/Home" },
    right: { icon: "person", label: "Akun", route: "/src/staff/Profile" },
  },
};

const COLORS = { active: "#A51C24", inactive: "#9BA4B5", bg: "#FFFFFF" };

export default function BottomNavbar({ active, preset = "admin", config }: Props) {
  const insets = useSafeAreaInsets();

  const extraPad = Platform.OS === 'android' ? 16 : 0;
  const safeBottom = Math.max(insets.bottom, extraPad);

  const BAR_BASE = 64;
  const barHeight = BAR_BASE + safeBottom;

  const base = PRESETS[preset];

  const merged = {
    left: { ...base.left, ...(config?.left ?? {}) },
    right: { ...base.right, ...(config?.right ?? {}) },
  };

  const go = (path: string) => router.push(path as never);

  return (
    <View style={styles.overlay} pointerEvents="box-none">

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
          <Ionicons
            name={merged.left.icon}
            size={26}
            color={active === "left" ? COLORS.active : COLORS.inactive}
          />
          <Text style={[styles.navLabel, { color: active === "left" ? COLORS.active : COLORS.inactive }]}>
            {merged.left.label}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => go(merged.right.route)}>
          <Ionicons
            name={merged.right.icon}
            size={26}
            color={active === "right" ? COLORS.active : COLORS.inactive}
          />
          <Text style={[styles.navLabel, { color: active === "right" ? COLORS.active : COLORS.inactive }]}>
            {merged.right.label}
          </Text>
        </TouchableOpacity>
      </View>
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    paddingHorizontal: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: "#000", shadowOpacity: 0.08, shadowOffset: { width: 0, height: -4 },
    shadowRadius: 10, elevation: 20,
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  navLabel: { fontSize: 12, marginTop: 4, fontWeight: "600" },
});