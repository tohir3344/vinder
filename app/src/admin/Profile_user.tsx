import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  type ViewStyle,
  type TextStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons, Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

/* ===== Types ===== */
type UserRow = {
  id: number;
  username: string;
  role?: string;
  nama_lengkap?: string | null;
  password?: string | null;
  tempat_lahir?: string | null;
  tanggal_lahir?: string | null;
  no_telepon?: string | null;
  alamat?: string | null;
  gaji?: number | string | null; // NEW
};

/* ===== Endpoints ===== */
const GET_ALL_USERS = `${API_BASE}auth/get_all_users_detail.php`;
const GET_USER_DETAIL = (id: number) =>
  `${API_BASE}auth/get_user_detail.php?id=${encodeURIComponent(String(id))}`;
const DELETE_USER = (id: number) =>
  `${API_BASE}auth/delete_user.php?id=${encodeURIComponent(String(id))}`;
const UPDATE_USER = `${API_BASE}auth/update_user.php`;

/* ===== UI tokens ===== */
const COLORS = {
  bg: "#F7F9FC",
  card: "#FFFFFF",
  text: "#222222",
  sub: "#6B7280",
  line: "#E5E7EB",
  brand: "#0D47A1",
  brandSoft: "#EAF1FF",
  danger: "#E11D48",
};
const R = 14;
const PAD = 16;

/* ===== helpers ===== */
function getInitials(name?: string | null, fallback = "?") {
  const n = (name || "").trim();
  if (!n) return fallback;
  const p = n.split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]?.toUpperCase() || "").join("") || fallback;
}
function roleColor(role?: string) {
  return String(role).toLowerCase() === "admin" ? "#E02424" : COLORS.brand;
}
function roleLabel(role?: string) {
  if (!role) return "User";
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}
const avatarStyle = (role?: string): ViewStyle => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor:
    String(role).toLowerCase() === "admin" ? "#FDE2E2" : COLORS.brandSoft,
  borderWidth: 1,
  borderColor: String(role).toLowerCase() === "admin" ? "#FECACA" : "#DCE8FF",
});

// NEW: format Rupiah
function formatRupiah(v: any) {
  if (v === null || v === undefined || v === "") return "-";
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  if (!isFinite(n)) return "-";
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return "Rp " + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
}

