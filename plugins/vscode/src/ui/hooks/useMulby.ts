import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

const PLUGIN_ID = 'vscode';

export function useMulby() {
  const call = useCallback(async (method: string, ...args: any[]) => {
    try {
      if (!(window as any).mulby?.host) {
        throw new Error('Mulby host not available');
      }
      const result = await (window as any).mulby.host.call(PLUGIN_ID, method, ...args);
      return result?.data;
    } catch (err: any) {
      throw err;
    }
  }, []);

  const notification = useMemo(() => ({
    show: (message: string, type?: string) => {
      try {
        (window as any).mulby?.notification?.show(message, type);
      } catch {
        // fallback
      }
    },
  }), []);

  return { call, notification };
}

export function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, ''));

  useEffect(() => {
    const handler = () => setHash(window.location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  return hash;
}

export function parseHashParams(hash: string): { route: string; params: Record<string, string> } {
  const [rawRoute, query] = hash.split('?');
  // Mulby 注入的 route 经 getPanelRouteHash 处理后前导 `/`，例如 `/search?code=cursor`
  const route = (rawRoute || '').replace(/^\//, '');
  const params: Record<string, string> = {};
  if (query) {
    query.split('&').forEach((pair) => {
      const [key, value] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return { route, params };
}
