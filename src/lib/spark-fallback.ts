const FALLBACK_LOG_PREFIX = '[spark-fallback]';
const KV_STORE_KEY = 'spark-kv-fallback';
const MODE_STORAGE_KEY = 'spark-kv-mode';

type KvRecord = Record<string, unknown>;
type KvMode = 'local' | 'remote';

let memoryStore: KvRecord | null = null;
let mode: KvMode | null = null;
let fetchPatched = false;

const loadMode = (): KvMode => {
  if (mode) {
    return mode;
  }

  if (typeof window === 'undefined') {
    mode = 'local';
    return mode;
  }

  const stored = window.localStorage?.getItem(MODE_STORAGE_KEY);
  if (stored === 'remote' || stored === 'local') {
    mode = stored;
    return mode;
  }

  mode = 'local';
  return mode;
};

const persistMode = (value: KvMode) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem(MODE_STORAGE_KEY, value);
  } catch (error) {
    console.warn(`${FALLBACK_LOG_PREFIX} Failed to persist mode:`, error);
  }
};

const setMode = (value: KvMode) => {
  mode = value;
  persistMode(value);
  console.info(`${FALLBACK_LOG_PREFIX} KV mode set to ${value}`);
};

const shouldUseLocal = (): boolean => loadMode() === 'local';

const loadStore = (): KvRecord => {
  if (memoryStore) {
    return memoryStore;
  }

  memoryStore = {};

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage?.getItem(KV_STORE_KEY);
      if (raw) {
        memoryStore = JSON.parse(raw) as KvRecord;
      }
    } catch (error) {
      console.warn(`${FALLBACK_LOG_PREFIX} Failed to read localStorage:`, error);
    }
  }

  return memoryStore!;
};

const persistStore = () => {
  if (typeof window === 'undefined' || !memoryStore) {
    return;
  }

  try {
    window.localStorage?.setItem(KV_STORE_KEY, JSON.stringify(memoryStore));
  } catch (error) {
    console.warn(`${FALLBACK_LOG_PREFIX} Failed to persist localStorage:`, error);
  }
};

const fallbackKeys = async (): Promise<string[]> => {
  return Object.keys(loadStore());
};

const fallbackGet = async (key: string): Promise<unknown> => {
  const store = loadStore();
  return store[key];
};

const fallbackSet = async (key: string, value: unknown): Promise<void> => {
  const store = loadStore();
  store[key] = value;
  persistStore();
};

const fallbackDelete = async (key: string): Promise<void> => {
  const store = loadStore();
  if (key in store) {
    delete store[key];
    persistStore();
  }
};

const getUrlPathname = (rawUrl: string): string => {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.pathname;
  } catch {
    return rawUrl;
  }
};

const isKvRequest = (url: string): boolean => {
  const path = getUrlPathname(url);
  return path === '/_spark/kv' || path.startsWith('/_spark/kv/');
};

const extractKvKey = (url: string): string | null => {
  const path = getUrlPathname(url);
  if (!path.startsWith('/_spark/kv')) {
    return null;
  }
  const [, , ...rest] = path.split('/');
  if (rest.length === 0) {
    return '';
  }
  const encodedKey = rest.join('/');
  try {
    return decodeURIComponent(encodedKey);
  } catch {
    return encodedKey;
  }
};

const readRequestBody = async (input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> => {
  if (input instanceof Request) {
    const clone = input.clone();
    try {
      return await clone.text();
    } catch {
      return undefined;
    }
  }

  if (!init?.body) {
    return undefined;
  }

  if (typeof init.body === 'string') {
    return init.body;
  }

  if (init.body instanceof Blob) {
    return await init.body.text();
  }

  return undefined;
};

const handleLocalKvRequest = async (url: string, method: string, bodyText?: string): Promise<Response> => {
  const key = extractKvKey(url);

  switch (method) {
    case 'GET': {
      if (!key) {
        const keys = await fallbackKeys();
        return new Response(JSON.stringify(keys), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const value = await fallbackGet(key);
      if (typeof value === 'undefined') {
        return new Response('', { status: 404 });
      }

      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    case 'POST': {
      if (!key) {
        return new Response('Missing key', { status: 400 });
      }

      let parsed: unknown;
      if (bodyText && bodyText.length > 0) {
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }
      }

      await fallbackSet(key, parsed);
      return new Response(null, { status: 200 });
    }

    case 'DELETE': {
      if (!key) {
        return new Response(null, { status: 204 });
      }

      await fallbackDelete(key);
      return new Response(null, { status: 204 });
    }

    default:
      return new Response('Method not supported', { status: 405 });
  }
};

const installFetchInterceptor = () => {
  if (fetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (!isKvRequest(url) || !shouldUseLocal()) {
      return originalFetch(input, init);
    }

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const bodyText = await readRequestBody(input, init);

    return handleLocalKvRequest(url, method, bodyText);
  };

  fetchPatched = true;

  const controls = {
    useLocal: () => {
      setMode('local');
      installFetchInterceptor();
    },
    useRemote: () => {
      setMode('remote');
      if (typeof window !== 'undefined' && fetchPatched) {
        window.fetch = originalFetch;
        fetchPatched = false;
      }
    },
    mode: (): KvMode => loadMode(),
    clearStore: () => {
      memoryStore = {};
      persistStore();
    },
    originalFetch,
  };

  (window as any).sparkFallback = controls;
};

export interface SparkKv {
  keys: () => Promise<string[]>;
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export const fallbackKv: SparkKv = {
  keys: fallbackKeys,
  get: fallbackGet,
  set: fallbackSet,
  delete: fallbackDelete,
};

const logFallback = (operation: string) => {
  console.warn(`${FALLBACK_LOG_PREFIX} Using local fallback for ${operation}. Set GITHUB_TOKEN to enable Spark KV or call sparkFallback.useRemote().`);
};

export const installSparkFallbacks = () => {
  if (typeof window === 'undefined') {
    return;
  }

  installFetchInterceptor();

  const globalSpark = ((window as any).spark ??= {});
  const remoteKv: SparkKv | undefined = globalSpark.kv;

  globalSpark.kv = {
    async keys() {
      if (!remoteKv || shouldUseLocal()) {
        if (!remoteKv) {
          logFallback('keys');
        }
        return fallbackKeys();
      }

      return remoteKv.keys();
    },
    async get(key: string) {
      if (!remoteKv || shouldUseLocal()) {
        if (!remoteKv) {
          logFallback('get');
        }
        return fallbackGet(key);
      }

      return remoteKv.get(key);
    },
    async set(key: string, value: unknown) {
      if (!remoteKv || shouldUseLocal()) {
        if (!remoteKv) {
          logFallback('set');
        }
        await fallbackSet(key, value);
        return;
      }

      await remoteKv.set(key, value);
    },
    async delete(key: string) {
      if (!remoteKv || shouldUseLocal()) {
        if (!remoteKv) {
          logFallback('delete');
        }
        await fallbackDelete(key);
        return;
      }

      await remoteKv.delete(key);
    },
  };
};

export const getActiveSparkKv = (): SparkKv => {
  if (typeof window === 'undefined') {
    return fallbackKv;
  }

  const globalSpark = ((window as any).spark ??= {});
  return (globalSpark.kv as SparkKv) ?? fallbackKv;
};
