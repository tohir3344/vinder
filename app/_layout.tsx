import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Kalau tidak perlu override judul/opsi khusus, baris-baris di bawah ini
          sebenarnya boleh DIHAPUS. Router otomatis mengenali file di /app */}
      <Stack.Screen name="index" />
      <Stack.Screen name="Login/LoginScreen" />
      <Stack.Screen name="src/Home" />
    </Stack>
  );
}
