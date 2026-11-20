// --subtitles srt|vtt: a caption file beside the MP4, from the film's own word times. One cue per sentence (split past
// MAX_CUE_WORDS words), from the first word heard to the last, at film time. With a voice the times are measured (the
// sidecar, or an author's recording); without one they are the word-count estimate, and the file says so: a VTT in a
// NOTE line. SRT has no comment line, so an estimated SRT is refused rather than written without the warning. Word
// text is the narration as plain text (marks gone); < and & are written as entities so a player shows them as text.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_CUE_WORDS = 8;
export const ESTIMATE_NOTE = 'the times are estimated from the word count: the film has no voice to measure them by';
const MS = 1000;
const ENTITIES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;' });

const escapeText = (text) => text.replace(/[&<>]/g, (c) => ENTITIES[c]);

// The cues of one sentence of `shot`: chunks of at most MAX_CUE_WORDS words.
function sentenceCues(shot, { first, last }) {
  const words = shot.words.slice(first, last + 1);
  const cues = [];
  for (let k = 0; k < words.length; k += MAX_CUE_WORDS) {
    const chunk = words.slice(k, k + MAX_CUE_WORDS);
    cues.push({ start: shot.start + chunk[0].soundStart, end: shot.start + chunk.at(-1).soundEnd, text: chunk.map((w) => w.text).join(' ') });
  }
  return cues;
}

/** The cues of `timeline` (buildTimeline's): [{ start, end, text }] in film seconds, in order. */
export const subtitleCues = (timeline) => timeline.shots.flatMap((shot) => (shot.sentences ?? []).flatMap((s) => sentenceCues(shot, s)));

// h:mm:ss with milliseconds after `sep` (SRT a comma, VTT a dot), two-digit hours.
function stamp(seconds, sep) {
  const ms = Math.round(seconds * MS);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / MS) % 60)}${sep}${pad(ms % MS, 3)}`;
}

/** The file's text for `format` ('srt' | 'vtt'). Throws for an estimated timeline in SRT (it cannot carry the note). */
export function subtitleText(timeline, format) {
  const estimated = timeline.timed !== 'measured';
  const cues = subtitleCues(timeline);
  if (format === 'srt') {
    if (estimated) throw new Error('SRT has no comment line to say the times are estimated (the film has no voice); use --subtitles vtt, whose file carries that note');
    return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${escapeText(c.text)}\n`).join('\n');
  }
  const head = `WEBVTT\n\n${estimated ? `NOTE ${ESTIMATE_NOTE}\n\n` : ''}`;
  return head + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${escapeText(c.text)}\n`).join('\n');
}

/** Where the file goes: beside the MP4, its name with the format's extension. */
export const subtitlePath = (videoOut, format) => path.join(path.dirname(videoOut), `${path.basename(videoOut, path.extname(videoOut))}.${format}`);

/** Writes the file (whole or not at all). -> { file, format, timed }. */
export function writeSubtitles({ timeline, format, videoOut }) {
  const file = subtitlePath(videoOut, format);
  const text = subtitleText(timeline, format);
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.partial-${process.pid}`;
  try {
    writeFileSync(partial, text, { flag: 'wx' });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return { file, format, timed: timeline.timed === 'measured' ? 'measured' : 'estimated' };
}
