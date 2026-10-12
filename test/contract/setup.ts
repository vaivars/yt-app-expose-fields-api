import { appSettings, cli } from './client.ts';
import { contractEnv as env } from './env.ts';

/** Uploads the freshly built dist/, attaches the app to the test project and resets its settings. */
export default async function setup(): Promise<void> {
  cli('app', 'upload', '--directory', 'dist');
  try {
    cli('app', 'attach', '--app', 'hidden-fields', '--project', env.project);
  } catch {
    // already attached
  }
  await appSettings(null);
}
