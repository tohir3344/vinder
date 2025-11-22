// app/user/GajiUser.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE as RAW_API_BASE } from "../../config";

/* =================== CONFIG & THEME =================== */
const API_BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";
const API_SLIP = `${API_BASE}gaji/gaji_slip.php`;
const API_PREVIEW = `${API_BASE}gaji/gaji_preview.php`;

const C = {
  primary: "#0A84FF",
  primaryDark: "#005BBB",
  primarySoft: "#E8F1FF",
  text: "#0B1A33",
  muted: "#6B7A90",
  border: "#E3ECFF",
  bg: "#F6F9FF",
  card: "#FFFFFF",
  green: "#1DB954",
  orange: "#FF8A00",
};

/* =================== HELPERS =================== */
const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0 Sun
  const diffToMonday = (dow + 6) % 7;
  x.setDate(x.getDate() - diffToMonday);
  return x;
};
const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

function fmtIDR(n?: number | null) {
  return Number(n ?? 0).toLocaleString("id-ID");
}

// Rincian lainnya
type OtherItem = { label: string; amount: number };

function parseOthers(row: any): OtherItem[] {
  if (!row || !row.others_json) return [];

  let raw = row.others_json as any;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const out: OtherItem[] = [];
  for (const o of raw) {
    if (!o) continue;
    const label = String(o.label ?? "Lainnya");
    const amt = parseInt(String(o.amount ?? 0), 10);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    out.push({ label, amount: amt });
  }
  return out;
}

/* =================== TYPES =================== */
type Slip = {
  id?: number;
  user_id: number;
  nama: string;
  periode_start: string;
  periode_end: string;
  hadir_minggu: number; // treat as hadir di periode
  lembur_menit: number;
  lembur_rp: number;
  gaji_pokok_rp: number;
  angsuran_rp: number;

  // nama yang mungkin dipakai backend admin (opsional)
  kerajinan_rp?: number | null;
  kebersihan_rp?: number | null;
  ibadah_rp?: number | null;

  // fallback nama alternatif dari admin
  thr_rp?: number | null;
  bonus_akhir_tahun_rp?: number | null;
  others_total_rp?: number | null;

  others_json?: any;

  total_gaji_rp: number;
};

