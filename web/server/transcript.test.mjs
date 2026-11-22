import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTranscript, transcriptRows } from '../src/transcript.mjs';

test('reading groups cues into paragraphs; find starts at the first matching cue', () => {
  const doc = prepareTranscript([
    { start: 0, text: 'I just make a decision.' },
    { start: 2.8, text: 'Forward movement is still good' },
    { start: 4.3, text: 'movement, even if it is not the movement' },
    { start: 6, text: 'you thought you were going to make.' },
    { start: 18, text: 'The analysis flagged certain language.' },
  ]);
  const reading = transcriptRows(doc);
  assert.equal(reading.length, 2);
  assert.deepEqual(reading[0].times, [0, 2.8, 4.3, 6]);
  assert.match(reading[0].text, /still good movement,/);
  const [hit] = transcriptRows(doc, 'FORWARD movement is still good movement');
  assert.equal(hit.start, 2.8);
  assert.equal(hit.before, 'I just make a decision. ');
  assert.equal(hit.match, 'Forward movement is still good movement');
  assert.deepEqual(transcriptRows(doc, 'make the analysis'), []);
});

test('search crosses a paragraph split and matches whole words', () => {
  const doc = prepareTranscript([
    { start: 0, text: 'intro '.repeat(28) + 'A test.' },
    { start: 2, text: 'Three' },
    { start: 3, text: 'cue result.' },
  ]);
  assert.equal(transcriptRows(doc).length, 2);
  const [hit] = transcriptRows(doc, 'test three cue');
  assert.equal(hit.start, 0);
  assert.equal(hit.match, 'test. Three cue');
  assert.equal(transcriptRows(doc, 'res').length, 0);
});
