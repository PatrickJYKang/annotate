"use client";

// ---------------------------------------------------------------------------
// SidecarContext — React context providing sidecar connection status.
//
// Polls /health on mount and every 30s. Components use `useSidecar()` to
// check connection state and available capabilities.
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { checkHealth, SIDECAR_BASE_URL, type HealthResponse } from "../clip/sidecarClient";

export interface SidecarState {
  connected: boolean;
  capabilities: string[];
  models: HealthResponse["models"] | null;
  baseUrl: string;
  retry: () => void;
}

const SidecarContext = createContext<SidecarState>({
  connected: false,
  capabilities: [],
  models: null,
  baseUrl: SIDECAR_BASE_URL,
  retry: () => {},
});

export function useSidecar(): SidecarState {
  return useContext(SidecarContext);
}

const POLL_INTERVAL = 30_000; // 30 seconds

export function SidecarProvider({ children, baseUrl }: { children: React.ReactNode; baseUrl?: string }) {
  const url = baseUrl || SIDECAR_BASE_URL;
  const [connected, setConnected] = useState(false);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [models, setModels] = useState<HealthResponse["models"] | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const health = await checkHealth(url);
    if (health) {
      setConnected(true);
      setCapabilities(health.capabilities);
      setModels(health.models);
    } else {
      setConnected(false);
      setCapabilities([]);
      setModels(null);
    }
  }, [url]);

  // Initial poll + interval
  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  // Re-poll when tab regains focus
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [poll]);

  const retry = useCallback(() => {
    poll();
  }, [poll]);

  return (
    <SidecarContext.Provider value={{ connected, capabilities, models, baseUrl: url, retry }}>
      {children}
    </SidecarContext.Provider>
  );
}
