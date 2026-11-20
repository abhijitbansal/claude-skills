// The provenance stamp: two MP4 container tags written by the last ffmpeg step that writes the output (the encode of a
// silent film, the mux of a film with sound). `comment` is the line shared/provenance.mjs builds (the skill, the model,
// its effort, the agent host, the date: SOURCE_DATE_EPOCH when set), `artist` the model when it is reported. Only what
// generatedBy and the flags hold reaches the tags: no path, user name or host name. Each value is one argument of an
// argument array, never a shell word. Pure, apart from buildDate's default when no date is given.
import { buildDate, mergeGeneratedBy, provenanceText } from '../../shared/provenance.mjs';

export const STAMP_SKILL = 'make-motion';
const PROVENANCE_FLAGS = Object.freeze(['model', 'effort', 'agent']);
const NO_TAGS = Object.freeze({ comment: null, artist: null });

// The --model, --effort and --agent values that were given, as mergeGeneratedBy takes them.
const fieldFlags = (flags) => Object.fromEntries(PROVENANCE_FLAGS.filter((k) => typeof flags[k] === 'string').map((k) => [k, flags[k]]));

/**
 * The tags the film gets: { comment, artist }, both null when the stamp is off (`provenance: false` in the film, or
 * `flags.noProvenance`), artist null when no model is reported.
 * @param {{ generatedBy?: object, flags?: { model?: string, effort?: string, agent?: string, noProvenance?: boolean },
 *   provenance?: boolean, date?: Date }} opts
 */
export function stampTags({ generatedBy, flags = {}, provenance = true, date = buildDate() } = {}) {
  if (provenance === false || flags.noProvenance === true) return NO_TAGS;
  const merged = mergeGeneratedBy(generatedBy ?? {}, fieldFlags(flags)) ?? {};
  const model = typeof merged.model === 'string' && merged.model.length > 0 ? merged.model : null;
  return { comment: provenanceText(STAMP_SKILL, merged, date), artist: model };
}

/** The ffmpeg arguments for stampTags' tags: `-metadata comment=<line>` and `-metadata artist=<model>`, or []. */
export const stampArgs = (opts) => tagArgs(stampTags(opts));

/** The ffmpeg arguments for tags as stampTags returns them. */
export function tagArgs({ comment, artist }) {
  return [
    ...(comment === null ? [] : ['-metadata', `comment=${comment}`]),
    ...(artist === null ? [] : ['-metadata', `artist=${artist}`]),
  ];
}

/** `args` (an ffmpeg command whose last argument is its output) with `stamp` just before the output: a new array. */
export const withStamp = (args, stamp) => (stamp.length === 0 ? args : [...args.slice(0, -1), ...stamp, args.at(-1)]);
