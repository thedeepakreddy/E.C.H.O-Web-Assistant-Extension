export interface AuthConfig {
  provider: 'claude' | 'gemini' | 'togetherai' | 'openrouter' | 'groq';
  anthropicApiKey?: string;
  geminiApiKey?: string;
  togetherApiKey?: string;
  openrouterApiKey?: string;
  groqApiKey?: string;
  togetherModel?: string;
  openrouterModel?: string;
  groqModel?: string;
  anthropicModel?: string;
  geminiModel?: string;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const PRIVACY_CONSENT_VERSION = 1;
export const PRIVACY_CONSENT_REQUIRED = 'PRIVACY_CONSENT_REQUIRED';

export class PrivacyConsentRequiredError extends Error {
  readonly code = PRIVACY_CONSENT_REQUIRED;

  constructor() {
    super('Cloud AI is off until you review and accept the privacy disclosure in ECHO Options.');
    this.name = 'PrivacyConsentRequiredError';
  }
}

export function getAuthConfig(): Promise<AuthConfig> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['echo_privacy_consent', 'provider', 'anthropicApiKey', 'geminiApiKey', 'togetherApiKey', 'openrouterApiKey', 'groqApiKey', 'togetherModel', 'openrouterModel', 'groqModel', 'anthropicModel', 'geminiModel'], (result) => {
      const consent = result.echo_privacy_consent as { version?: number } | undefined;
      if (consent?.version !== PRIVACY_CONSENT_VERSION) {
        reject(new PrivacyConsentRequiredError());
        return;
      }
      const provider = (result.provider as AuthConfig['provider']) || 'claude';
      if (provider === 'claude' && !result.anthropicApiKey) {
        reject(new Error('No Anthropic API Key found. Please set one in the extension options.'));
      } else if (provider === 'gemini' && !result.geminiApiKey) {
        reject(new Error('No Gemini API Key found. Please set one in the extension options.'));
      } else if (provider === 'togetherai' && !result.togetherApiKey) {
        reject(new Error('No Together AI API Key found. Please set one in the extension options.'));
      } else if (provider === 'openrouter' && !result.openrouterApiKey) {
        reject(new Error('No OpenRouter API Key found. Please set one in the extension options.'));
      } else if (provider === 'groq' && !result.groqApiKey) {
        reject(new Error('No Groq API Key found. Please set one in the extension options.'));
      } else if (provider === 'togetherai' && !result.togetherModel) {
        reject(new Error('Choose a current Together AI model ID in Options.'));
      } else {
        resolve({
          provider,
          anthropicApiKey: result.anthropicApiKey as string,
          geminiApiKey: result.geminiApiKey as string,
          togetherApiKey: result.togetherApiKey as string,
          openrouterApiKey: result.openrouterApiKey as string,
          groqApiKey: result.groqApiKey as string,
          togetherModel: result.togetherModel as string,
          openrouterModel: (result.openrouterModel as string) || 'openrouter/free',
          groqModel: (result.groqModel as string) || 'llama-3.3-70b-versatile',
          anthropicModel: (result.anthropicModel as string) || DEFAULT_CLAUDE_MODEL,
          geminiModel: (result.geminiModel as string) || DEFAULT_GEMINI_MODEL,
        });
      }
    });
  });
}
