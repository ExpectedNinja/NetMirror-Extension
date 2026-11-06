import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPoster,
  detailValue,
  normalizeTitle,
  scoreTitle,
} from '../src/core.js';

test('normalizes titles for matching', () => {
  assert.equal(normalizeTitle('The Last of Us'), 'last of us');
  assert.equal(normalizeTitle("Marvel's Daredevil"), 'marvels daredevil');
});

test('scores exact and partial matches', () => {
  assert.equal(scoreTitle('Game Of Thrones', 'Game of Thrones'), 100);
  assert.ok(scoreTitle('Game Of Thrones', 'Game of Thrones Season 1') >= 60);
  assert.equal(scoreTitle('Avatar', 'Titanic'), 0);
});

test('builds poster URLs from NewTV templates', () => {
  assert.equal(
    buildPoster('https://imgcdn.kim/poster/341/------------------.jpg', '123'),
    'https://imgcdn.kim/poster/341/123.jpg'
  );
  assert.equal(
    buildPoster('https://imgcdn.kim/poster/v', '123'),
    'https://imgcdn.kim/poster/v/123.jpg'
  );
  assert.equal(buildPoster(null, '123'), null);
});

test('reads metadata pairs case-insensitively', () => {
  const detail = {
    moredetails: [
      { k: 'IMDB Rating', v: '8.1' },
      { k: 'Cast', v: 'A, B' },
    ],
  };
  assert.equal(detailValue(detail, 'imdb rating'), '8.1');
  assert.equal(detailValue(detail, 'Cast'), 'A, B');
  assert.equal(detailValue(detail, 'Director'), null);
});
