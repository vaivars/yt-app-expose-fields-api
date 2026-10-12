import type { HttpResponseLike } from '../../../src/core/types';

export interface RecordedCall {
  url: string;
  sslKeyName: string | null | undefined;
  timeout: number | undefined;
  token?: string;
  headers: [string, string][];
  method?: string;
  uri?: string;
  queryParams?: Record<string, string>;
  payload?: string;
}

type Responder = (method: string, uri: string, payload?: string) => HttpResponseLike;
const emptyList: Responder = () => ({ code: 200, response: '[]' });

/** Records every Connection the code under test opens and answers each request through `respond`. */
export const httpFake = {
  calls: [] as RecordedCall[],
  respond: emptyList,
  reset(): void {
    this.calls = [];
    this.respond = emptyList;
  },
};

export class Connection {
  private readonly record: RecordedCall;

  constructor(url: string, sslKeyName?: string | null, timeout?: number) {
    this.record = { url, sslKeyName, timeout, headers: [] };
    httpFake.calls.push(this.record);
  }

  bearerAuth(token: string): this {
    this.record.token = token;
    return this;
  }

  addHeader(name: string, value: string): this {
    this.record.headers.push([name, value]);
    return this;
  }

  getSync(uri: string, queryParams: Record<string, string>): HttpResponseLike {
    Object.assign(this.record, { method: 'GET', uri, queryParams });
    return httpFake.respond('GET', uri);
  }

  postSync(uri: string, queryParams: Record<string, string>, payload: string): HttpResponseLike {
    Object.assign(this.record, { method: 'POST', uri, queryParams, payload });
    return httpFake.respond('POST', uri, payload);
  }
}
