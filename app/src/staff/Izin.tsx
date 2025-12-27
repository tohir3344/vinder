// app/user/Izin.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pressable
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE, joinURL } from "../../config";
import { Ionicons } from "@expo/vector-icons";

const API_IZIN = joinURL(API_BASE, "izin/izin_list.php");

/* =============== Types =============== */
type IzinRow = {
  id: number;
  user_id: number;
  nama: string;
  keterangan: "IZIN" | "SAKIT";
  alasan: string;
  status: "pending" | "disetujui" | "ditolak";
  tanggal_mulai: string;
  tanggal_selesai: string;
  created_at?: string;
};

async function fetchText(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
}
async function parseJSON(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Response bukan JSON:\n${text}`);
  }
}

/* =============== Current User =============== */
function useCurrentUser() {
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const s = await AsyncStorage.getItem("auth");
        const a = s ? JSON.parse(s) : null;
        if (a) {
          const id = Number(a.user_id ?? a.id ?? 0);
          const name = String(a.nama_lengkap ?? a.username ?? a.name ?? "");
          if (id > 0 && name) {
            setUser({ id, name });
          } else {
            setUser(null);
          }
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return { user, loading };
}

/* =============== Notif Helpers =============== */
type IzinStatus = "pending" | "disetujui" | "ditolak";
const IZIN_SEEN_KEY = "izin_seen_status";

async function getSeenMap(): Promise<Record<string, IzinStatus>> {
  try {
    const s = await AsyncStorage.getItem(IZIN_SEEN_KEY);
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

async function setSeenMap(map: Record<string, IzinStatus>) {
  try {
    await AsyncStorage.setItem(IZIN_SEEN_KEY, JSON.stringify(map));
  } catch { }
}

function normStatus(s: any): IzinStatus {
  const t = String(s ?? "pending").trim().toLowerCase();
  if (["disetujui", "approve", "approved", "acc", "accepted", "setuju", "ok", "approved_by_admin"].includes(t)) return "disetujui";
  if (["ditolak", "reject", "rejected", "tolak", "no", "denied"].includes(t)) return "ditolak";
  return "pending";
}

/* =============== Utils =============== */
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const todayYmd = () => new Date().toLocaleDateString("sv-SE");

const KETERANGAN_OPTS = ["IZIN", "SAKIT"] as const;
type KeteranganEnum = (typeof KETERANGAN_OPTS)[number];

/* =============== Screen =============== */
export default function Izin() {
  const { user: currentUser, loading: userLoading } = useCurrentUser();
  const [rows, setRows] = useState<IzinRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setAppliedQ(q.trim().toLowerCase()), 250);
  }, [q]);

  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<{
    keterangan: KeteranganEnum;
    alasan: string;
    tanggal_mulai: string;
    tanggal_selesai: string;
  }>({
    keterangan: "IZIN",
    alasan: "",
    tanggal_mulai: todayYmd(),
    tanggal_selesai: todayYmd(),
  });

  const [showInfo, setShowInfo] = useState(false);

  const checkStatusAndAlert = useCallback(async (list: IzinRow[]) => {
    const seen = await getSeenMap();
    const finals = list.filter((it) => it.status === "disetujui" || it.status === "ditolak");
    const changed = finals.filter((it) => seen[String(it.id)] !== it.status);

    if (changed.length === 0) return;

    changed.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at.replace(" ", "T")).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at.replace(" ", "T")).getTime() : 0;
      return tb - ta;
    });

    const item = changed[0];
    const title = item.status === "disetujui" ? "Pengajuan Izin Disetujui" : "Pengajuan Izin Ditolak";
    const msgLines = [
      `${item.nama} • ${item.keterangan}`,
      `Periode: ${item.tanggal_mulai} → ${item.tanggal_selesai}`,
      item.alasan?.trim() ? `Alasan: ${item.alasan}` : "",
    ].filter(Boolean);

    Alert.alert(title, msgLines.join("\n"));

    const nextSeen = { ...seen };
    for (const it of finals) { nextSeen[String(it.id)] = it.status; }
    await setSeenMap(nextSeen);
  }, []);

  const loadData = useCallback(async (uid: number) => {
    const url = `${API_IZIN}?user_id=${encodeURIComponent(String(uid))}`;
    setLoading(true);
    try {
      const { ok, status, statusText, text } = await fetchText(url);
      if (!ok) throw new Error(`HTTP ${status} ${statusText}\n${text}`);
      const j = await parseJSON(text);
      const raw: any[] = j.rows ?? j.data ?? j.list ?? [];

      const normalized: IzinRow[] = raw.map((r: any) => ({
        id: Number(r.id),
        user_id: Number(r.user_id),
        nama: String(r.nama ?? r.name ?? ""),
        keterangan: String(r.keterangan ?? "IZIN").toUpperCase() as IzinRow["keterangan"],
        alasan: String(r.alasan ?? ""),
        status: normStatus(r.status),
        tanggal_mulai: String(r.tanggal_mulai ?? r.mulai ?? ""),
        tanggal_selesai: String(r.tanggal_selesai ?? r.selesai ?? ""),
        created_at: r.created_at ? String(r.created_at) : undefined,
      }));

      setRows(normalized);
      await checkStatusAndAlert(normalized);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal memuat data izin");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [checkStatusAndAlert]);

  useEffect(() => {
    if (currentUser) loadData(currentUser.id);
  }, [currentUser, loadData]);

  const onRefresh = () => {
    if (!currentUser) return;
    setRefreshing(true);
    loadData(currentUser.id);
  };

  const filtered = useMemo(() => {
    if (!appliedQ) return rows;
    return rows.filter((r) =>
      r.nama.toLowerCase().includes(appliedQ) ||
      r.keterangan.toLowerCase().includes(appliedQ) ||
      r.alasan.toLowerCase().includes(appliedQ) ||
      r.status.toLowerCase().includes(appliedQ) ||
      r.tanggal_mulai.includes(appliedQ) ||
      r.tanggal_selesai.includes(appliedQ)
    );
  }, [rows, appliedQ]);

  const submitForm = useCallback(async () => {
    if (!currentUser) return Alert.alert("Error", "Data pengguna belum siap.");
    const userId = currentUser.id;
    const { keterangan, alasan, tanggal_mulai, tanggal_selesai } = form;
    const cleanAlasan = keterangan === "IZIN" ? alasan.trim() : "";

    if (!isYmd(tanggal_mulai) || !isYmd(tanggal_selesai)) return Alert.alert("Error", "Tanggal harus format YYYY-MM-DD");
    if (tanggal_selesai < tanggal_mulai) return Alert.alert("Error", "Tanggal selesai tidak valid");
    if (keterangan === "IZIN" && !cleanAlasan) return Alert.alert("Error", "Alasan wajib diisi untuk IZIN");

    try {
      const payload = { user_id: userId, keterangan, alasan: cleanAlasan, tanggal_mulai, tanggal_selesai };
      const { ok, text } = await fetchText(API_IZIN, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) throw new Error("Gagal kirim data");
      const j = await parseJSON(text);
      if (j.success !== true) throw new Error(j.message || "Gagal");

      Alert.alert("Sukses", "Pengajuan izin terkirim.");
      setModalVisible(false);
      setForm({ keterangan: "IZIN", alasan: "", tanggal_mulai: todayYmd(), tanggal_selesai: todayYmd() });
      loadData(userId);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal");
    }
  }, [currentUser, form, loadData]);

  if (userLoading) return <SafeAreaView style={st.container}><ActivityIndicator size="large" color="#6366f1" /></SafeAreaView>;
  if (!currentUser) return <SafeAreaView style={st.container}><Text>Sesi tidak ditemukan.</Text></SafeAreaView>;
  if (loading && !refreshing) return <SafeAreaView style={st.container}><ActivityIndicator size="large" color="#6366f1" /></SafeAreaView>;

  const renderItem = ({ item }: { item: IzinRow }) => {
    const badgeStyle = item.status === "pending" ? st.badgePending : item.status === "disetujui" ? st.badgeApproved : st.badgeRejected;
    return (
      <View style={st.row}>
        <Text style={[st.cell, { width: 140 }]} numberOfLines={1}>{item.nama}</Text>
        <Text style={[st.cell, { width: 90 }]}>{item.keterangan}</Text>
        <Text style={[st.cell, { width: 90 }]}>{item.tanggal_mulai}</Text>
        <Text style={[st.cell, { width: 90 }]}>{item.tanggal_selesai}</Text>
        <Text style={[st.cell, { width: 240 }]} numberOfLines={2}>{item.alasan}</Text>
        <View style={{ width: 110, alignItems: "flex-end" }}>
          <Text style={[st.badge, badgeStyle]}>{item.status}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={st.container}>
      <View style={st.headerWrap}>
        <Text style={st.headerTitle}>Pengajuan Izin</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => setShowInfo(true)} style={st.infoBtn}>
            <Ionicons name="information-circle-outline" size={26} color="#A51C24" />
          </TouchableOpacity>
          <TouchableOpacity style={st.addBtn} onPress={() => setModalVisible(true)}>
            <Text style={st.addBtnText}>+ Tambah</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={st.card}>
        <TextInput placeholder="Cari data..." value={q} onChangeText={setQ} style={st.searchInput} placeholderTextColor="#94a3b8" />
        <Text style={st.hint}>Status default: <Text style={{ fontWeight: "800" }}>pending</Text>.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: 820 }}>
          <View style={st.tableHeader}>
            <Text style={[st.th, { width: 140, textAlign: "left" }]}>Nama</Text>
            <Text style={[st.th, { width: 90, textAlign: "left" }]}>Ket.</Text>
            <Text style={[st.th, { width: 90, textAlign: "left" }]}>Mulai</Text>
            <Text style={[st.th, { width: 90, textAlign: "left" }]}>Selesai</Text>
            <Text style={[st.th, { width: 240, textAlign: "left" }]}>Alasan</Text>
            <Text style={[st.th, { width: 110, textAlign: "right" }]}>Status</Text>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderItem}
            refreshing={refreshing}
            onRefresh={onRefresh}
            ListEmptyComponent={<View style={st.empty}><Text style={st.emptyText}>Belum ada data.</Text></View>}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        </View>
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Form Pengajuan Izin</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={st.label}>Nama</Text>
              <TextInput style={[st.input, { backgroundColor: "#f1f5f9", color: "#64748b" }]} value={currentUser.name} editable={false} />

              <Text style={st.label}>Keterangan</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                {KETERANGAN_OPTS.map((opt) => {
                  const active = form.keterangan === opt;
                  return (
                    <TouchableOpacity key={opt} onPress={() => setForm((p) => ({ ...p, keterangan: opt, ...(opt === "SAKIT" ? { alasan: "" } : {}) }))}
                      style={[st.segmentBtn, active ? st.segmentBtnActive : st.segmentBtnInactive]}>
                      <Text style={active ? st.segmentTextActive : st.segmentTextInactive}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={st.label}>Tanggal Mulai</Text>
              <TextInput placeholder="YYYY-MM-DD" style={st.input} value={form.tanggal_mulai} onChangeText={(t) => setForm((p) => ({ ...p, tanggal_mulai: t }))} keyboardType="number-pad" />

              <Text style={st.label}>Tanggal Selesai</Text>
              <TextInput placeholder="YYYY-MM-DD" style={st.input} value={form.tanggal_selesai} onChangeText={(t) => setForm((p) => ({ ...p, tanggal_selesai: t }))} keyboardType="number-pad" />

              {form.keterangan === "IZIN" && (
                <>
                  <Text style={st.label}>Alasan</Text>
                  <TextInput placeholder="Jelaskan alasannya..." style={[st.input, { height: 90, textAlignVertical: 'top' }]} value={form.alasan} onChangeText={(t) => setForm((p) => ({ ...p, alasan: t }))} multiline />
                </>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", marginTop: 15, gap: 10 }}>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#f1f5f9" }]} onPress={() => setModalVisible(false)}>
                <Text style={[st.modalBtnText, { color: "#475569" }]}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#A51C24" }]} onPress={submitForm}>
                <Text style={st.modalBtnText}>Kirim Pengajuan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={showInfo} animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <View style={m.overlay}>
          <View style={m.box}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <Text style={m.title}>Info Pengajuan</Text>
              <Pressable onPress={() => setShowInfo(false)}><Ionicons name="close" size={24} color="#94a3b8" /></Pressable>
            </View>
            <ScrollView style={{ marginBottom: 10 }}>
              <Text style={m.infoItem}>🏥 <Text style={{ fontWeight: 'bold', color: '#1e293b' }}>Sakit:</Text> Gunakan jika berhalangan karena kondisi kesehatan.</Text>
              <Text style={m.infoItem}>🏖️ <Text style={{ fontWeight: 'bold', color: '#1e293b' }}>Izin:</Text> Gunakan untuk keperluan pribadi lain. Wajib isi alasan.</Text>
              <Text style={m.infoItem}>📝 <Text style={{ fontWeight: 'bold', color: '#1e293b' }}>Status:</Text> Menunggu persetujuan Admin (Pending).</Text>
              <Text style={m.infoItem}>🔔 <Text style={{ fontWeight: 'bold', color: '#1e293b' }}>Notifikasi:</Text> Alert muncul jika status berubah.</Text>
            </ScrollView>
            <TouchableOpacity onPress={() => setShowInfo(false)} style={m.btn}>
              <Text style={m.btnText}>Mengerti</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* =============== Styles Updated =============== */
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", paddingHorizontal: 14, paddingTop: 8 },
  headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 10 },
  headerTitle: { fontSize: 22, fontWeight: "900", color: "#1e293b" },
  infoBtn: { padding: 5 },
  addBtn: { backgroundColor: "#A51C24", paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, elevation: 2 },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  card: { backgroundColor: "#fff", borderRadius: 16, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: "#e2e8f0", elevation: 1 },
  searchInput: { backgroundColor: "#f8fafc", borderRadius: 12, paddingHorizontal: 15, paddingVertical: 10, fontSize: 14, color: "#1e293b", borderWidth: 1, borderColor: "#e2e8f0" },
  hint: { marginTop: 8, color: "#94a3b8", fontSize: 12 },

  tableHeader: { backgroundColor: "#f1f5f9", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, flexDirection: "row", marginBottom: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  th: { fontWeight: "800", color: "#64748b", fontSize: 12 },

  row: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, flexDirection: "row", marginBottom: 8, borderWidth: 1, borderColor: "#f1f5f9", elevation: 1 },
  cell: { color: "#334155", fontSize: 13 },

  empty: { paddingVertical: 40, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },

  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, overflow: "hidden", textTransform: "uppercase", fontWeight: "800", fontSize: 10 },
  badgePending: { backgroundColor: "#fff7ed", color: "#ea580c" }, // Orange
  badgeApproved: { backgroundColor: "#f0fdf4", color: "#16a34a" }, // Green
  badgeRejected: { backgroundColor: "#fef2f2", color: "#dc2626" }, // Red

  modalBg: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.6)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 450, backgroundColor: "#fff", borderRadius: 24, padding: 20, elevation: 10 },
  modalTitle: { fontSize: 18, fontWeight: "900", marginBottom: 15, color: "#1e293b" },
  label: { fontSize: 13, fontWeight: "700", marginBottom: 6, color: "#475569", marginTop: 10 },
  input: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 15, paddingVertical: 12, fontSize: 14, color: "#1e293b", backgroundColor: "#fff" },
  modalBtn: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 14 },
  modalBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  segmentBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5 },
  segmentBtnActive: { backgroundColor: "#A51C24", borderColor: "#A51C24" },
  segmentBtnInactive: { backgroundColor: "#fff", borderColor: "#e2e8f0" },
  segmentTextActive: { color: "#fff", fontWeight: "800" },
  segmentTextInactive: { color: "#64748b", fontWeight: "800" },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.5)", alignItems: "center", justifyContent: "center", padding: 25 },
  box: { backgroundColor: "#fff", borderRadius: 24, width: "100%", padding: 24, elevation: 5 },
  title: { fontWeight: "900", fontSize: 20, color: "#1e293b" },
  btn: { backgroundColor: '#A51C24', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  infoItem: { marginBottom: 12, color: "#64748b", lineHeight: 22, fontSize: 14 },
});