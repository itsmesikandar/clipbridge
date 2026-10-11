/**
 * Platform-neutral app layer shared by the desktop and mobile apps.
 * Apps provide core ports (adapters) and render `AppController.snapshot`.
 */
export { AppController, type AppControllerDeps } from './app-controller';
export { CredentialStore, decodeEpochKeys, encodeEpochKeys } from './credential-store';
export { createSimpleStore, type SimpleStore } from './simple-store';
export type * from './view-types';
