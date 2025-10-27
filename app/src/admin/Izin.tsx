// app/admin/IzinAdmin.tsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, RefreshControl, TextInput,
  TouchableOpacity, ActivityIndicator, Modal
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

const BASE = API_BASE.endsWith("/") ? API_BASE : API_BASE + "/";
const API_LIST       = `${BASE}izin/izin_list.php`;
const API_SET_STATUS = `${BASE}izin/izin_set_status.php`;
const API_DELETE     = `${BASE}izin/izin_delete.php`; // opsional

type IzinRow = {
  id: number;
  user_id: number;
  username?: string;
  nama?: string;
  keterangan: "IZIN" | "SAKIT";
  alasan: string;
  status: "pending" | "disetujui" | "ditolak";
  mulai: string;   // YYYY-MM-DD
  selesai: string; // YYYY-MM-DD
  durasi_hari?: number;
  created_at?: string;
};
type ListResp = { success: boolean; data: IzinRow[]; total?: number };

const STATUS_OPTIONS = ["", "pending", "disetujui", "ditolak"] as const;
const LIMIT = 20;

function qs(params: Record<string, any>) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && `${v}`.trim() !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
}
function computeDurasi(mulai: string, selesai: string) {
  try {
    const a = new Date(mulai);
    const b = new Date(selesai);
    const diff = Math.round((+b - +a) / (24 * 3600 * 1000)) + 1;
    return diff > 0 ? diff : 1;
  } catch { return 1; }
}
function badgeColor(status: IzinRow["status"]) {
  switch (status) {
    case "pending": return "#FFC107";
    case "disetujui": return "#4CAF50";
    case "ditolak": return "#E53935";
    default: return "#9E9E9E";
  }
}

