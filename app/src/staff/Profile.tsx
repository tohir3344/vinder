import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

export default function BottomNav() {
  return (
    <View style={styles.container}>
      {/* HOME - warna normal */}
      <TouchableOpacity
        onPress={() => router.push("/src/staff/Home")}
        style={styles.navItem}
      >
        <Ionicons name="home-outline" size={26} color="#757575" />
        <Text style={[styles.label, { color: "#757575" }]}>Beranda</Text>
      </TouchableOpacity>

      {/* PROFILE - biru */}
      <TouchableOpacity
        onPress={() => router.push("/src/staff/Profile")}
        style={styles.navItem}
      >
        <Ionicons name="person" size={26} color="#0D47A1" />
        <Text style={[styles.label, { color: "#0D47A1" }]}>Profil</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
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
  },
  navItem: {
    alignItems: "center",
  },
  label: {
    fontSize: 12,
    marginTop: 2,
  },
});
