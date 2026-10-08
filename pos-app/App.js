import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Constants from "expo-constants";
import MerchantBusinessApp from "./src/MerchantBusinessApp";
import ReviewMerchantApp from "./src/ReviewMerchantApp";

export default function App() {
  const reviewEnabled =
    Constants.expoConfig.extra.posEnvironment === "acceptance" &&
    Constants.expoConfig.extra.posReview === true;
  return (
    <SafeAreaProvider>
      {reviewEnabled ? <ReviewMerchantApp /> : <MerchantBusinessApp />}
    </SafeAreaProvider>
  );
}
