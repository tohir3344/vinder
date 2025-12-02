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
  Alert,
} from "react-native";
import { API_BASE } from "../../config"; 

// Type Definition
type LaporanItem = {
  id: string;
  user_id?: number;
  nama: string; // Field ini sekarang isinya USERNAME dari PHP
  tanggal: string;
  foto_url: string;
  jam_masuk?: string | null;
  jam_keluar?: string | null;
};

type SelectedItem = LaporanItem & { tipe: "Masuk" | "Keluar" };

// Helper: Ambil tanggal hari ini YYYY-MM-DD
function todayLocalStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Helper: Paksa ambil 10 digit pertama (YYYY-MM-DD)
function cleanDate(dateStr: any) {
    if (!dateStr) return "";
    return String(dateStr).substring(0, 10);
}

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
  const [selectedDate, setSelectedDate] = useState<string>(todayLocalStr());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const GALERI_URL = `${API_BASE}galeri/galeri_admin.php`;

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getJson(GALERI_URL);
      
      // Bersihin tanggal
      const cleanMasuk = (data.laporan_masuk || []).map((item: LaporanItem) => ({
          ...item,
          tanggal: cleanDate(item.tanggal)
      }));

      const cleanKeluar = (data.laporan_keluar || []).map((item: LaporanItem) => ({
          ...item,
          tanggal: cleanDate(item.tanggal)
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

  // Auto refresh tengah malam
  useEffect(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50);
    const ms = next.getTime() - now.getTime();
    const t = setTimeout(() => setSelectedDate(todayLocalStr()), ms);
    return () => clearTimeout(t);
  }, [selectedDate]);

  // Logic Tanggal Picker
  const allDatesDesc = useMemo(() => {
    const set = new Set<string>();
    for (const it of laporanMasuk) set.add(it.tanggal);
    for (const it of laporanKeluar) set.add(it.tanggal);
    // Sort descending (terbaru diatas)
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [laporanMasuk, laporanKeluar]);

  // Logic Filter ke View
  const masukToday = useMemo(
    () => laporanMasuk.filter((x) => x.tanggal === selectedDate),
    [laporanMasuk, selectedDate]
  );
  
  const keluarToday = useMemo(
    () => laporanKeluar.filter((x) => x.tanggal === selectedDate),
    [laporanKeluar, selectedDate]
  );

  const openDetail = (item: LaporanItem, tipe: "Masuk" | "Keluar") => {
    setSelectedImage({ ...item, tipe });
  };

  /* --- RENDER --- */
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1976D2" />
        <Text style={{marginTop: 10, color: '#666'}}>Memuat galeri...</Text>
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
        <TouchableOpacity onPress={() => setDatePickerOpen(true)} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>
            {selectedDate === todayLocalStr() ? "Hari ini" : selectedDate}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container}>
        {/* SECTION MASUK */}
        <Text style={styles.sectionTitle}>📸 Laporan Foto Masuk</Text>
        <View style={styles.grid}>
          {masukToday.length === 0 ? (
            <Text style={styles.emptyText}>Belum ada foto Masuk untuk tanggal ini.</Text>
          ) : (
            masukToday.map((item) => (
              <TouchableOpacity key={`m-${item.id}`} onPress={() => openDetail(item, "Masuk")}>
                <Image source={{ uri: item.foto_url }} style={styles.image} />
                {/* 🔥 ITEM.NAMA DISINI SUDAH USERNAME DARI PHP 🔥 */}
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
            <Text style={styles.emptyText}>Belum ada foto Keluar untuk tanggal ini.</Text>
          ) : (
            keluarToday.map((item) => (
              <TouchableOpacity key={`k-${item.id}`} onPress={() => openDetail(item, "Keluar")}>
                <Image source={{ uri: item.foto_url }} style={styles.image} />
                {/* 🔥 ITEM.NAMA DISINI SUDAH USERNAME DARI PHP 🔥 */}
                <Text style={styles.caption} numberOfLines={1}>
                  {item.nama || "—"}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
        
        {/* Spacer bawah */}
        <View style={{height: 40}} />
      </ScrollView>

      {/* Modal Detail Gambar */}
      <Modal visible={!!selectedImage} transparent onRequestClose={() => setSelectedImage(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.detailCard}>
            {selectedImage && (
              <>
                <Image source={{ uri: selectedImage.foto_url }} style={styles.fullImage} />
                <View style={{ padding: 12, alignSelf: "stretch" }}>
                  {/* 🔥 DETAIL JUGA USERNAME 🔥 */}
                  <Text style={styles.detailTitle}>{selectedImage.nama || "—"}</Text>
                  <Text style={styles.detailMeta}>
                    {selectedImage.tipe} • {selectedImage.tanggal}
                  </Text>
                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.detailLine}>
                      Jam: {selectedImage.tipe === 'Masuk' ? (selectedImage.jam_masuk || "-") : (selectedImage.jam_keluar || "-")}
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

      {/* Picker Tanggal */}
      <Modal visible={datePickerOpen} transparent onRequestClose={() => setDatePickerOpen(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.datePickerCard}>
            <Text style={styles.datePickerTitle}>Pilih Tanggal</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {allDatesDesc.length === 0 ? (
                  <Text style={{textAlign: 'center', padding: 20, color: '#999'}}>Belum ada data tanggal.</Text>
              ) : (
                allDatesDesc.map((d) => (
                    <TouchableOpacity
                    key={d}
                    onPress={() => {
                        setSelectedDate(d);
                        setDatePickerOpen(false);
                    }}
                    style={[
                        styles.dateItem,
                        d === selectedDate && { backgroundColor: "#E3F2FD", borderColor: "#1976D2" },
                    ]}
                    >
                    <Text style={styles.dateItemText}>
                        {d === todayLocalStr() ? "Hari ini" : d}
                    </Text>
                    </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setDatePickerOpen(false)}>
              <Text style={styles.closeBtnText}>Tutup</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#F5F6FA" },
  container: { flex: 1, paddingHorizontal: 16 },

  // Header
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
  title: { fontSize: 20, fontWeight: "800", color: "#0D47A1" },
  dateBtn: {
    backgroundColor: "#1976D2",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    elevation: 2,
  },
  dateBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  // Section
  sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 16, marginBottom: 12, color: "#0D47A1" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: 12 },
  image: {
    width: 110,
    height: 110,
    borderRadius: 12,
    backgroundColor: "#E3F2FD",
    borderWidth: 1,
    borderColor: "#BBDEFB",
  },
  caption: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    maxWidth: 110,
    textAlign: "center",
    color: "#0D47A1",
  },
  emptyText: { color: "#777", fontStyle: "italic", marginTop: 4, marginLeft: 4, fontSize: 14 },

  // Loading / Error
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  retryButton: {
    marginTop: 12,
    backgroundColor: "#1976D2",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    elevation: 2,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
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
  fullImage: { width: "100%", height: 360, resizeMode: "cover", backgroundColor: "#eee" },
  detailTitle: { fontSize: 18, fontWeight: "700", color: "#0D47A1" },
  detailMeta: { fontSize: 13, color: "#555", marginTop: 4, fontWeight: "500" },
  detailLine: { fontSize: 13, color: "#333", marginTop: 2 },

  closeBtn: {
    alignSelf: "center",
    marginVertical: 12,
    backgroundColor: "#1976D2",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    elevation: 2,
  },
  closeBtnText: { color: "white", fontWeight: "700" },

  // Picker Tanggal
  datePickerCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    width: "90%",
    maxWidth: 380,
    maxHeight: "80%"
  },
  datePickerTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12, color: "#0D47A1", textAlign:'center' },
  dateItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 8,
  },
  dateItemText: { fontSize: 15, fontWeight: "600", color: "#444" },
});