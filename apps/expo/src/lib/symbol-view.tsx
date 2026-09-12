import {
  SymbolView as ExpoSymbolView,
  type SymbolViewProps as ExpoSymbolViewProps,
} from "expo-symbols";

type IOSSymbolName = Extract<ExpoSymbolViewProps["name"], string>;

const androidSymbols = {
  "app.fill": "apps",
  "arrow.turn.down.left": "keyboard_return",
  "arrow.up": "arrow_upward",
  "arrow.up.right": "open_in_new",
  "bell.fill": "notifications",
  checkmark: "check",
  "checkmark.circle": "check_circle",
  "chevron.down": "keyboard_arrow_down",
  "chevron.left": "keyboard_arrow_left",
  "chevron.right": "keyboard_arrow_right",
  "chevron.up": "keyboard_arrow_up",
  clock: "schedule",
  "envelope.badge": "mark_email_unread",
  "envelope.open": "drafts",
  "eye.fill": "visibility",
  "gearshape.fill": "settings",
  iphone: "smartphone",
  "person.fill": "person",
  "waveform.path.ecg": "monitoring",
} as const;

type Props = Omit<ExpoSymbolViewProps, "name"> & { name: IOSSymbolName };

/** Maps the app's SF Symbol names to Material Symbols used on Android. */
export function SymbolView({ name, weight, ...props }: Props) {
  const android = androidSymbols[name as keyof typeof androidSymbols] ?? "circle";
  const crossPlatformName = { android, ios: name, web: android } as ExpoSymbolViewProps["name"];

  return (
    <ExpoSymbolView
      {...props}
      name={crossPlatformName}
      weight={typeof weight === "string" ? undefined : weight}
    />
  );
}
