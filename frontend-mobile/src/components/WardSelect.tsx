import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HO_CHI_MINH_WARD_GROUPS } from "@/constants/hoChiMinhWards";
import { colors, radius } from "@/theme/tokens";

type WardSelectProps = {
  label: string;
  value: string;
  onChange: (ward: string) => void;
  error?: string;
  placeholder?: string;
};

/** Dropdown of Ho Chi Minh City wards grouped by former district (same list as web). */
export function WardSelect({
  label,
  value,
  onChange,
  error,
  placeholder = "Select district",
}: WardSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((current) => !current)}
        style={[styles.button, error ? styles.buttonError : null]}
      >
        <Text style={value ? styles.value : styles.placeholder}>{value || placeholder}</Text>
        <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? (
        <ScrollView style={styles.menu} nestedScrollEnabled>
          {HO_CHI_MINH_WARD_GROUPS.map((group) => (
            <View key={group.oldDistrict}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupHeaderText}>{group.oldDistrict}</Text>
              </View>
              {group.wards.map((ward) => (
                <Pressable
                  key={`${group.oldDistrict}-${ward}`}
                  onPress={() => {
                    onChange(ward);
                    setOpen(false);
                  }}
                  style={styles.option}
                >
                  <Text style={[styles.optionText, ward === value ? styles.optionSelected : null]}>{ward}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: "700", color: colors.dark[700] },
  button: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  buttonError: { borderColor: colors.danger[500] },
  value: { color: colors.dark[900], fontSize: 16 },
  placeholder: { color: colors.dark[400], fontSize: 16 },
  chevron: { color: colors.dark[500], fontSize: 12 },
  menu: {
    maxHeight: 260,
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
  },
  groupHeader: { paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.dark[100] },
  groupHeaderText: { color: colors.dark[700], fontSize: 13, fontWeight: "800" },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark[100],
  },
  optionText: { color: colors.dark[800], fontSize: 15 },
  optionSelected: { color: colors.primary[700], fontWeight: "700" },
  error: { color: colors.danger[600], fontSize: 12, lineHeight: 17 },
});
