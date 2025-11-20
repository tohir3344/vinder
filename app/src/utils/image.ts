import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { logError, logInfo } from "./logger";

type FileInfoMaybeSize = { size?: number };

/** Baca ukuran file (byte). Kalau gagal → 0 tapi tetap di-log. */
export async function getFileSize(uri: string): Promise<number> {
  try {
    const info = (await FileSystem.getInfoAsync(uri)) as FileInfoMaybeSize;
    const sz = typeof info.size === "number" ? info.size : 0;
    await logInfo("IMAGE.getFileSize", { uri, size: sz });
    return sz;
  } catch (e) {
    await logError("IMAGE.getFileSize", { error: e, uri });
    return 0;
  }
}

/** Kompres sampai <= maxBytes (default 400KB), coba beberapa kali */
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
    } catch (e) {
      await logError("IMAGE.compressStep", {
        error: e,
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
