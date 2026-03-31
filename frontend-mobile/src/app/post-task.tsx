import React, { useMemo, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
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
import { formatCategoryLabel, isRequester } from "@/utils/taskUtils";

type FieldErrors = Partial<Record<"title" | "description" | "location" | "budget", string>>;

function validateForm({
  title,
  description,
  location,
  budget,
}: {
  title: string;
  description: string;
  location: string;
  budget: string;
}): FieldErrors {
  const next: FieldErrors = {};
  if (!title.trim()) next.title = "Task title is required.";
  if (!description.trim()) next.description = "Description is required.";
  if (!location.trim()) next.location = "Location is required.";

  const budgetValue = Number(budget);
  if (!budget.trim()) {
    next.budget = "Budget is required.";
  } else if (Number.isNaN(budgetValue) || budgetValue <= 0) {
    next.budget = "Budget must be greater than 0.";
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
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedImages, setSelectedImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");

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

  const handlePostTask = async (): Promise<void> => {
    if (!user || !isRequester(user)) {
      setFormError("Only requester accounts can post tasks in the current shared workflow.");
      return;
    }

    const validation = validateForm({ title, description, location, budget });
    setErrors(validation);
    setFormError("");
    if (Object.keys(validation).length > 0) return;

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
        budget: Number(budget),
        location: location.trim(),
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

          <Input
            label="Location*"
            placeholder="Example: District 1, Ho Chi Minh City"
            value={location}
            onChangeText={setLocation}
            error={errors.location}
          />

          <Input
            label="Budget (VND)*"
            placeholder="Example: 1200000"
            value={budget}
            onChangeText={setBudget}
            keyboardType="numeric"
            error={errors.budget}
          />

          <Input
            label="Due Date (optional)"
            placeholder="Example: 2026-03-30T17:00:00.000Z"
            value={dueDate}
            onChangeText={setDueDate}
            helperText="Paste an ISO date if you want the deadline to show on task cards."
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
