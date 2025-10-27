// app/admin/Absensi.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Platform,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Alert,
} from "react-native";
import {
  getHistory,
  getSummary,
  adminUpsert,
  type AbsenRow,
  type Totals,
} from "../../../services/attendance";
import { SafeAreaView } from "react-native-safe-area-context";

/* ===== Utils ===== */
const todayStr = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const nowTime = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// tinggi standar komponen form
const FIELD_H = 44;

/* ===== Kolom tabel (px) ===== */
const COLS = {
  nama: 160,
  tanggal: 120,
  jamMasuk: 110,
  jamKeluar: 110,
  ket: 120,
  alasan: 220,
  aksi: 90,
};
const TABLE_WIDTH =
  COLS.nama + COLS.tanggal + COLS.jamMasuk + COLS.jamKeluar + COLS.ket + COLS.alasan + COLS.aksi;

type StatusKey = "HADIR" | "IZIN" | "SAKIT" | "ALPHA";

export default function AbsensiAdminScreen() {
  const [rows, setRows] = useState<AbsenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  // Default 1 hari: start=end=today
  const [start, setStart] = useState<string | undefined>(todayStr());
  const [end, setEnd] = useState<string | undefined>(todayStr());
  const [err, setErr] = useState<string | null>(null);

  const [sumWeek, setSumWeek] = useState<Totals | null>(null);
  const [sumMonth, setSumMonth] = useState<Totals | null>(null);

  // Modal Rekap (detail nama + count)
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalItems, setModalItems] = useState<({ name: string; count: number })[]>([]);

  // Modal Form (Tambah/Edit)
  const [formVisible, setFormVisible] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [form, setForm] = useState({
    id: undefined as number | undefined,
    user_id: "" as string,
    tanggal: todayStr(),
    jam_masuk: "",
    jam_keluar: "",
    status: "HADIR" as StatusKey,
    alasan: "",
  });
  const resetForm = () =>
    setForm({
      id: undefined,
      user_id: "",
      tanggal: todayStr(),
      jam_masuk: "",
      jam_keluar: "",
      status: "HADIR",
      alasan: "",
    });

  // Debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filters = useMemo(() => ({ q, start, end }), [q, start, end]);
  const loadAll = useCallback(async () => {
    try {
      setErr(null);
      setLoading(true);
      const [list, w, m] = await Promise.all([
        getHistory({ q, start, end, limit: 300 }),
        getSummary("week"),
        getSummary("month"),
      ]);
      setRows(list);
      setSumWeek(w.totals);
      setSumMonth(m.totals);
    } catch (e: any) {
      setErr(e?.message || "Gagal memuat data");
      setRows([]);
      setSumWeek(null);
      setSumMonth(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, start, end]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadAll(), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, loadAll]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAll();
  }, [loadAll]);

  // Modal Rekap → ambil nama + jumlah sesuai range & status
  const handleKpiPress = useCallback(async (range: "week" | "month", status: StatusKey) => {
    try {
      setModalVisible(true);
      setModalLoading(true);
      setModalTitle(
        `Detail ${status} • ${range === "week" ? "7 Hari Terakhir" : "30 Hari Terakhir"}`
      );

      const endD = todayStr();
      const startObj =
        range === "week"
          ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const sStr = `${startObj.getFullYear()}-${pad(startObj.getMonth() + 1)}-${pad(
        startObj.getDate()
      )}`;

      const hist = await getHistory({ start: sStr, end: endD, limit: 2000 });
      const filtered = hist.filter((r) => (r.keterangan || "").toUpperCase() === status);

      const counts = new Map<string, number>();
      for (const r of filtered) {
        const name = (r.nama || "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const items = Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"));

      setModalItems(items);
    } catch (e: any) {
      setModalItems([{ name: `(Gagal memuat: ${e?.message || "unknown"})`, count: 0 }]);
    } finally {
      setModalLoading(false);
    }
  }, []);

  // Open Tambah
  const openCreate = () => {
    setFormMode("create");
    resetForm(); // jam_masuk & jam_keluar kosong
    setFormVisible(true);
  };
  // Open Edit
  const openEdit = (row: AbsenRow) => {
    setFormMode("update");
    setForm({
      id: row.id,
      user_id: String(row.user_id ?? ""),
      tanggal: row.tanggal ?? todayStr(),
      jam_masuk: row.jam_masuk ?? "",
      jam_keluar: row.jam_keluar ?? "",
      status: ((row.keterangan || "HADIR").toUpperCase() as StatusKey),
      alasan: row.alasan ?? "",
    });
    setFormVisible(true);
  };

  // Submit Tambah/Edit
  const submitForm = async () => {
    try {
      if (!form.user_id || !form.tanggal) {
        Alert.alert("Validasi", "user_id dan tanggal wajib diisi.");
        return;
      }
      const payload = {
        mode: formMode, // "create" | "update"
        id: form.id,
        user_id: Number(form.user_id),
        tanggal: form.tanggal,
        jam_masuk: form.jam_masuk || null,
        jam_keluar: form.jam_keluar || null,
        status: form.status,
        alasan: form.alasan || null,
      };
      const res = await adminUpsert(payload);
      if (!res?.success) throw new Error(res?.message || "Gagal menyimpan");
      setFormVisible(false);
      await loadAll();
      Alert.alert("Sukses", formMode === "create" ? "Data ditambahkan." : "Data diperbarui.");
    } catch (e: any) {
      Alert.alert("Gagal", e?.message || "Gagal menyimpan data.");
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Memuat riwayat absen…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safe]}>
      <View style={s.page}>
        <View style={s.topbar}>
          <Text style={s.title}>Riwayat Absensi (Admin)</Text>
          <Pressable style={s.btnPrimary} onPress={openCreate}>
            <Text style={s.btnPrimaryText}>+ Tambah Data</Text>
          </Pressable>
        </View>

        {/* Filter */}
        <View style={s.filters}>
          <TextInput
            placeholder="Cari nama/email…"
            value={q}
            onChangeText={setQ}
            style={s.input}
            autoCapitalize="none"
          />
          <View style={s.row}>
            <TextInput
              placeholder="Start (YYYY-MM-DD)"
              value={start ?? ""}
              onChangeText={(t) => {
                const v = t || undefined;
                setStart(v);
                if (!end && v) setEnd(v);
              }}
              style={[s.input, s.flex1]}
              autoCapitalize="none"
            />
            <TextInput
              placeholder="End (YYYY-MM-DD)"
              value={end ?? ""}
              onChangeText={(t) => setEnd(t || undefined)}
              style={[s.input, s.flex1]}
              autoCapitalize="none"
            />
          </View>
        </View>

        {err && (
          <View style={s.errBox}>
            <Text style={s.errText}>{err}</Text>
          </View>
        )}

        {/* Tabel */}
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingBottom: 8 }}>
          <View style={{ width: TABLE_WIDTH }}>
            <FlatList
              style={{ marginTop: 12 }}
              data={rows}
              keyExtractor={(it) => String(it.id)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              stickyHeaderIndices={[0]}
              ListHeaderComponent={<TableHeader />}
              renderItem={({ item }) => <TableRow item={item} onEdit={() => openEdit(item)} />}
              ListEmptyComponent={<Text style={s.empty}>Tidak ada data.</Text>}
            />
          </View>
        </ScrollView>

        {/* Rekap */}
        <View style={{ gap: 12, marginTop: 14, marginBottom: Platform.OS === "ios" ? 10 : 4 }}>
          <Card title="Rekap 7 Hari Terakhir">
            {sumWeek ? (
              <KPI totals={sumWeek} onPress={(label) => handleKpiPress("week", label as StatusKey)} />
            ) : (
              <Text style={s.muted}>-</Text>
            )}
          </Card>
          <Card title="Rekap 30 Hari Terakhir">
            {sumMonth ? (
              <KPI totals={sumMonth} onPress={(label) => handleKpiPress("month", label as StatusKey)} />
            ) : (
              <Text style={s.muted}>-</Text>
            )}
          </Card>
        </View>
      </View>

      {/* Modal Rekap (nama + count) */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>{modalTitle}</Text>
            <View style={{ maxHeight: 320 }}>
              {modalLoading ? (
                <View style={[s.center, { paddingVertical: 20 }]}>
                  <ActivityIndicator />
                  <Text style={{ marginTop: 8 }}>Memuat detail…</Text>
                </View>
              ) : (
                <ScrollView>
                  {modalItems.length === 0 ? (
                    <Text style={s.muted}>Tidak ada data.</Text>
                  ) : (
                    modalItems.map((it, idx) => (
                      <View key={idx} style={s.modalRow}>
                        <Text style={s.modalItem} numberOfLines={1}>
                          • {it.name || "-"}
                        </Text>
                        <Text style={s.modalCount}>{it.count}x</Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
            </View>
            <Pressable style={s.modalBtn} onPress={() => setModalVisible(false)}>
              <Text style={s.modalBtnText}>Tutup</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal Form Tambah/Edit */}
      <Modal
        visible={formVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFormVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.formCard}>
            <Text style={s.modalTitle}>
              {formMode === "create" ? "Tambah Data Absensi" : "Edit Data Absensi"}
            </Text>

            <View style={{ gap: 10 }}>
              <View style={s.formRow}>
                <Text style={s.formLabel}>User ID</Text>
                <TextInput
                  style={s.formInput}
                  keyboardType="number-pad"
                  value={form.user_id}
                  onChangeText={(t) => setForm((f) => ({ ...f, user_id: t }))}
                  placeholder="contoh: 7"
                />
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Tanggal</Text>
                <TextInput
                  style={s.formInput}
                  value={form.tanggal}
                  onChangeText={(t) => setForm((f) => ({ ...f, tanggal: t }))}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                />
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Jam Masuk</Text>
                <View style={s.inputWithBtns}>
                  <TextInput
                    style={[s.formInput, { flex: 1 }]}
                    value={form.jam_masuk}
                    onChangeText={(t) => setForm((f) => ({ ...f, jam_masuk: t }))}
                    placeholder="HH:MM:SS"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                  />
                  <Pressable
                    style={s.btnTiny}
                    onPress={() => setForm((f) => ({ ...f, jam_masuk: nowTime() }))}
                  >
                    <Text style={s.btnTinyText}>Now</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btnTiny, s.btnTinyGhost]}
                    onPress={() => setForm((f) => ({ ...f, jam_masuk: "" }))}
                  >
                    <Text style={[s.btnTinyText, s.btnTinyTextGhost]}>Clear</Text>
                  </Pressable>
                </View>
              </View>

              {/* Jam Keluar */}
              <View style={s.formRow}>
                <Text style={s.formLabel}>Jam Keluar</Text>
                <View style={s.inputWithBtns}>
                  <TextInput
                    style={[s.formInput, { flex: 1 }]}
                    value={form.jam_keluar}
                    onChangeText={(t) => setForm((f) => ({ ...f, jam_keluar: t }))}
                    placeholder="HH:MM:SS"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                  />
                  <Pressable
                    style={s.btnTiny}
                    onPress={() => setForm((f) => ({ ...f, jam_keluar: nowTime() }))}
                  >
                    <Text style={s.btnTinyText}>Now</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btnTiny, s.btnTinyGhost]}
                    onPress={() => setForm((f) => ({ ...f, jam_keluar: "" }))}
                  >
                    <Text style={[s.btnTinyText, s.btnTinyTextGhost]}>Clear</Text>
                  </Pressable>
                </View>
              </View>

              {/* Status (dropdown) */}
              <View style={s.formRow}>
                <Text style={s.formLabel}>Status</Text>
                <Pressable style={s.formSelect} onPress={() => setStatusPickerOpen(true)}>
                  <Text style={s.formSelectText}>{form.status}</Text>
                </Pressable>
              </View>

              {/* Picker Status */}
              <Modal
                visible={statusPickerOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setStatusPickerOpen(false)}
              >
                <View style={s.modalBackdrop}>
                  <View style={s.selectCard}>
                    {(["HADIR", "IZIN", "SAKIT", "ALPHA"] as StatusKey[]).map((opt) => (
                      <Pressable
                        key={opt}
                        style={[s.selectItem, form.status === opt && s.selectItemActive]}
                        onPress={() => {
                          setForm((f) => ({ ...f, status: opt }));
                          setStatusPickerOpen(false);
                        }}
                      >
                        <Text
                          style={[
                            s.selectItemText,
                            form.status === opt && s.selectItemTextActive,
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    ))}

                    <Pressable
                      style={[s.modalBtn, { alignSelf: "stretch", marginTop: 10 }]}
                      onPress={() => setStatusPickerOpen(false)}
                    >
                      <Text style={s.modalBtnText}>Tutup</Text>
                    </Pressable>
                  </View>
                </View>
              </Modal>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Alasan</Text>
                <TextInput
                  style={[s.formInput, { height: 80 }]}
                  value={form.alasan}
                  onChangeText={(t) => setForm((f) => ({ ...f, alasan: t }))}
                  placeholder="opsional"
                  multiline
                />
              </View>
            </View>

            <View style={s.formActions}>
              <Pressable style={s.btnGhost} onPress={() => setFormVisible(false)}>
                <Text style={s.btnGhostText}>Batal</Text>
              </Pressable>
              <Pressable style={s.btnPrimary} onPress={submitForm}>
                <Text style={s.btnPrimaryText}>
                  {formMode === "create" ? "Simpan" : "Update"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ====== Tabel ====== */
function TableHeader() {
  return (
    <View style={[s.thead, { width: TABLE_WIDTH }]}>
      <Text style={th(COLS.nama)}>Nama</Text>
      <Text style={th(COLS.tanggal)}>Tanggal</Text>
      <Text style={th(COLS.jamMasuk)}>Jam Masuk</Text>
      <Text style={th(COLS.jamKeluar)}>Jam Keluar</Text>
      <Text style={th(COLS.ket)}>Keterangan</Text>
      <Text style={th(COLS.alasan)}>Alasan</Text>
      <Text style={th(COLS.aksi)}>Aksi</Text>
    </View>
  );
}

function TableRow({ item, onEdit }: { item: AbsenRow; onEdit: () => void }) {
  return (
    <View style={[s.trow, { width: TABLE_WIDTH }]}>
      <Text style={td(COLS.nama)} numberOfLines={1}>
        {item.nama}
      </Text>
      <Text style={td(COLS.tanggal)}>{item.tanggal}</Text>
      <Text style={td(COLS.jamMasuk)}>{item.jam_masuk ?? "-"}</Text>
      <Text style={td(COLS.jamKeluar)}>{item.jam_keluar ?? "-"}</Text>
      <Text style={td(COLS.ket)}>{item.keterangan}</Text>
      <Text style={td(COLS.alasan)} numberOfLines={1}>
        {item.alasan || "-"}
      </Text>
      <View style={[td(COLS.aksi), { flexDirection: "row" }]}>
        <Pressable style={s.btnMini} onPress={onEdit}>
          <Text style={s.btnMiniText}>Edit</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ====== Cards & KPI ====== */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function KPI({
  totals,
  onPress,
}: {
  totals: Totals;
  onPress: (label: "HADIR" | "IZIN" | "SAKIT" | "ALPHA") => void;
}) {
  return (
    <View style={s.kpiWrap}>
      <Badge label={`Hadir: ${totals.hadir}`} onPress={() => onPress("HADIR")} />
      <Badge label={`Izin: ${totals.izin}`} onPress={() => onPress("IZIN")} />
      <Badge label={`Sakit: ${totals.sakit}`} onPress={() => onPress("SAKIT")} />
      <Badge label={`Alpha: ${totals.alpha}`} onPress={() => onPress("ALPHA")} />
    </View>
  );
}

function Badge({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable style={s.badge} onPress={onPress}>
      <Text style={s.badgeText}>{label}</Text>
    </Pressable>
  );
}

/* ====== Styles ====== */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F8FAFC" },
  page: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 20, fontWeight: "800", color: "#0B57D0", marginVertical: 10 },
  filters: { marginTop: 4, gap: 8, marginBottom: 6 },
  hint: { color: "#6B7280", fontSize: 12 },
  row: { flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  flex1: { flex: 1 },
  errBox: {
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errText: { color: "#B91C1C" },
  thead: {
    backgroundColor: "#EEF3FF",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#DBE5FF",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  trow: {
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#EEF1F6",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 18 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EEF1F6" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 8 },
  kpiWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  badge: {
    backgroundColor: "#EEF3FF",
    borderWidth: 1,
    borderColor: "#DBE5FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: "#1D4ED8", fontWeight: "600", fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: "#6B7280" },

  // Buttons
  btnPrimary: {
    backgroundColor: "#0B57D0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    borderColor: "#CBD5E1",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnGhostText: { color: "#111827", fontWeight: "700" },
  btnMini: {
    backgroundColor: "#EEF3FF",
    borderColor: "#DBE5FF",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  btnMiniText: { color: "#1D4ED8", fontWeight: "700", fontSize: 12 },

  // Modal umum
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  modalTitle: { 
    fontWeight: "800", 
    fontSize: 16, 
    marginBottom: 8, 
    color: "#111827" 
  },
  modalRow: { 
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "space-between", 
    paddingVertical: 6 
  },
  modalItem: { 
    fontSize: 14, 
    color: "#111827", 
    flexShrink: 1, 
    paddingRight: 8 
  },
  modalCount: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0B57D0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "#EEF3FF",
  },
  modalBtn: {
    alignSelf: "flex-end",
    marginTop: 12,
    backgroundColor: "#0B57D0",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalBtnText: { color: "#fff", fontWeight: "700" },

  // Modal Form
  formCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  formRow: { 
    gap: 6, 
    marginBottom: 10 
  },
  formLabel: { 
    fontSize: 12, 
    color: "#6B7280", 
    marginLeft: 2 
  },
  formInput: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: FIELD_H,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  inputWithBtns: {
    flexDirection: "row", 
    alignItems: "center", 
    gap: 8 
  },
  btnTiny: {
    backgroundColor: "#0B57D0",
    paddingHorizontal: 12,
    height: FIELD_H,
    minWidth: 64,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  btnTinyText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  btnTinyGhost: { backgroundColor: "#EEF3FF", borderWidth: 1, borderColor: "#DBE5FF" },
  btnTinyTextGhost: { color: "#1D4ED8" },
  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },

  // Select Status
  formSelect: {
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  formSelectText: { color: "#111827", fontWeight: "700" },
  selectCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  selectItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 8,
  },
  selectItemActive: { backgroundColor: "#EEF3FF", borderColor: "#DBE5FF" },
  selectItemText: { color: "#111827", fontWeight: "600" },
  selectItemTextActive: { color: "#0B57D0" },
});

/* helper style untuk header/sel tabel */
function th(width: number) {
  return { width, fontWeight: "800", color: "#1E3A8A", fontSize: 12 } as const;
}
function td(width: number) {
  return { width, color: "#111827", fontSize: 13 } as const;
}
