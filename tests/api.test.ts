import { describe, expect, it } from 'vitest';
import { parseAlbumList, parseAlbumPage } from '../src/api/albums';
import { parseItemInfo, parseLibraryPage, parseMediaRow } from '../src/api/library';
import { ApiShapeError, decodeResponse, encodeRequest, RpcError } from '../src/api/rpc';
import * as fx from './fixtures/responses';

const session = { fsid: '123', bl: 'boq_test', at: 'TOKEN:1' };

describe('encodeRequest', () => {
  it('puts the rpc id in the query and the payload in f.req', () => {
    const { url, body } = encodeRequest('lcxiM', [null, 1], session, 555, '/');
    const query = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('/_/PhotosUi/data/batchexecute?')).toBe(true);
    expect(query.get('rpcids')).toBe('lcxiM');
    expect(query.get('f.sid')).toBe('123');
    expect(query.get('_reqid')).toBe('555');
    const form = new URLSearchParams(body);
    expect(JSON.parse(form.get('f.req')!)).toEqual([[['lcxiM', '[null,1]', null, 'generic']]]);
    expect(form.get('at')).toBe('TOKEN:1');
  });
});

describe('decodeResponse', () => {
  it('extracts the result for the rpc id', () => {
    expect(decodeResponse(fx.batchBody('lcxiM', fx.libraryPage), 'lcxiM')).toEqual(fx.libraryPage);
  });

  it('throws RpcError when Google returns an error', () => {
    expect(() => decodeResponse(fx.batchErrorBody('fDcn4b'), 'fDcn4b')).toThrow(RpcError);
  });

  it('throws ApiShapeError when the rpc id is missing', () => {
    expect(() => decodeResponse(fx.batchBody('other', []), 'lcxiM')).toThrow(ApiShapeError);
  });
});

describe('library', () => {
  it('parses a photo row', () => {
    expect(parseMediaRow(fx.photoRow)).toEqual({
      key: 'AF1QipPHOTO1',
      dedupKey: 'DEDUP1',
      takenAt: 1790677474000,
      tzOffsetMs: 19800000,
      uploadedAt: 1790677505804,
      width: 720,
      height: 1600,
      baseUrl: 'https://photos.fife.usercontent.google.com/pw/PHOTO1',
      isVideo: false,
      durationMs: null,
    });
  });

  it('detects videos and their duration', () => {
    const video = parseMediaRow(fx.videoRow);
    expect(video.isVideo).toBe(true);
    expect(video.durationMs).toBe(292115);
  });

  it('parses a page and its next-page token', () => {
    const page = parseLibraryPage(fx.libraryPage);
    expect(page.items.map((i) => i.key)).toEqual(['AF1QipPHOTO1', 'AF1QipVIDEO1']);
    expect(page.nextPageToken).toBe('NEXT_PAGE_TOKEN');
    expect(parseLibraryPage(fx.lastLibraryPage).nextPageToken).toBeNull();
  });

  it('parses an empty library', () => {
    expect(parseLibraryPage([null, null]).items).toEqual([]);
  });

  it('fails loudly on an unexpected shape', () => {
    expect(() => parseLibraryPage([[['AF1Qip', 'not-an-array']]])).toThrow(ApiShapeError);
  });

  it('parses item info', () => {
    expect(parseItemInfo(fx.itemInfo)).toEqual({
      key: 'AF1QipPHOTO1',
      description: null,
      filename: 'Screenshot_20260929.png',
      sizeBytes: 331380,
    });
  });
});

describe('albums', () => {
  it('parses the album list wherever the metadata object sits', () => {
    expect(parseAlbumList(fx.albumList)).toEqual({
      albums: [
        { key: 'AF1QipALBUM1', title: 'Ooty trip', itemCount: 12 },
        { key: 'AF1QipALBUM2_LONGER_SHARED_KEY', title: 'insta', itemCount: 5 },
      ],
      nextPageToken: null,
    });
  });

  it('parses an album page', () => {
    const page = parseAlbumPage(fx.albumPage);
    expect(page.title).toBe('Ooty trip');
    expect(page.nextPageToken).toBeNull();
    expect(page.items).toEqual([
      {
        albumItemKey: 'AF1QipALBUMITEM1',
        dedupKey: 'DEDUP1',
        takenAt: 1790745027651,
        baseUrl: 'https://photos.fife.usercontent.google.com/pw/ITEM1',
        width: 800,
        height: 600,
      },
    ]);
  });
});
