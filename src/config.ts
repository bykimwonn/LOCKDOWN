import AsyncStorage from '@react-native-async-storage/async-storage';

const URL_KEY = 'bt.lockdown.apiBase';
const TOKEN_KEY = 'bt.lockdown.token';

let apiBase = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
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
