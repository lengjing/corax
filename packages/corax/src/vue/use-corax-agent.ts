import { shallowRef, computed, onScopeDispose, type ComputedRef } from "vue";
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
import type { CoraxAgentReducer } from "#client/reducer.js";
import type { ClientSession } from "#client/session.js";
import { conversationReducer } from "#client/conversation-reducer.js";
import type { ConversationState } from "#client/conversation-state.js";
import type { MessageStreamEvent } from "#protocol/message.js";
import type {
  CancelSessionResult,
  ClientAuth,
  HeadersValue,
  RespondTurnOptions,
  SendTurnOptions,
  ClientSessionState,
} from "#client/types.js";

export type { PrepareSend };

/**
 * Lifecycle phase of a `useCoraxAgent` session: `"ready"` (idle), `"resuming"`
 * (checking an attached session), `"submitted"` (request sent, awaiting first
 * event), `"streaming"` (events arriving), or `"error"`.
 */
export type UseCoraxAgentStatus = CoraxAgentStoreStatus;

/**
 * Point-in-time projected state for a corax agent session (`data`, `error`,
 * `events`, `session`, `status`).
 *
 * `useCoraxAgent` passes this shape to callbacks such as `onFinish`, but exposes
 * the same fields as individual reactive refs on its return value.
 */
export type UseCoraxAgentSnapshot<TData> = CoraxAgentStoreSnapshot<TData>;

/**
 * Reactive return value from `useCoraxAgent`.
 */
export interface UseCoraxAgentReturn<TData> {
  /** Request durable cancellation of the active turn while continuing to receive its events. */
  readonly cancel: () => Promise<CancelSessionResult>;
  /** Projected state: the reducer folds every stream event into this value. */
  readonly data: ComputedRef<TData>;
  /** Canonical session state, regardless of the chosen data reducer. */
  readonly conversation: ComputedRef<ConversationState>;
  /** Last transport-level error, or `undefined` when healthy. */
  readonly error: ComputedRef<Error | undefined>;
  /** Raw server events from this session (authoritative stream). */
  readonly events: ComputedRef<readonly MessageStreamEvent[]>;
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
  readonly session: ComputedRef<ClientSessionState | undefined>;
  /**
   * Lifecycle phase: `"ready"` (idle), `"resuming"` (checking an attached
   * session), `"submitted"` (request sent, awaiting first event), `"streaming"`
   * (events arriving), or `"error"`.
   */
  readonly status: ComputedRef<UseCoraxAgentStatus>;
}

/**
 * Configuration for creating or binding a Vue corax agent session.
 *
 * Session configuration is read once when the composable creates its internal
 * store; to change the host, reducer, or session, remount the component. For
 * credentials or headers that must change without remounting, pass function
 * values to `auth` or `headers`; the client resolves those before each request.
 *
 * Lifecycle callbacks (`onError`, `onEvent`, `onFinish`, `onSessionChange`,
 * `prepareSend`) are inherited from {@link CoraxAgentStoreCallbacks} and synced on
 * every render.
 */
export interface UseCoraxAgentOptions<TData> extends CoraxAgentStoreCallbacks<TData> {
  /**
   * Named agent mounted by a framework integration such as `withCorax({ agents })`.
   *
   * `agent: "support"` targets same-origin routes under
   * `/corax/support/v1/...`. Do not combine with `host`.
   */
  readonly agent?: string;
  /** Authentication configuration; a function value is resolved per request. */
  readonly auth?: ClientAuth;
  /** Custom headers; a function value is resolved per request. */
  readonly headers?: HeadersValue;
  /**
   * Base URL used for corax client requests. Do not combine with `agent`.
   *
   * By default, requests target same-origin corax routes such as `/corax/v1/...`.
   * Pass a same-origin prefix such as `/api` to use an app-owned proxy, or an
   * absolute origin to talk to a corax server directly.
   *
   * @default ""
   */
  readonly host?: string;
  /** Ordered prefix of the session stream used to rehydrate projected state. */
  readonly initialEvents?: readonly MessageStreamEvent[];
  /** Prior session cursor to resume from on mount. */
  readonly initialSession?: ClientSessionState;
  /**
   * Project submitted user messages before corax confirms them with a
   * `message.received` stream event.
   *
   * Optimistic events are reducer-facing projection events only. They are not
   * exposed through `events`, which remains the authoritative corax stream.
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
   * Projects stream events into `TData`.
   *
   * @default conversationReducer
   */
  readonly reducer?: CoraxAgentReducer<TData>;
  /** Replay the attached durable session after mount. Requires `initialSession` or `session`. */
  readonly resume?: boolean;
  /**
   * Externally owned {@link ClientSession} to bind instead of creating one.
   *
   * When set, `reset()` reuses this session rather than constructing a new one.
   */
  readonly session?: ClientSession;
}

export function useCoraxAgent(
  options?: UseCoraxAgentOptions<ConversationState>,
): UseCoraxAgentReturn<ConversationState>;

export function useCoraxAgent<TData>(
  options: UseCoraxAgentOptions<TData> & { readonly reducer: CoraxAgentReducer<TData> },
): UseCoraxAgentReturn<TData>;

/**
 * Vue composable that drives one corax session and projects its event stream into
 * reactive UI state.
 *
 * Without a `reducer`, events project into conversation state including message parts;
 * pass `reducer` to project into a custom `TData`.
 * Returns reactive refs (`data`, `error`, `events`, `session`, `status`) plus
 * `prewarm`, `send`, `respond`, `resume`, `cancel`, and `reset`. Configuration is read once on store creation;
 * remount to change it. On scope dispose, the in-flight request is detached and
 * the store unsubscribed.
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

  const snapshot = shallowRef<CoraxAgentStoreSnapshot<TData>>(store.snapshot);

  if ("window" in globalThis) {
    const unsubscribe = store.subscribe(() => {
      snapshot.value = store.snapshot;
    });
    attachCoraxAgentStore(store);
    if (options.resume) void store.resume();

    onScopeDispose(() => {
      unsubscribe();
      detachCoraxAgentStore(store);
    });
  }

  return {
    cancel: () => store.cancel(),
    data: computed(() => snapshot.value.data),
    conversation: computed(() => snapshot.value.conversation),
    error: computed(() => snapshot.value.error),
    events: computed(() => snapshot.value.events),
    prewarm: () => store.prewarm(),
    reset: () => store.reset(),
    respond: <TOutput = unknown>(
      inputResponses: Parameters<ClientSession["respond"]>[0],
      options?: RespondTurnOptions<TOutput>,
    ) => store.send({ ...options, inputResponses }),
    resume: () => store.resume(),
    send: <TOutput = unknown>(message: string | UserContent, options?: SendTurnOptions<TOutput>) =>
      store.send({ ...options, message }),
    session: computed(() => snapshot.value.session),
    status: computed(() => snapshot.value.status),
  };
}
