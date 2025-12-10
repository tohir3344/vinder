import React, { useState, useEffect } from "react";
import { StatusBar } from "react-native"; // <--- 1. Import StatusBar
import { Stack } from "expo-router";
import KeepAwake from "./_components/KeepAwake";
import LoadingScreen from "./LoadingScreen";

export default function RootLayout() {
  const [loading, setLoading] = useState(true);

  // loading selama 2 detik
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // tampilin LoadingScreen dulu
  if (loading) {
    return <LoadingScreen onFinish={() => setLoading(false)} />;
  }

  // Setelah loading selesai, render navigasi normal
  return (
    <>
      <StatusBar 
        backgroundColor="#2196F3"  // Warna Biru
        barStyle="light-content"   // Teks Putih
        translucent={false}        // Solid (biar gak transparan)
      />

      {/* KeepAwake taruh sini aman */}
      <KeepAwake />

      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="Login/LoginScreen" />
        {/* Pastikan nama route ini sesuai folder kamu ya (misal: src/staff/Home atau src/admin/Home) */}
        <Stack.Screen name="src/Home" />
      </Stack>
    </>
  );
}