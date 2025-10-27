import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, SafeAreaView, Alert, ScrollView, TextInput,
} from "react-native";
import { MaterialIcons, FontAwesome5, Ionicons } from "@expo/vector-icons";
import { API_BASE } from "../../config";

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
};

const GET_ALL_USERS = `${API_BASE}auth/get_all_users_detail.php`;
const GET_USER_DETAIL = (id: number) => `${API_BASE}auth/get_user_detail.php?id=${encodeURIComponent(String(id))}`;
const DELETE_USER = (id: number) => `${API_BASE}auth/delete_user.php?id=${encodeURIComponent(String(id))}`;
const UPDATE_USER = `${API_BASE}auth/update_user.php`;

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

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch(GET_ALL_USERS);
        const data = await res.json();
        if (!isMounted) return;

        if (data?.success && Array.isArray(data?.data)) {
          setUsers(data.data);
          setFilteredUsers(data.data);
        } else {
          Alert.alert("Info", data?.message || "Tidak ada data user ditemukan");
        }
      } catch {
        Alert.alert("Error", "Gagal memuat data user");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return setFilteredUsers(users);
    setFilteredUsers(users.filter(u => (u.username || "").toLowerCase().includes(q)));
  }, [searchText, users]);

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
    Alert.alert("Konfirmasi", "Yakin ingin menghapus user ini?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Hapus",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await fetch(DELETE_USER(id));
            const data = await res.json();
            if (data?.success) {
              const updated = users.filter(u => u.id !== id);
              setUsers(updated);
              setFilteredUsers(updated);
              setModalActionVisible(false);
              Alert.alert("Sukses", "User berhasil dihapus");
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

  const openEdit = () => {
    if (!selectedUser) return;
    setEditData({ ...selectedUser });
    setModalActionVisible(false);
    setModalEditVisible(true);
  };

  const saveEdit = async () => {
    try {
      const formData = new FormData();
      Object.entries(editData).forEach(([k, v]) => v != null && formData.append(k, String(v)));

      const res = await fetch(UPDATE_USER, { method: "POST", body: formData });
      const data = await res.json();

      if (data?.success) {
        setUsers(prev => prev.map(u => (u.id === editData.id ? { ...u, ...editData } as UserRow : u)));
        setFilteredUsers(prev => prev.map(u => (u.id === editData.id ? { ...u, ...editData } as UserRow : u)));
        setModalEditVisible(false);
        Alert.alert("Sukses", "Data user berhasil diperbarui");
      } else {
        Alert.alert("Gagal", data?.message || "Gagal menyimpan perubahan");
      }
    } catch (e) {
      Alert.alert("Error", "Tidak dapat menyimpan perubahan");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 10 }}>Memuat data user...</Text>
      </View>
    );
  }

  const roleColor = (role?: string) => (String(role).toLowerCase() === "admin" ? "#FF3B30" : "#007AFF");

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          <FontAwesome5 name="users" size={22} color="#fff" /> Daftar User
        </Text>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Cari username..."
            placeholderTextColor="#999"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <FlatList
        data={filteredUsers}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ paddingVertical: 10 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.item} onPress={() => openAction(item)}>
            <Text style={[styles.username, { color: roleColor(item.role) }]}>
              {item.username} {item.role ? `(${item.role})` : ""}
            </Text>
            <Text style={styles.namaLengkap}>
              <MaterialIcons name="person" size={16} /> {item.nama_lengkap || "-"}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Modal Aksi */}
      <Modal visible={modalActionVisible} animationType="fade" transparent>
        <View style={styles.overlay}>
          <View style={styles.actionBox}>
            <Text style={styles.actionTitle}>Aksi untuk {selectedUser?.username}</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={() => selectedUser && openDetail(selectedUser.id)}>
              <MaterialIcons name="visibility" size={18} color="#007AFF" />
              <Text style={styles.actionText}> Lihat Detail</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={openEdit}>
              <MaterialIcons name="edit" size={18} color="#007AFF" />
              <Text style={styles.actionText}> Edit User</Text>
            </TouchableOpacity>
            {selectedUser && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#ff3b30" }]} onPress={() => deleteUser(selectedUser.id)}>
                <MaterialIcons name="delete" size={18} color="#fff" />
                <Text style={[styles.actionText, { color: "#fff" }]}> Hapus User</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setModalActionVisible(false)} style={styles.cancelBtn}>
              <Text style={{ color: "#007AFF", fontWeight: "bold" }}>Batal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Detail */}
      <Modal visible={modalDetailVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setModalDetailVisible(false)} style={styles.closeBtn}>
            <Text style={styles.closeText}>✖ Tutup</Text>
          </TouchableOpacity>

          {detailLoading ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
          ) : (
            <ScrollView style={{ marginTop: 10 }}>
              <Text style={styles.detailTitle}>Detail User</Text>
              {[
                { label: "ID", value: selectedUser?.id, icon: "badge" },
                { label: "Username", value: selectedUser?.username, icon: "person" },
                { label: "Password", value: selectedUser?.password, icon: "vpn-key" },
                { label: "Nama Lengkap", value: selectedUser?.nama_lengkap, icon: "face" },
                { label: "Tempat Lahir", value: selectedUser?.tempat_lahir, icon: "place" },
                { label: "Tanggal Lahir", value: selectedUser?.tanggal_lahir, icon: "cake" },
                { label: "No Telepon", value: selectedUser?.no_telepon, icon: "phone" },
                { label: "Alamat", value: selectedUser?.alamat, icon: "home" },
              ].map((f) => (
                <View key={f.label} style={styles.detailCard}>
                  <View style={styles.detailRow}>
                    <MaterialIcons name={f.icon as any} size={20} color="#007AFF" />
                    <Text style={styles.detailLabel}>{f.label}</Text>
                  </View>
                  <Text style={styles.detailValue}>{(f.value as any) || "-"}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* Modal Edit */}
      <Modal visible={modalEditVisible} animationType="slide">
        <SafeAreaView style={styles.modalContainer}>
          <TouchableOpacity onPress={() => setModalEditVisible(false)} style={styles.closeBtn}>
            <Text style={styles.closeText}>✖ Tutup</Text>
          </TouchableOpacity>
          <Text style={styles.detailTitle}>Edit Data User</Text>
          <ScrollView>
            {["username", "password", "nama_lengkap", "tempat_lahir", "tanggal_lahir", "no_telepon", "alamat"].map((field) => (
              <View key={field} style={styles.inputGroup}>
                <Text style={styles.label}>{field.replace("_", " ")}</Text>
                <TextInput
                  style={styles.input}
                  value={(editData as any)[field] ?? ""}
                  onChangeText={(v) => setEditData((p) => ({ ...p, [field]: v }))}
                  placeholder={`Masukkan ${field.replace("_", " ")}`}
                  placeholderTextColor="#999"
                  autoCapitalize="none"
                />
              </View>
            ))}
            <TouchableOpacity style={styles.saveBtn} onPress={saveEdit}>
              <MaterialIcons name="save" size={18} color="#fff" />
              <Text style={[styles.saveText, { marginLeft: 6 }]}>Simpan Perubahan</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1976D2" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: "700", color: "#fff" },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, elevation: 3, flex: 0.5 },
  searchInput: { marginLeft: 6, height: 36, flex: 1, color: "#333" },
  item: { width: "95%", backgroundColor: "#fff", padding: 16, marginVertical: 6, borderRadius: 14, alignSelf: "center", elevation: 3 },
  username: { fontSize: 17, fontWeight: "700", marginBottom: 4 },
  namaLengkap: { fontSize: 15, color: "#555" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  modalContainer: { flex: 1, backgroundColor: "#fff", padding: 16 },
  closeBtn: { alignSelf: "flex-end", padding: 6, backgroundColor: "#007AFF", borderRadius: 6 },
  closeText: { color: "#fff", fontWeight: "bold" },
  detailTitle: { fontSize: 20, fontWeight: "700", marginVertical: 10, color: "#007AFF" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  actionBox: { backgroundColor: "#fff", padding: 20, borderRadius: 12, width: "80%", elevation: 5 },
  actionTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 15, color: "#007AFF" },
  actionBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "#E8F0FF", padding: 12, borderRadius: 10, marginVertical: 6, width: "100%" },
  actionText: { fontSize: 15, color: "#007AFF", fontWeight: "600" },
  cancelBtn: { marginTop: 10, alignSelf: "center" },
  inputGroup: { marginBottom: 12 },
  label: { fontSize: 14, color: "#007AFF", fontWeight: "600", marginBottom: 4 },
  input: { backgroundColor: "#F0F4FF", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#C5D8FF" },
  saveBtn: { flexDirection: "row", backgroundColor: "#007AFF", borderRadius: 8, padding: 14, alignItems: "center", justifyContent: "center", marginTop: 10, marginBottom: 16 },
  saveText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  detailCard: { backgroundColor: "#F0F4FF", padding: 12, borderRadius: 10, marginBottom: 10, elevation: 2 },
  detailRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  detailLabel: { fontSize: 15, fontWeight: "600", marginLeft: 6, color: "#007AFF" },
  detailValue: { fontSize: 16, color: "#333" },
});
