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
  ActivityIndicator,
  Modal,
  FlatList,
  StatusBar,
  RefreshControl,
  Image,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import Checkbox from "expo-checkbox";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE as RAW_API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";
import { isTodayDisciplineClaimDay, nextDisciplineClaimDate } from "../../eventConfig";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

// =========================================================
// KONFIGURASI DAN TIPE DATA
// =========================================================
const BASE = String(RAW_API_BASE).replace(/\/+$/, "") + "/";
const SCREEN_HEIGHT = Dimensions.get("window").height;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// Kita pakai satu tipe data utama untuk Request Penukaran
type RedeemReq = {
  id: number;
  user_id: number;
  user_name?: string | null;
  request_points?: number | null;
  request_amount?: number | null;
  points?: number | null;
  amount_idr?: number | null;
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

type IbadahClaim = {
  id: number;
  user_id: number;
  user_name?: string | null;
  prayer: "zuhur" | "ashar";
  photo_url: string;
  created_at: string;
  points?: number;
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

/* ==== KOMPONEN: ProgressBar ==== */
const ProgressBar = ({ ratio, broken }: { ratio: number; broken: boolean }) => {
  const widthPct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const barColor = broken ? "#EF4444" : "#10B981";
  return (
    <View style={st.pbWrap}>
      <View style={[st.pbFill, { width: `${widthPct}%`, backgroundColor: barColor }]} />
    </View>
  );
};

/* ==== KOMPONEN: UserWeeklyCard ==== */
const UserWeeklyCard = React.memo(({ row }: { row: WeeklyRow }) => {
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
        {!!row.broken && !!row.reason && <Text style={[st.userMeta, st.brokenReason]}>{row.reason}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#E2E8F0" />
    </View>
  );
});
UserWeeklyCard.displayName = "UserWeeklyCard";

/* ==== KOMPONEN: RedeemRequestCard ==== */
const RedeemRequestCard = React.memo(({ req, onApprove, onReject, onFinish }: {
    req: RedeemReq,
    onApprove: (id: number) => Promise<void>,
    onReject: (id: number) => Promise<void>,
    onFinish: (id: number) => Promise<void>
}) => {
    const points = req.request_points ?? req.points ?? 0;
    const rupiah = Number((req.request_amount ?? req.amount_idr) ?? 0);
    const isPending = req.status === "pending";
    const statusColor = req.status === 'approved' ? '#10B981' : req.status === 'rejected' ? '#EF4444' : '#F59E0B';
    const statusText = req.status.toUpperCase();
    const isDone = Number(req.admin_done || 0) === 1;
    const showFinishButton = req.status === 'approved' && !isDone;

    return (
        <View style={[st.redeemCard, isDone && st.redeemDone]}>
            <View style={st.redeemInfo}>
                <Text style={st.redeemUser}>{req.user_name ?? `User#${req.user_id}`}</Text>
                <View style={st.redeemDetails}>
                    <Text style={st.redeemPoints}>{points.toLocaleString()} Poin</Text>
                    <Ionicons name="arrow-forward" size={14} color="#94A3B8" />
                    <Text style={st.redeemRupiah}>Rp {rupiah.toLocaleString("id-ID")}</Text>
                </View>
                {!isPending && (
                    <Text style={[st.redeemStatus, { color: statusColor }]}>
                        {statusText} {isDone ? "• SELESAI" : (req.status === 'approved' ? "• MENUNGGU KONFIRMASI" : "")}
                    </Text>
                )}
                <Text style={st.redeemDate}>{req.created_at.slice(0, 10)}</Text>
            </View>

            <View style={st.redeemActions}>
                {isPending ? (
                    <>
                        <TouchableOpacity style={[st.iconAction, st.approveAction]} onPress={() => onApprove(req.id)}>
                            <Ionicons name="checkmark" size={20} color="#166534" />
                        </TouchableOpacity>
                        <TouchableOpacity style={[st.iconAction, st.rejectAction]} onPress={() => onReject(req.id)}>
                            <Ionicons name="close" size={20} color="#991B1B" />
                        </TouchableOpacity>
                    </>
                ) : showFinishButton ? (
                    <TouchableOpacity style={[st.btnSmall, st.finishBtn]} onPress={() => onFinish(req.id)}>
                        <Text style={st.btnSmallTx}>Selesai</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
});
RedeemRequestCard.displayName = "RedeemRequestCard";


/* ========= Cache progress MTD ========= */
function monthKey(dISO: string) {
  return (dISO || todayISO()).slice(0, 7);
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

/* ===== UserPicker (Modal) ===== */
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
        <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
      </TouchableOpacity>
    ),
    [onSelect]
  );

  return (
    <View style={{ zIndex: 1 }}>
      <Text style={st.label}>Nama Karyawan</Text>
      <Pressable style={st.inputBtn} onPress={() => setOpen(true)}>
        <Text style={[st.inputBtnTx, !selected && st.muted]}>
          {selected ? selected.nama : "Pilih karyawan..."}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#64748B" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={st.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View />
        </TouchableOpacity>

        <View style={st.modalSheet}>
          <View style={st.modalHeader}>
            <Text style={st.modalTitle}>Pilih Karyawan</Text>
            <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={24} color="#64748B" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={users}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            windowSize={8}
            style={{ maxHeight: 400 }}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
          {users.length === 0 && <Text style={[st.muted, st.centerText, { marginTop: 16 }]}>Tidak ada data user.</Text>}
        </View>
      </Modal>
    </View>
  );
}

// =========================================================
// MAIN COMPONENT (AdminEventPage)
// =========================================================
export default function AdminEventPage() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab =
    params?.tab === "penukaran" || params?.tab === "kerapihan" || params?.tab === "ibadah"
      ? (params.tab as TabKey)
      : "kedisiplinan";
  const [tab, setTab] = useState<TabKey>(initialTab);

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
        ).trim();
        if (!id) Alert.alert("Info", "ID admin tidak ditemukan di sesi, pastikan sudah login.");
        setAdminId(id);
        setAdminName(name || (id ? `Admin#${id}` : "Admin"));
      } catch (e: any) {
        Alert.alert("Error", e?.message || String(e));
      }
    })();
  }, []);

  // ===== users =====
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  
  // STATE KHUSUS ACCORDION
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

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
      .filter((u) => Number.isFinite(u.id_user) && u.id_user > 0 && u.nama.length > 0)
      .sort((a, b) => a.nama.localeCompare(b.nama));

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch(api("event/kedisiplinan.php", { action: "user_list" }));
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch (e) {
        throw new Error(`Non-JSON user_list`);
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

  // ======= BOARD KEDISIPLINAN =======
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
      try { j = JSON.parse(t); } catch { throw new Error(`Non-JSON monthly_board_24`); }

      const meta = j?.meta ?? {};
      const hangusAt: string = String(meta.hangus_at ?? "08:00:00");
      const days: string[] = Array.isArray(meta.days) ? meta.days : [];
      const today = todayISO();
      const nowHMS = new Date().toTimeString().slice(0, 8);
      const isPendingToday = days.includes(today) && (nowHMS < hangusAt);

      const rows: WeeklyRow[] = (j?.success && Array.isArray(j?.data))
        ? j.data.map((row: any): WeeklyRow => ({
              user_id: Number(row.user_id || 0),
              user_name: String(row.user_name || `User#${row.user_id || 0}`),
              week_start: monthStart,
              week_end: monthEnd,
              total_days: Number(row.total_days ?? 24),
              good_days: Number(row.good_days ?? 0),
              broken: isPendingToday ? false : Boolean(row.broken),
              reason: isPendingToday ? null : (row.reason ?? null),
            }))
        : [];

      const byId = new Map<number, WeeklyRow>(rows.map((r) => [r.user_id, r]));
      const merged: WeeklyRow[] = users.map((u) => {
        const base = byId.get(u.id_user) ?? makePlaceholderRow(u, monthStart, monthEnd);
        const prev = cache[u.id_user] as WeeklyRow | undefined;
        if (!prev) return base;
        const good_days = Math.max(Number(base.good_days || 0), Number(prev.good_days || 0));
        const total_days = base.total_days || prev.total_days || 24;
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
  const [loadingKerapihan, setLoadingKerapihan] = useState(false);

  const loadItems = useCallback(async () => {
    async function fetchItemsFrom(url: string) {
      const r = await fetch(url);
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error(`Non-JSON items`);
      }
      if (!j?.success) throw new Error(`Items failed`);
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
      setLoadingKerapihan(true);
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
      } finally {
        setLoadingKerapihan(false);
      }
    },
    [items]
  );

  const toggleAccordion = (user: UserRow) => {
      // Animasi Slide
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      
      if (expandedUserId === user.id_user) {
          // Kalau diklik lagi, tutup
          setExpandedUserId(null);
          setSelectedUser(null);
          setTotal(0);
      } else {
          // Buka user baru
          setExpandedUserId(user.id_user);
          setSelectedUser(user);
          // Load data checklist user tsb
          preloadChecked(user.id_user);
      }
  };

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

      Alert.alert("Tersimpan", `Total poin ${selectedUser.nama}: ${j?.data?.total_points ?? 0}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Gagal menyimpan");
    }
  };

  // ====== IBADAH ======
  const [ibadahDate, setIbadahDate] = useState<string>(todayISO());
  const [ibadahList, setIbadahList] = useState<IbadahClaim[]>([]);
  const [loadingIbadah, setLoadingIbadah] = useState(false);
  const [ibadahErr, setIbadahErr] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
        const rows: IbadahClaim[] = (Array.isArray(j?.data) ? j.data : []).map((raw: any) => {
          const rel = String(raw.photo_path ?? "").replace(/^\/+/, "");
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
    if (!selectedUser) return;
    const d = new Date(ibadahDate);
    d.setDate(d.getDate() + days);
    setIbadahDate(toISO(d));
  };

  // ====== Penukaran Poin ======
  const [loadingRedeem, setLoadingRedeem] = useState(false);
  const [redeemList, setRedeemList] = useState<RedeemReq[]>([]);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);

  // == RIWAYAT PENUKARAN ==
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<RedeemReq[]>([]); // FIX: Pakai RedeemReq biar konsisten
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMonth, setHistoryMonth] = useState<string>(todayISO().slice(0, 7));

  const fetchRedeemRequests = useCallback(async () => {
    setLoadingRedeem(true);
    setRedeemErr(null);
    try {
      const r = await fetch(api("event/points.php", { action: "requests", status: "all" }));
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
        // FIX: Gunakan Number() untuk memastikan 0 adalah false, bukan string "0"
        const openRequests = (Array.isArray(j?.data) ? j.data : []).filter((r: RedeemReq) => {
            const isAdminDone = Number(r.admin_done || 0) === 1;
            return !isAdminDone || r.status === 'pending';
        });
        setRedeemList(openRequests);
      }
    } catch (e: any) {
      setRedeemErr(e?.message || "Gagal memuat daftar penukaran.");
      setRedeemList([]);
    } finally {
      setLoadingRedeem(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      // 🔥 FIX PENTING: Pake action "requests" biar dapet data Request (bukan raw log poin)
      // Kita ambil semua, nanti filter di JS
      const r = await fetch(api("event/points.php", {
        action: "requests",
        status: "all" 
      }));
      const t = await r.text();
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error("Invalid JSON history");
      }

      if(j?.success && Array.isArray(j?.data)) {
        // 🔥 FILTER: Yang statusnya 'rejected' ATAU (approved + done)
        // Dan bulannya cocok sama historyMonth
        const filtered = j.data.filter((i: RedeemReq) => {
            const isDone = Number(i.admin_done || 0) === 1;
            const isFinished = (i.status === 'approved' && isDone) || i.status === 'rejected';
            const isMatchMonth = i.created_at.startsWith(historyMonth);
            return isFinished && isMatchMonth;
        });
        setHistoryList(filtered);
      } else {
        setHistoryList([]);
      }
    } catch (e) {
      console.log("History error:", e);
      setHistoryList([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [historyMonth]);

  const shiftHistoryMonth = (delta: number) => {
    const [y, m] = historyMonth.split("-").map(Number);
    const d = new Date(y, (m - 1) + delta, 1);
    const ny = d.getFullYear();
    const nm = String(d.getMonth() + 1).padStart(2, "0");
    setHistoryMonth(`${ny}-${nm}`);
  };

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [historyMonth, showHistory, fetchHistory]);

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

        // --- UPDATE STATUS DI UI TANPA MENGHILANGKAN ---
        setRedeemList((prev) =>
          prev.map((row) => (row.id === id ? { ...row, status: approve ? "approved" : "rejected" } : row))
        );

        await fetchPendingCount();
        Alert.alert("Sukses", approve ? "Withdraw disetujui. Silakan selesaikan penukaran." : "Withdraw ditolak.");
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal memproses.");
      }
    },
    [adminId, fetchPendingCount]
  );

  // Selesai (Tombol Akhir)
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

        // --- BARU HAPUS DARI LIST KALO UDAH SELESAI ---
        setRedeemList((prev) => prev.filter((x) => x.id !== id));
        
        if(showHistory) fetchHistory();
        await fetchPendingCount();
        Alert.alert("Sukses", "Permintaan ditandai selesai.");
      } catch (e: any) {
        Alert.alert("Error", e?.message || "Gagal menandai selesai.");
      }
    },
    [adminId, showHistory, fetchHistory, fetchPendingCount]
  );

  // ===== boot =====
  useEffect(() => {
    (async () => {
      await loadUsers();
      await loadItems();
      await fetchPendingCount();
      const m = (monthStart || todayISO()).slice(0, 7);
      const cache = await loadProgressCache(m);
      setProgressCache(cache);
    })();
  }, [loadUsers, loadItems, fetchPendingCount, monthStart]);

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
    <View style={st.container}>
      {/* Diubah: StatusBar dan warna Header */}
      <StatusBar backgroundColor="#2196F3" barStyle="light-content" />

      {/* Header */}
      <View style={[st.header, st.blueHeader]}>
        <Text style={st.titleWhite}>Admin Event 📋</Text>
        <Text style={st.subWhite}>Login: {adminName || "-"}</Text>
        <Text style={st.noteWhite}>Next Klaim: {nextClaimLabel}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tabsContainer}>
          {(["kedisiplinan", "kerapihan", "ibadah", "penukaran"] as TabKey[]).map((t) => {
            const isActive = tab === t;
            const labelMap: Record<string, string> = {
                kedisiplinan: "Kedisiplinan",
                kerapihan: "Kerapihan",
                ibadah: "Ibadah",
                penukaran: "Penukaran",
            };
            return (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={[st.tab, isActive && st.tabActiveBlue]}>
                <Text style={[st.tabTx, isActive && st.tabTxActiveBlue]}>{labelMap[t]}</Text>
                 {t === "penukaran" && pendingCount > 0 && (
                    <View style={st.badge}>
                      <Text style={st.badgeTx}>{pendingCount}</Text>
                    </View>
                  )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={st.contentContainer}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#2196F3"]} tintColor="#2196F3" />}
      >
        {/* === KEDISIPLINAN === */}
        {tab === "kedisiplinan" && (
          <View style={st.sectionWrapper}>
            <View style={st.sectionHeader}>
                <Text style={st.sectionTitle}>Progress Kedisiplinan</Text>
                <TouchableOpacity onPress={fetchWeeklyProgress} style={st.iconBtn}>
                    <Ionicons name="refresh-circle-outline" size={24} color="#64748B" />
                </TouchableOpacity>
            </View>

            <View style={st.legendContainer}>
               <View style={st.legendItem}><View style={[st.legendDot, st.dotGreen]} /><Text style={st.legendText}>On Track</Text></View>
               <View style={st.legendItem}><View style={[st.legendDot, st.dotRed]} /><Text style={st.legendText}>Hangus</Text></View>
            </View>

            <Text style={st.periodText}>Periode: **{monthStart}** → **{monthEnd}**</Text>

            {loadingBoard ? (
              <ActivityIndicator size="large" color="#1565C0" style={st.loading} />
            ) : weekly.length === 0 ? (
              <Text style={st.emptyText}>Belum ada data kedisiplinan.</Text>
            ) : (
              weekly.map((row) => <UserWeeklyCard key={row.user_id} row={row} />)
            )}
          </View>
        )}

        {/* === KERAPIHAN (ACCORDION STYLE) === */}
        {tab === "kerapihan" && (
          <View style={st.sectionWrapper}>
            <Text style={st.sectionTitle}>Checklist Kerapihan Harian</Text>
            {/* UserPicker dihilangkan di sini, diganti List Accordion */}

            {items.length === 0 ? (
                <Text style={st.emptyText}>Belum ada item aktif untuk kerapihan.</Text>
            ) : (
                <View style={st.accordionContainer}>
                    {users.map((user) => {
                        const isExpanded = expandedUserId === user.id_user;
                        
                        return (
                            <View key={user.id_user} style={[st.card, {marginBottom: 10, padding: 0, overflow: 'hidden'}]}>
                                {/* Header Accordion */}
                                <TouchableOpacity 
                                    style={st.accordionHeader} 
                                    onPress={() => toggleAccordion(user)}
                                    activeOpacity={0.7}
                                >
                                    <View style={st.userAvatar}>
                                        <Text style={st.userAvatarTx}>
                                            {user.nama.substring(0,2).toUpperCase()}
                                        </Text>
                                    </View>
                                    <Text style={[st.accordionTitle, isExpanded && {color: '#1565C0'}]}>{user.nama}</Text>
                                    <Ionicons 
                                        name={isExpanded ? "chevron-up" : "chevron-down"} 
                                        size={20} 
                                        color={isExpanded ? "#1565C0" : "#94A3B8"} 
                                    />
                                </TouchableOpacity>

                                {/* Body Accordion (Checklist) */}
                                {isExpanded && (
                                    <View style={st.accordionBody}>
                                        {loadingKerapihan ? (
                                            <ActivityIndicator size="small" color="#1565C0" style={{marginVertical: 20}} />
                                        ) : (
                                            <>
                                                <View style={st.actionRow}>
                                                    <TouchableOpacity style={[st.btnSmall, st.btnPrimary]} onPress={selectAll}>
                                                        <Text style={st.btnSmallTx}>Select All</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity style={[st.btnSmall, st.btnSecondary]} onPress={clearAll}>
                                                        <Text style={st.btnSmallTx}>Clear</Text>
                                                    </TouchableOpacity>
                                                </View>

                                                <View style={st.divider} />

                                                {items.map((it) => (
                                                    <Pressable key={it.item_code} style={st.checkRow} onPress={() => toggleItem(it.item_code)}>
                                                        <View style={{flexShrink: 1}}>
                                                            <Text style={st.checkLabel}>{it.item_name}</Text>
                                                            <Text style={st.checkPoints}>+{it.point_value.toLocaleString()} Poin</Text>
                                                        </View>
                                                        <Checkbox
                                                            value={!!checked[it.item_code]}
                                                            onValueChange={() => toggleItem(it.item_code)}
                                                            color={checked[it.item_code] ? "#1565C0" : undefined}
                                                        />
                                                    </Pressable>
                                                ))}

                                                <View style={st.divider} />
                                                
                                                <View style={st.footerRow}>
                                                    <Text style={st.totalText}>Total: **{total.toLocaleString()}**</Text>
                                                    <TouchableOpacity
                                                        style={[st.primaryBtn, !adminId && st.btnDisabled]}
                                                        onPress={submitKerapihan}
                                                        disabled={!adminId}
                                                    >
                                                        <Text style={st.primaryBtnTx}>Simpan</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </>
                                        )}
                                    </View>
                                )}
                            </View>
                        );
                    })}
                </View>
            )}
          </View>
        )}

        {/* === IBADAH === */}
        {tab === "ibadah" && (
          <View style={st.sectionWrapper}>
            <Text style={st.sectionTitle}>Verifikasi Ibadah Harian</Text>
            <UserPicker users={users} selected={selectedUser} onSelect={onPickUser} />

            <View style={st.dateNav}>
              <TouchableOpacity style={st.navBtn} onPress={() => shiftIbadahDate(-1)} disabled={!selectedUser}>
                  <Ionicons name="chevron-back" size={20} color="#64748B" />
              </TouchableOpacity>
              <View style={st.dateDisplay}>
                  <Text style={st.dateTx}>{ibadahDate === todayISO() ? "**Hari Ini**" : ibadahDate}</Text>
              </View>
               <TouchableOpacity style={st.navBtn} onPress={() => shiftIbadahDate(1)} disabled={!selectedUser}>
                  <Ionicons name="chevron-forward" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={st.card}>
              {loadingIbadah ? (
                <ActivityIndicator size="small" color="#1565C0" />
              ) : ibadahErr ? (
                <Text style={st.errorText}>{ibadahErr}</Text>
              ) : ibadahList.length === 0 ? (
                <Text style={st.emptyText}>Belum ada foto ibadah untuk tanggal ini.</Text>
              ) : (
                <View style={st.grid}>
                  {ibadahList.map((cl) => (
                    <Pressable key={cl.id} style={st.gridItem} onPress={() => setPreviewUrl(cl.photo_url)}>
                      <Image source={{ uri: cl.photo_url }} style={st.gridImg} resizeMode="cover" />
                      <View style={st.pointsBadge}>
                        <Text style={st.pointsTx}>+{Number(cl.points ?? IBADAH_POINTS_PER_PHOTO).toLocaleString()}</Text>
                      </View>
                      <View style={st.metaOverlay}>
                        <Text style={st.metaTx}>{cl.prayer.toUpperCase()}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}

              <View style={st.divider} />
              <View style={st.footerRow}>
                 <Text style={st.totalText}>Total Poin: **{ibadahTotalPoints.toLocaleString()}**</Text>
                 <TouchableOpacity onPress={() => fetchIbadahClaims()} disabled={!selectedUser}>
                    <Ionicons name="refresh-circle-outline" size={28} color="#1565C0" />
                 </TouchableOpacity>
              </View>
            </View>

            <Modal visible={!!previewUrl} transparent onRequestClose={() => setPreviewUrl(null)}>
              <View style={st.previewOverlay}>
                <Pressable style={st.backdrop} onPress={() => setPreviewUrl(null)} />
                <View style={st.previewContent}>
                    <View style={st.previewHeader}>
                        <Text style={st.previewTitle}>Preview Foto</Text>
                        <TouchableOpacity onPress={() => setPreviewUrl(null)}>
                            <Ionicons name="close" size={24} color="#64748B" />
                        </TouchableOpacity>
                    </View>
                  {previewUrl && <Image source={{ uri: previewUrl }} style={st.previewImage} resizeMode="contain" />}
                </View>
              </View>
            </Modal>
          </View>
        )}

        {/* === PENUKARAN POIN === */}
        {tab === "penukaran" && (
          <View style={st.sectionWrapper}>
            <View style={st.sectionHeader}>
                <Text style={st.sectionTitle}>Request Penukaran Poin</Text>
                <TouchableOpacity style={st.historyBtn} onPress={() => { setShowHistory(true); }}>
                    <Ionicons name="time-outline" size={18} color="#fff" />
                    <Text style={st.historyBtnTx}>Riwayat</Text>
                </TouchableOpacity>
            </View>

            <View style={st.card}>
              {loadingRedeem ? (
                <ActivityIndicator size="small" color="#1565C0" />
              ) : redeemErr ? (
                <Text style={st.errorText}>{redeemErr}</Text>
              ) : redeemList.length === 0 ? (
                <Text style={st.emptyText}>Tidak ada request pending atau yang perlu diproses.</Text>
              ) : (
                redeemList.map((r) => (
                    <RedeemRequestCard
                        key={r.id}
                        req={r}
                        onApprove={() => actRedeem(r.id, true)}
                        onReject={() => actRedeem(r.id, false)}
                        onFinish={() => finishRedeem(r.id)}
                    />
                ))
              )}
               <TouchableOpacity style={st.refreshLink} onPress={async () => { await fetchRedeemRequests(); await fetchPendingCount(); }}>
                 <Ionicons name="sync-circle-outline" size={18} color="#1565C0" />
                 <Text style={st.refreshLinkTx}>Refresh List</Text>
               </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* === MODAL RIWAYAT (POPUP TENGAH) === */}
      <Modal visible={showHistory} transparent animationType="fade" onRequestClose={() => setShowHistory(false)}>
        <View style={st.centerOverlay}>
            <Pressable style={st.backdropLayer} onPress={() => setShowHistory(false)} />
            <View style={st.centerPopup}>
                {/* Header Popup */}
                <View style={st.bsHeader}>
                    <Text style={st.bsTitle}>Riwayat Penukaran</Text>
                    <TouchableOpacity onPress={() => setShowHistory(false)}>
                        <Ionicons name="close" size={24} color="#64748B" />
                    </TouchableOpacity>
                </View>

                {/* Content Popup */}
                <View style={{flex: 1}}>
                    <View style={st.monthFilter}>
                        <TouchableOpacity onPress={() => shiftHistoryMonth(-1)}><Ionicons name="chevron-back" size={24} color="#1565C0" /></TouchableOpacity>
                        <Text style={st.monthText}>Bulan: **{historyMonth}**</Text>
                        <TouchableOpacity onPress={() => shiftHistoryMonth(1)}><Ionicons name="chevron-forward" size={24} color="#1565C0" /></TouchableOpacity>
                    </View>

                    {loadingHistory ? (
                        <ActivityIndicator size="large" color="#1565C0" style={{marginTop: 40, marginBottom: 40}} />
                    ) : (
                        <FlatList
                            data={historyList}
                            keyExtractor={item => String(item.id)}
                            contentContainerStyle={{padding: 20}}
                            ListEmptyComponent={<Text style={[st.emptyText, st.centerText, {marginTop: 40}]}>Tidak ada riwayat penukaran di bulan ini.</Text>}
                            renderItem={({item}) => {
                                const isDone = Number(item.admin_done || 0) === 1;
                                const isRejected = item.status === 'rejected';
                                const statusLabel = isRejected ? "DITOLAK" : (isDone ? "SELESAI" : "PENDING");
                                const statusColor = isRejected ? "#EF4444" : (isDone ? "#10B981" : "#F59E0B");

                                return (
                                    <View style={st.historyItem}>
                                        <View style={{flexShrink: 1, marginRight: 16}}>
                                            <Text style={st.historyUser}>{item.user_name || `User #${item.user_id}`}</Text>
                                            <Text style={st.historyDate}>{item.created_at}</Text>
                                            {item.note && <Text style={st.historyNote}>**Catatan:** {item.note}</Text>}
                                        </View>
                                        <View style={{alignItems:'flex-end'}}>
                                            <Text style={st.historyPoints}>{Number(item.request_points || item.points || 0).toLocaleString()} P</Text>
                                            {item.amount_idr && <Text style={st.historyIdr}>Rp {Number(item.amount_idr).toLocaleString("id-ID")}</Text>}
                                            <Text style={{color: statusColor, fontSize: 10, fontWeight: 'bold', marginTop: 4}}>{statusLabel}</Text>
                                        </View>
                                    </View>
                                )
                            }}
                        />
                    )}
                </View>
            </View>
        </View>
      </Modal>

      <BottomNavbar
        preset="admin"
        active="center"
        config={{ center: { badge: pendingCount } }}
      />
    </View>
  );
}