/* ===== Component ===== */
export default function Profil_user() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalDetailVisible, setModalDetailVisible] = useState(false);
  const [modalActionVisible, setModalActionVisible] = useState(false);
  const [modalEditVisible, setModalEditVisible] = useState(false);

  const [editData, setEditData] = useState<Partial<UserRow>>({});
  const [searchText, setSearchText] = useState("");

  /* ---- Fetch all ---- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(GET_ALL_USERS);
        const data = await res.json();
        if (!alive) return;
        if (data?.success && Array.isArray(data?.data)) {
          setUsers(data.data);
          setFilteredUsers(data.data);
        } else {
          Alert.alert("Info", data?.message || "Tidak ada data user.");
        }
      } catch {
        Alert.alert("Error", "Gagal memuat data user");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---- Search ---- */
  useEffect(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return setFilteredUsers(users);
    setFilteredUsers(
      users.filter(
        (u) =>
          (u.username || "").toLowerCase().includes(q) ||
          (u.nama_lengkap || "").toLowerCase().includes(q)
      )
    );
  }, [searchText, users]);

  /* ---- Actions ---- */
  const openDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(GET_USER_DETAIL(id));
      const data = await res.json();
      if (data?.success && data?.data) {
        setSelectedUser(data.data as UserRow);
        setModalDetailVisible(true);
      } else {
        Alert.alert("Info", data?.message || "Detail user tidak ditemukan");
      }
    } catch {
      Alert.alert("Error", "Gagal memuat detail user");
    } finally {
      setDetailLoading(false);
    }
  };

  const openAction = (user: UserRow) => {
    setSelectedUser(user);
    setModalActionVisible(true);
  };

  const deleteUser = (id: number) => {
    Alert.alert("Konfirmasi", "Hapus user ini?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(DELETE_USER(id));
            const data = await res.json();
            if (data?.success) {
              const updated = users.filter((u) => u.id !== id);
              setUsers(updated);
              setFilteredUsers(updated);
              setModalActionVisible(false);
              if (modalDetailVisible) setModalDetailVisible(false);
              Alert.alert("Sukses", "User terhapus");
            } else {
              Alert.alert("Gagal", data?.message || "Gagal menghapus user");
            }
          } catch {
            Alert.alert("Error", "Terjadi kesalahan saat menghapus user");
          }
        },
      },
    ]);
  };

  // Prefill data lama utk form edit (fetch detail dulu biar lengkap)
  const openEdit = async () => {
    if (!selectedUser) return;
    try {
      const res = await fetch(GET_USER_DETAIL(selectedUser.id));
      const data = await res.json();
      const detail: UserRow = (data?.success && data?.data) ? data.data : selectedUser;

      // kosongkan password agar tidak overwrite kalau user tidak mengubah
      const { password: _pw, ...rest } = detail;
      setEditData({ ...rest, password: "" });

      setModalActionVisible(false);
      setModalEditVisible(true);
    } catch {
      // fallback: pakai selectedUser minimal
      const { password: _pw, ...rest } = selectedUser;
      setEditData({ ...rest, password: "" });
      setModalActionVisible(false);
      setModalEditVisible(true);
    }
  };

  // Simpan edit (kirim urlencoded; password kosong tidak dikirim)
  const saveEdit = async () => {
    if (!editData?.id) {
      Alert.alert("Error", "ID user tidak ditemukan.");
      return;
    }
    const p = new URLSearchParams();
    p.append("id", String(editData.id));
    const push = (k: string, v?: string | null) => {
      if (v !== undefined && v !== null) p.append(k, String(v));
    };
    push("username", (editData as any).username);
    if ((editData as any).password && String((editData as any).password).trim() !== "") {
      push("password", (editData as any).password);
    }
    push("nama_lengkap", (editData as any).nama_lengkap);
    push("tempat_lahir", (editData as any).tempat_lahir);
    push("tanggal_lahir", (editData as any).tanggal_lahir);
    push("no_telepon", (editData as any).no_telepon);
    push("alamat", (editData as any).alamat);
    push("gaji", (editData as any).gaji); // NEW

    try {
      const res = await fetch(UPDATE_USER, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: p.toString(),
      });

      const raw = await res.text();
      let data: any = null;
      try { data = JSON.parse(raw); } catch {}

      if (res.ok && data?.success) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === editData.id ? ({ ...u, ...editData, password: undefined } as UserRow) : u
          )
        );
        setFilteredUsers((prev) =>
          prev.map((u) =>
            u.id === editData.id ? ({ ...u, ...editData, password: undefined } as UserRow) : u
          )
        );
        setModalEditVisible(false);
        Alert.alert("Sukses", "Perubahan disimpan");
      } else {
        Alert.alert("Gagal", String(data?.message || raw || "Tidak dapat menyimpan perubahan"));
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Tidak dapat menyimpan perubahan");
    }
  };

  /* ---- Header (component) ---- */
  const HeaderView: React.FC = () => (
    <View style={V.headerWrap}>
      <View style={V.headerRow}>
        <Text style={T.title}>Daftar User</Text>
      </View>

      <View style={V.searchBox}>
        <Ionicons name="search" size={18} color={COLORS.sub} />
        <TextInput
          style={T.searchInput}
          placeholder="Cari username / nama…"
          placeholderTextColor="#9CA3AF"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText("")}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  /* ---- UI ---- */
  if (loading) {
    return (
      <View style={V.center}>
        <ActivityIndicator size="large" color={COLORS.brand} />
        <Text style={T.centerSub}>Memuat data user...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={V.container}>
      <HeaderView />

      <FlatList
        data={filteredUsers}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={V.sep} />}
        renderItem={({ item }) => {
          const initials = getInitials(item.nama_lengkap || item.username, "U");
          return (
            <TouchableOpacity
              style={V.item}
              activeOpacity={0.9}
              onPress={() => openAction(item)}
            >
              <View style={avatarStyle(item.role)}>
                <Text style={T.avatarText}>{initials}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <View style={V.rowBetween}>
                  <Text style={T.username}>{item.username}</Text>
                  <View style={[V.rolePill, { borderColor: roleColor(item.role) }]}>
                    <Text style={[T.roleText, { color: roleColor(item.role) }]}>
                      {roleLabel(item.role)}
                    </Text>
                  </View>
                </View>
                <Text style={T.subText}>{item.nama_lengkap || "-"}</Text>
                {/* NEW: tampilkan gaji di list */}
                <Text style={T.subText}>Gaji: {formatRupiah((item as any).gaji)}</Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color="#A3AAB5" />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text style={{ color: COLORS.sub }}>Tidak ada data.</Text>
          </View>
        }
      />

     {/* Modal Aksi (Center) */}
      <Modal 
        visible={modalActionVisible} 
        transparent 
        animationType="fade"
        // WAJIB ADA di Android biar tombol Back jalan:
        onRequestClose={() => setModalActionVisible(false)}
      >
        <View style={V.overlay}>
          <View style={V.modalBox}>
            {/* ... isi modal sama kayak sebelumnya ... */}
            <View style={{ padding: 16 }}>
              <Text style={T.sheetTitle}>{selectedUser?.username}</Text>

              {/* ... tombol-tombol ... */}
              <View style={{ rowGap: 8 }}>
                <TouchableOpacity
                  style={V.sheetBtn}
                  onPress={() => selectedUser && openDetail(selectedUser.id)}
                >
                  <MaterialIcons name="visibility" size={18} color={COLORS.brand} />
                  <Text style={T.sheetBtnText}>Lihat Detail</Text>
                </TouchableOpacity>

                <TouchableOpacity style={V.sheetBtn} onPress={openEdit}>
                  <MaterialIcons name="edit" size={18} color={COLORS.brand} />
                  <Text style={T.sheetBtnText}>Edit User</Text>
                </TouchableOpacity>

                {selectedUser && (
                  <TouchableOpacity
                    style={[V.sheetBtn, { backgroundColor: "#FEE2E2" }]}
                    onPress={() => deleteUser(selectedUser.id)}
                  >
                    <MaterialIcons name="delete" size={18} color={COLORS.danger} />
                    <Text style={[T.sheetBtnText, { color: COLORS.danger }]}>
                      Hapus User
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                onPress={() => setModalActionVisible(false)}
                style={V.sheetCancel}
              >
                <Text style={T.sheetCancelText}>Tutup</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Detail (Center) */}
      <Modal 
        visible={modalDetailVisible} 
        transparent 
        animationType="fade"
        // Tambahkan ini:
        onRequestClose={() => setModalDetailVisible(false)}
      >
        <View style={V.overlay}>
          <View style={V.modalBox}>
            <View style={V.modalHeader}>
              <Text style={T.modalTitle}>Detail User</Text>
              <TouchableOpacity onPress={() => setModalDetailVisible(false)} style={V.xBtn}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* ... isi scrollview detail ... */}
            {detailLoading ? (
              <ActivityIndicator size="large" color={COLORS.brand} style={{ margin: 24 }} />
            ) : (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                {[
                  { label: "ID", value: selectedUser?.id, icon: "badge" },
                  { label: "Username", value: selectedUser?.username, icon: "person" },
                  { label: "Password", value: selectedUser?.password, icon: "vpn-key" },
                  { label: "Nama Lengkap", value: selectedUser?.nama_lengkap, icon: "face" },
                  { label: "Tempat Lahir", value: selectedUser?.tempat_lahir, icon: "place" },
                  { label: "Tanggal Lahir", value: selectedUser?.tanggal_lahir, icon: "cake" },
                  { label: "No Telepon", value: selectedUser?.no_telepon, icon: "phone" },
                  { label: "Alamat", value: selectedUser?.alamat, icon: "home" },
                  { label: "Gaji", value: formatRupiah(selectedUser?.gaji), icon: "attach-money" },
                ].map((f) => (
                  <View key={f.label} style={V.detailCard}>
                    <View style={V.detailRow}>
                      <MaterialIcons name={f.icon as any} size={18} color={COLORS.brand} />
                      <Text style={T.detailLabel}>{f.label}</Text>
                    </View>
                    <Text style={T.detailValue}>{(f.value as any) || "-"}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

     {/* Modal Edit (Center) */}
      <Modal 
        visible={modalEditVisible} 
        transparent 
        animationType="fade"
        // Tambahkan ini:
        onRequestClose={() => setModalEditVisible(false)}
      >
        <View style={V.overlay}>
          <View style={V.modalBox}>
            <View style={V.modalHeader}>
              <Text style={T.modalTitle}>Edit User</Text>
              <TouchableOpacity onPress={() => setModalEditVisible(false)} style={V.xBtn}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16 }}>
              {/* ... isi form edit ... */}
              {[
                "username",
                "password",
                "nama_lengkap",
                "tempat_lahir",
                "tanggal_lahir",
                "no_telepon",
                "alamat",
                "gaji",
              ].map((field) => (
                <View key={field} style={V.inputGroup}>
                  <Text style={T.label}>{field.replace("_", " ")}</Text>
                  <TextInput
                    style={T.input}
                    value={String((editData as any)[field] ?? "")}
                    onChangeText={(v) => setEditData((p) => ({ ...p, [field]: v }))}
                    placeholder={
                      field === "password"
                        ? "Kosongkan jika tidak mengganti"
                        : `Masukkan ${field.replace("_", " ")}`
                    }
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    secureTextEntry={field === "password"}
                    keyboardType={field === "gaji" ? "number-pad" : "default"}
                  />
                </View>
              ))}

              <TouchableOpacity style={V.saveBtn} onPress={saveEdit}>
                <MaterialIcons name="save" size={18} color="#fff" />
                <Text style={T.saveText}>Simpan Perubahan</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ===== Styles ===== */
const V = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg } as ViewStyle,

  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: COLORS.bg,
  } as ViewStyle,
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } as ViewStyle,
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.line,
  } as ViewStyle,

  sep: { height: 8 } as ViewStyle,

  item: {
    marginHorizontal: 16,
    backgroundColor: COLORS.card,
    padding: PAD,
    borderRadius: R,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
  } as ViewStyle,
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as ViewStyle,
  rolePill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  } as ViewStyle,

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.bg,
  } as ViewStyle,

  // --- UPDATED FOR CENTER MODAL ---
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)", // Darker background
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  } as ViewStyle,
  
  modalBox: {
    width: "100%",
    maxHeight: "85%", // Supaya kalau konten panjang bisa scroll
    backgroundColor: COLORS.card,
    borderRadius: 16,
    overflow: "hidden", // Biar header rounded ikut kepotong
    // Shadow buat efek floating
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  } as ViewStyle,

  // Style tombol di modal action
  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    backgroundColor: "#F5F8FF",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  } as ViewStyle,
  sheetCancel: { alignSelf: "center", paddingVertical: 12, marginTop: 4 } as ViewStyle,

  modalHeader: {
    height: 56,
    backgroundColor: COLORS.brand,
    alignItems: "center",
    justifyContent: "center",
    // Tidak perlu border radius khusus karena parent (modalBox) sudah overflow hidden
  } as ViewStyle,
  
  xBtn: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
  } as ViewStyle,

  detailCard: {
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
  } as ViewStyle,
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    marginBottom: 6,
  } as ViewStyle,

  inputGroup: { marginBottom: 12 } as ViewStyle,
  saveBtn: {
    marginTop: 6,
    backgroundColor: COLORS.brand,
    borderRadius: 12,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    columnGap: 8,
  } as ViewStyle,
});

