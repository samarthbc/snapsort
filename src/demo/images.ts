// Dev-only: sample "photos" for the offline demo, drawn as SVG data URIs so the demo needs
// no server. The URL ends in '#', so SnapSort's size suffixes (e.g. "=w1600-h900") land in
// the fragment and are ignored.

const SCENES: Record<string, [string, string, string, string]> = {
  beach: ['#4fc3f7', '#fff59d', 'Beach day', '🏖'],
  meme: ['#212121', '#424242', 'Forwarded meme', '😂'],
  screenshot: ['#eceff1', '#cfd8dc', 'Screenshot', '📱'],
  mountains: ['#81c784', '#1b5e20', 'Ooty hills', '🌄'],
  goodmorning: ['#ffb74d', '#e65100', 'Good morning! 🌞', '🌻'],
  receipt: ['#fafafa', '#e0e0e0', 'Restaurant bill', '🧾'],
  sunset: ['#ff7043', '#5e35b1', 'Sunset', '🌅'],
  family: ['#ce93d8', '#6a1b9a', 'Family dinner', '👨‍👩‍👧'],
};

export const isPortrait = (kind: string) =>
  kind === 'screenshot' || kind === 'meme' || kind === 'goodmorning';

export function sampleImageUrl(kind: string, n: number): string {
  const [a, b, label, emoji] = SCENES[kind] ?? SCENES.beach!;
  const [w, h] = isPortrait(kind) ? [1080, 1920] : [1600, 1200];
  const dark = kind === 'screenshot' || kind === 'receipt';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="45%" font-size="${w / 4}" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
<text x="50%" y="68%" font-family="sans-serif" font-weight="700" font-size="${w / 14}" fill="${dark ? '#37474f' : '#fff'}" text-anchor="middle">${label}</text>
<text x="50%" y="76%" font-family="sans-serif" font-size="${w / 30}" fill="${dark ? '#607d8b' : '#ffffffcc'}" text-anchor="middle">sample photo #${n}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}#`;
}
