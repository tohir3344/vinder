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
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";

import {
  getHistory,
  getSummary,
  adminUpsert,
  type AbsenRow,
  type Totals,
} from "../../../services/attendance";
import { API_BASE } from "../../config";

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

const fmtYMD = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtMonthYear = (d: Date) => {
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

const parseDateYmd = (val?: string) => {
  if (!val) return new Date();
  const parts = val.split("-");
  if (parts.length < 3) return new Date();

  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);

  if (!y || !m || !d) return new Date();
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
};

const getJamMasukColor = (timeStr?: string | null) => {
  if (!timeStr || timeStr === "-") return "#111827";
  const parts = timeStr.split(":");
  if (parts.length < 2) return "#111827";
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const totalMinutes = h * 60 + m;
  const LIMIT = 7 * 60 + 45;
  return totalMinutes <= LIMIT ? "#16a34a" : "#dc2626";
};

const getJamKeluarColor = (timeStr?: string | null) => {
  if (!timeStr || timeStr === "-") return "#111827";
  const parts = timeStr.split(":");
  if (parts.length < 2) return "#111827";
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const totalMinutes = h * 60 + m;
  const LIMIT = 17 * 60;
  return totalMinutes >= LIMIT ? "#16a34a" : "#dc2626";
};

const generateHtmlPdf = (rows: AbsenRow[], periodName: string) => {
  return `
    <html>
      <head>
        <style>
          body { font-family: 'Helvetica', sans-serif; padding: 20px; }
          h2 { text-align: center; color: #333; margin-bottom: 5px; }
          p { text-align: center; font-size: 12px; color: #666; margin-top: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10px; }
          th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
          th { background-color: #eee; }
          .status-hadir { color: green; font-weight: bold; }
          .status-absent { color: red; font-weight: bold; }
        </style>
      </head>
      <body>
        <h2>Laporan Absensi Bulanan</h2>
        <p>Periode: ${periodName}</p>
        <table>
          <thead>
            <tr>
              <th>Nama</th><th>Tanggal</th><th>Jam Masuk</th><th>Jam Keluar</th><th>Status</th><th>Alasan</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const isHadir = (row.keterangan || "").toUpperCase() === "HADIR";
              const pdfAlasan = isHadir ? "-" : (row.alasan || "-");
              return `
                <tr>
                  <td>${row.nama}</td>
                  <td>${row.tanggal}</td>
                  <td>${row.jam_masuk || "-"}</td>
                  <td>${row.jam_keluar || "-"}</td>
                  <td class="${row.keterangan === 'HADIR' ? 'status-hadir' : 'status-absent'}">
                    ${row.keterangan}
                  </td>
                  <td>${pdfAlasan}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;
};

const api = (path: string) => {
  const base = API_BASE.endsWith("/") ? API_BASE : `${API_BASE}/`;
  return base + path.replace(/^\/+/, "");
};

const FIELD_H = 44;
const COLS = {
  nama: 160,
  tanggal: 120,
  jamMasuk: 110,
  jamKeluar: 110,
  ket: 120,
  alasan: 220,
  aksi: 200,
};
const TABLE_WIDTH =
  COLS.nama + COLS.tanggal + COLS.jamMasuk + COLS.jamKeluar + COLS.ket + COLS.alasan + COLS.aksi;

type StatusKey = "HADIR" | "IZIN" | "SAKIT" | "ALPHA";

type UserOption = {
  id: number;
  name: string;
  email?: string;
  rate_lembur?: number;
};

