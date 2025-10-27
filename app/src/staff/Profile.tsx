import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Image, ActivityIndicator,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "../../config";

/* ===== URL helper singkat ===== */
const url = (p: string) => (API_BASE.endsWith("/") ? API_BASE : API_BASE + "/") + p.replace(/^\/+/, "");

/* ===== Types ringkas ===== */
type AuthShape = { id?: number | string; user_id?: number | string; username?: string; name?: string; email?: string; role?: string; };
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
  masa_kerja?: string;    // contoh: "1 tahun 2 bulan 13 hari"
  foto?: string | null;
  created_at?: string;
};

/* ===== Util masa kerja (berbasis kalender) ===== */
function parseTenureLabel(s?: string) {
  const get = (re: RegExp) => Number(re.exec(s ?? "")?.[1] ?? 0);
  return { tahun: get(/(\d+)\s*(tahun|th|thn)/i), bulan: get(/(\d+)\s*(bulan|bln)/i), hari: get(/(\d+)\s*(hari|hr)/i) };
}
function calcAnchorFromLabel(now: Date, label?: string) {
  const { tahun, bulan, hari } = parseTenureLabel(label);
  const t0 = new Date(now.getFullYear() - tahun, now.getMonth() - bulan, now.getDate());
  t0.setDate(t0.getDate() - hari);
  return t0; // tanggal mulai kerja (anchor)
}
function diffTenureYMD(startISO: string) {
  const start = new Date(startISO.replace(" ", "T"));
  const now = new Date();
  let y = now.getFullYear() - start.getFullYear();
  let m = now.getMonth() - start.getMonth();
  let d = now.getDate() - start.getDate();
  if (d < 0) { const pm = new Date(now.getFullYear(), now.getMonth(), 0); d += pm.getDate(); m--; }
  if (m < 0) { m += 12; y--; }
  if (y < 0) y = m = d = 0;
  return { y, m, d };
}
const formatTenure = (y: number, m: number, d: number) => `${y} tahun ${m} bulan ${d} hari`;
const msUntilNextMidnight = () => {
  const n = new Date();
  const mid = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 1);
  return Math.max(1000, mid.getTime() - n.getTime());
};

/* ===== Hook: hitung & sync DB tiap tengah malam ===== */
function useTenureFromLabelAndSync(masaKerjaAwal?: string, userId?: number | string) {
  const [label, setLabel] = useState("0 tahun 0 bulan 0 hari");

  useEffect(() => {
    if (!masaKerjaAwal || !userId) return;

    const anchor = calcAnchorFromLabel(new Date(), masaKerjaAwal);

    const recalc = async () => {
      const { y, m, d } = diffTenureYMD(anchor.toISOString());
      const l = formatTenure(y, m, d);
      setLabel(l);
      try {
        await fetch(url("auth/set_masa_kerja.php"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: userId, masa_kerja: l }),
        });
      } catch {}
    };

    recalc();
    let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(() => { recalc(); loop(); }, msUntilNextMidnight()); };
    loop();
    return () => clearTimeout(t);
  }, [masaKerjaAwal, userId]);

  return label;
}

