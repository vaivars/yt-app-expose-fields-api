import type { RestResponse } from '../adapters/rest';
import { describeApi } from '../core/openapi';
import { isEnabled } from '../core/switches';
import type { AppSettings } from '../core/types';
import { version } from '../manifest.json';

/** The parts of YouTrack's app-wide request context this endpoint uses. */
export interface MetaRequestContext {
  settings: AppSettings;
  response: RestResponse;
}

/**
 * GET /api/extensionEndpoints/hidden-fields/meta/openapi.json: the OpenAPI description of the switched-on REST
 * endpoints, for any signed-in user. The version is bundled from the manifest at build time.
 */
export const httpHandler = {
  endpoints: [
    {
      method: 'GET',
      path: 'openapi.json',
      scope: 'global',
      handle(ctx: MetaRequestContext): void {
        ctx.response.code = 200;
        ctx.response.json(
          describeApi(version, {
            attached: isEnabled(ctx.settings, 'attachedRestDisabled'),
            global: isEnabled(ctx.settings, 'globalRestDisabled'),
          }),
        );
      },
    },
  ],
};
