// Synthetic responses with the same shapes as real ones captured from photos.google.com
// (build boq_photosuiserver_20260924.10_p0). Keys, URLs and names are fake.

const OWNER = ['AF1QipOWNER', '100000000000000000000', 'Test User'];
const FLAGS = [[1], [2], [3], [4], [8], [21], [14], [15], [17], [18], [19], [22]];

export const photoRow = [
  'AF1QipPHOTO1',
  [
    'https://photos.fife.usercontent.google.com/pw/PHOTO1',
    720,
    1600,
    null,
    null,
    null,
    null,
    null,
    [null, null, 1],
    [1515054],
  ],
  1790677474000,
  'DEDUP1',
  19800000,
  1790677505804,
  null,
  FLAGS,
  2,
  { '15': 25878, '129168200': [[], [null, null, null, false]], '163238866': [false] },
];

export const videoRow = [
  'AF1QipVIDEO1',
  [
    'https://photos.fife.usercontent.google.com/pw/VIDEO1',
    1280,
    720,
    null,
    null,
    null,
    null,
    null,
    [null, null, 1],
    [7434609],
  ],
  1790676613000,
  'DEDUP2',
  19800000,
  1790677021637,
  null,
  FLAGS,
  2,
  {
    '15': 25878,
    '76647426': [292115, null, 1280, 720, null, 4, 134, null, [[1, null, 1280, 720]], false],
    '163238866': [false],
  },
];

export const libraryPage = [[photoRow, videoRow], 'NEXT_PAGE_TOKEN', '1785032645117'];
export const lastLibraryPage = [[photoRow], null, '1785032645117'];

export const itemInfo = [
  [
    'AF1QipPHOTO1',
    '',
    'Screenshot_20260929.png',
    1790677474000,
    19800000,
    331380,
    720,
    1600,
    null,
    null,
    null,
    'DEDUP1',
    FLAGS,
  ],
];

export const albumList = [
  [
    [
      'AF1QipALBUM1',
      ['https://photos.fife.usercontent.google.com/pw/COVER1', 2592, 1944],
      null,
      null,
      null,
      null,
      [OWNER[0]],
      FLAGS,
      { '72930366': [1, 'Ooty trip', [1752133913000, 1752163412000], 12, null] },
    ],
    [
      'AF1QipALBUM2_LONGER_SHARED_KEY',
      ['https://photos.fife.usercontent.google.com/pw/COVER2', 800, 600],
      null,
      null,
      null,
      null,
      [OWNER[0]],
      FLAGS,
      null,
      null,
      null,
      { '72930366': [4, 'insta', [1752133913000, 1752163412000], 5, true] },
    ],
  ],
  null,
  [1],
  [1],
];

export const albumPage = [
  '',
  [
    [
      'AF1QipALBUMITEM1',
      [
        'https://photos.fife.usercontent.google.com/pw/ITEM1',
        800,
        600,
        null,
        null,
        null,
        null,
        null,
        [null, null, 3],
      ],
      1790745027651,
      'DEDUP1',
      19800000,
      1790745172030,
      [OWNER[0]],
      FLAGS,
      2,
      { '15': 25913, '525000002': [['AF1QipALBUM1']] },
    ],
  ],
  null,
  ['AF1QipALBUM1', 'Ooty trip', [1790745027000, 1790745028000]],
];

export const createAlbumResult = [['AF1QipNEWALBUM']];

export const addToAlbumResult = ['AF1QipALBUM1', ['AF1QipPHOTO1'], [[['AF1QipALBUMITEM1']]]];

/** Raw HTTP body as returned by batchexecute with rt=c. */
export function batchBody(rpcid: string, result: unknown): string {
  const chunk = JSON.stringify([
    ['wrb.fr', rpcid, JSON.stringify(result), null, null, null, 'generic'],
  ]);
  const tail = JSON.stringify([
    ['di', 42],
    ['af.httprm', 41, '-123', 7],
  ]);
  return `)]}'\n\n${chunk.length}\n${chunk}\n${tail.length}\n${tail}\n`;
}

export function batchErrorBody(rpcid: string): string {
  const chunk = JSON.stringify([['wrb.fr', rpcid, null, null, null, [3], 'generic']]);
  return `)]}'\n\n${chunk.length}\n${chunk}\n`;
}
