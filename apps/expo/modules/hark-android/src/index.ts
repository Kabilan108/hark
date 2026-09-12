import { requireNativeModule } from "expo-modules-core";

export interface HarkAndroidConfiguration {
  backendOrigin: string;
  deviceId?: string | null;
}

export interface HarkAndroidSettings {
  notificationsEnabled: boolean;
  promotionEnabled: boolean;
  promotionSupported: boolean;
  watchedActivitiesEnabled: boolean;
}

interface HarkAndroidNativeModule {
  configure(configuration: HarkAndroidConfiguration): Promise<void>;
  getFcmToken(): Promise<string | null>;
  getSettings(): Promise<HarkAndroidSettings>;
  setWatchedActivitiesEnabled(enabled: boolean): Promise<void>;
  openNotificationSettings(): Promise<void>;
  openPromotedNotificationSettings(): Promise<void>;
}

const nativeModule = requireNativeModule<HarkAndroidNativeModule>("HarkAndroid");

export function configure(configuration: HarkAndroidConfiguration): Promise<void> {
  return nativeModule.configure(configuration);
}

export function getFcmToken(): Promise<string | null> {
  return nativeModule.getFcmToken();
}

export function getSettings(): Promise<HarkAndroidSettings> {
  return nativeModule.getSettings();
}

export function setWatchedActivitiesEnabled(enabled: boolean): Promise<void> {
  return nativeModule.setWatchedActivitiesEnabled(enabled);
}

export function openNotificationSettings(): Promise<void> {
  return nativeModule.openNotificationSettings();
}

export function openPromotedNotificationSettings(): Promise<void> {
  return nativeModule.openPromotedNotificationSettings();
}
