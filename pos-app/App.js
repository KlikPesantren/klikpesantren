import React from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import Constants from "expo-constants";
import MerchantBusinessApp from "./src/MerchantBusinessApp";
import ReviewMerchantApp from "./src/ReviewMerchantApp";

const plusJakartaFonts = {
  PlusJakartaSans_400Regular: require("@expo-google-fonts/plus-jakarta-sans/400Regular/PlusJakartaSans_400Regular.ttf"),
  PlusJakartaSans_500Medium: require("@expo-google-fonts/plus-jakarta-sans/500Medium/PlusJakartaSans_500Medium.ttf"),
  PlusJakartaSans_600SemiBold: require("@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf"),
  PlusJakartaSans_700Bold: require("@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf"),
};

export default function App() {
  const [fontsLoaded] = useFonts(plusJakartaFonts);
  const reviewEnabled =
    Constants.expoConfig.extra.posEnvironment === "acceptance" &&
    Constants.expoConfig.extra.posReview === true;
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#157347" />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      {reviewEnabled ? <ReviewMerchantApp /> : <MerchantBusinessApp />}
    </SafeAreaProvider>
  );
}
