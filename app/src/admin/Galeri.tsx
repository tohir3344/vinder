import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { API_BASE } from "../../config";

// Type Definition
type LaporanItem = {
  id: string;
  user_id?: number;
  nama: string;
  tanggal: string;
  foto_url: string;
  jam_masuk?: string | null;
  jam_keluar?: string | null;
};

type SelectedItem = LaporanItem & { tipe: "Masuk" | "Keluar" };

// Helper: Format Date Object ke YYYY-MM-DD
function fmtDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Helper: Paksa ambil 10 digit pertama (YYYY-MM-DD) dari string
function cleanDate(dateStr: any) {
  if (!dateStr) return "";
  return String(dateStr).substring(0, 10);
}

// Helper: Perbaiki URL Gambar (Masalah Foto Putih)
const fixImageUrl = (url: string) => {
  if (!url || typeof url !== 'string') return "https://via.placeholder.com/150";

  // Kalau URL sudah lengkap (dimulai dengan http/https), langsung return
  if (url.startsWith("http")) return url;

  // Bersihkan API_BASE: hapus 'api/' di ujung jika ada
  let baseUrl = API_BASE.replace(/\/api\/?$/, "");

  // Pastikan baseUrl diakhiri dengan satu '/'
  if (!baseUrl.endsWith("/")) baseUrl += "/";

  // Pastikan url tidak diawali dengan '/' biar nggak double slash
  const cleanPath = url.startsWith("/") ? url.substring(1) : url;

  const finalUrl = `${baseUrl}${cleanPath}`;

  return finalUrl;
};

async function getJson(url: string) {
  const res = await fetch(url);
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    if (j?.error) throw new Error(j.error);
    return j;
  } catch {
    console.log("Raw Response Galeri:", txt);
    throw new Error(`Gagal parsing JSON dari server.`);
  }
}

