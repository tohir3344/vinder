// app/src/admin/Event.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Pressable,
  Platform,
  Modal,
  FlatList,
  StatusBar,
  RefreshControl,
  Image,
} from "react-native";
import Checkbox from "expo-checkbox";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE as RAW_API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";
import { isTodayDisciplineClaimDay, nextDisciplineClaimDate } from "../../eventConfig";
import { useLocalSearchParams, useFocusEffect } from "expo-router";

const BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";

// Helper build URL ke API (aman untuk query)
function api(path: string, q?: Record<string, any>) {
  const u = new URL(path, BASE);
  if (q) {
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== null) u.searchParams.append(k, String(v));
    });
  }
  return u.toString();
}

type TabKey = "kedisiplinan" | "kerapihan" | "ibadah" | "penukaran";
type UserRow = { id_user: number; nama: string };
type ItemRow = { item_code: string; item_name: string; point_value: number; is_active: number };

type RedeemReq = {
  id: number;
  user_id: number;
  user_name?: string | null;
  request_points?: number | null;
  request_amount?: number | null; // IDR
  points?: number | null;
  amount_idr?: number | null; // IDR
  rate_idr?: number | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  note?: string | null;
  admin_done?: 0 | 1;
  decided_at?: string | null;
  decided_by?: number | null;
};

type WeeklyRow = {
  user_id: number;
  user_name: string;
  week_start: string;
  week_end: string;
  total_days: number;
  good_days: number;
  broken: boolean;
  reason?: string | null;
};

// === NEW: tipe data Ibadah (dari endpoint list)
type IbadahClaim = {
  id: number;
  user_id: number;
  user_name?: string | null;
  prayer: "zuhur" | "ashar";
  photo_url: string;
  created_at: string;
  points?: number; // server bisa kirim 25000, fallback tetap 25000
};
const IBADAH_POINTS_PER_PHOTO = 25000;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthRangeToday() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start: toISO(start), end: toISO(end) };
}

// helper untuk row placeholder
function makePlaceholderRow(u: { id_user: number; nama: string }, start: string, end: string): WeeklyRow {
  return {
    user_id: u.id_user,
    user_name: u.nama,
    week_start: start,
    week_end: end,
    total_days: 24,
    good_days: 0,
    broken: false,
    reason: "Belum ada data",
  };
}

const blankChecked = (list: ItemRow[]) => {
  const m: Record<string, boolean> = {};
  list.forEach((it) => (m[it.item_code] = false));
  return m;
};
const sumCheckedPoints = (map: Record<string, boolean>, items: ItemRow[]) =>
  items.reduce((acc, it) => acc + (map[it.item_code] ? Number(it.point_value || 0) : 0), 0);

/* ==== Bar kecil ==== */
const ProgressBar = ({ ratio, broken }: { ratio: number; broken: boolean }) => {
  const widthPct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const barColor = broken ? "#dc2626" : "#16a34a";
  return (
    <View style={st.pbWrap}>
      <View style={[st.pbFill, { width: `${widthPct}%`, backgroundColor: barColor }]} />
    </View>
  );
};

