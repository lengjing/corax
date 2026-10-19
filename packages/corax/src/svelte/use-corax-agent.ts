import { onMount } from "svelte";
import { createSubscriber } from "svelte/reactivity";
import type { UserContent } from "ai";

import {
  attachCoraxAgentStore,
  detachCoraxAgentStore,
  CoraxAgentStore,
  type CoraxAgentStoreCallbacks,
  type CoraxAgentStoreSnapshot,
  type CoraxAgentStoreStatus,
  type PrepareSend,
} from "#client/corax-agent-store.js";
import { resolveCoraxAgentHost } from "#client/agent-host.js";
import { conversationReducer } from "#client/conversation-reducer.js";
import type { ConversationState } from "#client/conversation-state.js";
import type { CoraxAgentReducer } from "#client/reducer.js";
import type { ClientSession } from "#client/session.js";
import type {
  CancelSessionResult,
  ClientAuth,
  HeadersValue,
  RespondTurnOptions,
  SendTurnOptions,
  ClientSessionState,
} from "#client/types.js";
import type { MessageStreamEvent } from "#protocol/message.js";

export type { PrepareSend };

/**
 * Session lifecycle phase: `"ready"` (idle), `"resuming"` (checking an
 * attached session), `"submitted"` (request sent, awaiting the first stream
 * event), `"streaming"` (events arriving), or `"error"`.
 */
export type UseCoraxAgentStatus = CoraxAgentStoreStatus;

/**
 * Immutable point-in-time view of an corax agent session: projected `data`, the
 * last `error`, the raw `events` stream, the `session` cursor, and `status`.
 * `useCoraxAgent` passes this snapshot to the `onFinish` callback.
 */
export type UseCoraxAgentSnapshot<TData> = CoraxAgentStoreSnapshot<TData>;

/**
 * Reactive return value from `useCoraxAgent`.
 *
 * The state properties are Svelte 5 rune-friendly getters. Read them from a
 * template, `$derived`, or `$effect` and Svelte will update when corax streams
 * new events.
 */
export interface UseCoraxAgentReturn<TData> {
  /** Request durable cancellation of the active turn while continuing to receive its events. */
  readonly cancel: () => Promise<CancelSessionResult>;
  /** Projected state built by reducing every stream event through the reducer. */
  readonly data: TData;
  /** Canonical session state, regardless of the chosen data reducer. */
  readonly conversation: ConversationState;
  /** Last transport-level error, or `undefined` when healthy. */
  readonly error: Error | undefined;
  /** Raw server events received during this session (authoritative stream). */
  readonly events: readonly MessageStreamEvent[];
  /** Replay the attached durable session and follow its in-flight turn, if any. */
  readonly resume: () => Promise<void>;
  /** Create the session without starting its first turn. */
  readonly prewarm: () => Promise<void>;
  /** Clear all state and start a new session. */
  readonly reset: () => void;
  /** Send a message with optional turn settings. */
  readonly send: <TOutput = unknown>(
    message: string | UserContent,
    options?: SendTurnOptions<TOutput>,
  ) => Promise<void>;
  /** Answer pending HITL input requests. */
  readonly respond: <TOutput = unknown>(
    inputResponses: Parameters<ClientSession["respond"]>[0],
    options?: RespondTurnOptions<TOutput>,
  ) => Promise<void>;
  /** Current session identity and stream cursor. */
  readonly session: ClientSessionState | undefined;
  /**
   * Lifecycle phase: `"ready"` (idle), `"resuming"` (checking an attached
   * session), `"submitted"` (request sent, awaiting first event), `"streaming"`
   * (events arriving), or `"error"`.
   */
  readonly status: UseCoraxAgentStatus;
}

/**
 * Configuration for a Svelte corax agent session.
 *
 * Read once when `useCoraxAgent` creates its store; create a new binding to
 * change host, reducer, or session. To rotate credentials or headers without
 * recreating the binding, pass function values to `auth` or `headers`, which
 * the client resolves before each HTTP request.
 */
export interface UseCoraxAgentOptions<TData> extends CoraxAgentStoreCallbacks<TData> {
  /**
   * Named agent mounted by a framework integration such as `withCorax({ agents })`.
   *
   * `agent: "support"` targets same-origin routes under
   * `/corax/support/v1/...`. Do not combine with `host`.
   */
  readonly agent?: string;
  /**
   * Credentials for the auto-created session. Pass function values to refresh
   * per request. Ignored when `session` is supplied.
   */
  readonly auth?: ClientAuth;
  /**
   * Custom headers for the auto-created session. Pass a function to resolve
   * fresh values per request. Ignored when `session` is supplied.
   */
  readonly headers?: HeadersValue;
  /**
   * Base URL for corax client requests. Do not combine with `agent`. Empty targets same-origin corax routes
   * such as `/corax/v1/...`; a same-origin prefix like `/api` routes through an
   * app-owned proxy; an absolute origin hits an corax server directly.
   *
   * @default ""
   */
  readonly host?: string;
  /** Ordered prefix of the session stream used to rehydrate projected state. */
  readonly initialEvents?: readonly MessageStreamEvent[];
  /** Seed session identity and stream cursor for resuming a prior conversation. */
  readonly initialSession?: ClientSessionState;
  /**
   * Project submitted user messages before corax confirms them with a
   * `message.received` stream event. Optimistic events are reducer-facing
   * projection only and never appear in `events`, which stays the
   * authoritative corax stream.
   *
   * @default true
   */
  readonly optimistic?: boolean;
  /** Follow each subagent call's session into `conversation.agents` while mounted. @default false */
  readonly followSubagents?: boolean;
  /**
   * Keep the session stream open between turns to show events that arrive from schedules,
   * channels, or other clients. Set to false to close it once the session is idle and reopen it
   * on the next send, answer, or resume. @default true
   */
  readonly followIdle?: boolean;
  /** Prewarm an owned session on mount and after reset. @default false */
  readonly prewarm?: boolean;
  /**
   * Projects stream events into `TData`. Defaults to the conversation reducer.
   */
  readonly reducer?: CoraxAgentReducer<TData>;
  /** Replay the attached durable session after mount. Requires `initialSession` or `session`. */
  readonly resume?: boolean;
  /**
   * Pre-built client session to bind to. When omitted, the binding creates its
   * own session from `auth`, `headers`, and `host`.
   */
  readonly session?: ClientSession;
}

