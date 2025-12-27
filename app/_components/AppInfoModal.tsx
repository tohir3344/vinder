// app/_components/AppInfoModal.tsx
import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Image,
  ScrollView,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

// NOMOR WA DEVELOPER (Ganti dengan nomor asli)
const DEV_CONTACT_WA = "6282121160457"; 

const { width } = Dimensions.get("window");

export default function AppInfoModal({ iconColor = "#fff" }: { iconColor?: string }) {
  const [visible, setVisible] = useState(false);

  // Ambil tahun saat ini secara otomatis
  const currentYear = new Date().getFullYear();

  const handleFeedback = async () => {
    const message = "Halo Tim Developer, saya ingin memberikan masukan/laporan terkait aplikasi:";
    const url = `whatsapp://send?text=${encodeURIComponent(message)}&phone=${DEV_CONTACT_WA}`;
    try {
      await Linking.openURL(url);
    } catch (err) {
      alert("Gagal membuka WhatsApp.");
    }
  };

  const appVersion = Constants.expoConfig?.version || "1.0.0";

  return (
    <>
      {/* Tombol Trigger */}
      <TouchableOpacity onPress={() => setVisible(true)} style={s.triggerBtn} activeOpacity={0.7}>
        <Ionicons name="information-circle-outline" size={26} color={iconColor} />
      </TouchableOpacity>

      {/* Modal */}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View style={s.backdrop}>
          <View style={s.modalCard}>
            
            {/* Header Modal */}
            <View style={s.header}>
              <Text style={s.headerTitle}>Tentang Aplikasi</Text>
              <TouchableOpacity onPress={() => setVisible(false)} style={s.closeIcon}>
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
              
              {/* Logo & Judul */}
              <View style={s.appIdentity}>
                <View style={s.logoWrapper}>
                  <Image 
                    source={require("../../assets/images/logo.png")} 
                    style={s.logo} 
                    resizeMode="contain"
                  />
                </View>
                <Text style={s.appName}>MyGaji</Text>
                <Text style={s.appTagline}>PT Pordjo Steelindo Perkasa</Text>
                <View style={s.versionBadge}>
                  <Text style={s.versionText}>Versi {appVersion} (Stable)</Text>
                </View>
              </View>

              {/* Deskripsi */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Deskripsi Sistem</Text>
                <Text style={s.paragraph}>
                  Platform digital terintegrasi yang dirancang untuk efisiensi operasional manajemen sumber daya manusia. 
                  Mencakup fitur presensi berbasis geolokasi, perhitungan lembur otomatis, serta manajemen perizinan yang transparan dan akurat.
                </Text>
              </View>

              {/* Tim Pengembang */}
              <View style={s.section}>
                <Text style={s.sectionTitle}>Tim Pengembang</Text>
                <View style={s.devContainer}>
                  <View style={s.devItem}>
                    <View style={s.devIcon}>
                      <Ionicons name="code-slash" size={18} color="#0A84FF" />
                    </View>
                    <View>
                      <Text style={s.devName}>Rheza Rifalsya</Text>
                      <Text style={s.devRole}>Lead Developer</Text>
                    </View>
                  </View>
                  
                  <View style={[s.devItem, { marginTop: 10 }]}>
                    <View style={s.devIcon}>
                      <Ionicons name="construct-outline" size={18} color="#0A84FF" />
                    </View>
                    <View>
                      <Text style={s.devName}>Muhamad Tohir</Text>
                      <Text style={s.devRole}>Co-Developer, Analyst & System Architect</Text>
                    </View>
                  </View>
                </View>
              </View>

            </ScrollView>

            {/* Footer Actions */}
            <View style={s.footer}>
              <TouchableOpacity style={s.feedbackBtn} onPress={handleFeedback} activeOpacity={0.8}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color="#fff" />
                <Text style={s.feedbackTx}>Hubungi Developer Jika Ada Masalah</Text>
              </TouchableOpacity>
              
              {/* TAHUN OTOMATIS DISINI */}
              <Text style={s.copyright}>
                © {currentYear} Muhamad tohir X Rheza rifalsya {'\n'}All Rights Reserved.
              </Text>
            </View>

          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  triggerBtn: {
    padding: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)", 
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "85%",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
  },
  closeIcon: {
    padding: 4,
  },
  scrollContent: {
    padding: 24,
  },
  
  // App Identity
  appIdentity: {
    alignItems: "center",
    marginBottom: 24,
  },
  logoWrapper: {
    width: 80,
    height: 80,
    marginBottom: 12,
    shadowColor: "#0A84FF",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    backgroundColor: '#fff',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 60,
    height: 60,
  },
  appName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  appTagline: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 12,
    fontWeight: "500",
  },
  versionBadge: {
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#bae6fd",
  },
  versionText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0284c7",
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  paragraph: {
    fontSize: 13,
    lineHeight: 20,
    color: "#475569",
    textAlign: "justify",
  },

  // Dev Team Styles
  devContainer: {
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  devItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  devIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e0f2fe",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  devName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1e293b",
  },
  devRole: {
    fontSize: 11,
    color: "#64748b",
    marginTop: 1,
  },

  // Footer
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    backgroundColor: "#fcfcfc",
  },
  feedbackBtn: {
    backgroundColor: "#0A84FF", 
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    shadowColor: "#0A84FF",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  feedbackTx: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 8,
  },
  copyright: {
    textAlign: "center",
    fontSize: 11,
    color: "#94a3b8",
    lineHeight: 16,
  },
});