const UserWeeklyCard = ({ row }: { row: WeeklyRow }) => {
  const initials =
    (row.user_name || "")
      .split(" ")
      .map((s) => s.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U";
  const ratio = row.total_days ? row.good_days / row.total_days : 0;
  return (
    <View style={st.userCard}>
      <View style={st.userAvatar}>
        <Text style={st.userAvatarTx}>{initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.userName}>{row.user_name}</Text>
        <Text style={st.userMeta}>
          {row.good_days}/{row.total_days} hari on-time {row.broken ? "• Hangus" : "• On track"}
        </Text>
        <ProgressBar ratio={ratio} broken={row.broken} />
        {!!row.broken && !!row.reason && <Text style={[st.userMeta, { color: "#dc2626" }]}>{row.reason}</Text>}
      </View>
    </View>
  );
};

/* ========= Cache progress MTD (supaya bar tidak mundur) ========= */
function monthKey(dISO: string) {
  return (dISO || todayISO()).slice(0, 7); // "YYYY-MM"
}
async function loadProgressCache(monthStr: string) {
  try {
    const raw = await AsyncStorage.getItem(`progress_mtd_${monthStr}`);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
async function saveProgressCache(monthStr: string, data: Record<number, WeeklyRow>) {
  try {
    await AsyncStorage.setItem(`progress_mtd_${monthStr}`, JSON.stringify(data));
  } catch {}
}

/* ===== UserPicker (Modal) — diletakkan sebelum komponen utama ===== */
function UserPicker({
  users,
  selected,
  onSelect,
}: {
  users: UserRow[];
  selected: UserRow | null;
  onSelect: (u: UserRow) => void;
}) {
  const [open, setOpen] = React.useState(false);

  const keyExtractor = React.useCallback((item: UserRow, idx: number) => {
    const id = Number(item?.id_user ?? NaN);
    return Number.isFinite(id) && id > 0 ? String(id) : `row-${idx}`;
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: UserRow }) => (
      <TouchableOpacity
        style={st.userRow}
        onPress={() => {
          onSelect(item);
          setOpen(false);
        }}
      >
        <Text style={st.userRowTx}>{item.nama}</Text>
      </TouchableOpacity>
    ),
    [onSelect]
  );

  return (
    <View style={{ zIndex: 1 }}>
      <Text style={st.label}>Nama</Text>
      <Pressable style={st.inputBtn} onPress={() => setOpen(true)}>
        <Text style={st.inputBtnTx}>{selected ? `${selected.nama}` : "Pilih user"}</Text>
        <Text style={{ color: "#0A84FF", fontWeight: "900" }}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View />
        </TouchableOpacity>

        <View style={st.modalSheet}>
          <Text style={st.modalTitle}>Pilih User</Text>
          <View style={st.searchDivider} />
          <FlatList
            data={users}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            initialNumToRender={20}
            windowSize={8}
            style={{ maxHeight: 420 }}
          />
          {users.length === 0 && <Text style={[st.muted, { marginTop: 8 }]}>Tidak ada data user.</Text>}

          <TouchableOpacity style={[st.primaryBtn, { marginTop: 12 }]} onPress={() => setOpen(false)}>
            <Text style={st.primaryBtnTx}>Tutup</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

export default function AdminEventPage() {
  // ===== initial tab dari param (supaya bisa dibuka langsung ke Penukaran)
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab =
    params?.tab === "penukaran" || params?.tab === "kerapihan" || params?.tab === "ibadah"
      ? (params.tab as TabKey)
      : "kedisiplinan";
  const [tab, setTab] = useState<TabKey>(initialTab);

  // ===== session =====
  const [adminId, setAdminId] = useState<number | null>(null);
  const [adminName, setAdminName] = useState<string>("");

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
        const id = Number(found?.id ?? found?.user_id ?? found?.user?.id ?? found?.user?.user_id ?? 0) || null;
        const name = String(
          found?.name ?? found?.nama ?? found?.username ?? found?.user?.name ?? found?.user?.username ?? ""
        );
        if (!id) Alert.alert("Info", "ID admin tidak ditemukan di sesi, pastikan sudah login.");
        setAdminId(id);
        setAdminName(name || (id ? `Admin#${id}` : "Admin"));
      } catch (e: any) {
        Alert.alert("Error", e?.message || String(e));
      }
    })();
  }, []);

  // ===== users (untuk kerapihan & ibadah) =====
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const normalizeUsers = (rows: any[]): UserRow[] =>
    rows
      .map((r, idx) => {
        const id =
          Number(r?.id_user ?? r?.user_id ?? r?.id ?? r?.idUser ?? r?.ID ?? r?.uid ?? r?.Id ?? r?.UserID ?? 0) || 0;
        const nama = String(
          r?.nama ?? r?.name ?? r?.full_name ?? r?.username ?? r?.display_name ?? `User ${idx + 1}`
        ).trim();
        return { id_user: id, nama };
      })
      .filter((u) => Number.isFinite(u.id_user) && u.id_user > 0 && u.nama.length > 0);

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch(api("event/kedisiplinan.php", { action: "user_list" }));
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch (e) {
        throw new Error(`Non-JSON user_list: ${t.slice(0, 180)}`);
      }
      if (!j?.success) throw new Error(j?.message || "user_list success=false");
      const rows = Array.isArray(j?.data) ? j.data : [];
      const mapped = normalizeUsers(rows);
      setUsers(mapped);
      setSelectedUser((prev) => prev ?? (mapped[0] || null));
    } catch (e: any) {
      setUsers([]);
      setSelectedUser(null);
      Alert.alert("User", e?.message || "Gagal ambil daftar user.");
    }
  }, []);

  // ======= BOARD KEDISIPLINAN (SEMUA USER) =======
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const { start: monthStart, end: monthEnd } = useMemo(() => monthRangeToday(), []);
  const [progressCache, setProgressCache] = useState<Record<number, WeeklyRow>>({});

  const fetchWeeklyProgress = useCallback(async () => {
    if (users.length === 0) return;
    setLoadingBoard(true);
    try {
      const monthStr = (monthStart || todayISO()).slice(0, 7);

      const cache = await loadProgressCache(monthStr);

      const urlList = api("event/kedisiplinan.php", { action: "monthly_board_24", month: monthStr });
      const r = await fetch(urlList);
      const t = await r.text();
      let j: any;
      try { j = JSON.parse(t); } catch { throw new Error(`Non-JSON monthly_board_24: ${t.slice(0, 180)}`); }

      // --- NEW: deteksi “hari ini pending” dari meta
      const meta = j?.meta ?? {};
      const hangusAt: string = String(meta.hangus_at ?? "08:00:00");
      const days: string[] = Array.isArray(meta.days) ? meta.days : [];
      const today = todayISO();
      const nowHMS = new Date().toTimeString().slice(0, 8); // "HH:MM:SS"
      const isPendingToday = days.includes(today) && (nowHMS < hangusAt);

      const rows: WeeklyRow[] = (j?.success && Array.isArray(j?.data))
        ? j.data.map((row: any): WeeklyRow => ({
            user_id: Number(row.user_id || 0),
            user_name: String(row.user_name || `User#${row.user_id || 0}`),
            week_start: monthStart,
            week_end: monthEnd,
            total_days: Number(row.total_days ?? 24),
            good_days: Number(row.good_days ?? 0),
            // --- NEW: kalau masih pending hari ini, jangan tandai broken dari API
            broken: isPendingToday ? false : Boolean(row.broken),
            reason: isPendingToday ? null : (row.reason ?? null),
          }))
        : [];

      const byId = new Map<number, WeeklyRow>(rows.map((r) => [r.user_id, r]));

      const merged: WeeklyRow[] = users.map((u) => {
        const base = byId.get(u.id_user) ?? makePlaceholderRow(u, monthStart, monthEnd);
        const prev = cache[u.id_user] as WeeklyRow | undefined;

        if (!prev) return base;

        // anti mundur progress
        const good_days = Math.max(Number(base.good_days || 0), Number(prev.good_days || 0));
        const total_days = base.total_days || prev.total_days || 24;

        // kalau pending today, broken harus tetap false
        const broken = isPendingToday ? false : Boolean(base.broken || prev.broken);
        const reason = isPendingToday ? null : (base.reason ?? prev.reason ?? null);

        return { ...base, good_days, total_days, broken, reason };
      });

      merged.sort((a, b) => {
        if (a.broken !== b.broken) return a.broken ? 1 : -1;
        const ra = a.total_days ? a.good_days / a.total_days : 0;
        const rb = b.total_days ? b.good_days / b.total_days : 0;
        return rb - ra;
      });

      setWeekly(merged);

      const nextCache: Record<number, WeeklyRow> = {};
      for (const row of merged) nextCache[row.user_id] = row;
      await saveProgressCache(monthStr, nextCache);
      setProgressCache(nextCache);
    } catch (e: any) {
      const mStr = monthKey(monthStart);
      const cache = await loadProgressCache(mStr);
      const filled = users.map((u) => cache[u.id_user] ?? makePlaceholderRow(u, monthStart, monthEnd));
      setWeekly(filled);
      Alert.alert("Kedisiplinan", e?.message || "Gagal ambil board.");
    } finally {
      setLoadingBoard(false);
    }
  }, [users, monthStart, monthEnd]);


  // ======= KERAPIHAN =======
  const [items, setItems] = useState<ItemRow[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [total, setTotal] = useState<number>(0);

  const loadItems = useCallback(async () => {
    async function fetchItemsFrom(url: string) {
      const r = await fetch(url);
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(`[${url}] Non-JSON: ${t.slice(0, 180)}`);
      }
      if (!j?.success) throw new Error(`[${url}] success=false${j?.message ? `: ${j.message}` : ""}`);
      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      const mapped: ItemRow[] = rows.map((raw: any) => ({
        item_code: String(raw.item_code ?? raw.code ?? raw.kode ?? ""),
        item_name: String(raw.item_name ?? raw.name ?? raw.nama ?? ""),
        point_value: Number(raw.point_value ?? raw.point ?? raw.poin ?? 0),
        is_active: Number(raw.is_active ?? raw.active ?? raw.status ?? 1),
      }));
      return mapped.filter((it) => it.item_code && it.is_active === 1);
    }

    try {
      let actives = await fetchItemsFrom(api("event/kerapihan.php", { action: "items" }));
      if (actives.length === 0) {
        try {
          const alt = await fetchItemsFrom(api("event/kerapihan_items_list.php"));
          if (alt.length > 0) actives = alt;
        } catch {}
      }
      setItems(actives);
      setChecked(blankChecked(actives));
      setTotal(0);
      if (actives.length === 0) Alert.alert("Items", "Tidak ada item aktif untuk kerapihan.");
    } catch (e: any) {
      setItems([]);
      setChecked({});
      setTotal(0);
      Alert.alert("Items error", e?.message ?? String(e));
    }
  }, []);

  const preloadChecked = useCallback(
    async (uid: number) => {
      try {
        const base = blankChecked(items);
        const r = await fetch(api("event/kerapihan.php", { action: "user_status", user_id: uid, date: todayISO() }));
        const t = await r.text();
        let j: any;
        try {
          j = JSON.parse(t);
        } catch {
          throw new Error(t);
        }

        let tpoints = 0;
        if (j?.success) {
          (j?.data?.items ?? []).forEach((it: any) => {
            const code = String(it.item_code);
            base[code] = true;
            tpoints += Number(it.point_value ?? 0);
          });
        }
        setChecked(base);
        setTotal(tpoints);
      } catch {
        setChecked(blankChecked(items));
        setTotal(0);
      }
    },
    [items]
  );

  const toggleItem = (code: string) => {
    if (!selectedUser) return;
    setChecked((prev) => {
      const next = { ...prev, [code]: !prev[code] };
      setTotal(sumCheckedPoints(next, items));
      return next;
    });
  };

  const selectAll = () => {
    if (!selectedUser) return;
    const next: Record<string, boolean> = {};
    items.forEach((it) => (next[it.item_code] = true));
    setChecked(next);
    setTotal(sumCheckedPoints(next, items));
  };
  const clearAll = () => {
    if (!selectedUser) return;
    const next = blankChecked(items);
    setChecked(next);
    setTotal(0);
  };

  const submitKerapihan = async () => {
    if (!selectedUser) return Alert.alert("Pilih user dulu.");
    if (!adminId) return Alert.alert("Info", "Admin belum terdeteksi, silakan login ulang.");
    try {
      const selectedCodes = Object.keys(checked).filter((k) => checked[k]);
      const r = await fetch(api("event/kerapihan.php", { action: "submit" }), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUser.id_user,
          checked_by: adminId,
          date: todayISO(),
          items: selectedCodes,
        }),
      });
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) {
        const title = j?.severity === "warning" ? "Peringatan" : "Error";
        return Alert.alert(title, j?.message || "Gagal menyimpan.");
      }

      setChecked(blankChecked(items));
      setTotal(0);

      Alert.alert("Tersimpan", `Total poin hari ini: ${j?.data?.total_points ?? 0}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal menyimpan");
    }
  };

  // ====== IBADAH (galeri per user & tanggal) ======
  const [ibadahDate, setIbadahDate] = useState<string>(todayISO());
  const [ibadahList, setIbadahList] = useState<IbadahClaim[]>([]);
  const [loadingIbadah, setLoadingIbadah] = useState(false);
  const [ibadahErr, setIbadahErr] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // NOTE: now accepts optional params to avoid stale closure
  const fetchIbadahClaims = useCallback(async () => {
  if (!selectedUser) return;
    setLoadingIbadah(true);
    setIbadahErr(null);
    try {
      const r = await fetch(
        api("event/ibadah.php", { action: "list", user_id: selectedUser.id_user, date: ibadahDate })
      );
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }

      if (!j?.success) {
        setIbadahErr(j?.message || "Gagal memuat data.");
        setIbadahList([]);
      } else {
        // 🔧 Paksa URL absolut dari BASE agar selalu sama host/port dgn API_BASE
        const rows: IbadahClaim[] = (Array.isArray(j?.data) ? j.data : []).map((raw: any) => {
          const rel = String(raw.photo_path ?? "").replace(/^\/+/, ""); // uploads/ibadah/xxx.jpg
          const serverUrl = String(raw.photo_url ?? "");
          const isAbsolute = /^https?:\/\//i.test(serverUrl);
          const fixedUrl = isAbsolute ? serverUrl : `${BASE}event/${rel}`;
          return {
            id: Number(raw.id),
            user_id: Number(raw.user_id),
            user_name: raw.user_name ?? null,
            prayer: (raw.prayer || "zuhur") as "zuhur" | "ashar",
            photo_url: fixedUrl,
            created_at: String(raw.created_at),
            points: Number(raw.points ?? IBADAH_POINTS_PER_PHOTO),
          };
        });
        setIbadahList(rows);
      }
    } catch (e: any) {
      setIbadahErr(e?.message || "Gagal memuat data.");
      setIbadahList([]);
    } finally {
      setLoadingIbadah(false);
    }
  }, [selectedUser, ibadahDate]);


  const ibadahTotalPoints = useMemo(
    () => (ibadahList ?? []).reduce((acc, r) => acc + Number(r?.points ?? IBADAH_POINTS_PER_PHOTO), 0),
    [ibadahList]
  );

  const shiftIbadahDate = (days: number) => {
    const d = new Date(ibadahDate);
    d.setDate(d.getDate() + days);
    setIbadahDate(toISO(d));
  };

  // ====== Penukaran Poin (OPEN: pending + decided-but-not-done) ======
  const [loadingRedeem, setLoadingRedeem] = useState(false);
  const [redeemList, setRedeemList] = useState<RedeemReq[]>([]);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);

  const fetchRedeemRequests = useCallback(async () => {
    setLoadingRedeem(true);
    setRedeemErr(null);
    try {
      const r = await fetch(api("event/points.php", { action: "requests", status: "open" }));
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      if (!j?.success) {
        setRedeemErr(j?.message || "Endpoint requests belum tersedia.");
        setRedeemList([]);
      } else {
        setRedeemList(Array.isArray(j?.data) ? j.data : []);
      }
    } catch (e: any) {
      setRedeemErr(e?.message || "Gagal memuat daftar penukaran.");
      setRedeemList([]);
    } finally {
      setLoadingRedeem(false);
    }
  }, []);

  // Badge pending
  const [pendingCount, setPendingCount] = useState<number>(0);
  const fetchPendingCount = useCallback(async () => {
    try {
      const r = await fetch(api("event/points.php", { action: "requests", status: "pending" }));
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(t);
      }
      setPendingCount(j?.success && Array.isArray(j?.data) ? j.data.length : 0);
    } catch {
      setPendingCount(0);
    }
  }, []);

  // Approve/Reject
  const actRedeem = useCallback(
    async (id: number, approve: boolean) => {
      if (!adminId) return Alert.alert("Info", "Admin belum terdeteksi.");
      try {
        const urlAct = api("event/points.php", { action: approve ? "approve" : "reject" });
        const r = await fetch(urlAct, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, admin_id: adminId }),
        });
        const t = await r.text();
        let j: any;
        try {
          j = JSON.parse(t);
        } catch {
          throw new Error(t);
        }
        if (!j?.success) {
          const title = j?.severity === "warning" ? "Peringatan" : "Error";
          return Alert.alert(title, j?.message || "Gagal memproses permintaan.");
        }

        setRedeemList((prev) =>
          prev.map((row) => (row.id === id ? { ...row, status: approve ? "approved" : "rejected" } : row))
        );

        await fetchPendingCount();
        Alert.alert("Sukses", approve ? "Withdraw disetujui." : "Withdraw ditolak.");
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal memproses.");
      }
    },
    [adminId, fetchPendingCount]
  );

  // Selesai
  const finishRedeem = useCallback(
    async (id: number) => {
      if (!adminId) return Alert.alert("Info", "Admin belum terdeteksi.");
      try {
        const r = await fetch(api("event/points.php", { action: "mark_done" }), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, admin_id: adminId }),
        });
        const t = await r.text();
        let j: any;
        try {
          j = JSON.parse(t);
        } catch {
          throw new Error(t);
        }
        if (!j?.success) {
          const title = j?.severity === "warning" ? "Peringatan" : "Error";
          return Alert.alert(title, j?.message || "Gagal menandai selesai.");
        }
        setRedeemList((prev) => prev.filter((x) => x.id !== id));
        Alert.alert("Sukses", "Permintaan ditandai selesai.");
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal menandai selesai.");
      }
    },
    [adminId]
  );

  // ===== boot =====
  useEffect(() => {
    (async () => {
      await loadUsers();
      await loadItems();
      await fetchPendingCount();

      // load cache untuk bulan berjalan supaya first paint sudah ada
      const m = (monthStart || todayISO()).slice(0, 7);
      const cache = await loadProgressCache(m);
      setProgressCache(cache);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUsers, loadItems, fetchPendingCount]);

  // refresh saat fokus halaman
  useFocusEffect(
    useCallback(() => {
      fetchPendingCount();
      if (tab === "penukaran") fetchRedeemRequests();
      if (tab === "ibadah" && selectedUser) fetchIbadahClaims();
      return () => {};
    }, [tab, fetchPendingCount, fetchRedeemRequests, fetchIbadahClaims, selectedUser])
  );

  useEffect(() => {
    if (tab === "kedisiplinan" && users.length > 0) {
      fetchWeeklyProgress();
    }
  }, [tab, users, fetchWeeklyProgress]);

  // Saat ganti user/tgl di tab ibadah, muat ulang
  useEffect(() => {
    if (tab === "ibadah" && selectedUser) {
      fetchIbadahClaims();
    }
  }, [tab, selectedUser, ibadahDate, fetchIbadahClaims]);

  useEffect(() => {
    if (tab === "penukaran") {
      fetchRedeemRequests();
      return;
    }
    if (!selectedUser) return;
    setChecked(blankChecked(items));
    setTotal(0);
    if (tab === "kerapihan") {
      preloadChecked(selectedUser.id_user);
    }
  }, [tab, selectedUser, items, preloadChecked, fetchRedeemRequests]);

  const onPickUser = useCallback((u: UserRow) => {
    setSelectedUser(u);
    setChecked(blankChecked(items));
    setTotal(0);
    if (tab === "kerapihan") preloadChecked(u.id_user);
    if (tab === "ibadah") setTimeout(() => fetchIbadahClaims(), 0);
  }, [items, tab, preloadChecked, fetchIbadahClaims]);


  const nextClaimLabel = useMemo(() => {
    const d = nextDisciplineClaimDate(new Date());
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const todayOk = isTodayDisciplineClaimDay(new Date());
    return `${s}${todayOk ? " • (hari ini eligible klaim)" : ""}`;
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(
    async () => {
      setRefreshing(true);
      if (tab === "kedisiplinan") {
        await fetchWeeklyProgress();
      } else if (tab === "kerapihan" && selectedUser) {
        await Promise.allSettled([preloadChecked(selectedUser.id_user)]);
      } else if (tab === "penukaran") {
        await fetchRedeemRequests();
      } else if (tab === "ibadah" && selectedUser) {
        await fetchIbadahClaims();
      }
      await fetchPendingCount();
      setRefreshing(false);
    },
    [selectedUser, tab, preloadChecked, fetchRedeemRequests, fetchWeeklyProgress, fetchPendingCount, fetchIbadahClaims]
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#F6F9FF" }}>
      {/* Header + Tabs */}
      <View
        style={[
          st.header,
          { paddingTop: (Platform.OS === "android" ? (StatusBar?.currentHeight ?? 0) : 0) + 16 },
        ]}
      >
        <Text style={st.title}>Admin Event</Text>
        <Text style={st.sub}>Login: {adminName || "-"}</Text>
        <Text style={[st.muted, { marginTop: 6 }]}>Jadwal klaim berikutnya (konfigurasi): {nextClaimLabel}</Text>

        <View style={st.tabs}>
          {(["kedisiplinan", "kerapihan", "ibadah", "penukaran"] as TabKey[]).map((t) => {
            const label =
              t === "kedisiplinan" ? "Kedisiplinan" :
              t === "kerapihan" ? "Kerapihan" :
              t === "ibadah" ? "Ibadah" :
              "Penukaran";
            const isActive = tab === t;
            return (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[st.tab, isActive && st.tabActive]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[st.tabTx, isActive && st.tabTxActive]}>{label}</Text>
                  {/* BADGE untuk Penukaran */}
                  {t === "penukaran" && pendingCount > 0 && (
                    <View style={st.badge}>
                      <Text style={st.badgeTx}>{pendingCount}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* === KEDISIPLINAN (AGREGAT) === */}
        {tab === "kedisiplinan" && (
          <View style={st.card}>
            <Text style={st.section}>Progress Kedisiplinan</Text>
            <View style={st.legend}>
              <View style={st.legendItem}>
                <View style={[st.legendDot, { backgroundColor: "#16a34a" }]} />
                <Text style={st.legendTx}>On track</Text>
              </View>
              <View style={st.legendItem}>
                <View style={[st.legendDot, { backgroundColor: "#dc2626" }]} />
                <Text style={st.legendTx}>Hangus (telat/izin)</Text>
              </View>
            </View>
            <Text style={[st.muted, { marginBottom: 10 }]}>
              Periode: {monthStart} → {monthEnd} • Target: 24 hari kerja
            </Text>

            {loadingBoard ? (
              <Text style={st.muted}>Memuat board…</Text>
            ) : weekly.length === 0 ? (
              <Text style={st.muted}>Belum ada data.</Text>
            ) : (
              weekly.map((row) => <UserWeeklyCard key={row.user_id} row={row} />)
            )}

            <TouchableOpacity
              style={[st.primaryBtn, { alignSelf: "flex-start", marginTop: 10 }]}
              onPress={fetchWeeklyProgress}
            >
              <Text style={st.primaryBtnTx}>Refresh</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* === KERAPIHAN === */}
        {tab === "kerapihan" && (
          <View style={[st.card, { overflow: "visible" }]}>
            <Text style={st.section}>Kerapihan</Text>
            <UserPicker users={users} selected={selectedUser} onSelect={onPickUser} />
            <View style={[st.panel, { marginTop: 10 }]} >
              {items.length === 0 ? (
                <Text style={st.muted}>Belum ada item aktif (atur di master kerapihan).</Text>
              ) : (
                <>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                    <TouchableOpacity style={[st.btnSmall, { backgroundColor: "#0A84FF" }]} onPress={selectAll} disabled={!selectedUser}>
                      <Text style={st.btnSmallTx}>Select All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[st.btnSmall, { backgroundColor: "#6B7A90" }]} onPress={clearAll} disabled={!selectedUser}>
                      <Text style={st.btnSmallTx}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                  {items.map((it) => (
                    <View key={it.item_code} style={st.itemRow}>
                      <Text style={st.itemTx}>{it.item_name}</Text>
                      <Checkbox
                        value={!!checked[it.item_code]}
                        onValueChange={() => toggleItem(it.item_code)}
                        color={checked[it.item_code] ? "#0A84FF" : undefined}
                        disabled={!selectedUser}
                      />
                    </View>
                  ))}
                </>
              )}
              <Text style={st.total}>Total poin hari ini: {total}</Text>
              <TouchableOpacity
                style={[st.primaryBtn, { alignSelf: "flex-end", marginTop: 8 }]}
                onPress={submitKerapihan}
                disabled={!selectedUser || !adminId}
              >
                <Text style={st.primaryBtnTx}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* === IBADAH (galeri) === */}
        {tab === "ibadah" && (
          <View style={st.card}>
            <Text style={st.section}>Ibadah</Text>
            <UserPicker users={users} selected={selectedUser} onSelect={onPickUser} />

            {/* kontrol tanggal */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
              <TouchableOpacity style={[st.btnSmall, { backgroundColor: "#6B7A90" }]} onPress={() => shiftIbadahDate(-1)} disabled={!selectedUser}>
                <Text style={st.btnSmallTx}>◀︎ Hari-1</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.btnSmall, { backgroundColor: "#0A84FF" }]} onPress={() => setIbadahDate(todayISO())} disabled={!selectedUser}>
                <Text style={st.btnSmallTx}>Hari Ini</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.btnSmall, { backgroundColor: "#6B7A90" }]} onPress={() => shiftIbadahDate(1)} disabled={!selectedUser}>
                <Text style={st.btnSmallTx}>+1 Hari ▶︎</Text>
              </TouchableOpacity>
              <Text style={[st.muted, { marginLeft: 6 }]}>Tanggal: {ibadahDate}</Text>
            </View>

            <View style={[st.panel, { marginTop: 10 }]}>
              {loadingIbadah ? (
                <Text style={st.muted}>Memuat foto…</Text>
              ) : ibadahErr ? (
                <Text style={[st.muted, { color: "#dc2626" }]}>{ibadahErr}</Text>
              ) : ibadahList.length === 0 ? (
                <Text style={st.muted}>Belum ada foto ibadah untuk tanggal ini.</Text>
              ) : (
                <View style={st.grid}>
                  {ibadahList.map((cl) => (
                    <Pressable key={cl.id} style={st.gridItem} onPress={() => setPreviewUrl(cl.photo_url)}>
                       <Image
                          source={{ uri: cl.photo_url }}
                          style={st.gridImg}
                          resizeMode="cover"
                          onError={(e) => {
                            console.warn(" gagal load foto ibadah:", cl.photo_url, e.nativeEvent?.error);
                          }}
                        />
                      <View style={st.gridBadge}>
                        <Text style={st.gridBadgeTx}>
                          +{Number(cl.points ?? IBADAH_POINTS_PER_PHOTO).toLocaleString("id-ID")}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={st.gridMeta}>
                        {cl.prayer.toUpperCase()} • {new Date(cl.created_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                <Text style={st.total}>Total poin: {ibadahTotalPoints.toLocaleString("id-ID")}</Text>
                <TouchableOpacity style={[st.primaryBtn]} onPress={() => { fetchIbadahClaims(); }} disabled={!selectedUser}>
                  <Text style={st.primaryBtnTx}>Refresh</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* modal preview */}
            <Modal visible={!!previewUrl} transparent onRequestClose={() => setPreviewUrl(null)}>
              <View style={st.previewWrap}>
                <Pressable style={st.previewBackdrop} onPress={() => setPreviewUrl(null)} />
                <View style={st.previewBox}>
                  {previewUrl ? <Image source={{ uri: previewUrl }} style={st.previewImg} resizeMode="contain" /> : null}
                  <TouchableOpacity style={[st.primaryBtn, { marginTop: 10 }]} onPress={() => setPreviewUrl(null)}>
                    <Text style={st.primaryBtnTx}>Tutup</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </View>
        )}

        {/* === PENUKARAN POIN (OPEN) === */}
        {tab === "penukaran" && (
          <View style={st.card}>
            <Text style={st.section}>Penukaran Poin (Open)</Text>
            <View style={[st.panel, { marginTop: 8 }]}>
              {loadingRedeem ? (
                <Text style={st.muted}>Memuat…</Text>
              ) : redeemErr ? (
                <Text style={[st.muted, { color: "#dc2626" }]}>{redeemErr}</Text>
              ) : redeemList.length === 0 ? (
                <Text style={st.muted}>Belum ada pengajuan penukaran.</Text>
              ) : (
                redeemList.map((r) => {
                  const points = r.request_points ?? r.points ?? 0;
                  const rupiah = Number((r.request_amount ?? r.amount_idr) ?? 0);

                  const isPending = r.status === "pending";
                  const decided = r.status === "approved" || r.status === "rejected";
                  const done = r.admin_done === 1;

                  return (
                    <View key={r.id} style={st.redeemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.claimTitle}>
                          {r.user_name ?? `User#${r.user_id}`} • {points} poin
                        </Text>
                        <Text style={st.muted}>Rp {rupiah.toLocaleString("id-ID")}</Text>
                        {decided && !done && (
                          <Text style={[st.muted, { marginTop: 2 }]}>
                            Status: {r.status === "approved" ? "Disetujui" : "Ditolak"}
                            {r.decided_at ? ` • ${r.decided_at}` : ""}
                          </Text>
                        )}
                      </View>

                      {isPending ? (
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            style={[st.btnSmall, { backgroundColor: "#16a34a" }]}
                            onPress={() => actRedeem(r.id, true)}
                          >
                            <Text style={st.btnSmallTx}>Approve</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[st.btnSmall, { backgroundColor: "#dc2626" }]}
                            onPress={() => actRedeem(r.id, false)}
                          >
                            <Text style={st.btnSmallTx}>Reject</Text>
                          </TouchableOpacity>
                        </View>
                      ) : !done ? (
                        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: 8,
                              backgroundColor: r.status === "approved" ? "#dcfce7" : "#fee2e2",
                            }}
                          >
                            <Text
                              style={{
                                color: r.status === "approved" ? "#16a34a" : "#b91c1c",
                                fontWeight: "900",
                                fontSize: 12,
                              }}
                            >
                              {r.status === "approved" ? "APPROVED" : "REJECTED"}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={[st.btnSmall, { backgroundColor: "#0A84FF" }]}
                            onPress={() => finishRedeem(r.id)}
                          >
                            <Text style={st.btnSmallTx}>Selesai</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
              <TouchableOpacity
                style={[st.primaryBtn, { alignSelf: "flex-start", marginTop: 10 }]}
                onPress={async () => {
                  await fetchRedeemRequests();
                  await fetchPendingCount();
                }}
              >
                <Text style={st.primaryBtnTx}>Refresh</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
      <BottomNavbar preset="admin" active="center" />
    </View>
  );
}

