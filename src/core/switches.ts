import type { AppSettings, Result } from './types';

/** The settings that turn each interface on or off. */
export type Switch = 'mcpEnabled' | 'attachedRestEnabled' | 'globalRestEnabled';

const OFF: Record<Switch, string> = {
  mcpEnabled: 'The MCP tools are turned off in the app settings',
  attachedRestEnabled: 'The REST endpoints in attached projects are turned off in the app settings',
  globalRestEnabled: 'The app-wide REST endpoints are turned off in the app settings',
};

/** Only an explicit `false` turns an interface off, so settings saved before a switch existed keep it on. */
export function isEnabled(settings: AppSettings, key: Switch): boolean {
  return settings[key] !== false;
}

/** The answer of a switched-off interface: the same for every issue and request, so it reveals nothing. */
export function disabled(key: Switch): Result {
  return { status: 403, body: { error: 'disabled', error_description: OFF[key] } };
}
