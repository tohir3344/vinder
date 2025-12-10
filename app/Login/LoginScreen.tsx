import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView, // <-- Tambah ini bre
  Dimensions
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../config";
import { router, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const STAFF_HOME: Href = "/src/staff/Home";
const ADMIN_HOME: Href = "/src/admin/Home";
const { height } = Dimensions.get("window");

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // helper: fetch dengan timeout + guard non-JSON
  const fetchJson = async (url: string, init?: RequestInit, timeoutMs = 8000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();
      let json: any;
      try { json = JSON.parse(text); }
      catch { throw new Error(`Server tidak mengirim JSON (HTTP ${res.status}). ${text.slice(0,120)}`); }
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Login gagal (HTTP ${res.status})`);
      }
      return json;
    } finally {
      clearTimeout(t);
    }
  };

  const onLogin = async () => {
    if (!username || !password) {
      Alert.alert("Oops", "Username dan password wajib diisi");
      return;
    }

    try {
      setLoading(true);

      // 🔒 CEK KONEKSI INTERNET TERLEBIH DAHULU
      const net = await NetInfo.fetch();
      if (!net.isConnected) {
        Alert.alert(
          "Tidak ada koneksi Internet",
          "Silakan cek jaringan Anda dan coba lagi."
        );
        return; // langsung stop proses login
      }

      // 🔥 lanjutkan request API
      const json = await fetchJson(`${API_BASE}auth/login.php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      // normalisasi field dari API
      const data = json?.data ?? {};
      const role = String(data.role ?? "").toLowerCase();
      const user_id = Number(data.id ?? data.user_id ?? 0);

      if (!Number.isInteger(user_id) || user_id <= 0) {
        throw new Error("Server tidak mengirim user_id yang valid");
      }

      // simpan ke storage
      await AsyncStorage.multiSet([
        [
          "auth",
          JSON.stringify({
            user_id,
            role,
            username: data.username ?? username,
            name: data.name ?? null,
            email: data.email ?? null,
          }),
        ],
        ["user_id", String(user_id)],
      ]);

      // routing berdasarkan role
      if (role === "admin") {
        router.replace(ADMIN_HOME);
      } else {
        router.replace(STAFF_HOME);
      }
    } catch (e: any) {
      // fallback jika ada error lain
      Alert.alert("Gagal", e?.message ?? "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.screen}>
      {/* Ganti 'behavior' jadi 'padding' buat iOS dan 'height' buat Android 
        biar view-nya sadar kalau ada keyboard 
      */}
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"} 
        style={{ flex: 1 }}
      >
        {/* Bungkus pake ScrollView. 
          contentContainerStyle flexGrow: 1 bikin dia tetep full screen pas ga ada keyboard,
          tapi bisa discroll pas keyboard nongol.
        */}
        <ScrollView 
          contentContainerStyle={s.scrollContent} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.card}>

            <View style={s.logoContainer}>
              <Image
                source={require("../../assets/images/logo.png")}
                style={s.logo}
                resizeMode="contain"
              />
            </View>

            <Text style={s.title}>SILAHKAN LOGIN</Text>

            <Text style={s.label}>Username</Text>
            <View style={s.inputRow}>
              <View style={s.iconBox}><Ionicons name="person" size={18} color="#6B7280" /></View>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Masukan username"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                style={s.input}
                returnKeyType="next"
              />
            </View>

            <Text style={[s.label, { marginTop: 12 }]}>Password</Text>
            <View style={s.inputRow}>
              <View style={s.iconBox}><Ionicons name="lock-closed" size={18} color="#6B7280" /></View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Masukan password"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                style={s.input}
                returnKeyType="done"
                onSubmitEditing={onLogin}
              />
            </View>

            <Pressable onPress={onLogin} disabled={loading} style={[s.button, loading && { opacity: 0.7 }]}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>LOGIN</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F3F4F6" },
  
  // Style baru buat ScrollView biar kontennya tetep di tengah
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    minHeight: height - 100 // Jaga-jaga biar ada tinggi minimal
  },

  card: {
    width: "100%", maxWidth: 480, backgroundColor: "#FFF", borderRadius: 16, padding: 20,
    borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.08,
    shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 3,
  },
  title: { textAlign: "center", fontSize: 22, fontWeight: "800", color: "#111827", marginBottom: 16, letterSpacing: 1 },
  label: { fontSize: 12, color: "#374151", marginBottom: 6 },
  inputRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#D1D5DB",
    borderRadius: 10, backgroundColor: "#F9FAFB", overflow: "hidden",
  },
  iconBox: {
    width: 42, height: 42, alignItems: "center", justifyContent: "center",
    borderRightWidth: 1, borderRightColor: "#E5E7EB", backgroundColor: "#F3F4F6",
  },
  input: { flex: 1, height: 42, paddingHorizontal: 12, color: "#111827" },
  button: { marginTop: 18, backgroundColor: "#1D9BF0", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  logoContainer: {
    marginTop: 24,
    alignItems: "center",
  },
  logo: {
    width: 120,
    height: 120,
  },
});