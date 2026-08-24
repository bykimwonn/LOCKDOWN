import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const URL_KEY = 'bt.lockdown.apiBase';
const TOKEN_KEY = 'bt.lockdown.token';

/**
 * Default API base: env build-time value, else the URL baked into app.json
 * (extra.apiBaseUrl), else whatever the user saved on this device.
 */
function bakedDefault(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra = String(extra?.apiBaseUrl || '').replace(/\/$/, '');
  return fromExtra;
}

let apiBase = bakedDefault();
let token = '';

export function getApiBase() {
  return apiBase;
}

export function setApiBase(url: string) {
  apiBase = (url || '').trim().replace(/\/$/, '');
  AsyncStorage.setItem(URL_KEY, apiBase).catch(() => undefined);
}

export function getToken() {
  return token;
}

export function setToken(value: string) {
  token = value || '';
  if (token) AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
  else AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}

export async function hydrateConfig() {
  const [u, t] = await Promise.all([AsyncStorage.getItem(URL_KEY), AsyncStorage.getItem(TOKEN_KEY)]);
  if (u) apiBase = u.replace(/\/$/, '');
  if (t) token = t;
}

export function apiUrl(path: string) {
  if (!apiBase) throw new Error('Set your BT LEARNING URL first.');
  return `${apiBase}${path}`;
}
