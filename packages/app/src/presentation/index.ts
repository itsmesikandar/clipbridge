/** User-facing texts and pure view models, shared by the desktop and mobile UIs. */
export { type DeviceRowModel, sortDevices, toDeviceRow } from './device-model';
export { toReport } from './diagnostics-report';
export { formatRelativeTime } from './format-time';
export { describeIssue, formatBytes, type IssueText } from './issue-text';
export {
  describeJoinState,
  formatCountdown,
  type HostingModel,
  PLATFORM_NAMES,
  svgToDataUrl,
  toHostingModel,
} from './pairing-model';
export { type BannerModel, toBannerModel, type Tone } from './status-model';
