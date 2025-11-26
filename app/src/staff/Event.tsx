// app/src/staff/Event.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  UIManager,
  LayoutAnimation,
  Platform,
  Pressable,
  Modal,
  StatusBar,
  Image,
  FlatList, // Tambahin FlatList buat jaga2 kalau mau render list
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE as RAW_API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";
import {
  EVENT_CONFIG,
  isTodayDisciplineClaimDay,
  nextDisciplineClaimDate,
} from "../../eventConfig";

const BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};
const thisMonthKey = () => todayISO().slice(0, 7);

/* ========= types ========= */
type KerapihanItem = { item_code: string; item_name: string; point_value: number };
type KerapihanStatus = {
  date: string;
  items: KerapihanItem[];
  total_points: number;
  claimed_today?: boolean;
};

type DiscWeekly = {
  week?: { start: string; end: string };
  date: string;
  eligible: boolean;
  reason: string;
  claim: null | { points: number; status: "pending" | "approved" | "rejected" };
};

type MonthlyBar = {
  date: string;
  jam_masuk: string | null;
  jam_keluar: string | null;
  lembur: boolean;
  ok: boolean;
  reason: string | null;
};

type DiscMonthly = {
  user_id: number;
  user_name: string;
  month: string; // YYYY-MM
  target_days: number; // default 24
  progress_days: number; // 0..24
  broken: boolean;
  first_fail: string | null;
  reason: string | null;
  claimed: boolean;
  can_claim: boolean;
  bars: MonthlyBar[];
};

type DiscMeta = {
  cutoff: string; // "07:50:00"
  reward_rp?: number;
  workdays?: string[];
  range?: { start: string; end: string };
  jam_pulang_patokan?: string;
};

/* ===== Ibadah types ===== */
type IbadahWindow = {
  tz: string;
  zuhur: string;
  ashar: string;
  window_minutes: number;
};
type IbadahSlot = "zuhur" | "ashar";

/* ========= local storage keys ========= */
const LS = {
  myPoints: (uid: number) => `ev:points:${uid}`,
  discClaimedMonthlyKey: (uid: number, monthKey: string) => `ev:disc-monthly:${uid}:${monthKey}`,
  kerClaimedDate: (uid: number, date: string) => `ev:ker:${uid}:${date}`,
  ibadahClaimedDate: (uid: number, date: string) => `ev:ib:${uid}:${date}`, // value: "pending"|"approved"|"rejected"
  ibadahPhotoCache: (uid: number, date: string, slot: IbadahSlot) =>
    `ev:ib:photo:${uid}:${date}:${slot}`, // local uri
};

