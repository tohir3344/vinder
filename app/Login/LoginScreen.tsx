import React, { useState } from "react";
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Alert
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../src/config"; 
import { router } from "expo-router";

export default function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

   const onLogin = async () => {
  if (!username || !password) {
    Alert.alert("Oops", "Email dan password wajib diisi");
    return;
  }
  try {
    setLoading(true);
    const res = await fetch(`${API_BASE}/auth/login.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    const json = await res.json();
    if (!res.ok || !json?.success) throw new Error(json?.message || "Login gagal");

    // Ambil role dari API
    const role = (json?.data?.role || "").toLowerCase();
        if (role === "admin") {
          router.replace("../src/admin/Home");
        } else if (role === "staff") {
          router.replace("../src/staff/Home");
        } 
      } catch (e: any) {
        Alert.alert("Gagal", e?.message ?? "Terjadi kesalahan");
      } finally {
        setLoading(false);
      }
    };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={s.center}>
          <View style={s.card}>
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
                keyboardType="email-address"
                style={s.input}
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
              />
            </View>

            <Pressable onPress={onLogin} disabled={loading} style={[s.button, loading && { opacity: 0.7 }]}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>LOGIN</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: "#F3F4F6" 
  },

  center: { 
    flex: 1, 
    padding: 24, 
    justifyContent: "center", 
    alignItems: "center" 
  },

  card: {
    width: "100%", 
    maxWidth: 480, 
    backgroundColor: "#FFF", 
    borderRadius: 16, 
    padding: 20,
    borderWidth: 1, 
    borderColor: "#E5E7EB", 
    shadowColor: "#000", 
    shadowOpacity: 0.08,
    shadowRadius: 24, 
    shadowOffset: { 
      width: 0, 
      height: 12 
    }, 
    elevation: 3,
  },

  title: { 
    textAlign: "center", 
    fontSize: 22, 
    fontWeight: "800", 
    color: "#111827", 
    marginBottom: 16, 
    letterSpacing: 1 
  },

  label: { 
    fontSize: 12, 
    color: "#374151", 
    marginBottom: 6 
  },

  inputRow: {
    flexDirection: "row", 
    alignItems: "center", 
    borderWidth: 1, 
    borderColor: "#D1D5DB",
    borderRadius: 10, 
    backgroundColor: "#F9FAFB", 
    overflow: "hidden",
  },

  iconBox: {
    width: 42, 
    height: 42, 
    alignItems: 
    "center", 
    justifyContent: "center",
    borderRightWidth: 1, 
    borderRightColor: "#E5E7EB", 
    backgroundColor: "#F3F4F6",
  },

  input: { 
    flex: 1, 
    height: 42, 
    paddingHorizontal: 12, 
    color: "#111827" 
  },

  button: { 
    marginTop: 18, 
    backgroundColor: "#1D9BF0", 
    borderRadius: 10, 
    paddingVertical: 12, 
    alignItems: "center" 
  },

  buttonText: { 
    color: "#FFFFFF", 
    fontWeight: "800", 
    fontSize: 16, 
    letterSpacing: 0.5 
  },
});
