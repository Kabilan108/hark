import type { ConfigContext, ExpoConfig } from "expo/config";

function requireApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (!configured) {
    throw new Error("EXPO_PUBLIC_API_URL must be set when configuring the Android app");
  }
  const parsed = new URL(configured);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTPS origin without credentials or a path");
  }
  return parsed.origin;
}

const apiUrl = requireApiUrl();
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
if (!googleServicesFile && process.env.EXPO_PUBLIC_PREVIEW_MODE !== "1") {
  throw new Error(
    "GOOGLE_SERVICES_JSON must point to the Firebase Android client config for a normal build",
  );
}

const android: ExpoConfig["android"] = {
  package: "dev.kabilan.hark",
  versionCode: 3,
  icon: "./assets/icon.png",
  adaptiveIcon: {
    foregroundImage: "./assets/icon.png",
    backgroundColor: "#035B49",
  },
  permissions: ["POST_NOTIFICATIONS", "android.permission.POST_PROMOTED_NOTIFICATIONS"],
  ...(googleServicesFile ? { googleServicesFile } : {}),
};

export default ({ config: _config }: ConfigContext): ExpoConfig => ({
  name: "Hark",
  slug: "hark-android",
  version: "1.2.2",
  icon: "./assets/icon.png",
  scheme: "hark-android",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android,
  plugins: [
    "expo-system-ui",
    "expo-router",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        defaultChannel: "hark-events",
        sounds: [],
      },
    ],
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#035B49",
        image: "./assets/icon.png",
        imageWidth: 96,
        dark: { backgroundColor: "#111513" },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 37,
          minSdkVersion: 26,
        },
      },
    ],
    "./plugins/with-hark-android",
  ],
  extra: {
    apiUrl,
  },
});
