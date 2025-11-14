import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform, View } from "react-native";

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // kalau insets.bottom = 0 (umum di Android 3-button),
  // pakai fallback supaya tab bar + background TETAP NAIK
  const fallbackForAndroid = 28; // bisa 24–34, silakan atur preferensi
  const bottomPad =
    insets.bottom > 0 ? insets.bottom : (Platform.OS === "android" ? fallbackForAndroid : 0);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            // tombol2 tab bar + background "kotak putih" ikut naik
            height: 56 + bottomPad,
            paddingBottom: bottomPad,
            paddingTop: 6,
            backgroundColor: "transparent", // background digambar terpisah
            borderTopWidth: 0,
            elevation: 20,
          },
          tabBarLabelStyle: { marginBottom: 2 },

          // ini “kotak putihnya” yang ngikutin tombol2 (rounded + naik)
          tabBarBackground: () => (
            <View
              style={{
                flex: 1,
                backgroundColor: "#fff",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                overflow: "hidden",
                // optional tipis garis atas
                borderTopWidth: 0.5,
                borderColor: "rgba(0,0,0,0.08)",
              }}
            />
          ),
        }}
      />

      {/* ngecat area paling bawah biar kelihatan menyatu (kalau gesture bar terlihat) */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: bottomPad,     // SAMA dengan paddingBottom yang dipakai tab bar
          backgroundColor: "#fff" // samakan warna kotak putihnya
        }}
      />
    </>
  );
}
