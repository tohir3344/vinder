  // app/admin/LemburAdmin.tsx
  import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
  import {
    Alert,
    ActivityIndicator,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
  } from "react-native";
  import { SafeAreaView } from "react-native-safe-area-context";
  import { API_BASE as RAW_API_BASE } from "../../config";

  /* ====== API base: sterilkan trailing slash ====== */
  const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

  /** ===== Types ===== */
  type LemburRow = {
    id: number;
    user_id: number;
    nama: string;
    tanggal: string;            // YYYY-MM-DD
    jam_masuk: string;          // "HH:mm[:ss]"
    jam_keluar: string;
    alasan: string;             // gabungan (masuk / keluar)
    total_menit?: number;
    total_menit_masuk?: number | null;
    total_menit_keluar?: number | null;
    total_jam?: string;         // "H:MM"
    total_upah?: number | null; // rupiah
  };

  /** ===== Endpoint ===== */
  const API_LIST   = `${API_BASE}lembur/lembur_list.php`;
  const API_CONFIG = `${API_BASE}lembur/lembur_list.php?action=config`;

  /** ===== Utils HTTP ===== */
  async function fetchText(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const text = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText, text };
  }
  async function parseJSON(text: string) {
    try { return JSON.parse(text); } catch { throw new Error(`Response bukan JSON:\n${text}`); }
  }

  /** ===== Waktu & Uang ===== */
  function toMinutes(hhmm: string): number | null {
    if (!hhmm) return null;
    const p = hhmm.trim().split(":");
    if (p.length < 2) return null;
    const h = parseInt(p[0], 10);
    const m = parseInt(p[1], 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  }
  function hhmmFromMinutes(total: number) {
    const t = Math.max(0, Math.round(total));
    const h = Math.floor(t / 60);
    const m = t % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  }
  function formatIDR(n: number) { return Math.round(n).toLocaleString("id-ID"); }
  const pickServerOr = (val: any, fallback: number) => {
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  /** ===== Screen ===== */
  export default function LemburAdmin() {
    const [rows, setRows] = useState<LemburRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Cutoff & rate dari server (SSoT)
    const [cutIn, setCutIn] = useState("08:00");
    const [cutOut, setCutOut] = useState("17:00");
    const [ratePerMenit, setRatePerMenit] = useState<number>(10000 / 60);

    // Filter
    const todayStr = useMemo(() => {
      const d = new Date(); const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    }, []);
    const [q, setQ] = useState("");
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [applied, setApplied] = useState<{ q: string; start?: string; end?: string }>({ q: "" });
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoApply = useCallback((next: { q?: string; start?: string; end?: string }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setApplied((prev) => ({
          q: next.q ?? prev.q,
          start: next.start ?? prev.start,
          end: next.end ?? prev.end,
        }));
      }, 250);
    }, []);
    useEffect(() => { autoApply({ q }); }, [q, autoApply]);
    useEffect(() => { autoApply({ start }); }, [start, autoApply]);
    useEffect(() => { autoApply({ end }); }, [end, autoApply]);

    /** ===== Hitung lembur (ikut cutoff server) ===== */
    const computeOvertimeParts = useCallback((jamMasuk: string, jamKeluar: string) => {
      const inMin  = toMinutes(jamMasuk)  ?? Number.POSITIVE_INFINITY;
      const outMin = toMinutes(jamKeluar) ?? Number.NEGATIVE_INFINITY;
      const cIn    = toMinutes(cutIn)  ?? 8 * 60;
      const cOut   = toMinutes(cutOut) ?? 17 * 60;
      const menitMasuk  = Math.max(0, cIn  - inMin);
      const menitKeluar = Math.max(0, outMin - cOut);
      return { menitMasuk, menitKeluar, total: menitMasuk + menitKeluar };
    }, [cutIn, cutOut]);

    /** ===== Load Config (cutoff & rate) ===== */
    const loadConfig = useCallback(async () => {
      try {
        const { ok, text } = await fetchText(API_CONFIG);
        if (!ok) return;
        const cfg = await parseJSON(text);

        // dukung format: {start_cutoff, end_cutoff, rate_per_menit|rate_per_jam} atau {data:{...}}
        const src = cfg?.data && typeof cfg.data === "object" ? cfg.data : cfg;

        if (src?.start_cutoff) setCutIn(String(src.start_cutoff).slice(0, 5));
        if (src?.end_cutoff)   setCutOut(String(src.end_cutoff).slice(0, 5));

        if (src?.rate_per_menit && Number(src.rate_per_menit) > 0) {
          setRatePerMenit(Number(src.rate_per_menit));
        } else if (src?.rate_per_jam && Number(src.rate_per_jam) > 0) {
          setRatePerMenit(Number(src.rate_per_jam) / 60);
        }
      } catch {}
    }, []);

    /** ===== Load Data ===== */
    const loadData = useCallback(async () => {
      setLoading(true);
      try {
        await loadConfig();

        // beberapa backend minta action list, sebagian tidak → coba urutan ini
        const candidates = [
          `${API_LIST}?action=list`,
          `${API_LIST}?action=summary`,
          API_LIST,
        ];

        let dataJson: any | null = null;
        let lastErr: string | null = null;

        for (const url of candidates) {
          try {
            const { ok, status, statusText, text } = await fetchText(url);
            if (!ok) { lastErr = `HTTP ${status} ${statusText}`; continue; }
            const j = await parseJSON(text);
            dataJson = j;
            break;
          } catch (e: any) {
            lastErr = e?.message ?? String(e);
          }
        }
        if (!dataJson) throw new Error(lastErr || "Tidak bisa memuat list lembur");

        // payload bisa {rows:[...]}, {data:[...]}, {data:{rows:[]}}, atau {list:[...]}
        const rowsRaw: any[] =
          dataJson.rows ??
          dataJson.data?.rows ??
          dataJson.data ??
          dataJson.list ??
          [];

        const normalized: LemburRow[] = rowsRaw.map((r: any): LemburRow => {
          const jam_masuk  = String(r.jam_masuk ?? "").slice(0, 5);
          const jam_keluar = String(r.jam_keluar ?? "").slice(0, 5);

          // gabung alasan (masuk & keluar) kalau tersedia
          const alasanMasuk  = (r.alasan ?? "").toString().trim();
          const alasanKeluar = (r.alasan_keluar ?? "").toString().trim();
          const alasan =
            alasanMasuk && alasanKeluar
              ? `Masuk: ${alasanMasuk} | Keluar: ${alasanKeluar}`
              : alasanMasuk || alasanKeluar || "";

          const parts = computeOvertimeParts(jam_masuk, jam_keluar);
          const menitMasuk  = pickServerOr(r.total_menit_masuk, parts.menitMasuk);
          const menitKeluar = pickServerOr(r.total_menit_keluar, parts.menitKeluar);
          const totalMenit  = pickServerOr(r.total_menit, menitMasuk + menitKeluar);

          const rowRatePerMenit = Number(r.rate_per_menit ?? NaN);
          const rpm = Number.isFinite(rowRatePerMenit) && rowRatePerMenit > 0 ? rowRatePerMenit : ratePerMenit;

          const upah = pickServerOr(r.total_upah, totalMenit * rpm);
          const jamStr =
            typeof r.total_jam === "string" && r.total_jam.trim() !== ""
              ? r.total_jam
              : hhmmFromMinutes(totalMenit);

          return {
            id: Number(r.id),
            user_id: Number(r.user_id ?? 0),
            nama: String(r.nama ?? r.name ?? r.username ?? ""),
            tanggal: String(r.tanggal ?? r.date ?? ""),
            jam_masuk,
            jam_keluar,
            alasan,
            total_menit_masuk: menitMasuk,
            total_menit_keluar: menitKeluar,
            total_menit: totalMenit,
            total_upah: upah,
            total_jam: jamStr,
          };
        });

        setRows(normalized);
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal memuat data lembur");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }, [computeOvertimeParts, ratePerMenit, loadConfig]);

    useEffect(() => { loadData(); }, [loadData]);
    const onRefresh = () => { setRefreshing(true); loadData(); };

    /** ===== Helpers ===== */
    function inRange(dateStr: string, s?: string, e?: string) {
      if (s && dateStr < s) return false;
      if (e && dateStr > e) return false;
      return true;
    }

    /** ===== Filtering ===== */
    const filtered = useMemo(() => {
      const s = applied.start || undefined;
      const e = applied.end || undefined;
      const qx = applied.q.toLowerCase().trim();
      return rows.filter(
        (r) => inRange(r.tanggal, s, e) && (qx === "" || r.nama.toLowerCase().includes(qx))
      );
    }, [rows, applied]);

    /** ===== Rekap & Ringkasan ===== */
    // const summary = useMemo(() => {
    //   const menitMasuk = filtered.reduce((a, b) => a + (b.total_menit_masuk || 0), 0);
    //   const menitKeluar = filtered.reduce((a, b) => a + (b.total_menit_keluar || 0), 0);
    //   const totalMenit = menitMasuk + menitKeluar;
    //   const upah = totalMenit * ratePerMenit;
    //   return {
    //     count: filtered.length,
    //     menitMasuk,
    //     menitKeluar,
    //     totalMenit,
    //     jamMasukStr: hhmmFromMinutes(menitMasuk),
    //     jamKeluarStr: hhmmFromMinutes(menitKeluar),
    //     jamTotalStr: hhmmFromMinutes(totalMenit),
    //     upah,
    //   };
    // }, [filtered, ratePerMenit]);

    const recaps = useMemo(() => {
      const todayDate = new Date();
      const make = (days: number) => {
        const d0 = new Date(todayDate); d0.setDate(todayDate.getDate() - days + 1);
        const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const startStr = toStr(d0);
        const endStr = toStr(todayDate);
        const list = rows.filter((r) => inRange(r.tanggal, startStr, endStr));
        const menitMasuk = list.reduce((a, b) => a + (b.total_menit_masuk || 0), 0);
        const menitKeluar = list.reduce((a, b) => a + (b.total_menit_keluar || 0), 0);
        const totalMenit = menitMasuk + menitKeluar;
        return {
          count: list.length,
          menitMasuk,
          menitKeluar,
          totalMenit,
          jamMasukStr: hhmmFromMinutes(menitMasuk),
          jamKeluarStr: hhmmFromMinutes(menitKeluar),
          jamTotalStr: hhmmFromMinutes(totalMenit),
          upah: totalMenit * ratePerMenit,
        };
      };
      return { r7: make(7), r30: make(30) };
    }, [rows, ratePerMenit]);

    /** ===== Form (Tambah/Edit) ===== */
    const [modalVisible, setModalVisible] = useState(false);
    const [editItem, setEditItem] = useState<LemburRow | null>(null);
    const [form, setForm] = useState({
      user_id: "",
      nama: "",
      tanggal: "",
      jam_masuk: "",
      jam_keluar: "",
      alasan: "",
      total_menit_masuk: "",
      total_menit_keluar: "",
    });

    const openModal = (item?: LemburRow) => {
      if (item) {
        setEditItem(item);
        setForm({
          user_id: String(item.user_id || ""),
          nama: item.nama,
          tanggal: item.tanggal,
          jam_masuk: item.jam_masuk,
          jam_keluar: item.jam_keluar,
          alasan: item.alasan,
          total_menit_masuk: String(item.total_menit_masuk ?? ""),
          total_menit_keluar: String(item.total_menit_keluar ?? ""),
        });
      } else {
        setEditItem(null);
        setForm({
          user_id: "",
          nama: "",
          tanggal: todayStr,
          jam_masuk: "",
          jam_keluar: "",
          alasan: "",
          total_menit_masuk: "",
          total_menit_keluar: "",
        });
      }
      setModalVisible(true);
    };

    const prevMasuk = Number(form.total_menit_masuk || 0);
    const prevKeluar = Number(form.total_menit_keluar || 0);
    const prevTotal = prevMasuk + prevKeluar;
    const prevUpah = prevTotal * ratePerMenit;

    const submitForm = async () => {
      const userIdNum = Number(form.user_id);
      const useUserId = Number.isInteger(userIdNum) && userIdNum > 0;
      const nameTrim = (form.nama || "").trim();

      if (!useUserId && !nameTrim) return Alert.alert("Error", "Isi salah satu: User ID atau Nama.");
      if (!form.tanggal) return Alert.alert("Error", "Tanggal wajib diisi");
      if (!form.jam_masuk || !form.jam_keluar) return Alert.alert("Error", "Jam Masuk & Jam Keluar wajib diisi");

      try {
        const payload: any = {
          tanggal: form.tanggal.trim(),
          jam_masuk: form.jam_masuk.trim(),
          jam_keluar: form.jam_keluar.trim(),
          // kirim alasan ke backend (backend boleh split ke alasan & alasan_keluar bila perlu)
          alasan: form.alasan.trim(),
          total_menit_masuk: Number(form.total_menit_masuk || 0),
          total_menit_keluar: Number(form.total_menit_keluar || 0),
        };
        if (useUserId) payload.user_id = userIdNum; else payload.nama = nameTrim;
        if (editItem) payload.id = editItem.id;

        const body = JSON.stringify({ action: editItem ? "edit" : "create", data: payload });

        const { ok, status, statusText, text } = await fetchText(API_LIST, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body,
        });
        if (!ok) throw new Error(`HTTP ${status} ${statusText}\n${text}`);
        const j = await parseJSON(text);
        if (j.error) throw new Error(j.error);

        Alert.alert("Sukses", editItem ? "Data lembur diperbarui." : `Data lembur dibuat (id=${j.id ?? "?"}).`);
        setModalVisible(false);
        loadData();
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal menyimpan data lembur");
      }
    };

    /** ===== Row ===== */
    const renderItem = ({ item }: { item: LemburRow }) => {
      const parts = computeOvertimeParts(item.jam_masuk, item.jam_keluar);
      const menitMasuk  = pickServerOr(item.total_menit_masuk, parts.menitMasuk);
      const menitKeluar = pickServerOr(item.total_menit_keluar, parts.menitKeluar);
      const totalMenit  = pickServerOr(item.total_menit, menitMasuk + menitKeluar);
      const jamStr      = item.total_jam ?? hhmmFromMinutes(totalMenit);
      const upah        = pickServerOr(item.total_upah, totalMenit * ratePerMenit);

      return (
        <View style={st.row}>
          <Text style={[st.cell, st.left,   { width: 180 }]} numberOfLines={1}>{item.nama}</Text>
          <Text style={[st.cell, st.center, { width: 110 }]}>{item.tanggal}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{item.jam_masuk || "-"}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{item.jam_keluar || "-"}</Text>
          <Text style={[st.cell, st.left,   { width: 220 }]} numberOfLines={1}>{item.alasan || "-"}</Text>
          <Text style={[st.cell, st.right,  { width: 120 }]}>{menitMasuk}</Text>
          <Text style={[st.cell, st.right,  { width: 120 }]}>{menitKeluar}</Text>
          <Text style={[st.cell, st.center, { width:  90 }]}>{jamStr}</Text>
          <Text style={[st.cell, st.right,  { width: 150 }]}>Rp {formatIDR(upah)}</Text>
          <TouchableOpacity style={st.editBtn} onPress={() => openModal(item)}>
            <Text style={st.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>
      );
    };

    /** ===== Loading ===== */
    if (loading) {
      return (
        <SafeAreaView style={st.container}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10 }}>Memuat data…</Text>
        </SafeAreaView>
      );
    }

    /** ===== UI ===== */
    return (
      <SafeAreaView style={st.container}>
        {/* Header */}
        <View style={st.headerWrap}>
          <Text style={st.headerTitle}>Riwayat Lembur (Admin)</Text>
          <TouchableOpacity style={st.addBtn} onPress={() => openModal()}>
            <Text style={st.addBtnText}>+ Tambah Data</Text>
          </TouchableOpacity>
        </View>

        {/* Filter */}
        <View style={st.card}>
          <TextInput placeholder="Cari berdasarkan nama" value={q} onChangeText={setQ} style={st.searchInput} />
          <View style={st.dateRow}>
            <TextInput placeholder="Tanggal mulai (YYYY-MM-DD)" value={start} onChangeText={setStart} style={[st.dateInput, { marginRight: 10 }]} />
            <TextInput placeholder="Tanggal selesai (YYYY-MM-DD)" value={end} onChangeText={setEnd} style={st.dateInput} />
          </View>
          <Text style={st.hint}>Filter diterapkan otomatis saat Anda mengetik.</Text>
        </View>

        {/* Tabel */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 1160 }}>
            <View style={st.tableHeader}>
              <Text style={[st.th, { width: 180, textAlign: "left" }]}>Nama</Text>
              <Text style={[st.th, { width: 110 }]}>Tanggal</Text>
              <Text style={[st.th, { width:  90 }]}>Jam Masuk</Text>
              <Text style={[st.th, { width:  90 }]}>Jam Keluar</Text>
              <Text style={[st.th, { width: 220, textAlign: "left" }]}>Alasan</Text>
              <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Masuk</Text>
              <Text style={[st.th, { width: 120, textAlign: "right" }]}>Menit Keluar</Text>
              <Text style={[st.th, { width:  90 }]}>Total Jam</Text>
              <Text style={[st.th, { width: 150, textAlign: "right" }]}>Total Upah</Text>
              <Text style={[st.th, { width:  80 }]}>Aksi</Text>
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(i) => String(i.id)}
              renderItem={renderItem}
              refreshing={refreshing}
              onRefresh={onRefresh}
              ListEmptyComponent={
                <View style={st.empty}>
                  <Text style={st.emptyText}>Tidak ada data untuk rentang tanggal & kata kunci ini.</Text>
                </View>
              }
              contentContainerStyle={{ paddingBottom: 10 }}
            />
          </View>
        </ScrollView>

        {/* Rekap 7 & 30 hari */}
        <View style={st.recapCard}>
          <Text style={st.sectionTitle}>Rekap 7 Hari Terakhir</Text>
          <View style={st.pillRow}>
            <View style={st.pill}><Text style={st.pillText}>Jumlah Kegiatan: {recaps.r7.count}</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Menit Masuk: {recaps.r7.menitMasuk} ({recaps.r7.jamMasukStr})</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Menit Keluar: {recaps.r7.menitKeluar} ({recaps.r7.jamKeluarStr})</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Total Menit: {recaps.r7.totalMenit} ({recaps.r7.jamTotalStr})</Text></View>
            <View style={[st.pill, st.pillStrong]}><Text style={[st.pillText, st.pillStrongText]}>Total Upah: Rp {formatIDR(recaps.r7.upah)}</Text></View>
          </View>
        </View>

        <View style={st.recapCard}>
          <Text style={st.sectionTitle}>Rekap 30 Hari Terakhir</Text>
          <View style={st.pillRow}>
            <View style={st.pill}><Text style={st.pillText}>Jumlah Kegiatan: {recaps.r30.count}</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Menit Masuk: {recaps.r30.menitMasuk} ({recaps.r30.jamMasukStr})</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Menit Keluar: {recaps.r30.menitKeluar} ({recaps.r30.jamKeluarStr})</Text></View>
            <View style={st.pill}><Text style={st.pillText}>Total Menit: {recaps.r30.totalMenit} ({recaps.r30.jamTotalStr})</Text></View>
            <View style={[st.pill, st.pillStrong]}><Text style={[st.pillText, st.pillStrongText]}>Total Upah: Rp {formatIDR(recaps.r30.upah)}</Text></View>
          </View>
        </View>

        {/* Modal Tambah/Edit */}
        <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
          <View style={st.modalBg}>
            <View style={st.modalCard}>
              <Text style={st.modalTitle}>{editItem ? "Edit Lembur" : "Tambah Lembur"}</Text>
              <ScrollView style={{ maxHeight: 420 }}>
                {[
                  ["user_id", "User ID (opsional, angka)"],
                  ["nama", "Nama"],
                  ["tanggal", "Tanggal (YYYY-MM-DD)"],
                  ["jam_masuk", "Jam Masuk (HH:MM)"],
                  ["jam_keluar", "Jam Keluar (HH:MM)"],
                  ["alasan", "Alasan (Masuk/Keluar)"],
                  ["total_menit_masuk", "Menit Lembur Masuk"],
                  ["total_menit_keluar", "Menit Lembur Keluar"],
                ].map(([key, ph]) => (
                  <TextInput
                    key={key}
                    placeholder={ph}
                    style={st.input}
                    value={(form as any)[key]}
                    onChangeText={(t) => setForm({ ...form, [key]: t })}
                    keyboardType={key === "user_id" || key.includes("menit") ? "numeric" : "default"}
                  />
                ))}
                <View style={{ marginTop: 6 }}>
                  <Text style={st.previewText}>
                    Pra-Tinjau: Menit Masuk {prevMasuk} ({hhmmFromMinutes(prevMasuk)}) • Menit Keluar {prevKeluar} ({hhmmFromMinutes(prevKeluar)}) • Total {prevTotal} ({hhmmFromMinutes(prevTotal)}) • Upah Rp {formatIDR(prevUpah)}
                  </Text>
                </View>
              </ScrollView>
              <View style={{ flexDirection: "row", marginTop: 12 }}>
                <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#16a34a" }]} onPress={submitForm}>
                  <Text style={st.modalBtnText}>Simpan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.modalBtn, { backgroundColor: "#ef4444", marginLeft: 8 }]} onPress={() => setModalVisible(false)}>
                  <Text style={st.modalBtnText}>Batal</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  /** ===== Styles ===== */
  const st = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#F6F8FC", paddingHorizontal: 14, paddingTop: 8 },
    headerWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 6 },
    headerTitle: { fontSize: 20, fontWeight: "800", color: "#1e3a8a" },
    addBtn: { backgroundColor: "#0b3ea4", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10 },
    addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

    card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb" },
    searchInput: { backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, marginBottom: 8 },
    dateRow: { flexDirection: "row" },
    dateInput: { flex: 1, backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13 },
    hint: { marginTop: 6, color: "#64748b", fontSize: 11 },

    sectionTitle: { fontSize: 13, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
    summaryCard: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#e5e7eb", marginBottom: 8 },
    pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    pill: { backgroundColor: "#eef4ff", borderColor: "#cfe0ff", borderWidth: 1, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
    pillText: { color: "#1e40af", fontWeight: "700", fontSize: 12 },
    pillStrong: { backgroundColor: "#0b3ea4", borderColor: "#0b3ea4" },
    pillStrongText: { color: "#fff" },

    tableHeader: { backgroundColor: "#e8f0ff", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#dbe6ff" },
    th: { fontWeight: "800", color: "#1e40af", fontSize: 12, textAlign: "center" },

    row: { backgroundColor: "#fff", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, flexDirection: "row", marginBottom: 6, borderWidth: 1, borderColor: "#eef2f7" },
    cell: { color: "#0f172a", fontSize: 12 },
    left: { textAlign: "left" },
    right: { textAlign: "right" },
    center: { textAlign: "center" },

    editBtn: { backgroundColor: "#F59E0B", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: "center", marginLeft: 8 },
    editBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

    recapCard: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 10, borderWidth: 1, borderColor: "#e5e7eb" },

    empty: { paddingVertical: 16, alignItems: "center" },
    emptyText: { color: "#64748b", fontSize: 12 },

    modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
    modalCard: { width: "95%", backgroundColor: "#fff", borderRadius: 12, padding: 14 },
    modalTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
    input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 8, backgroundColor: "#fff", fontSize: 13 },
    modalBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
    modalBtnText: { color: "#fff", fontWeight: "800" },
    previewText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  });
