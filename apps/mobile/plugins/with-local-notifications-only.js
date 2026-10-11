/**
 * Expo config plugin: ClipBridge only shows local notifications and never uses
 * Apple Push Notification service (no cloud, docs/adr/0002-lan-only.md).
 * expo-notifications adds the `aps-environment` entitlement by default, which
 * needs the Push capability and breaks signing with a free Apple ID; remove it.
 *
 * Listed first in app.json so its mod runs last (Expo runs mods in reverse order).
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
};
