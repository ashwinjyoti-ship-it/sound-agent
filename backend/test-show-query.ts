import { matchesProgram, parseShowQueryHints, inferUpdateTaskType, sanitizeProgramQuery, findLastKnownProgram } from './src/services/claude';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('ok:', msg);
  }
}

// matchesProgram must never match everything
assert(!matchesProgram('Absence of Presence', ''), 'empty needle matches nothing');
assert(!matchesProgram('Young Talent', ' '), 'whitespace needle matches nothing');
assert(matchesProgram('Young Talent', 'young talent'), 'both words required');
assert(!matchesProgram('Absence of Presence', 'young talent'), 'unrelated show rejected');
assert(matchesProgram('NCPA Young Talent Festival', 'young talent'), 'partial title match');
assert(!matchesProgram('Some Show', 'young'), 'single word "young" alone does not match unrelated show');
assert(matchesProgram('Some Young Show', 'young'), 'single significant word matches');
assert(matchesProgram('NCPA Young Talent Festival', 'sr young talent'), 'SR stripped — partial title still matches');
assert(sanitizeProgramQuery('SR Young Talent') === 'Young Talent', 'sanitize strips SR prefix');
assert(sanitizeProgramQuery('sr young talent') === 'young talent', 'sanitize strips sr token');

const hints = parseShowQueryHints(
  'SR: young talent 5 July. Floor mic for Cello. And call time update same show 14:00',
  '2026-07-08',
  2026,
);
assert(hints.program === 'young talent', `program hint = "${hints.program}"`);
assert(hints.from === '2026-07-05', `date hint from = ${hints.from}`);
assert(hints.to === '2026-07-05', `date hint to = ${hints.to}`);

const typoHints = parseShowQueryHints(
  'udate SR young talent 5 July. Floor mic for Cello. And call time upadre same show 14:00',
  '2026-07-08',
  2026,
);
assert(typoHints.program === 'young talent', `typo message program = "${typoHints.program}"`);
assert(typoHints.from === '2026-07-05', `typo message date = ${typoHints.from}`);

assert(inferUpdateTaskType('update SR young talent 5 July') === 'SR', 'infers SR from free text');
assert(inferUpdateTaskType('udate SR young talent 5 July') === 'SR', 'infers SR from udate typo');
assert(inferUpdateTaskType('call time update same show 14:00') === 'CT', 'infers CT from free text');

// Date-only follow-up drops the show name — recover it from earlier in the conversation.
const historyWithNameThenDate = [
  { role: 'user', content: 'udate SR young talent 5 July. Floor mic for Cello.' },
  { role: 'assistant', content: 'Nothing on the 5th for Young Talent — did you mean the 9th?' },
  { role: 'user', content: 'no its the 9th' },
];
assert(
  findLastKnownProgram(historyWithNameThenDate, '2026-07-08', 2026) === 'young talent',
  'recovers show name from an earlier turn when the latest message only corrects the date',
);
assert(
  findLastKnownProgram([{ role: 'user', content: 'no its the 9th' }], '2026-07-08', 2026) === undefined,
  'no fallback when no prior message names a show',
);

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll show-query tests passed');
