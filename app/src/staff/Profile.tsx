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
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native"; 
import { API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";
import AppInfoModal from "../../_components/AppInfoModal";

/* ===== KONFIGURASI ===== */
const MIN_WITHDRAW = 500000; 
const url = (p: string) => (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function buildImageUrl(raw?: string | null) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || v.toLowerCase() === "null" || v.toLowerCase() === "undefined") return null;
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) return encodeURI(v);
  const clean = v.replace(/^\.?\/*/, "");
  const base = (API_BASE || "").replace(/\/+$/, "");
  return encodeURI(`${base}/${clean}`);
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
  created_at?: string; 
  tanggal_masuk?: string; 
};

type WDStatus = "none" | "pending" | "approved" | "rejected";

function diffYMD(from: Date, to: Date) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let d = to.getDate() - from.getDate();
  if (d < 0) { m -= 1; d += new Date(to.getFullYear(), to.getMonth(), 0).getDate(); }
  if (m < 0) { y -= 1; m += 12; }
  if (y < 0) { y = 0; m = 0; d = 0; }
  return { tahun: y, bulan: m, hari: d };
}
const formatTenure = (y: number, m: number, d: number) => `${y} tahun ${m} bulan ${d} hari`;

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
        } catch (e) { console.log("gagal update masa_kerja:", e); }
      }
    };
    calcAndMaybeSync();
    const intervalId = setInterval(calcAndMaybeSync, 24 * 60 * 60 * 1000);
    return () => clearInterval(intervalId);
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
  const [imgUri, setImgUri] = useState<string | null>(null);

  // ==== Lupa password ====
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ username: string; password: string; } | null>(null);

  // ==== Ganti Password ====
  const [changePassVisible, setChangePassVisible] = useState(false);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confPass, setConfPass] = useState("");
  const [changePassLoading, setChangePassLoading] = useState(false);
  const [showPass, setShowPass] = useState({ old: false, new: false, conf: false });

  // Badge
  const [requestBadge, setRequestBadge] = useState(0);
  const [kerTotal, setKerTotal] = useState(0);
  const [kerClaimedToday, setKerClaimedToday] = useState(false);

  const refreshEventBadge = useCallback(async () => {
    if (!userId) return;
    const BASE = String(API_BASE).replace(/\/+$/, "") + "/";
    try {
      const r1 = await fetch(`${BASE}event/points.php?action=requests&user_id=${userId}&status=open`);
      const t1 = await r1.text();
      let j1: any; try { j1 = JSON.parse(t1); } catch {}
      if (j1?.success && Array.isArray(j1?.data)) {
        const actionNeeded = j1.data.filter((item: any) => item.status !== 'pending');
        setRequestBadge(actionNeeded.length);
      } else { setRequestBadge(0); }

      const r2 = await fetch(`${BASE}event/kerapihan.php?action=user_status&user_id=${userId}&date=${todayISO()}`);
      const t2 = await r2.text();
      let j2: any; try { j2 = JSON.parse(t2); } catch {}
      const localKerKey = `ev:ker:${userId}:${todayISO()}`;
      const localClaimed = (await AsyncStorage.getItem(localKerKey)) === "1";
      if (j2?.success) {
        let tpoints = 0;
        if (Array.isArray(j2.data?.items)) j2.data.items.forEach((it: any) => { tpoints += Number(it.point_value || 0); });
        setKerTotal(tpoints);
        setKerClaimedToday(!!j2.data?.claimed_today || localClaimed);
      }
    } catch (e) { console.log("Badge fetch error:", e); }
  }, [userId]);

  useFocusEffect(useCallback(() => { if (userId != null) refreshEventBadge(); }, [userId, refreshEventBadge]));

  const finalBadge = useMemo(() => {
    let count = requestBadge;
    if (kerTotal > 0 && !kerClaimedToday) count += 1;
    return count;
  }, [requestBadge, kerTotal, kerClaimedToday]);

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
        const res = await fetch(url(`auth/get_user.php?id=${encodeURIComponent(String(id))}`));
        const data = await res.json();
        if ((data?.success ?? data?.status) && data?.data && mounted) setDetail(data.data as UserDetail);
      } catch (e) { console.log("error fetch profile:", e); } finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);

  /* API: saldo & withdraw */
  const fetchSaldo = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(url(`event/points.php?action=saldo_get&user_id=${userId}`));
      const j = JSON.parse(await r.text());
      setSaldo(j?.success ? (Number(j?.data?.saldo_idr ?? 0) || 0) : 0);
    } catch { setSaldo(0); }
  }, [userId]);

  const fetchWithdrawStatus = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(url(`event/points.php?action=withdraw_status&user_id=${userId}`));
      const j = JSON.parse(await r.text());
      if (j?.success) {
        const d = j.data || {};
        setWdStatus((d.status as WDStatus) ?? "none");
        setWdLastId(d.last_request_id ?? null);
        setWdLastAmount(typeof d.last_request_amount === "number" ? d.last_request_amount : null);
        setAdminWa(d.admin_phone ?? null);
        setWdAdminDone(Boolean(d.admin_done));
      } else {
        setWdStatus("none"); setWdLastId(null); setWdLastAmount(null); setWdAdminDone(false);
      }
    } catch {
      setWdStatus("none"); setWdLastId(null); setWdLastAmount(null); setWdAdminDone(false);
    }
  }, [userId]);

  useEffect(() => { if (userId) { fetchSaldo(); fetchWithdrawStatus(); } }, [userId, fetchSaldo, fetchWithdrawStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([fetchSaldo(), fetchWithdrawStatus(), refreshEventBadge()]);
    setRefreshing(false);
  }, [fetchSaldo, fetchWithdrawStatus, refreshEventBadge]);

  /* Submit withdraw */
  const submitWithdraw = useCallback(() => {
    if (!userId) return;
    if (saldo < MIN_WITHDRAW) {
      Alert.alert("Saldo Kurang", `Minimal withdraw adalah Rp ${MIN_WITHDRAW.toLocaleString("id-ID")}.\nSaldo kamu saat ini Rp ${saldo.toLocaleString("id-ID")}.`);
      return;
    }
    Alert.alert("Konfirmasi Withdraw", `Apakah kamu yakin ingin withdraw saldo Rp ${saldo.toLocaleString("id-ID")}?`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Ya, withdraw", style: "destructive",
        onPress: async () => {
          try {
            const r = await fetch(url(`event/points.php?action=withdraw_submit`), {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: userId, amount_idr: saldo }),
            });
            const j = JSON.parse(await r.text());
            if (!j?.success) {
              Alert.alert(j?.severity === "warning" ? "Peringatan" : "Error", j?.message || "Gagal mengajukan withdraw.");
              return;
            }
            setWdStatus("pending"); setWdLastId(Number(j?.data?.id ?? 0) || null);
            setWdLastAmount(Number(j?.data?.amount_idr ?? saldo)); setWdAdminDone(false);
            Alert.alert("Terkirim 🎉", "Pengajuan withdraw menunggu persetujuan admin.");
          } catch (e: any) { Alert.alert("Gagal", e?.message || "Tidak bisa mengajukan saat ini."); }
        },
      },
    ]);
  }, [userId, saldo]);

  const openWhatsAppAdmin = useCallback(() => {
    const phone = (adminWa || "").replace(/[^\d]/g, "");
    if (!phone) return Alert.alert("Info", "Nomor admin belum diset.");
    const nominal = typeof wdLastAmount === "number" && wdLastAmount > 0 ? wdLastAmount : saldo;
    const uname = (detail?.username ?? auth?.username ?? "").trim();
    const fullName = ((detail?.nama_lengkap ?? auth?.name ?? uname) || "User").trim();
    const msg = `Halo Admin, saya ingin konfirmasi pencairan SALDOKU dengan Request ID #${wdLastId || '-'} sebesar Rp ${nominal.toLocaleString("id-ID")}. Mohon diproses.`;
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`).catch(() => Alert.alert("Gagal", "Tidak bisa membuka WhatsApp."));
  }, [adminWa, wdLastAmount, saldo, detail, auth, userId, wdLastId]);

  /* Polling withdraw pending */
  useEffect(() => {
    if (wdStatus !== "pending") return;
    let active = true;
    const id = setInterval(async () => { if (!active) return; await fetchWithdrawStatus(); }, 15000);
    return () => { active = false; clearInterval(id); };
  }, [wdStatus, fetchWithdrawStatus]);

  const masaKerjaDisplay = useTenureFromJoinDate(detail?.tanggal_masuk || detail?.created_at, detail?.id);

  const handleLogout = () => {
    Alert.alert("Konfirmasi Keluar", "Apakah Anda yakin ingin keluar?", [
      { text: "Batal", style: "cancel" },
      { text: "Keluar", style: "destructive", onPress: async () => { await AsyncStorage.removeItem("auth"); router.replace("/Login/LoginScreen"); } },
    ]);
  };

  // ==== FITUR GANTI PASSWORD ====
  const handleChangePassSubmit = async () => {
      if(!oldPass || !newPass || !confPass) return Alert.alert("Validasi", "Semua kolom wajib diisi.");
      if(newPass !== confPass) return Alert.alert("Validasi", "Konfirmasi password baru tidak cocok.");
      if(newPass.length < 6) return Alert.alert("Validasi", "Password minimal 6 karakter.");

      setChangePassLoading(true);
      try {
          const res = await fetch(url("auth/change_password.php"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_id: userId, old_password: oldPass, new_password: newPass })
          });
          const json = await res.json();
          if(json.success) {
              Alert.alert("Berhasil", "Password berhasil diubah. Silakan login ulang.", [
                  { text: "OK", onPress: async () => {
                      await AsyncStorage.removeItem("auth");
                      router.replace("/Login/LoginScreen");
                  }}
              ]);
              setChangePassVisible(false);
          } else {
              Alert.alert("Gagal", json.message || "Password lama salah.");
          }
      } catch (e) {
          Alert.alert("Error", "Terjadi kesalahan koneksi.");
      } finally {
          setChangePassLoading(false);
      }
  }

  // ==== LUPA PASSWORD ====
  const handleForgotOpen = () => {
    const currentEmail = detail?.email ?? auth?.email ?? "";
    setForgotEmail(currentEmail === "-" ? "" : currentEmail);
    setForgotResult(null);
    setForgotVisible(true);
  };
  const handleForgotSubmit = async () => {
    const emailTrim = forgotEmail.trim();
    if (!emailTrim) return Alert.alert("Info", "Silakan masukkan email yang terdaftar.");
    try {
      setForgotLoading(true);
      const r = await fetch(url("auth/forgot_password.php"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailTrim }),
      });
      const j = JSON.parse(await r.text());
      if (!j?.success) {
        setForgotResult(null);
        Alert.alert("Gagal", j?.message || "Email anda tidak terdaftar.");
        return;
      }
      setForgotResult({ username: j?.data?.username ?? "-", password: j?.data?.password ?? "-" });
    } catch (e: any) { Alert.alert("Gagal", e?.message || "Tidak dapat memproses permintaan."); } 
    finally { setForgotLoading(false); }
  };

  const username = detail?.username ?? auth?.username ?? "-";
  const name = detail?.nama_lengkap ?? auth?.name ?? username ?? "User";
  const email = detail?.email ?? auth?.email ?? "-";
  const role = detail?.role ?? auth?.role ?? "staff";
  
  const fotoPrimary = buildImageUrl(detail?.foto);
  useEffect(() => { setImgUri(fotoPrimary || null); }, [detail?.foto, fotoPrimary]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /><Text style={{ marginTop: 8 }}>Memuat profil…</Text></View>;
  const hasReq = !!wdLastId;
  const showWA = wdStatus === "approved" && hasReq && !adminDone && (wdLastAmount ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f6fa" }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.avatarContainer} activeOpacity={0.8} onPress={() => { if (imgUri) setPhotoModalVisible(true); }}>
            {imgUri ? (
              <Image source={{ uri: imgUri }} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: "#fff" }]}>
                <Text style={[styles.avatarText, { color: "#2196F3" }]}>{String((name || "US").trim()).substring(0, 2).toUpperCase()}</Text>
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
          <Row label="Tempat Lahir" value={detail?.tempat_lahir} />
          <Row label="Tanggal Lahir" value={detail?.tanggal_lahir} />
          <Row label="Nomor Telepon" value={detail?.no_telepon} />
          <Row label="Alamat" value={detail?.alamat} />
        </View>

        {/* SALDOKU */}
        <View style={styles.cardSaldo}>
          <Text style={styles.sectionSaldo}>Saldoku</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.saldoLabel}>Total saldo (Approved)</Text>
            <Text style={styles.saldoValue}>Rp {saldo.toLocaleString("id-ID")}</Text>
          </View>
          <Text style={styles.noteSaldo}>Saldo bertambah saat penukaran poin kamu <Text style={{ fontWeight: "900" }}>disetujui</Text> admin.</Text>
          {showWA ? (
            <TouchableOpacity style={styles.primaryBtnSaldo} onPress={openWhatsAppAdmin}>
              <Text style={styles.primaryBtnSaldoTx}>WhatsApp Admin</Text>
            </TouchableOpacity>
          ) : wdStatus === "pending" ? (
            <TouchableOpacity style={[styles.primaryBtnSaldo, { backgroundColor: "#cbd5e1" }]} disabled>
              <Text style={styles.primaryBtnSaldoTx}>Menunggu persetujuan…</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.primaryBtnSaldo, { backgroundColor: saldo >= MIN_WITHDRAW ? "#0A84FF" : "#cbd5e1" }]} disabled={saldo < MIN_WITHDRAW} onPress={submitWithdraw}>
              <Text style={styles.primaryBtnSaldoTx}>Withdraw</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* QUICK ACTION */}
        <View style={styles.quickActionCard}>
          <View style={styles.quickHeader}>
            <Ionicons name="settings-outline" size={20} color="#2196F3" />
            <Text style={styles.quickTitle}>Aksi Cepat</Text>
          </View>

          {/* 🔥 NEW: GANTI PASSWORD */}
          <TouchableOpacity style={styles.quickItem} onPress={() => {
              setOldPass(""); setNewPass(""); setConfPass("");
              setChangePassVisible(true);
          }}>
            <Ionicons name="lock-closed-outline" size={22} color="#2196F3" />
            <Text style={styles.quickText1}>Ganti Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#aaa" style={{ marginLeft: "auto" }} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickItem} onPress={handleForgotOpen}>
            <Ionicons name="help-circle-outline" size={22} color="#f59e0b" />
            <Text style={styles.quickText3}>Lupa Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#aaa" style={{ marginLeft: "auto" }} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickItem} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="#e74c3c" />
            <Text style={styles.quickText2}>Keluar</Text>
            <Ionicons name="chevron-forward" size={20} color="#aaa" style={{ marginLeft: "auto" }} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* MODAL GANTI PASSWORD */}
      <Modal visible={changePassVisible} transparent animationType="slide" onRequestClose={() => setChangePassVisible(false)}>
        <View style={styles.forgotOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.forgotSheet}>
                <View style={styles.forgotHandle} />
                <Text style={styles.forgotTitle}>Ganti Password</Text>
                <Text style={styles.forgotDesc}>Pastikan password baru aman dan mudah diingat.</Text>
                
                <Text style={styles.forgotLabel}>Password Lama</Text>
                <View style={styles.passContainer}>
                    <TextInput value={oldPass} onChangeText={setOldPass} secureTextEntry={!showPass.old} style={styles.passInput} placeholder="Masukkan password lama" />
                    <TouchableOpacity onPress={() => setShowPass(p => ({...p, old: !p.old}))}>
                        <Ionicons name={showPass.old ? "eye-off" : "eye"} size={20} color="#999" />
                    </TouchableOpacity>
                </View>

                <Text style={styles.forgotLabel}>Password Baru</Text>
                <View style={styles.passContainer}>
                    <TextInput value={newPass} onChangeText={setNewPass} secureTextEntry={!showPass.new} style={styles.passInput} placeholder="Minimal 6 karakter" />
                    <TouchableOpacity onPress={() => setShowPass(p => ({...p, new: !p.new}))}>
                        <Ionicons name={showPass.new ? "eye-off" : "eye"} size={20} color="#999" />
                    </TouchableOpacity>
                </View>

                <Text style={styles.forgotLabel}>Konfirmasi Password Baru</Text>
                <View style={styles.passContainer}>
                    <TextInput value={confPass} onChangeText={setConfPass} secureTextEntry={!showPass.conf} style={styles.passInput} placeholder="Ulangi password baru" />
                    <TouchableOpacity onPress={() => setShowPass(p => ({...p, conf: !p.conf}))}>
                        <Ionicons name={showPass.conf ? "eye-off" : "eye"} size={20} color="#999" />
                    </TouchableOpacity>
                </View>

                <View style={styles.forgotBtnRow}>
                    <TouchableOpacity style={[styles.forgotBtn, { backgroundColor: "#e5e7eb" }]} onPress={() => setChangePassVisible(false)}>
                        <Text style={[styles.forgotBtnText, { color: "#111827" }]}>Batal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.forgotBtn, { backgroundColor: changePassLoading ? "#93c5fd" : "#2563EB" }]} onPress={handleChangePassSubmit} disabled={changePassLoading}>
                        {changePassLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.forgotBtnText}>Simpan</Text>}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Modal lupa password */}
      <Modal visible={forgotVisible} transparent animationType="slide" onRequestClose={() => setForgotVisible(false)}>
        <View style={styles.forgotOverlay}>
          <View style={styles.forgotSheet}>
            <View style={styles.forgotHandle} />
            <Text style={styles.forgotTitle}>Lupa Password</Text>
            <Text style={styles.forgotDesc}>Masukkan email yang terdaftar untuk melihat password.</Text>
            <Text style={styles.forgotLabel}>Email Terdaftar</Text>
            <TextInput value={forgotEmail} onChangeText={setForgotEmail} placeholder="contoh: user@gmail.com" keyboardType="email-address" autoCapitalize="none" style={styles.forgotInput} />
            {forgotResult && (
              <View style={styles.forgotResultBox}>
                <Text style={styles.forgotResultTitle}>Data Akun</Text>
                <Text style={styles.forgotResultText}>Username: <Text style={{ fontWeight: "700" }}>{forgotResult.username}</Text></Text>
                <Text style={styles.forgotResultText}>Password: <Text style={{ fontWeight: "700" }}>{forgotResult.password}</Text></Text>
              </View>
            )}
            <View style={styles.forgotBtnRow}>
              <TouchableOpacity style={[styles.forgotBtn, { backgroundColor: "#e5e7eb" }]} onPress={() => setForgotVisible(false)}><Text style={[styles.forgotBtnText, { color: "#111827" }]}>Tutup</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.forgotBtn, { backgroundColor: forgotLoading ? "#93c5fd" : "#2563EB" }]} onPress={handleForgotSubmit} disabled={forgotLoading}>
                {forgotLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.forgotBtnText}>Cek Email</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      <Modal visible={photoModalVisible} transparent animationType="fade" onRequestClose={() => setPhotoModalVisible(false)}>
        <View style={styles.photoModalOverlay}>
          <View style={styles.photoModalBox}>
            {imgUri ? <Image source={{ uri: imgUri }} style={styles.photoModalImage} resizeMode="contain" /> : <View style={[styles.avatarCircle, { backgroundColor: "#fff" }]}><Text style={[styles.avatarText, { color: "#2196F3" }]}>{String((name || "US").trim()).substring(0, 2).toUpperCase()}</Text></View>}
            <TouchableOpacity style={styles.photoModalCloseBtn} onPress={() => setPhotoModalVisible(false)}><Text style={styles.photoModalCloseText}>Tutup</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

     <BottomNavbar preset="user" active="right" config={{ center: { badge: finalBadge > 0 ? finalBadge : undefined } }} />
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (<View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value ?? "-"}</Text></View>);
}

/* ===== Styles ===== */
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { backgroundColor: "#2196F3", paddingVertical: 40, alignItems: "center", borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  avatarContainer: { marginBottom: 12 },
  avatarCircle: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center" },
  avatarImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: "#fff" },
  avatarText: { fontSize: 32, fontWeight: "bold" },
  name: { fontSize: 22, fontWeight: "bold", color: "#fff" },
  position: { color: "#e0e0e0", fontSize: 14 },
  statsContainer: { flexDirection: "row", justifyContent: "center", width: "80%", backgroundColor: "#fff", borderRadius: 15, paddingVertical: 10, marginTop: 15 },
  statBox: { alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "bold", color: "#2196F3" },
  statLabel: { fontSize: 12, color: "#616161" },
  infoCard: { backgroundColor: "#fff", margin: 20, borderRadius: 15, padding: 20, elevation: 2 },
  infoHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  infoTitle: { marginLeft: 8, fontWeight: "bold", color: "#2196F3", fontSize: 16 },
  infoRow: { marginBottom: 10 },
  infoLabel: { fontSize: 13, color: "#757575" },
  infoValue: { fontSize: 15, fontWeight: "500", color: "#212121" },
  cardSaldo: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E3ECFF", marginHorizontal: 20, marginTop: 5, elevation: 2 },
  sectionSaldo: { fontSize: 16, fontWeight: "900", color: "#0B1A33", marginBottom: 10 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  saldoLabel: { color: "#6B7A90" },
  saldoValue: { color: "#0B1A33", fontWeight: "900", fontSize: 16 },
  noteSaldo: { color: "#6B7A90", fontSize: 12, marginTop: 6, marginBottom: 12 },
  primaryBtnSaldo: { backgroundColor: "#0A84FF", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  primaryBtnSaldoTx: { color: "#fff", fontWeight: "900" },
  quickActionCard: { backgroundColor: "#fff", marginHorizontal: 20, borderRadius: 15, padding: 15, elevation: 2, top: 30 },
  quickHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15, borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 8 },
  quickTitle: { marginLeft: 8, fontWeight: "bold", color: "#2196F3", fontSize: 16 },
  quickItem: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  quickText1: { marginLeft: 10, fontSize: 15, color: "#2196F3", fontWeight: "500" },
  quickText2: { marginLeft: 10, fontSize: 15, color: "#e74c3c", fontWeight: "500" },
  quickText3: { marginLeft: 10, fontSize: 15, color: "#f59e0b", fontWeight: "500" },
  photoModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 16 },
  photoModalBox: { width: "100%", maxWidth: 420, backgroundColor: "#111827", borderRadius: 16, padding: 14, alignItems: "center" },
  photoModalImage: { width: "100%", height: 320, borderRadius: 14, backgroundColor: "#000" },
  photoModalName: { fontSize: 18, fontWeight: "700", color: "#E5E7EB" },
  photoModalSub: { fontSize: 13, color: "#9CA3AF", marginTop: 2 },
  photoModalCloseBtn: { marginTop: 14, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 999, backgroundColor: "#2563EB" },
  photoModalCloseText: { color: "#fff", fontWeight: "700" },
  debugBox: { marginTop: 32, marginHorizontal: 20, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12 },
  debugTitle: { fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  forgotOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  forgotSheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },
  forgotHandle: { width: 40, height: 4, borderRadius: 999, backgroundColor: "#e5e7eb", alignSelf: "center", marginVertical: 6 },
  forgotTitle: { fontSize: 18, fontWeight: "800", color: "#111827", marginTop: 4 },
  forgotDesc: { fontSize: 12, color: "#6b7280", marginTop: 4, marginBottom: 10 },
  forgotLabel: { fontSize: 12, color: "#374151", marginBottom: 4, marginTop: 4 },
  forgotInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: "#111827", backgroundColor: "#f9fafb" },
  passContainer: { flexDirection:'row', alignItems:'center', borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 10, backgroundColor: "#f9fafb" },
  passInput: { flex:1, paddingVertical: 8, fontSize: 14, color: "#111827" },
  forgotResultBox: { marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: "#EFF6FF", borderWidth: 1, borderColor: "#DBEAFE" },
  forgotResultTitle: { fontWeight: "700", fontSize: 14, color: "#1D4ED8", marginBottom: 4 },
  forgotResultText: { fontSize: 13, color: "#1f2937" },
  forgotBtnRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14, gap: 8 },
  forgotBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  forgotBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});