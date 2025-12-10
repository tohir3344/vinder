import React, { useEffect, useRef } from "react";
import { View, Image, StyleSheet, Animated, Easing } from "react-native";

export default function LoadingScreen({ onFinish }: any) {
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // lama loading sebelum masuk ke app
    setTimeout(() => onFinish(), 2000);
  }, []);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.container}>
      {/* lingkaran muter */}
      <Animated.View
        style={[
          styles.circle,
          {
            transform: [{ rotate: spin }],
          },
        ]}
      />

      {/* logo perusahaan kamu */}
      <Image source={require("../assets/images/logo.png")} style={styles.logo} />
    </View>
  );
}

const SIZE = 160;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },

  logo: {
    width: 90,
    height: 90,
    position: "absolute",
    resizeMode: "contain",
  },

  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 6,
    borderColor: "#2196F3",
    borderTopColor: "transparent",
    borderLeftColor: "transparent",
    position: "absolute",
  },
});
