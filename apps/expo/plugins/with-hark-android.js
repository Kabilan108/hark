const { withAndroidManifest } = require("expo/config-plugins");

const HARK_SERVICE = "dev.kabilan.hark.android.HarkFirebaseMessagingService";
const EXPO_SERVICE = "expo.modules.notifications.service.ExpoFirebaseMessagingService";
const HARK_RECEIVER = "dev.kabilan.hark.android.HarkActionReceiver";

function addPermission(manifest, name) {
  manifest["uses-permission"] = manifest["uses-permission"] ?? [];
  if (!manifest["uses-permission"].some((item) => item.$?.["android:name"] === name)) {
    manifest["uses-permission"].push({ $: { "android:name": name } });
  }
}

module.exports = function withHarkAndroid(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    manifest.$ = manifest.$ ?? {};
    manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    addPermission(manifest, "android.permission.INTERNET");
    addPermission(manifest, "android.permission.ACCESS_NETWORK_STATE");
    addPermission(manifest, "android.permission.POST_NOTIFICATIONS");
    addPermission(manifest, "android.permission.POST_PROMOTED_NOTIFICATIONS");

    const application = manifest.application?.[0];
    if (!application) throw new Error("Android application manifest is missing");
    application.service = (application.service ?? []).filter(
      (service) => ![HARK_SERVICE, EXPO_SERVICE].includes(service.$?.["android:name"]),
    );
    application.service.push({
      $: {
        "android:name": EXPO_SERVICE,
        "tools:node": "remove",
      },
    });
    application.service.push({
      $: {
        "android:name": HARK_SERVICE,
        "android:exported": "false",
      },
      "intent-filter": [
        {
          $: { "android:priority": "100" },
          action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }],
        },
      ],
    });

    application.receiver = (application.receiver ?? []).filter(
      (receiver) => receiver.$?.["android:name"] !== HARK_RECEIVER,
    );
    application.receiver.push({
      $: {
        "android:name": HARK_RECEIVER,
        "android:enabled": "true",
        "android:exported": "false",
      },
    });
    return androidConfig;
  });
};
