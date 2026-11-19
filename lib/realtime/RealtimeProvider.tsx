"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { io } from "socket.io-client";
import { API_URL } from "@/lib/api/client";
import { createBatcher, type Batch } from "./batch";
import type { RealtimeEvent } from "./types";
import { isMarketPricePayload } from "./types";
import { marketPriceStore, type ProvisionalPrice } from "./market-price-store";
import { parseReasoningPublished, parseTradeExecuted } from "@/lib/validation/events";

type Listener = (batch: Batch<RealtimeEvent>) => void;
const Context = createContext<Set<Listener> | null>(null);

/** Honest socket state, surfaced so the navbar can stop guessing. */
export type SocketStatus = "connected" | "reconnecting" | "offline" | "unknown";
const StatusContext = createContext<SocketStatus>("unknown");

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [listeners] = useState(() => new Set<Listener>());
  const [status, setStatus] = useState<SocketStatus>("unknown");
  useEffect(() => {
    // One scheduler for both event kinds: mixed bursts also commit once per frame.
    const batcher = createBatcher<RealtimeEvent>();
    const stop = batcher.subscribe(batch => { for (const listener of listeners) listener(batch); });
    const visibility = () => batcher.setPaused(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    const socket = io(API_URL.replace(/\/api\/v1\/?$/, ""));
    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("reconnecting");
    const onConnectError = () => setStatus("offline");
    const onReconnectAttempt = () => setStatus("reconnecting");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.on("TRADE_EXECUTED", (payload: unknown) => {
      const event = parseTradeExecuted(payload);
      if (event) batcher.push({ type: "TRADE_EXECUTED", payload: event, receivedAt: Date.now() });
      else console.debug("[realtime] dropped invalid TRADE_EXECUTED payload");
    });
    socket.on("REASONING_PUBLISHED", (payload: unknown) => {
      const event = parseReasoningPublished(payload);
      if (event) batcher.push({ type: "REASONING_PUBLISHED", payload: event, receivedAt: Date.now() });
      else console.debug("[realtime] dropped invalid REASONING_PUBLISHED payload");
    });
    socket.on("MARKET_PRICE", (payload: unknown) => {
      if (isMarketPricePayload(payload)) {
        marketPriceStore.applyTick(payload);
      } else {
        console.debug("[realtime] dropped invalid MARKET_PRICE payload");
      }
    });
    return () => {
      socket.disconnect();
      stop();
      batcher.dispose();
      marketPriceStore.dispose();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [listeners]);
  return <Context.Provider value={listeners}><StatusContext.Provider value={status}><MotionConfig reducedMotion="user">{children}</MotionConfig></StatusContext.Provider></Context.Provider>;
}

export function useRealtimeStatus(): SocketStatus {
  return useContext(StatusContext);
}

export function useProvisionalPrice(onChainMarketId: string | null | undefined): ProvisionalPrice | null {
  const [provisional, setProvisional] = useState<ProvisionalPrice | null>(() => {
    return onChainMarketId ? marketPriceStore.getProvisionalPrice(onChainMarketId) ?? null : null;
  });

  useEffect(() => {
    if (!onChainMarketId) {
      setProvisional(null);
      return;
    }
    setProvisional(marketPriceStore.getProvisionalPrice(onChainMarketId) ?? null);
    const unsub = marketPriceStore.subscribePrice((updated) => {
      if (updated.onChainMarketId === onChainMarketId) {
        setProvisional(updated);
      }
    });
    return unsub;
  }, [onChainMarketId]);

  return provisional;
}

export function useRealtimeBatch(handler: Listener) {
  const listeners = useContext(Context);
  const onBatch = useEffectEvent(handler);
  useEffect(() => {
    if (!listeners) throw new Error("RealtimeProvider is missing");
    const listener: Listener = batch => onBatch(batch);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [listeners]);
}
