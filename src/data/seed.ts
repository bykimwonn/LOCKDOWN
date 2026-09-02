import type { AppCategory, ShieldApp, WhitelistApp } from '@/src/types';

/**
 * Buckets for apps detected on the device (Shield tab scan). First match
 * wins, so social stays ahead of entertainment (TikTok is video AND social).
 * Anything unmatched lands in 'other' and can be re-tagged later.
 */
const CATEGORY_HINTS: Array<[RegExp, AppCategory]> = [
  [
    /instagram|tiktok|musically|whatsapp|facebook|katana|twitter|snapchat|discord|telegram|reddit|messenger|threads|pinterest|linkedin|imo\b|wechat|viber|signal/i,
    'social',
  ],
  [
    /pubg|freefire|garena|supercell|king\.|roblox|minecraft|activision|epicgames|eagames|zynga|miniclip|game/i,
    'games',
  ],
  [
    /youtube|netflix|spotify|disney|primevideo|showmax|dstv|music|video|twitch|vimeo/i,
    'entertainment',
  ],
  [
    /chrome|firefox|opera|brave|browser|duckduckgo|emmx|edge|internet/i,
    'browsers',
  ],
];

export function guessAppCategory(packageId: string, name: string): AppCategory {
  const hay = `${packageId} ${name}`;
  for (const [re, cat] of CATEGORY_HINTS) {
    if (re.test(hay)) return cat;
  }
  return 'other';
}

export const WHITELIST: WhitelistApp[] = [
  { id: 'w1', name: 'Phone', reason: 'Emergency calls stay open', essential: true },
  { id: 'w2', name: 'Messages', reason: 'Native SMS only', essential: true },
  { id: 'w3', name: 'BT LEARNING', reason: 'The study surface itself', essential: true },
  { id: 'w4', name: 'YouTube Education', reason: 'Approved lecture channels', essential: false },
  { id: 'w5', name: 'BT LOCKDOWN', reason: 'This companion', essential: true },
];

export const SHIELD_APPS: ShieldApp[] = [
  { id: 's1', name: 'Instagram', packageId: 'com.instagram.android', category: 'social', blocked: true, iconHint: 'IG' },
  { id: 's2', name: 'TikTok', packageId: 'com.zhiliaoapp.musically', category: 'social', blocked: true, iconHint: 'TT' },
  { id: 's3', name: 'X / Twitter', packageId: 'com.twitter.android', category: 'social', blocked: true, iconHint: 'X' },
  { id: 's4', name: 'WhatsApp', packageId: 'com.whatsapp', category: 'social', blocked: true, iconHint: 'WA' },
  { id: 's5', name: 'Snapchat', packageId: 'com.snapchat.android', category: 'social', blocked: true, iconHint: 'SC' },
  { id: 's6', name: 'Facebook', packageId: 'com.facebook.katana', category: 'social', blocked: true, iconHint: 'FB' },
  { id: 's7', name: 'YouTube', packageId: 'com.google.android.youtube', category: 'entertainment', blocked: true, iconHint: 'YT' },
  { id: 's8', name: 'Netflix', packageId: 'com.netflix.mediaclient', category: 'entertainment', blocked: true, iconHint: 'NF' },
  { id: 's9', name: 'Spotify', packageId: 'com.spotify.music', category: 'entertainment', blocked: false, iconHint: 'SP' },
  { id: 's10', name: 'PUBG', packageId: 'com.tencent.ig', category: 'games', blocked: true, iconHint: 'PG' },
  { id: 's11', name: 'Free Fire', packageId: 'com.dts.freefireth', category: 'games', blocked: true, iconHint: 'FF' },
  { id: 's12', name: 'Candy Crush', packageId: 'com.king.candycrushsaga', category: 'games', blocked: true, iconHint: 'CC' },
  { id: 's13', name: 'Chrome', packageId: 'com.android.chrome', category: 'browsers', blocked: true, iconHint: 'CH' },
  { id: 's14', name: 'Safari', packageId: 'com.apple.mobilesafari', category: 'browsers', blocked: true, iconHint: 'SF' },
  { id: 's15', name: 'Reddit', packageId: 'com.reddit.frontpage', category: 'social', blocked: true, iconHint: 'RD' },
  { id: 's16', name: 'Discord', packageId: 'com.discord', category: 'social', blocked: true, iconHint: 'DC' },
  { id: 's17', name: 'Telegram', packageId: 'org.telegram.messenger', category: 'social', blocked: true, iconHint: 'TG' },
  { id: 's18', name: 'YouTube Kids', packageId: 'com.google.android.apps.youtube.kids', category: 'entertainment', blocked: true, iconHint: 'YK' },
  { id: 's19', name: 'Clash of Clans', packageId: 'com.supercell.clashofclans', category: 'games', blocked: true, iconHint: 'CO' },
];