// =========================================================
// STYLESHEET
// =========================================================
const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  contentContainer: { padding: 20, paddingBottom: 160 },
  centerText: { textAlign: 'center' },
  dotGreen: {backgroundColor:'#10B981'},
  dotRed: {backgroundColor:'#EF4444'},
  btnPrimary: { backgroundColor: "#1565C0" },
  btnSecondary: { backgroundColor: "#64748B" },
  finishBtn: { backgroundColor: '#10B981' },
  btnDisabled: { opacity: 0.4 },

  // Header Biru
  blueHeader: {
    backgroundColor: "#2196F3",
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  titleWhite: { fontSize: 24, fontWeight: "800", color: "#fff" },
  subWhite: { fontSize: 14, color: "#E0F2FE", marginTop: 2 },
  noteWhite: { fontSize: 12, color: "#BFDBFE", marginTop: 4, fontStyle: 'italic' },
  
  header: {
    paddingHorizontal: 20,
    paddingTop: StatusBar.currentHeight || 40,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    zIndex: 10,
  },
  
  tabsContainer: { marginTop: 20, paddingRight: 20 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 10
  },
  tabActiveBlue: { 
    backgroundColor: "#fff",
    shadowColor: '#000',
    shadowOpacity: 0.1,
    elevation: 4
  },
  tabTx: { fontSize: 14, fontWeight: "600", color: "#E0F2FE" },
  tabTxActiveBlue: { color: "#1565C0" },
  badge: { backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  badgeTx: { color: "#fff", fontSize: 10, fontWeight: "bold" },

  sectionWrapper: { marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#1E293B" },
  iconBtn: { padding: 4 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#F1F5F9"
  },

  // ACCORDION STYLES
  accordionContainer: { marginTop: 8 },
  accordionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: '#fff',
  },
  accordionTitle: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: '#334155',
  },
  accordionBody: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      backgroundColor: '#F8FAFC',
      borderTopWidth: 1,
      borderTopColor: '#F1F5F9',
  },

  // Kedisiplinan Styles
  legendContainer: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: "#64748B" },
  periodText: { fontSize: 12, color: "#94A3B8", marginBottom: 16, fontWeight: '600' },

  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9"
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E0F2FE",
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  userAvatarTx: { color: "#1565C0", fontWeight: "700", fontSize: 14 },
  userName: { fontSize: 16, fontWeight: "600", color: "#334155" },
  userMeta: { fontSize: 12, color: "#94A3B8", marginTop: 2 },
  brokenReason: { color: "#EF4444", fontStyle: 'italic', marginTop: 4, fontSize: 11 },
  pbWrap: { height: 8, backgroundColor: "#E2E8F0", borderRadius: 4, marginTop: 6, width: '100%', overflow:'hidden' },
  pbFill: { height: '100%', borderRadius: 4 },
  loading: { marginTop: 30 },

  // User Picker
  label: { fontSize: 14, fontWeight: "600", color: "#475569", marginBottom: 8 },
  inputBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16
  },
  inputBtnTx: { fontSize: 14, color: "#0F172A" },

  // Kerapihan
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 10, marginTop: 10 },
  checkboxList: { maxHeight: SCREEN_HEIGHT * 0.4, paddingHorizontal: 4 },
  checkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0"
  },
  checkLabel: { fontSize: 14, color: "#334155", fontWeight: '500' },
  checkPoints: { fontSize: 12, color: "#10B981", marginTop: 2, fontWeight: '600' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  totalText: { fontSize: 16, fontWeight: "700", color: "#1565C0" },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 0, marginTop: 10 },

  // Ibadah
  dateNav: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 16, gap: 12 },
  navBtn: { padding: 8, backgroundColor: "#E2E8F0", borderRadius: 8 },
  dateDisplay: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: "#E0F2FE", borderRadius: 20 },
  dateTx: { fontSize: 16, fontWeight: "700", color: "#1565C0" },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', padding: 4 },
  gridItem: { width: '30%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: "#E2E8F0", position: 'relative' },
  gridImg: { width: '100%', height: '100%' },
  pointsBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(16, 185, 129, 0.9)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pointsTx: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  metaOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', padding: 6, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  metaTx: { color: '#fff', fontSize: 11, textAlign: 'center', fontWeight: '700' },

  // Penukaran
  historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#64748B', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  historyBtnTx: { color: '#fff', fontSize: 12, fontWeight: '600' },
  redeemCard: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  redeemDone: { opacity: 0.7 },
  redeemInfo: { flex: 1 },
  redeemUser: { fontSize: 16, fontWeight: "700", color: "#1E293B" },
  redeemDetails: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  redeemPoints: { fontSize: 13, color: "#64748B", fontWeight: "500" },
  redeemRupiah: { fontSize: 13, color: "#1565C0", fontWeight: "700" },
  redeemStatus: { fontSize: 11, fontWeight: "bold", marginTop: 6, fontStyle: 'italic' },
  redeemDate: { fontSize: 10, color: '#94A3B8', marginTop: 4 },
  redeemActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconAction: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  approveAction: {backgroundColor: '#DCFCE7'},
  rejectAction: {backgroundColor: '#FEE2E2'},
  refreshLink: { alignSelf: 'center', marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  refreshLinkTx: { color: "#1565C0", fontSize: 14, fontWeight: "600" },

  // Buttons
  primaryBtn: { backgroundColor: "#1565C0", paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },
  primaryBtnTx: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnSmall: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  btnSmallTx: { color: "#fff", fontSize: 13, fontWeight: "600" },

  // Modal Styles (User Picker)
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, top: 100,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, elevation: 10
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#0F172A" },
  userRow: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  userRowTx: { fontSize: 16, color: "#334155", fontWeight: '500' },

  // Preview Modal
  previewOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backdrop: { position: 'absolute', width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.9)' },
  previewContent: { width: '90%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden' },
  previewHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#F9FAFB' },
  previewTitle: { fontSize: 18, fontWeight: '700' },
  previewImage: { width: '100%', height: SCREEN_HEIGHT * 0.6, backgroundColor: '#F8FAFC' },

  // POPUP CENTER STYLES
  centerOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropLayer: { position: 'absolute', width: '100%', height: '100%' },
  centerPopup: { width: '90%', maxHeight: '80%', backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', elevation: 5 },

  bsHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  bsTitle: { fontSize: 20, fontWeight: "700", color: "#1E293B" },
  
  monthFilter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20, paddingVertical: 16, backgroundColor: '#F1F5F9' },
  monthText: { fontSize: 16, fontWeight: "600", color: "#334155" },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  historyUser: { fontSize: 15, fontWeight: "600", color: "#334155" },
  historyDate: { fontSize: 12, color: "#94A3B8", marginTop: 2 },
  historyNote: { fontSize: 12, color: "#64748B", marginTop: 4, fontStyle: 'italic' },
  historyPoints: { fontSize: 15, fontWeight: "700", color: "#64748B" },
  historyIdr: { fontSize: 13, color: "#1565C0", fontWeight: "700" },

  // Utilities
  muted: { color: "#94A3B8" },
  emptyText: { color: "#94A3B8", textAlign: 'center', fontStyle: 'italic', marginTop: 20, fontSize: 14 },
  errorText: { color: "#EF4444", fontSize: 14, textAlign: 'center', fontWeight: '600' },
});