// app/user/Izin.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE, joinURL } from "../../config";

const API_IZIN = joinURL(API_BASE, "izin/izin_list.php");

/* =============== Types =============== */
type IzinRow = {
  id: number;
  user_id: number;
  nama: string;
  keterangan: "IZIN" | "SAKIT";
  alasan: string;
  status: "pending" | "disetujui" | "ditolak";
  tanggal_mulai: string;     // "YYYY-MM-DD"
  tanggal_selesai: string;   // "YYYY-MM-DD"
  created_at?: string;
};

async function fetchText(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
}
async function parseJSON(text: string) {
  try { return JSON.parse(text); } catch { throw new Error(`Response bukan JSON:\n${text}`); }
}

/* =============== Current User (from AsyncStorage "auth") =============== */
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

const NOTIF_KEY = "izin_last_notified"; // map id->status biar ga dobel popup
const SESSION_KEY_PREFIX = "izin_session_done_"; // notif cuma sekali per login

async function getLastNotified(): Promise<Record<string, IzinStatus>> {
  try {
    const s = await AsyncStorage.getItem(NOTIF_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}
async function setLastNotified(map: Record<string, IzinStatus>) {
  try { await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(map)); } catch {}
}
async function getSessionDone(userId: number): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(SESSION_KEY_PREFIX + String(userId));
    return v === "1";
  } catch { return false; }
}
async function setSessionDone(userId: number): Promise<void> {
  try { await AsyncStorage.setItem(SESSION_KEY_PREFIX + String(userId), "1"); } catch {}
}

/* Normalisasi status biar “acc/approved/…” jadi disetujui, dsb */
function normStatus(s: any): IzinStatus {
  const t = String(s ?? "pending").trim().toLowerCase();
  if (["disetujui","approve","approved","acc","accepted","setuju","ok","approved_by_admin"].includes(t)) return "disetujui";
  if (["ditolak","reject","rejected","tolak","no","denied"].includes(t)) return "ditolak";
  return "pending";
}

/* =============== Utils =============== */
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const todayYmd = () => new Date().toLocaleDateString("sv-SE"); // e.g. 2025-10-24
const KETERANGAN_OPTS = ["IZIN", "SAKIT"] as const;
type KeteranganEnum = typeof KETERANGAN_OPTS[number];

