/**
 * Barrel exports for @keytap/popup.
 *
 * The popup UI is intentionally split into small files so that production
 * builds can tree-shake anything that isn't imported (notably the mock
 * backend and mock-accounts module).
 */

export { PopupApp } from "./PopupApp";
export { createMockBackend } from "./PopupMockBackend";
export type { PopupBackend } from "./PopupApp";
export * from "./types";
export { TopBar } from "./TopBar";
export { SearchBar } from "./SearchBar";
export { AccountRow } from "./AccountRow";
export { AccountList, originMatches } from "./AccountList";
export { StatusBar } from "./StatusBar";
export { AddAccountDialog } from "./AddAccountDialog";
export { ImportAccountsDialog } from "./ImportAccountsDialog";
export { SettingsDialog } from "./SettingsDialog";
