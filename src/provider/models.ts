import { CURSOR_PROVIDER_ID } from "../constants";
import type { CursorModel } from "../models";
import { estimateModelCost } from "./model-cost";

export const CURSOR_PLACEHOLDER_MODEL_ID = "cursor-login" as const;

export interface ProviderWithModels {
  models?: Record<string, unknown>;
}

let cachedProviderModels: Record<string, unknown> | null = null;

export function getProviderModelsForHook(): Record<string, unknown> {
  if (cachedProviderModels && Object.keys(cachedProviderModels).length > 0) {
    return cachedProviderModels;
  }
  return buildPlaceholderProviderModels();
}

export function hasDiscoveredProviderModels(): boolean {
  if (!cachedProviderModels) return false;
  const modelIDs = Object.keys(cachedProviderModels);
  return (
    modelIDs.length > 0 &&
    !(modelIDs.length === 1 && modelIDs[0] === CURSOR_PLACEHOLDER_MODEL_ID)
  );
}

export function setCachedProviderModels(
  models: Record<string, unknown> | null,
): void {
  cachedProviderModels =
    models && Object.keys(models).length > 0 ? models : null;
}

export function setProviderModels(
  provider: unknown,
  models: Record<string, unknown>,
): void {
  if (!provider || typeof provider !== "object") return;
  (provider as ProviderWithModels).models = models;
  setCachedProviderModels(models);
}

export function buildPlaceholderProviderModels(): Record<string, unknown> {
  return {
    [CURSOR_PLACEHOLDER_MODEL_ID]: {
      id: CURSOR_PLACEHOLDER_MODEL_ID,
      providerID: CURSOR_PROVIDER_ID,
      api: {
        id: CURSOR_PLACEHOLDER_MODEL_ID,
        url: "http://127.0.0.1/cursor-pending/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Sign in with Cursor",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 0, output: 0 },
      status: "active" as const,
      options: {},
      headers: {},
      release_date: "",
      variants: {},
    },
  };
}

export function buildCursorProviderModels(
  models: CursorModel[],
  port: number,
): Record<string, unknown> {
  return Object.fromEntries(
    models.map((model) => [
      model.id,
      {
        id: model.id,
        providerID: CURSOR_PROVIDER_ID,
        api: {
          id: model.id,
          url: `http://localhost:${port}/v1`,
          npm: "@ai-sdk/openai-compatible",
        },
        name: model.name,
        capabilities: {
          temperature: true,
          reasoning: model.reasoning,
          attachment: false,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: estimateModelCost(model.id),
        limit: {
          context: model.contextWindow,
          output: model.maxTokens,
        },
        status: "active" as const,
        options: {},
        headers: {},
        release_date: "",
        variants: {},
      },
    ]),
  );
}

export function buildDisabledProviderConfig(
  message: string,
): Record<string, unknown> {
  return {
    baseURL: "http://127.0.0.1/cursor-disabled/v1",
    apiKey: "cursor-disabled",
    async fetch() {
      return new Response(
        JSON.stringify({
          error: {
            message,
            type: "server_error",
            code: "cursor_model_discovery_failed",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  };
}

export function stripAuthorizationHeader(
  init?: RequestInit,
): RequestInit | undefined {
  if (!init?.headers) return init;

  if (init.headers instanceof Headers) {
    init.headers.delete("authorization");
    return init;
  }

  if (Array.isArray(init.headers)) {
    init.headers = init.headers.filter(
      ([key]) => key.toLowerCase() !== "authorization",
    );
    return init;
  }

  delete (init.headers as Record<string, string>)["authorization"];
  delete (init.headers as Record<string, string>)["Authorization"];
  return init;
}