export default function AbsensiAdminScreen() {
  const [rows, setRows] = useState<AbsenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [q, setQ] = useState("");
  const [filterDate, setFilterDate] = useState(new Date());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [sumWeek, setSumWeek] = useState<Totals | null>(null);
  const [sumMonth, setSumMonth] = useState<Totals | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalLoading, setModalLoading] = useState(false);
  const [modalItems, setModalItems] = useState<{ name: string; count: number }[]>([]);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const [formVisible, setFormVisible] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [form, setForm] = useState({
    id: undefined as number | undefined,
    user_id: "" as string,
    tanggal: todayStr(),
    jam_masuk: "",
    jam_keluar: "",
    status: "HADIR" as StatusKey,
    alasan_masuk: "",
    alasan_keluar: "",
  });

  const resetForm = () =>
    setForm({
      id: undefined,
      user_id: "",
      tanggal: todayStr(),
      jam_masuk: "",
      jam_keluar: "",
      status: "HADIR",
      alasan_masuk: "",
      alasan_keluar: "",
    });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filters = useMemo(() => ({ q, filterDate }), [q, filterDate]);

  const loadAll = useCallback(
    async () => {
      try {
        setErr(null);
        if (!refreshing) setLoading(true);

        const y = filterDate.getFullYear();
        const m = filterDate.getMonth();
        const startStr = fmtYMD(new Date(y, m, 1));
        const endStr = fmtYMD(new Date(y, m + 1, 0));

        const [list, w, m_sum] = await Promise.all([
          getHistory({ q, start: startStr, end: endStr, limit: 500 }),
          getSummary("week"),
          getSummary("month"),
        ]);

        setRows(list || []);
        setSumWeek(w?.totals ?? null);
        setSumMonth(m_sum?.totals ?? null);
      } catch (e: any) {
        setErr(e?.message || "Gagal memuat data");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [q, filterDate, refreshing]
  );

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadAll(), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, loadAll]);

  const onRefresh = useCallback(() => { setRefreshing(true); loadAll(); }, [loadAll]);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setUsersLoading(true);
        const res = await fetch(api("auth/get_all_users_detail.php"));
        const text = await res.text();
        if (!res.ok) return;
        let j: any;
        try { j = JSON.parse(text); } catch { return; }
        if (!j?.success || !Array.isArray(j.data)) return;
        const mapped: UserOption[] = j.data.map((u: any) => ({
          id: Number(u.id),
          name: String(u.nama_lengkap || u.name || u.username || `User #${u.id}`).trim(),
          email: u.email ? String(u.email) : undefined,
          rate_lembur: Number(u.lembur || 0),
        }));
        mapped.sort((a, b) => a.name.localeCompare(b.name, "id"));
        setUsers(mapped);
      } catch (e) { console.log("loadUsers error", e); } finally { setUsersLoading(false); }
    };
    loadUsers();
  }, []);

  const handlePrintPdf = async () => {
    try {
      const periodName = fmtMonthYear(filterDate);
      const htmlContent = generateHtmlPdf(rows, periodName);
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri, { UTI: ".pdf", mimeType: "application/pdf" });
    } catch (error) { Alert.alert("Gagal Cetak", "Terjadi kesalahan saat membuat PDF."); }
  };

  const handleKpiPress = useCallback(async (range: "week" | "month", status: StatusKey) => {
    try {
      setModalVisible(true);
      setModalLoading(true);
      setModalTitle(`Detail ${status}`);
      const endD = todayStr();
      const startObj = range === "week" ? new Date(Date.now() - 7 * 864e5) : new Date(Date.now() - 30 * 864e5);
      const sStr = fmtYMD(startObj);
      const hist = await getHistory({ start: sStr, end: endD, limit: 2000 });
      const filtered = hist.filter((r) => (r.keterangan || "").toUpperCase() === status);
      const counts = new Map<string, number>();
      for (const r of filtered) {
        const name = (r.nama || "").trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      const items = Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      setModalItems(items);
    } catch (e) { setModalItems([]); } finally { setModalLoading(false); }
  }, []);

  const totalDetailCount = useMemo(() => modalItems.reduce((sum, it) => sum + (it.count || 0), 0), [modalItems]);

  const openCreate = () => { setFormMode("create"); resetForm(); setFormVisible(true); };

  const openEdit = useCallback((row: AbsenRow) => {
    setFormMode("update");
    setForm({
      id: row.id,
      user_id: String(row.user_id ?? ""),
      tanggal: row.tanggal ?? todayStr(),
      jam_masuk: row.jam_masuk ?? "",
      jam_keluar: row.jam_keluar ?? "",
      status: ((row.keterangan || "HADIR").toUpperCase() as StatusKey),
      alasan_masuk: row.alasan ?? (row as any).alasan_masuk ?? "",
      alasan_keluar: (row as any).alasan_keluar ?? "",
    });
    setFormVisible(true);
  }, []);

  const handleDelete = useCallback((row: AbsenRow) => {
    Alert.alert(
      "Konfirmasi Hapus",
      `Yakin ingin menghapus data absen ${row.nama} tanggal ${row.tanggal}?`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Hapus",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(api("absen/history.php"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete", id: row.id })
              });

              const json = await res.json();
              if (json.success) {
                Alert.alert("Sukses", "Data berhasil dihapus.");
                loadAll();
              } else {
                throw new Error(json.message || "Gagal menghapus.");
              }
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Gagal menghapus data.");
            }
          }
        }
      ]
    );
  }, [loadAll]);

  const selectedUser = useMemo(() => users.find((u) => String(u.id) === String(form.user_id)), [users, form.user_id]);
  const filteredUsers = useMemo(() => {
    const qUser = userSearch.trim().toLowerCase();
    if (!qUser) return users;
    return users.filter((u) => `${u.name} ${u.email || ""}`.toLowerCase().includes(qUser));
  }, [users, userSearch]);

  const handleDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (event.type === "dismissed") return;
    const d = selected || new Date();
    setForm((f) => ({ ...f, tanggal: fmtYMD(d) }));
  };

  const handleMonthChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowMonthPicker(false);
    if (selected) { setFilterDate(selected); }
  };

  const shiftMonth = (delta: number) => {
    const newDate = new Date(filterDate);
    newDate.setMonth(newDate.getMonth() + delta);
    setFilterDate(newDate);
  }

  const sanitizeTime = (t?: string) => {
    if (!t) return null;
    const clean = t.trim();
    if (clean === "") return null;
    let formatted = clean.replace(/\./g, ":");
    if (!formatted.includes(":")) return formatted + ":00:00";
    if (formatted.length === 5) formatted += ":00";
    return formatted;
  };

  const submitForm = async () => {
    try {
      if (!form.user_id || !form.tanggal) {
        Alert.alert("Validasi", "Nama user dan tanggal wajib diisi.");
        return;
      }
      const cleanMasuk = sanitizeTime(form.jam_masuk);
      const cleanKeluar = sanitizeTime(form.jam_keluar);

      const payload = {
        mode: formMode,
        id: form.id,
        user_id: Number(form.user_id),
        tanggal: form.tanggal,
        jam_masuk: cleanMasuk,
        jam_keluar: cleanKeluar,
        status: form.status,
        alasan: form.alasan_masuk || null,
        alasan_keluar: form.alasan_keluar || null,
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

  if (loading && !refreshing) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#0B57D0" />
        <Text style={{ marginTop: 12, color: "#6B7280" }}>Memuat riwayat absen…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safe]}>
      <View style={s.page}>
        <View style={s.topbar}>
          <Text style={s.title}>Riwayat Absensi</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[s.btnPrimary, { backgroundColor: "#4B5563" }]} onPress={handlePrintPdf}>
              <Text style={s.btnPrimaryText}>PDF 🖨️</Text>
            </Pressable>
            <Pressable style={s.btnPrimary} onPress={openCreate}>
              <Text style={s.btnPrimaryText}>+ Tambah</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.filters}>
          <TextInput
            placeholder="Cari nama..."
            value={q}
            onChangeText={setQ}
            style={[s.input, { marginBottom: 10 }]}
            autoCapitalize="none"
          />
          <View style={s.monthFilterRow}>
            <Pressable style={s.monthNavBtn} onPress={() => shiftMonth(-1)}>
              <Ionicons name="chevron-back" size={20} color="#555" />
            </Pressable>
            <Pressable style={s.monthDisplay} onPress={() => setShowMonthPicker(true)}>
              <Ionicons name="calendar-outline" size={18} color="#0B57D0" style={{ marginRight: 6 }} />
              <Text style={s.monthDisplayText}>{fmtMonthYear(filterDate)}</Text>
            </Pressable>
            <Pressable style={s.monthNavBtn} onPress={() => shiftMonth(1)}>
              <Ionicons name="chevron-forward" size={20} color="#555" />
            </Pressable>
          </View>
          {showMonthPicker && (
            <DateTimePicker
              value={filterDate}
              mode="date"
              display="default"
              onChange={handleMonthChange}
            />
          )}
        </View>

        {err && <View style={s.errBox}><Text style={s.errText}>{err}</Text></View>}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={{ marginTop: 20 }}
          contentContainerStyle={{ paddingBottom: 8, paddingRight: 40 }}
        >
          <View style={{ width: TABLE_WIDTH }}>
            <FlatList
              data={rows}
              keyExtractor={(_item, index) => "row_" + index.toString()}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              stickyHeaderIndices={[0]}
              ListHeaderComponent={<TableHeader />}
              renderItem={({ item }) => <TableRow item={item} onEdit={openEdit} onDelete={handleDelete} />}
              ListEmptyComponent={
                <View style={{ paddingVertical: 20 }}>
                  <Text style={s.empty}>Tidak ada data absensi di bulan ini.</Text>
                </View>
              }
            />
          </View>
        </ScrollView>

        <View style={{ gap: 12, marginTop: 14 }}>
          <Card title="Rekap 7 Hari Terakhir">
            {sumWeek ? (<KPI totals={sumWeek} onPress={(label: StatusKey) => handleKpiPress("week", label)} />) : (<Text style={s.muted}>-</Text>)}
          </Card>
          <Card title="Rekap 30 Hari Terakhir">
            {sumMonth ? (<KPI totals={sumMonth} onPress={(label: StatusKey) => handleKpiPress("month", label)} />) : (<Text style={s.muted}>-</Text>)}
          </Card>
        </View>
      </View>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.recapCard}>
            <View style={s.recapHeader}>
              <Text style={s.recapTitle}>{modalTitle}</Text>
              {totalDetailCount > 0 && (<View style={s.recapChip}><Text style={s.recapChipText}>{totalDetailCount} entri</Text></View>)}
            </View>
            <Text style={s.recapSubtitle}>Daftar karyawan beserta jumlah kemunculan pada periode tersebut.</Text>
            <View style={{ maxHeight: 320, marginTop: 8 }}>
              {modalLoading ? (
                <View style={[s.center, { paddingVertical: 20 }]}><ActivityIndicator /><Text style={{ marginTop: 8 }}>Memuat detail…</Text></View>
              ) : (
                <ScrollView>
                  {modalItems.length === 0 ? (
                    <Text style={s.muted}>Tidak ada data.</Text>
                  ) : (
                    modalItems.map((it, idx) => (
                      <View key={idx} style={s.recapRow}>
                        <Text style={s.recapItem} numberOfLines={1}>{it.name || "-"}</Text>
                        <Text style={s.recapCount}>{it.count}x</Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
            </View>
            <Pressable style={s.recapBtn} onPress={() => setModalVisible(false)}><Text style={s.recapBtnText}>Tutup</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={s.modalBackdrop}
        >
          <View style={s.formCard}>
            <Text style={s.modalTitle}>{formMode === "create" ? "Tambah Data Absensi" : "Edit Data Absensi"}</Text>

            <ScrollView contentContainerStyle={{ gap: 10 }}>
              <View style={s.formRow}>
                <Text style={s.formLabel}>Karyawan</Text>
                <Pressable style={s.formSelect} onPress={() => setUserPickerOpen(true)}>
                  <Text style={[s.formSelectText, !selectedUser && { color: "#9CA3AF", fontWeight: "400" }]} numberOfLines={1}>
                    {selectedUser ? `${selectedUser.name}${selectedUser.email ? ` (${selectedUser.email})` : ""}` : "Pilih karyawan"}
                  </Text>
                </Pressable>
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Tanggal</Text>
                <Pressable style={[s.formInput, { justifyContent: "center" }]} onPress={() => setShowDatePicker(true)}>
                  <Text style={{ color: form.tanggal ? "#111827" : "#9CA3AF" }}>{form.tanggal || "Pilih tanggal"}</Text>
                </Pressable>
                {showDatePicker && <DateTimePicker value={parseDateYmd(form.tanggal)} mode="date" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={handleDateChange} />}
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Jam Masuk</Text>
                <View style={s.inputWithBtns}>
                  <TextInput style={[s.formInput, { flex: 1 }]} value={form.jam_masuk} onChangeText={(t) => setForm((f) => ({ ...f, jam_masuk: t }))} placeholder="HH:MM:SS" placeholderTextColor="#9CA3AF" autoCapitalize="none" />
                  <Pressable style={s.btnTiny} onPress={() => setForm((f) => ({ ...f, jam_masuk: nowTime() }))}><Text style={s.btnTinyText}>Now</Text></Pressable>
                </View>
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Jam Keluar</Text>
                <View style={s.inputWithBtns}>
                  <TextInput style={[s.formInput, { flex: 1 }]} value={form.jam_keluar} onChangeText={(t) => setForm((f) => ({ ...f, jam_keluar: t }))} placeholder="HH:MM:SS" placeholderTextColor="#9CA3AF" autoCapitalize="none" />
                  <Pressable style={s.btnTiny} onPress={() => setForm((f) => ({ ...f, jam_keluar: nowTime() }))}><Text style={s.btnTinyText}>Now</Text></Pressable>
                </View>
              </View>

              <View style={s.formRow}>
                <Text style={s.formLabel}>Status</Text>
                <Pressable style={s.formSelect} onPress={() => setStatusPickerOpen(true)}><Text style={s.formSelectText}>{form.status}</Text></Pressable>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.formLabel}>Alasan Masuk</Text>
                  <TextInput style={[s.formInput, { height: 60 }]} value={form.alasan_masuk} onChangeText={(t) => setForm((f) => ({ ...f, alasan_masuk: t }))} placeholder="Alasan masuk" multiline />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.formLabel}>Alasan Keluar</Text>
                  <TextInput style={[s.formInput, { height: 60 }]} value={form.alasan_keluar} onChangeText={(t) => setForm((f) => ({ ...f, alasan_keluar: t }))} placeholder="Alasan keluar" multiline />
                </View>
              </View>
            </ScrollView>

            <View style={s.formActions}>
              <Pressable style={s.btnGhost} onPress={() => setFormVisible(false)}><Text style={s.btnGhostText}>Batal</Text></Pressable>
              <Pressable style={s.btnPrimary} onPress={submitForm}><Text style={s.btnPrimaryText}>{formMode === "create" ? "Simpan" : "Update"}</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={userPickerOpen} transparent animationType="fade" onRequestClose={() => setUserPickerOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.selectCard}>
            <Text style={s.modalTitle}>Pilih Karyawan</Text>
            <TextInput style={[s.formInput, { marginBottom: 10 }]} placeholder="Cari..." value={userSearch} onChangeText={setUserSearch} autoCapitalize="none" />
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
              {filteredUsers.map((u) => (
                <Pressable key={u.id} style={s.selectItem} onPress={() => { setForm((f) => ({ ...f, user_id: String(u.id) })); setUserPickerOpen(false); }}>
                  <Text style={s.selectItemText} numberOfLines={1}>{u.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={[s.modalBtn, { alignSelf: "stretch", marginTop: 10 }]} onPress={() => setUserPickerOpen(false)}><Text style={s.modalBtnText}>Tutup</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={statusPickerOpen} transparent animationType="fade" onRequestClose={() => setStatusPickerOpen(false)}>
        <View style={s.modalBackdrop}>
          <View style={s.selectCard}>
            {(["HADIR", "IZIN", "SAKIT", "ALPHA"] as StatusKey[]).map((opt) => (
              <Pressable key={opt} style={s.selectItem} onPress={() => { setForm((f) => ({ ...f, status: opt })); setStatusPickerOpen(false); }}>
                <Text style={s.selectItemText}>{opt}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const TableHeader = () => (
  <View style={[s.thead, { width: TABLE_WIDTH }]}>
    <Text style={th(COLS.nama)}>Nama</Text>
    <Text style={th(COLS.tanggal)}>Tanggal</Text>
    <Text style={th(COLS.jamMasuk)}>Masuk</Text>
    <Text style={th(COLS.jamKeluar)}>Keluar</Text>
    <Text style={th(COLS.ket)}>Status</Text>
    <Text style={th(COLS.alasan)}>Alasan</Text>
    <Text style={th(COLS.aksi)}>Aksi</Text>
  </View>
);

const TableRow = React.memo(function TableRow({ item, onEdit, onDelete }: { item: AbsenRow; onEdit: (i: AbsenRow) => void; onDelete: (i: AbsenRow) => void }) {
  return (
    <View style={[s.trow, { width: TABLE_WIDTH }]}>
      <Text style={td(COLS.nama)} numberOfLines={1}>{item.nama}</Text>
      <Text style={td(COLS.tanggal)}>{item.tanggal}</Text>
      <Text style={[td(COLS.jamMasuk), { color: getJamMasukColor(item.jam_masuk), fontWeight: "700" }]}>{item.jam_masuk || "-"}</Text>
      <Text style={[td(COLS.jamKeluar), { color: getJamKeluarColor(item.jam_keluar), fontWeight: "700" }]}>{item.jam_keluar || "-"}</Text>
      <Text style={td(COLS.ket)}>{item.keterangan}</Text>
      <Text style={td(COLS.alasan)} numberOfLines={1}>{(item.keterangan === "HADIR" ? "-" : (item.alasan || "-"))}</Text>
      <View style={[td(COLS.aksi), { flexDirection: "row", gap: 8 }]}>
        <Pressable style={s.btnMini} onPress={() => onEdit(item)}><Text style={s.btnMiniText}>Edit</Text></Pressable>
        <Pressable style={[s.btnMini, s.btnMiniDelete]} onPress={() => onDelete(item)}>
          <Text style={[s.btnMiniText, { color: "#b91c1c" }]}>Hapus</Text>
        </Pressable>
      </View>
    </View>
  );
});

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (<View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>);
}

function KPI({ totals, onPress }: { totals: Totals; onPress: (label: StatusKey) => void; }) {
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
  return (<Pressable style={s.badge} onPress={onPress}><Text style={s.badgeText}>{label}</Text></Pressable>);
}

/* ====== Styles ====== */

const s = StyleSheet.create({

  safe: { flex: 1, backgroundColor: "#F8FAFC" },

  page: { flex: 1, backgroundColor: "#F8FAFC", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },

  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },

  title: { fontSize: 20, fontWeight: "800", color: "#0B57D0", marginVertical: 10 },

  filters: { marginTop: 4, gap: 8, marginBottom: 6 },

  monthFilterRow: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 },

  monthNavBtn: { width: 36, height: 36, backgroundColor: '#E8F2FF', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  monthDisplay: { flex: 1, height: 42, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },

  monthDisplayText: { color: '#0B1A33', fontWeight: '700', fontSize: 14 },

  hint: { color: "#6B7280", fontSize: 12 },

  row: { flexDirection: "row", gap: 8 },

  input: { backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#E5E7EB" },

  flex1: { flex: 1 },

  errBox: { backgroundColor: "#FEE2E2", borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: "#FECACA" },

  errText: { color: "#B91C1C" },

  thead: { backgroundColor: "#EEF3FF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#DBE5FF", flexDirection: "row", gap: 8, alignItems: "center" },

  trow: { backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 10, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#EEF1F6", flexDirection: "row", gap: 8, alignItems: "center" },

  empty: { textAlign: "center", color: "#6B7280", marginTop: 18 },

  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#EEF1F6" },

  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 8 },

  kpiWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },

  badge: { backgroundColor: "#EEF3FF", borderWidth: 1, borderColor: "#DBE5FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },

  badgeText: { color: "#1D4ED8", fontWeight: "600", fontSize: 12 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  muted: { color: "#6B7280" },

  btnPrimary: { backgroundColor: "#0B57D0", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },

  btnPrimaryText: { color: "#fff", fontWeight: "700" },

  btnGhost: { borderColor: "#CBD5E1", borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },

  btnGhostText: { color: "#111827", fontWeight: "700" },

  btnMini: { backgroundColor: "#EEF3FF", borderColor: "#DBE5FF", borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },

  btnMiniDelete: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },

  btnMiniText: { color: "#1D4ED8", fontWeight: "700", fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 20 },

  modalCard: { width: "100%", maxWidth: 500, backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },

  modalTitle: { fontWeight: "800", fontSize: 16, marginBottom: 8, color: "#111827" },

  modalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },

  modalItem: { fontSize: 14, color: "#111827", flexShrink: 1, paddingRight: 8 },

  modalCount: { fontSize: 13, fontWeight: "700", color: "#0B57D0", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: "#EEF3FF" },

  modalBtn: { alignSelf: "flex-end", marginTop: 12, backgroundColor: "#0B57D0", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },

  modalBtnText: { color: "#fff", fontWeight: "700" },

  recapCard: { width: "100%", maxWidth: 500, backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#E5E7EB", shadowColor: "#000", shadowOpacity: 0.08, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 5 },

  recapHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },

  recapTitle: { fontSize: 16, fontWeight: "800", color: "#111827", flexShrink: 1, paddingRight: 8 },

  recapSubtitle: { fontSize: 11, color: "#6B7280" },

  recapChip: { backgroundColor: "#EEF3FF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },

  recapChipText: { fontSize: 11, fontWeight: "700", color: "#1D4ED8" },

  recapRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 10, marginBottom: 6, borderRadius: 10, backgroundColor: "#F9FAFB" },

  recapItem: { fontSize: 13, color: "#111827", flexShrink: 1, paddingRight: 8 },

  recapCount: { fontSize: 14, fontWeight: "700", color: "#0B57D0" },

  recapBtn: { alignSelf: "flex-end", marginTop: 14, backgroundColor: "#0B57D0", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },

  recapBtnText: { color: "#FFFFFF", fontWeight: "700" },

  formCard: { width: "100%", maxWidth: 520, maxHeight: "90%", backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },

  formRow: { gap: 6, marginBottom: 10 },

  formLabel: { fontSize: 12, color: "#6B7280", marginLeft: 2 },

  formInput: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, height: FIELD_H, borderWidth: 1, borderColor: "#E5E7EB" },

  inputWithBtns: { flexDirection: "row", alignItems: "center", gap: 8 },

  btnTiny: { backgroundColor: "#0B57D0", paddingHorizontal: 12, height: FIELD_H, minWidth: 64, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },

  btnTinyText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  btnTinyGhost: { backgroundColor: "#EEF3FF", borderWidth: 1, borderColor: "#DBE5FF" },

  btnTinyTextGhost: { color: "#1D4ED8" },

  formActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },

  formSelect: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: "#E5E7EB" },

  formSelectText: { color: "#111827", fontWeight: "700" },

  selectCard: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#E5E7EB" },

  selectItem: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 8 },

  selectItemActive: { backgroundColor: "#EEF3FF", borderColor: "#DBE5FF" },

  selectItemText: { color: "#111827", fontWeight: "600" },

  selectItemTextActive: { color: "#0B57D0" },

});



function th(width: number) { return { width, fontWeight: "800", color: "#1E3A8A", fontSize: 12 } as const; }

function td(width: number) { return { width, color: "#111827", fontSize: 13 } as const; }