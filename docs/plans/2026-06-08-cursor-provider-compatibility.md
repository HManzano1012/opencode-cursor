# Cursor Provider Compatibility Plan

## Problem

In newer OpenCode versions, the Cursor provider now appears in the UI, but after signing in the model list does not populate. The provider continues to show only the placeholder item labeled `Sign in with Cursor`.

## Root Cause Hypothesis

The plugin currently warms an internal model cache after OAuth, but it does not update the concrete provider object passed through OpenCode's auth loader lifecycle. Newer OpenCode versions appear to depend on the authenticated provider instance being updated directly so the model picker can refresh from the provider state.

## Implementation Steps

1. Add a regression test that calls the Cursor auth loader with a provider object and verifies discovered models are written onto that provider after login.
2. Update the provider activation flow so it accepts the provider instance from `auth.loader`.
3. After model discovery and proxy startup, publish discovered models through `setProviderModels(provider, buildCursorProviderModels(models, port))`.
4. Keep the existing cache update as a fallback for the provider hook path.
5. Preserve the existing failure handling so discovery failures still stop the proxy, clear cached models, and return the disabled provider config.
6. Build and run the new regression test to verify the provider model list changes from the placeholder entry to discovered Cursor models.

## Validation

- Fresh OAuth login publishes real models onto the provider object.
- The placeholder is no longer the only visible model after successful login.
- Existing build output still succeeds.

## Files Expected To Change

- `src/plugin/cursor-auth-plugin.ts`
- `package.json`
- `tsconfig.json`
- `docs/architecture/how-it-works.md`
- `docs/plans/2026-06-08-cursor-provider-compatibility.md`
- `test/cursor-auth-plugin.test.ts`
