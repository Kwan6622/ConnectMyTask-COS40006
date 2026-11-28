import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { TASK_CATEGORIES } from "@/constants/tasks";
import { useAuthStore } from "@/store/authStore";
import { useTaskStore } from "@/store/taskStore";
import { useResponsiveLayout } from "@/theme/responsive";
import { colors, radius } from "@/theme/tokens";
import { TaskCategory } from "@/types";
import { uploadImageToCloudinary } from "@/utils/cloudinaryUpload";
import { formatCategoryLabel, formatCurrency, isRequester } from "@/utils/taskUtils";
import { api } from "@/services/api";
import { CityWardPicker, type CityWardValue } from "@/components/CityWardPicker";
import { useWards } from "@/utils/wards";
import { TaskLocationPickerMap } from "@/components/TaskLocationPickerMap";

type FieldErrors = Partial<Record<"title" | "description" | "location" | "streetName" | "budget" | "maxBids" | "dueDate", string>>;

type AiBudgetSuggestion = {
  suggestedBudget: number;
  suggestedMin?: number;
  suggestedMax?: number;
  explanation?: string;
  currency?: string;
  factorsUsed?: string[];
};

type GeocodingResult = {
  lat: string;
  lon: string;
};

function formatVndInput(raw: string): string {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

function parseVndInput(value: string): number {
  return Number(String(value || "").replace(/[^\d]/g, ""));
}

function validateForm({
  title,
  description,
  location,
  streetName,
  budget,
  maxBids,
  dueDate,
}: {
  title: string;
  description: string;
  location: string;
  streetName: string;
  budget: string;
  maxBids: string;
  dueDate: string;
}): FieldErrors {
  const next: FieldErrors = {};
  if (!title.trim()) next.title = "Task title is required.";
  if (!description.trim()) next.description = "Description is required.";
  if (!location.trim()) next.location = "Choose the city, then pick the ward from the list.";
  if (streetName.trim().length < 3) next.streetName = "Enter at least 3 characters for the address.";
  const budgetValue = parseVndInput(budget);
  if (!budget.trim()) {
    next.budget = "Budget is required.";
  } else if (Number.isNaN(budgetValue) || budgetValue <= 0) {
    next.budget = "Budget must be greater than 0.";
  }

  if (maxBids.trim()) {
    const maxBidsValue = Number(maxBids);
    if (!Number.isInteger(maxBidsValue) || maxBidsValue < 1 || maxBidsValue > 100) {
      next.maxBids = "Maximum bids must be an integer between 1 and 100.";
    }
  }

  if (dueDate.trim()) {
    const parsedDueDate = new Date(dueDate.trim());
    if (Number.isNaN(parsedDueDate.getTime())) {
      next.dueDate = "Due date must be a valid ISO date.";
    } else if (parsedDueDate.getTime() < Date.now()) {
      next.dueDate = "Due date cannot be in the past.";
    }
  }

  return next;
}

export default function PostTaskScreen(): React.ReactElement {
  const router = useRouter();
  const { isCompact, isTablet, contentMaxWidth } = useResponsiveLayout();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { createTask, fetchRequesterTasks, isLoading } = useTaskStore((state) => ({
    createTask: state.createTask,
    fetchRequesterTasks: state.fetchRequesterTasks,
    isLoading: state.isLoading,
  }));

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TaskCategory>(TaskCategory.DELIVERY);
  // Start from the account's ward; the requester can pick another for this task.
  const [place, setPlace] = useState<CityWardValue>({ cityId: user?.cityId ?? null, wardId: user?.locationId ?? null });
  const { wards: placeWards } = useWards(place.cityId);
  const placeWard = placeWards.find((ward) => ward.id === place.wardId) || null;
  const location = placeWard?.name || "";
  const [streetName, setStreetName] = useState("");
  // ADDRESS_NOT_FOUND from the geocoder: offer the nearby-address option.
  const [addressErrorCode, setAddressErrorCode] = useState("");
  // "Nearby address" mode: the street address only verifies the area (within 100 m)
  // and the exact place goes in Address details, shown only to the hired provider.
  const [isApproximateLocation, setIsApproximateLocation] = useState(false);
  const [approxTouched, setApproxTouched] = useState(false);
  const [hadNotFound, setHadNotFound] = useState(false);
  const [addressDetail, setAddressDetail] = useState("");
  const [addressDetailError, setAddressDetailError] = useState("");
  const [verifiedCoordinates, setVerifiedCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [addressVerification, setAddressVerification] = useState<"idle" | "verifying" | "verified" | "error">("idle");
  const [addressVerificationMessage, setAddressVerificationMessage] = useState("");
  const [budget, setBudget] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxBids, setMaxBids] = useState("30");
  const [aiSuggestion, setAiSuggestion] = useState<AiBudgetSuggestion | null>(null);
  const [isGettingAiBudgetSuggestion, setIsGettingAiBudgetSuggestion] = useState(false);
  const [selectedImages, setSelectedImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");

  // A new ward starts a fresh address search.
  useEffect(() => {
    setHadNotFound(false);
    if (!approxTouched) setIsApproximateLocation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.wardId]);

  // The house was not on the map and a nearby address now verifies: switch to nearby mode (can be undone).
  useEffect(() => {
    if (addressVerification === "verified" && hadNotFound && !approxTouched) setIsApproximateLocation(true);
  }, [addressVerification, hadNotFound, approxTouched]);

  const categoryButtons = useMemo(
    () => TASK_CATEGORIES.map((value) => ({ value, label: formatCategoryLabel(value) })),
    []
  );

  const pickTaskImage = async (): Promise<void> => {
    if (selectedImages.length >= 3) {
      Alert.alert("Image limit", "You can attach up to 3 task images.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;
    setSelectedImages((current) => [...current, result.assets[0]].slice(0, 3));
  };

  // The saved session can predate the account ward / home address; refresh it once.
  useEffect(() => {
    if (!user?.id) return;
    api.users.getMe()
      .then((response) => {
        const fresh = response.data || {};
        setPlace((current) => (current.wardId ? current : { cityId: fresh.cityId ?? null, wardId: fresh.locationId ?? null }));
      })
      .catch(() => undefined);
  }, [user?.id]);

  useEffect(() => {
    const street = streetName.trim();
    if (!place.wardId || street.length < 3) {
      setAddressVerification("idle");
      setAddressVerificationMessage("");
      setVerifiedCoordinates(null);
      return;
    }

    let cancelled = false;
    setAddressVerification("verifying");
    setAddressVerificationMessage("Verifying address...");
    setAddressErrorCode("");
    setVerifiedCoordinates(null);
    const timer = setTimeout(async () => {
      try {
        const response = await api.tasks.verifyAddress({ wardId: place.wardId as number, streetName: street });
        if (cancelled) return;
        setVerifiedCoordinates({
          latitude: Number(response.data.latitude),
          longitude: Number(response.data.longitude),
        });
        setAddressVerification("verified");
        setAddressVerificationMessage("Address verified successfully. GPS coordinates detected.");
      } catch (error: any) {
        if (cancelled) return;
        setAddressVerification("error");
        setAddressVerificationMessage(error?.response?.data?.message || "Unable to verify this address in Vietnam.");
        setAddressErrorCode(error?.response?.data?.code || "");
        if (error?.response?.data?.code === "ADDRESS_NOT_FOUND") setHadNotFound(true);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [place.wardId, streetName]);

  const handleGetAiBudgetSuggestion = async (): Promise<void> => {
    if (!category || !location.trim()) {
      Alert.alert("Missing fields", "Please select category, city and ward first.");
      return;
    }
    setIsGettingAiBudgetSuggestion(true);
    try {
      const titleValue = title.trim();
      const descriptionValue = description.trim();
      const response = await api.ai.predictPrice({
        title: titleValue || undefined,
        category,
        location: location.trim(),
        budget: parseVndInput(budget) || undefined,
        description: [titleValue, descriptionValue].filter(Boolean).join(". "),
        complexity: "MEDIUM",
        urgency: "NORMAL",
      });

      const payload = response.data || {};
      const suggestedBudget = Number(payload.suggestedBudget || payload.aiSuggestedPrice || 0);
      if (!Number.isFinite(suggestedBudget) || suggestedBudget <= 0) {
        throw new Error("AI did not return a valid budget suggestion.");
      }

      const nextSuggestion: AiBudgetSuggestion = {
        suggestedBudget,
        suggestedMin: payload.suggestedMin != null ? Number(payload.suggestedMin) : undefined,
        suggestedMax: payload.suggestedMax != null ? Number(payload.suggestedMax) : undefined,
        explanation: payload.explanation || payload.rationale || "",
        currency: payload.currency || "VND",
        factorsUsed: Array.isArray(payload.factorsUsed) ? payload.factorsUsed : [],
      };
      setAiSuggestion(nextSuggestion);
      setBudget(formatVndInput(String(nextSuggestion.suggestedBudget)));
      Alert.alert("AI Budget Suggestion", "AI budget guidance generated successfully.");
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || "Failed to get AI budget suggestion.";
      Alert.alert("AI budget failed", message);
    } finally {
      setIsGettingAiBudgetSuggestion(false);
    }
  };

  const handlePostTask = async (): Promise<void> => {
    if (!user || !isRequester(user)) {
      setFormError("Only requester accounts can post tasks in the current shared workflow.");
      return;
    }

    const validation = validateForm({
      title, description, location, streetName, budget, maxBids, dueDate,
    });
    setErrors(validation);
    setFormError("");
    if (Object.keys(validation).length > 0) return;
    if (isApproximateLocation && !addressDetail.trim()) {
      setAddressDetailError("Write your exact address here so the provider you hire can find you.");
      setFormError("Write your exact address in Address details.");
      return;
    }
    if (addressVerification !== "verified" || !verifiedCoordinates) {
      setFormError(addressVerificationMessage || "Please verify the task address before posting.");
      return;
    }

    const createdById = Number(user.id);
    if (!Number.isFinite(createdById) || createdById <= 0) {
      setFormError("Please sign in again before posting a task.");
      return;
    }

    try {
      const imageUrls =
        selectedImages.length > 0
          ? await Promise.all(
              selectedImages.map((asset) =>
                uploadImageToCloudinary({
                  uri: asset.uri,
                  fileName: asset.fileName || `task-image-${Date.now()}.jpg`,
                  mimeType: asset.mimeType,
                })
              )
            )
          : undefined;

      await createTask({
        title: title.trim(),
        description: description.trim(),
        category,
        budget: parseVndInput(budget),
        aiSuggestedPrice: aiSuggestion?.suggestedBudget,
        maxBids: Number(maxBids || 30),
        wardId: place.wardId as number,
        isApproximateLocation,
        addressDetail: addressDetail.trim() || undefined,
        streetName: streetName.trim(),
        siteAddress: `${streetName.trim()}, ${location}`,
        siteLatitude: verifiedCoordinates.latitude,
        siteLongitude: verifiedCoordinates.longitude,
        createdById,
        imageUrls,
        dueDate: dueDate.trim() || undefined,
      });

      await fetchRequesterTasks();
      Alert.alert("Success", "Task posted successfully.");
      router.replace("/my-posted-tasks");
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || "Failed to post task.";
      setFormError(message);
    }
  };

  if (!isAuthenticated || !isRequester(user)) {
    return (
      <MarketplaceShell activeRoute="post">
        <Card>
          <View style={styles.promptBox}>
            <Text style={styles.promptTitle}>Requester access required</Text>
            <Text style={styles.promptBody}>
              Post Task follows the same requester workflow as web. Sign in with a client/requester account to continue.
            </Text>
            <Button title="Sign In" onPress={() => router.push("/sign-in")} />
          </View>
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell activeRoute="post">
      <View style={[styles.contentWrap, { maxWidth: contentMaxWidth }]}>
        <View style={styles.heroCard}>
          <Badge label="Create New Listing" variant="primary" />
          <Text style={[styles.heroTitle, isCompact ? styles.heroTitleCompact : null]}>Post Task</Text>
          <Text style={styles.heroBody}>
            Publish directly to the same backend and database used by the web frontend so tasks stay consistent across both platforms.
          </Text>
        </View>

        <Card>
          <View style={styles.form}>
          <Input
            label="Task Title*"
            placeholder="Example: Website setup"
            value={title}
            onChangeText={setTitle}
            error={errors.title}
          />

          <Input
            label="Task Description*"
            placeholder="Describe requirements and expected output."
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
            error={errors.description}
          />

          <View style={styles.tipBox}>
            <Text style={styles.tipTitle}>Pro tip</Text>
            <Text style={styles.tipBody}>
              Clear descriptions, realistic budgets, and a couple of images usually attract faster and more relevant bids.
            </Text>
          </View>

          <View style={styles.group}>
            <View style={styles.imageHeader}>
              <View>
                <Text style={styles.fieldLabel}>Task Images (max 3)</Text>
                <Text style={styles.helperText}>{selectedImages.length}/3 selected</Text>
              </View>
              <Button title="Choose Image" size="sm" onPress={() => void pickTaskImage()} />
            </View>
            <View style={styles.imageList}>
              {selectedImages.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={styles.imageCard}>
                  <Image source={{ uri: asset.uri }} style={styles.previewImage} resizeMode="cover" />
                  <Text style={styles.imageName} numberOfLines={1}>
                    {asset.fileName || `task-image-${index + 1}.jpg`}
                  </Text>
                  <Pressable onPress={() => setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              {selectedImages.length === 0 ? (
                <View style={styles.emptyImageBox}>
                  <Text style={styles.emptyImageText}>Choose up to 3 pictures/files for this task.</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.group}>
            <Text style={styles.fieldLabel}>Categories</Text>
            <View style={[styles.categoryWrap, isTablet ? styles.categoryWrapTablet : null]}>
              {categoryButtons.map((option) => (
                <Button
                  key={option.value}
                  title={option.label}
                  size="sm"
                  variant={category === option.value ? "primary" : "outline"}
                  onPress={() => setCategory(option.value)}
                  style={[styles.categoryChip, isTablet ? styles.categoryChipTablet : null]}
                />
              ))}
            </View>
          </View>

          <CityWardPicker
            required
            value={place}
            error={errors.location}
            onChange={(next) => {
              setPlace(next);
              setErrors((current) => ({ ...current, location: undefined }));
            }}
          />
          <Input
            label="Address*"
            placeholder="Example: A35 Bach Dang"
            value={streetName}
            onChangeText={setStreetName}
            error={errors.streetName}
          />
          {addressErrorCode === "ADDRESS_NOT_FOUND" ? (
            <View accessibilityLiveRegion="polite" style={styles.nearbyBox}>
              <Text style={styles.nearbyTitle}>We can't find this address on the map.</Text>
              <Text style={styles.nearbyText}>
                Enter a nearby address within 100 m that can be found, such as the main street or the alley entrance, so
                we can verify the location. Then write your exact address in Address details below.
              </Text>
            </View>
          ) : (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.addressVerification,
                addressVerification === "verified" ? styles.addressVerified : null,
                addressVerification === "error" ? styles.addressError : null,
              ]}
            >
              {addressVerificationMessage}
            </Text>
          )}
          {addressVerification === "verified" && verifiedCoordinates ? (
            <TaskLocationPickerMap
              readOnly
              coordinates={verifiedCoordinates}
              onCoordinatesChange={() => undefined}
            />
          ) : null}

          <Input
            label={`${isApproximateLocation ? "Exact address*" : "Address details (optional)"} · ${addressDetail.length}/100`}
            placeholder={isApproximateLocation ? "e.g. 47/24/3 Bui Dinh Tuy, blue gate" : "e.g. Apt 12.05, Block B, Floor 12"}
            value={addressDetail}
            maxLength={100}
            multiline
            numberOfLines={3}
            onChangeText={(text) => { setAddressDetail(text); setAddressDetailError(""); }}
            error={addressDetailError || undefined}
            helperText={isApproximateLocation
              ? "Your real address, if the map cannot find it. Only the provider you hire sees this, after the escrow is funded."
              : "Apartment, floor or block, if any. Only the provider you hire sees this, after the escrow is funded."}
          />
          {hadNotFound || isApproximateLocation ? (
            <View style={styles.nearbySwitchRow}>
              <Switch
                value={isApproximateLocation}
                onValueChange={(value) => { setIsApproximateLocation(value); setApproxTouched(true); setAddressDetailError(""); }}
              />
              <Text style={styles.nearbySwitchText}>
                The address above is a nearby spot (within 100 m), not the exact place. The task shows a "Nearby address" tag.
              </Text>
            </View>
          ) : null}

          <View style={styles.aiSuggestionBox}>
            <View style={styles.aiSuggestionHeader}>
              <View style={styles.aiSuggestionCopy}>
                <Text style={styles.aiSuggestionTitle}>AI Budget Suggestion</Text>
                <Text style={styles.aiSuggestionHint}>Analyze title, category, and description for VND guidance.</Text>
              </View>
              <Button
                title={isGettingAiBudgetSuggestion ? "Generating..." : "Get AI Budget"}
                size="sm"
                onPress={() => void handleGetAiBudgetSuggestion()}
                loading={isGettingAiBudgetSuggestion}
              />
            </View>
            {aiSuggestion ? (
              <View style={styles.aiResultCard}>
                <Text style={styles.aiResultLabel}>Suggested Budget</Text>
                <Text style={styles.aiResultValue}>{formatCurrency(aiSuggestion.suggestedBudget)}</Text>
                {aiSuggestion.suggestedMin != null && aiSuggestion.suggestedMax != null ? (
                  <Text style={styles.aiResultMeta}>
                    Estimated range: {formatCurrency(aiSuggestion.suggestedMin)} - {formatCurrency(aiSuggestion.suggestedMax)}
                  </Text>
                ) : null}
                {aiSuggestion.explanation ? (
                  <Text style={styles.aiResultExplanation}>{aiSuggestion.explanation}</Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <Input
            label="Budget (VND)*"
            placeholder="e.g., 500,000"
            value={budget}
            onChangeText={(value) => setBudget(formatVndInput(value))}
            keyboardType="numeric"
            helperText="Enter your estimated budget in VND (e.g., 500,000)"
            error={errors.budget}
          />

          <Input
            label="Maximum number of bids"
            placeholder="Default: 30"
            value={maxBids}
            onChangeText={setMaxBids}
            keyboardType="numeric"
            helperText="You can limit how many providers can bid on this task (maximum 100)."
            error={errors.maxBids}
          />

          <Input
            label="Due Date (optional)"
            placeholder="e.g. 2026-03-30T17:00"
            value={dueDate}
            onChangeText={setDueDate}
            helperText="Enter a future ISO datetime only (example: 2026-03-30T17:00:00.000Z)."
            error={errors.dueDate}
          />

          {formError ? <Text style={styles.formError}>{formError}</Text> : null}

          <View style={[styles.actionRow, isCompact ? styles.actionRowCompact : null]}>
            <Button title="Cancel" variant="outline" onPress={() => router.back()} style={styles.actionButton} />
            <Button title="Post Task" onPress={() => void handlePostTask()} loading={isLoading} style={styles.actionButton} />
          </View>
          </View>
        </Card>
      </View>
    </MarketplaceShell>
  );
}

const styles = StyleSheet.create({
  nearbyBox: {
    gap: 8,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning[200],
    backgroundColor: colors.warning[50],
  },
  nearbyTitle: { color: colors.dark[900], fontSize: 15, fontWeight: "800" },
  nearbyText: { color: colors.dark[700], fontSize: 13, lineHeight: 19 },
  nearbyWarning: { color: colors.danger[600], fontSize: 13, lineHeight: 19, fontWeight: "700" },
  nearbySwitchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nearbySwitchText: { flex: 1, color: colors.dark[800], fontSize: 13, lineHeight: 19 },
  contentWrap: {
    width: "100%",
    alignSelf: "center",
    gap: 14,
  },
  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: "#123b88",
    padding: 18,
    gap: 8,
  },
  heroTitle: {
    color: colors.white,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  heroTitleCompact: {
    fontSize: 24,
    lineHeight: 30,
  },
  heroBody: {
    color: "#dbeafe",
    fontSize: 14,
    lineHeight: 20,
  },
  form: {
    gap: 14,
  },
  group: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    color: colors.dark[700],
  },
  selectButton: {
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
  selectButtonError: {
    borderColor: colors.danger[500],
  },
  selectValue: {
    color: colors.dark[900],
    fontSize: 16,
  },
  selectPlaceholder: {
    color: colors.dark[400],
    fontSize: 16,
  },
  selectChevron: {
    color: colors.dark[500],
    fontSize: 12,
  },
  selectMenu: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: "hidden",
  },
  selectOption: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark[100],
  },
  selectOptionText: {
    color: colors.dark[800],
    fontSize: 15,
  },
  inputError: {
    color: colors.danger[600],
    fontSize: 12,
    lineHeight: 17,
  },
  addressVerification: {
    minHeight: 20,
    fontSize: 12,
    lineHeight: 18,
    color: colors.primary[700],
  },
  addressVerified: {
    color: colors.success[700],
  },
  addressError: {
    color: colors.danger[600],
  },
  tipBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    padding: 12,
    gap: 3,
  },
  tipTitle: {
    color: colors.primary[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  tipBody: {
    color: colors.primary[700],
    fontSize: 12,
    lineHeight: 17,
  },
  imageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  helperText: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
  },
  imageList: {
    gap: 10,
  },
  imageCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dark[200],
    backgroundColor: colors.dark[50],
    padding: 10,
    gap: 8,
  },
  previewImage: {
    width: "100%",
    height: 160,
    borderRadius: radius.lg,
  },
  imageName: {
    color: colors.dark[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  removeText: {
    color: colors.danger[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  emptyImageBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dark[200],
    borderStyle: "dashed",
    padding: 14,
  },
  emptyImageText: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
  },
  categoryWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryWrapTablet: {
    justifyContent: "space-between",
  },
  categoryChip: {
    marginBottom: 2,
  },
  categoryChipTablet: {
    width: "48.8%",
  },
  aiSuggestionBox: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    padding: 12,
    gap: 10,
  },
  aiSuggestionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  aiSuggestionCopy: {
    flex: 1,
    gap: 3,
  },
  aiSuggestionTitle: {
    color: colors.dark[900],
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
  },
  aiSuggestionHint: {
    color: colors.dark[600],
    fontSize: 12,
    lineHeight: 17,
  },
  aiResultCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.success[200],
    backgroundColor: colors.white,
    padding: 12,
    gap: 4,
  },
  aiResultLabel: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  aiResultValue: {
    color: colors.success[700],
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
  },
  aiResultMeta: {
    color: colors.dark[700],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  aiResultExplanation: {
    color: colors.dark[600],
    fontSize: 13,
    lineHeight: 18,
  },
  formError: {
    color: colors.danger[600],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionRowCompact: {
    flexDirection: "column",
  },
  actionButton: {
    flex: 1,
  },
  promptBox: {
    alignItems: "center",
    gap: 8,
  },
  promptTitle: {
    color: colors.dark[900],
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
  },
  promptBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
