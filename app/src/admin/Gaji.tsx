// app/admin/GajiAdmin.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE as RAW_API_BASE } from "../../config";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

// ===== Endpoints =====
const API_USERS = `${API_BASE}gaji/gaji_users.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;
const API_SAVE = `${API_BASE}gaji/gaji_save.php`;
const API_SLIP = `${API_BASE}gaji/gaji_slip.php`;
const API_ARCH = `${API_BASE}gaji/gaji_archive.php`;
// endpoint contoh untuk update status bayar (silakan sesuaikan di backend)
const API_SLIP_STATUS = `${API_BASE}gaji/gaji_status.php`;

// ===== Types =====
type UserOpt = { id: number; nama: string; gaji?: number };

type PreviewResp = {
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  lembur_menit: number;
  lembur_rp: number;
  angsuran_rp: number;
  gaji_pokok_rp?: number;
};

type ArchiveRow = {
  id: number;
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number;
  lembur_menit: number;
  lembur_rp: number;
  gaji_pokok_rp: number;
  angsuran_rp: number;
  thr_rp?: number | null;
  bonus_akhir_tahun_rp?: number | null;
  others_total_rp?: number | null;
  kerajinan_rp?: number | null;
  kebersihan_rp?: number | null;
  ibadah_rp?: number | null;
  total_gaji_rp: number;
  created_at?: string;
  others_json?: any;
  status_bayar?: string | null;
  paid_at?: string | null;
};

// Rincian "Lainnya"
type OtherItem = { label: string; amount: number };

function parseOthers(row: any): OtherItem[] {
  if (!row || !row.others_json) return [];

  let raw = row.others_json as any;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const out: OtherItem[] = [];
  for (const o of raw) {
    if (!o) continue;
    const label = String(o.label ?? "Lainnya");
    const amt = parseInt(String(o.amount ?? 0), 10);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    out.push({ label, amount: amt });
  }
  return out;
}

// ===== Helpers =====
const fmtIDR = (n: number) => (n ?? 0).toLocaleString("id-ID");

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const startOfWeek = (d: Date) => {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = dt.getDay();
  const diffToMonday = (dow + 6) % 7;
  dt.setDate(dt.getDate() - diffToMonday);
  return dt;
};
const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const thisWeekRange = () => ({
  start: startOfWeek(new Date()),
  end: endOfWeek(new Date()),
});
const monthLabelID = (d: Date) =>
  d.toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });

/** CSV helpers (pakai BOM untuk Excel) */
const csvEscape = (v: any) => {
  const s = (v ?? "").toString().replace(/\r?\n/g, " ");
  if (/[",;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
export const toCSV = (headers: string[], rows: any[][]) => {
  const head = headers.map(csvEscape).join(",");
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return "\uFEFF" + head + "\n" + body + "\n";
};

// ====== FILE EXPORT HELPERS ======
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_");
// Shim biar kompatibel semua versi expo-file-system (SDK 54)
const FS_ANY: any = FileSystem as any;
const ENC = FS_ANY?.EncodingType ?? { UTF8: "utf8", Base64: "base64" };

/** Tulis teks (CSV/TXT) + share; fallback ke SAF Android bila dir null */
export async function writeAndShareTextFile(
  filename: string,
  content: string,
  mime = "text/csv"
) {
  try {
    const name = safeName(filename);

    const baseDir: string =
      (FS_ANY.documentDirectory as string | undefined) ??
      (FS_ANY.cacheDirectory as string | undefined) ??
      "";

    if (baseDir) {
      const target = baseDir + name;
      await FileSystem.writeAsStringAsync(target, content); // UTF-8 default

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target, {
          dialogTitle: "Bagikan / Buka file",
          mimeType: mime,
          UTI:
            mime === "text/csv"
              ? "public.comma-separated-values-text"
              : "public.data",
        } as any);
      } else {
        Alert.alert("Tersimpan", `File tersimpan: ${target}`);
      }
      return;
    }

    // ANDROID fallback: SAF
    if (Platform.OS === "android" && FS_ANY?.StorageAccessFramework) {
      const SAF = FS_ANY.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Izin dibutuhkan", "Pilih folder untuk menyimpan file.");
        return;
      }

      const fileUri = await SAF.createFileAsync(perm.directoryUri, name, mime);
      await FileSystem.writeAsStringAsync(fileUri, content); // UTF-8 default

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          dialogTitle: "Bagikan / Buka file",
          mimeType: mime,
        } as any);
      } else {
        Alert.alert("Tersimpan", "File berhasil disimpan.");
      }
      return;
    }

    Alert.alert("Gagal", "Direktori/izin penyimpanan tidak tersedia.");
  } catch (e: any) {
    Alert.alert("Gagal simpan", e?.message || String(e));
  }
}

/** Buat PDF dari HTML + share; fallback SAF & share langsung dari temp bila perlu */
export async function htmlToPdfAndShare(basename: string, html: string) {
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const safe = safeName(basename.replace(/\.pdf$/i, "")) + ".pdf";

    const baseDir: string =
      (FS_ANY.documentDirectory as string | undefined) ??
      (FS_ANY.cacheDirectory as string | undefined) ??
      "";

    if (baseDir) {
      const target = baseDir + safe;
      await FileSystem.copyAsync({ from: uri, to: target });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target, {
          dialogTitle: "Bagikan / Buka PDF",
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
        } as any);
      } else {
        Alert.alert("Tersimpan", `PDF tersimpan: ${target}`);
      }
      return;
    }

    // ANDROID fallback: SAF (butuh base64 untuk tulis)
    if (Platform.OS === "android" && FS_ANY?.StorageAccessFramework) {
      const SAF = FS_ANY.StorageAccessFramework;
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm.granted) {
        // Last resort: share dari temp file
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            dialogTitle: "Bagikan / Buka PDF",
            mimeType: "application/pdf",
            UTI: "com.adobe.pdf",
          } as any);
        } else {
          Alert.alert(
            "Gagal",
            "Tidak ada lokasi penyimpanan & sharing tidak tersedia."
          );
        }
        return;
      }

      const destUri = await SAF.createFileAsync(
        perm.directoryUri,
        safe,
        "application/pdf"
      );

      const pdfBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: ENC.Base64 as any,
      });
      await FileSystem.writeAsStringAsync(destUri, pdfBase64, {
        encoding: ENC.Base64 as any,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destUri, {
          dialogTitle: "Bagikan / Buka PDF",
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
        } as any);
      } else {
        Alert.alert("Tersimpan", "PDF berhasil disimpan.");
      }
      return;
    }

    // Last resort: share langsung dari temp URI
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        dialogTitle: "Bagikan / Buka PDF",
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      } as any);
    } else {
      Alert.alert(
        "Gagal",
        "Direktori tidak tersedia & Sharing tidak tersedia."
      );
    }
  } catch (e: any) {
    Alert.alert("Gagal membuat PDF", e?.message || String(e));
  }
}

/** PDF HTML helpers */
const tableStyle = `
  <style>
    *{font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;}
    h1,h2,h3{margin:0 0 8px 0;}
    .meta{color:#666;margin-bottom:10px;}
    table{width:100%;border-collapse:collapse;}
    th,td{border:1px solid #e5e7eb;padding:8px;font-size:12px;text-align:left;}
    th{background:#f3f4f6}
    tfoot td{font-weight:bold}
  </style>
`;

// ===== Palette =====
const C = {
  primary: "#2196F3",
  primaryDark: "#0066CC",
  primarySoft: "#E8F1FF",
  text: "#0B1A33",
  muted: "#6B7A90",
  border: "#E3ECFF",
  bg: "#F6F9FF",
  card: "#FFFFFF",
};

// ===== Status helpers =====
const fmtDateTimeID = (isoStr: string) => {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (!isFinite(d.getTime())) return isoStr;
  return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
};

function StatusPill({
  status,
  paidAt,
}: {
  status?: string | null;
  paidAt?: string | null;
}) {
  let label = "Belum dibayar";
  let bg = "#fee2e2";
  let color = "#b91c1c";

  if (status === "paid") {
    label = "Sudah dibayar";
    bg = "#dcfce7";
    color = "#166534";
  }

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

// ===== Komponen =====
export default function GajiAdmin() {
  const [tab, setTab] = useState<"hitung" | "slip" | "arsip">("hitung");

  // ===== Data users (dipakai semua tab) =====
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [userModal, setUserModal] = useState<{
    visible: boolean;
    target: "hitung" | "slip" | "arsip";
  }>({ visible: false, target: "hitung" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_USERS);
        const json = await res.json();
        if (!json.success) throw new Error(json.message || "Gagal load user");
        const arr: UserOpt[] = Array.isArray(json.data) ? json.data : [];
        setUsers(arr);
      } catch (e: any) {
        Alert.alert("Error", e.message || String(e));
      }
    })();
  }, []);

  // ====== Tab Hitung Gaji ======
  const week = useMemo(() => thisWeekRange(), []);
  const [hitUser, setHitUser] = useState<UserOpt | null>(null);

  type PeriodMode = "week" | "month";
  const [periodMode, setPeriodMode] = useState<PeriodMode>("week");

  const [hitStart, setHitStart] = useState<Date>(week.start);
  const [hitEnd, setHitEnd] = useState<Date>(week.end);

  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date());

  const [hitShowStart, setHitShowStart] = useState(false);
  const [hitShowEnd, setHitShowEnd] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const [hitLoading, setHitLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);

  // ====== Input gaji & tambahan ======
  const [gajiPokok, setGajiPokok] = useState<string>("");
  const [thr, setThr] = useState<string>("");
  const [bonusAkhirTahun, setBonusAkhirTahun] = useState<string>("");
  const [others, setOthers] = useState<
    { id: string; label: string; amount: string }[]
  >([]);

  // RESET INPUT SETIAP GANTI KARYAWAN
useEffect(() => {
  if (!hitUser) {
    setGajiPokok("");
    setThr("");
    setBonusAkhirTahun("");
    setOthers([]);
    return;
  }

  // kosongin dulu supaya gak kebawa nilai user sebelumnya,
  // nanti akan diisi lagi sama hasil preview (kalau ada)
  setGajiPokok("");
  setThr("");
  setBonusAkhirTahun("");
  setOthers([]);
}, [hitUser?.id]);

  const addOther = () => {
    setOthers((prev) => [
      ...prev,
      { id: String(Date.now()) + Math.random(), label: "", amount: "" },
    ]);
  };
  const updOther = (id: string, field: "label" | "amount", v: string) => {
    setOthers((prev) =>
      prev.map((o) => (o.id === id ? { ...o, [field]: v } : o))
    );
  };
  const delOther = (id: string) =>
    setOthers((prev) => prev.filter((o) => o.id !== id));

  useEffect(() => {
    if (periodMode === "week") {
      const now = new Date();
      setHitStart(startOfWeek(now));
      setHitEnd(endOfWeek(now));
    } else {
      const now = new Date();
      setMonthAnchor(now);
      setHitStart(startOfMonth(now));
      setHitEnd(endOfMonth(now));
    }
  }, [periodMode]);

  useEffect(() => {
    const load = async () => {
      if (!hitUser) return;
      setHitLoading(true);
      try {
        const url =
          `${API_PREVIEW}?user_id=${encodeURIComponent(
            String(hitUser.id)
          )}` +
          `&start=${encodeURIComponent(iso(hitStart))}` +
          `&end=${encodeURIComponent(iso(hitEnd))}`;
        const res = await fetch(url);
        const txt = await res.text();
        let json: any;
        try {
          json = JSON.parse(txt);
        } catch {
          throw new Error(txt);
        }
        if (!json.success || !json.data) {
          setPreview(null);
          return;
        }
        const d = json.data || {};
        const sane: PreviewResp = {
          user_id: Number(d.user_id ?? hitUser.id),
          nama: String(d.nama ?? hitUser.nama ?? "-"),
          periode_start: String(d.periode_start ?? iso(hitStart)),
          periode_end: String(d.periode_end ?? iso(hitEnd)),
          hadir_minggu: Number(d.hadir_minggu ?? 0),
          lembur_menit: Number(d.lembur_menit ?? 0),
          lembur_rp: Number(d.lembur_rp ?? 0),
          angsuran_rp: Number(d.angsuran_rp ?? 0),
          gaji_pokok_rp: Number(d.gaji_pokok_rp ?? (hitUser.gaji ?? 0)),
        };
        setPreview(sane);
        setGajiPokok((prev) =>
          prev === "" ? String(sane.gaji_pokok_rp || 0) : prev
        );
      } catch (e: any) {
        setPreview(null);
        if (String(e?.message || e).trim())
          Alert.alert("Error", e.message || String(e));
      } finally {
        setHitLoading(false);
      }
    };
    load();
  }, [hitUser, hitStart, hitEnd]);

  console.log("FS keys", Object.keys(FileSystem || {}));
  console.log("Platform", Platform.OS);

  const othersTotal = useMemo(
    () =>
      (others ?? []).reduce((acc, o) => {
        const v = parseInt(o.amount || "0", 10);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0),
    [others]
  );

  const totalHitung = useMemo(() => {
    if (!preview) return 0;
    const gp = parseInt(gajiPokok || "0", 10);
    const t = thr === "" ? 0 : parseInt(thr, 10);
    const b = bonusAkhirTahun === "" ? 0 : parseInt(bonusAkhirTahun, 10);
    return (
      gp + (preview.lembur_rp || 0) - (preview.angsuran_rp || 0) + t + b + othersTotal
    );
  }, [preview, gajiPokok, thr, bonusAkhirTahun, othersTotal]);

  const saveHitung = async () => {
    if (!hitUser || !preview) return;
    const gp = parseInt(gajiPokok || "0", 10);
    if (!gp || gp <= 0) {
      Alert.alert("Validasi", "Gaji per user wajib diisi (> 0).");
      return;
    }
    try {
      setHitLoading(true);
      const body: any = {
        user_id: hitUser.id,
        start: preview.periode_start,
        end: preview.periode_end,
        gaji_pokok_rp: gp,
        thr_rp: thr === "" ? null : parseInt(thr, 10),
        bonus_akhir_tahun_rp:
          bonusAkhirTahun === "" ? null : parseInt(bonusAkhirTahun, 10),
        others: (others || [])
          .map((o) => ({
            label: String(o.label || "Lainnya").slice(0, 80),
            amount: parseInt(o.amount || "0", 10),
          }))
          .filter((o) => Number.isFinite(o.amount) && o.amount > 0),
      };
      const ot = body.others.reduce(
        (a: number, r: any) => a + (r.amount || 0),
        0
      );
      body.ibadah_rp = ot;

      const res = await fetch(API_SAVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const txt = await res.text();
      let json: any;
      try {
        json = JSON.parse(txt);
      } catch {
        throw new Error(txt);
      }
      if (!json.success) throw new Error(json.message || "Gagal menyimpan");

      Alert.alert("Berhasil", `Slip tersimpan (ID: ${json.data?.id ?? "?"})`);
    } catch (e: any) {
      Alert.alert("Error", e.message || String(e));
    } finally {
      setHitLoading(false);
    }
  };

  // ====== Tab Slip Gaji ======
  const [slipUser, setSlipUser] = useState<UserOpt | null>(null);
  type SlipMode = "single" | "all";
  const [slipMode, setSlipMode] = useState<SlipMode>("single");

  type SlipPeriodMode = "week" | "month";
  const [slipPeriodMode, setSlipPeriodMode] = useState<SlipPeriodMode>("week");
  const [slipStart, setSlipStart] = useState<Date>(week.start);
  const [slipEnd, setSlipEnd] = useState<Date>(week.end);
  const [slipMonthAnchor, setSlipMonthAnchor] = useState<Date>(new Date());
  const [slipShowStart, setSlipShowStart] = useState(false);
  const [slipShowEnd, setSlipShowEnd] = useState(false);
  const [slipShowMonthPicker, setSlipShowMonthPicker] = useState(false);
  const [slipLoading, setSlipLoading] = useState(false);
  const [slip, setSlip] = useState<any>(null);
  const [slipList, setSlipList] = useState<ArchiveRow[]>([]);
  const [slipStatusLoading, setSlipStatusLoading] = useState(false);

  useEffect(() => {
    if (slipPeriodMode === "week") {
      const now = new Date();
      setSlipStart(startOfWeek(now));
      setSlipEnd(endOfWeek(now));
    } else {
      const now = new Date();
      setSlipMonthAnchor(now);
      setSlipStart(startOfMonth(now));
      setSlipEnd(endOfMonth(now));
    }
  }, [slipPeriodMode]);

  const loadSlip = async () => {
    if (slipMode === "single") {
      if (!slipUser) {
        Alert.alert("Validasi", "Pilih karyawan");
        return;
      }
      try {
        setSlipLoading(true);
        const url =
          `${API_SLIP}?user_id=${encodeURIComponent(
            String(slipUser.id)
          )}` +
          `&start=${encodeURIComponent(iso(slipStart))}` +
          `&end=${encodeURIComponent(iso(slipEnd))}`;
        const r = await fetch(url);
        const txt = await r.text();
        let j: any;
        try {
          j = JSON.parse(txt);
        } catch {
          throw new Error(txt);
        }
        if (!j.success) throw new Error(j.message || "Slip tidak ada");
        setSlip(j.data);
        setSlipList([]);
      } catch (e: any) {
        setSlip(null);
        Alert.alert("Info", e.message || String(e));
      } finally {
        setSlipLoading(false);
      }
    } else {
      try {
        setSlipLoading(true);
        const params = new URLSearchParams();
        params.set("start", iso(slipStart));
        params.set("end", iso(slipEnd));
        params.set("limit", "1000");
        const url = `${API_ARCH}?${params.toString()}`;
        const r = await fetch(url);
        const txt = await r.text();
        let j: any;
        try {
          j = JSON.parse(txt);
        } catch {
          throw new Error(txt);
        }
        if (!j.success) throw new Error(j.message || "Data kosong");
        const rows: ArchiveRow[] = Array.isArray(j.data)
          ? j.data
          : j.data?.rows ?? [];
        setSlipList(rows);
        setSlip(null);
      } catch (e: any) {
        setSlipList([]);
        Alert.alert("Info", e.message || String(e));
      } finally {
        setSlipLoading(false);
      }
    }
  };

  const updateSlipStatus = async (newStatus: "paid" | "unpaid") => {
    if (!slip) return;
    try {
      setSlipStatusLoading(true);
      const res = await fetch(API_SLIP_STATUS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: slip.id, status_bayar: newStatus }),
      });
      const txt = await res.text();
      let j: any;
      try {
        j = JSON.parse(txt);
      } catch {
        throw new Error(txt);
      }
      if (!j.success)
        throw new Error(j.message || "Gagal memperbarui status bayar.");
      await loadSlip();
    } catch (e: any) {
      Alert.alert("Error", e.message || String(e));
    } finally {
      setSlipStatusLoading(false);
    }
  };

  const mapTHR = (row: any) => row?.thr_rp ?? row?.kerajinan_rp ?? 0;
  const mapBonus = (row: any) =>
    row?.bonus_akhir_tahun_rp ?? row?.kebersihan_rp ?? 0;
  const mapOthers = (row: any) =>
    row?.others_total_rp ?? row?.ibadah_rp ?? 0;

  const othersFromSlip = slip ? parseOthers(slip) : [];

  // ====== Tab Arsip ======
  const [arsipUser, setArsipUser] = useState<UserOpt | null>(null);
  type ArsipPeriodMode = "week" | "month";
  const [arsipPeriodMode, setArsipPeriodMode] =
    useState<ArsipPeriodMode>("month");
  const [arsipStart, setArsipStart] = useState<Date>(
    startOfMonth(new Date())
  );
  const [arsipEnd, setArsipEnd] = useState<Date>(endOfMonth(new Date()));
  const [arsipMonthAnchor, setArsipMonthAnchor] = useState<Date>(
    new Date()
  );
  const [arsipShowStart, setArsipShowStart] = useState(false);
  const [arsipShowEnd, setArsipShowEnd] = useState(false);
  const [arsipShowMonthPicker, setArsipShowMonthPicker] = useState(false);
  const [arsipLoading, setArsipLoading] = useState(false);
  const [arsip, setArsip] = useState<ArchiveRow[]>([]);

  useEffect(() => {
    if (arsipPeriodMode === "week") {
      const now = new Date();
      setArsipStart(startOfWeek(now));
      setArsipEnd(endOfWeek(now));
    } else {
      const now = new Date();
      setArsipMonthAnchor(now);
      setArsipStart(startOfMonth(now));
      setArsipEnd(endOfMonth(now));
    }
  }, [arsipPeriodMode]);

  const loadArsip = async () => {
    try {
      setArsipLoading(true);
      const params = new URLSearchParams();
      if (arsipUser?.id) params.set("user_id", String(arsipUser.id));
      params.set("start", iso(arsipStart));
      params.set("end", iso(arsipEnd));
      params.set("limit", "1000");
      const url = `${API_ARCH}?${params.toString()}`;
      const r = await fetch(url);
      const txt = await r.text();
      let j: any;
      try {
        j = JSON.parse(txt);
      } catch {
        throw new Error(txt);
      }
      if (!j.success) throw new Error(j.message || "Arsip kosong");
      setArsip(Array.isArray(j.data) ? j.data : j.data?.rows ?? []);
    } catch (e: any) {
      setArsip([]);
      Alert.alert("Info", e.message || String(e));
    } finally {
      setArsipLoading(false);
    }
  };

  // --- Slip (single) PDF ---
  const exportSlipPDF = async () => {
    if (!slip) {
      Alert.alert("Info", "Tidak ada data slip.");
      return;
    }

    const othersItems = parseOthers(slip);
    const othersRowsHtml = othersItems.length
      ? othersItems
          .map(
            (o) =>
              `<tr><th>${o.label}</th><td>Rp ${fmtIDR(o.amount)}</td></tr>`
          )
          .join("")
      : `<tr><th>Lainnya (Total)</th><td>Rp ${fmtIDR(
          mapOthers(slip)
        )}</td></tr>`;

    const html = `
      ${tableStyle}
      <h2>Slip Gaji</h2>
      <div class="meta">${slip.nama} • ${slip.periode_start} s/d ${
      slip.periode_end
    }</div>
      <table>
        <tbody>
          <tr><th>Nama</th><td>${slip.nama}</td></tr>
          <tr><th>Periode</th><td>${slip.periode_start} s/d ${
      slip.periode_end
    }</td></tr>
          <tr><th>Absen (hari)</th><td>${slip.hadir_minggu}</td></tr>
          <tr><th>Lembur (menit)</th><td>${slip.lembur_menit}</td></tr>
          <tr><th>Lembur (Rp)</th><td>Rp ${fmtIDR(
            slip.lembur_rp
          )}</td></tr>
          <tr><th>Gaji Pokok</th><td>Rp ${fmtIDR(
            slip.gaji_pokok_rp
          )}</td></tr>
          <tr><th>Angsuran</th><td>Rp ${fmtIDR(
            slip.angsuran_rp
          )}</td></tr>
          <tr><th>THR</th><td>Rp ${fmtIDR(mapTHR(slip))}</td></tr>
          <tr><th>Bonus Akhir Tahun</th><td>Rp ${fmtIDR(
            mapBonus(slip)
          )}</td></tr>
          ${othersRowsHtml}
        </tbody>
        <tfoot>
          <tr><td>Total Gaji</td><td>Rp ${fmtIDR(
            slip.total_gaji_rp
          )}</td></tr>
        </tfoot>
      </table>
    `;
    const name = `slip_${slip.nama}_${slip.periode_start}_${slip.periode_end}.pdf`.replace(
      /\s+/g,
      "_"
    );
    await htmlToPdfAndShare(name, html);
  };

  // --- Slip (all) PDF ---
  const exportSlipListPDF = async () => {
    if (!slipList?.length) {
      Alert.alert("Info", "Tidak ada data.");
      return;
    }
    const head = `
      ${tableStyle}
      <h2>Slip Gaji - Semua Karyawan</h2>
      <div class="meta">Periode ${iso(slipStart)} s/d ${iso(
      slipEnd
    )}</div>
      <table>
        <thead>
          <tr>
            <th>Nama</th><th>Periode</th><th>Absen</th><th>Lembur (menit)</th><th>Lembur (Rp)</th>
            <th>Gaji Pokok</th><th>Angsuran</th><th>THR</th><th>Bonus</th><th>Lainnya</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = slipList
      .map(
        (r) => `
      <tr>
        <td>${r.nama}</td>
        <td>${r.periode_start}–${r.periode_end}</td>
        <td>${r.hadir_minggu}</td>
        <td>${r.lembur_menit}</td>
        <td>Rp ${fmtIDR(r.lembur_rp)}</td>
        <td>Rp ${fmtIDR(r.gaji_pokok_rp)}</td>
        <td>Rp ${fmtIDR(r.angsuran_rp)}</td>
        <td>Rp ${fmtIDR(mapTHR(r))}</td>
        <td>Rp ${fmtIDR(mapBonus(r))}</td>
        <td>Rp ${fmtIDR(mapOthers(r))}</td>
        <td>Rp ${fmtIDR(r.total_gaji_rp)}</td>
      </tr>
    `
      )
      .join("");
    const html = `${head}${rows}</tbody></table>`;
    const name = `slip_semua_${iso(slipStart)}_${iso(slipEnd)}.pdf`;
    await htmlToPdfAndShare(name, html);
  };

  // --- Arsip PDF ---
  const exportArsipPDF = async () => {
    if (!arsip?.length) {
      Alert.alert("Info", "Tidak ada data arsip.");
      return;
    }
    const head = `
      ${tableStyle}
      <h2>Arsip Gaji</h2>
      <div class="meta">${monthLabelID(arsipMonthAnchor)}</div>
      <table>
        <thead>
          <tr>
            <th>Nama</th><th>Periode</th><th>Absen</th><th>Lembur (menit)</th><th>Lembur (Rp)</th>
            <th>Gaji Pokok</th><th>Angsuran</th><th>THR</th><th>Bonus</th><th>Lainnya</th><th>Total</th><th>Dibuat</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = arsip
      .map(
        (r) => `
      <tr>
        <td>${r.nama}</td>
        <td>${r.periode_start}–${r.periode_end}</td>
        <td>${r.hadir_minggu}</td>
        <td>${r.lembur_menit}</td>
        <td>Rp ${fmtIDR(r.lembur_rp)}</td>
        <td>Rp ${fmtIDR(r.gaji_pokok_rp)}</td>
        <td>Rp ${fmtIDR(r.angsuran_rp)}</td>
        <td>Rp ${fmtIDR(mapTHR(r))}</td>
        <td>Rp ${fmtIDR(mapBonus(r))}</td>
        <td>Rp ${fmtIDR(mapOthers(r))}</td>
        <td>Rp ${fmtIDR(r.total_gaji_rp)}</td>
        <td>${r.created_at || "-"}</td>
      </tr>
    `
      )
      .join("");
    const html = `${head}${rows}</tbody></table>`;
    const name = `arsip_${monthLabelID(arsipMonthAnchor).replace(
      /\s+/g,
      "_"
    )}.pdf`;
    await htmlToPdfAndShare(name, html);
  };

  // ====== UI ======
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header biru */}
      <View style={st.headerWrap}>
        <Text style={st.title}>Gaji</Text>
        <View style={st.tabs}>
          <TouchableOpacity
            style={[st.tabBtn, tab === "hitung" && st.tabActive]}
            onPress={() => setTab("hitung")}
          >
            <Text style={[st.tabTx, tab === "hitung" && st.tabTxActive]}>
              Hitung Gaji
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tabBtn, tab === "slip" && st.tabActive]}
            onPress={() => setTab("slip")}
          >
            <Text style={[st.tabTx, tab === "slip" && st.tabTxActive]}>
              Slip Gaji
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.tabBtn, tab === "arsip" && st.tabActive]}
            onPress={() => setTab("arsip")}
          >
            <Text style={[st.tabTx, tab === "arsip" && st.tabTxActive]}>
              Arsip
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      <ScrollView
        contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled"
      >
        {tab === "hitung" ? (
          <View>
            {/* Pilih user */}
            <Text style={st.label}>Nama</Text>
            <TouchableOpacity
              style={st.select}
              onPress={() =>
                setUserModal({ visible: true, target: "hitung" })
              }
            >
              <Text style={st.selectTx}>
                {hitUser ? hitUser.nama : "Pilih karyawan"}
              </Text>
            </TouchableOpacity>

            {/* Mode Periode */}
            <Text style={st.label}>Mode Periode</Text>
            <View style={st.segmentWrap}>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  periodMode === "week" && st.segmentActive,
                ]}
                onPress={() => setPeriodMode("week")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    periodMode === "week" && st.segmentTxActive,
                  ]}
                >
                  Per Minggu
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  periodMode === "month" && st.segmentActive,
                ]}
                onPress={() => setPeriodMode("month")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    periodMode === "month" && st.segmentTxActive,
                  ]}
                >
                  Per Bulan
                </Text>
              </TouchableOpacity>
            </View>

            {/* Periode */}
            <Text style={st.label}>Periode</Text>
            {periodMode === "week" ? (
              <>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setHitShowStart(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(hitStart)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setHitShowEnd(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(hitEnd)}</Text>
                  </TouchableOpacity>
                </View>
                {hitShowStart && (
                  <DateTimePicker
                    value={hitStart}
                    mode="date"
                    onChange={(_, date) => {
                      setHitShowStart(false);
                      if (date) {
                        const s = startOfWeek(date);
                        const e = endOfWeek(date);
                        setHitStart(s);
                        setHitEnd(e);
                      }
                    }}
                  />
                )}
                {hitShowEnd && (
                  <DateTimePicker
                    value={hitEnd}
                    mode="date"
                    onChange={(_, date) => {
                      setHitShowEnd(false);
                      if (date) {
                        const s = startOfWeek(date);
                        const e = endOfWeek(date);
                        setHitStart(s);
                        setHitEnd(e);
                      }
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={st.inputBtn}
                  onPress={() => setShowMonthPicker(true)}
                >
                  <Text style={st.inputBtnTx}>{monthLabelID(monthAnchor)}</Text>
                </TouchableOpacity>
                {showMonthPicker && (
                  <DateTimePicker
                    value={monthAnchor}
                    mode="date"
                    onChange={(_, date) => {
                      setShowMonthPicker(false);
                      if (date) {
                        setMonthAnchor(date);
                        setHitStart(startOfMonth(date));
                        setHitEnd(endOfMonth(date));
                      }
                    }}
                  />
                )}
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: C.muted }}>
                    Rentang: {iso(hitStart)} s/d {iso(hitEnd)}
                  </Text>
                </View>
              </>
            )}

            {/* Preview */}
            {hitLoading && (
              <ActivityIndicator
                style={{ marginTop: 12 }}
                color={C.primary}
              />
            )}
            {preview && (
              <View style={st.card}>
                <Row label="Nama" value={preview?.nama ?? "-"} />
                <Row
                  label="Absen (hari/periode)"
                  value={String(preview?.hadir_minggu ?? 0)}
                />
                <Row
                  label="Lembur (menit)"
                  value={String(preview?.lembur_menit ?? 0)}
                />
                <Row
                  label="Lembur (Rp)"
                  value={`Rp ${fmtIDR(preview?.lembur_rp ?? 0)}`}
                />
                <Row
                  label="Angsuran (potongan terbaru)"
                  value={`Rp ${fmtIDR(preview?.angsuran_rp ?? 0)}`}
                />

                <Text style={[st.label, { marginTop: 16 }]}>
                  Gaji per User (Rp)
                </Text>
                <TextInput
                  style={st.input}
                  keyboardType={
                    Platform.OS === "ios" ? "number-pad" : "numeric"
                  }
                  placeholder="cth: 3000000"
                  placeholderTextColor={C.muted}
                  value={gajiPokok}
                  onChangeText={setGajiPokok}
                />

                {/* Tambahan baru */}
                <Text style={[st.h3, { marginTop: 18 }]}>Tambahan</Text>

                <Text style={st.label}>THR (Rp)</Text>
                <TextInput
                  style={st.input}
                  keyboardType={
                    Platform.OS === "ios" ? "number-pad" : "numeric"
                  }
                  value={thr}
                  onChangeText={setThr}
                  placeholder="opsional"
                  placeholderTextColor={C.muted}
                />

                <Text style={st.label}>Bonus Akhir Tahun (Rp)</Text>
                <TextInput
                  style={st.input}
                  keyboardType={
                    Platform.OS === "ios" ? "number-pad" : "numeric"
                  }
                  value={bonusAkhirTahun}
                  onChangeText={setBonusAkhirTahun}
                  placeholder="opsional"
                  placeholderTextColor={C.muted}
                />

                <Text style={st.label}>Lainnya</Text>
                {others.map((o) => (
                  <View key={o.id} style={{ marginBottom: 8, gap: 8 }}>
                    <TextInput
                      style={st.input}
                      value={o.label}
                      placeholder="Nama biaya (mis. Transport, Makan, dst.)"
                      placeholderTextColor={C.muted}
                      onChangeText={(v) => updOther(o.id, "label", v)}
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TextInput
                        style={[st.input, { flex: 1 }]}
                        keyboardType={
                          Platform.OS === "ios" ? "number-pad" : "numeric"
                        }
                        value={o.amount}
                        placeholder="Nominal (Rp)"
                        placeholderTextColor={C.muted}
                        onChangeText={(v) => updOther(o.id, "amount", v)}
                      />
                      <TouchableOpacity
                        style={[st.btnGhost, { paddingHorizontal: 14 }]}
                        onPress={() => delOther(o.id)}
                      >
                        <Text
                          style={[st.btnGhostText, { color: "#b91c1c" }]}
                        >
                          Hapus
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  style={[st.btnGhost, { marginTop: 6 }]}
                  onPress={addOther}
                >
                  <Text
                    style={[st.btnGhostText, { color: C.primaryDark }]}
                  >
                    + Tambah Lainnya
                  </Text>
                </TouchableOpacity>

                <View style={st.totalBox}>
                  <Text style={st.totalLabel}>Total Gaji</Text>
                  <Text style={st.totalVal}>
                    Rp {fmtIDR(totalHitung)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={st.btnPrimary}
                  onPress={saveHitung}
                  disabled={hitLoading || !hitUser}
                >
                  {hitLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={st.btnText}>Simpan Slip</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : tab === "slip" ? (
          <View>
            {/* Mode data */}
            <Text style={st.label}>Mode Data</Text>
            <View style={st.segmentWrap}>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  slipMode === "single" && st.segmentActive,
                ]}
                onPress={() => setSlipMode("single")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    slipMode === "single" && st.segmentTxActive,
                  ]}
                >
                  Per User
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  slipMode === "all" && st.segmentActive,
                ]}
                onPress={() => setSlipMode("all")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    slipMode === "all" && st.segmentTxActive,
                  ]}
                >
                  Semua
                </Text>
              </TouchableOpacity>
            </View>

            {/* Pilih user (hanya single) */}
            {slipMode === "single" && (
              <>
                <Text style={st.label}>Nama</Text>
                <TouchableOpacity
                  style={st.select}
                  onPress={() =>
                    setUserModal({ visible: true, target: "slip" })
                  }
                >
                  <Text style={st.selectTx}>
                    {slipUser ? slipUser.nama : "Pilih karyawan"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* Mode Periode Slip */}
            <Text style={st.label}>Mode Periode</Text>
            <View style={st.segmentWrap}>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  slipPeriodMode === "week" && st.segmentActive,
                ]}
                onPress={() => setSlipPeriodMode("week")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    slipPeriodMode === "week" && st.segmentTxActive,
                  ]}
                >
                  Per Minggu
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  slipPeriodMode === "month" && st.segmentActive,
                ]}
                onPress={() => setSlipPeriodMode("month")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    slipPeriodMode === "month" && st.segmentTxActive,
                  ]}
                >
                  Per Bulan
                </Text>
              </TouchableOpacity>
            </View>

            {/* Periode Slip */}
            <Text style={st.label}>Periode</Text>
            {slipPeriodMode === "week" ? (
              <>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setSlipShowStart(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(slipStart)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setSlipShowEnd(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(slipEnd)}</Text>
                  </TouchableOpacity>
                </View>
                {slipShowStart && (
                  <DateTimePicker
                    value={slipStart}
                    mode="date"
                    onChange={(_, d) => {
                      setSlipShowStart(false);
                      if (d) {
                        setSlipStart(startOfWeek(d));
                        setSlipEnd(endOfWeek(d));
                      }
                    }}
                  />
                )}
                {slipShowEnd && (
                  <DateTimePicker
                    value={slipEnd}
                    mode="date"
                    onChange={(_, d) => {
                      setSlipShowEnd(false);
                      if (d) {
                        setSlipStart(startOfWeek(d));
                        setSlipEnd(endOfWeek(d));
                      }
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={st.inputBtn}
                  onPress={() => setSlipShowMonthPicker(true)}
                >
                  <Text style={st.inputBtnTx}>
                    {monthLabelID(slipMonthAnchor)}
                  </Text>
                </TouchableOpacity>
                {slipShowMonthPicker && (
                  <DateTimePicker
                    value={slipMonthAnchor}
                    mode="date"
                    onChange={(_, d) => {
                      setSlipShowMonthPicker(false);
                      if (d) {
                        setSlipMonthAnchor(d);
                        setSlipStart(startOfMonth(d));
                        setSlipEnd(endOfMonth(d));
                      }
                    }}
                  />
                )}
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: C.muted }}>
                    Rentang: {iso(slipStart)} s/d {iso(slipEnd)}
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity
              style={st.btnPrimary}
              onPress={loadSlip}
              disabled={slipLoading || (slipMode === "single" && !slipUser)}
            >
              {slipLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={st.btnText}>Tampilkan</Text>
              )}
            </TouchableOpacity>

            {/* Tombol unduh */}
            {slipMode === "single" && slip && (
              <View
                style={{ flexDirection: "row", gap: 8, marginTop: 10 }}
              >
                <TouchableOpacity
                  style={st.btnGhost}
                  onPress={exportSlipPDF}
                >
                  <Text
                    style={[
                      st.btnGhostText,
                      { color: C.primaryDark },
                    ]}
                  >
                    Unduh PDF
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {slipMode === "all" && slipList.length > 0 && (
              <View
                style={{ flexDirection: "row", gap: 8, marginTop: 10 }}
              >
                <TouchableOpacity
                  style={st.btnGhost}
                  onPress={exportSlipListPDF}
                >
                  <Text
                    style={[
                      st.btnGhostText,
                      { color: C.primaryDark },
                    ]}
                  >
                    Unduh PDF
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Hasil (SINGLE) */}
            {slipMode === "single" && slip && (
              <View style={st.card}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <View>
                    <Text
                      style={{
                        color: C.text,
                        fontWeight: "800",
                      }}
                    >
                      {slip.nama}
                    </Text>
                    <Text
                      style={{
                        color: C.muted,
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {slip.periode_start} s/d {slip.periode_end}
                    </Text>
                  </View>
                  <StatusPill
                    status={slip.status_bayar}
                    paidAt={slip.paid_at}
                  />
                </View>

                <Sep />
                <Row
                  label="Absen (hari/periode)"
                  value={String(slip.hadir_minggu)}
                />
                <Row
                  label="Lembur (menit)"
                  value={String(slip.lembur_menit)}
                />
                <Row
                  label="Lembur (Rp)"
                  value={`Rp ${fmtIDR(slip.lembur_rp)}`}
                />
                <Row
                  label="Gaji per User"
                  value={`Rp ${fmtIDR(slip.gaji_pokok_rp)}`}
                />
                <Row
                  label="Angsuran (potongan terbaru)"
                  value={`Rp ${fmtIDR(slip.angsuran_rp)}`}
                />
                {mapTHR(slip) ? (
                  <Row
                    label="THR"
                    value={`Rp ${fmtIDR(mapTHR(slip))}`}
                  />
                ) : null}
                {mapBonus(slip) ? (
                  <Row
                    label="Bonus Akhir Tahun"
                    value={`Rp ${fmtIDR(mapBonus(slip))}`}
                  />
                ) : null}

                {/* Rincian Lainnya per-item */}
                {othersFromSlip.length > 0
                  ? othersFromSlip.map((o, idx) => (
                      <Row
                        key={`${o.label}-${idx}`}
                        label={o.label}
                        value={`Rp ${fmtIDR(o.amount)}`}
                      />
                    ))
                  : mapOthers(slip)
                  ? (
                    <Row
                      label="Lainnya"
                      value={`Rp ${fmtIDR(mapOthers(slip))}`}
                    />
                  )
                  : null}

                <Sep />
                <RowStrong
                  label="Total Gaji"
                  value={`Rp ${fmtIDR(slip.total_gaji_rp)}`}
                />

                {slip.status_bayar !== "paid" && (
                  <TouchableOpacity
                    style={[
                      st.btnPrimary,
                      { marginTop: 16, paddingVertical: 10 },
                    ]}
                    onPress={() => updateSlipStatus("paid")}
                    disabled={slipStatusLoading}
                  >
                    {slipStatusLoading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={st.btnText}>
                        Tandai sudah transfer
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                {slip.status_bayar === "paid" && slip.paid_at && (
                  <Text
                    style={{
                      marginTop: 8,
                      color: C.muted,
                      fontSize: 12,
                    }}
                  >
                    Ditandai dibayar: {fmtDateTimeID(slip.paid_at)}
                  </Text>
                )}
              </View>
            )}

            {/* Hasil (ALL) */}
            {slipMode === "all" && (
              <View style={{ marginTop: 12 }}>
                {slipList.map((row) => (
                  <View key={row.id} style={st.card}>
                    <Row label="Nama" value={row.nama} />
                    <Row
                      label="Periode"
                      value={`${row.periode_start} s/d ${row.periode_end}`}
                    />
                    <Sep />
                    <Row
                      label="Absen (hari/periode)"
                      value={String(row.hadir_minggu ?? 0)}
                    />
                    <Row
                      label="Lembur (menit)"
                      value={String(row.lembur_menit ?? 0)}
                    />
                    <Row
                      label="Gaji per User"
                      value={`Rp ${fmtIDR(row.gaji_pokok_rp ?? 0)}`}
                    />
                    <Row
                      label="Angsuran"
                      value={`Rp ${fmtIDR(row.angsuran_rp ?? 0)}`}
                    />
                    {mapTHR(row) ? (
                      <Row
                        label="THR"
                        value={`Rp ${fmtIDR(mapTHR(row))}`}
                      />
                    ) : null}
                    {mapBonus(row) ? (
                      <Row
                        label="Bonus Akhir Tahun"
                        value={`Rp ${fmtIDR(mapBonus(row))}`}
                      />
                    ) : null}
                    {mapOthers(row) ? (
                      <Row
                        label="Lainnya (Total)"
                        value={`Rp ${fmtIDR(mapOthers(row))}`}
                      />
                    ) : null}
                    <Sep />
                    <RowStrong
                      label="Total Gaji"
                      value={`Rp ${fmtIDR(row.total_gaji_rp ?? 0)}`}
                    />
                  </View>
                ))}
                {(!slipList || slipList.length === 0) &&
                  !slipLoading && (
                    <Text
                      style={{
                        textAlign: "center",
                        color: C.muted,
                        marginTop: 12,
                      }}
                    >
                      Tidak ada data
                    </Text>
                  )}
              </View>
            )}
          </View>
        ) : (
          /* ====== ARSIP ====== */
          <View>
            {/* Pilih user (opsional) */}
            <Text style={st.label}>Nama (opsional)</Text>
            <TouchableOpacity
              style={st.select}
              onPress={() =>
                setUserModal({ visible: true, target: "arsip" })
              }
            >
              <Text style={st.selectTx}>
                {arsipUser ? arsipUser.nama : "Semua karyawan"}
              </Text>
            </TouchableOpacity>

            {/* Mode Periode Arsip */}
            <Text style={st.label}>Mode Periode</Text>
            <View style={st.segmentWrap}>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  arsipPeriodMode === "week" && st.segmentActive,
                ]}
                onPress={() => setArsipPeriodMode("week")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    arsipPeriodMode === "week" && st.segmentTxActive,
                  ]}
                >
                  Per Minggu
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  st.segmentBtn,
                  arsipPeriodMode === "month" && st.segmentActive,
                ]}
                onPress={() => setArsipPeriodMode("month")}
              >
                <Text
                  style={[
                    st.segmentTx,
                    arsipPeriodMode === "month" && st.segmentTxActive,
                  ]}
                >
                  Per Bulan
                </Text>
              </TouchableOpacity>
            </View>

            {/* Periode Arsip */}
            <Text style={st.label}>Periode</Text>
            {arsipPeriodMode === "week" ? (
              <>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setArsipShowStart(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(arsipStart)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.inputBtn, { flex: 1 }]}
                    onPress={() => setArsipShowEnd(true)}
                  >
                    <Text style={st.inputBtnTx}>{iso(arsipEnd)}</Text>
                  </TouchableOpacity>
                </View>
                {arsipShowStart && (
                  <DateTimePicker
                    value={arsipStart}
                    mode="date"
                    onChange={(_, d) => {
                      setArsipShowStart(false);
                      if (d) {
                        setArsipStart(startOfWeek(d));
                        setArsipEnd(endOfWeek(d));
                      }
                    }}
                  />
                )}
                {arsipShowEnd && (
                  <DateTimePicker
                    value={arsipEnd}
                    mode="date"
                    onChange={(_, d) => {
                      setArsipShowEnd(false);
                      if (d) {
                        setArsipStart(startOfWeek(d));
                        setArsipEnd(endOfWeek(d));
                      }
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={st.inputBtn}
                  onPress={() => setArsipShowMonthPicker(true)}
                >
                  <Text style={st.inputBtnTx}>
                    {monthLabelID(arsipMonthAnchor)}
                  </Text>
                </TouchableOpacity>
                {arsipShowMonthPicker && (
                  <DateTimePicker
                    value={arsipMonthAnchor}
                    mode="date"
                    onChange={(_, d) => {
                      setArsipShowMonthPicker(false);
                      if (d) {
                        setArsipMonthAnchor(d);
                        setArsipStart(startOfMonth(d));
                        setArsipEnd(endOfMonth(d));
                      }
                    }}
                  />
                )}
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: C.muted }}>
                    Rentang: {iso(arsipStart)} s/d {iso(arsipEnd)}
                  </Text>
                </View>
              </>
            )}

            <TouchableOpacity
              style={st.btnPrimary}
              onPress={loadArsip}
              disabled={arsipLoading}
            >
              {arsipLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={st.btnText}>Tampilkan Arsip</Text>
              )}
            </TouchableOpacity>

            {/* Tombol unduh */}
            {arsip.length > 0 && (
              <View
                style={{ flexDirection: "row", gap: 8, marginTop: 10 }}
              >
                <TouchableOpacity
                  style={st.btnGhost}
                  onPress={exportArsipPDF}
                >
                  <Text
                    style={[
                      st.btnGhostText,
                      { color: C.primaryDark },
                    ]}
                  >
                    Unduh PDF
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* List Arsip */}
            <View style={{ marginTop: 12 }}>
              {arsip.map((row) => (
                <View key={row.id} style={st.card}>
                  <Row label="Nama" value={row.nama} />
                  <Row
                    label="Periode"
                    value={`${row.periode_start} s/d ${row.periode_end}`}
                  />
                  <Sep />
                  <Row
                    label="Absen (hari/periode)"
                    value={String(row.hadir_minggu ?? 0)}
                  />
                  <Row
                    label="Lembur (menit)"
                    value={String(row.lembur_menit ?? 0)}
                  />
                  <Row
                    label="Gaji per User"
                    value={`Rp ${fmtIDR(row.gaji_pokok_rp ?? 0)}`}
                  />
                  <Row
                    label="Angsuran"
                    value={`Rp ${fmtIDR(row.angsuran_rp ?? 0)}`}
                  />
                  {mapTHR(row) ? (
                    <Row
                      label="THR"
                      value={`Rp ${fmtIDR(mapTHR(row))}`}
                    />
                  ) : null}
                  {mapBonus(row) ? (
                    <Row
                      label="Bonus Akhir Tahun"
                      value={`Rp ${fmtIDR(mapBonus(row))}`}
                    />
                  ) : null}
                  {mapOthers(row) ? (
                    <Row
                      label="Lainnya (Total)"
                      value={`Rp ${fmtIDR(mapOthers(row))}`}
                    />
                  ) : null}
                  <Sep />
                  <RowStrong
                    label="Total Gaji"
                    value={`Rp ${fmtIDR(row.total_gaji_rp ?? 0)}`}
                  />
                </View>
              ))}
              {(!arsip || arsip.length === 0) && !arsipLoading && (
                <Text
                  style={{
                    textAlign: "center",
                    color: C.muted,
                    marginTop: 12,
                  }}
                >
                  Tidak ada data
                </Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Modal pilih user (dipakai 3 tab) */}
      <Modal
        visible={userModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setUserModal((p) => ({ ...p, visible: false }))
        }
      >
        <View style={st.modalWrap}>
          <View style={st.modalBox}>
            <Text style={st.h2}>Pilih Karyawan</Text>
            <FlatList
              data={users}
              keyExtractor={(it) => String(it.id)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={st.userItem}
                  onPress={() => {
                    if (userModal.target === "hitung") setHitUser(item);
                    else if (userModal.target === "slip")
                      setSlipUser(item);
                    else setArsipUser(item);
                    setUserModal((p) => ({ ...p, visible: false }));
                  }}
                >
                  <Text style={{ color: C.text }}>
                    {item.nama}
                    {typeof item.gaji === "number"
                      ? ` • Rp ${fmtIDR(item.gaji)}`
                      : ""}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text
                  style={{
                    textAlign: "center",
                    padding: 12,
                    color: C.muted,
                  }}
                >
                  Tidak ada data
                </Text>
              }
            />
            <TouchableOpacity
              style={[st.btnGhost, { marginTop: 8 }]}
              onPress={() =>
                setUserModal((p) => ({ ...p, visible: false }))
              }
            >
              <Text style={st.btnGhostText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ======= Small UI helpers =======
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={st.rowVal}>{value}</Text>
    </View>
  );
}
function RowStrong({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.row}>
      <Text
        style={[st.rowLabel, { fontWeight: "700", color: C.text }]}
      >
        {label}
      </Text>
      <Text
        style={[
          st.rowVal,
          { fontWeight: "800", color: C.primaryDark },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
function Sep() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: C.border,
        marginVertical: 10,
      }}
    />
  );
}

// ======= Styles =======
const st = StyleSheet.create({
  headerWrap: {
    padding: 16,
    paddingBottom: 12,
    backgroundColor: C.primary,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  title: { fontSize: 20, fontWeight: "800", color: "#fff" },
  tabs: {
    marginTop: 12,
    flexDirection: "row",
    backgroundColor: "#ffffff26",
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  tabTx: { fontWeight: "700", color: "#eaf3ff" },
  tabTxActive: { color: C.primaryDark },
  body: { padding: 16 },
  label: { fontWeight: "700", marginTop: 10, marginBottom: 6, color: C.text },
  h3: { fontWeight: "900", color: C.text, fontSize: 15 },
  select: {
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.card,
  },
  selectTx: { color: C.text, fontWeight: "600" },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: C.primarySoft,
    borderRadius: 12,
    padding: 4,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  segmentActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 1,
  },
  segmentTx: { fontWeight: "700", color: C.muted },
  segmentTxActive: { color: C.primaryDark },
  inputBtn: {
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.card,
  },
  inputBtnTx: { color: C.text, fontWeight: "600" },
  input: {
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.card,
    color: C.text,
  },
  card: {
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.card,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 3,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
  },
  rowLabel: { color: C.muted, fontWeight: "600" },
  rowVal: { fontWeight: "700", color: C.text },
  totalBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.border,
  },
  totalLabel: { color: C.primaryDark, fontWeight: "700" },
  totalVal: { fontSize: 20, fontWeight: "800", color: C.primaryDark },
  btnPrimary: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 3,
  },
  btnText: { color: "#fff", fontWeight: "800", letterSpacing: 0.3 },
  btnGhost: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  btnGhostText: { color: C.text, fontWeight: "700" },
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalBox: {
    backgroundColor: "#fff",
    maxHeight: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  h2: { color: C.text, fontWeight: "800", fontSize: 16, marginBottom: 8 },
  userItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
});
