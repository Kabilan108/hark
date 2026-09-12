import type { InboxNotificationDetailDto } from "@hark/contracts";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, classifyNotificationDetailFailure } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { linkifyBody, openBodyLink, openTopLevelDestination } from "../../src/lib/inbox-body";
import { previewNotificationDetail } from "../../src/lib/inbox-preview";
import { PREVIEW_MODE } from "../../src/lib/preview";
import { SymbolView } from "../../src/lib/symbol-view";
import { colors, fonts, tightTracking } from "../../src/lib/theme";

export default function NotificationDetailScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const compositeId = typeof params.id === "string" ? params.id : "";
  const simulatorPreview = PREVIEW_MODE;

  const [notification, setNotification] = useState<InboxNotificationDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [togglingRead, setTogglingRead] = useState(false);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      setNotification(previewNotificationDetail(compositeId));
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const result = await api.getInboxNotification(compositeId);
      setNotification(result.notification);
      // Mark read only after the full content actually loaded.
      if (result.notification.readAt === null) {
        try {
          const marked = await api.markNotificationRead(compositeId);
          setNotification({ ...result.notification, readAt: marked.readAt });
        } catch {
          // Unread state stays; the next open retries.
        }
      }
    } catch (error) {
      const failure = classifyNotificationDetailFailure(error);
      if (failure === "not_found") {
        // A modern server confirmed the notification is gone.
        setNotFound(true);
      } else if (failure === "unsupported_server") {
        // Old or self-hosted servers have no detail route; a push tap lands
        // here anyway, so return to the legacy inbox instead of a dead end.
        router.replace("/inbox");
        return;
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [compositeId, router]);

  useEffect(() => {
    if (!session && !simulatorPreview) return;
    void load();
  }, [load, session]);

  const toggleRead = async () => {
    if (!notification || togglingRead) return;
    setTogglingRead(true);
    try {
      if (notification.readAt === null) {
        const marked = simulatorPreview
          ? { readAt: new Date().toISOString() }
          : await api.markNotificationRead(notification.id);
        setNotification({ ...notification, readAt: marked.readAt });
      } else {
        if (!simulatorPreview) await api.markNotificationUnread(notification.id);
        setNotification({ ...notification, readAt: null });
      }
    } catch (error) {
      Alert.alert("Could not update", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setTogglingRead(false);
    }
  };

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox"))}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <SymbolView name="chevron.left" size={16} tintColor={colors.ink} weight="semibold" />
        </Pressable>
        <View style={styles.headerSpacer} />
        {notification ? (
          <Pressable
            accessibilityLabel={notification.readAt ? "Mark unread" : "Mark read"}
            accessibilityRole="button"
            disabled={togglingRead}
            onPress={() => void toggleRead()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <SymbolView
              name={notification.readAt ? "envelope.badge" : "envelope.open"}
              size={17}
              tintColor={colors.accent}
            />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : notFound ? (
        <Text style={styles.missing}>This notification is no longer available.</Text>
      ) : loadError || !notification ? (
        <View style={styles.errorGroup}>
          <Text style={styles.missing}>Couldn’t load this notification.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.iconButtonPressed]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text selectable style={styles.title}>
            {notification.title}
          </Text>
          <View style={styles.metaBlock}>
            <MetaRow label="From" value={notification.sourceName} />
            {notification.projectName ? (
              <MetaRow label="Project" value={notification.projectName} />
            ) : null}
            <MetaRow label="Received" value={formatFullTime(notification.createdAt)} />
            {notification.status ? (
              <MetaRow label="Status" value={statusLabel(notification.status)} />
            ) : null}
            <MetaRow label="State" value={notification.readAt ? "Read" : "Unread"} />
          </View>

          <BodyText body={notification.body} />

          {notification.url ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (notification.url) void openTopLevelDestination(notification.url);
              }}
              style={({ pressed }) => [styles.openButton, pressed && styles.openButtonPressed]}
            >
              <SymbolView name="arrow.up.right" size={14} tintColor="#FFFFFF" weight="semibold" />
              <Text style={styles.openButtonText}>Open link</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * Selectable plaintext body with safe URL linkification. No HTML, no
 * WebView, no remote previews; links are revalidated again on tap.
 */
function BodyText({ body }: { body: string }) {
  const segments = linkifyBody(body);
  // Character offsets make stable keys even when segment text repeats.
  let offset = 0;
  const keyed = segments.map((segment) => {
    const key = `at-${offset}`;
    offset += segment.text.length;
    return { ...segment, key };
  });
  return (
    <Text selectable style={styles.body}>
      {keyed.map((segment) =>
        segment.url ? (
          <Text
            key={segment.key}
            onPress={() => {
              if (segment.url) void openBodyLink(segment.url);
            }}
            style={styles.bodyLink}
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={segment.key}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text selectable style={styles.metaValue}>
        {value}
      </Text>
    </View>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "accepted":
      return "Delivered";
    case "partial":
      return "Partially delivered";
    case "no_devices":
      return "No devices";
    case "failed":
      return "Failed";
    case "withdrawn":
    case "withdraw_partial":
      return "Withdrawn";
    default:
      return status;
  }
}

function formatFullTime(value: string): string {
  const date = new Date(value);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  headerSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  loading: {
    paddingVertical: 40,
  },
  missing: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  errorGroup: {
    alignItems: "flex-start",
  },
  retryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 24,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  retryText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 64,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: tightTracking(20),
  },
  metaBlock: {
    gap: 6,
    marginTop: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaLabel: {
    width: 72,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  metaValue: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  body: {
    marginTop: 16,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: tightTracking(15),
  },
  bodyLink: {
    color: colors.accent,
    textDecorationLine: "underline",
  },
  openButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 24,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  openButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  openButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
});
