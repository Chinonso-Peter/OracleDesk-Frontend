"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { io } from "socket.io-client";
import { API_URL } from "@/lib/api/client";
import { createBatcher, type Batch } from "./batch";
import type { RealtimeEvent } from "./types";
import { parseReasoningPublished, parseTradeExecuted } from "@/lib/validation/events";
import { REALTIME_CHANNEL, REALTIME_LEADER_LOCK, runWhileLeader, type RelayMessage } from "./leader";

const RELAY_EVENTS = ["TRADE_EXECUTED", "REASONING_PUBLISHED"] as const;
type RelayEventName = (typeof RELAY_EVENTS)[number];

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
    // Every tab validates what it receives, whether from its own socket or relayed by the leader.
    const deliver = (name: RelayEventName, payload: unknown) => {
      if (name === "TRADE_EXECUTED") {
        const event = parseTradeExecuted(payload);
        if (event) batcher.push({ type: "TRADE_EXECUTED", payload: event, receivedAt: Date.now() });
        else console.debug("[realtime] dropped invalid TRADE_EXECUTED payload");
      } else {
        const event = parseReasoningPublished(payload);
        if (event) batcher.push({ type: "REASONING_PUBLISHED", payload: event, receivedAt: Date.now() });
        else console.debug("[realtime] dropped invalid REASONING_PUBLISHED payload");
      }
    };

    // One socket per origin: only the tab holding the leader lock connects and
    // relays to the others over BroadcastChannel. Without Web Locks or
    // BroadcastChannel every tab connects itself, as before.
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const channel = locks && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(REALTIME_CHANNEL) : null;
    let leaderStatus: SocketStatus = "unknown";
    const openSocket = () => {
      const socket = io(API_URL.replace(/\/api\/v1\/?$/, ""));
      const report = (next: SocketStatus) => {
        leaderStatus = next;
        setStatus(next);
        channel?.postMessage({ t: "status", status: next } satisfies RelayMessage);
      };
      socket.on("connect", () => report("connected"));
      socket.on("disconnect", () => report("reconnecting"));
      socket.on("connect_error", () => report("offline"));
      socket.io.on("reconnect_attempt", () => report("reconnecting"));
      for (const name of RELAY_EVENTS) {
        socket.on(name, (payload: unknown) => {
          deliver(name, payload);
          channel?.postMessage({ t: "event", name, payload } satisfies RelayMessage);
        });
      }
      return () => { socket.disconnect(); leaderStatus = "unknown"; };
    };

    let close: () => void;
    if (locks && channel) {
      let leading = false;
      channel.onmessage = (message: MessageEvent<RelayMessage>) => {
        const data = message.data;
        if (!data || typeof data !== "object") return;
        if (data.t === "hello" && leading) channel.postMessage({ t: "status", status: leaderStatus } satisfies RelayMessage);
        else if (data.t === "status" && !leading) setStatus(data.status);
        else if (data.t === "event" && !leading && RELAY_EVENTS.includes(data.name)) deliver(data.name, data.payload);
      };
      const stopLeading = runWhileLeader(REALTIME_LEADER_LOCK, () => {
        leading = true;
        const closeSocket = openSocket();
        return () => { leading = false; closeSocket(); };
      }, locks);
      channel.postMessage({ t: "hello" } satisfies RelayMessage);
      close = () => { stopLeading(); channel.close(); };
    } else {
      close = openSocket();
    }
    return () => { close(); stop(); batcher.dispose(); document.removeEventListener("visibilitychange", visibility); };
  }, [listeners]);
  return <Context.Provider value={listeners}><StatusContext.Provider value={status}><MotionConfig reducedMotion="user">{children}</MotionConfig></StatusContext.Provider></Context.Provider>;
}

export function useRealtimeStatus(): SocketStatus {
  return useContext(StatusContext);
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
