import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "@/theme/tokens";
import { rankWards, useCities, useWards, WARD_TYPE_LABEL, type Ward } from "@/utils/wards";

export interface CityWardValue {
  cityId: number | null;
  wardId: number | null;
}

type CityWardPickerProps = {
  value: CityWardValue;
  onChange: (value: CityWardValue, ward: Ward | null) => void;
  error?: string;
  required?: boolean;
};

/**
 * City first, then the ward: typing suggests the closest wards of that city and
 * only a ward picked from the list counts, so the saved value is an official ward.
 */
export function CityWardPicker({ value, onChange, error, required }: CityWardPickerProps): React.ReactElement {
  const { cities, error: citiesError } = useCities();
  const { wards, loading } = useWards(value.cityId);
  const selectedWard = useMemo(() => wards.find((ward) => ward.id === value.wardId) || null, [wards, value.wardId]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (selectedWard) setQuery(selectedWard.name);
  }, [selectedWard]);

  const suggestions = useMemo(() => rankWards(wards, query, 6), [wards, query]);
  const showList = Boolean(value.cityId) && !selectedWard && (focused || query.trim().length > 0);
  const unpicked = touched && !value.wardId && query.trim().length > 0;
  const message = error || (unpicked ? "Pick your ward from the list; typed text alone cannot be saved." : "");
  const mark = required ? "*" : "";

  const pick = (ward: Ward) => {
    setQuery(ward.name);
    setTouched(true);
    onChange({ cityId: value.cityId, wardId: ward.id }, ward);
  };

  return (
    <View style={styles.group}>
      <Text style={styles.label}>City{mark}</Text>
      <View style={styles.cityRow}>
        {cities.map((city) => {
          const active = city.id === value.cityId;
          return (
            <Pressable
              key={city.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (active) return;
                setQuery("");
                setTouched(false);
                onChange({ cityId: city.id, wardId: null }, null);
              }}
              style={[styles.cityChip, active ? styles.cityChipActive : null]}
            >
              <Text style={[styles.cityChipText, active ? styles.cityChipTextActive : null]}>{city.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {citiesError ? <Text style={styles.error}>Could not load cities. Pull to refresh and try again.</Text> : null}

      <Text style={styles.label}>Ward / commune{mark}</Text>
      <TextInput
        value={query}
        editable={Boolean(value.cityId)}
        autoCorrect={false}
        autoCapitalize="words"
        placeholder={!value.cityId ? "Choose a city first" : loading ? "Loading wards..." : "Type your ward, e.g. Ben Thanh"}
        placeholderTextColor={colors.dark[400]}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setTouched(true); }}
        onChangeText={(text) => {
          setQuery(text);
          if (value.wardId) onChange({ cityId: value.cityId, wardId: null }, null);
        }}
        style={[styles.input, !value.cityId ? styles.inputDisabled : null, message ? styles.inputError : null]}
      />
      {selectedWard ? (
        <Text style={styles.picked}>✓ {selectedWard.name} ({WARD_TYPE_LABEL[selectedWard.type]})</Text>
      ) : null}
      {showList ? (
        <View style={styles.menu}>
          {suggestions.length === 0 ? (
            <Text style={styles.empty}>{loading ? "Loading..." : "No ward matches that name"}</Text>
          ) : suggestions.map((ward) => (
            <Pressable key={ward.id} onPress={() => pick(ward)} style={styles.option}>
              <Text style={styles.optionText}>{ward.name}</Text>
              <Text style={styles.optionType}>{WARD_TYPE_LABEL[ward.type]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: "700", color: colors.dark[700] },
  cityRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cityChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.dark[200],
    backgroundColor: colors.white,
  },
  cityChipActive: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  cityChipText: { color: colors.dark[700], fontSize: 14, fontWeight: "600" },
  cityChipTextActive: { color: colors.primary[700] },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.dark[900],
  },
  inputDisabled: { backgroundColor: colors.dark[50] },
  inputError: { borderColor: colors.danger[500] },
  picked: { color: colors.success[700], fontSize: 13, fontWeight: "600" },
  menu: {
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark[100],
  },
  optionText: { color: colors.dark[800], fontSize: 15, flexShrink: 1 },
  optionType: { color: colors.dark[400], fontSize: 12, marginLeft: 8 },
  empty: { color: colors.dark[500], fontSize: 14, padding: 12 },
  error: { color: colors.danger[600], fontSize: 12, lineHeight: 17 },
});