/* ===== styles ===== */
const st = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#E6ECF5",
  },
  title: { fontSize: 20, fontWeight: "900", color: "#0A84FF", letterSpacing: 0.2 },
  sub: { color: "#6B7A90", marginTop: 4 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#E8F1FF" },
  tabActive: { backgroundColor: "#0A84FF", elevation: 2 },
  tabTx: { color: "#0A84FF", fontWeight: "800" },
  tabTxActive: { color: "#fff" },

  // badge angka di tab
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTx: { color: "#fff", fontWeight: "900", fontSize: 11 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    elevation: 2,
  },
  section: { fontSize: 16, fontWeight: "900", color: "#0B1A33", marginBottom: 8 },

  label: { color: "#0B1A33", fontWeight: "800", marginTop: 6, marginBottom: 6 },
  inputBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inputBtnTx: { color: "#0B1A33", fontWeight: "700" },

  modalBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.25)" },
  modalSheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "android" ? (StatusBar?.currentHeight ?? 0) + 40 : 60,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3ECFF",
    elevation: 10,
  },
  modalTitle: { fontWeight: "900", color: "#0B1A33", fontSize: 16, marginBottom: 6 },
  searchDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#E6ECF5", marginBottom: 6 },

  userRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#e5e7eb" },
  userRowTx: { color: "#0B1A33", fontWeight: "600" },

  panel: { backgroundColor: "#F4F7FF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E3ECFF" },

  itemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  itemTx: { color: "#0B1A33" },
  total: { color: "#0A84FF", fontWeight: "900", marginTop: 8 },

  primaryBtn: {
    backgroundColor: "#0A84FF",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryBtnTx: { color: "#fff", fontWeight: "900" },

  claimRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  claimTitle: { color: "#0B1A33", fontWeight: "800" },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  btnSmallTx: { color: "#fff", fontWeight: "800", fontSize: 12 },

  redeemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },

  muted: { color: "#6B7A90", fontSize: 13 },

  legend: { flexDirection: "row", gap: 16, marginBottom: 8, alignItems: "center" },
  legendItem: { flexDirection: "row", gap: 6, alignItems: "center" },
  legendDot: { width: 10, height: 10, borderRadius: 10 },
  legendTx: { color: "#0B1A33", fontWeight: "700", fontSize: 12 },

  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#E8F1FF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D9E7FF",
  },
  userAvatarTx: { color: "#0A84FF", fontWeight: "900" },
  userName: { color: "#0B1A33", fontWeight: "900" },
  userMeta: { color: "#6B7A90", fontSize: 12, marginTop: 2 },

  pbWrap: { marginTop: 6, height: 10, borderRadius: 999, backgroundColor: "#E6ECF5", overflow: "hidden" },
  pbFill: { height: 10, borderRadius: 999 },

  // === NEW: grid foto ibadah
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  gridItem: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
  },
  gridImg: {
    width: "100%",
    height: "100%",
  },
  gridBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    backgroundColor: "rgba(10,132,255,0.9)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gridBadgeTx: { color: "#fff", fontWeight: "900", fontSize: 11 },
  gridMeta: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    color: "#fff",
    fontWeight: "800",
    fontSize: 11,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },

  // preview modal
  previewWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  previewBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  previewBox: { width: "100%", borderRadius: 12, backgroundColor: "#fff", padding: 12, alignItems: "center" },
  previewImg: { width: "100%", height: 420, borderRadius: 8 },
});
