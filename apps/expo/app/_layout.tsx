import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState } from "react-native";
import { trackAppEvent } from "../src/lib/analytics";
import { useSession } from "../src/lib/auth";
import { reconcileDeviceRegistration } from "../src/lib/device";
import { flushInteractionResponses } from "../src/lib/interactions";
import { colors } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync();
export default function RootLayout() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    void trackAppEvent("app_open");
    void flushInteractionResponses();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushInteractionResponses();
        void trackAppEvent("app_open");
      }
    });
    const retryTimer = setInterval(() => void flushInteractionResponses(), 30_000);
    return () => {
      appState.remove();
      clearInterval(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    const reconcile = () => {
      void reconcileDeviceRegistration().catch((error) => {
        console.warn("Could not refresh Android device registration", error);
      });
    };
    reconcile();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => appState.remove();
  }, [session]);

  useEffect(() => {
    void trackAppEvent("screen_view", { path: pathname });
  }, [pathname]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
      }}
    />
  );
}
