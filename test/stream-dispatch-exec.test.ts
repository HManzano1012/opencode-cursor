import { describe, expect, test } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AgentClientMessageSchema,
  AgentServerMessageSchema,
  ExecServerMessageSchema,
  InteractionUpdateSchema,
} from "../src/proto/agent_pb";
import { processServerMessage } from "../src/proxy/stream-dispatch";
import type { StreamState } from "../src/proxy/stream-state";

const UNKNOWN_EXEC_FIELD_NO = 24;

function emptyStreamState(): StreamState {
  return {
    toolCallIndex: 0,
    pendingExecs: [],
    outputTokens: 0,
    totalTokens: 0,
    checkpointSeen: false,
  };
}

function processExec(
  exec: ReturnType<typeof create<typeof ExecServerMessageSchema>>,
  frames: Uint8Array[],
) {
  const serverMessage = create(AgentServerMessageSchema, {
    message: { case: "execServerMessage", value: exec },
  });
  processServerMessage(
    serverMessage,
    new Map(),
    undefined,
    [],
    (data) => frames.push(data),
    emptyStreamState(),
    () => {},
    () => {
      throw new Error("unknown exec must not become an MCP tool call");
    },
    undefined,
    undefined,
    undefined,
    undefined,
  );
}

describe("unknown Cursor exec types", () => {
  test("acks proto-unknown exec and keeps the bridge open", () => {
    const exec = create(ExecServerMessageSchema, {
      id: 7,
      execId: "exec-unknown",
    });
    (exec as { $unknown?: Array<{ no: number; wireType: number; data: Uint8Array }> }).$unknown =
      [{ no: UNKNOWN_EXEC_FIELD_NO, wireType: 2, data: new Uint8Array([0x00]) }];

    const encoded = toBinary(AgentServerMessageSchema, create(AgentServerMessageSchema, {
      message: { case: "execServerMessage", value: exec },
    }));
    const decoded = fromBinary(AgentServerMessageSchema, encoded, {
      readUnknownFields: true,
    });
    const frames: Uint8Array[] = [];
    processServerMessage(
      decoded,
      new Map(),
      undefined,
      [],
      (data) => frames.push(data),
      emptyStreamState(),
      () => {},
      () => {
        throw new Error("unknown exec must not become an MCP tool call");
      },
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(frames.length).toBeGreaterThanOrEqual(2);
    const result = fromBinary(AgentClientMessageSchema, frames[0], {
      readUnknownFields: true,
    });
    expect(result.message.case).toBe("execClientMessage");
    const echoed = (
      result.message.value as { $unknown?: Array<{ no: number }> }
    ).$unknown;
    expect(echoed?.some((field) => field.no === UNKNOWN_EXEC_FIELD_NO)).toBe(true);

    const close = fromBinary(AgentClientMessageSchema, frames[1]);
    expect(close.message.case).toBe("execClientControlMessage");
    expect(close.message.value.message.case).toBe("streamClose");
  });

  test("still acks empty exec case with a stream close", () => {
    const frames: Uint8Array[] = [];
    processExec(create(ExecServerMessageSchema, { id: 3, execId: "empty" }), frames);
    expect(frames.length).toBe(1);
    const close = fromBinary(AgentClientMessageSchema, frames[0]);
    expect(close.message.case).toBe("execClientControlMessage");
    expect(close.message.value.message.case).toBe("streamClose");
  });
});

describe("unknown Cursor interaction updates", () => {
  test("ignores proto-unknown interactionUpdate and keeps the bridge open", () => {
    const update = create(InteractionUpdateSchema, {});
    (
      update as { $unknown?: Array<{ no: number; wireType: number; data: Uint8Array }> }
    ).$unknown = [{ no: 20, wireType: 2, data: new Uint8Array([0x00]) }];

    const encoded = toBinary(
      AgentServerMessageSchema,
      create(AgentServerMessageSchema, {
        message: { case: "interactionUpdate", value: update },
      }),
    );
    const decoded = fromBinary(AgentServerMessageSchema, encoded, {
      readUnknownFields: true,
    });
    const frames: Uint8Array[] = [];
    processServerMessage(
      decoded,
      new Map(),
      undefined,
      [],
      (data) => frames.push(data),
      emptyStreamState(),
      () => {
        throw new Error("unknown interactionUpdate must not emit text");
      },
      () => {
        throw new Error("unknown interactionUpdate must not become a tool call");
      },
    );

    expect(frames.length).toBe(0);
  });
});
