import React, { useState, useEffect } from "react";
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
    <Stack screenOptions={{ headerShown: false }}>
      <KeepAwake />
      <Stack.Screen name="index" />
      <Stack.Screen name="Login/LoginScreen" />
      <Stack.Screen name="src/Home" />
    </Stack>
  );
}