export default function Galeri() {
  const [laporanMasuk, setLaporanMasuk] = useState<LaporanItem[]>([]);
  const [laporanKeluar, setLaporanKeluar] = useState<LaporanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedImage, setSelectedImage] = useState<SelectedItem | null>(null);

  // State untuk DatePicker
  const [dateObj, setDateObj] = useState(new Date()); // Object Date asli
  const [showDatePicker, setShowDatePicker] = useState(false);

  // String tanggal untuk filter (YYYY-MM-DD)
  const selectedDateStr = useMemo(() => fmtDate(dateObj), [dateObj]);

  const GALERI_URL = `${API_BASE}galeri/galeri_admin.php`;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await getJson(GALERI_URL);

      // Bersihin format tanggal & handle fallback key buat foto_url
      const cleanMasuk = (data.laporan_masuk || []).map((item: any) => ({
        ...item,
        // 🔥 FIX: Cek foto_url, kalau kosong cek foto_masuk atau foto (siapa tau beda key di API)
        foto_url: item.foto_url || item.foto_masuk || item.foto || "",
        tanggal: cleanDate(item.tanggal),
      }));

      const cleanKeluar = (data.laporan_keluar || []).map((item: any) => ({
        ...item,
        // 🔥 FIX: Cek foto_url, kalau kosong cek foto_keluar atau foto
        foto_url: item.foto_url || item.foto_keluar || item.foto || "",
        tanggal: cleanDate(item.tanggal),
      }));

      setLaporanMasuk(cleanMasuk);
      setLaporanKeluar(cleanKeluar);
    } catch (err: any) {
      setError("Gagal memuat galeri: " + (err?.message ?? String(err)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handler Ganti Tanggal
  const onChangeDate = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (event.type === "dismissed") return;
    if (selected) {
      setDateObj(selected);
    }
  };

  // Logic Filter ke View berdasarkan selectedDateStr
  const masukToday = useMemo(
    () => laporanMasuk.filter((x) => x.tanggal === selectedDateStr),
    [laporanMasuk, selectedDateStr]
  );

  const keluarToday = useMemo(
    () => laporanKeluar.filter((x) => x.tanggal === selectedDateStr),
    [laporanKeluar, selectedDateStr]
  );

  const openDetail = (item: LaporanItem, tipe: "Masuk" | "Keluar") => {
    setSelectedImage({ ...item, tipe });
  };

  /* --- RENDER --- */
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#A51C24" />
        <Text style={{ marginTop: 10, color: "#666" }}>Memuat galeri...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={{ color: "red", textAlign: "center", marginBottom: 8 }}>{error}</Text>
        <TouchableOpacity onPress={loadData} style={styles.retryButton}>
          <Text style={{ color: "white" }}>Coba Lagi</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>Galeri Absensi</Text>

        {/* Tombol Buka Kalender */}
        <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>
            📅 {selectedDateStr === fmtDate(new Date()) ? "Hari ini" : selectedDateStr}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Komponen Kalender (DateTimePicker) */}
      {showDatePicker && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          onChange={onChangeDate}
          maximumDate={new Date()}
        />
      )}

      <ScrollView style={styles.container}>
        {/* SECTION MASUK */}
        <Text style={styles.sectionTitle}>📸 Laporan Foto Masuk</Text>
        <View style={styles.grid}>
          {masukToday.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada foto Masuk tanggal ini.</Text>
          ) : (
            masukToday.map((item) => (
              <TouchableOpacity key={`m-${item.id}`} onPress={() => openDetail(item, "Masuk")}>
                <Image
                  source={{ uri: fixImageUrl(item.foto_url) }}
                  style={styles.image}
                  resizeMode="cover"
                />
                <Text style={styles.caption} numberOfLines={1}>
                  {item.nama || "—"}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* SECTION KELUAR */}
        <Text style={styles.sectionTitle}>📷 Laporan Foto Keluar</Text>
        <View style={styles.grid}>
          {keluarToday.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada foto Keluar tanggal ini.</Text>
          ) : (
            keluarToday.map((item) => (
              <TouchableOpacity key={`k-${item.id}`} onPress={() => openDetail(item, "Keluar")}>
                <Image
                  source={{ uri: fixImageUrl(item.foto_url) }}
                  style={styles.image}
                  resizeMode="cover"
                />
                <Text style={styles.caption} numberOfLines={1}>
                  {item.nama || "—"}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Spacer bawah */}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal Detail Gambar Besar */}
      <Modal visible={!!selectedImage} transparent onRequestClose={() => setSelectedImage(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.detailCard}>
            {selectedImage && (
              <>
                <Image
                  source={{ uri: fixImageUrl(selectedImage.foto_url) }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
                <View style={{ padding: 12, alignSelf: "stretch" }}>
                  <Text style={styles.detailTitle}>{selectedImage.nama || "—"}</Text>
                  <Text style={styles.detailMeta}>
                    {selectedImage.tipe} • {selectedImage.tanggal}
                  </Text>
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.detailLine}>
                      Jam: {selectedImage.tipe === "Masuk" ? selectedImage.jam_masuk || "-" : selectedImage.jam_keluar || "-"}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedImage(null)}>
                  <Text style={styles.closeBtnText}>Tutup</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#F5F6FA" },
  container: { flex: 1, paddingHorizontal: 16 },

  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F5F6FA",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    marginBottom: 8,
  },
  // 🔥 Updated to Red
  title: { fontSize: 20, fontWeight: "800", color: "#A51C24" },

  dateBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#A51C24", // 🔥 Red Border
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  dateBtnText: { color: "#A51C24", fontWeight: "700", fontSize: 14 }, // 🔥 Red Text

  sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 16, marginBottom: 12, color: "#A51C24" }, // 🔥 Red
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: 12 },

  image: {
    width: 110,
    height: 110,
    borderRadius: 12,
    backgroundColor: "#E0E0E0",
    borderWidth: 1,
    borderColor: "#FAD2D2", // 🔥 Light Red Border
  },

  caption: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    maxWidth: 110,
    textAlign: "center",
    color: "#A51C24", // 🔥 Red Text
  },
  emptyText: { color: "#777", fontStyle: "italic", marginTop: 4, marginLeft: 4, fontSize: 14 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  retryButton: {
    marginTop: 12,
    backgroundColor: "#A51C24", // 🔥 Red Button
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    elevation: 2,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    width: "100%",
    maxWidth: 340,
  },
  fullImage: { width: "100%", height: 360, backgroundColor: "#000" },
  detailTitle: { fontSize: 18, fontWeight: "700", color: "#A51C24" }, // 🔥 Red
  detailMeta: { fontSize: 13, color: "#555", marginTop: 4, fontWeight: "500" },
  detailLine: { fontSize: 13, color: "#333", marginTop: 2 },

  closeBtn: {
    alignSelf: "center",
    marginVertical: 12,
    backgroundColor: "#D32F2F", // 🔥 Darker Red
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    elevation: 2,
  },
  closeBtnText: { color: "white", fontWeight: "700" },
});