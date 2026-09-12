import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { configure, getFcmToken, getSettings } from "hark-android";
import { api } from "./api";
import { API_URL } from "./auth";
import { DEVICE_ID_KEY, FCM_TOKEN_KEY } from "./device-keys";

export { DEVICE_ID_KEY, FCM_TOKEN_KEY } from "./device-keys";

export interface DeviceRegistration {
  deviceId: string;
  fcmToken: string;
}

export async function registerCurrentDevice(): Promise<DeviceRegistration> {
  const [token, nativeSettings, previousToken, previousDeviceId] = await Promise.all([
    getFcmToken(),
    getSettings(),
    SecureStore.getItemAsync(FCM_TOKEN_KEY),
    SecureStore.getItemAsync(DEVICE_ID_KEY),
  ]);
  if (!token) throw new Error("Firebase has not issued a device token yet. Try again shortly.");

  const registered = await api.registerDevice({
    ...(previousDeviceId ? { deviceId: previousDeviceId } : {}),
    fcmToken: token,
    platform: "android",
    deviceName: Device.deviceName ?? undefined,
    notificationSchemaVersion: 1,
    interactionSchemaVersion: 1,
    liveActivitySchemaVersion: 1,
    liveActivityInteractionVersion: 1,
    promotedNotificationsCapable:
      nativeSettings.promotionSupported && nativeSettings.promotionEnabled,
  });

  await Promise.all([
    SecureStore.setItemAsync(FCM_TOKEN_KEY, token),
    SecureStore.setItemAsync(DEVICE_ID_KEY, registered.device.id),
    configure({ backendOrigin: API_URL, deviceId: registered.device.id }),
  ]);
  await api.markDeviceReady(registered.device.id);

  if (previousToken && previousToken !== token) {
    try {
      await api.unregisterDevice({ fcmToken: previousToken });
    } catch {
      // The current registration is authoritative. A stale token is harmless
      // because the native receiver accepts messages only for this device ID.
    }
  }

  return { deviceId: registered.device.id, fcmToken: token };
}

export async function reconcileDeviceRegistration(): Promise<DeviceRegistration | null> {
  const [storedToken, storedDeviceId] = await Promise.all([
    SecureStore.getItemAsync(FCM_TOKEN_KEY),
    SecureStore.getItemAsync(DEVICE_ID_KEY),
  ]);
  if (!storedToken || !storedDeviceId) return null;

  await configure({ backendOrigin: API_URL, deviceId: storedDeviceId });
  return registerCurrentDevice();
}