class SvelteCoraxAgent<TData> implements UseCoraxAgentReturn<TData> {
  #snapshot: CoraxAgentStoreSnapshot<TData>;
  readonly #store: CoraxAgentStore<TData>;
  readonly #subscribe: () => void;

  constructor(store: CoraxAgentStore<TData>) {
    this.#store = store;
    this.#snapshot = store.snapshot;
    this.#subscribe = createSubscriber((update) => {
      if (!("window" in globalThis)) return;

      const unsubscribe = store.subscribe(() => {
        this.#snapshot = store.snapshot;
        update();
      });

      return () => {
        unsubscribe();
      };
    });
  }

  get data(): TData {
    this.#subscribe();
    return this.#snapshot.data;
  }

  get conversation(): ConversationState {
    this.#subscribe();
    return this.#snapshot.conversation;
  }

  get error(): Error | undefined {
    this.#subscribe();
    return this.#snapshot.error;
  }

  get events(): readonly MessageStreamEvent[] {
    this.#subscribe();
    return this.#snapshot.events;
  }

  get session(): ClientSessionState | undefined {
    this.#subscribe();
    return this.#snapshot.session;
  }

  get status(): UseCoraxAgentStatus {
    this.#subscribe();
    return this.#snapshot.status;
  }

  cancel = (): Promise<CancelSessionResult> => {
    return this.#store.cancel();
  };

  reset = (): void => {
    this.#store.reset();
  };

  prewarm = (): Promise<void> => {
    return this.#store.prewarm();
  };

  resume = (): Promise<void> => {
    return this.#store.resume();
  };

  respond = <TOutput = unknown>(
    inputResponses: Parameters<ClientSession["respond"]>[0],
    options?: RespondTurnOptions<TOutput>,
  ): Promise<void> => {
    return this.#store.send({ ...options, inputResponses });
  };

  send = <TOutput = unknown>(
    message: string | UserContent,
    options?: SendTurnOptions<TOutput>,
  ): Promise<void> => {
    return this.#store.send({ ...options, message });
  };
}

export function useCoraxAgent(
  options?: UseCoraxAgentOptions<ConversationState>,
): UseCoraxAgentReturn<ConversationState>;

export function useCoraxAgent<TData>(
  options: UseCoraxAgentOptions<TData> & { readonly reducer: CoraxAgentReducer<TData> },
): UseCoraxAgentReturn<TData>;

/**
 * Svelte 5 binding that drives an corax session and projects its events into
 * rune-friendly reactive data.
 *
 * Without a `reducer`, projects conversation state including message parts;
 * pass a `reducer` for a different `TData`.
 * Configuration is read once; create a new binding to change host, reducer,
 * or session.
 */
export function useCoraxAgent<TData>(
  options: UseCoraxAgentOptions<TData> = {},
): UseCoraxAgentReturn<TData> {
  if (options.resume && options.initialSession === undefined && options.session === undefined) {
    throw new Error("useCoraxAgent({ resume: true }) requires initialSession or session.");
  }
  const reducer = options.reducer ?? (conversationReducer as CoraxAgentReducer<TData>);
  const store = new CoraxAgentStore<TData>({
    auth: options.auth,
    headers: options.headers,
    host: resolveCoraxAgentHost({ agent: options.agent, host: options.host }),
    initialEvents: options.initialEvents,
    initialSession: options.initialSession,
    optimistic: options.optimistic,
    followSubagents: options.followSubagents,
    followIdle: options.followIdle,
    prewarm: options.prewarm,
    reducer,
    session: options.session,
  });

  store.setCallbacks({
    onError: options.onError,
    onEvent: options.onEvent,
    onFinish: options.onFinish,
    onSessionChange: options.onSessionChange,
    prepareSend: options.prepareSend,
  });
  if ("window" in globalThis)
    onMount(() => {
      attachCoraxAgentStore(store);
      if (options.resume) void store.resume();
      return () => detachCoraxAgentStore(store);
    });

  return new SvelteCoraxAgent(store);
}
