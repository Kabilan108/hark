import { useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";

const lightColors = {
  paper: "#FAFAF9",
  surface: "#FFFFFF",
  ink: "#171713",
  muted: "#6B6A63",
  soft: "#A3A199",
  line: "#E7E5E0",
  lineStrong: "#D8D6CE",
  control: "#F2F1ED",
  pressed: "#F0EFEC",
  shadowBorder: "#0000001A",
  accent: "#035B49",
  accentPressed: "#02493B",
  accentSoft: "#E7F0ED",
  onAccent: "#FFFFFF",
  danger: "#C93B2C",
  warning: "#D48A16",
} as const;

export type ThemeColors = { [Key in keyof typeof lightColors]: string };

const darkColors: ThemeColors = {
  paper: "#111513",
  surface: "#1A201D",
  ink: "#F3F3EF",
  muted: "#B7B8B2",
  soft: "#858983",
  line: "#303732",
  lineStrong: "#414943",
  control: "#252C28",
  pressed: "#242B27",
  shadowBorder: "#FFFFFF1F",
  accent: "#65CDB1",
  accentPressed: "#86DDC4",
  accentSoft: "#193A31",
  onAccent: "#08251E",
  danger: "#FF8A7B",
  warning: "#F2B84B",
};

const lightTheme = {
  colors: lightColors as ThemeColors,
  isDark: false,
  statusBarStyle: "dark" as const,
};

const darkTheme = {
  colors: darkColors,
  isDark: true,
  statusBarStyle: "light" as const,
};

export function useAppTheme() {
  return useColorScheme() === "dark" ? darkTheme : lightTheme;
}

export function createThemedStyles<Styles extends StyleSheet.NamedStyles<Styles>>(
  factory: (colors: ThemeColors) => Styles,
) {
  return function useThemedStyles() {
    const theme = useAppTheme();
    const styles = useMemo(() => StyleSheet.create(factory(theme.colors)), [theme.colors]);
    return { ...theme, styles };
  };
}

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  mono: "Menlo",
} as const;

/** React Native letterSpacing is measured in points, so convert -2% per size. */
export const tightTracking = (fontSize: number) => fontSize * -0.02;
