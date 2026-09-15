import type {
  InboxActivityDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxNotificationSummaryDto,
} from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import {
  previewActive,
  previewActivity,
  previewNotifications,
  previewPending,
  previewProjects,
} from "../../src/lib/inbox-preview";
import { DEVICE_ID_KEY, submitInteractionResponse } from "../../src/lib/interactions";
import { PREVIEW_MODE } from "../../src/lib/preview";
import {
  activityForProject,
  canMarkAllRead,
  loadedUnreadCount,
  markLoadedItemsRead,
  normalizeReadThroughToken,
  optionalProjectLookup,
  projectSummaryUnread,
} from "../../src/lib/project-inbox";
import { SymbolView } from "../../src/lib/symbol-view";
import { createThemedStyles, fonts, tightTracking } from "../../src/lib/theme";
import { ActiveRow, ActivityRow, PendingRow } from "../inbox";

const PAGE_SIZE = 30;

export default function ProjectScreen() {
  const { colors, statusBarStyle, styles } = useStyles();
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ project: string; name?: string }>();
  const projectParam = typeof params.project === "string" ? params.project : "unfiled";
  const projectId = projectParam === "unfiled" ? null : projectParam;
  const routeTitle = typeof params.name === "string" && params.name ? params.name : "Notifications";
  const [title, setTitle] = useState(routeTitle);
  const simulatorPreview = PREVIEW_MODE;

  const [items, setItems] = useState<InboxNotificationSummaryDto[]>([]);
  const [pending, setPending] = useState<InboxInteractionDto[]>([]);
  const [active, setActive] = useState<InboxLiveActivityDto[]>([]);
  const [history, setHistory] = useState<InboxActivityDto[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Authoritative unread count from the project summary API. It also covers
  // unread rows beyond the loaded page, so mark-all stays available for them.
  const [summaryUnread, setSummaryUnread] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Server-issued snapshot boundary for mark-all-read: the server only marks
  // rows this token covered, so notifications arriving after the load stay
  // unread even when their timestamps tie with the newest loaded row.
  const [readThrough, setReadThrough] = useState<string | null>(null);
  const loadToken = useRef(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((value) =>
      setDeviceId(value ?? (simulatorPreview ? "preview-device" : null)),
    );
  }, []);

  const loadFirstPage = useCallback(
    async (unread: boolean) => {
      // One token guards both requests, so overlapping loads (focus refresh
      // racing pull-to-refresh or a filter change) cannot interleave stale
      // pages or summaries into fresher state.
      const token = ++loadToken.current;
      if (simulatorPreview) {
        const inProject = previewNotifications.filter((item) => item.projectId === projectId);
        const filtered = unread ? inProject.filter((item) => item.readAt === null) : inProject;
        setItems(filtered);
        setPending(previewPending.filter((item) => (item.projectId ?? null) === projectId));
        setActive(previewActive.filter((item) => (item.projectId ?? null) === projectId));
        const projectHistory = activityForProject(previewActivity, projectId);
        setHistory(projectHistory.slice(0, 20));
        setHistoryPage(0);
        setHistoryHasMore(false);
        // No server issues tokens in preview; mark-all short-circuits anyway.
        setReadThrough("preview");
        setNextCursor(null);
        setSummaryUnread(projectSummaryUnread(previewProjects.projects, projectParam));
        setLoadError(false);
        return;
      }
      try {
        const [page, projects, ownerProjects, interactions, activities, activityHistory] =
          await Promise.all([
            api.listInboxNotifications({ project: projectParam, unread, limit: PAGE_SIZE }),
            // The summary is an enhancement; its failure never blocks the list.
            api.listInboxProjects().catch(() => null),
            optionalProjectLookup(api.listProjects("include")),
            api.listPendingInteractions(),
            api.listActiveActivities(),
            api.listActivityFeed("all", 0, projectParam),
          ]);
        if (token !== loadToken.current) return;
        setItems(page.items);
        setPending(
          interactions.interactions.filter((item) => (item.projectId ?? null) === projectId),
        );
        setActive(activities.activities.filter((item) => (item.projectId ?? null) === projectId));
        setHistory(activityForProject(activityHistory.items, projectId));
        setHistoryPage(activityHistory.page);
        setHistoryHasMore(
          (activityHistory.page + 1) * activityHistory.pageSize < activityHistory.total,
        );
        setTitle(
          projectId === null
            ? "Other"
            : (ownerProjects?.projects.find((project) => project.id === projectId)?.name ??
                routeTitle),
        );
        setReadThrough(normalizeReadThroughToken(page.readThroughToken));
        setNextCursor(page.nextCursor);
        if (projects) setSummaryUnread(projectSummaryUnread(projects.projects, projectParam));
        setLoadError(false);
      } catch {
        if (token !== loadToken.current) return;
        setLoadError(true);
      }
    },
    [projectId, projectParam, routeTitle],
  );

  const resolveItem = async (
    item: InboxInteractionDto,
    action: "approve" | "deny" | "yes" | "no" | "reply",
    response?: string,
  ) => {
    if (!deviceId || respondingTo) return;
    setRespondingTo(item.id);
    try {
      if (!simulatorPreview) {
        if (action === "reply") {
          await submitInteractionResponse(item.id, {
            action,
            response: response?.trim() ?? "",
            actionDigest: item.actionDigest,
          });
        } else {
          await submitInteractionResponse(item.id, {
            action,
            actionDigest: item.actionDigest,
          });
        }
      }
      setPending((current) => current.filter((candidate) => candidate.id !== item.id));
      setReplyingTo(null);
      setReply("");
      if (!simulatorPreview) await loadFirstPage(unreadOnly);
    } catch (error) {
      Alert.alert(
        "Could not save response",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setRespondingTo(null);
    }
  };

  // Reload on every focus — including the return from the detail screen,
  // which marks a notification read — and whenever the unread filter flips.
  // The shared load token keeps re-entrant loads from racing each other.
  useFocusEffect(
    useCallback(() => {
      if (!session && !simulatorPreview) return;
      if (!loadedOnce.current) setLoading(true);
      void loadFirstPage(unreadOnly).finally(() => {
        loadedOnce.current = true;
        setLoading(false);
      });
    }, [loadFirstPage, session, unreadOnly]),
  );

  useEffect(() => {
    if (!session && !simulatorPreview) return;
    const refresh = () => void loadFirstPage(unreadOnly);
    const timer = setInterval(refresh, 15_000);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const notificationSubscription = Notifications.addNotificationReceivedListener(refresh);
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
      notificationSubscription.remove();
    };
  }, [loadFirstPage, session, unreadOnly]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore || simulatorPreview) return;
    setLoadingMore(true);
    try {
      const page = await api.listInboxNotifications({
        project: projectParam,
        unread: unreadOnly,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // Keep the loaded slice; the footer button retries on the next scroll.
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreHistory = async () => {
    if (loadingHistory || !historyHasMore || simulatorPreview) return;
    setLoadingHistory(true);
    try {
      const page = await api.listActivityFeed("all", historyPage + 1, projectParam);
      const projectItems = activityForProject(page.items, projectId);
      setHistory((current) => {
        const known = new Set(current.map((item) => `${item.kind}:${item.id}`));
        return [
          ...current,
          ...projectItems.filter((item) => !known.has(`${item.kind}:${item.id}`)),
        ];
      });
      setHistoryPage(page.page);
      setHistoryHasMore((page.page + 1) * page.pageSize < page.total);
    } catch {
      // Keep the loaded history; the button remains available to retry.
    } finally {
      setLoadingHistory(false);
    }
  };

  const markAllRead = async () => {
    // The button is disabled without a token; this guard covers races.
    if (markingAll || !readThrough) return;
    setMarkingAll(true);
    try {
      if (!simulatorPreview) {
        // The snapshot token marks every unread row the last load observed —
        // including older rows beyond the first page — while notifications
        // arriving mid-tap stay unread even on timestamp ties.
        await api.markAllNotificationsRead({
          readThrough,
          project: projectParam,
        });
      }
      setItems((current) => markLoadedItemsRead(current, new Date().toISOString()));
      setSummaryUnread(0);
      // Reconcile with the server in the background; the load token drops
      // this refresh if a newer one starts first.
      if (!simulatorPreview) void loadFirstPage(unreadOnly);
    } catch (error) {
      Alert.alert(
        "Could not mark all read",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setMarkingAll(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadFirstPage(unreadOnly);
    } finally {
      setRefreshing(false);
    }
  };

  const unreadCount = loadedUnreadCount(items);
  const markAllAvailable = canMarkAllRead(unreadCount, summaryUnread, readThrough);

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <StatusBar style={statusBarStyle} />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox"))}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <SymbolView name="chevron.left" size={16} tintColor={colors.ink} weight="semibold" />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityLabel="Mark all read"
          accessibilityRole="button"
          disabled={markingAll || !markAllAvailable}
          onPress={() => void markAllRead()}
          style={({ pressed }) => [
            styles.iconButton,
            (markingAll || !markAllAvailable) && styles.iconButtonDisabled,
            pressed && markAllAvailable && styles.iconButtonPressed,
          ]}
        >
          <SymbolView
            name="checkmark.circle"
            size={18}
            tintColor={markAllAvailable ? colors.accent : colors.soft}
          />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <>
              {pending.length > 0 ? (
                <View style={styles.relatedSection}>
                  <Text style={styles.sectionHeading}>Needs your response</Text>
                  {pending.map((item, index) => (
                    <PendingRow
                      item={item}
                      key={item.id}
                      first={index === 0}
                      replying={replyingTo === item.id}
                      reply={reply}
                      onReplyChange={setReply}
                      onStartReply={() => setReplyingTo(item.id)}
                      onCancelReply={() => {
                        setReplyingTo(null);
                        setReply("");
                      }}
                      onResolve={(action, response) => void resolveItem(item, action, response)}
                      responding={respondingTo === item.id}
                    />
                  ))}
                </View>
              ) : null}
              {loadError ? (
                <Text style={styles.refreshError}>
                  Couldn’t refresh this project. Pull to retry.
                </Text>
              ) : null}
              {active.length > 0 ? (
                <View style={styles.relatedSection}>
                  <Text style={styles.sectionHeading}>Live Updates</Text>
                  {active.map((item, index) => (
                    <ActiveRow item={item} key={item.id} first={index === 0} />
                  ))}
                </View>
              ) : null}
              <View style={styles.messageHeader}>
                <Text style={styles.sectionHeading}>Messages</Text>
                <View style={styles.filterRow}>
                  {(
                    [
                      { label: "All", value: false },
                      { label: "Unread", value: true },
                    ] as const
                  ).map((option) => {
                    const selected = unreadOnly === option.value;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        key={option.label}
                        onPress={() => setUnreadOnly(option.value)}
                        style={({ pressed }) => [
                          styles.filterOption,
                          selected && styles.filterOptionSelected,
                          pressed && styles.filterOptionPressed,
                        ]}
                      >
                        <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {loadError
                ? "Couldn’t load notifications. Pull to refresh."
                : unreadOnly
                  ? "No unread notifications."
                  : "No notifications yet."}
            </Text>
          }
          ListFooterComponent={
            <>
              {loadingMore ? (
                <ActivityIndicator color={colors.accent} style={styles.footerLoading} />
              ) : null}
              <View style={styles.historySection}>
                <Text style={styles.sectionHeading}>History</Text>
                {history.length > 0 ? (
                  history.map((item, index) => (
                    <ActivityRow item={item} key={`${item.kind}:${item.id}`} first={index === 0} />
                  ))
                ) : (
                  <Text style={styles.emptyHistory}>No project activity yet.</Text>
                )}
                {historyHasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={loadingHistory}
                    onPress={() => void loadMoreHistory()}
                    style={({ pressed }) => [
                      styles.loadHistoryButton,
                      pressed && styles.filterOptionPressed,
                    ]}
                  >
                    <Text style={styles.loadHistoryText}>
                      {loadingHistory ? "Loading…" : "Load older activity"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          }
          renderItem={({ item }) => (
            <NotificationRow
              item={item}
              onPress={() =>
                router.push({ pathname: "/notification/[id]", params: { id: item.id } })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: InboxNotificationSummaryDto;
  onPress: () => void;
}) {
  const { styles } = useStyles();
  const unread = item.readAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.unreadDot, !unread && styles.unreadDotHidden]} />
      <View style={styles.rowCopy}>
        <View style={styles.rowTopLine}>
          <Text numberOfLines={1} style={[styles.rowTitle, unread && styles.rowTitleUnread]}>
            {item.title}
          </Text>
          <Text style={styles.rowTime}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.rowPreview}>
          {item.preview}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {item.sourceName}
        </Text>
      </View>
    </Pressable>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  headerTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    textAlign: "center",
    letterSpacing: tightTracking(17),
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  iconButtonPressed: {
    backgroundColor: colors.pressed,
    transform: [{ scale: 0.96 }],
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  relatedSection: {
    marginBottom: 12,
  },
  historySection: {
    marginTop: 18,
  },
  emptyHistory: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  refreshError: {
    marginVertical: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: tightTracking(12),
  },
  loadHistoryButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  loadHistoryText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  sectionHeading: {
    paddingVertical: 10,
    color: colors.soft,
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  filterOption: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 18,
  },
  filterOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  filterOptionPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.96 }],
  },
  filterLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  filterLabelSelected: {
    color: colors.accent,
  },
  loading: {
    paddingVertical: 40,
  },
  footerLoading: {
    paddingVertical: 20,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  empty: {
    paddingVertical: 24,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  row: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.7,
  },
  unreadDot: {
    width: 8,
    height: 8,
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  unreadDotHidden: {
    opacity: 0,
  },
  rowCopy: {
    minWidth: 0,
    flex: 1,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: tightTracking(14),
  },
  rowTitleUnread: {
    fontFamily: fonts.semibold,
  },
  rowTime: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  rowPreview: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  rowMeta: {
    marginTop: 3,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: tightTracking(11),
  },
}));
