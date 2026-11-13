import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvent } from '../src/lib/renderEvent.js';
import { eventPresentation } from '../src/lib/eventPresentation.js';

test('video posters use indexed URLs and never enter the album or become its cover', () => {
  const videoPath = '01_活动照片/09000_演示.mov';
  const posterPath = '01_活动照片/视频封面/10000_封面_选帧.png';
  const source = {
    record: { id: 'demo', title: '活动', date: '2026-11-11',
      videos: [{ path: videoPath, name: '09000_演示.mov' }],
      videoPosters: { [videoPath]: posterPath }, videoTitles: { [videoPath]: '作品演示' } },
    assets: [
      { path: '01_活动照片/08000_现场.jpg', name: '08000_现场.jpg', category: '活动', rating: 8000, url: '/photo.jpg' },
      { path: '01_活动照片/09000_演示.mp4', name: '09000_演示.mp4', url: '/video.mp4' },
      { path: posterPath.replace('.png', '.jpg'), name: '10000_封面_选帧.jpg', category: '活动', rating: 10000, isCover: 1, onHomePage: 1, url: '/real-indexed-poster.jpg' },
    ],
  };
  const event = renderEvent(source), view = eventPresentation(event);
  assert.equal(event.image, '/photo.jpg');
  assert.deepEqual(view.photos.map(p => p.image), ['/photo.jpg']);
  assert.equal(view.sceneVideos[0].poster, '/real-indexed-poster.jpg');
  assert.equal(view.sceneVideos[0].src, '/video.mp4');
  assert.equal(view.sceneVideos[0].title, '作品演示');
  // A missing upload must not produce a guessed poster URL or a broken <img>.
  const missing = renderEvent({ ...source, assets: source.assets.slice(0, 2) });
  assert.equal(missing.detail.videos[0].poster, undefined);
  // Old activities retain their original video title and no synthetic poster.
  const legacy = renderEvent({ ...source, record: { ...source.record, videoPosters: undefined, videoTitles: undefined } });
  assert.equal(legacy.detail.videos[0].title, '演示');
  assert.equal(legacy.detail.videos[0].poster, undefined);
});
