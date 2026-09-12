import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  store: new Map<string, string>(),
  token: "fcm-current" as string | null,
  settings: {
    notificationsEnabled: true,
    promotionEnabled: true,
    promotionSupported: true,
    watchedActivitiesEnabled: true,
  },
  registrations: [] as Array<Record<string, unknown>>,
  unregisters: [] as string[],
  readyDevices: [] as string[],
  configurations: [] as Array<{ backendOrigin: string; deviceId: string | null }>,
}));

vi.mock("expo-device", () => ({ deviceName: "Pixel test" }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.store.set(key, value);
  },
}));
vi.mock("hark-android", () => ({
  getFcmToken: async () => state.token,
  getSettings: async () => state.settings,
  configure: async (input: { backendOrigin: string; deviceId: string | null }) => {
    state.configurations.push(input);
  },
}));
vi.mock("./auth", () => ({ API_URL: "https://hark.example.test" }));
vi.mock("./api", () => ({
  api: {
    registerDevice: async (input: Record<string, unknown>) => {
      state.registrations.push(input);
      return { device: { id: "device-current" } };
    },
    unregisterDevice: async ({ fcmToken }: { fcmToken: string }) => {
      state.unregisters.push(fcmToken);
      return { ok: true };
    },
    markDeviceReady: async (deviceId: string) => {
      state.readyDevices.push(deviceId);
      return { ok: true };
    },
  },
}));

import {
  DEVICE_ID_KEY,
  FCM_TOKEN_KEY,
  reconcileDeviceRegistration,
  registerCurrentDevice,
} from "./device";

afterEach(() => {
  state.store.clear();
  state.token = "fcm-current";
  state.registrations.length = 0;
  state.unregisters.length = 0;
  state.readyDevices.length = 0;
  state.configurations.length = 0;
});

describe("Android device registration", () => {
  it("reports native notification capabilities and retires a rotated token", async () => {
    state.store.set(FCM_TOKEN_KEY, "fcm-previous");

    await registerCurrentDevice();

    expect(state.registrations).toEqual([
      {
        fcmToken: "fcm-current",
        platform: "android",
        deviceName: "Pixel test",
        notificationSchemaVersion: 1,
        interactionSchemaVersion: 1,
        liveActivitySchemaVersion: 1,
        liveActivityInteractionVersion: 1,
        promotedNotificationsCapable: true,
      },
    ]);
    expect(state.store.get(FCM_TOKEN_KEY)).toBe("fcm-current");
    expect(state.store.get(DEVICE_ID_KEY)).toBe("device-current");
    expect(state.readyDevices).toEqual(["device-current"]);
    expect(state.unregisters).toEqual(["fcm-previous"]);
    expect(state.configurations).toContainEqual({
      backendOrigin: "https://hark.example.test",
      deviceId: "device-current",
    });
  });

  it("does not enroll a device before onboarding has stored a registration", async () => {
    await expect(reconcileDeviceRegistration()).resolves.toBeNull();
    expect(state.registrations).toHaveLength(0);
  });

  it("refreshes an existing registration and native receiver configuration", async () => {
    state.store.set(FCM_TOKEN_KEY, "fcm-current");
    state.store.set(DEVICE_ID_KEY, "device-previous");

    await reconcileDeviceRegistration();

    expect(state.registrations).toHaveLength(1);
    expect(state.registrations[0]).toMatchObject({ deviceId: "device-previous" });
    expect(state.configurations[0]).toEqual({
      backendOrigin: "https://hark.example.test",
      deviceId: "device-previous",
    });
  });
});
