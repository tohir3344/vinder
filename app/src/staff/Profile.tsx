// app/user/Profile.tsx
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native"; // IMPORT INI PENTING
import { API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";
import AppInfoModal from "../../_components/AppInfoModal";

/**
 * Jika server foto masih http://, tambahkan pada app.json:
 * {
 * "expo": { "android": { "usesCleartextTraffic": true } }
 * }
 */

/* ===== KONFIGURASI ===== */
const MIN_WITHDRAW = 500000; // 🔥 Minimal Withdraw 500 Ribu

/* ===== URL helper singkat ===== */
const url = (p: string) =>
  (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

// Helper tanggal buat badge logic
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
};

/* ===== Origin dari API_BASE (https://domain.tld) ===== */
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin; // contoh: https://domain.com
  } catch {
    const m = String(API_BASE).match(/^https?:\/\/[^/]+/i);
    return m ? m[0] : "";
  }
})();

function buildImageUrl(raw?: string | null) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || v.toLowerCase() === "null" || v.toLowerCase() === "undefined") {
    return null;
  }

  // Kalau sudah absolut (http/https/file), pakai apa adanya
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) {
    return encodeURI(v);
  }

  // Relatif → gabungkan ke API_BASE (karena uploads memang di bawah /penggajian/api/)
  const clean = v.replace(/^\.?\/*/, "");
  const base = (API_BASE || "").replace(/\/+$/, "");
  return encodeURI(`${base}/${clean}`);
}

/* ===== Debug helpers ===== */
async function fetchWithTimeout(
  u: string,
  opt: RequestInit = {},
  ms = 5000
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(u, { ...opt, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function probeUrl(u?: string | null) {
  if (!u) return "—";
  try {
    // HEAD sering diblok beberapa server, pakai GET ringan saja
    const r = await fetchWithTimeout(u, { method: "GET" }, 6000);
    return `${r.status} ${r.ok ? "OK" : "ERR"}`;
  } catch (e: any) {
    return `ERR ${e?.message || "fetch failed"}`;
  }
}

/* ===== Types ===== */
type AuthShape = {
  id?: number | string;
  user_id?: number | string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
};

type UserDetail = {
  id?: number | string;
  username?: string;
  nama_lengkap?: string;
  tempat_lahir?: string;
  tanggal_lahir?: string;
  email?: string;
  no_telepon?: string;
  alamat?: string;
  role?: string;
  masa_kerja?: string;
  foto?: string | null;
  created_at?: string; // tanggal dibuat di sistem
  tanggal_masuk?: string; // ⭐ tanggal mulai kerja sebenarnya (bisa lama)
};

type WDStatus = "none" | "pending" | "approved" | "rejected";

/* ===== Hitung selisih tahun/bulan/hari pakai kalender beneran ===== */
function diffYMD(from: Date, to: Date) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth(); // 0–11
  let d = to.getDate() - from.getDate(); // 1–31

  if (d < 0) {
    m -= 1;
    const prevMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    d += prevMonth.getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  if (y < 0) {
    y = 0;
    m = 0;
    d = 0;
  }
  return { tahun: y, bulan: m, hari: d };
}
const formatTenure = (y: number, m: number, d: number) =>
  `${y} tahun ${m} bulan ${d} hari`;

function useTenureFromJoinDate(startDate?: string, userId?: number | string) {
  const [label, setLabel] = useState("0 tahun 0 bulan 0 hari");

  useEffect(() => {
    if (!startDate) return;

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return;

    const calcAndMaybeSync = async () => {
      const now = new Date();
      const { tahun, bulan, hari } = diffYMD(start, now);
      const newLabel = formatTenure(tahun, bulan, hari);
      setLabel(newLabel);

      if (userId != null) {
        try {
          await fetch(url("auth/set_masa_kerja.php"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: userId, masa_kerja: newLabel }),
          });
        } catch (e) {
          console.log("gagal update masa_kerja:", e);
        }
      }
    };

    // hitung awal
    calcAndMaybeSync();

    // jadwalkan update tiap jam 00:00 + interval 24 jam
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0
    );
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const timeoutId = setTimeout(() => {
      calcAndMaybeSync();
      intervalId = setInterval(calcAndMaybeSync, 24 * 60 * 60 * 1000); // 24 jam
    }, msUntilMidnight);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [startDate, userId]);

  return label;
}

/* ===== Komponen ===== */
export default function Profile() {
  const [auth, setAuth] = useState<AuthShape | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<number | null>(null);
  const [saldo, setSaldo] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  // Withdraw state
  const [wdStatus, setWdStatus] = useState<WDStatus>("none");
  const [wdLastId, setWdLastId] = useState<number | null>(null);
  const [wdLastAmount, setWdLastAmount] = useState<number | null>(null);
  const [adminWa, setAdminWa] = useState<string | null>(null);
  const [adminDone, setWdAdminDone] = useState<boolean>(false);

  // Modal foto profil
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  // Notifikasi & transisi status (kalau suatu saat mau dipakai)
  const prevWdStatusRef = useRef<WDStatus>("none");
  const LAST_NOTIFY_KEY = "wd:last_notified_id";
  const [lastNotifiedId, setLastNotifiedId] = useState<number | null>(null);

  // === DEBUG FOTO ===
  const [imgUri, setImgUri] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [imgDebug, setImgDebug] = useState<{
    raw: string | null;
    primary: string | null;
    alt: string | null;
    event: string | null;
    lastError: string | null;
    primaryProbe: string | null;
    altProbe: string | null;
  }>({
    raw: null,
    primary: null,
    alt: null,
    event: null,
    lastError: null,
    primaryProbe: null,
    altProbe: null,
  });

  // ==== Lupa password ====
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState<{
    username: string;
    password: string;
  } | null>(null);

  // === STATE BARU BUAT BADGE EVENT (Request + Kerapihan) ===
  const [requestBadge, setRequestBadge] = useState(0);
  const [kerTotal, setKerTotal] = useState(0);
  const [kerClaimedToday, setKerClaimedToday] = useState(false);

  // 🔔 Cek Badge EVENT (Logic Baru: Request + Kerapihan)
  const refreshEventBadge = useCallback(async () => {
    if (!userId) return;
    const BASE = String(API_BASE).replace(/\/+$/, "") + "/";
    try {
      // 1. Cek Request Pending
      const r1 = await fetch(`${BASE}event/points.php?action=requests&user_id=${userId}&status=open`);
      const t1 = await r1.text();
      let j1: any; try { j1 = JSON.parse(t1); } catch {}
      
      if (j1?.success && Array.isArray(j1?.data)) {
        // 🔥 FIX: Filter biar Pending gak bikin badge nyala
        const actionNeeded = j1.data.filter((item: any) => item.status !== 'pending');
        setRequestBadge(actionNeeded.length);
      } else {
        setRequestBadge(0);
      }

      // 2. Cek Kerapihan (Ada poin tapi belum klaim?)
      const r2 = await fetch(`${BASE}event/kerapihan.php?action=user_status&user_id=${userId}&date=${todayISO()}`);
      const t2 = await r2.text();
      let j2: any; try { j2 = JSON.parse(t2); } catch {}
      
      const localKerKey = `ev:ker:${userId}:${todayISO()}`;
      const localClaimed = (await AsyncStorage.getItem(localKerKey)) === "1";

      if (j2?.success) {
        let tpoints = 0;
        if (Array.isArray(j2.data?.items)) {
           j2.data.items.forEach((it: any) => { tpoints += Number(it.point_value || 0); });
        }
        setKerTotal(tpoints);
        setKerClaimedToday(!!j2.data?.claimed_today || localClaimed);
      }
    } catch (e) {
      console.log("Badge fetch error:", e);
    }
  }, [userId]);

  // REFRESH BADGE SAAT LAYAR DIFOKUSKAN
  useFocusEffect(
    useCallback(() => {
      if (userId != null) {
          refreshEventBadge(); 
      }
    }, [userId, refreshEventBadge])
  );

  // HITUNG FINAL BADGE
  const finalBadge = useMemo(() => {
    let count = requestBadge;
    if (kerTotal > 0 && !kerClaimedToday) {
        count += 1;
    }
    return count;
  }, [requestBadge, kerTotal, kerClaimedToday]);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(LAST_NOTIFY_KEY);
      setLastNotifiedId(raw ? Number(raw) || null : null);
    })();
  }, []);

  /* Boot: auth + detail */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        const parsed: AuthShape | null = raw ? JSON.parse(raw) : null;
        if (!mounted) return;
        setAuth(parsed);

        const idRaw = parsed?.id ?? parsed?.user_id;
        const id = idRaw ? Number(idRaw) : 0;
        if (!id) return;

        setUserId(id);

        const res = await fetch(
          url(`auth/get_user.php?id=${encodeURIComponent(String(id))}`)
        );
        const data = await res.json();
        if ((data?.success ?? data?.status) && data?.data && mounted) {
          setDetail(data.data as UserDetail);
        }
      } catch (e) {
        console.log("error fetch profile:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* API: saldo */
  const fetchSaldo = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        url(`event/points.php?action=saldo_get&user_id=${userId}`)
      );
      const t = await r.text();
      const j = JSON.parse(t);
      if (j?.success) {
        setSaldo(Number(j?.data?.saldo_idr ?? 0) || 0);
      } else {
        setSaldo(0);
      }
    } catch {
      setSaldo(0);
    }
  }, [userId]);

  const fetchWithdrawStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(
        url(`event/points.php?action=withdraw_status&user_id=${userId}`)
      );
      const t = await r.text();
      const j = JSON.parse(t);

      if (j?.success) {
        const d = j.data || {};
        setWdStatus((d.status as WDStatus) ?? "none");
        setWdLastId(d.last_request_id ?? null);
        setWdLastAmount(
          typeof d.last_request_amount === "number"
            ? d.last_request_amount
            : null
        );
        setAdminWa(d.admin_phone ?? null);
        setWdAdminDone(Boolean(d.admin_done));
      } else {
        setWdStatus("none");
        setWdLastId(null);
        setWdLastAmount(null);
        setWdAdminDone(false);
      }
    } catch {
      setWdStatus("none");
      setWdLastId(null);
      setWdLastAmount(null);
      setWdAdminDone(false);
    }
  }, [userId]);

  /* Load saldo & status saat userId siap */
  useEffect(() => {
    if (userId) {
      fetchSaldo();
      fetchWithdrawStatus();
    }
  }, [userId, fetchSaldo, fetchWithdrawStatus]);

  /* Pull-to-refresh */
  const onRefresh = useCallback(
    async () => {
      setRefreshing(true);
      await Promise.allSettled([fetchSaldo(), fetchWithdrawStatus(), refreshEventBadge()]);
      setRefreshing(false);
    },
    [fetchSaldo, fetchWithdrawStatus, refreshEventBadge]
  );

  /* Submit withdraw + KONFIRMASI */
  const submitWithdraw = useCallback(() => {
    if (!userId) return;
    
    // 🔥 VALIDASI MINIMAL 1 JUTA
    if (saldo < MIN_WITHDRAW) {
      Alert.alert(
        "Saldo Kurang", 
        `Minimal withdraw adalah Rp ${MIN_WITHDRAW.toLocaleString("id-ID")}.\nSaldo kamu saat ini Rp ${saldo.toLocaleString("id-ID")}.`
      );
      return;
    }

    Alert.alert(
      "Konfirmasi Withdraw",
      `Apakah kamu yakin ingin withdraw saldo Rp ${saldo.toLocaleString(
        "id-ID"
      )}?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Ya, withdraw",
          style: "destructive",
          onPress: async () => {
            try {
              const r = await fetch(
                url(`event/points.php?action=withdraw_submit`),
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ user_id: userId, amount_idr: saldo }),
                }
              );
              const j = JSON.parse(await r.text());
              if (!j?.success) {
                const sev = j?.severity === "warning" ? "Peringatan" : "Error";
                Alert.alert(sev, j?.message || "Gagal mengajukan withdraw.");
                return;
              }
              setWdStatus("pending");
              setWdLastId(Number(j?.data?.id ?? 0) || null);
              setWdLastAmount(Number(j?.data?.amount_idr ?? saldo));
              setWdAdminDone(false);
              prevWdStatusRef.current = "pending";
              Alert.alert(
                "Terkirim 🎉",
                "Pengajuan withdraw menunggu persetujuan admin."
              );
            } catch (e: any) {
              Alert.alert(
                "Gagal",
                e?.message || "Tidak bisa mengajukan saat ini."
              );
            }
          },
        },
      ]
    );
  }, [userId, saldo]);

  /* Open WhatsApp (muncul hanya saat showWA = true) */
  const openWhatsAppAdmin = useCallback(
    () => {
      const phone = (adminWa || "").replace(/[^\d]/g, "");
      if (!phone) {
        return Alert.alert("Info", "Nomor admin belum diset.");
      }
      const nominal =
        typeof wdLastAmount === "number" && wdLastAmount > 0
          ? wdLastAmount
          : saldo;

      const uname = (detail?.username ?? auth?.username ?? "").trim();
      const fullName = (
        (detail?.nama_lengkap ?? auth?.name ?? uname) || "User"
      ).trim();
      const reqId = wdLastId ? `#${wdLastId}` : "-";

      const nowWIB = new Date().toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const monthKey = new Date().toISOString().slice(0, 7);

      const msg = [
        "Halo Admin PT Pordjo Steelindo Perkasa👋",
        "",
        "Saya ingin konfirmasi pencairan *SALDOKU*:",
        `• Request ID     : *${reqId}*`,
        `• Nominal        : *Rp ${nominal.toLocaleString("id-ID")}*`,
        `• Status Sistem  : *APPROVED*`,
        `• Tanggal/Waktu  : ${nowWIB} WIB`,
        `• Bulan Klaim    : ${monthKey}`,
        "",
        "Identitas pemohon:",
        `• Nama           : ${fullName}`,
        `• Username       : ${uname || "-"}`,
        `• User ID        : ${userId}`,
        "",
        "Rekening tujuan (isi oleh saya):",
        "• Bank           : -",
        "• Atas Nama      : -",
        "• No. Rekening   : -",
        "",
        "Mohon diproses ya, terima kasih 🙏",
      ].join("\n");

      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      Linking.openURL(waUrl).catch(() => {
        Alert.alert("Gagal", "Tidak bisa membuka WhatsApp.");
      });
    },
    [
      adminWa,
      wdLastAmount,
      saldo,
      detail?.username,
      detail?.nama_lengkap,
      auth?.username,
      auth?.name,
      userId,
      wdLastId,
    ]
  );

  /* Polling saat pending */
  useEffect(() => {
    if (wdStatus !== "pending") return;
    let active = true;
    const id = setInterval(async () => {
      if (!active) return;
      await fetchWithdrawStatus();
    }, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [wdStatus, fetchWithdrawStatus]);

  // ==== MASA KERJA: dihitung dari tanggal_masuk (kalau ada), kalau tidak ada fallback ke created_at ====
  const masaKerjaDisplay = useTenureFromJoinDate(
    detail?.tanggal_masuk || detail?.created_at,
    detail?.id
  );

  const handleLogout = () => {
    Alert.alert("Konfirmasi Keluar", "Apakah Anda yakin ingin keluar?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluar",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("auth");
          router.replace("/Login/LoginScreen");
        },
      },
    ]);
  };

  // ==== LUPA PASSWORD: open & submit ====
  const handleForgotOpen = () => {
    const currentEmail = detail?.email ?? auth?.email ?? "";
    setForgotEmail(currentEmail === "-" ? "" : currentEmail);
    setForgotResult(null);
    setForgotVisible(true);
  };

  const handleForgotSubmit = async () => {
    const emailTrim = forgotEmail.trim();
    if (!emailTrim) {
      Alert.alert("Info", "Silakan masukkan email yang terdaftar.");
      return;
    }

    try {
      setForgotLoading(true);
      const r = await fetch(url("auth/forgot_password.php"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrim }),
      });

      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error("Respon server tidak valid.");
      }

      if (!j?.success) {
        setForgotResult(null);
        Alert.alert("Gagal", j?.message || "Email anda tidak terdaftar.");
        return;
      }

      setForgotResult({
        username: j?.data?.username ?? "-",
        password: j?.data?.password ?? "-",
      });
    } catch (e: any) {
      Alert.alert("Gagal", e?.message || "Tidak dapat memproses permintaan.");
    } finally {
      setForgotLoading(false);
    }
  };

  const username = detail?.username ?? auth?.username ?? "-";
  const name = detail?.nama_lengkap ?? auth?.name ?? username ?? "User";
  const email = detail?.email ?? auth?.email ?? "-";
  const role = detail?.role ?? auth?.role ?? "staff";
  const tempat_lahir = detail?.tempat_lahir ?? "-";
  const tanggal_lahir = detail?.tanggal_lahir ?? "-";
  const no_telepon = detail?.no_telepon ?? "-";
  const alamat = detail?.alamat ?? "-";

  // Normalisasi foto: utama (ke origin) + siapkan alternatif (ke API_BASE)
  const fotoPrimary = buildImageUrl(detail?.foto);
  useEffect(() => {
    const raw = detail?.foto ? String(detail.foto).trim() : null;
    const clean = raw ? raw.replace(/^\.?\/*/, "") : null;
    const alt = clean
      ? encodeURI(`${(API_BASE || "").replace(/\/+$/, "")}/${clean}`)
      : null;

    setImgUri(fotoPrimary || null);
    setImgDebug({
      raw,
      primary: fotoPrimary || null,
      alt,
      event: "init",
      lastError: null,
      primaryProbe: null,
      altProbe: null,
    });

    console.log("[Profile] Foto raw:", raw);
    console.log("[Profile] Foto primary:", fotoPrimary);
    console.log("[Profile] Foto alt:", alt);
  }, [detail?.foto, fotoPrimary]);

  // Event handler gambar
  const onImageLoad = useCallback(() => {
    setImgDebug((d) => ({ ...d, event: "onLoad", lastError: null }));
    console.log("[Profile] Image loaded OK:", imgUri);
  }, [imgUri]);

  const onImageError = useCallback(async () => {
    console.log("[Profile] Image onError for:", imgUri);
    // buka panel debug otomatis
    setDebugOpen(true);

    // probe primary
    const pProbe = await probeUrl(imgDebug.primary);
    // siapkan fallback ke alt
    let nextUri = imgDebug.alt && imgUri !== imgDebug.alt ? imgDebug.alt : null;

    // jika ada alt, probe juga
    const aProbe = await probeUrl(imgDebug.alt);

    setImgDebug((d) => ({
      ...d,
      event: "onError",
      lastError: "Image.onError triggered",
      primaryProbe: pProbe,
      altProbe: aProbe,
    }));

    if (nextUri) {
      console.log("[Profile] Try fallback ALT:", nextUri);
      setImgUri(nextUri);
    } else {
      console.log("[Profile] No fallback URL available, show initials.");
      setImgUri(null);
    }
  }, [imgUri, imgDebug.primary, imgDebug.alt]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 8 }}>Memuat profil…</Text>
      </View>
    );
  }

  // Derivasi UI tombol WA
  const hasReq = !!wdLastId;
  const showWA =
    wdStatus === "approved" && hasReq && !adminDone && (wdLastAmount ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f6fa" }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatarContainer}
            activeOpacity={0.8}
            onPress={() => {
              if (imgUri) setPhotoModalVisible(true);
            }}
            onLongPress={() => setDebugOpen((v) => !v)} // toggle debug cepat
          >
            {imgUri ? (
              <Image
                source={{ uri: imgUri }}
                style={styles.avatarImage}
                resizeMode="cover"
                onLoad={onImageLoad}
                onError={onImageError}
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: "#fff" }]}>
                <Text style={[styles.avatarText, { color: "#2196F3" }]}>
                  {String((name || "US").trim())
                    .substring(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
            )}
             <View style={{ position: 'absolute', top: 0, left: 200, zIndex: 10 }}>
                          <AppInfoModal iconColor="#fff" /> 
                        </View>
          </TouchableOpacity>

          <Text style={styles.name}>{name}</Text>
          <Text style={styles.position}>{role}</Text>

          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>Masa Kerja</Text>
              <Text style={styles.statLabel}>{masaKerjaDisplay}</Text>
            </View>
          </View>
        </View>

        {/* INFO PERSONAL */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="person-circle-outline" size={20} color="#2196F3" />
            <Text style={styles.infoTitle}>Informasi Personal</Text>
          </View>

          <Row label="Username" value={username} />
          <Row label="Nama Lengkap" value={name} />
          <Row label="Email" value={email} />
          <Row label="Tempat Lahir" value={tempat_lahir} />
          <Row label="Tanggal Lahir" value={tanggal_lahir} />
          <Row label="Nomor Telepon" value={no_telepon} />
          <Row label="Alamat" value={alamat} />
        </View>

        {/* === Saldoku === */}
        <View style={styles.cardSaldo}>
          <Text style={styles.sectionSaldo}>Saldoku</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.saldoLabel}>Total saldo (Approved)</Text>
            <Text style={styles.saldoValue}>
              Rp {saldo.toLocaleString("id-ID")}
            </Text>
          </View>
          <Text style={styles.noteSaldo}>
            Saldo bertambah saat penukaran poin kamu{" "}
            <Text style={{ fontWeight: "900" }}>disetujui</Text> admin.
          </Text>

          {showWA ? (
            <TouchableOpacity
              style={styles.primaryBtnSaldo}
              onPress={openWhatsAppAdmin}
            >
              <Text style={styles.primaryBtnSaldoTx}>WhatsApp Admin</Text>
            </TouchableOpacity>
          ) : wdStatus === "pending" ? (
            <TouchableOpacity
              style={[styles.primaryBtnSaldo, { backgroundColor: "#cbd5e1" }]}
              disabled
            >
              <Text style={styles.primaryBtnSaldoTx}>
                Menunggu persetujuan…
              </Text>
            </TouchableOpacity>
          ) : wdStatus === "rejected" ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: "#b91c1c" }}>
                Pengajuan sebelumnya ditolak.
              </Text>
              <TouchableOpacity
                style={[
                  styles.primaryBtnSaldo,
                  { backgroundColor: saldo >= MIN_WITHDRAW ? "#0A84FF" : "#cbd5e1" },
                ]}
                onPress={submitWithdraw}
              >
                <Text style={styles.primaryBtnSaldoTx}>Ajukan Lagi</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.primaryBtnSaldo,
                { backgroundColor: saldo >= MIN_WITHDRAW ? "#0A84FF" : "#cbd5e1" },
              ]}
              onPress={submitWithdraw}
            >
              <Text style={styles.primaryBtnSaldoTx}>Withdraw</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.quickActionCard}>
          <View style={styles.quickHeader}>
            <Ionicons name="settings-outline" size={20} color="#2196F3" />
            <Text style={styles.quickTitle}>Aksi Cepat</Text>
          </View>

          {/* <TouchableOpacity style={styles.quickItem}>
            <Ionicons name="lock-closed-outline" size={22} color="#2196F3" />
            <Text style={styles.quickText1}>Ubah Password</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color="#aaa"
              style={{ marginLeft: "auto" }}
            />
          </TouchableOpacity> */}

          {/* Lupa password */}
          <TouchableOpacity style={styles.quickItem} onPress={handleForgotOpen}>
            <Ionicons name="help-circle-outline" size={22} color="#f59e0b" />
            <Text style={styles.quickText3}>Lupa Password</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color="#aaa"
              style={{ marginLeft: "auto" }}
            />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickItem} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="#e74c3c" />
            <Text style={styles.quickText2}>Keluar</Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color="#aaa"
              style={{ marginLeft: "auto" }}
            />
          </TouchableOpacity>
        </View>

        {/* Panel debug */}
        {debugOpen && (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>Debug Foto Profil</Text>
            <DebugRow label="Raw" value={imgDebug.raw ?? "null"} />
            <DebugRow label="Primary" value={imgDebug.primary ?? "null"} />
            <DebugRow label="Alt" value={imgDebug.alt ?? "null"} />
            <DebugRow label="Event" value={imgDebug.event ?? "—"} />
            <DebugRow label="Last Error" value={imgDebug.lastError ?? "—"} />
            <DebugRow
              label="Primary Probe"
              value={imgDebug.primaryProbe ?? "—"}
            />
            <DebugRow label="Alt Probe" value={imgDebug.altProbe ?? "—"} />
          </View>
        )}
      </ScrollView>

      {/* Modal foto detail */}
      <Modal
        visible={photoModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoModalVisible(false)}
      >
        <View style={styles.photoModalOverlay}>
          <View style={styles.photoModalBox}>
            {imgUri ? (
              <Image
                source={{ uri: imgUri }}
                style={styles.photoModalImage}
                resizeMode="contain"
                onLoad={() =>
                  setImgDebug((d) => ({
                    ...d,
                    event: "modalLoad",
                    lastError: null,
                  }))
                }
                onError={() => {
                  setImgDebug((d) => ({
                    ...d,
                    event: "modalError",
                    lastError: "Modal Image.onError",
                  }));
                }}
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: "#fff" }]}>
                <Text style={[styles.avatarText, { color: "#2196F3" }]}>
                  {String((name || "US").trim())
                    .substring(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
            )}

            <View style={{ marginTop: 12, alignItems: "center" }}>
              <Text style={styles.photoModalName}>{name}</Text>
              <Text style={styles.photoModalSub}>{email}</Text>
            </View>

            <TouchableOpacity
              style={styles.photoModalCloseBtn}
              onPress={() => setPhotoModalVisible(false)}
            >
              <Text style={styles.photoModalCloseText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal lupa password - bottom sheet */}
      <Modal
        visible={forgotVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setForgotVisible(false)}
      >
        <View style={styles.forgotOverlay}>
          <View style={styles.forgotSheet}>
            <View style={styles.forgotHandle} />

            <Text style={styles.forgotTitle}>Lupa Password</Text>
            <Text style={styles.forgotDesc}>
              Masukkan email yang terdaftar di sistem. Jika ditemukan, username
              dan password Anda akan ditampilkan.
            </Text>

            <Text style={styles.forgotLabel}>Email Terdaftar</Text>
            <TextInput
              value={forgotEmail}
              onChangeText={setForgotEmail}
              placeholder="contoh: user@gmail.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.forgotInput}
            />

            {forgotResult && (
              <View style={styles.forgotResultBox}>
                <Text style={styles.forgotResultTitle}>Data Akun</Text>
                <Text style={styles.forgotResultText}>
                  Username:{" "}
                  <Text style={{ fontWeight: "700" }}>
                    {forgotResult.username}
                  </Text>
                </Text>
                <Text style={styles.forgotResultText}>
                  Password:{" "}
                  <Text style={{ fontWeight: "700" }}>
                    {forgotResult.password}
                  </Text>
                </Text>
              </View>
            )}

            <View style={styles.forgotBtnRow}>
              <TouchableOpacity
                style={[styles.forgotBtn, { backgroundColor: "#e5e7eb" }]}
                onPress={() => setForgotVisible(false)}
                disabled={forgotLoading}
              >
                <Text style={[styles.forgotBtnText, { color: "#111827" }]}>
                  Tutup
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.forgotBtn,
                  { backgroundColor: forgotLoading ? "#93c5fd" : "#2563EB" },
                ]}
                onPress={handleForgotSubmit}
                disabled={forgotLoading}
              >
                {forgotLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.forgotBtnText}>Cek Email</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

     <BottomNavbar 
             preset="user" 
             active="right" 
             config={{
                  // Logic badge pinter (muncul di navbar profile juga!)
                 center: { badge: finalBadge > 0 ? finalBadge : undefined }
             }}
           />
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value ?? "-"}</Text>
    </View>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ color: "#94a3b8", fontSize: 12 }}>{label}</Text>
      <Text selectable style={{ color: "#0f172a", fontSize: 12 }}>
        {value}
      </Text>
    </View>
  );
}

