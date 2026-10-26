import type { AppSettings, Result } from './types';

/** The settings that turn each interface off. They're "Disable …" checkboxes, so an unticked or never-saved box is on. */
export type Switch = 'mcpDisabled' | 'attachedRestDisabled' | 'globalRestDisabled';

const OFF: Record<Switch, string> = {
  mcpDisabled: 'The MCP tools are disabled in the app settings',
  attachedRestDisabled: 'The REST endpoints in attached projects are disabled in the app settings',
  globalRestDisabled: 'The app-wide REST endpoints are disabled in the app settings',
};

/**
 * Only a ticked box turns an interface off. YouTrack's settings page shows a never-saved box unticked whatever its
 * default, so that's the state that has to mean on.
 */
export function isEnabled(settings: AppSettings, key: Switch): boolean {
  return settings[key] !== true;
}

/** The answer of a switched-off interface: the same for every issue and request, so it reveals nothing. */
export function disabled(key: Switch): Result {
  return { status: 403, body: { error: 'disabled', error_description: OFF[key] } };
}
