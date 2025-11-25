// app/src/utils/image.ts (atau path kamu sekarang)
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { logError, logInfo, logWarn } from "./logger";

type FileInfoMaybeSize = { size?: number; exists?: boolean };

/**
 * Baca ukuran file (byte).
 * - Kalau sukses: return size (bisa 0 kalau memang kosong)
 * - Kalau gagal: log sebagai WARNING (bukan ERROR) dan return 0
 */
export async function getFileSize(uri: string): Promise<number> {
  if (!uri) {
    await logWarn("IMAGE.getFileSize.emptyUri", { uri });
    return 0;
  }

  const maxRetry = 2; // coba beberapa kali kalau ada race condition

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const info = (await FileSystem.getInfoAsync(uri)) as FileInfoMaybeSize & {
        exists?: boolean;
      };

      const size = typeof info.size === "number" ? info.size : 0;

      await logInfo("IMAGE.getFileSize", {
        uri,
        size,
        exists: info.exists,
        attempt,
      });

      return size;
    } catch (e: any) {
      // Turunin level jadi WARNING supaya nggak bikin panik
      await logWarn("IMAGE.getFileSize.fail", {
        uri,
        attempt,
        error: String(e),
      });

      // kecilin kemungkinan spam: kalau sudah percobaan terakhir, keluar loop
      if (attempt === maxRetry) {
        break;
      }

      // kasih jeda sedikit sebelum coba lagi (optional)
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  // Kalau tetap gagal baca, jangan lempar error — biarkan caller yang handle.
  await logWarn("IMAGE.getFileSize.giveUp", { uri });
  return 0;
}

/**
 * Kompres sampai <= maxBytes (default 400KB), coba beberapa kali.
 * Kalau tetap nggak bisa, pakai file terakhir walaupun mungkin masih > maxBytes.
 */
export async function compressImageTo(
  uri: string,
  maxBytes = 400 * 1024
): Promise<{ uri: string; size: number }> {
  let quality = 0.7;
  let widthLimit = 900;
  let currentUri = uri;

  for (let i = 0; i < 5; i++) {
    try {
      const manip = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ resize: { width: widthLimit } }],
        { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
      );

      const bytes = await getFileSize(manip.uri);

      await logInfo("IMAGE.compressStep", {
        step: i,
        quality,
        widthLimit,
        bytes,
      });

      if (bytes > 0 && bytes <= maxBytes) {
        return { uri: manip.uri, size: bytes };
      }

      // kalau masih kebesaran → turunin quality & width
      quality = Math.max(0.4, quality - 0.1);
      widthLimit = Math.max(600, Math.round(widthLimit * 0.85));
      currentUri = manip.uri;
    } catch (e: any) {
      await logError("IMAGE.compressStep", {
        error: String(e),
        step: i,
        quality,
        widthLimit,
        currentUri,
      });
      break;
    }
  }

  // fallback terakhir: pakai file terakhir walaupun mungkin masih > maxBytes
  const last = await getFileSize(currentUri);
  return { uri: currentUri, size: last };
}