/* ===== Komponen ===== */
export default function Profile() {
  const [auth, setAuth] = useState<AuthShape | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        const parsed: AuthShape | null = raw ? JSON.parse(raw) : null;
        if (!mounted) return;
        setAuth(parsed);

        const id = parsed?.id ?? parsed?.user_id;
        if (!id) return;

        const res = await fetch(url(`auth/get_user.php?id=${encodeURIComponent(String(id))}`));
        const data = await res.json();
        if ((data?.success ?? data?.status) && data?.data && mounted) setDetail(data.data as UserDetail);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const masaKerjaDisplay = useTenureFromLabelAndSync(detail?.masa_kerja, detail?.id);

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

  const username = detail?.username ?? auth?.username ?? "-";
  const name = detail?.nama_lengkap ?? auth?.name ?? username ?? "User";
  const email = detail?.email ?? auth?.email ?? "-";
  const role = detail?.role ?? auth?.role ?? "staff";
  const tempat_lahir = detail?.tempat_lahir ?? "-";
  const tanggal_lahir = detail?.tanggal_lahir ?? "-";
  const no_telepon = detail?.no_telepon ?? "-";
  const alamat = detail?.alamat ?? "-";
  const foto = detail?.foto || null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 8 }}>Memuat profil…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f6fa" }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {foto ? (
              <Image source={{ uri: foto }} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: "#fff" }]}>
                <Text style={[styles.avatarText, { color: "#2196F3" }]}>
                  {String(name || "US").substring(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.name}>{name}</Text>
          <Text style={styles.position}>{role}</Text>

          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>Masa Kerja</Text>
              <Text style={styles.statLabel}>{masaKerjaDisplay}</Text>
            </View>
          </View>
        </View>

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

        <View style={styles.quickActionCard}>
          <View style={styles.quickHeader}>
            <Ionicons name="settings-outline" size={20} color="#2196F3" />
            <Text style={styles.quickTitle}>Aksi Cepat</Text>
          </View>

          <TouchableOpacity style={styles.quickItem}>
            <Ionicons name="lock-closed-outline" size={22} color="#2196F3" />
            <Text style={styles.quickText}>Ubah Password</Text>
            <Ionicons name="chevron-forward" size={20} color="#aaa" style={{ marginLeft: "auto" }} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.quickItem} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="#2196F3" />
            <Text style={styles.quickText}>Keluar</Text>
            <Ionicons name="chevron-forward" size={20} color="#aaa" style={{ marginLeft: "auto" }} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.bottomContainer}>
        <TouchableOpacity onPress={() => router.push("/src/staff/Home")} style={styles.navItem}>
          <Ionicons name="home-outline" size={26} color="#757575" />
          <Text style={[styles.label, { color: "#757575" }]}>Beranda</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/src/staff/Profile")} style={styles.navItem}>
          <Ionicons name="person" size={26} color="#0D47A1" />
          <Text style={[styles.label, { color: "#0D47A1" }]}>Profil</Text>
        </TouchableOpacity>
      </View>
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

/* ===== Styles ringkas ===== */
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    backgroundColor: "#2196F3", paddingVertical: 40, alignItems: "center",
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30
  },
  avatarContainer: { marginBottom: 12 },
  avatarCircle: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center" },
  avatarImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: "#fff" },
  avatarText: { fontSize: 32, fontWeight: "bold" },
  name: { fontSize: 22, fontWeight: "bold", color: "#fff" },
  position: { color: "#e0e0e0", fontSize: 14 },

  statsContainer: {
    flexDirection: "row", justifyContent: "center", width: "80%",
    backgroundColor: "#fff", borderRadius: 15, paddingVertical: 10, marginTop: 15
  },
  statBox: { alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "bold", color: "#2196F3" },
  statLabel: { fontSize: 12, color: "#616161" },

  infoCard: { backgroundColor: "#fff", margin: 20, borderRadius: 15, padding: 20, elevation: 2 },
  infoHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  infoTitle: { marginLeft: 8, fontWeight: "bold", color: "#2196F3", fontSize: 16 },

  infoRow: { marginBottom: 10 },
  infoLabel: { fontSize: 13, color: "#757575" },
  infoValue: { fontSize: 15, fontWeight: "500", color: "#212121" },

  quickActionCard: { backgroundColor: "#fff", marginHorizontal: 20, borderRadius: 15, padding: 15, elevation: 2 },
  quickHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15, borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 8 },
  quickTitle: { marginLeft: 8, fontWeight: "bold", color: "#2196F3", fontSize: 16 },
  quickItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  quickText: { marginLeft: 10, fontSize: 15, color: "#212121", fontWeight: "500" },

  bottomContainer: {
    flexDirection: "row", justifyContent: "space-around", alignItems: "center",
    borderTopWidth: 1, borderTopColor: "#ddd", backgroundColor: "#fff", paddingVertical: 8,
    position: "absolute", bottom: 0, left: 0, right: 0
  },
  navItem: { alignItems: "center" },
  label: { fontSize: 12, marginTop: 2 },
});
