import * as Notifications from "expo-notifications";
import { Redirect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import {
  configure,
  getSettings,
  type HarkAndroidSettings,
  openNotificationSettings,
  openPromotedNotificationSettings,
  setWatchedActivitiesEnabled,
} from "hark-android";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../src/lib/api";
import { API_URL, authClient, useSession } from "../src/lib/auth";
import { DEVICE_ID_KEY, FCM_TOKEN_KEY } from "../src/lib/device";
import { clearInteractionResponses } from "../src/lib/interactions";
import { PREVIEW_MODE } from "../src/lib/preview";
import { SymbolView } from "../src/lib/symbol-view";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function SettingsScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [androidSettings, setAndroidSettings] = useState<HarkAndroidSettings | null>(null);
  const [changingWatchSetting, setChangingWatchSetting] = useState(false);

  const refreshSettings = useCallback(async () => {
    const [deviceId, settings] = await Promise.all([
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      getSettings(),
    ]);
    setNotificationsAllowed(settings.notificationsEnabled);
    setRegistered(Boolean(deviceId));
    setAndroidSettings(settings);
  }, []);

  useEffect(() => {
    void refreshSettings();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshSettings();
    });
    return () => subscription.remove();
  }, [refreshSettings]);

  if (!isPending && !session && !PREVIEW_MODE) return <Redirect href="/" />;

  const clearDevice = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(FCM_TOKEN_KEY),
      SecureStore.deleteItemAsync(DEVICE_ID_KEY),
      clearInteractionResponses(),
      Notifications.setBadgeCountAsync(0),
      configure({ backendOrigin: API_URL, deviceId: null }),
    ]);
  };

  const signOut = () => {
    Alert.alert("Sign out", "This device will stop receiving notifications.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const fcmToken = await SecureStore.getItemAsync(FCM_TOKEN_KEY);
            try {
              if (fcmToken) await api.unregisterDevice({ fcmToken });
            } catch {
              // Best effort; stale tokens are also deactivated server-side.
            }
            await clearDevice();
            await authClient.signOut();
            router.replace("/");
          })();
        },
      },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your services, activity history, and registered devices.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const fcmToken = await SecureStore.getItemAsync(FCM_TOKEN_KEY);
                if (fcmToken) await api.unregisterDevice({ fcmToken });
                const result = await authClient.deleteUser();
                if (result.error) {
                  throw new Error(result.error.message ?? "Account deletion was not completed");
                }
                await clearDevice();
                router.replace("/");
              } catch (error) {
                Alert.alert(
                  "Could not delete account",
                  error instanceof Error ? error.message : "Please try again.",
                );
              }
            })();
          },
        },
      ],
    );
  };

  const changeWatchedActivities = async (enabled: boolean) => {
    if (!androidSettings || changingWatchSetting) return;
    setChangingWatchSetting(true);
    try {
      await setWatchedActivitiesEnabled(enabled);
      setAndroidSettings(await getSettings());
    } catch (error) {
      Alert.alert(
        "Could not change live update settings",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setChangingWatchSetting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
          </Pressable>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.iconButton} />
        </View>

        <SettingsRow
          icon="bell.fill"
          label="Notifications"
          value={
            notificationsAllowed === null ? "Checking…" : notificationsAllowed ? "Allowed" : "Off"
          }
          onPress={
            notificationsAllowed === false ? () => void openNotificationSettings() : undefined
          }
        />
        <SettingsRow
          icon="iphone"
          label="This Android device"
          value={registered === null ? "Checking…" : registered ? "Registered" : "Not registered"}
          onPress={registered === false ? () => router.replace("/home") : undefined}
        />
        <SettingsRow
          icon="waveform.path.ecg"
          label="Promoted live updates"
          value={
            androidSettings === null
              ? "Checking…"
              : !androidSettings.promotionSupported
                ? "Unavailable"
                : androidSettings.promotionEnabled
                  ? "Allowed"
                  : "Off"
          }
          onPress={
            androidSettings?.promotionSupported && !androidSettings.promotionEnabled
              ? () => void openPromotedNotificationSettings()
              : undefined
          }
        />
        <SettingsToggleRow
          label="Watch task updates"
          value={androidSettings?.watchedActivitiesEnabled ?? false}
          disabled={androidSettings === null || changingWatchSetting}
          onValueChange={(enabled) => void changeWatchedActivities(enabled)}
        />
        <SettingsRow icon="person.fill" label="Signed in as" value={session?.user.email ?? ""} />
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.accountAction}>
          <Text style={styles.accountActionText}>Sign out</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={deleteAccount} style={styles.accountAction}>
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsToggleRow({
  label,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <SymbolView name="eye.fill" size={16} tintColor={colors.accent} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.line, true: colors.accentSoft }}
        thumbColor={value ? colors.accent : colors.soft}
        value={value}
      />
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: Parameters<typeof SymbolView>[0]["name"];
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <SymbolView name={icon} size={16} tintColor={colors.accent} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <SymbolView name="chevron.right" size={12} tintColor={colors.soft} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  headerTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: tightTracking(17),
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  rowPressed: { opacity: 0.65 },
  rowIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
  },
  rowLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  rowValue: {
    minWidth: 0,
    flex: 1,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "right",
    letterSpacing: tightTracking(13),
  },
  accountAction: {
    minHeight: 52,
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  accountActionText: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  deleteText: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  pressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
});
