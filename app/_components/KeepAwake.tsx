import { useEffect } from "react";
import { Platform } from "react-native";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";

/**
 * Aktifkan keep-awake hanya di iOS/Android.
 * Aman dipasang di mana saja (tidak pakai hook yang sensitif urutan).
 */
export default function KeepAwake() {
  useEffect(() => {
    let activated = false;

    const run = async () => {
      // Jangan aktifkan di web (tidak didukung)
      if (Platform.OS === "ios" || Platform.OS === "android") {
        try {
          await activateKeepAwakeAsync();
          activated = true;
        } catch (e) {
          // Jangan crash; cukup log supaya gampang debug
          console.warn("[keep-awake] gagal aktivasi:", e);
        }
      }
    };

    run();

    return () => {
      if (activated) {
        try {
          deactivateKeepAwake();
        } catch (e) {
          console.warn("[keep-awake] gagal deaktivasi:", e);
        }
      }
    };
  }, []);

  return null;
}