async function lsGetNumber(key: string, def = 0) {
  try {
    const v = await AsyncStorage.getItem(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  } catch {
    return def;
  }
}
async function lsSetNumber(key: string, n: number) {
  try {
    await AsyncStorage.setItem(key, String(n));
  } catch {}
}
async function lsGetBool(key: string) {
  try {
    return (await AsyncStorage.getItem(key)) === "1";
  } catch {
    return false;
  }
}
async function lsSetBool(key: string, val: boolean) {
  try {
    await AsyncStorage.setItem(key, val ? "1" : "0");
  } catch {}
}
async function lsGetString(key: string) {
  try {
    return (await AsyncStorage.getItem(key)) ?? null;
  } catch {
    return null;
  }
}
async function lsSetString(key: string, val: string) {
  try {
    await AsyncStorage.setItem(key, val);
  } catch {}
}

/* ====== Redeem constants ====== */
const REDEEM_RATE_IDR: number =
  (EVENT_CONFIG as any)?.REDEEM_RATE_IDR ??
  (EVENT_CONFIG as any)?.POINTS?.REDEEM_RATE_IDR ??
  1;

const REDEEM_DIVISOR = 10;
const MONTHLY_CAP_IDR = 300_000;
const AUTO_CLAIM_ON_PHOTO = true; // foto diambil => langsung auto submit

/* ===== helpers ===== */
function normOK(v: any): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "number") return v === 1;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "ok" || s === "on-time" || s === "ontime") return true;
  if (s === "0" || s === "false" || s === "fail" || s === "late" || s === "hangus") return false;
  return false;
}
function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}
function nowMinutesLocal() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export default function EventUserPage() {
  const today = useMemo(() => new Date(), []);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [openDisc, setOpenDisc] = useState(true);
  const [openKer, setOpenKer] = useState(false);
  const [openIbadah, setOpenIbadah] = useState(false);

  const [openRedeem, setOpenRedeem] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string>("");

  // myPoints = jumlah COINS (Gold) yang ditampilkan di UI
  const [myPoints, setMyPoints] = useState<number>(0);
  const redeemablePoints = useMemo(
    () => Math.floor(myPoints / REDEEM_DIVISOR),
    [myPoints]
  );
  const redeemTotalIDR = useMemo(
    () => redeemablePoints * REDEEM_RATE_IDR,
    [redeemablePoints]
  );
  const monthKey = useMemo(() => thisMonthKey(), []);

  const [monthCapUsed, setMonthCapUsed] = useState<number>(0);
  const [monthCapRemain, setMonthCapRemain] = useState<number>(MONTHLY_CAP_IDR);

  // === STATE UNTUK BADGE NAVIGASI ===
  // requestBadge: Jumlah request yang masih status "open" (misal: pending)
  const [requestBadge, setRequestBadge] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const keys = ["auth", "user", "current_user", "session"];
        let found: any = null;
        for (const k of keys) {
          const v = await AsyncStorage.getItem(k);
          if (!v) continue;
          try {
            const j = JSON.parse(v);
            if (j && typeof j === "object") {
              found = j;
              break;
            }
          } catch {}
        }
        const id =
          Number(found?.id ?? found?.user_id ?? found?.user?.id ?? found?.user?.user_id ?? 0) ||
          null;
        const name = String(
          found?.name ??
            found?.nama ??
            found?.username ??
            found?.user?.name ??
            found?.user?.username ??
            ""
        );
        if (!id) Alert.alert("Info", "Akun belum terdeteksi, silakan login ulang.");
        setUserId(id);
        setUserName(name || (id ? `User#${id}` : "User"));

        if (id) {
          const cached = await lsGetNumber(LS.myPoints(id), 0);
          setMyPoints(cached);
        }
      } catch (e: any) {
        Alert.alert("Error", e?.message || String(e));
      }
    })();
  }, []);

  const animate = () =>
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

  /* ===== KEDISIPLINAN (BULANAN 24 HARI) ===== */
  const [discMonthly, setDiscMonthly] = useState<DiscMonthly | null>(null);
  const [discMeta, setDiscMeta] = useState<DiscMeta>({ cutoff: "07:50:00" });

  const monthClaimLocalKey = useMemo(
    () => (userId ? LS.discClaimedMonthlyKey(userId, monthKey) : null),
    [userId, monthKey]
  );

  const canClaimMonthly = useMemo(() => {
    if (!discMonthly) return false;
    return discMonthly.can_claim === true;
  }, [discMonthly]);

  const discStatusText = useMemo(() => {
    if (!discMonthly) return "-";
    if (discMonthly.broken) {
      return discMonthly.reason
        ? `Status: HANGUS (${discMonthly.reason})`
        : "Status: HANGUS bulan ini";
    }
    return `Berjalan: ${discMonthly.progress_days}/${discMonthly.target_days || 24}`;
  }, [discMonthly]);

  const fetchDisciplineMonthly = useCallback(async () => {
    if (!userId) return;
    try {
      const url = `${BASE}event/kedisiplinan.php?action=monthly_progress&user_id=${userId}&month=${monthKey}`;
      const r = await fetch(url);
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) throw new Error(j?.message || "Gagal memuat progress bulanan.");

      const data = j.data as DiscMonthly;
      const meta = (j.meta || {}) as any;

      const bars = Array.isArray(data?.bars)
        ? data.bars.map((b: any) => ({
            ...b,
            ok: normOK(b?.ok),
          }))
        : [];

      if (monthClaimLocalKey) {
        const cached = await lsGetBool(monthClaimLocalKey);
        if (cached && !data.claimed) data.claimed = true;
      }

      setDiscMonthly({ ...data, bars });
      setDiscMeta({
        cutoff: meta?.on_time_max || meta?.cutoff || "07:50:00",
        reward_rp: meta?.reward_rp,
        workdays: meta?.workdays,
        range: meta?.range,
        jam_pulang_patokan: meta?.jam_pulang_patokan,
      });
    } catch (e: any) {
      setDiscMonthly(null);
      Alert.alert("Kedisiplinan", e?.message || "Gagal ambil status bulanan.");
    }
  }, [userId, monthKey, monthClaimLocalKey]);

  const claimDisciplineMonthly = useCallback(async () => {
    if (!userId || !canClaimMonthly) return;
    try {
      setLoading(true);
      const r = await fetch(
        `${BASE}event/kedisiplinan.php?action=submit_monthly`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            claimed_by: userId,
            month: monthKey,
          }),
        }
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) {
        const title = j?.severity === "warning" ? "Peringatan" : "Error";
        return Alert.alert(title, j?.message || "Gagal submit klaim bulanan.");
      }

      if (monthClaimLocalKey) await lsSetBool(monthClaimLocalKey, true);

      if (typeof j?.data?.points_rp === "number") {
        await fetchMyPoints(); // reload saldo Gold dari server biar sinkron
      }

      await fetchDisciplineMonthly();
      Alert.alert(
        "Klaim terkirim 🎉",
        "Status: pending. Menunggu verifikasi admin."
      );
    } catch (e: any) {
      Alert.alert("Gagal klaim", e?.message || "Submit klaim gagal.");
    } finally {
      setLoading(false);
    }
  }, [
    userId,
    canClaimMonthly,
    monthKey,
    monthClaimLocalKey,
    fetchDisciplineMonthly,
  ]);

  /* ===== WEEKLY (legacy info) ===== */
  const [discWeekly, setDiscWeekly] = useState<DiscWeekly | null>(null);
  const canClaimToday = useMemo(
    () => isTodayDisciplineClaimDay(today),
    [today]
  );
  const nextClaimStr = useMemo(() => {
    const d = nextDisciplineClaimDate(today);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  }, [today]);
  const fetchDisciplineWeekly = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        `${BASE}event/kedisiplinan.php?action=check&user_id=${userId}&date=${todayISO()}`
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      setDiscWeekly(j?.success ? (j.data as DiscWeekly) : null);
    } catch {
      setDiscWeekly(null);
    }
  }, [userId]);

  /* ===== KERAPIHAN ===== */
  const [kerItems, setKerItems] = useState<KerapihanItem[]>([]);
  const [kerChecked, setKerChecked] = useState<Record<string, true>>({});
  const [kerTotal, setKerTotal] = useState(0);
  const [kerClaimedToday, setKerClaimedToday] = useState<boolean>(false);

  const fetchKerapihan = useCallback(async () => {
    if (!userId) return;
    try {
      const a = await fetch(`${BASE}event/kerapihan.php?action=items`);
      const at = await a.text();
      let aj: any;
      try {
        aj = JSON.parse(at);
      } catch {
        throw new Error(at);
      }
      const all: KerapihanItem[] =
        aj?.success && Array.isArray(aj?.data)
          ? aj.data
              .map((raw: any) => ({
                item_code: String(raw.item_code ?? ""),
                item_name: String(raw.item_name ?? ""),
                point_value: Number(raw.point_value ?? 0),
              }))
              .filter((it: KerapihanItem) => !!it.item_code)
          : [];

      const b = await fetch(
        `${BASE}event/kerapihan.php?action=user_status&user_id=${userId}&date=${todayISO()}`
      );
      const bt = await b.text();
      let bj: any;
      try {
        bj = JSON.parse(bt);
      } catch {
        throw new Error(bt);
      }

      const checkedMap: Record<string, true> = {};
      let tpoints = 0;
      let claimedFlag = false;
      if (bj?.success) {
        const data = bj.data as KerapihanStatus;
        const items = Array.isArray(data?.items) ? data.items : [];
        items.forEach((it: any) => {
          checkedMap[String(it.item_code)] = true;
          tpoints += Number(it.point_value ?? 0);
        });
        claimedFlag = !!data?.claimed_today;
      }

      const cachedClaimed = await lsGetBool(
        LS.kerClaimedDate(userId, todayISO())
      );
      if (cachedClaimed) claimedFlag = true;

      setKerItems(all);
      setKerChecked(checkedMap);
      setKerTotal(tpoints);
      setKerClaimedToday(claimedFlag);
    } catch {
      setKerItems([]);
      setKerChecked({});
      setKerTotal(0);
      setKerClaimedToday(false);
    }
  }, [userId]);

  const kerButtonLabel = useMemo(() => {
    if (kerClaimedToday) return "Sudah Diklaim";
    if (kerTotal > 0) return "Klaim Poin";
    return "Belum Ada Misi";
  }, [kerTotal, kerClaimedToday]);

  const kerButtonDisabled = useMemo(() => {
    if (kerClaimedToday) return true;
    if (kerTotal <= 0) return true;
    return !userId || loading;
  }, [kerTotal, kerClaimedToday, userId, loading]);

  const claimKerapihan = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const r = await fetch(`${BASE}event/kerapihan.php?action=claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, date: todayISO() }),
      });
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) {
        const title = j?.severity === "warning" ? "Peringatan" : "Error";
        return Alert.alert(title, j?.message || "Gagal klaim poin kerapihan.");
      }

      const gained = Number(j?.data?.points || kerTotal || 0);

      await lsSetBool(LS.kerClaimedDate(userId, todayISO()), true);
      const next = (await lsGetNumber(LS.myPoints(userId), 0)) + gained;
      await lsSetNumber(LS.myPoints(userId), next);
      setMyPoints(next);

      setKerClaimedToday(true);
      Alert.alert("Berhasil 🎉", `Klaim kerapihan berhasil (+${gained}).`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal klaim.");
    } finally {
      setLoading(false);
    }
  }, [userId, kerTotal]);

  /* ===== IBADAH (Zuhur & Ashar) ===== */
  const [ibadahStatus, setIbadahStatus] = useState<
    "none" | "pending" | "approved" | "rejected"
  >("none");
  const [ibadahWin, setIbadahWin] = useState<IbadahWindow | null>(null);
  const [activeSlot, setActiveSlot] = useState<IbadahSlot>("zuhur");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchIbadahWindow = useCallback(async () => {
    try {
      const r = await fetch(
        `${BASE}event/ibadah.php?action=times&date=${todayISO()}`
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) throw new Error(j?.message || "Gagal ambil jadwal.");

      const d = j.data; // { tz, date, zuhur:{start,end,window_min}, ashar:{...} }
      const hhmm = (s: string) => s.slice(11, 16); // "YYYY-MM-DD HH:mm:ss" -> "HH:mm"
      setIbadahWin({
        tz: d.tz || "Asia/Jakarta",
        zuhur: hhmm(d.zuhur.start),
        ashar: hhmm(d.ashar.start),
        window_minutes: Number(
          d.zuhur?.window_min ?? d.ashar?.window_min ?? 20
        ),
      });
    } catch (e: any) {
      setIbadahWin(null);
      Alert.alert("Ibadah", e?.message || "Gagal ambil jadwal.");
    }
  }, []);

  const fetchIbadahStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const cached = await lsGetString(
        LS.ibadahClaimedDate(userId, todayISO())
      );
      if (cached) setIbadahStatus((cached as any) || "pending");
      else setIbadahStatus("none");

      // Preload foto lokal (kalau belum diupload karena koneksi)
      const pZu = await lsGetString(
        LS.ibadahPhotoCache(userId, todayISO(), "zuhur")
      );
      const pAs = await lsGetString(
        LS.ibadahPhotoCache(userId, todayISO(), "ashar")
      );
      if (activeSlot === "zuhur" && pZu) setPhotoUri(pZu);
      if (activeSlot === "ashar" && pAs) setPhotoUri(pAs);
    } catch {
      setIbadahStatus("none");
    }
  }, [userId, activeSlot]);

  // hitung “boleh klaim?” utk slot aktif
  const withinWindow = useMemo(() => {
    if (!ibadahWin) return false;
    const minutesNow = nowMinutesLocal();
    const start =
      activeSlot === "zuhur"
        ? toMinutes(ibadahWin.zuhur)
        : toMinutes(ibadahWin.ashar);
    const end = start + (ibadahWin.window_minutes || 20);
    return minutesNow >= start && minutesNow <= end;
  }, [ibadahWin, activeSlot]);

  const windowLabel = useMemo(() => {
    if (!ibadahWin) return "-";
    const hhmm = activeSlot === "zuhur" ? ibadahWin.zuhur : ibadahWin.ashar;
    const start = toMinutes(hhmm);
    const end = start + (ibadahWin.window_minutes || 20);
    const pad = (n: number) => String(n).padStart(2, "0");
    const toHHMM = (m: number) =>
      `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    return `adzan ${hhmm} • window ${toHHMM(start)}–${toHHMM(end)}`;
  }, [ibadahWin, activeSlot]);

  const submitIbadahPhoto = useCallback(
    async (overrideUri?: string, silent = false) => {
      if (!userId) return;
      if (!ibadahWin) {
        if (!silent) Alert.alert("Ibadah", "Jadwal belum termuat.");
        return;
      }
      if (!withinWindow) {
        if (!silent)
          Alert.alert("Ibadah", "Di luar jendela 20 menit setelah adzan.");
        return;
      }
      const uri = overrideUri ?? photoUri;
      if (!uri) {
        if (!silent) Alert.alert("Ibadah", "Ambil/unggah foto dulu.");
        return;
      }

      try {
        setUploading(true);
        const fd = new FormData();
        fd.append("user_id", String(userId));
        fd.append("date", todayISO());
        fd.append("prayer", activeSlot as string);
        // @ts-ignore rn
        fd.append("photo", {
          uri,
          name: `ibadah-${activeSlot}.jpg`,
          type: "image/jpeg",
        });

        const r = await fetch(`${BASE}event/ibadah.php?action=submit`, {
          method: "POST",
          body: fd, // jangan set Content-Type manual
        });
        const t = await r.text();
        let j: any;
        try {
          j = JSON.parse(t);
        } catch {
          throw new Error(t);
        }

        if (!j?.success) {
          const msg = j?.message || "Upload gagal.";
          if (!silent) Alert.alert("Ibadah", msg);
          return;
        }

        await lsSetString(
          LS.ibadahClaimedDate(userId, todayISO()),
          "pending"
        );
        setIbadahStatus("pending");

        // bersihkan cache foto slot ini (biar ga dobel)
        await lsSetString(
          LS.ibadahPhotoCache(userId, todayISO(), activeSlot),
          ""
        );

        if (!silent)
          Alert.alert("Berhasil 🎉", "Bukti ibadah terkirim (pending).");
      } catch (e: any) {
        if (!silent)
          Alert.alert("Ibadah", e?.message || "Gagal mengunggah foto.");
      } finally {
        setUploading(false);
      }
    },
    [userId, ibadahWin, withinWindow, photoUri, activeSlot]
  );

  const pickFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      return Alert.alert(
        "Izin kamera",
        "Aplikasi butuh akses kamera untuk ambil foto."
      );
    }

    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
      exif: false,
      base64: false,
    });

    if (!res.canceled && res.assets?.[0]?.uri) {
      const uri = res.assets[0].uri;
      setPhotoUri(uri);
      if (userId) {
        await lsSetString(
          LS.ibadahPhotoCache(userId, todayISO(), activeSlot),
          uri
        );
      }

      // AUTO CLAIM: kalau lagi dalam window, langsung submit diam-diam
      if (AUTO_CLAIM_ON_PHOTO) {
        if (withinWindow) {
          // silent=true -> tanpa Alert sukses (biar mulus)
          submitIbadahPhoto(uri, true);
        } else {
          Alert.alert(
            "Di luar jendela",
            "Foto tersimpan. Kirim saat jendelanya buka."
          );
        }
      }
    }
  }, [activeSlot, userId, withinWindow, submitIbadahPhoto]);

  /* ===== Poin/Koin ===== */
  const fetchMyPoints = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        `${BASE}event/points.php?action=get&user_id=${userId}`
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (j?.success) {
        const serverCoins = Number(j?.data?.coins ?? 0);
        setMyPoints(serverCoins);
        await lsSetNumber(LS.myPoints(userId), serverCoins);
      } else {
        const cached = await lsGetNumber(LS.myPoints(userId), 0);
        setMyPoints(cached);
      }
    } catch {
      const cached = await lsGetNumber(LS.myPoints(userId), 0);
      setMyPoints(cached);
    }
  }, [userId]);

  const fetchMonthCap = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        `${BASE}event/points.php?action=month_cap&user_id=${userId}&month_key=${monthKey}`
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (j?.success) {
        const used = Number(j?.data?.used_idr ?? 0);
        const remain = Number(j?.data?.remain_idr ?? MONTHLY_CAP_IDR);
        setMonthCapUsed(used);
        setMonthCapRemain(remain);
      }
    } catch {}
  }, [userId, monthKey]);

  // === HITUNG BADGE EVENT (Request Status) ===
  const fetchEventBadge = useCallback(async () => {
    if (!userId) return;
    try {
        // status=open -> Pending + Approved + Rejected (yang belum admin_done)
        const r = await fetch(`${BASE}event/points.php?action=requests&user_id=${userId}&status=open`);
        const t = await r.text();
        let j: any;
        try { j = JSON.parse(t); } catch { return; }
        
        if (j?.success && Array.isArray(j?.data)) {
            // Kita simpan jumlah request yang open
            setRequestBadge(j.data.length);
        } else {
            setRequestBadge(0);
        }
    } catch {}
  }, [userId]);

  // === LOGIC UTAMA: Gabungkan Badge Request + Kerapihan yang belum diklaim ===
  const finalBadge = useMemo(() => {
    let count = requestBadge;

    // Kalau ada poin Kerapihan dari admin (kerTotal > 0) 
    // TAPI user belum klaim (!kerClaimedToday)
    // Berarti ini notifikasi penting buat user -> Tambah 1 ke badge
    if (kerTotal > 0 && !kerClaimedToday) {
        count += 1;
    }

    return count;
  }, [requestBadge, kerTotal, kerClaimedToday]);

  const preload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    await Promise.allSettled([
      fetchDisciplineMonthly(),
      fetchDisciplineWeekly(),
      fetchKerapihan(),
      fetchIbadahStatus(),
      fetchIbadahWindow(),
      fetchMyPoints(),
      fetchMonthCap(),
      fetchEventBadge(),
    ]);
    setLoading(false);
  }, [
    userId,
    fetchDisciplineMonthly,
    fetchDisciplineWeekly,
    fetchKerapihan,
    fetchIbadahStatus,
    fetchIbadahWindow,
    fetchMyPoints,
    fetchMonthCap,
    fetchEventBadge,
  ]);

  useEffect(() => {
    if (userId) preload();
  }, [userId, preload]);

  useEffect(() => {
    // ganti slot → coba load foto cache slot tsb
    (async () => {
      if (!userId) return;
      const cached = await lsGetString(
        LS.ibadahPhotoCache(userId, todayISO(), activeSlot)
      );
      setPhotoUri(cached);
    })();
  }, [activeSlot, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await preload();
    setRefreshing(false);
  }, [preload]);

  /* ===== UI helpers ===== */
  const discPct = useMemo(() => {
    const ok = Number(discMonthly?.progress_days ?? 0);
    const tot = Number(discMonthly?.target_days ?? 24) || 24;
    return Math.max(0, Math.min(100, Math.round((ok / tot) * 100)));
  }, [discMonthly]);

  const kerCounts = useMemo(() => {
    const total = kerItems.length;
    const done = kerItems.reduce(
      (n, it) => n + (kerChecked[it.item_code] ? 1 : 0),
      0
    );
    return {
      total,
      done,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }, [kerItems, kerChecked]);

  const ibadahBadge = useMemo(() => {
    switch (ibadahStatus) {
      case "approved":
        return { label: "Approved", color: "#16a34a", bg: "#dcfce7" };
      case "pending":
        return { label: "Pending", color: "#b45309", bg: "#fef3c7" };
      case "rejected":
        return { label: "Rejected", color: "#b91c1c", bg: "#fee2e2" };
      default:
        return { label: "Belum Klaim", color: "#334155", bg: "#e2e8f0" };
    }
  }, [ibadahStatus]);

  const doConvertNow = useCallback(async () => {
    if (!userId) return;

    let serverCoins = 0;
    let serverPoints: number | null = null;

    try {
      const url = `${BASE}event/points.php?action=get&user_id=${userId}`;
      const r0 = await fetch(url);
      const t0 = await r0.text();

      console.log("URL GET POINTS:", url);
      console.log("RAW GET POINTS RESPONSE:", t0);

      const j0 = JSON.parse(t0);
      console.log("PARSED JSON POINTS:", j0);

      if (j0?.success) {
        serverCoins = Number(j0?.data?.coins ?? 0);
        const rawPoints = (j0 as any)?.data?.points;
        serverPoints =
          rawPoints !== undefined && rawPoints !== null
            ? Number(rawPoints)
            : null;

        await lsSetNumber(LS.myPoints(userId), serverCoins);
        setMyPoints(serverCoins);
      }
    } catch (e) {
      console.log("err get points:", e);
    }

    // kalau serverPoints valid & > 0, pakai itu
    // kalau tidak, turunkan dari coins: 10 koin = 1 poin
    let latestPoints: number;
    if (
      serverPoints !== null &&
      Number.isFinite(serverPoints) &&
      serverPoints > 0
    ) {
      latestPoints = serverPoints;
    } else {
      latestPoints = Math.floor(serverCoins / REDEEM_DIVISOR);
    }

    // hormati CAP bulanan (DIBYPASS DI FRONTEND, TAPI BACKEND JUGA UDAH DI-UNLOCK)
    const effectivePoints = latestPoints; 

    if (effectivePoints <= 0) {
      return Alert.alert(
         "Info",
         "Poin kamu belum cukup (minimal 10 koin = 1 poin tukar)."
      );
    }

    Alert.alert(
      "Konfirmasi",
      `Tukar ${effectivePoints} poin menjadi SALDOKU senilai Rp ${(effectivePoints * REDEEM_RATE_IDR).toLocaleString(
        "id-ID"
      )}?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Ya, Tukarkan",
          style: "destructive",
          onPress: async () => {
            try {
              setRedeeming(true);
              const r = await fetch(
                `${BASE}event/points.php?action=convert`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    user_id: userId,
                    points: effectivePoints,
                    rate_idr: REDEEM_RATE_IDR,
                  }),
                }
              );
              const t = await r.text();
              const j = JSON.parse(t);

              console.log("convert =>", j); // DEBUG

              if (!j?.success) {
                return Alert.alert(
                  "Gagal",
                  j?.message ||
                    "Poin kurang / saldo tidak cukup. Silakan refresh saldo."
                );
              }

              const coinsAfter = Number(
                j?.data?.coins_after ??
                  serverCoins - effectivePoints * REDEEM_DIVISOR
              );

              await lsSetNumber(LS.myPoints(userId), coinsAfter);
              setMyPoints(coinsAfter);
              setOpenRedeem(false);
              
              // Refresh badge setelah request sukses
              fetchEventBadge();

              Alert.alert("Berhasil 🎉", "Poin berhasil ditukar ke SALDOKU.");
            } catch (e: any) {
              Alert.alert("Gagal", e?.message || "Tukar poin gagal.");
            } finally {
              setRedeeming(false);
            }
          },
        },
      ]
    );
  }, [userId, monthCapRemain, fetchEventBadge]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#f5f6fa",
        paddingTop: Platform.OS === "android" ? StatusBar?.currentHeight ?? 0 : 0,
      }}
    >
      <StatusBar
        translucent
        backgroundColor="#f5f6fa"
        barStyle="dark-content"
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.headerTitle}>Event</Text>
        <Text style={styles.subText}>
          Halo, {userName || "-"} — semangat kumpulin bonusnya!
        </Text>

        {/* Ringkasan poin/koin + button redeem */}
        <View style={styles.pointsBar}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flex: 1,
            }}
          >
            <MaterialCommunityIcons
              name="medal"
              size={20}
              color="#D4AF37"
            />
            <Text style={styles.pointsText}>
              <Text style={{ fontWeight: "900" }}>{myPoints}</Text> Gold
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setOpenRedeem(true)}
            style={styles.redeemBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.redeemBtnTx}>Tukarkan Poin</Text>
          </TouchableOpacity>
        </View>

        {/* Kedisiplinan */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardHead}
            onPress={() => {
              animate();
              setOpenDisc((v) => !v);
            }}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name="alarm-check"
                size={40}
                color="#9C27B0"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Kedisiplinan (Bulanan)</Text>
              <Text style={styles.headHint}>
                Patokan masuk: {discMeta.cutoff || "07:50:00"} • Bulan{" "}
                {monthKey}
              </Text>
            </View>
            <Ionicons
              name={openDisc ? "chevron-up" : "chevron-down"}
              size={22}
              color="#64748b"
            />
          </Pressable>

          {openDisc && (
            <View style={styles.cardBody}>
              {!discMonthly ? (
                <ActivityIndicator />
              ) : (
                <>
                  <Text style={styles.progress}>
                    Progress:{" "}
                    <Text style={{ fontWeight: "900" }}>
                      {discMonthly.progress_days}/
                      {discMonthly.target_days || 24}
                    </Text>
                  </Text>

                  <View style={{ marginBottom: 6 }}>
                    <View style={styles.linearWrap}>
                      <View
                        style={[
                          styles.linearFill,
                          { width: `${discPct}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.linearTx}>
                      {discPct}% tercapai
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.status,
                      discMonthly.broken && { color: "#b91c1c" },
                    ]}
                  >
                    {discStatusText}
                  </Text>

                  <TouchableOpacity
                    style={[
                      styles.btn,
                      {
                        backgroundColor: discMonthly.broken
                          ? "#e5e7eb"
                          : canClaimMonthly && !discMonthly.claimed
                          ? "#9C27B0"
                          : "#cbd5e1",
                        marginTop: 8,
                      },
                    ]}
                    disabled={
                      discMonthly.broken ||
                      !canClaimMonthly ||
                      discMonthly.claimed ||
                      loading
                    }
                    onPress={claimDisciplineMonthly}
                  >
                    <Text
                      style={[
                        styles.btnTxt,
                        discMonthly.broken && { color: "#475569" },
                      ]}
                    >
                      {discMonthly.broken
                        ? "Bulan ini hangus"
                        : discMonthly.claimed
                        ? "Klaim Terkirim"
                        : canClaimMonthly
                        ? "KLAIM Rp300.000"
                        : "Belum Bisa Klaim"}
                    </Text>
                  </TouchableOpacity>

                  {discMeta?.range?.start &&
                  discMeta?.range?.end ? (
                    <Text style={styles.metaInfo}>
                      Range kerja: {discMeta.range.start} s/d{" "}
                      {discMeta.range.end}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          )}
        </View>

        {/* Kerapihan */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardHead}
            onPress={() => {
              animate();
              const next = !openKer;
              setOpenKer(next);
              if (next) fetchKerapihan();
            }}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name="broom"
                size={40}
                color="#4CAF50"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Kerapihan</Text>
              <Text style={styles.headHint}>
                {openKer ? "Sembunyikan" : "Tampilkan"} misi hari ini
              </Text>
            </View>
            <Ionicons
              name={openKer ? "chevron-up" : "chevron-down"}
              size={22}
              color="#64748b"
            />
          </Pressable>

          {openKer && (
            <View style={styles.cardBody}>
              {loading ? (
                <ActivityIndicator />
              ) : kerItems.length === 0 ? (
                <Text style={styles.desc}>
                  Belum ada misi aktif yang diset.
                </Text>
              ) : (
                <>
                  <View style={{ marginBottom: 8 }}>
                    <Text
                      style={{
                        color: "#0D47A1",
                        fontWeight: "700",
                      }}
                    >
                      Progres: {kerCounts.done}/{kerCounts.total} item (
                      {kerCounts.pct}%)
                    </Text>
                    <View style={styles.linearWrap}>
                      <View
                        style={[
                          styles.linearFillSecondary,
                          { width: `${kerCounts.pct}%` },
                        ]}
                      />
                    </View>
                  </View>

                  {kerItems.map((it) => {
                    const done = !!kerChecked[it.item_code];
                    return (
                      <Text
                        key={it.item_code}
                        style={styles.bullet}
                      >
                        {done ? "✅" : "•"} {it.item_name}
                      </Text>
                    );
                  })}
                  <Text style={styles.total}>
                    Total poin tersetujui hari ini: {kerTotal}
                  </Text>
                </>
              )}

              <TouchableOpacity
                style={[
                  styles.btn,
                  {
                    backgroundColor: kerButtonDisabled
                      ? "#cbd5e1"
                      : "#4CAF50",
                    marginTop: 8,
                  },
                ]}
                disabled={kerButtonDisabled}
                onPress={claimKerapihan}
              >
                <Text style={styles.btnTxt}>{kerButtonLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Ibadah (Zuhur & Ashar, window 20 menit + foto) */}
        <View style={styles.card}>
          <Pressable
            style={styles.cardHead}
            onPress={() => {
              animate();
              setOpenIbadah((v) => !v);
            }}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name="hands-pray"
                size={40}
                color="#FF9800"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Ibadah</Text>
              <Text style={styles.headHint}>
                {openIbadah ? "Sembunyikan" : "Tampilkan"} form klaim
                (foto)
              </Text>
            </View>
            <Ionicons
              name={openIbadah ? "chevron-up" : "chevron-down"}
              size={22}
              color="#64748b"
            />
          </Pressable>

          {openIbadah && (
            <View style={styles.cardBody}>
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 999,
                  backgroundColor: ibadahBadge.bg,
                  marginTop: 4,
                  marginBottom: 6,
                }}
              >
                <Text
                  style={{
                    color: ibadahBadge.color,
                    fontWeight: "900",
                    fontSize: 12,
                  }}
                >
                  {ibadahBadge.label}
                </Text>
              </View>

              <Text style={styles.desc}>
                Klaim partisipasi ibadah Zuhur & Ashar hanya bisa dalam
                waktu {ibadahWin?.window_minutes ?? 20} menit setelah
                adzan setempat.
              </Text>

              {/* pilih slot */}
              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <TouchableOpacity
                  style={[
                    styles.btnSmall,
                    activeSlot === "zuhur"
                      ? styles.btnSmallActive
                      : styles.btnSmallIdle,
                  ]}
                  onPress={() => setActiveSlot("zuhur")}
                >
                  <Text
                    style={
                      activeSlot === "zuhur"
                        ? styles.btnSmallTxActive
                        : styles.btnSmallTx
                    }
                  >
                    Zuhur
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.btnSmall,
                    activeSlot === "ashar"
                      ? styles.btnSmallActive
                      : styles.btnSmallIdle,
                  ]}
                  onPress={() => setActiveSlot("ashar")}
                >
                  <Text
                    style={
                      activeSlot === "ashar"
                        ? styles.btnSmallTxActive
                        : styles.btnSmallTx
                    }
                  >
                    Ashar
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.status}>
                Waktu: {ibadahWin ? windowLabel : "Memuat jadwal..."}
              </Text>
              <Text
                style={[
                  styles.status,
                  {
                    color: withinWindow ? "#16a34a" : "#b91c1c",
                  },
                ]}
              >
                {withinWindow
                  ? "Dalam jendela klaim ✅"
                  : "Di luar jendela klaim ❌"}
              </Text>

              {/* preview foto */}
              {photoUri ? (
                <View
                  style={{
                    marginTop: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <Image
                    source={{ uri: photoUri }}
                    style={{
                      width: 180,
                      height: 240,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#E3ECFF",
                    }}
                  />
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 8,
                      marginTop: 8,
                    }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        { backgroundColor: "#6B7A90" },
                      ]}
                      onPress={pickFromCamera}
                    >
                      <Text style={styles.btnTxt}>Ganti Foto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        {
                          backgroundColor:
                            withinWindow && !uploading
                              ? "#FF9800"
                              : "#cbd5e1",
                        },
                      ]}
                      onPress={() => submitIbadahPhoto()}
                      disabled={!withinWindow || uploading}
                    >
                      <Text style={styles.btnTxt}>
                        {uploading
                          ? "Mengunggah..."
                          : "Kirim Bukti"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.btn,
                    { backgroundColor: "#FF9800", marginTop: 10 },
                  ]}
                  onPress={pickFromCamera}
                >
                  <Text style={styles.btnTxt}>Ambil Foto</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal Redeem */}
      <Modal
        transparent
        visible={openRedeem}
        animationType="fade"
        onRequestClose={() => setOpenRedeem(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setOpenRedeem(false)}
        />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Tukarkan Poin</Text>

          <View style={styles.sheetRow}>
            <Text style={styles.sheetLabel}>Koin kamu</Text>
            <Text style={styles.sheetVal}>{myPoints}</Text>
          </View>
          <View style={styles.sheetRow}>
            <Text style={styles.sheetLabel}>Faktor pembagi</Text>
            <Text style={styles.sheetVal}>{REDEEM_DIVISOR}</Text>
          </View>
          <View style={styles.sheetRow}>
            <Text style={styles.sheetLabel}>Poin yang ditukar</Text>
            <Text style={styles.sheetVal}>{redeemablePoints}</Text>
          </View>
          <View style={styles.sheetRow}>
            <Text style={styles.sheetLabel}>Rate</Text>
            <Text style={styles.sheetVal}>
              Rp {REDEEM_RATE_IDR.toLocaleString("id-ID")} / poin
            </Text>
          </View>

          <View
            style={[
              styles.sheetRow,
              {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderColor: "#e5e7eb",
                paddingTop: 10,
              },
            ]}
          >
            <Text
              style={[styles.sheetLabel, { fontWeight: "900" }]}
            >
              Total
            </Text>
            <Text
              style={[
                styles.sheetVal,
                { fontWeight: "900", color: "#0A84FF" },
              ]}
            >
              Rp {redeemTotalIDR.toLocaleString("id-ID")}
            </Text>
          </View>

          <View
            style={{ flexDirection: "row", gap: 10, marginTop: 14 }}
          >
            <TouchableOpacity
              style={[
                styles.btn,
                { backgroundColor: "#e5e7eb", flex: 1 },
              ]}
              onPress={() => setOpenRedeem(false)}
              disabled={redeeming}
            >
              <Text
                style={[styles.btnTxt, { color: "#0B1A33" }]}
              >
                Batal
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                {
                  backgroundColor:
                    redeemablePoints > 0 ? "#0A84FF" : "#cbd5e1",
                  flex: 1,
                },
              ]}
              disabled={redeemablePoints <= 0 || redeeming}
              onPress={doConvertNow}
            >
              <Text style={styles.btnTxt}>
                {redeeming ? "Memproses..." : "Tukarkan"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <BottomNavbar 
        preset="user" 
        active="center" 
        config={{
            // Pakai finalBadge yang udah pinter (gabungan request + kerapihan)
           center: { badge: finalBadge > 0 ? finalBadge : undefined }
        }}
      />
    </View>
  );
}

