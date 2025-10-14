import { Platform } from "react-native";

const ANDROID_EMULATOR = "http://10.0.2.2/penggajian/api";
const IOS_SIMULATOR   = "http://localhost/penggajian/api";
// kalau tes pakai HP fisik, ganti IP_PC di bawah
const DEVICE_LAN      = "http://192.168.1.7/penggajian/api";

export const API_BASE =
  Platform.OS === "android"
    ? ANDROID_EMULATOR
    : IOS_SIMULATOR;

// // Jika pakai HP fisik (Android/iOS), sementara override:
// export const API_BASE = DEVICE_LAN;
