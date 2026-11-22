const GAP = 8;
const MIN_WORDS = 30;
const MAX_WORDS = 70;
const sentenceEnd = /[.!?…]+["'”’)]*$/u;

function tokens(text) {
  return Array.from(text.matchAll(/[\p{L}\p{N}\p{M}]+/gu), match => ({
    word: match[0].normalize('NFKC').toLowerCase(),
    begin: match.index,
    end: match.index + match[0].length,
  }));
}

export function prepareTranscript(segments) {
  let text = '';
  let section = 0;
  let previous = null;
  let paragraph = null;
  let words = 0;
  const paragraphs = [];
  const index = [];

  for (const cue of segments) {
    if (typeof cue?.text !== 'string' || !Number.isFinite(cue.start) || cue.start < 0) continue;
    const copy = cue.text.replace(/\s+/gu, ' ').trim();
    if (!copy) continue;
    const entries = tokens(copy);
    const pause = previous && cue.start - previous.start > GAP;
    const newParagraph = !paragraph || pause ||
      (words >= MIN_WORDS && sentenceEnd.test(previous.text)) || words + entries.length > MAX_WORDS;
    if (pause) section++;
    if (text) text += ' ';
    const offset = text.length;
    if (newParagraph) {
      paragraph = { start: cue.start, begin: offset, end: offset, times: [] };
      paragraphs.push(paragraph);
      words = 0;
    }
    text += copy;
    paragraph.end = text.length;
    paragraph.times.push(cue.start);
    words += entries.length;
    const block = paragraphs.length - 1;
    for (const token of entries) index.push({
      ...token, begin: offset + token.begin, end: offset + token.end, start: cue.start, block, section,
    });
    previous = { start: cue.start, text: copy };
  }
  return { text, paragraphs, index };
}

export function transcriptRows(transcript, query = '') {
  const { text, paragraphs, index } = transcript;
  const wanted = tokens(query).map(token => token.word);
  if (!wanted.length) return paragraphs.map(({ start, begin, end, times }) => ({
    key: begin, start, times, text: text.slice(begin, end),
  }));
  const results = [];
  for (let i = 0; i <= index.length - wanted.length; i++) {
    const first = index[i];
    const last = index[i + wanted.length - 1];
    if (first.section !== last.section || !wanted.every((word, j) => word === index[i + j].word)) continue;
    const begin = paragraphs[first.block].begin;
    const end = paragraphs[last.block].end;
    results.push({
      key: first.begin,
      start: first.start,
      times: [first.start],
      before: text.slice(begin, first.begin),
      match: text.slice(first.begin, last.end),
      after: text.slice(last.end, end),
    });
  }
  return results;
}