/* =================== Styles =================== */
const styles = StyleSheet.create({
  headerTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1E88E5",
    marginBottom: 6,
  },
  subText: { color: "#757575", marginBottom: 16 },

  pointsBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E8F1FF",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D9E7FF",
    marginBottom: 12,
  },
  pointsText: { color: "#0B1A33", fontWeight: "700" },

  redeemBtn: {
    backgroundColor: "#0A84FF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    shadowColor: "#0A84FF",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10,
    elevation: 2,
  },
  redeemBtnTx: { color: "#fff", fontWeight: "900" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    marginBottom: 15,
    elevation: 2,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 6,
  },
  headHint: { color: "#64748b", fontSize: 12 },
  cardBody: { paddingLeft: 72, paddingBottom: 8, paddingTop: 6 },

  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 15,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  title: { fontSize: 16, fontWeight: "bold", color: "#212121" },
  desc: { color: "#757575", fontSize: 13, marginTop: 2, marginBottom: 8 },

  progress: {
    color: "#0D47A1",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },

  status: { color: "#0D47A1", fontSize: 12, fontWeight: "700", marginTop: 4 },

  btn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },

  bullet: { fontSize: 13, color: "#374151", marginBottom: 2 },
  total: {
    fontSize: 13,
    color: "#0D47A1",
    fontWeight: "700",
    marginTop: 6,
  },

  metaInfo: { color: "#6B7A90", fontSize: 12, marginTop: 6 },

  modalBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  sheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 100,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 20,
    elevation: 10,
  },
  sheetTitle: {
    fontWeight: "900",
    color: "#0B1A33",
    fontSize: 16,
    marginBottom: 10,
  },
  sheetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  sheetLabel: { color: "#6B7A90" },
  sheetVal: { color: "#0B1A33", fontWeight: "800" },

  linearWrap: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#E6ECF5",
    overflow: "hidden",
    marginTop: 2,
  },
  linearFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#12B886",
  },
  linearFillSecondary: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#4CAF50",
  },
  linearTx: {
    color: "#0B1A33",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },

  btnSmall: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  btnSmallIdle: {
    backgroundColor: "#fff",
    borderColor: "#E3ECFF",
  },
  btnSmallActive: {
    backgroundColor: "#0A84FF",
    borderColor: "#0A84FF",
  },
  btnSmallTx: {
    color: "#0B1A33",
    fontWeight: "800",
    fontSize: 12,
  },
  btnSmallTxActive: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
  },
});