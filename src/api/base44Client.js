import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

const unavailable = () => Promise.reject(new Error('Base44 is not configured for this local environment'));

const guestClient = {
  auth: {
    me: async () => null,
    isAuthenticated: async () => false,
    loginViaEmailPassword: unavailable,
    register: unavailable,
    verifyOtp: unavailable,
    resendOtp: unavailable,
    resetPasswordRequest: unavailable,
    resetPassword: unavailable,
    loginWithProvider: () => { throw new Error('Base44 is not configured for this local environment'); },
    setToken: () => {},
    logout: () => { window.location.href = '/'; },
    redirectToLogin: () => { window.location.href = '/login'; },
  },
  entities: new Proxy({}, {
    get: () => new Proxy({}, { get: () => unavailable }),
  }),
  functions: { invoke: unavailable, fetch: unavailable },
  integrations: { Core: { InvokeLLM: unavailable, UploadFile: unavailable } },
  analytics: { track: () => {} },
  appLogs: { logUserInApp: async () => {} },
};

// Base44 injects the app ID in hosted and linked local environments.
export const base44 = appId ? createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
}) : guestClient;
