import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router"; // <-- Tambah useFocusEffect
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { API_BASE } from "../../config";
import BottomNavbar from "../../_components/BottomNavbar";

const GET_USER = (id: number | string) =>
  `${API_BASE}auth/get_user.php?id=${encodeURIComponent(String(id))}`;
const ADD_USER = `${API_BASE}auth/add_user.php`;

type AuthShape = {
  id?: number | string;
  user_id?: number | string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
};

type UserDetail = {
  id?: number | string;
  username?: string;
  nama_lengkap?: string;
  tempat_lahir?: string;
  tanggal_lahir?: string;
  email?: string;
  no_telepon?: string;
  alamat?: string;
  role?: string;
  masa_kerja?: string;
  foto?: string | null;
  created_at?: string;
};

function toYmd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Hitung selisih tahun/bulan/hari dari dua tanggal */
function diffYMD(from: Date, to: Date) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let d = to.getDate() - from.getDate();

  if (d < 0) {
    m -= 1;
    const prevMonth = new Date(to.getFullYear(), to.getMonth(), 0);
    d += prevMonth.getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  if (y < 0) {
    y = 0;
    m = 0;
    d = 0;
  }
  return { tahun: y, bulan: m, hari: d };
}

export default function Profile() {
  const [auth, setAuth] = useState<AuthShape | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    nama_lengkap: "",
    tempat_lahir: "",
    tanggal_lahir: "",
    email: "",
    no_telepon: "",
    alamat: "",
    masa_kerja: "",
    tanggal_masuk: "",
    role: "staff" as "staff" | "admin",
  });

  // 🔹 Input masa kerja
  const [masaTahun, setMasaTahun] = useState("");
  const [masaBulan, setMasaBulan] = useState("");
  const [masaHari, setMasaHari] = useState("");

  // DatePicker tanggal lahir
  const [showDate, setShowDate] = useState(false);
  const [dateObj, setDateObj] = useState<Date>(new Date());

  // DatePicker tanggal masuk
  const [showJoinDate, setShowJoinDate] = useState(false);
  const [joinDateObj, setJoinDateObj] = useState<Date>(new Date());

  // === BARU: Logic buat narik data Pending Count ===
  const fetchPendingCount = useCallback(async () => {
    try {
      // 1. Amankan URL: Buang slash di akhir API_BASE kalo ada, terus tambah slash manual
      // Biar gak kejadian "api/event" jadi "apievent"
      const safeBase = String(API_BASE).replace(/\/+$/, "");
      const url = `${safeBase}/event/points.php?action=requests&status=pending`;

      const res = await fetch(url);
      const txt = await res.text();
      
      let j: any;
      try {
        j = JSON.parse(txt);
      } catch (err) {
        // Kalau error parse JSON, biasanya server balikin HTML error atau kosong
        // Kita silent aja biar gak nyepam log
        return; 
      }

      if (j?.success && Array.isArray(j?.data)) {
        setPendingCount(j.data.length);
      } else {
        setPendingCount(0);
      }
    } catch (e) {
      // Error jaringan dll, set 0 aja
      setPendingCount(0);
    }
  }, []);

  // Pake useFocusEffect biar tiap kali masuk halaman Profile, badge-nya update
  useFocusEffect(
    useCallback(() => {
      fetchPendingCount();
    }, [fetchPendingCount])
  );
  // ===============================================

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem("auth");
        const parsed: AuthShape | null = raw ? JSON.parse(raw) : null;
        setAuth(parsed);

        const id = parsed?.id ?? parsed?.user_id;
        if (!id) {
          setLoading(false);
          return;
        }

        const res = await fetch(GET_USER(id));
        const txt = await res.text();
        let json: any;
        try {
          json = JSON.parse(txt);
        } catch {
          json = null;
        }
        if ((json?.success ?? json?.status) && json?.data) {
          setDetail(json.data as UserDetail);
        }
      } catch (e) {
        console.warn("Err Profile fetch:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  function validEmail(s: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  }

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.nama_lengkap) {
      Alert.alert(
        "Peringatan",
        "Isi semua kolom wajib (username, password, nama lengkap)."
      );
      return;
    }
    if (newUser.email && !validEmail(newUser.email)) {
      Alert.alert("Email tidak valid", "Silakan isi email yang benar.");
      return;
    }
    if (newUser.no_telepon && /\D/.test(newUser.no_telepon)) {
      Alert.alert("No telepon tidak valid", "Hanya angka 0-9.");
      return;
    }

    const t = masaTahun.trim();
    const b = masaBulan.trim();
    const h = masaHari.trim();

    if (!newUser.tanggal_masuk && !t && !b && !h) {
      Alert.alert(
        "Peringatan",
        "Isi tanggal masuk kerja atau masa kerja (tahun/bulan/hari)."
      );
      return;
    }

    let tahunNum = 0;
    let bulanNum = 0;
    let hariNum = 0;

    if (newUser.tanggal_masuk) {
      const joinDate = new Date(newUser.tanggal_masuk);
      if (Number.isNaN(joinDate.getTime())) {
        Alert.alert("Peringatan", "Tanggal masuk tidak valid.");
        return;
      }
      const { tahun, bulan, hari } = diffYMD(joinDate, new Date());
      tahunNum = tahun;
      bulanNum = bulan;
      hariNum = hari;
    } else {
      tahunNum = Number(t || "0");
      bulanNum = Number(b || "0");
      hariNum = Number(h || "0");

      if (
        Number.isNaN(tahunNum) ||
        Number.isNaN(bulanNum) ||
        Number.isNaN(hariNum)
      ) {
        Alert.alert("Peringatan", "Masa kerja hanya boleh berisi angka.");
        return;
      }
    }

    const masa_kerja_str = `${tahunNum} tahun ${bulanNum} bulan ${hariNum} hari`;

    const tanggalMasukFinal =
      newUser.tanggal_masuk && newUser.tanggal_masuk.trim() !== ""
        ? newUser.tanggal_masuk.trim()
        : toYmd(new Date());

    setSaving(true);
    try {
      const formData = new FormData();

      const payload = {
        ...newUser,
        masa_kerja: masa_kerja_str,
        tanggal_masuk: tanggalMasukFinal,
      };

      Object.entries(payload).forEach(([k, v]) =>
        formData.append(k, String(v ?? ""))
      );

      if (image) {
        const filename = image.split("/").pop() || `foto_${Date.now()}.jpg`;
        const ext = (/\.(\w+)$/.exec(filename)?.[1] || "jpg").toLowerCase();
        const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
        // @ts-ignore
        formData.append("foto", { uri: image, name: filename, type: mime });
      }

      const res = await fetch(ADD_USER, { method: "POST", body: formData });
      const raw = await res.text();
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned non-JSON:\n${raw.slice(0, 400)}`);
      }

      if (json?.success) {
        Alert.alert("Berhasil", "Akun baru berhasil ditambahkan!");
        setModalVisible(false);
        setNewUser({
          username: "",
          password: "",
          nama_lengkap: "",
          tempat_lahir: "",
          tanggal_lahir: "",
          email: "",
          no_telepon: "",
          alamat: "",
          masa_kerja: "",
          tanggal_masuk: "",
          role: "staff",
        });
        setMasaTahun("");
        setMasaBulan("");
        setMasaHari("");
        setImage(null);
      } else {
        Alert.alert("Gagal", json?.message || "Terjadi kesalahan.");
      }
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Konfirmasi", "Apakah Anda yakin ingin keluar?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluar",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("auth");
          router.replace("/Login/LoginScreen");
        },
      },
    ]);
  };

  const name = detail?.nama_lengkap ?? auth?.name ?? "User";
  const username = detail?.username ?? auth?.username ?? "-";
  const email = detail?.email ?? auth?.email ?? "-";
  const role = detail?.role ?? auth?.role ?? "staff";
  const masaKerjaAdmin = detail?.masa_kerja ?? "0 tahun 0 bulan 0 hari";

  const rawFoto = detail?.foto ?? null;
  const fotoUrl = rawFoto
    ? rawFoto.startsWith("http")
      ? rawFoto
      : `${API_BASE}${rawFoto.replace(/^\/+/, "")}`
    : null;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={{ marginTop: 8 }}>Memuat profil…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f6fa" }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {fotoUrl ? (
              <Image source={{ uri: fotoUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>
                  {String(name || "US").substring(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.position}>{role}</Text>

          {/* 🔹 Tampilkan masa kerja admin di header (seperti user) */}
          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>Masa Kerja</Text>
              <Text style={styles.statLabel}>{masaKerjaAdmin}</Text>
            </View>
          </View>
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="person-circle-outline" size={20} color="#2196F3" />
            <Text style={styles.infoTitle}>Informasi Personal</Text>
          </View>
          {[
            ["Username", username],
            ["Nama Lengkap", name],
            ["Email", email],
            ["Tempat Lahir", detail?.tempat_lahir ?? "-"],
            ["Tanggal Lahir", detail?.tanggal_lahir ?? "-"],
            ["Nomor Telepon", detail?.no_telepon ?? "-"],
            ["Alamat", detail?.alamat ?? "-"],
            ["Masa Kerja", masaKerjaAdmin],
          ].map(([label, value], i) => (
            <View key={i} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Aksi */}
        <View style={styles.quickActionCard}>
          <View style={styles.quickHeader}>
            <Ionicons name="settings-outline" size={20} color="#2196F3" />
            <Text style={styles.quickTitle}>Aksi Cepat</Text>
          </View>
          <TouchableOpacity
            style={styles.quickItem}
            onPress={() => setModalVisible(true)}
          >
            <Ionicons name="person-add-outline" size={22} color="#2196F3" />
            <Text style={styles.quickText}>Tambah Akun</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickItem} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={22} color="#2196F3" />
            <Text style={[styles.quickText, { color: "#000" }]}>Keluar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Modal tambah akun */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <ScrollView
              contentContainerStyle={{ paddingBottom: 16 }}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.modalTitle}>Tambah Akun Baru</Text>

              {/* Username */}
              <TextInput
                style={styles.input}
                placeholder="Username (wajib)"
                autoCapitalize="none"
                value={newUser.username}
                onChangeText={(t) => setNewUser({ ...newUser, username: t })}
              />
              {/* Password */}
              <TextInput
                style={styles.input}
                placeholder="Password (wajib)"
                secureTextEntry
                autoCapitalize="none"
                value={newUser.password}
                onChangeText={(t) => setNewUser({ ...newUser, password: t })}
              />
              {/* Nama */}
              <TextInput
                style={styles.input}
                placeholder="Nama Lengkap (wajib)"
                value={newUser.nama_lengkap}
                onChangeText={(t) =>
                  setNewUser({ ...newUser, nama_lengkap: t })
                }
              />
              {/* Tempat lahir */}
              <TextInput
                style={styles.input}
                placeholder="Tempat Lahir"
                value={newUser.tempat_lahir}
                onChangeText={(t) =>
                  setNewUser({ ...newUser, tempat_lahir: t })
                }
              />

              {/* Tanggal lahir */}
              <TouchableOpacity
                onPress={() => setShowDate(true)}
                activeOpacity={0.6}
                style={[styles.input, { justifyContent: "center" }]}
              >
                <Text
                  style={{
                    color: newUser.tanggal_lahir ? "#111" : "#999",
                  }}
                >
                  {newUser.tanggal_lahir || "Tanggal Lahir (YYYY-MM-DD)"}
                </Text>
              </TouchableOpacity>
              {showDate && (
                <DateTimePicker
                  value={dateObj}
                  mode="date"
                  display={Platform.select({
                    ios: "spinner",
                    android: "calendar",
                  })}
                  onChange={(_, d) => {
                    if (d) {
                      setDateObj(d);
                      setNewUser({ ...newUser, tanggal_lahir: toYmd(d) });
                    }
                    setShowDate(false);
                  }}
                  maximumDate={new Date()}
                />
              )}

              {/* Email */}
              <TextInput
                style={styles.input}
                placeholder="Email"
                autoCapitalize="none"
                keyboardType="email-address"
                inputMode="email"
                value={newUser.email}
                onChangeText={(t) => setNewUser({ ...newUser, email: t })}
              />
              {/* No Telepon */}
              <TextInput
                style={styles.input}
                placeholder="No Telepon"
                keyboardType="number-pad"
                inputMode="numeric"
                value={newUser.no_telepon}
                onChangeText={(t) =>
                  setNewUser({
                    ...newUser,
                    no_telepon: t.replace(/\D/g, ""),
                  })
                }
              />
              {/* Alamat */}
              <TextInput
                style={[styles.input, { height: 80 }]}
                placeholder="Alamat"
                multiline
                value={newUser.alamat}
                onChangeText={(t) => setNewUser({ ...newUser, alamat: t })}
              />

              {/* 🔹 Tanggal Masuk Kerja */}
              <Text style={styles.masaLabel}>Tanggal Masuk Kerja</Text>
              <TouchableOpacity
                onPress={() => setShowJoinDate(true)}
                activeOpacity={0.6}
                style={[styles.input, { justifyContent: "center" }]}
              >
                <Text
                  style={{
                    color: newUser.tanggal_masuk ? "#111" : "#999",
                  }}
                >
                  {newUser.tanggal_masuk || "Tanggal Masuk (YYYY-MM-DD)"}
                </Text>
              </TouchableOpacity>
              {showJoinDate && (
                <DateTimePicker
                  value={joinDateObj}
                  mode="date"
                  display={Platform.select({
                    ios: "spinner",
                    android: "calendar",
                  })}
                  onChange={(_, d) => {
                    if (d) {
                      setJoinDateObj(d);
                      const ymd = toYmd(d);
                      setNewUser((prev) => ({
                        ...prev,
                        tanggal_masuk: ymd,
                      }));
                      const { tahun, bulan, hari } = diffYMD(d, new Date());
                      setMasaTahun(String(tahun));
                      setMasaBulan(String(bulan));
                      setMasaHari(String(hari));
                    }
                    setShowJoinDate(false);
                  }}
                  maximumDate={new Date()}
                />
              )}

              {/* 🔹 Masa Kerja */}
              <Text style={styles.masaLabel}>Masa Kerja</Text>
              <View style={styles.masaRow}>
                <View style={styles.masaGroup}>
                  <TextInput
                    style={styles.masaInput}
                    placeholder="0"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    value={masaTahun}
                    onChangeText={(t) => setMasaTahun(t.replace(/\D/g, ""))}
                  />
                  <Text style={styles.masaSuffix}>tahun</Text>
                </View>
                <View style={styles.masaGroup}>
                  <TextInput
                    style={styles.masaInput}
                    placeholder="0"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    value={masaBulan}
                    onChangeText={(t) => setMasaBulan(t.replace(/\D/g, ""))}
                  />
                  <Text style={styles.masaSuffix}>bulan</Text>
                </View>
                <View style={styles.masaGroup}>
                  <TextInput
                    style={styles.masaInput}
                    placeholder="0"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    value={masaHari}
                    onChangeText={(t) => setMasaHari(t.replace(/\D/g, ""))}
                  />
                  <Text style={styles.masaSuffix}>hari</Text>
                </View>
              </View>

              {/* Role */}
              <View
                style={[
                  styles.input,
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  },
                ]}
              >
                <Text style={{ color: "#555" }}>Role</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setNewUser({ ...newUser, role: "staff" })}
                  >
                    <Text
                      style={{
                        color: newUser.role === "staff" ? "#0D47A1" : "#888",
                        fontWeight: "700",
                      }}
                    >
                      Staff
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setNewUser({ ...newUser, role: "admin" })}
                  >
                    <Text
                      style={{
                        color: newUser.role === "admin" ? "#0D47A1" : "#888",
                        fontWeight: "700",
                      }}
                    >
                      Admin
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {image && (
                <Image
                  source={{ uri: image }}
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: 10,
                    marginBottom: 10,
                  }}
                />
              )}
              <TouchableOpacity style={styles.uploadBtn} onPress={pickImage}>
                <Ionicons name="image-outline" size={20} color="#2196F3" />
                <Text style={{ color: "#2196F3", marginLeft: 8 }}>
                  Pilih Foto
                </Text>
              </TouchableOpacity>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginTop: 10,
                }}
              >
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#ccc" }]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Batal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: "#2196F3" }]}
                  onPress={handleAddUser}
                  disabled={saving}
                >
                  <Text style={styles.buttonText}>
                    {saving ? "Menyimpan..." : "Simpan"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
     <BottomNavbar 
        preset="admin" 
        active="right"
        config={{
          center: {
            badge: pendingCount // Sekarang ini bakal ada isinya karena udah di-fetch!
          }
        }}
    />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    backgroundColor: "#2196F3",
    paddingVertical: 30,
    alignItems: "center",
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    paddingTop: 60,
  },
  avatarContainer: { marginBottom: 12 },
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#fff",
  },
  avatarText: { fontSize: 32, fontWeight: "bold", color: "#2196F3" },
  name: { fontSize: 22, fontWeight: "bold", color: "#fff" },
  position: { color: "#e0e0e0", fontSize: 14 },

  // 🔹 Box masa kerja di header
  statsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    width: "80%",
    backgroundColor: "#fff",
    borderRadius: 15,
    paddingVertical: 10,
    marginTop: 15,
  },
  statBox: { alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "bold", color: "#2196F3" },
  statLabel: { fontSize: 12, color: "#616161" },

  infoCard: {
    backgroundColor: "#fff",
    margin: 20,
    borderRadius: 15,
    padding: 20,
    elevation: 2,
  },
  infoHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  infoTitle: {
    marginLeft: 8,
    fontWeight: "bold",
    color: "#2196F3",
    fontSize: 16,
  },
  infoRow: {
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: { fontSize: 13, color: "#757575" },
  infoValue: { fontSize: 15, fontWeight: "500", color: "#212121" },

  quickActionCard: {
    backgroundColor: "#fff",
    margin: 20,
    borderRadius: 15,
    padding: 15,
    elevation: 2,
  },
  quickItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  quickText: {
    marginLeft: 10,
    fontSize: 15,
    color: "#212121",
    fontWeight: "500",
  },

  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalContainer: {
    width: "90%",
    maxHeight: "85%",      // ⬅️ ini penting biar scroll jalan
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 20,
    elevation: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2196F3",
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    fontSize: 14,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2196F3",
    padding: 8,
    borderRadius: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginHorizontal: 5,
  },
  buttonText: { color: "#fff", fontWeight: "bold" },

  quickHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 8,
  },
  quickTitle: {
    marginLeft: 8,
    fontWeight: "bold",
    color: "#2196F3",
    fontSize: 16,
    bottom: 1,
  },

  // 🔹 Masa kerja
  masaLabel: {
    marginBottom: 4,
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
  },
  masaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  masaGroup: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginHorizontal: 2,
  },
  masaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    textAlign: "center",
  },
  masaSuffix: {
    marginLeft: 4,
    fontSize: 13,
    color: "#555",
  },
});