/* ===== Styles ===== */
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    backgroundColor: "#2196F3",
    paddingVertical: 40,
    alignItems: "center",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  avatarContainer: { marginBottom: 12 },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#fff",
  },
  avatarText: { fontSize: 32, fontWeight: "bold" },
  name: { fontSize: 22, fontWeight: "bold", color: "#fff" },
  position: { color: "#e0e0e0", fontSize: 14 },

  statsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    width: "80%",
    backgroundColor: "#fff",
    borderRadius: 15,
    paddingVertical: 10,
    marginTop: 15,
  },
  statBox: { alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "bold", color: "#2196F3" },
  statLabel: { fontSize: 12, color: "#616161" },

  infoCard: {
    backgroundColor: "#fff",
    margin: 20,
    borderRadius: 15,
    padding: 20,
    elevation: 2,
  },
  infoHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },
  infoTitle: {
    marginLeft: 8,
    fontWeight: "bold",
    color: "#2196F3",
    fontSize: 16,
  },

  infoRow: { marginBottom: 10 },
  infoLabel: { fontSize: 13, color: "#757575" },
  infoValue: { fontSize: 15, fontWeight: "500", color: "#212121" },

  // Saldoku
  cardSaldo: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    marginHorizontal: 20,
    marginTop: 5,
    elevation: 2,
  },
  sectionSaldo: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0B1A33",
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  saldoLabel: { color: "#6B7A90" },
  saldoValue: {
    color: "#0B1A33",
    fontWeight: "900",
    fontSize: 16,
  },
  noteSaldo: {
    color: "#6B7A90",
    fontSize: 12,
    marginTop: 6,
    marginBottom: 12,
  },
  primaryBtnSaldo: {
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryBtnSaldoTx: { color: "#fff", fontWeight: "900" },

  quickActionCard: {
    backgroundColor: "#fff",
    marginHorizontal: 20,
    borderRadius: 15,
    padding: 15,
    elevation: 2,
    top: 30,
  },
  quickHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 8,
  },
  quickTitle: {
    marginLeft: 8,
    fontWeight: "bold",
    color: "#2196F3",
    fontSize: 16,
  },
  quickItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  quickText1: {
    marginLeft: 10,
    fontSize: 15,
    color: "#2196F3",
    fontWeight: "500",
  },
  quickText2: {
    marginLeft: 10,
    fontSize: 15,
    color: "#e74c3c",
    fontWeight: "500",
  },
  quickText3: {
    marginLeft: 10,
    fontSize: 15,
    color: "#f59e0b",
    fontWeight: "500",
  },

  // Modal foto detail
  photoModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  photoModalBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#111827",
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
  },
  photoModalImage: {
    width: "100%",
    height: 320,
    borderRadius: 14,
    backgroundColor: "#000",
  },
  photoModalName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#E5E7EB",
  },
  photoModalSub: {
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 2,
  },
  photoModalCloseBtn: {
    marginTop: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  photoModalCloseText: {
    color: "#fff",
    fontWeight: "700",
  },

  // Debug panel
  debugBox: {
    marginTop: 32,
    marginHorizontal: 20,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
  },
  debugTitle: { fontWeight: "800", color: "#0f172a", marginBottom: 8 },

  // Bottom sheet lupa password
  forgotOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  forgotSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
  },
  forgotHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e5e7eb",
    alignSelf: "center",
    marginVertical: 6,
  },
  forgotTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginTop: 4,
  },
  forgotDesc: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
    marginBottom: 10,
  },
  forgotLabel: {
    fontSize: 12,
    color: "#374151",
    marginBottom: 4,
    marginTop: 4,
  },
  forgotInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  forgotResultBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },
  forgotResultTitle: {
    fontWeight: "700",
    fontSize: 14,
    color: "#1D4ED8",
    marginBottom: 4,
  },
  forgotResultText: {
    fontSize: 13,
    color: "#1f2937",
  },
  forgotBtnRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
    gap: 8,
  },
  forgotBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  forgotBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});