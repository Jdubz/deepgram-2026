/**
 * Provider Factory
 *
 * Provides a unified interface to get inference providers by name.
 * Supports runtime provider selection based on job configuration.
 */

import { Provider, InferenceProvider } from "../types/index.js";
import { localAI } from "./localai.js";
import { deepgram } from "./deepgram.js";

// Registry of available providers
const providers: Record<Provider, InferenceProvider> = {
  [Provider.LOCAL]: localAI,
  [Provider.DEEPGRAM]: deepgram,
};

/**
 * Get an inference provider by name
 * @throws Error if provider is not found
 */
export function getProvider(name: Provider | string): InferenceProvider {
  const provider = providers[name as Provider];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(providers).join(", ")}`);
  }
  return provider;
}

/**
 * Get the default provider based on environment configuration
 */
export function getDefaultProvider(): Provider {
  const envProvider = process.env.DEFAULT_PROVIDER;
  if (envProvider && Object.values(Provider).includes(envProvider as Provider)) {
    return envProvider as Provider;
  }
  return Provider.LOCAL;
}
