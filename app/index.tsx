import { Redirect } from "expo-router";

export default function Index() {
  // Selalu lempar user ke /login saat app dibuka
  return <Redirect href="/Login/LoginScreen" />;
}
