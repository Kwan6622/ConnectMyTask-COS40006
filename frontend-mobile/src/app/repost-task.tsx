import React, { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { TASK_CATEGORIES } from "@/constants/tasks";
import { api } from "@/services/api";
import { useTaskStore } from "@/store/taskStore";
import { colors, radius } from "@/theme/tokens";
import { RepostSuggestion, Task } from "@/types";
import { uploadImageToCloudinary } from "@/utils/cloudinaryUpload";
import { formatCategoryLabel, formatCurrency, formatDateTime } from "@/utils/taskUtils";

/** ISO -> "YYYY-MM-DDTHH:mm" in local time (same format as Post Task). */
function toLocalInput(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Edit an EXPIRED task with tips that make it more attractive to providers,
 * then repost it (OPEN again with a new deadline) or delete it permanently.
 */
export default function RepostTaskScreen(): React.ReactElement {
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const fetchRequesterTasks = useTaskStore((state) => state.fetchRequesterTasks);
  const [task, setTask] = useState<Task | null>(null);
  const [bidCount, setBidCount] = useState(0);
  const [suggestions, setSuggestions] = useState<RepostSuggestion[]>([]);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [maxBids, setMaxBids] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    api.tasks.getRepostSuggestions(taskId)
      .then((response) => {
        const data = response.data;
        const current: Task = data.task;
        setTask(current);
        setBidCount(Number(data.bidCount || 0));
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
        setTitle(current.title || "");
        setDescription(current.description || "");
        setCategory(String(current.category || ""));
        setBudget(current.budget ? String(current.budget) : "");
        setMaxBids(current.maxBids ? String(current.maxBids) : "");
        setImageUrls(Array.isArray(current.imageUrls) ? current.imageUrls : []);
      })
      .catch((error) => setLoadError(error?.response?.data?.message || "This task cannot be reposted."));
  }, [taskId]);

  const applySuggestion = (tip: RepostSuggestion) => {
    if (tip.suggestedValue == null) return;
    if (tip.field === "budget") setBudget(String(tip.suggestedValue));
    if (tip.field === "dueDate") setDueDate(toLocalInput(String(tip.suggestedValue)));
    if (tip.field === "maxBids") setMaxBids(String(tip.suggestedValue));
  };

  const addPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    setIsUploading(true);
    try {
      const url = await uploadImageToCloudinary({ uri: asset.uri, fileName: asset.fileName || `task-${Date.now()}.jpg`, mimeType: asset.mimeType });
      setImageUrls((current) => [...current, url].slice(0, 3));
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "Could not upload the photo.");
    } finally {
      setIsUploading(false);
    }
  };

  const repost = async () => {
    if (!taskId) return;
    const due = new Date(dueDate.trim());
    if (!dueDate.trim() || Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) {
      Alert.alert("New deadline", "Enter a new deadline in the future, e.g. 2026-12-05T17:00.");
      return;
    }
    const budgetValue = Number(budget.replace(/\D/g, ""));
    if (!budgetValue) {
      Alert.alert("Budget", "Enter a budget.");
      return;
    }
    setIsSaving(true);
    try {
      await api.tasks.repost(taskId, {
        title: title.trim(),
        description: description.trim(),
        category,
        budget: budgetValue,
        ...(maxBids ? { maxBids: Number(maxBids) } : {}),
        dueDate: due.toISOString(),
        imageUrls,
      });
      await fetchRequesterTasks();
      Alert.alert("Task reposted", "Providers can bid again.");
      router.replace("/my-posted-tasks");
    } catch (error: any) {
      Alert.alert("Could not repost", error?.response?.data?.message || "Please check the fields and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete permanently?", "Its bids, checklist and history are removed and cannot be recovered.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void (async () => {
          if (!taskId) return;
          setIsDeleting(true);
          try {
            await api.tasks.deletePermanently(taskId);
            await fetchRequesterTasks();
            router.replace("/my-posted-tasks");
          } catch (error: any) {
            Alert.alert("Could not delete", error?.response?.data?.message || "Please try again.");
            setIsDeleting(false);
          }
        })(),
      },
    ]);
  };

  if (loadError || !task) {
    return (
      <MarketplaceShell activeRoute="posted">
        <Card>
          <Text style={styles.body}>{loadError || "Loading..."}</Text>
          {loadError ? <Button title="Back to my tasks" variant="outline" onPress={() => router.replace("/my-posted-tasks")} /> : null}
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell activeRoute="posted">
      <Card title="Edit and repost">
        <Text style={styles.body}>
          "{task.title}" expired{task.dueDate ? ` on ${formatDateTime(task.dueDate)}` : ""}
          {bidCount > 0 ? ` with ${bidCount} bid(s) but nobody assigned.` : " with no bids."} Only you can see it.
        </Text>
      </Card>

      {suggestions.length > 0 ? (
        <Card title="How to get bids this time">
          <View style={styles.tips}>
            {suggestions.map((tip, index) => (
              <View key={`${tip.field}-${index}`} style={styles.tip}>
                <Text style={styles.tipText}>{tip.message}</Text>
                {tip.suggestedValue != null && ["budget", "dueDate", "maxBids"].includes(tip.field) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    title={tip.field === "budget" ? `Use ${formatCurrency(Number(tip.suggestedValue))}` : tip.field === "dueDate" ? "Use this deadline" : `Use ${tip.suggestedValue}`}
                    onPress={() => applySuggestion(tip)}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <Card>
        <View style={styles.form}>
          <Input label="Title" value={title} onChangeText={setTitle} placeholder="e.g. Fix leaking kitchen tap" />
          <Input
            label="Description"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            placeholder="Size of the job, materials, access, best time"
          />
          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {TASK_CATEGORIES.map((value) => (
              <Pressable
                key={value}
                onPress={() => setCategory(value)}
                style={[styles.chip, category === value ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, category === value ? styles.chipTextActive : null]}>{formatCategoryLabel(value)}</Text>
              </Pressable>
            ))}
          </View>
          <Input
            label="Budget (VND)"
            keyboardType="numeric"
            value={budget ? Number(budget.replace(/\D/g, "") || 0).toLocaleString("en-US") : ""}
            onChangeText={(text) => setBudget(text.replace(/\D/g, ""))}
            placeholder="e.g. 500,000"
          />
          <Input label="Max bids" keyboardType="numeric" value={maxBids} onChangeText={setMaxBids} placeholder="e.g. 10" />
          <Input
            label="New deadline*"
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="e.g. 2026-12-05T17:00"
            autoCapitalize="none"
          />
          <Text style={styles.label}>Photos ({imageUrls.length}/3)</Text>
          <View style={styles.photos}>
            {imageUrls.map((url) => (
              <Pressable key={url} onPress={() => setImageUrls((current) => current.filter((item) => item !== url))}>
                <Image source={{ uri: url }} style={styles.photo} />
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ))}
            {imageUrls.length < 3 ? (
              <Button title={isUploading ? "Uploading..." : "Add photo"} size="sm" variant="outline" onPress={() => void addPhoto()} disabled={isUploading} />
            ) : null}
          </View>
          <Text style={styles.note}>Location stays the same: {task.location}</Text>
          <Button title={isSaving ? "Reposting..." : "Repost task"} onPress={() => void repost()} disabled={isSaving || isUploading} />
          <Button title={isDeleting ? "Deleting..." : "Delete permanently"} variant="outline" onPress={confirmDelete} disabled={isDeleting} />
        </View>
      </Card>
    </MarketplaceShell>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.dark[700], fontSize: 14, lineHeight: 21 },
  tips: { gap: 10 },
  tip: {
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning[200],
    backgroundColor: colors.warning[50],
  },
  tipText: { color: colors.dark[800], fontSize: 13, lineHeight: 19 },
  form: { gap: 12 },
  label: { fontSize: 14, fontWeight: "700", color: colors.dark[700] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.dark[200], backgroundColor: colors.white },
  chipActive: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  chipText: { fontSize: 13, color: colors.dark[700] },
  chipTextActive: { color: colors.primary[700], fontWeight: "700" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  photo: { width: 72, height: 72, borderRadius: radius.sm },
  removeText: { fontSize: 11, color: colors.danger[600], textAlign: "center", marginTop: 2 },
  note: { fontSize: 13, color: colors.dark[500] },
});
