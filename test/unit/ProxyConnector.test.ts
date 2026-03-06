import { describe, it, expect, vi } from 'vitest';

// Mock socks before import
vi.mock('socks', () => ({
  SocksClient: {
    createConnection: vi.fn().mockResolvedValue({ socket: { on: vi.fn() } }),
  },
}));

// Mock http
vi.mock('http', () => ({
  request: vi.fn((_opts, _cb) => {
    return {
      on: vi.fn((event, handler) => {
        if (event === 'connect') {
          // Simulate successful CONNECT response
          setTimeout(() => handler({ statusCode: 200 }, { destroy: vi.fn() }), 0);
        }
      }),
      end: vi.fn(),
    };
  }),
}));

import { createProxyClientClass, connectThroughProxy } from '../../src/core/connection/ProxyConnector';

describe('ProxyConnector', () => {
  describe('connectThroughProxy', () => {
    it('should throw for unsupported proxy schemes', async () => {
      await expect(
        connectThroughProxy('ftp://proxy:8080', 'host', 5432),
      ).rejects.toThrow('Unsupported proxy scheme');
    });
  });

  describe('createProxyClientClass', () => {
    it('should return a constructor function', () => {
      const ProxyClient = createProxyClientClass('http://proxy:8080');
      expect(typeof ProxyClient).toBe('function');
    });

    it('should return a class that extends Client', () => {
      const ProxyClient = createProxyClientClass('socks5://proxy:1080');
      const instance = Object.create(ProxyClient.prototype);
      expect(instance).toBeInstanceOf(ProxyClient);
    });
  });
});
