import { describeIssue, describeJoinState } from '@clipbridge/app/presentation';
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Label, styles, usePalette } from '@/components/ui';
import { useAppSnapshot, useContainer } from '@/state/app-context';

/** Scans the pairing QR code and joins the computer that shows it. */
export function ScanView(): ReactElement {
  const { controller } = useContainer();
  const { pairing } = useAppSnapshot();
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const scanned = useRef(false);

  useEffect(() => {
    if (pairing.paired) router.back();
  }, [pairing.paired]);

  const onScanned = ({ data }: BarcodeScanningResult): void => {
    if (scanned.current) return;
    scanned.current = true;
    setMessage(null);
    void controller.joinWithLink(data).then((result) => {
      if (result.ok) return;
      setMessage(
        result.issue
          ? `${describeIssue(result.issue).title}. ${describeIssue(result.issue).message}`
          : result.message,
      );
      scanned.current = false;
    });
  };

  if (!permission) return <View style={[styles.screen, { backgroundColor: palette.background }]} />;

  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.content, { backgroundColor: palette.background }]}>
        <Card title="Camera needed">
          <Label muted>
            ClipBridge uses the camera only to scan the pairing QR code on your computer.
          </Label>
          <Button title="Allow camera" onPress={() => void requestPermission()} />
        </Card>
      </View>
    );
  }

  const status = describeJoinState(pairing.joining.state, pairing.joining.error);
  const busy = ['connecting', 'verifying', 'awaiting-approval'].includes(pairing.joining.state);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <CameraView
        style={local.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : onScanned}
      />
      <View style={styles.content}>
        <Label muted>Point the camera at the QR code under “Add device” on your computer.</Label>
        {status && (
          <Label tone={pairing.joining.state === 'failed' ? 'error' : 'info'}>{status}</Label>
        )}
        {message && <Label tone="error">{message}</Label>}
        {busy && (
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              controller.cancelJoin();
            }}
          />
        )}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  camera: { width: '100%', aspectRatio: 1 },
});
