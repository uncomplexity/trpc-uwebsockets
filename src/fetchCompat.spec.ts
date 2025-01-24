import { test, expect } from 'vitest';
import uWs from 'uWebSockets.js';

import { decorateHttpResponse, uWsToRequest } from './fetchCompat';

function createServer(opts: { maxBodySize: number | null }) {
  type Handler = (req: Request) => Promise<void>;

  let rejectHandler: null | ((err: any) => void) = null;
  let resolveHandler: null | (() => void) = null;
  let handle: Handler | null = null;

  const app = uWs.App();

  app.any('/*', async (res, req) => {
    const resDecorated = decorateHttpResponse(res);

    const request = uWsToRequest(req, resDecorated, opts);
    await handle!(request).then(resolveHandler).catch(rejectHandler);
    res.end();
  });

  let socket: uWs.us_listen_socket | false | null = null;

  app.listen('0.0.0.0', 0, (token) => {
    socket = token;
  });

  if (!socket) {
    throw new Error('could not make a socket');
  }

  const port = uWs.us_socket_local_port(socket);
  console.log('Listening to port ' + port);

  return {
    async close() {
      // donest need to be async, but for compat
      if (!socket) {
        throw new Error('could not close socket as socket is already closed');
      }
      uWs.us_listen_socket_close(socket);
      socket = null;
    },
    fetch: async (
      opts: RequestInit & {
        path?: string;
      },
      _handle: (request: Request) => Promise<void>
    ) => {
      handle = _handle;

      const promise = new Promise<void>((resolve, reject) => {
        resolveHandler = resolve;
        rejectHandler = reject;
      });

      await fetch(`http://localhost:${port}${opts.path ?? ''}`, {
        ...opts,
      });
      await promise;
    },
  };
}

test('basic GET', async () => {
  const server = createServer({ maxBodySize: null });
  await server.fetch({}, async (request) => {
    expect(request.method).toBe('GET');
  });
  await server.close();
});

test('basic POST', async () => {
  const server = createServer({ maxBodySize: null });

  await server.fetch(
    {
      method: 'POST',
    },
    async (request) => {
      expect(request.method).toBe('POST');
    }
  );

  await server.close();
});

test.skip('POST with body', async () => {
  const server = createServer({ maxBodySize: null });

  {
    // handles small text

    await server.fetch(
      {
        method: 'POST',
        body: JSON.stringify({ hello: 'world' }),
        headers: {
          'content-type': 'application/json',
        },
      },
      async (request) => {
        expect(request.method).toBe('POST');
        expect(await request.json()).toEqual({ hello: 'world' });
      }
    );
  }
  // {
  //   // handles a body that is long enough to come in multiple chunks

  //   const body = '0'.repeat(2 ** 17);
  //   const bodyLength = body.length;

  //   await server.fetch(
  //     {
  //       method: 'POST',
  //       body,
  //     },
  //     async (request) => {
  //       expect(request.method).toBe('POST');
  //       expect((await request.text()).length).toBe(bodyLength);
  //     }
  //   );
  // }

  await server.close();
});
