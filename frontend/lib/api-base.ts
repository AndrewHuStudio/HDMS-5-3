type ApiService = "review" | "qa";

type RuntimeInfo = {
  isBrowser: boolean;
  hostname: string;
  origin: string;
  protocol: string;
};

type ResolveState = {
  value: string;
  resolvedAt: number;
  inFlight: Promise<string> | null;
};

type ServiceConfig = {
  configuredBase: string;
  fallbackPort: number;
  localPortCandidates: number[];
};

type ComputePreferredApiBaseArgs = {
  configuredBase: string;
  runtime: Pick<RuntimeInfo, "isBrowser" | "hostname" | "origin">;
  fallbackPort: number;
};

type BuildLocalProbeCandidatesArgs = {
  configuredBase: string;
  runtime: Pick<RuntimeInfo, "isBrowser" | "hostname" | "origin">;
  ports: number[];
};

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;

const REVIEW_BASE =
  process.env.NEXT_PUBLIC_HDMS_API_BASE || process.env.NEXT_PUBLIC_API_BASE || "";
const QA_BASE =
  process.env.NEXT_PUBLIC_HDMS_QA_BASE || process.env.NEXT_PUBLIC_HDMS_QA_API_BASE || "";

const parsePortCandidates = (value: string | undefined, fallback: number[]) => {
  if (!value) return fallback;
  const parsed = value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535);
  return parsed.length > 0 ? parsed : fallback;
};

const REVIEW_PORT_CANDIDATES = parsePortCandidates(
  process.env.NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES,
  [8003, 8023]
);
const QA_PORT_CANDIDATES = parsePortCandidates(
  process.env.NEXT_PUBLIC_HDMS_QA_PORT_CANDIDATES,
  [8000, 8022]
);

const serviceConfigs: Record<ApiService, ServiceConfig> = {
  review: {
    configuredBase: REVIEW_BASE,
    fallbackPort: 8003,
    localPortCandidates: REVIEW_PORT_CANDIDATES,
  },
  qa: {
    configuredBase: QA_BASE,
    fallbackPort: 8000,
    localPortCandidates: QA_PORT_CANDIDATES,
  },
};

export const normalizeApiBase = (value: string) => value.replace(/\/$/, "");

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

const isLoopbackBase = (base: string) => {
  const url = parseUrl(base);
  if (!url) return false;
  return isLoopbackHostname(url.hostname);
};

const getRuntimeInfo = (): RuntimeInfo => {
  if (typeof window === "undefined") {
    return {
      isBrowser: false,
      hostname: "",
      origin: "",
      protocol: "http:",
    };
  }
  return {
    isBrowser: true,
    hostname: window.location.hostname,
    origin: window.location.origin,
    protocol: window.location.protocol,
  };
};

export const computePreferredApiBase = ({
  configuredBase,
  runtime,
  fallbackPort,
}: ComputePreferredApiBaseArgs) => {
  const normalizedConfiguredBase = normalizeApiBase(configuredBase || "");

  if (!runtime.isBrowser) {
    return normalizedConfiguredBase || `http://localhost:${fallbackPort}`;
  }

  const onLocalHost = isLoopbackHostname(runtime.hostname);
  if (!onLocalHost) {
    if (normalizedConfiguredBase && !isLoopbackBase(normalizedConfiguredBase)) {
      return normalizedConfiguredBase;
    }
    return normalizeApiBase(runtime.origin);
  }

  return normalizedConfiguredBase || `http://localhost:${fallbackPort}`;
};

const unique = <T>(items: T[]) => [...new Set(items)];

const getPortFromBase = (base: string) => {
  const url = parseUrl(base);
  if (!url) return null;
  const parsed = Number(url.port || "");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const buildLocalProbeCandidates = ({
  configuredBase,
  runtime,
  ports,
}: BuildLocalProbeCandidatesArgs) => {
  if (!runtime.isBrowser || !isLoopbackHostname(runtime.hostname)) {
    return [];
  }

  const protocol = parseUrl(runtime.origin)?.protocol || "http:";
  const configured = normalizeApiBase(configuredBase || "");
  const configuredPort = getPortFromBase(configured);
  const probePorts = unique(
    [configuredPort, ...ports].filter((port): port is number => Number.isInteger(port))
  );
  const hosts = unique([runtime.hostname, "localhost", "127.0.0.1"]).filter((host) =>
    isLoopbackHostname(host)
  );

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate: string) => {
    const normalized = normalizeApiBase(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  if (configured && isLoopbackBase(configured)) {
    pushCandidate(configured);
  }

  const normalizedOrigin = normalizeApiBase(runtime.origin);
  if (normalizedOrigin) {
    pushCandidate(normalizedOrigin);
  }

  for (const host of hosts) {
    for (const port of probePorts) {
      pushCandidate(`${protocol}//${host}:${port}`);
    }
  }

  return candidates;
};

const probeCandidate = async (base: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

const resolveByProbe = async (candidates: string[]) => {
  if (candidates.length === 0) return null;
  const checks = await Promise.all(
    candidates.map((candidate) => probeCandidate(candidate, DEFAULT_PROBE_TIMEOUT_MS))
  );
  for (let i = 0; i < checks.length; i += 1) {
    if (checks[i]) return candidates[i];
  }
  return null;
};

const getInitialServiceBase = (service: ApiService) =>
  computePreferredApiBase({
    configuredBase: serviceConfigs[service].configuredBase,
    runtime: getRuntimeInfo(),
    fallbackPort: serviceConfigs[service].fallbackPort,
  });

export let API_BASE = getInitialServiceBase("review");
export let QA_API_BASE = getInitialServiceBase("qa");

const resolveStates: Record<ApiService, ResolveState> = {
  review: {
    value: API_BASE,
    resolvedAt: 0,
    inFlight: null,
  },
  qa: {
    value: QA_API_BASE,
    resolvedAt: 0,
    inFlight: null,
  },
};

const setResolvedBase = (service: ApiService, value: string) => {
  const normalized = normalizeApiBase(value);
  resolveStates[service].value = normalized;
  resolveStates[service].resolvedAt = Date.now();
  if (service === "review") {
    API_BASE = normalized;
  } else {
    QA_API_BASE = normalized;
  }
  return normalized;
};

export async function resolveApiBase(options?: {
  service?: ApiService;
  forceRefresh?: boolean;
}) {
  const service = options?.service ?? "review";
  const forceRefresh = options?.forceRefresh ?? false;
  const state = resolveStates[service];
  const config = serviceConfigs[service];
  const runtime = getRuntimeInfo();
  const preferred = computePreferredApiBase({
    configuredBase: config.configuredBase,
    runtime,
    fallbackPort: config.fallbackPort,
  });

  if (!runtime.isBrowser) {
    return setResolvedBase(service, preferred);
  }

  if (!isLoopbackHostname(runtime.hostname)) {
    return setResolvedBase(service, preferred);
  }

  if (config.configuredBase && !isLoopbackBase(config.configuredBase)) {
    return setResolvedBase(service, config.configuredBase);
  }

  if (!forceRefresh && Date.now() - state.resolvedAt < DEFAULT_CACHE_TTL_MS) {
    return state.value;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = (async () => {
    const candidates = buildLocalProbeCandidates({
      configuredBase: config.configuredBase,
      runtime,
      ports: config.localPortCandidates,
    });
    const healthy = await resolveByProbe(candidates);
    return setResolvedBase(service, healthy ?? preferred);
  })().finally(() => {
    state.inFlight = null;
  });

  return state.inFlight;
}

export const resolveQaApiBase = (forceRefresh = false) =>
  resolveApiBase({ service: "qa", forceRefresh });
