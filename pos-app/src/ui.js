import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
export const colors = {
  green: "#157347",
  greenDark: "#0E5A37",
  navy: "#13231A",
  background: "#F5F7F5",
  soft: "#E8F5EC",
  surface: "#FFFFFF",
  line: "#E1E7E3",
  muted: "#66756D",
  red: "#B91C1C",
  amber: "#92400E",
};
export function Icon({ name, size = 20, color = colors.green }) {
  return <Feather name={name} size={size} color={color} />;
}
export function Button({
  title,
  onPress,
  disabled,
  secondary = false,
  icon,
  danger = false,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        secondary && s.secondary,
        danger && s.danger,
        disabled && s.disabled,
      ]}
    >
      {icon && (
        <Icon name={icon} color={secondary ? colors.green : colors.surface} />
      )}
      <Text style={[s.buttonText, secondary && { color: colors.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  secret = false,
  numeric = false,
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secret}
        keyboardType={numeric ? "number-pad" : "default"}
        inputMode={numeric ? "numeric" : "text"}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
export function Card({ title, children }) {
  return (
    <View style={s.card}>
      {title && <Text style={s.heading}>{title}</Text>}
      {children}
    </View>
  );
}
export function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value ?? "—"}</Text>
    </View>
  );
}
export function Money({ value, label }) {
  return (
    <View>
      {label && <Text style={s.label}>{label}</Text>}
      <Text
        style={s.money}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.45}
      >
        {value}
      </Text>
    </View>
  );
}
export function Badge({ label, tone = "green" }) {
  return (
    <View
      style={[
        s.badge,
        tone === "amber" && { backgroundColor: "#FEF3C7" },
        tone === "red" && { backgroundColor: "#FEE2E2" },
      ]}
    >
      <Text
        style={[
          s.badgeText,
          tone === "amber" && { color: colors.amber },
          tone === "red" && { color: colors.red },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}
export function Chip({ label, active, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && { color: colors.surface }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Empty({
  icon = "inbox",
  title,
  note,
  onRetry,
  loading = false,
}) {
  return (
    <View style={s.empty}>
      {loading ? (
        <ActivityIndicator color={colors.green} />
      ) : (
        <Icon name={icon} size={30} />
      )}
      <Text style={s.heading}>{title}</Text>
      {note && <Text style={[s.muted, { textAlign: "center" }]}>{note}</Text>}
      {onRetry && <Button title="Coba lagi" secondary onPress={onRetry} />}
    </View>
  );
}
export function Artwork({ url }) {
  const [failed, setFailed] = useState(false);
  return url && /^https:\/\//.test(url) && !failed ? (
    <Image
      source={{ uri: url }}
      onError={() => setFailed(true)}
      style={s.artwork}
      resizeMode="cover"
    />
  ) : (
    <View style={[s.artwork, s.placeholder]}>
      <Icon name="coffee" size={24} />
    </View>
  );
}
export function ReviewTools({ states, onState, busy, onReset }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={s.dev}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded(!expanded)}
        style={s.devToggle}
      >
        <Icon name="tool" size={13} />
        <Text style={s.muted}>
          Review sintetis · {expanded ? "tutup" : "buka"}
        </Text>
      </Pressable>
      {expanded && (
        <>
          <Text style={s.muted}>UI saja · financial write dinonaktifkan</Text>
          {busy && <ActivityIndicator color={colors.green} />}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {states?.map((name) => (
              <Chip
                key={name}
                label={name}
                onPress={() => !busy && onState(name)}
              />
            ))}
          </ScrollView>
          {onReset && (
            <Button
              title="Reset review"
              secondary
              disabled={busy}
              onPress={onReset}
            />
          )}
        </>
      )}
    </View>
  );
}
export const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  loginRoot: { flex: 1, backgroundColor: colors.navy, width: "100%", maxWidth: 520, alignSelf: "center" },
  loginContent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 22, backgroundColor: colors.background, borderTopLeftRadius: 34, borderTopRightRadius: 34, marginTop: 208 },
  loginBrand: { position: "absolute", top: -184, left: 24, right: 24, gap: 5 },
  logoMark: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.green, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  loginKicker: { color: "#C8E6D3", letterSpacing: 2.2, fontWeight: "800", fontSize: 11 },
  loginTitle: { color: colors.surface, fontSize: 24, lineHeight: 29, fontWeight: "800" },
  loginSubtitle: { color: "#D5DED9", fontSize: 13, lineHeight: 19, maxWidth: 410 },
  loginFoot: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: 12 },
  flex: { flex: 1, minWidth: 0 },
  content: { padding: 16, gap: 14, paddingBottom: 26 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  brand: { fontSize: 18, fontWeight: "800", color: colors.navy },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, color: colors.muted },
  heading: { fontSize: 16, fontWeight: "700", color: colors.navy },
  text: { fontSize: 14, lineHeight: 21, color: colors.navy },
  muted: { fontSize: 12, lineHeight: 18, color: colors.muted },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 10,
    shadowColor: "#0B2417",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  field: { gap: 6, marginBottom: 4 },
  label: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  value: { fontSize: 14, fontWeight: "700", color: colors.navy, flexShrink: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    color: colors.navy,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.green,
    borderRadius: 13,
  },
  secondary: { backgroundColor: colors.soft },
  danger: { backgroundColor: colors.red },
  buttonText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.surface,
    flexShrink: 1,
    textAlign: "center",
  },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  money: { fontSize: 30, fontWeight: "800", color: colors.navy },
  price: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.green,
    flexShrink: 1,
  },
  filters: { padding: 12, gap: 8, backgroundColor: colors.surface },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.background,
    borderRadius: 22,
    marginRight: 7,
  },
  chipActive: { backgroundColor: colors.green },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.navy },
  product: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 9,
  },
  artwork: { width: "100%", height: 68, borderRadius: 10 },
  placeholder: {
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
  },
  productName: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
    color: colors.navy,
    minHeight: 38,
  },
  gridRow: { gap: 10, marginBottom: 10 },
  footer: {
    padding: 12,
    gap: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  cartBar: {
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  cartItem: {
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 6,
    gap: 8,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingBottom: 4,
    shadowColor: "#0B2417",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  tabActive: { borderTopWidth: 2, borderTopColor: colors.green, backgroundColor: "#F5FBF7" },
  tabText: { fontSize: 10, fontWeight: "700", color: colors.muted },
  activeTab: { color: colors.green },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.soft,
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: colors.green },
  feedback: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 7,
    backgroundColor: "#F0FDF4",
  },
  alertError: { padding: 11, borderRadius: 10, backgroundColor: "#FEF2F2" },
  alertSuccess: { padding: 11, borderRadius: 10, backgroundColor: "#ECFDF3" },
  error: { fontSize: 13, color: colors.red, lineHeight: 19 },
  success: { fontSize: 13, color: colors.green, lineHeight: 19 },
  empty: { padding: 22, gap: 10, alignItems: "center" },
  dev: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#FAFAFA",
    gap: 5,
  },
  devToggle: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  hero: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.green,
    gap: 10,
  },
  heroLabel: { color: colors.soft, fontSize: 12 },
  heroMoney: { color: colors.surface, fontSize: 30, fontWeight: "800" },
  stats: { flexDirection: "row", gap: 8 },
  stat: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    gap: 5,
  },
  choice: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  choiceActive: { borderColor: colors.green, backgroundColor: "#F0FDF4" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    padding: 22,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 20,
    gap: 14,
  },
  receiptHero: { alignItems: "center", gap: 9, paddingVertical: 14 },
  qty: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.soft,
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.navy },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 4 },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.greenDark, fontSize: 15, fontWeight: "800" },
  userRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  activationCode: { padding: 14, borderRadius: 10, backgroundColor: colors.navy, color: colors.surface, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), letterSpacing: 1, fontSize: 14 },
  menuSection: { gap: 9 },
  menuGrid: { gap: 8 },
  menuItem: { minHeight: 62, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 12 },
  menuItemActive: { borderColor: colors.green, backgroundColor: "#F2FAF5" },
  menuIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, color: colors.navy, fontSize: 14, fontWeight: "700" },
});
