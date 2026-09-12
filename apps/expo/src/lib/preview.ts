/** Preview data is opt-in so Android emulators exercise the real backend by default. */
export const PREVIEW_MODE = __DEV__ && process.env.EXPO_PUBLIC_PREVIEW_MODE === "1";
