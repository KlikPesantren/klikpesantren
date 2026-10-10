import React from "react";
import { StyleSheet, Text as NativeText } from "react-native";

export const fontFamilies = Object.freeze({
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
});

export const typography = Object.freeze({
  caption: { fontSize: 11, lineHeight: 16 },
  small: { fontSize: 12, lineHeight: 18 },
  body: { fontSize: 14, lineHeight: 20 },
  bodyEmphasis: { fontSize: 15, lineHeight: 21 },
  sectionTitle: { fontSize: 16, lineHeight: 22 },
  pageTitle: { fontSize: 19, lineHeight: 25 },
  kpi: { fontSize: 22, lineHeight: 28 },
  numeric: { fontVariant: ["tabular-nums"] },
});

function familyForWeight(weight) {
  const numeric = Number.parseInt(String(weight || 400), 10);
  if (numeric >= 700) return fontFamilies.bold;
  if (numeric >= 600) return fontFamilies.semibold;
  if (numeric >= 500) return fontFamilies.medium;
  return fontFamilies.regular;
}

export function AppText({ style, ...props }) {
  const flattened = StyleSheet.flatten(style) || {};
  const fontFamily = flattened.fontFamily || familyForWeight(flattened.fontWeight);
  return (
    <NativeText
      {...props}
      style={[style, { fontFamily, fontWeight: "normal" }]}
    />
  );
}