const T = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: 0.2,
  } as TextStyle,
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14 } as TextStyle,

  avatarText: { color: COLORS.text, fontWeight: "800" } as TextStyle,
  username: { fontSize: 16, fontWeight: "700", color: COLORS.text } as TextStyle,
  subText: { color: COLORS.sub, marginTop: 2 } as TextStyle,

  roleText: { fontSize: 12, fontWeight: "700" } as TextStyle,

  centerSub: { marginTop: 10, color: COLORS.sub } as TextStyle,

  sheetTitle: { fontSize: 16, fontWeight: "800", color: COLORS.text, marginBottom: 8, textAlign: "center" } as TextStyle,
  sheetBtnText: { color: COLORS.brand, fontWeight: "700" } as TextStyle,
  sheetCancelText: { color: COLORS.sub, fontWeight: "600" } as TextStyle,

  modalTitle: { color: "#fff", fontSize: 16, fontWeight: "800" } as TextStyle,

  detailLabel: { fontSize: 13, fontWeight: "700", color: COLORS.text } as TextStyle,
  detailValue: { color: COLORS.sub, fontSize: 14 } as TextStyle,

  label: { fontSize: 13, fontWeight: "700", color: COLORS.text, marginBottom: 6 } as TextStyle,
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.text,
    fontSize: 14,
  } as TextStyle,
  saveText: { color: "#fff", fontWeight: "800" } as TextStyle,
});