export default function IzinAdmin() {
  // Filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "pending" | "disetujui" | "ditolak">("");
  const [dari, setDari] = useState("");     // YYYY-MM-DD
  const [sampai, setSampai] = useState(""); // YYYY-MM-DD

  // Data
  const [rows, setRows] = useState<IzinRow[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  // === Tambahan state modal rekap ===
const [recapOpen, setRecapOpen] = useState(false);
const [recapType, setRecapType] = useState<"minggu" | "bulan">("minggu");

// === Helper date ===
function ymd(d: Date) {
  const m = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${m}-${dd}`;
}
function between(dateStr: string, startStr: string, endStr: string) {
  return dateStr >= startStr && dateStr <= endStr;
}

// === Hitung recap berdasarkan pilihan ===
const recapData = useMemo(() => {
  if (!rows.length) return null;

  let startStr = "", endStr = "";
  const now = new Date();

  if (recapType === "minggu") {
    // 7 hari terakhir (inklusif hari ini)
    const s = new Date(now); s.setDate(now.getDate() - 6);
    startStr = ymd(s);
    endStr = ymd(now);
  } else {
    // Bulan ini (1 sampai akhir bulan)
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = new Date(now.getFullYear(), now.getMonth()+1, 0);
    startStr = ymd(s);
    endStr = ymd(e);
  }

  const list = rows.filter(r => between(r.mulai, startStr, endStr) || between(r.selesai, startStr, endStr) ||
                                (r.mulai <= startStr && r.selesai >= endStr)); // ada overlap

  const totalPengajuan = list.length;
  const totalHari = list.reduce((a,b)=> a + (b.durasi_hari ?? 0), 0);

  const byStatus = list.reduce((acc: Record<string, number>, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const byKeterangan = list.reduce((acc: Record<string, number>, r) => {
    const key = (r.keterangan || "").toUpperCase();
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return { startStr, endStr, totalPengajuan, totalHari, byStatus, byKeterangan };
}, [rows, recapType]);


  // UI state
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Guards
  const inFlightRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const momentumRef = useRef(false);

  const fetchList = useCallback(async (reset = false) => {
    // Stop automasi kalau sedang error dan ini bukan reset
    if (errorMsg && !reset) return;

    if (inFlightRef.current) inFlightRef.current.abort();
    const ac = new AbortController();
    inFlightRef.current = ac;

    if (reset) {
      setLoading(true);
      setHasMore(true);
      setOffset(0);
      setErrorMsg(null);
    } else {
      setLoading(true);
    }

    try {
      const params = {
        q: q.trim() || undefined,
        status: status || undefined,
        dari: dari.trim() || undefined,
        sampai: sampai.trim() || undefined,
        limit: LIMIT,
        offset: reset ? 0 : offset,
      };

      const res = await fetch(API_LIST + qs(params), { signal: ac.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 160)}` : ""}`);
      }

      const raw = await res.text();
      let json: ListResp | null = null;
      try { json = JSON.parse(raw); } catch { throw new Error(`Response bukan JSON: ${raw.slice(0, 200)}`); }

      if (!json?.success || !Array.isArray(json.data)) {
        throw new Error("Payload tidak valid dari server.");
      }

      const data = json.data.map((r) => ({
        ...r,
        durasi_hari: r.durasi_hari ?? computeDurasi(r.mulai, r.selesai),
      }));

      if (!mountedRef.current) return;

      if (reset) {
        setRows(data);
        setOffset(data.length);
      } else {
        setRows((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const merged = [...prev, ...data.filter((x) => !seen.has(x.id))];
          return merged;
        });
        setOffset((prev) => prev + data.length);
      }

      const totalServer = typeof json.total === "number" ? json.total : undefined;
      setTotal(totalServer);
      if (totalServer !== undefined) {
        const nextCount = (reset ? data.length : (rows.length + data.length));
        setHasMore(nextCount < totalServer);
      } else {
        setHasMore(data.length >= LIMIT);
      }
      setErrorMsg(null);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      // Tahan auto load-more & tampilkan banner error
      setHasMore(false);
      setErrorMsg(String(e));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        inFlightRef.current = null;
      }
    }
  }, [q, status, dari, sampai, offset, rows.length, errorMsg]);

  useEffect(() => {
    mountedRef.current = true;
    fetchList(true);
    return () => {
      mountedRef.current = false;
      inFlightRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    setOffset(0);
    setHasMore(true);
    fetchList(true);
  };
  const resetFilters = () => {
    setQ(""); setStatus(""); setDari(""); setSampai("");
    setOffset(0); setHasMore(true);
    fetchList(true);
  };
  const onRefresh = () => {
    setRefreshing(true);
    setOffset(0);
    setHasMore(true);
    fetchList(true);
  };
  const loadMore = () => {
    if (loading || !hasMore || momentumRef.current || errorMsg) return;
    fetchList(false);
  };

  // Optimistic actions
  const mutateLocal = (id: number, patch: Partial<IzinRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const setStatusRow = async (row: IzinRow, next: IzinRow["status"]) => {
    const prev = row.status;
    mutateLocal(row.id, { status: next });
    try {
      const res = await fetch(API_SET_STATUS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, status: next }),
      });
      const raw = await res.text();
      const json = JSON.parse(raw);
      if (!json?.success) throw new Error(json?.message || "Gagal set status");
    } catch (e) {
      mutateLocal(row.id, { status: prev });
      setErrorMsg(String(e));
    }
  };

    const removeRow = async (row: IzinRow) => {
        const snapshot = rows;
        // optimistic UI
        setRows((p) => p.filter((r) => r.id !== row.id));

        try {
            const res = await fetch(API_DELETE, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify({ id: Number(row.id) }),
            });

            const raw = await res.text();
            const ct = res.headers.get("content-type") || "";

            let json: any = null;
            if (/application\/json/i.test(ct)) {
            try { json = JSON.parse(raw); } catch {}
            } else if (res.ok && (raw.trim() === "" || /^ok$/i.test(raw.trim()))) {
            // fallback: server balas kosong/ok
            json = { success: true };
            }

            if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText} — ${raw.slice(0, 200)}`);
            }
            if (!json || json.success !== true) {
            const msg = json?.message || raw.slice(0, 200) || "Payload bukan JSON";
            throw new Error(msg);
            }

            // sukses: diam
        } catch (e: any) {
            // rollback UI
            setRows(snapshot);
            setErrorMsg(`Gagal hapus: ${String(e)}`);
        }
        };

    const confirmDelete = (row: IzinRow) => {
        if (row.status !== "pending") {
            setErrorMsg("Hanya pengajuan berstatus 'pending' yang bisa dihapus.");
            return;
        }
        const nama = row.nama || row.username || `#${row.user_id}`;
        const msg = `Hapus pengajuan izin milik ${nama} (${row.mulai} → ${row.selesai})?\nAksi ini tidak bisa dibatalkan.`;
        // pakai Alert native
        import("react-native").then(({ Alert }) => {
            Alert.alert("Konfirmasi Hapus", msg, [
            { text: "Batal", style: "cancel" },
            { text: "Hapus", style: "destructive", onPress: () => removeRow(row) },
            ]);
        });
    };


  const renderItem = ({ item }: { item: IzinRow }) => {
    const nama = item.nama || item.username || `#${item.user_id}`;
    const durasi = item.durasi_hari ?? computeDurasi(item.mulai, item.selesai);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{nama}</Text>
          <View style={[styles.badge, { backgroundColor: badgeColor(item.status) }]}>
            <Text style={styles.badgeText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <Row label="Keterangan" value={item.keterangan} />
        <Row label="Alasan" value={item.alasan} />
        <Row label="Periode" value={`${item.mulai} → ${item.selesai}`} />
        <Row label="Durasi" value={`${durasi} hari`} />

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnApprove]} onPress={() => setStatusRow(item, "disetujui")}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>Setujui</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={() => setStatusRow(item, "ditolak")}>
            <Ionicons name="close-circle-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>Tolak</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ styles.btn, item.status === "pending" ? styles.btnDelete : styles.btnDisabled]}
            disabled={item.status !== "pending"}
            onPress={() => confirmDelete(item)}
            >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>Hapus</Text>
            </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F6FA" }}>
      {/* Error banner */}
      {errorMsg && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText} numberOfLines={2}>Gagal memuat data: {errorMsg}</Text>
          <TouchableOpacity style={styles.errorRetry} onPress={() => fetchList(true)}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filters */}
      <View style={styles.filterBar}>
        <View style={styles.row}>
          <View style={[styles.inputWrap, { flex: 1.6 }]}>
            <Text style={styles.label}>Cari (username/nama/alasan)</Text>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="ketik kata kunci…"
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={applyFilters}
            />
          </View>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusWrap}>
              {STATUS_OPTIONS.map((s) => {
                const active = (status === s) || (s === "" && status === "");
                return (
                  <TouchableOpacity
                    key={s || "all"}
                    style={[styles.statusChip, active && styles.statusChipActive]}
                    onPress={() => setStatus(s as any)}
                  >
                    <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>
                      {s || "All"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Text style={styles.label}>Dari (YYYY-MM-DD)</Text>
            <TextInput value={dari} onChangeText={setDari} placeholder="2025-10-01" style={styles.input} autoCapitalize="none" />
          </View>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Text style={styles.label}>Sampai (YYYY-MM-DD)</Text>
            <TextInput value={sampai} onChangeText={setSampai} placeholder="2025-10-31" style={styles.input} autoCapitalize="none" />
          </View>
        </View>

        <View style={styles.filterActions}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={applyFilters}>
            <Ionicons name="search-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>Terapkan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={resetFilters}>
            <Ionicons name="refresh-outline" size={18} color="#fff" />
            <Text style={styles.btnText}>Reset</Text>
          </TouchableOpacity>
          {/* di bar atas (sesuaikan posisi favoritmu) */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, marginTop: 8 }}>
            <TouchableOpacity onPress={() => setRecapOpen(true)} style={{ backgroundColor: "#0B5ED7", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Rekap</Text>
            </TouchableOpacity>
        </View>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={rows}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReachedThreshold={0.2}
        onEndReached={loadMore}
        onMomentumScrollBegin={() => { momentumRef.current = false; }}
        onScrollBeginDrag={() => { momentumRef.current = true; }}
        ListFooterComponent={
          loading ? (
            <View style={{ padding: 16, alignItems: "center" }}><ActivityIndicator /></View>
          ) : hasMore ? (
            <View style={{ padding: 12 }}>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => fetchList(false)}>
                <Text style={styles.btnText}>Load more</Text>
              </TouchableOpacity>
            </View>
          ) : <View style={{ height: 12 }} />
        }
        ListEmptyComponent={
          !loading && !errorMsg ? (
            <View style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: "#777" }}>Tidak ada data.</Text>
            </View>
          ) : null
        }
      />
      {/* ===== Modal Rekap (slide dari bawah) ===== */}
<Modal
  visible={recapOpen}
  transparent
  animationType="slide"
  onRequestClose={() => setRecapOpen(false)}
>
  <View style={styles.modalBackdrop}>
    <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setRecapOpen(false)} />
    <View style={styles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: "#0f172a" }}>Rekapan Izin</Text>
        <TouchableOpacity onPress={() => setRecapOpen(false)} style={styles.closeBtn}>
          <Text style={{ color: "#fff", fontWeight: "800" }}>Tutup</Text>
        </TouchableOpacity>
      </View>

      {/* Segmented control minggu/bulan */}
      <View style={styles.segmentWrap}>
        {(["minggu","bulan"] as const).map(opt => {
          const active = recapType === opt;
          return (
            <TouchableOpacity key={opt} onPress={() => setRecapType(opt)} style={[styles.segmentChip, active && styles.segmentChipActive]}>
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt === "minggu" ? "7 Hari Terakhir" : "Bulan Ini"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Isi ringkasan */}
      {recapData ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: "#475569", fontSize: 12 }}>
            Periode: <Text style={{ fontWeight: "700", color: "#0f172a" }}>{recapData.startStr} s/d {recapData.endStr}</Text>
          </Text>

          <View style={styles.statGrid}>
            <View style={[styles.statCard, { backgroundColor: "#eef4ff", borderColor: "#cfe0ff" }]}>
              <Text style={styles.statTitle}>Total Pengajuan</Text>
              <Text style={styles.statValue}>{recapData.totalPengajuan}</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: "#e8f7ee", borderColor: "#c9efd7" }]}>
              <Text style={styles.statTitle}>Total Hari Izin</Text>
              <Text style={styles.statValue}>{recapData.totalHari} hari</Text>
            </View>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Per Status</Text>
            <View style={styles.pillRow}>
              {Object.entries(recapData.byStatus).map(([k,v]) => (
                <View key={k} style={styles.pill}><Text style={styles.pillText}>{k.toUpperCase()}: {v}</Text></View>
              ))}
              {Object.keys(recapData.byStatus).length === 0 && (
                <Text style={{ color: "#64748b" }}>—</Text>
              )}
            </View>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Per Keterangan</Text>
            <View style={styles.pillRow}>
              {Object.entries(recapData.byKeterangan).map(([k,v]) => (
                <View key={k || 'null'} style={[styles.pill, { backgroundColor: "#fff7ed", borderColor: "#ffedd5" }]}>
                  <Text style={[styles.pillText, { color: "#9a3412" }]}>{k || "N/A"}: {v}</Text>
                </View>
              ))}
              {Object.keys(recapData.byKeterangan).length === 0 && (
                <Text style={{ color: "#64748b" }}>—</Text>
              )}
            </View>
          </View>
        </View>
      ) : (
        <Text style={{ color: "#64748b" }}>Tidak ada data untuk dihitung.</Text>
      )}
    </View>
  </View>
