// app/utils/image.ts
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";

type FileInfoMaybeSize = { size?: number };

export async function getFileSize(uri: string): Promise<number> {
  const info = (await FileSystem.getInfoAsync(uri)) as FileInfoMaybeSize;
  return typeof info.size === "number" ? info.size : 0;
}

/** Kompres sampai <= maxBytes (default 400KB), coba beberapa kali */
export async function compressImageTo(uri: string, maxBytes = 400 * 1024) {
  let quality = 0.7;
  let widthLimit = 900;
  let currentUri = uri;

  for (let i = 0; i < 5; i++) {
    const manip = await ImageManipulator.manipulateAsync(
      currentUri,
      [{ resize: { width: widthLimit } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );

    const bytes = await getFileSize(manip.uri);
    if (bytes > 0 && bytes <= maxBytes) {
      return { uri: manip.uri, size: bytes };
    }

    quality = Math.max(0.4, quality - 0.1);
    widthLimit = Math.max(600, Math.round(widthLimit * 0.85));
    currentUri = manip.uri;
  }

  const last = await getFileSize(currentUri);
  return { uri: currentUri, size: last };
}
