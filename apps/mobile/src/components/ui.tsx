/** Small, consistent building blocks for the mobile screens. */

import type { Tone } from '@clipbridge/app/presentation';
import type { ReactElement, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
  type ViewStyle,
} from 'react-native';

export interface Palette {
  readonly background: string;
  readonly card: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly tones: Record<Tone, string>;
}

const light: Palette = {
  background: '#f6f7f9',
  card: '#ffffff',
  text: '#1c1f24',
  muted: '#6b7280',
  border: '#e3e6ea',
  accent: '#208aef',
  tones: { ok: '#1f9d55', info: '#2563eb', warn: '#c27c0e', error: '#c62828' },
};

const dark: Palette = {
  ...light,
  background: '#15171b',
  card: '#1e2126',
  text: '#e8eaed',
  muted: '#9aa0a6',
  border: '#2d3138',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Card({
  title,
  children,
  right,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly right?: ReactNode;
}): ReactElement {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {(title ?? right) !== undefined && (
        <View style={styles.cardHeader}>
          {title && <Text style={[styles.cardTitle, { color: palette.text }]}>{title}</Text>}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Label({
  children,
  muted,
  tone,
  small,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
  readonly tone?: Tone;
  readonly small?: boolean;
}): ReactElement {
  const palette = usePalette();
  const color = tone ? palette.tones[tone] : muted ? palette.muted : palette.text;
  return <Text style={[styles.label, small && styles.small, { color }]}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  readonly title: string;
  readonly onPress: () => void;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  readonly disabled?: boolean;
  readonly style?: ViewStyle;
}): ReactElement {
  const palette = usePalette();
  const color = variant === 'danger' ? palette.tones.error : palette.accent;
  const filled = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: color,
          backgroundColor: filled ? color : 'transparent',
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { color: filled ? '#ffffff' : color }]}>{title}</Text>
    </Pressable>
  );
}

export function Banner({
  tone,
  title,
  message,
  children,
}: {
  readonly tone: Tone;
  readonly title: string;
  readonly message: string | null;
  readonly children?: ReactNode;
}): ReactElement {
  const palette = usePalette();
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.banner,
        { backgroundColor: palette.card, borderLeftColor: palette.tones[tone] },
      ]}
    >
      <Text style={[styles.bannerTitle, { color: palette.tones[tone] }]}>{title}</Text>
      {message && <Text style={[styles.label, { color: palette.text }]}>{message}</Text>}
      {children}
    </View>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: boolean;
  readonly onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Label>{label}</Label>
        <Label muted small>
          {hint}
        </Label>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

export function Dot({ tone }: { readonly tone: Tone }): ReactElement {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: tone === 'warn' ? palette.muted : palette.tones[tone] },
      ]}
    />
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 16 },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  banner: { borderRadius: 12, borderLeftWidth: 4, padding: 14, gap: 6 },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    letterSpacing: 2,
  },
});