</Modal>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{String(value ?? "-")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBar: {
    backgroundColor: "#EF5350",
    margin: 12,
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { flex: 1, color: "#fff" },
  errorRetry: { backgroundColor: "#C62828", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },

  filterBar: { backgroundColor: "#fff", margin: 12, padding: 12, borderRadius: 12, elevation: 1 },
  row: { flexDirection: "row", gap: 12, marginBottom: 8 },
  inputWrap: { flex: 1 },
  label: { fontSize: 12, color: "#616161", marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fafafa", fontSize: 14 },
  statusWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#ECEFF1" },
  statusChipActive: { backgroundColor: "#2196F3" },
  statusChipText: { fontSize: 12, color: "#455A64" },
  statusChipTextActive: { color: "#fff", fontWeight: "600" },

  filterActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  btn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 7, paddingHorizontal: 7, borderRadius: 8 },
  btnPrimary: { backgroundColor: "#1976D2" },
  btnSecondary: { backgroundColor: "#607D8B" },
  btnApprove: { backgroundColor: "#43A047", flex: 1 },
  btnReject: { backgroundColor: "#E53935", flex: 1 },
  btnDelete: { backgroundColor: "#757575", flex: 1 },
  btnText: { color: "#fff", fontWeight: "600" },
  btnDisabled: { backgroundColor: "#B0B8C4", opacity: 0.7, flex: 1 },

  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, elevation: 1 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  name: { fontSize: 16, fontWeight: "700", color: "#1E293B", flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  infoLabel: { color: "#607D8B", fontSize: 12 },
  infoValue: { color: "#263238", fontSize: 14, fontWeight: "600" },

  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "75%",
    gap: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#e2e8f0",
    marginBottom: 8,
  },
  closeBtn: { backgroundColor: "#ef4444", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },

  segmentWrap: { flexDirection: "row", gap: 8, marginBottom: 4 },
  segmentChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#e2e8f0" },
  segmentChipActive: { backgroundColor: "#0B5ED7" },
  segmentText: { color: "#0f172a", fontWeight: "700", fontSize: 12 },
  segmentTextActive: { color: "#fff" },

  statGrid: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12 },
  statTitle: { color: "#475569", fontSize: 12, marginBottom: 6, fontWeight: "700" },
  statValue: { color: "#0f172a", fontSize: 18, fontWeight: "900" },

  block: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 10 },
  blockTitle: { color: "#0f172a", fontWeight: "800", marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { backgroundColor: "#eef4ff", borderColor: "#cfe0ff", borderWidth: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  pillText: { color: "#1e40af", fontWeight: "700", fontSize: 12 },
});
