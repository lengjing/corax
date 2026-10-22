import { describe, expect, it } from "vitest";

import { readDurableSession } from "#execution/durable-session-store.js";
import { migrateSessionCheckpoint } from "#execution/session/checkpoint-migrations.js";
import { SESSION_CHECKPOINT_VERSION } from "#execution/session/handoff.js";
import { createApprovalCandidate, getApprovalAuditState } from "#harness/hitl/candidates.js";
import { readHitlState } from "#harness/hitl/requests.js";
import { readTurnState } from "#harness/session-machine/state.js";

describe("migrateSessionCheckpoint", () => {
  it("upgrades a checkpoint written by a corax 0.66 owner to the current shape", () => {
    expect(migrateSessionCheckpoint(corax066Checkpoint())).toEqual({
      kind: "current",
      childRunIdsToStop: ["child-local"],
      checkpoint: {
        history: [
          { content: "Alice asks for a report.", kind: "user", role: "user" },
          { content: [{ text: "Started the report.", type: "text" }], role: "assistant" },
          { content: "The report is ready.", kind: "task.result", role: "user" },
        ],
        serializedContext: {
          "corax.auth": null,
          "corax.bundle": { source: { kind: "bundled" } },
          "corax.channel": { kind: "http", state: {} },
          "corax.legacyRemoteAgentCaller": { taskId: "caller-task" },
          "corax.sessionCallback": CALLBACK,
          "corax.sessionTitle": "Alice asks for a report.",
        },
        sessionState: {
          continuationToken: "",
          hasProxyInputRequests: false,
          sessionId: "session-1",
          snapshot: {
            session: {
              agent: { system: "Be helpful." },
              continuationToken: "",
              sandboxState: { session: null },
              sessionId: "session-1",
              state: {
                "corax.harness.requestEnvelopeTokens": 2483.5,
                "corax.harness.sessionProjection": {
                  started: true,
                  nextSequence: 1,
                  turns: {},
                  inputs: {},
                  calls: {},
                  tasks: {},
                  authorizations: {},
                  candidates: {},
                },
              },
            },
          },
          version: 2,
        },
        sessionTimeoutMs: false,
        version: SESSION_CHECKPOINT_VERSION,
      },
    });
  });

  it.each([
    [
      "a version 3 workflow tool run is unsettled",
      { settledTask: false },
      "workflow tool run registry version 3 holds unsettled runs",
    ],
    [
      "a subagent session is working",
      { subagentPhase: "running" },
      "a subagent session is still working",
    ],
  ])("keeps the session on its owner while %s", (_name, options, detail) => {
    expect(migrateSessionCheckpoint(corax066Checkpoint(options))).toEqual({
      kind: "incompatible",
      detail: `checkpoint version 8: ${detail}`,
    });
  });

  it("upgrades an idle v11 checkpoint without losing position, grants, or application state", () => {
    const result = migrateSessionCheckpoint(
      v11Checkpoint({
        "app.counter": 4,
        "corax.harness.emission": { sessionStarted: true, sequence: 3, stepIndex: 0, turnId: "" },
        "corax.runtime.hitl.approvedTools": ["deploy:api"],
      }),
    );
    expect(result).toMatchObject({
      kind: "current",
      checkpoint: {
        version: SESSION_CHECKPOINT_VERSION,
        history: [{ role: "user", kind: "user", content: "Alice asks for a report." }],
        sessionState: {
          version: 2,
          snapshot: {
            session: {
              state: {
                "app.counter": 4,
                "corax.harness.sessionProjection": {
                  started: true,
                  nextSequence: 3,
                  turns: {},
                  inputs: {},
                  calls: {},
                  tasks: {},
                  authorizations: {},
                  candidates: {},
                },
                "corax.harness.turnState": { grants: ["deploy:api"], suspended: [] },
              },
            },
          },
        },
      },
    });
    if (result.kind !== "current") throw new Error(result.detail);
    expect(result.checkpoint.sessionState).not.toHaveProperty("emissionState");
    expect(result.checkpoint.sessionState.snapshot.session.state).not.toHaveProperty(
      "corax.harness.emission",
    );
    expect(result.checkpoint.sessionState.snapshot.session.state).not.toHaveProperty(
      "corax.runtime.hitl.approvedTools",
    );
  });

  it.each([
    { "corax.runtime.pendingInputBatches": [{ requests: [] }] },
    { "corax.runtime.pendingAuthorization": { challenges: [{}] } },
    { "corax.runtime.pendingCoordinationBatch": { tasks: [] } },
    { "corax.runtime.deferredStepInput": { message: "Bob asks for a follow-up." } },
    { "corax.runtime.proxyInputRequests": { child: {} } },
    {
      "corax.harness.emission": { sessionStarted: true, sequence: 1, stepIndex: 0, turnId: "turn_1" },
    },
    { "corax.runtime.pendingInputBatches": "malformed" },
    { "corax.runtime.hitl.approvedTools": [7] },
    { "corax.runtime.hitl.approvalState": { activeCandidates: { alice: {} } } },
    {
      "corax.workflowTool": {
        version: 4,
        runs: [
          {
            callId: "call",
            toolName: "report",
            origin: { turnId: "turn_0", stepIndex: 0 },
            address: { runId: "run", hookToken: "hook" },
          },
        ],
      },
    },
  ])(
    "refuses v11 pending or malformed state without changing the owner's checkpoint (%j)",
    (state) => {
      const checkpoint = v11Checkpoint(state);
      const before = structuredClone(checkpoint);
      expect(migrateSessionCheckpoint(checkpoint)).toMatchObject({ kind: "incompatible" });
      expect(checkpoint).toEqual(before);
    },
  );

  it.each([7, SESSION_CHECKPOINT_VERSION + 1])("refuses checkpoint version %s", (version) => {
    expect(migrateSessionCheckpoint({ ...corax066Checkpoint(), version })).toMatchObject({
      kind: "incompatible",
    });
  });

  it.each([12, 13, 14])(
    "loads a saved version %s session's approvals, sign-ins and relays from the requests key",
    (version) => {
      const alice = { authenticator: "slack", principalId: "alice", principalType: "user" };
      const bob = { ...alice, principalId: "bob" };
      const settlement = {
        actor: alice,
        approver: { ...alice, attributes: {} },
        candidateId: "alice",
        outcome: "allowed",
        requestId: "deploy",
        settledAt: 300,
      };
      const candidateSignIn = {
        attemptId: "attempt-bob",
        candidateId: "bob",
        challenge: { instructions: "Sign in to GitHub." },
        hookUrl: "https://app.example/cb/bob",
        name: "github",
      };
      const bobCandidate = {
        authorizationChallenges: [candidateSignIn],
        candidateId: "bob",
        createdAt: 400,
        decision: "cancel",
        expiresAt: 900,
        requestId: "release",
        responder: { ...bob, attributes: { team: "infra" } },
        status: "authorization-required",
      };
      const signIn = {
        attemptId: "attempt-1",
        challenge: { instructions: "Sign in to Linear." },
        hookUrl: "https://app.example/cb/1",
        name: "linear",
        principal: { id: "alice", type: "user" },
      };
      const event = { sequence: 4, stepIndex: 0, turnId: "turn_1" };
      const relayed = {
        batch: { approvalRequestIds: ["child-approval"], requestIds: ["child-approval"] },
        childContinuationToken: "child-token",
        childSessionInbox: { sessionId: "child-session" },
        event,
        inputSource: "subagent:research",
        kind: "tool-approval",
        reply: { options: [{ id: "approve", label: "Approve" }] },
      };
      const asked = {
        childContinuationToken: "run-token",
        event,
        kind: "question",
        reply: { allowFreeform: true },
        runId: "run-1",
        workflowAsk: { control: "control-hook" },
      };
      const relays = {
        "child-approval": relayed,
        "run-question": asked,
        // A child request id shaped like a sign-in attempt stays a relay.
        "signin:attempt-1": { ...asked, runId: "run-2" },
      };
      const saved = JSON.stringify(
        savedCheckpoint(version, {
          "corax.harness.turnState": { grants: ["deploy:api"], suspended: [] },
          "corax.runtime.hitl.approvalState": {
            activeCandidates: { bob: bobCandidate },
            candidateHistory: [
              {
                candidateId: "alice",
                completedAt: 300,
                createdAt: 200,
                decision: "approve",
                requestId: "deploy",
                responder: alice,
                status: "allowed",
              },
            ],
            nextCandidateSequence: 2,
            settlements: { deploy: settlement },
          },
          "corax.runtime.pendingAuthorization": { challenges: [signIn] },
          "corax.runtime.proxyInputRequests": relays,
          "corax.unrelated": true,
        }),
      );

      const result = migrateSessionCheckpoint(JSON.parse(saved));
      if (result.kind !== "current") throw new Error(result.detail);
      const reloaded = JSON.parse(JSON.stringify(result.checkpoint));
      const { state } = readDurableSession(reloaded.sessionState);
      expect(Object.keys(state ?? {}).sort()).toEqual([
        "corax.harness.turnState",
        "corax.runtime.hitl.requests",
        "corax.unrelated",
      ]);
      const hitl = readHitlState(state);
      expect(readTurnState(state).grants).toEqual(["deploy:api"]);
      expect(hitl.signIns).toEqual([signIn]);
      expect(Object.fromEntries(hitl.relays)).toEqual(relays);
      const audit = getApprovalAuditState(state);
      expect(audit.activeCandidates).toEqual([bobCandidate]);
      expect(audit.candidateHistory.map((entry) => entry.candidateId)).toEqual(["alice"]);
      expect(audit.settlements).toEqual([settlement]);
      // Ids already issued stay taken: a responder reusing one gets a fresh one.
      const next = createApprovalCandidate({
        candidateIdPrefix: "alice",
        createdAt: 500,
        decision: "approve",
        expiresAt: 900,
        requestId: "release",
        responder: { ...alice, attributes: {} },
        state,
      });
      expect(getApprovalAuditState(next.state).activeCandidates.map((c) => c.candidateId)).toEqual([
        "bob",
        "alice.2",
      ]);
      // A current checkpoint loads unchanged.
      expect(migrateSessionCheckpoint(reloaded)).toEqual({ ...result, checkpoint: reloaded });
    },
  );
});

