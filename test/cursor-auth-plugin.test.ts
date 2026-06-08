import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

const discoveredModels = [
  {
    id: "claude-4-sonnet",
    name: "Claude 4 Sonnet",
    reasoning: true,
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
];

const refreshCursorToken = mock(async () => {
  throw new Error("refresh should not run in this test");
});
const loadStoredCursorCredentials = mock(async () => undefined);
const getCursorModels = mock(async () => discoveredModels);
const startProxy = mock(async () => 43111);
const stopProxy = mock(() => {});
const showToast = mock(async () => {});

mock.module("../src/auth.ts", () => ({
  generateCursorAuthParams: mock(async () => ({
    verifier: "verifier",
    uuid: "uuid",
    loginUrl: "https://cursor.com/login",
  })),
  getTokenExpiry: () => Date.now() + 60_000,
  loadStoredCursorCredentials,
  pollCursorAuth: mock(async () => ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
  })),
  refreshCursorToken,
}));

mock.module("../src/models.ts", () => ({
  getCursorModels,
}));

mock.module("../src/proxy/index.ts", () => ({
  startProxy,
  stopProxy,
}));

mock.module("../src/proxy.ts", () => ({
  startProxy,
  stopProxy,
}));

const { server } = await import("../src/plugin/cursor-auth-plugin.ts");
const { setCachedProviderModels } = await import("../src/provider/models.ts");

function createPluginInput(): PluginInput {
  return {
    client: {
      auth: {
        set: mock(async () => ({})),
      },
      tui: {
        showToast,
      },
    },
    project: {} as PluginInput["project"],
    directory: "/tmp/project",
    worktree: "/tmp/project",
    experimental_workspace: {
      register: () => {},
    },
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
  } as PluginInput;
}

describe("Cursor auth loader", () => {
  beforeEach(() => {
    refreshCursorToken.mockClear();
    loadStoredCursorCredentials.mockClear();
    getCursorModels.mockClear();
    startProxy.mockClear();
    stopProxy.mockClear();
    showToast.mockClear();
    setCachedProviderModels(null);
  });

  test("publishes discovered models onto the provider after login", async () => {
    const hooks = await server(createPluginInput());
    const provider = {
      id: "cursor",
      name: "Cursor",
      source: "config",
      env: [],
      options: {},
      models: {},
    };

    const result = await hooks.auth!.loader!(
      async () => ({
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      }),
      provider as never,
    );

    expect(result).toMatchObject({
      baseURL: "http://localhost:43111/v1",
      apiKey: "cursor-proxy",
    });
    expect(Object.keys((result as { models: Record<string, unknown> }).models)).toEqual([
      "claude-4-sonnet",
    ]);
    expect(getCursorModels).toHaveBeenCalledWith("access-token");
    expect(startProxy).toHaveBeenCalledTimes(1);
    expect(Object.keys(provider.models)).toEqual(["claude-4-sonnet"]);
    expect(provider.models["claude-4-sonnet"]).toMatchObject({
      id: "claude-4-sonnet",
      providerID: "cursor",
      name: "Claude 4 Sonnet",
      api: {
        id: "claude-4-sonnet",
        url: "http://localhost:43111/v1",
        npm: "@ai-sdk/openai-compatible",
      },
    });
  });

  test("discovers models from provider hook when auth already exists", async () => {
    const hooks = await server(createPluginInput());
    const provider = {
      id: "cursor",
      name: "Cursor",
      source: "config",
      env: [],
      options: {},
      models: {},
    };

    const models = await hooks.provider!.models!(provider as never, {
      auth: {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
      },
    });

    expect(getCursorModels).toHaveBeenCalledWith("access-token");
    expect(startProxy).toHaveBeenCalledTimes(1);
    expect(Object.keys(models)).toEqual(["claude-4-sonnet"]);
    expect(Object.keys(provider.models)).toEqual(["claude-4-sonnet"]);
  });

  test("hydrates config models from stored Cursor auth", async () => {
    loadStoredCursorCredentials.mockResolvedValueOnce({
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
    });

    const hooks = await server(createPluginInput());
    const config = {
      provider: {
        cursor: {
          name: "Cursor",
        },
      },
    };

    await hooks.config!(config as never);

    expect(getCursorModels).toHaveBeenCalledWith("access-token");
    expect(startProxy).toHaveBeenCalledTimes(1);
    expect(Object.keys(config.provider.cursor.models)).toEqual([
      "claude-4-sonnet",
    ]);
  });
});
