import type {
  Config,
  Hooks,
  Plugin,
  PluginInput,
  PluginModule,
  PluginOptions,
  ProviderHookContext,
} from "@opencode-ai/plugin";
import type { Auth, Model as ModelV2, Provider as ProviderV2 } from "@opencode-ai/sdk/v2";
import {
  generateCursorAuthParams,
  getTokenExpiry,
  loadStoredCursorCredentials,
  pollCursorAuth,
  refreshCursorToken,
} from "../auth";
import { CURSOR_PROVIDER_ID } from "../constants";
import {
  configurePluginLogger,
  errorDetails,
  logPluginError,
  logPluginWarn,
} from "../logger";
import { getCursorModels, type CursorModel } from "../models";
import {
  buildCursorProviderModels,
  buildDisabledProviderConfig,
  buildPlaceholderProviderModels,
  getProviderModelsForHook,
  hasDiscoveredProviderModels,
  setCachedProviderModels,
  setProviderModels,
} from "../provider/models";
import { startProxy, stopProxy } from "../proxy";

let lastModelDiscoveryError: string | null = null;
const PLUGIN_ID = "@hmanzano1012/opencode-cursor-oauth";

interface MutableConfig {
  provider?: Record<
    string,
    { name?: string; models?: Record<string, unknown> }
  >;
}

async function resolveAccessToken(
  input: PluginInput,
  getAuth: () => Promise<Auth>,
): Promise<string> {
  const auth = await getAuth();
  if (!auth || auth.type !== "oauth") {
    throw new Error("Cursor auth not configured");
  }

  if (!auth.access || auth.expires < Date.now()) {
    const refreshed = await refreshCursorToken(auth.refresh);
    await input.client.auth.set({
      path: { id: CURSOR_PROVIDER_ID },
      body: {
        type: "oauth",
        refresh: refreshed.refresh,
        access: refreshed.access,
        expires: refreshed.expires,
      },
    });
    return refreshed.access;
  }

  return auth.access;
}

async function activateCursorProvider(
  input: PluginInput,
  getAuth: () => Promise<Auth>,
  provider?: unknown,
): Promise<{
  baseURL: string;
  apiKey: string;
  models: Record<string, unknown>;
}> {
  const accessToken = await resolveAccessToken(input, getAuth);
  const models: CursorModel[] = await getCursorModels(accessToken);
  lastModelDiscoveryError = null;

  const port = await startProxy(async () => {
    return resolveAccessToken(input, getAuth);
  }, models);

  const providerModels = buildCursorProviderModels(models, port);
  setCachedProviderModels(providerModels);
  if (provider) {
    setProviderModels(provider, providerModels);
  }

  return {
    baseURL: `http://localhost:${port}/v1`,
    apiKey: "cursor-proxy",
    models: providerModels,
  };
}

async function warmCacheAfterOAuth(
  input: PluginInput,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  try {
    const getAuth = async (): Promise<Auth> => ({
      type: "oauth",
      access: accessToken,
      refresh: refreshToken,
      expires: getTokenExpiry(accessToken),
    });
    await activateCursorProvider(input, getAuth);
  } catch (error) {
    logPluginWarn("Cursor post-login model warmup failed", {
      stage: "oauth_callback_warmup",
      ...errorDetails(error),
    });
    setCachedProviderModels(null);
  }
}

export const server: Plugin = async (
  input: PluginInput,
  _options?: PluginOptions,
): Promise<Hooks> => {
  configurePluginLogger(input);

  const hooks = {
    async config(config: Config) {
      const mutableConfig = config as MutableConfig;
      mutableConfig.provider ??= {};
      const existing = mutableConfig.provider[CURSOR_PROVIDER_ID];
      let models = {
        ...buildPlaceholderProviderModels(),
        ...(existing?.models ?? {}),
      };

      const storedAuth = await loadStoredCursorCredentials();
      if (storedAuth) {
        try {
          const activated = await activateCursorProvider(input, async () => ({
            type: "oauth",
            access: storedAuth.access,
            refresh: storedAuth.refresh,
            expires: storedAuth.expires,
          }));
          models = activated.models;
        } catch (error) {
          logPluginWarn("Cursor config warmup failed", {
            stage: "config",
            providerID: CURSOR_PROVIDER_ID,
            ...errorDetails(error),
          });
        }
      }

      mutableConfig.provider[CURSOR_PROVIDER_ID] = {
        name: "Cursor",
        ...existing,
        models,
      };
    },

    provider: {
      id: CURSOR_PROVIDER_ID,
      async models(provider: ProviderV2, ctx: ProviderHookContext) {
        if (!hasDiscoveredProviderModels() && ctx.auth?.type === "oauth") {
          try {
            await activateCursorProvider(input, async () => ctx.auth!, provider);
          } catch (error) {
            logPluginWarn("Cursor provider model listing failed", {
              stage: "provider_models",
              providerID: CURSOR_PROVIDER_ID,
              ...errorDetails(error),
            });
            stopProxy();
            setCachedProviderModels(null);
            setProviderModels(provider, buildPlaceholderProviderModels());
          }
        }

        return getProviderModelsForHook() as Record<string, ModelV2>;
      },
    },

    auth: {
      provider: CURSOR_PROVIDER_ID,

      async loader(getAuth: () => Promise<Auth>, provider) {
        try {
          const auth = await getAuth();
          if (!auth || auth.type !== "oauth") return {};

          return await activateCursorProvider(input, getAuth, provider);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Cursor model discovery failed.";

          logPluginError("Cursor auth loader failed", {
            stage: "loader",
            providerID: CURSOR_PROVIDER_ID,
            ...errorDetails(error),
          });

          stopProxy();
          setCachedProviderModels(null);
          setProviderModels(provider, buildPlaceholderProviderModels());

          if (message !== lastModelDiscoveryError) {
            lastModelDiscoveryError = message;
            await showDiscoveryFailureToast(input, message);
          }

          return buildDisabledProviderConfig(message);
        }
      },

      methods: [
        {
          type: "oauth" as const,
          label: "Login with Cursor",
          async authorize() {
            const { verifier, uuid, loginUrl } =
              await generateCursorAuthParams();

            return {
              url: loginUrl,
              instructions:
                "Complete login in your browser. This window will close automatically.",
              method: "auto" as const,
              async callback() {
                const { accessToken, refreshToken } = await pollCursorAuth(
                  uuid,
                  verifier,
                );

                await warmCacheAfterOAuth(input, accessToken, refreshToken);

                return {
                  type: "success" as const,
                  refresh: refreshToken,
                  access: accessToken,
                  expires: getTokenExpiry(accessToken),
                };
              },
            };
          },
        },
      ],
    },

    async "chat.headers"(incoming, output) {
      if (incoming.model.providerID !== CURSOR_PROVIDER_ID) return;

      output.headers["x-session-id"] = incoming.sessionID;
      if (incoming.agent) {
        output.headers["x-opencode-agent"] = incoming.agent;
      }
    },
  } satisfies Hooks;

  return hooks;
};

export const CursorAuthPlugin = server;

export const CursorAuthPluginModule: PluginModule = {
  id: PLUGIN_ID,
  server,
};

async function showDiscoveryFailureToast(
  input: PluginInput,
  message: string,
): Promise<void> {
  try {
    await input.client.tui.showToast({
      body: {
        title: "Cursor plugin disabled",
        message,
        variant: "error",
        duration: 8_000,
      },
    });
  } catch (error) {
    logPluginWarn("Failed to display Cursor plugin toast", {
      title: "Cursor plugin disabled",
      message,
      ...errorDetails(error),
    });
  }
}

export default CursorAuthPluginModule;