function savedCheckpoint(version: number, state: Record<string, unknown>) {
  return { ...v11Checkpoint(state), version };
}

function v11Checkpoint(state: Record<string, unknown>) {
  return {
    version: 11,
    serializedContext: {},
    history: [{ role: "user", kind: "user", content: "Alice asks for a report." }],
    sessionTimeoutMs: false,
    sessionState: {
      version: 2,
      sessionId: "session-1",
      continuationToken: "token",
      hasProxyInputRequests: false,
      emissionState: { sessionStarted: true, sequence: 3, stepIndex: 0, turnId: "" },
      snapshot: { session: { sessionId: "session-1", continuationToken: "token", state } },
    },
  };
}

const CALLBACK = {
  callId: "call-0",
  subagentName: "research",
  token: "callback-token",
  url: "https://caller.example/corax/v1/callback/callback-token",
};

/** Trimmed from a handoff checkpoint captured from a corax 0.66.1 owner. */
function corax066Checkpoint({
  settledTask = true,
  subagentPhase = "parked",
}: { readonly settledTask?: boolean; readonly subagentPhase?: string } = {}) {
  return {
    mode: "conversation",
    serializedContext: {
      "corax.auth": null,
      "corax.bundle": { source: { kind: "bundled" } },
      "corax.channel": { kind: "http", state: {} },
      "corax.mode": "conversation",
      "corax.runtime.taskDeliveryPolicy": "auto",
      "corax.sessionCallback": { ...CALLBACK, taskId: "caller-task" },
      "corax.sessionTitle": "Alice asks for a report.",
      "corax.turnTaskDelivery": "none",
    },
    sessionState: {
      continuationToken: "",
      emissionState: { sessionStarted: true, sequence: 1, stepIndex: 0, turnId: "" },
      hasProxyInputRequests: false,
      sessionId: "session-1",
      snapshot: {
        session: {
          agent: { system: "Be helpful." },
          continuationToken: "",
          history: [
            { content: "Alice asks for a report.", kind: "user", role: "user" },
            { content: [{ text: "Started the report.", type: "text" }], role: "assistant" },
            { content: "The report is ready.", kind: "execution.background_task", role: "user" },
          ],
          sandboxState: { session: null },
          sessionId: "session-1",
          state: {
            "corax.agent.handles": {
              handles: [
                {
                  address: {
                    continuationToken: "local-token",
                    kind: "agent/local",
                    sessionId: "child-local",
                  },
                  phase: subagentPhase,
                },
                {
                  address: {
                    kind: "agent/remote",
                    sessionId: "child-remote",
                    url: "https://remote.example",
                  },
                  phase: "available",
                },
              ],
            },
            "corax.harness.requestEnvelopeTokens": 2483.5,
            "corax.workflowTool": {
              runs: [
                {
                  address: { hookToken: "hook-1", runId: "run-1" },
                  callId: "call-1",
                  lifetime: "session",
                  origin: { stepIndex: 0, turnId: "turn_0" },
                  task: {
                    dispatchContext: { auth: { current: null, initiator: null } },
                    metadata: { kind: "tool", name: "report" },
                    outcome: settledTask
                      ? { lastOutput: { type: "result", value: "ready" }, status: "completed" }
                      : undefined,
                    taskId: "task-1",
                  },
                  toolName: "report",
                },
              ],
              version: 3,
            },
          },
          taskId: "task-0",
        },
      },
      version: 1,
    },
    sessionTimeoutMs: false,
    version: 8,
  };
}