/* =================== MAIN =================== */
export default function GajiUser() {
  const [myId, setMyId] = useState<number | null>(null);
  const [myName, setMyName] = useState<string>("");

  type PeriodMode = "week" | "month";
  const [mode, setMode] = useState<PeriodMode>("week");

  const now = useMemo(() => new Date(), []);
  const [start, setStart] = useState<Date>(startOfWeek(now));
  const [end, setEnd] = useState<Date>(endOfWeek(now));
  const [monthAnchor, setMonthAnchor] = useState<Date>(new Date());

  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const othersItems = slip ? parseOthers(slip) : [];

  /* ----- ambil user_id dari AsyncStorage ----- */
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
        let id: number | null = null;
        let nama = "";
        if (found) {
          id = Number(
            found.id ??
              found.user_id ??
              found?.user?.id ??
              found?.user?.user_id ??
              0
          );
          nama = String(
            found.name ??
              found.nama ??
              found.username ??
              found?.user?.name ??
              found?.user?.username ??
              ""
          );
        }
        if (!id || id <= 0) {
          Alert.alert(
            "Tidak login",
            "ID pengguna tidak ditemukan. Pastikan sudah login."
          );
          return;
        }
        setMyId(id);
        setMyName(nama || `User#${id}`);
      } catch (e: any) {
        Alert.alert("Error", e.message || String(e));
      }
    })();
  }, []);

  /* ----- sync rentang kalau mode ganti ----- */
  useEffect(() => {
    if (mode === "week") {
      const d = new Date();
      setStart(startOfWeek(d));
      setEnd(endOfWeek(d));
    } else {
      const d = new Date();
      setMonthAnchor(d);
      setStart(startOfMonth(d));
      setEnd(endOfMonth(d));
    }
  }, [mode]);

  /* ----- FETCH SLIP (FINAL / AUTO PREVIEW) ----- */
  const fetchSlip = async () => {
    if (!myId) return;

    const startStr = iso(start);
    const endStr = iso(end);

    try {
      setLoading(true);

      // 1) Coba ambil slip FINAL dari gaji_run (kalau admin sudah simpan)
      const urlSlip =
        `${API_SLIP}?user_id=${encodeURIComponent(String(myId))}` +
        `&start=${encodeURIComponent(startStr)}` +
        `&end=${encodeURIComponent(endStr)}`;

      let r = await fetch(urlSlip);
      let t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        j = null;
      }

      if (j?.success && j?.data) {
        // sudah ada di gaji_run → pakai apa adanya (admin override)
        setSlip(j.data as Slip);
        return;
      }

      // 2) Tidak ada slip tersimpan → AUTO dari gaji_preview.php
      const urlPrev =
        `${API_PREVIEW}?user_id=${encodeURIComponent(String(myId))}` +
        `&start=${encodeURIComponent(startStr)}` +
        `&end=${encodeURIComponent(endStr)}`;

      r = await fetch(urlPrev);
      t = await r.text();

      let jPrev: any;
      try {
        jPrev = JSON.parse(t);
      } catch {
        throw new Error(t);
      }

      if (!jPrev?.success || !jPrev?.data) {
        setSlip(null);
        return;
      }

      const d = jPrev.data || {};

      // ====== Gaji pokok × absen (BERLAKU MINGGUAN & BULANAN) ======
      const gajiPerAbsen = Number(d.gaji_pokok_rp ?? 0); // gaji untuk 1x hadir
      const hadir = Number(d.hadir_minggu ?? 0); // jumlah hari hadir dalam periode

      // ketika total hadir 0 → gaji pokok = 0
      // ketika hadir >= 1 → gaji pokok = gajiPerAbsen * hadir
      let gajiPokokTotal = 0;
      if (gajiPerAbsen > 0 && hadir > 0) {
        gajiPokokTotal = gajiPerAbsen * hadir;
      }

      const lemburRp = Number(d.lembur_rp ?? 0);
      const angsuranRp = Number(d.angsuran_rp ?? 0);

      const thr = Number(d.thr_rp ?? d.kerajinan_rp ?? 0);
      const bonus = Number(d.bonus_akhir_tahun_rp ?? d.kebersihan_rp ?? 0);
      const others = Number(d.others_total_rp ?? d.ibadah_rp ?? 0);

      const total =
        gajiPokokTotal +
        lemburRp -
        angsuranRp +
        (thr || 0) +
        (bonus || 0) +
        (others || 0);

      const autoSlip: Slip = {
        user_id: myId,
        nama: String(d.nama ?? myName ?? `User#${myId}`),
        periode_start: String(d.periode_start ?? startStr),
        periode_end: String(d.periode_end ?? endStr),

        hadir_minggu: hadir,
        lembur_menit: Number(d.lembur_menit ?? 0),
        lembur_rp: lemburRp,

        // sudah DIKALI hadir (kalau hadir 0 → 0)
        gaji_pokok_rp: gajiPokokTotal,
        angsuran_rp: angsuranRp,

        kerajinan_rp: thr || undefined,
        kebersihan_rp: bonus || undefined,
        ibadah_rp: others || undefined,

        thr_rp: thr || undefined,
        bonus_akhir_tahun_rp: bonus || undefined,
        others_total_rp: others || undefined,

        others_json: d.others_json ?? null,

        total_gaji_rp: total,
      };

      setSlip(autoSlip);
    } catch (e) {
      console.log("fetchSlip error", e);
      setSlip(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlip();
  }, [myId, start, end]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSlip();
    setRefreshing(false);
  };

  /* =================== UI =================== */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* HEADER MELENGKUNG */}
      <View style={st.headerWrap}>
        <View style={st.headerCurve} />
        <View style={st.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={st.avatar}>
              <Ionicons name="person" size={20} color={C.primaryDark} />
            </View>
            <View>
              <Text style={st.hi}>Halo,</Text>
              <Text style={st.name}>
                {slip?.nama || myName || "Karyawan"}
              </Text>
            </View>
          </View>
          <TouchableOpacity style={st.refreshBtn} onPress={fetchSlip}>
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={st.refreshTx}>Segarkan</Text>
          </TouchableOpacity>
        </View>

        {/* HERO TOTAL */}
        <View style={st.totalHero}>
          <Text style={st.totalCap}>Total Gaji</Text>
          {loading ? (
            <ActivityIndicator
              style={{ marginTop: 8 }}
              color={C.primaryDark}
            />
          ) : (
            <Text style={st.totalVal}>
              Rp {fmtIDR(slip?.total_gaji_rp ?? 0)}
            </Text>
          )}
          <Text style={st.totalPeriode}>
            {(slip?.periode_start || iso(start))} s/d{" "}
            {(slip?.periode_end || iso(end))}
          </Text>
        </View>
      </View>

      {/* BODY */}
      <ScrollView
        contentContainerStyle={st.body}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* MODE PERIODE */}
        <Text style={st.label}>Mode Periode</Text>
        <View style={st.segmentWrap}>
          <TouchableOpacity
            style={[st.segmentBtn, mode === "week" && st.segmentActive]}
            onPress={() => setMode("week")}
          >
            <Ionicons
              name="calendar-outline"
              size={14}
              color={mode === "week" ? C.primaryDark : C.muted}
            />
            <Text
              style={[st.segmentTx, mode === "week" && st.segmentTxActive]}
            >
              Mingguan
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.segmentBtn, mode === "month" && st.segmentActive]}
            onPress={() => setMode("month")}
          >
            <Ionicons
              name="calendar"
              size={14}
              color={mode === "month" ? C.primaryDark : C.muted}
            />
            <Text
              style={[st.segmentTx, mode === "month" && st.segmentTxActive]}
            >
              Bulanan
            </Text>
          </TouchableOpacity>
        </View>

        {/* PERIODE PICKER */}
        <Text style={st.label}>Periode</Text>
        {mode === "week" ? (
          <>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                style={[st.inputBtn, { flex: 1 }]}
                onPress={() => setShowStart(true)}
              >
                <Ionicons
                  name="calendar-number"
                  size={16}
                  color={C.primaryDark}
                />
                <Text style={st.inputBtnTx}>{iso(start)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.inputBtn, { flex: 1 }]}
                onPress={() => setShowEnd(true)}
              >
                <Ionicons
                  name="calendar-number-outline"
                  size={16}
                  color={C.primaryDark}
                />
                <Text style={st.inputBtnTx}>{iso(end)}</Text>
              </TouchableOpacity>
            </View>
            <View style={st.quickWrap}>
              <TouchableOpacity
                style={st.quickBtn}
                onPress={() => {
                  const d = new Date();
                  setStart(startOfWeek(d));
                  setEnd(endOfWeek(d));
                }}
              >
                <Text style={st.quickTx}>Minggu ini</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.quickBtn}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 7);
                  setStart(startOfWeek(d));
                  setEnd(endOfWeek(d));
                }}
              >
                <Text style={st.quickTx}>Minggu lalu</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={st.inputBtn}
              onPress={() => setShowMonthPicker(true)}
            >
              <Ionicons name="calendar" size={16} color={C.primaryDark} />
              <Text style={st.inputBtnTx}>
                {monthAnchor.getFullYear()}-
                {String(monthAnchor.getMonth() + 1).padStart(2, "0")}
              </Text>
            </TouchableOpacity>
            <Text
              style={{
                color: C.muted,
                marginTop: 6,
                marginLeft: 2,
              }}
            >
              Rentang: {iso(start)} s/d {iso(end)}
            </Text>
            <View style={st.quickWrap}>
              <TouchableOpacity
                style={st.quickBtn}
                onPress={() => {
                  const d = new Date();
                  setMonthAnchor(d);
                  setStart(startOfMonth(d));
                  setEnd(endOfMonth(d));
                }}
              >
                <Text style={st.quickTx}>Bulan ini</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.quickBtn}
                onPress={() => {
                  const d = new Date(monthAnchor);
                  d.setMonth(d.getMonth() - 1);
                  setMonthAnchor(d);
                  setStart(startOfMonth(d));
                  setEnd(endOfMonth(d));
                }}
              >
                <Text style={st.quickTx}>Bulan lalu</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* PICKERS */}
        {showStart && (
          <DateTimePicker
            value={start}
            mode="date"
            onChange={(e, d) => {
              setShowStart(false);
              if (!d) return;
              if (mode === "week") {
                setStart(startOfWeek(d));
                setEnd(endOfWeek(d));
              } else {
                setMonthAnchor(d);
                setStart(startOfMonth(d));
                setEnd(endOfMonth(d));
              }
            }}
          />
        )}
        {showEnd && (
          <DateTimePicker
            value={end}
            mode="date"
            onChange={(e, d) => {
              setShowEnd(false);
              if (!d) return;
              if (mode === "week") {
                setStart(startOfWeek(d));
                setEnd(endOfWeek(d));
              } else {
                setMonthAnchor(d);
                setStart(startOfMonth(d));
                setEnd(endOfMonth(d));
              }
            }}
          />
        )}
        {showMonthPicker && (
          <DateTimePicker
            value={monthAnchor}
            mode="date"
            onChange={(e, d) => {
              setShowMonthPicker(false);
              if (!d) return;
              setMonthAnchor(d);
              setStart(startOfMonth(d));
              setEnd(endOfMonth(d));
            }}
          />
        )}

        {/* KARTU DETAIL */}
        <View style={st.card}>
          <RowIcon
            icon="checkmark-circle"
            tint={C.green}
            label="Hadir (hari/periode)"
            value={String(slip?.hadir_minggu ?? 0)}
          />
          <RowIcon
            icon="flash"
            tint={C.primary}
            label="Lembur (Rp)"
            value={`Rp ${fmtIDR(slip?.lembur_rp ?? 0)}`}
          />
          <RowIcon
            icon="cash"
            tint={C.orange}
            label="Gaji Pokok"
            value={`Rp ${fmtIDR(slip?.gaji_pokok_rp ?? 0)}`}
          />
          <RowIcon
            icon="remove-circle"
            tint="#DC3545"
            label="Potongan (Angsuran)"
            value={`Rp ${fmtIDR(slip?.angsuran_rp ?? 0)}`}
          />

          {/* Optional allowances (fallback ke nama alternatif dari admin) */}
          {renderOpt(
            "kerajinan_rp",
            "Tunjangan Hari Raya",
            slip?.kerajinan_rp ?? slip?.thr_rp ?? null
          )}
          {renderOpt(
            "kebersihan_rp",
            "Tunjangan Akhir Tahun",
            slip?.kebersihan_rp ?? slip?.bonus_akhir_tahun_rp ?? null
          )}

          {/* Rincian Lainnya dari others_json */}
          {othersItems.length > 0
            ? othersItems.map((o, idx) => (
                <RowIcon
                  key={`${o.label}-${idx}`}
                  icon="add-circle"
                  tint={C.primaryDark}
                  label={o.label}
                  value={`Rp ${fmtIDR(o.amount)}`}
                />
              ))
            : renderOpt(
                "ibadah_rp",
                "Lainnya",
                slip?.ibadah_rp ?? slip?.others_total_rp ?? null
              )}

          <View
            style={{
              height: 1,
              backgroundColor: C.border,
              marginVertical: 12,
            }}
          />
          <View style={st.totalRow}>
            <Text style={st.totalRowLabel}>Total</Text>
            <Text style={st.totalRowVal}>
              Rp {fmtIDR(slip?.total_gaji_rp ?? 0)}
            </Text>
          </View>
        </View>

        {/* INFO STATE */}
        {!loading && !slip && (
          <View style={[st.card, { alignItems: "center" }]}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={C.muted}
            />
            <Text
              style={{
                color: C.muted,
                marginTop: 6,
                textAlign: "center",
              }}
            >
              Belum ada slip tersimpan untuk periode ini.
            </Text>
          </View>
        )}
        <View style={{ height: 16 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* =================== SMALL UI HELPERS =================== */
function RowIcon({
  icon,
  tint,
  label,
  value,
}: {
  icon: any;
  tint: string;
  label: string;
  value: string;
}) {
  return (
    <View style={st.row}>
      <View style={st.rowLeft}>
        <View
          style={[
            st.badge,
            { backgroundColor: `${tint}1A`, borderColor: `${tint}33` },
          ]}
        >
          <Ionicons name={icon} size={14} color={tint} />
        </View>
        <Text style={st.rowLabel}>{label}</Text>
      </View>
      <Text style={st.rowVal}>{value}</Text>
    </View>
  );
}

function renderOpt(key: string, label: string, v?: number | null) {
  if (v === null || v === undefined) return null;
  return (
    <RowIcon
      key={key}
      icon="add-circle"
      tint={C.primaryDark}
      label={label}
      value={`Rp ${fmtIDR(Number(v))}`}
    />
  );
}

/* =================== STYLES =================== */
const st = StyleSheet.create({
  headerWrap: { backgroundColor: C.bg },
  headerCurve: {
    height: 90,
    backgroundColor: C.primary,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  header: {
    marginTop: -70,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#ffffff66",
  },
  hi: { color: "#EAF3FF", fontSize: 12, fontWeight: "600" },
  name: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 2 },
  refreshBtn: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: C.primaryDark,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  refreshTx: { color: "#fff", fontWeight: "800", fontSize: 12 },
  totalHero: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    borderRadius: 16,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 2,
  },
  totalCap: { color: C.primaryDark, fontWeight: "800" },
  totalVal: {
    color: C.primaryDark,
    fontWeight: "900",
    fontSize: 26,
    marginTop: 2,
  },
  totalPeriode: { color: C.muted, marginTop: 4 },
  body: { padding: 16, paddingTop: 12 },
  label: {
    color: C.text,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 6,
  },
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: C.primarySoft,
    borderRadius: 14,
    padding: 4,
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  segmentActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 1,
  },
  segmentTx: { fontWeight: "800", color: C.muted },
  segmentTxActive: { color: C.primaryDark },
  inputBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputBtnTx: { color: C.text, fontWeight: "700" },
  quickWrap: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
  },
  quickTx: { color: C.primaryDark, fontWeight: "800", fontSize: 12 },
  card: {
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.card,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rowLabel: { color: C.muted, fontWeight: "800" },
  rowVal: { color: C.text, fontWeight: "900" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalRowLabel: { color: C.text, fontWeight: "900", fontSize: 16 },
  totalRowVal: {
    color: C.primaryDark,
    fontWeight: "900",
    fontSize: 18,
  },
});
