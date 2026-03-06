import * as net from 'net';
import * as http from 'http';
import { SocksClient, SocksProxy } from 'socks';
import { Client } from 'pg';

/**
 * Establishes a TCP socket through a proxy server.
 *
 * Supports:
 * - HTTP CONNECT proxy (`http://` or `https://` scheme)
 * - SOCKS4/5 proxy (`socks4://` or `socks5://` scheme)
 *
 * @param proxyUrl - Full proxy URL including scheme, e.g. `http://user:pass@proxy:8080`
 * @param targetHost - The target host to connect to through the proxy
 * @param targetPort - The target port to connect to through the proxy
 * @returns A connected TCP socket tunneled through the proxy
 */
export async function connectThroughProxy(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> {
  const url = new URL(proxyUrl);
  const scheme = url.protocol.replace(':', '').toLowerCase();

  if (scheme === 'http' || scheme === 'https') {
    return connectHttpProxy(url, targetHost, targetPort);
  }

  if (scheme === 'socks5' || scheme === 'socks4' || scheme === 'socks4a' || scheme === 'socks5h') {
    return connectSocksProxy(url, scheme, targetHost, targetPort);
  }

  throw new Error(`Unsupported proxy scheme: "${scheme}". Use http://, socks4://, or socks5://.`);
}

/**
 * Creates a pg.Client subclass that connects through a proxy.
 *
 * The returned class can be passed to `new Pool({ Client: ProxyClient })` so that
 * every pooled connection is tunneled through the proxy.
 *
 * @param proxyUrl - Full proxy URL including scheme
 * @returns A Client subclass with proxy-aware connect()
 */
export function createProxyClientClass(proxyUrl: string): typeof Client {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  const ProxyClientClass = class ProxyClient extends Client {
    /** @inheritdoc */
    connect(): Promise<Client>;
    connect(callback: ((err: Error) => void) | ((err: null, c: Client) => void)): void;
    connect(callback?: ((err: Error) => void) | ((err: null, c: Client) => void)): Promise<Client> | void {
      const doConnect = async (): Promise<Client> => {
        const stream = await connectThroughProxy(
          proxyUrl,
          (this as any).connectionParameters?.host ?? (this as any).host ?? 'localhost',
          (this as any).connectionParameters?.port ?? (this as any).port ?? 5432,
        );
        (this as any).connection?.stream?.destroy?.();
        (this as any).stream = stream;
        return super.connect();
      };

      if (callback) {
        doConnect().then(
          (client) => (callback as (err: null, c: Client) => void)(null, client),
          (err) => (callback as (err: Error) => void)(err instanceof Error ? err : new Error(String(err))),
        );
        return;
      }
      return doConnect();
    }
  };
  return ProxyClientClass;
}

/**
 * Establishes a TCP tunnel through an HTTP CONNECT proxy.
 */
function connectHttpProxy(
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const proxyPort = proxyUrl.port ? parseInt(proxyUrl.port, 10) : 8080;
    const headers: Record<string, string> = {
      Host: `${targetHost}:${targetPort}`,
    };

    // Basic auth from proxy URL credentials
    if (proxyUrl.username) {
      const auth = decodeURIComponent(proxyUrl.username) +
        (proxyUrl.password ? ':' + decodeURIComponent(proxyUrl.password) : '');
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(auth).toString('base64');
    }

    const req = http.request({
      method: 'CONNECT',
      host: proxyUrl.hostname,
      port: proxyPort,
      path: `${targetHost}:${targetPort}`,
      headers,
    });

    req.on('connect', (_res, socket) => {
      if (_res.statusCode === 200) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(new Error(`HTTP CONNECT proxy returned status ${_res.statusCode}`));
      }
    });

    req.on('error', (err) => {
      reject(new Error(`HTTP CONNECT proxy error: ${err.message}`));
    });

    req.end();
  });
}

/**
 * Establishes a TCP tunnel through a SOCKS proxy.
 */
async function connectSocksProxy(
  proxyUrl: URL,
  scheme: string,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> {
  const type: SocksProxy['type'] = scheme.startsWith('socks4') ? 4 : 5;
  const proxyPort = proxyUrl.port ? parseInt(proxyUrl.port, 10) : 1080;

  const proxy: SocksProxy = {
    host: proxyUrl.hostname,
    port: proxyPort,
    type,
  };

  if (proxyUrl.username) {
    proxy.userId = decodeURIComponent(proxyUrl.username);
    if (proxyUrl.password) {
      proxy.password = decodeURIComponent(proxyUrl.password);
    }
  }

  const { socket } = await SocksClient.createConnection({
    proxy,
    command: 'connect',
    destination: {
      host: targetHost,
      port: targetPort,
    },
  });

  return socket;
}