/* =============== Screen =============== */
export default function Izin() {
  const { user: currentUser, loading: userLoading } = useCurrentUser();

  const [rows, setRows] = useState<IzinRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // search
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => setAppliedQ(q.trim().toLowerCase()), 250);
  }, [q]);

  /* ====== Modal Notifikasi Status (sekali saat first load per session) ====== */
  const [notif, setNotif] = useState<{ visible: boolean; item?: IzinRow }>({ visible: false });
  const showNotif = useCallback((item: IzinRow) => setNotif({ visible: true, item }), []);
  const firstLoadNotifiedRef = useRef(false);

  const runFirstLoginNotify = useCallback(async (uid: number, list: IzinRow[]) => {
    if (firstLoadNotifiedRef.current) return;          // sudah notif di sesi ini
    const sessionDone = await getSessionDone(uid);
    if (sessionDone) return;                           // sesi sudah “done”, jangan popup lagi

    const notified = await getLastNotified();          // cache status-notified sebelumnya
    const finals = list.filter(it => {
      const cur = normStatus(it.status);
      return cur === "disetujui" || cur === "ditolak";
    });

    // cari 1 item final yang status-nya belum pernah kita notify (atau berubah)
    const trigger = finals.find(it => {
      const id = String(it.id);
      const cur = normStatus(it.status);
      return notified[id] !== cur;
    });

    if (trigger) {
      showNotif(trigger);
    }

    // tandai semua final sebagai “sudah diberitahu” supaya login berikutnya tidak muncul yang lama
    let dirty = false;
    for (const it of finals) {
      const id = String(it.id);
      const cur = normStatus(it.status);
      if (notified[id] !== cur) {
        notified[id] = cur;
        dirty = true;
      }
    }
    if (dirty) await setLastNotified(notified);

    // kunci sesi: setelah first load, stop notif sampai user login lagi
    firstLoadNotifiedRef.current = true;
    await setSessionDone(uid);
  }, [showNotif]);

  /* ====== LOAD with user_id filter ====== */
  const loadData = useCallback(async (uid: number) => {
      const url = `${API_IZIN}?user_id=${encodeURIComponent(String(uid))}`;

      console.log("[IZIN] API_BASE:", API_BASE);
      console.log("[IZIN] GET URL:", url);

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
        keterangan: (String(r.keterangan ?? "IZIN").toUpperCase() as IzinRow["keterangan"]),
        alasan: String(r.alasan ?? ""),
        status: normStatus(r.status),
        tanggal_mulai: String(r.tanggal_mulai ?? r.mulai ?? ""),
        tanggal_selesai: String(r.tanggal_selesai ?? r.selesai ?? ""),
        created_at: r.created_at ? String(r.created_at) : undefined,
      }));

      setRows(normalized);

      // 🔔 Notif hanya sekali di first load per session
      await runFirstLoginNotify(uid, normalized);

    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal memuat data izin");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [runFirstLoginNotify]);

  // trigger after user ready
  useEffect(() => {
    if (currentUser) loadData(currentUser.id);
  }, [currentUser, loadData]);

  // Polling ringan tiap 20 detik untuk refresh data (TANPA popup)
  useEffect(() => {
    if (!currentUser) return;
    const t = setInterval(() => loadData(currentUser.id), 20000);
    return () => clearInterval(t);
  }, [currentUser, loadData]);

  const onRefresh = () => {
    if (!currentUser) return;
    setRefreshing(true);
    loadData(currentUser.id);
  };

  const filtered = useMemo(() => {
    if (!appliedQ) return rows;
    return rows.filter(r =>
      r.nama.toLowerCase().includes(appliedQ) ||
      r.keterangan.toLowerCase().includes(appliedQ) ||
      r.alasan.toLowerCase().includes(appliedQ) ||
      r.status.toLowerCase().includes(appliedQ) ||
      r.tanggal_mulai.includes(appliedQ) ||
      r.tanggal_selesai.includes(appliedQ)
    );
  }, [rows, appliedQ]);

  /* ====== Modal Form State ====== */
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

  const submitForm = useCallback(async () => {
    if (!currentUser) {
      Alert.alert("Error", "Data pengguna belum siap. Coba lagi sebentar.");
      return;
    }
    const userId = currentUser.id;

    const keterangan = form.keterangan; // "IZIN" | "SAKIT"
    const alasan = (keterangan === "IZIN") ? form.alasan.trim() : ""; // wajib saat IZIN
    const mulai = form.tanggal_mulai.trim();
    const selesai = form.tanggal_selesai.trim();

    if (!isYmd(mulai) || !isYmd(selesai)) return Alert.alert("Error", "Tanggal harus format YYYY-MM-DD");
    if (selesai < mulai) return Alert.alert("Error", "Tanggal selesai tidak boleh sebelum tanggal mulai");
    if (keterangan === "IZIN" && !alasan) return Alert.alert("Error", "Alasan wajib diisi untuk keterangan IZIN");

    try {
      const payload = {
        user_id: userId,
        keterangan,           // "IZIN" / "SAKIT"
        alasan,               // "" saat SAKIT
        tanggal_mulai: mulai,
        tanggal_selesai: selesai,
      };
      const { ok, status, statusText, text } = await fetchText(API_IZIN, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!ok) throw new Error(`HTTP ${status} ${statusText}\n${text}`);
      const j = await parseJSON(text);
      if (j.success !== true) throw new Error(j.message || "Gagal mengajukan izin");

      Alert.alert("Sukses", "Pengajuan izin terkirim. Status: pending.");
      setModalVisible(false);
      setForm({
        keterangan: "IZIN",
        alasan: "",
        tanggal_mulai: todayYmd(),
        tanggal_selesai: todayYmd(),
      });
      loadData(userId); // refresh list user ini
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal mengajukan izin");
    }
  }, [currentUser, form, loadData]);

  /* ====== Guards ====== */
  if (userLoading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Memuat data pengguna…</Text>
      </SafeAreaView>
    );
  }
  if (!currentUser) {
    return (
      <SafeAreaView style={st.container}>
        <Text style={{ marginTop: 10, textAlign: "center" }}>
          Sesi tidak ditemukan. Silakan login ulang.
        </Text>
      </SafeAreaView>
    );
  }
  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 10 }}>Memuat data…</Text>
      </SafeAreaView>
    );
  }

  /* ====== List Row ====== */
  const renderItem = ({ item }: { item: IzinRow }) => {
    const badgeStyle =
      item.status === "pending" ? st.badgePending :
      item.status === "disetujui" ? st.badgeApproved :
      st.badgeRejected;

    return (
      <View style={st.row}>
        <Text style={[st.cell, st.left,   { width: 140 }]} numberOfLines={1}>{item.nama}</Text>
        <Text style={[st.cell, st.left,   { width: 90  }]}>{item.keterangan}</Text>
        <Text style={[st.cell, st.left,   { width: 90  }]} numberOfLines={1}>{item.tanggal_mulai}</Text>
        <Text style={[st.cell, st.left,   { width: 90  }]} numberOfLines={1}>{item.tanggal_selesai}</Text>
        <Text style={[st.cell, st.left,   { width: 240 }]} numberOfLines={2}>{item.alasan}</Text>
        <View style={{ width: 110, alignItems: "flex-end" }}>
          <Text style={[st.badge, badgeStyle]}>{item.status}</Text>
        </View>
      </View>
    );
  };

  /* ====== UI ====== */
  return (
    <SafeAreaView style={st.container}>
      {/* Header */}
      <View style={st.headerWrap}>
        <Text style={st.headerTitle}>Pengajuan Izin</Text>
        <TouchableOpacity style={st.addBtn} onPress={() => setModalVisible(true)}>
          <Text style={st.addBtnText}>+ Tambah</Text>
        </TouchableOpacity>
      </View>

      {/* Card Pencarian */}
      <View style={st.card}>
        <TextInput
          placeholder="Cari nama/keterangan/alasan/status/tanggal"
          value={q}
          onChangeText={setQ}
          style={st.searchInput}
        />
        <Text style={st.hint}>Status baru dibuat otomatis <Text style={{fontWeight: "800"}}>pending</Text>.</Text>
      </View>

      {/* Tabel */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: 820 }}>
          <View style={st.tableHeader}>
            <Text style={[st.th, { width: 140, textAlign: "left" }]}>Nama</Text>
            <Text style={[st.th, { width: 90,  textAlign: "left" }]}>Ket.</Text>
            <Text style={[st.th, { width: 90,  textAlign: "left" }]}>Mulai</Text>
            <Text style={[st.th, { width: 90,  textAlign: "left" }]}>Selesai</Text>
            <Text style={[st.th, { width: 240, textAlign: "left" }]}>Alasan</Text>
            <Text style={[st.th, { width: 110, textAlign: "right" }]}>Status</Text>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderItem}
            refreshing={refreshing}
            onRefresh={onRefresh}
            ListEmptyComponent={
              <View style={st.empty}>
                <Text style={st.emptyText}>Belum ada pengajuan izin.</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 10 }}
          />
        </View>
      </ScrollView>

      {/* Modal Form */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={st.modalBg}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Form Pengajuan Izin</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {/* Nama user (read-only) */}
              <Text style={st.label}>Nama</Text>
              <TextInput style={[st.input, { backgroundColor: "#f8fafc" }]} value={currentUser.name} editable={false} />

              {/* Keterangan (enum) */}
              <Text style={st.label}>Keterangan</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                {KETERANGAN_OPTS.map((opt) => {
                  const active = form.keterangan === opt;
                  return (
                    <TouchableOpacity
                      key={opt}
                      onPress={() => setForm((p) => ({ ...p, keterangan: opt, ...(opt === "SAKIT" ? { alasan: "" } : {}) }))}
                      style={[st.segmentBtn, active ? st.segmentBtnActive : st.segmentBtnInactive]}
                    >
                      <Text style={active ? st.segmentTextActive : st.segmentTextInactive}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Tanggal */}
              <Text style={st.label}>Tanggal Mulai (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="YYYY-MM-DD"
                style={st.input}
                value={form.tanggal_mulai}
                onChangeText={(t) => setForm((p) => ({ ...p, tanggal_mulai: t }))}
                keyboardType="number-pad"
              />

              <Text style={st.label}>Tanggal Selesai (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="YYYY-MM-DD"
                style={st.input}
                value={form.tanggal_selesai}
                onChangeText={(t) => setForm((p) => ({ ...p, tanggal_selesai: t }))}
                keyboardType="number-pad"
              />

              {/* Alasan → hanya saat IZIN */}
              {form.keterangan === "IZIN" && (
                <>
                  <Text style={st.label}>Alasan</Text>
                  <TextInput
                    placeholder="Jelaskan alasannya..."
                    style={[st.input, { height: 90 }]}
                    value={form.alasan}
                    onChangeText={(t) => setForm((p) => ({ ...p, alasan: t }))}
                    multiline
                  />
                </>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", marginTop: 12 }}>
             <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#ef4444" }]} onPress={() => setModalVisible(false)}>
                <Text style={st.modalBtnText}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#16a34a", marginLeft: 8 }]} onPress={submitForm}>
                <Text style={st.modalBtnText}>Kirim</Text>
              </TouchableOpacity>             
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Notifikasi Status */}
      <Modal
        visible={notif.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setNotif({ visible: false })}
      >
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "center", alignItems: "center", padding: 16
        }}>
          <View style={{
            width: "92%", backgroundColor: "#fff", borderRadius: 14,
            padding: 14, borderWidth: 1, borderColor: "#e5e7eb"
          }}>
            <Text style={{ fontSize: 16, fontWeight: "900", color: "#0f172a", marginBottom: 8 }}>
              Status Pengajuan Diperbarui
            </Text>

            {notif.item ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: "#0f172a" }}>
                  <Text style={{ fontWeight: "800" }}>{notif.item.nama}</Text> • {notif.item.keterangan}
                </Text>
                <Text style={{ color: "#0f172a" }}>
                  Periode: <Text style={{ fontWeight: "800" }}>{notif.item.tanggal_mulai}</Text>
                  {"  "}→{"  "}
                  <Text style={{ fontWeight: "800" }}>{notif.item.tanggal_selesai}</Text>
                </Text>
                <Text style={{ color: "#64748b" }} numberOfLines={3}>
                  {notif.item.alasan?.trim() ? `Alasan: ${notif.item.alasan}` : ""}
                </Text>

                <View style={{ marginTop: 8, alignItems: "flex-start" }}>
                  <Text style={[st.badge,
                    notif.item.status === "disetujui" ? st.badgeApproved :
                    notif.item.status === "ditolak" ? st.badgeRejected : st.badgePending
                  ]}>
                    {notif.item.status}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", marginTop: 12 }}>
              <TouchableOpacity
                style={[st.modalBtn, { backgroundColor: "#0b3ea4" }]}
                onPress={() => setNotif({ visible: false })}
              >
                <Text style={st.modalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* =============== Styles =============== */
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FC", paddingHorizontal: 14, paddingTop: 8 },
  headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 6 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: "#1e3a8a" },
  addBtn: { backgroundColor: "#0b3ea4", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10 },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  searchInput: { backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, marginBottom: 8 },
  hint: { marginTop: 6, color: "#64748b", fontSize: 11 },

  tableHeader: { backgroundColor: "#e8f0ff", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#dbe6ff" },
  th: { fontWeight: "800", color: "#1e40af", fontSize: 12, textAlign: "center" },

  row: { backgroundColor: "#fff", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#eef2f7" },
  cell: { color: "#0f172a", fontSize: 12 },
  left: { textAlign: "left" },

  empty: { paddingVertical: 16, alignItems: "center" },
  emptyText: { color: "#64748b", fontSize: 12 },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden", textTransform: "capitalize", fontWeight: "800" },
  badgePending: { backgroundColor: "#FEF3C7", color: "#92400E" },
  badgeApproved: { backgroundColor: "#DCFCE7", color: "#14532D" },
  badgeRejected: { backgroundColor: "#FEE2E2", color: "#991B1B" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
  modalCard: { width: "95%", backgroundColor: "#fff", borderRadius: 12, padding: 14 },
  modalTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 4, color: "#0f172a" },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10, backgroundColor: "#fff", fontSize: 13 },
  modalBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
  modalBtnText: { color: "#fff", fontWeight: "800" },

  // segmented control
  segmentBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1 },
  segmentBtnActive: { backgroundColor: "#0b3ea4", borderColor: "#0b3ea4" },
  segmentBtnInactive: { backgroundColor: "#fff", borderColor: "#c7d2fe" },
  segmentTextActive: { color: "#fff", fontWeight: "800" },
  segmentTextInactive: { color: "#0b3ea4", fontWeight: "800" },
});
