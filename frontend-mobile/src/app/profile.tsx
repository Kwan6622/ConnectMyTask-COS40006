import React, { useEffect, useMemo, useState } from "react";
import { Alert, Image, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { useAuthStore } from "@/store/authStore";
import { useTaskStore } from "@/store/taskStore";
import { colors, radius } from "@/theme/tokens";
import { uploadImageToCloudinary } from "@/utils/cloudinaryUpload";
import {
  getDisplayName,
  getSuccessTone,
  isProvider,
  isRequester,
} from "@/utils/taskUtils";

export default function ProfilePage(): React.ReactElement {
  const router = useRouter();
  const {
    user,
    isAuthenticated,
    logout,
    updateProfile,
    updateProfilePhoto,
    isLoading,
  } = useAuthStore((state) => ({
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    logout: state.logout,
    updateProfile: state.updateProfile,
    updateProfilePhoto: state.updateProfilePhoto,
    isLoading: state.isLoading,
  }));
  const {
    requesterTasks,
    assignedTasks,
    fetchRequesterTasks,
    fetchAssignedTasks,
  } = useTaskStore((state) => ({
    requesterTasks: state.requesterTasks,
    assignedTasks: state.assignedTasks,
    fetchRequesterTasks: state.fetchRequesterTasks,
    fetchAssignedTasks: state.fetchAssignedTasks,
  }));

  const [isEditing, setIsEditing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [selectedAssetName, setSelectedAssetName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (isRequester(user)) {
      void fetchRequesterTasks();
    }
    if (isProvider(user)) {
      void fetchAssignedTasks();
    }
  }, [fetchAssignedTasks, fetchRequesterTasks, isAuthenticated, user]);

  useEffect(() => {
    setFullName(user?.fullName || user?.name || "");
    setEmail(user?.email || "");
    setPhoneNumber(user?.phoneNumber || user?.phone || "");
    setLocation(user?.location || "");
    setBio(user?.bio || "");
  }, [user]);

  const taskSet = isProvider(user) ? assignedTasks : requesterTasks;
  const completedTasks = useMemo(
    () => taskSet.filter((task) => ["COMPLETED", "PAID"].includes(String(task.status))).length,
    [taskSet]
  );
  const successRate = useMemo(() => {
    if (taskSet.length === 0) return 100;
    return Math.round((completedTasks / taskSet.length) * 100);
  }, [completedTasks, taskSet.length]);
  const reviewCount = Math.max(completedTasks, Math.round(Number(user?.rating || 0) * 2));
  const successTone = getSuccessTone(successRate);

  const chooseImage = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setSelectedAsset(asset);
    setSelectedAssetName(asset.fileName || asset.uri.split("/").pop() || "Selected image");
  };

  const handleUploadProfilePhoto = async (): Promise<void> => {
    if (!selectedAsset) {
      Alert.alert("Choose an image", "Select an image to preview it, then upload.");
      return;
    }

    try {
      const secureUrl = await uploadImageToCloudinary({
        uri: selectedAsset.uri,
        fileName: selectedAsset.fileName || `profile-${Date.now()}.jpg`,
        mimeType: selectedAsset.mimeType,
      });
      await updateProfilePhoto(secureUrl);
      Alert.alert("Profile updated", "Your profile photo was uploaded successfully.");
      setSelectedAsset(null);
      setSelectedAssetName("");
    } catch (error: any) {
      const message = error?.message || "Failed to upload profile photo.";
      Alert.alert("Upload failed", message);
    }
  };

  const handleSaveProfile = async (): Promise<void> => {
    await updateProfile({
      fullName: fullName.trim(),
      name: fullName.trim(),
      email: email.trim(),
      phone: phoneNumber.trim(),
      phoneNumber: phoneNumber.trim(),
      location: location.trim(),
      bio: bio.trim(),
    });
    setIsEditing(false);
    Alert.alert("Profile saved", "Your profile information was updated locally for the mobile workspace.");
  };

  if (!isAuthenticated || !user) {
    return (
      <MarketplaceShell activeRoute="profile">
        <Card>
          <View style={styles.promptBox}>
            <Text style={styles.promptTitle}>Sign in to view your profile</Text>
            <Text style={styles.promptBody}>
              Profile, saved tasks, and role-based workspace settings follow your shared account.
            </Text>
            <Button title="Sign In" onPress={() => router.push("/sign-in")} />
          </View>
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell activeRoute="profile">
      <View style={styles.headerCopy}>
        <Text style={styles.pageTitle}>My Profile</Text>
        <Text style={styles.pageSubtitle}>Manage your account and preferences</Text>
      </View>

      <Card>
        <View style={styles.profileCard}>
          {selectedAsset?.uri || user.profilePhotoUrl ? (
            <Image source={{ uri: selectedAsset?.uri || user.profilePhotoUrl }} style={styles.profileImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{getDisplayName(user).charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <View style={styles.photoControls}>
            <Button title="Choose Picture" size="sm" onPress={() => void chooseImage()} />
            <Text style={styles.selectedFileText}>{selectedAssetName || "No file chosen yet"}</Text>
            <Button
              title={isLoading ? "Uploading..." : "Upload Profile Photo"}
              size="sm"
              onPress={() => void handleUploadProfilePhoto()}
              disabled={!selectedAsset}
            />
            <Text style={styles.photoTip}>Select an image to preview it, then upload</Text>
          </View>

          <Badge label={isProvider(user) ? "Service Provider" : "Client"} variant="primary" />

          <View style={styles.statsRow}>
            <StatBox label="Tasks Done" value={String(completedTasks)} accentColor={colors.primary[700]} />
            <StatBox label="Success" value={`${successRate}%`} accentColor={successToneColor(successTone)} />
            <StatBox label="Reviews" value={String(reviewCount)} accentColor={colors.accent[600]} />
          </View>
        </View>
      </Card>

      <Card>
        <View style={styles.contactCard}>
          <Text style={styles.contactText}>{email}</Text>
          {String(user.role || "").toUpperCase() === "ADMIN" ? (
            <Text style={styles.webOnlyNote}>Admin operations are currently available on web-only.</Text>
          ) : null}
          <Button
            title="Logout"
            variant="danger"
            onPress={() => {
              logout();
              router.push("/browse-tasks");
            }}
          />
        </View>
      </Card>

      <Card
        title="Profile Information"
        actions={
          <Button
            title={isEditing ? "Cancel" : "Edit"}
            size="sm"
            variant={isEditing ? "outline" : "primary"}
            onPress={() => setIsEditing((current) => !current)}
          />
        }
      >
        {isEditing ? (
          <View style={styles.form}>
            <Input label="Full Name" value={fullName} onChangeText={setFullName} />
            <Input label="Email" value={email} onChangeText={setEmail} />
            <Input label="Phone Number" value={phoneNumber} onChangeText={setPhoneNumber} />
            <Input label="Location" value={location} onChangeText={setLocation} />
            <Input
              label="Bio"
              value={bio}
              onChangeText={setBio}
              multiline
              numberOfLines={4}
              helperText="Tell people a bit more about how you work."
            />
            <Button title="Save Changes" onPress={() => void handleSaveProfile()} />
          </View>
        ) : (
          <View style={styles.infoList}>
            <InfoRow label="Full Name" value={fullName || "-"} />
            <InfoRow label="Email" value={email || "-"} />
            <InfoRow label="Phone Number" value={phoneNumber || "-"} />
            <InfoRow label="Location" value={location || "-"} />
            <InfoRow
              label="Bio"
              value={bio || "No bio added yet. Click Edit to add a bio."}
              multiline
            />
          </View>
        )}
      </Card>
    </MarketplaceShell>
  );
}

function StatBox({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: string;
  accentColor: string;
}): React.ReactElement {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color: accentColor }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InfoRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, multiline ? styles.infoValueMultiline : null]}>{value}</Text>
    </View>
  );
}

function successToneColor(tone: "success" | "warning" | "danger"): string {
  if (tone === "success") return colors.success[700];
  if (tone === "warning") return colors.warning[600];
  return colors.danger[700];
}

const styles = StyleSheet.create({
  headerCopy: {
    gap: 2,
  },
  pageTitle: {
    color: colors.dark[900],
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
  },
  pageSubtitle: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
  },
  profileCard: {
    gap: 14,
    alignItems: "center",
  },
  profileImage: {
    width: 112,
    height: 112,
    borderRadius: 24,
  },
  avatarFallback: {
    width: 112,
    height: 112,
    borderRadius: 24,
    backgroundColor: colors.primary[600],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: colors.white,
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "800",
  },
  photoControls: {
    width: "100%",
    gap: 8,
  },
  selectedFileText: {
    color: colors.dark[600],
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  photoTip: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  statsRow: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  statBox: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.dark[50],
    padding: 12,
    alignItems: "center",
    gap: 3,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
  },
  statLabel: {
    color: colors.dark[500],
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  contactCard: {
    gap: 12,
  },
  contactText: {
    color: colors.dark[800],
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  webOnlyNote: {
    color: colors.warning[600],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  form: {
    gap: 12,
  },
  infoList: {
    gap: 12,
  },
  infoRow: {
    borderRadius: radius.lg,
    backgroundColor: colors.dark[50],
    padding: 12,
    gap: 4,
  },
  infoLabel: {
    color: colors.dark[500],
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.dark[900],
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  infoValueMultiline: {
    fontWeight: "600",
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
    textAlign: "center",
  },
  promptBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
