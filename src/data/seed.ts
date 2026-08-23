import type { ShieldApp, WhitelistApp } from '@/src/types';

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
];
