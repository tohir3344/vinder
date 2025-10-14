// src/screens/Home.tsx
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "react-native";
export default function Home() {
  return (
    <SafeAreaView style={{ flex:1, alignItems:"center", justifyContent:"center" }}>
      <Text>Home — welcome! STAFF</Text>
    </SafeAreaView>
  );
}
