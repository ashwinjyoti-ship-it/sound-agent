import { matchesProgram, parseShowQueryHints, inferUpdateTaskType } from './src/services/claude';

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

const hints = parseShowQueryHints(
  'SR: young talent 5 July. Floor mic for Cello. And call time update same show 14:00',
  '2026-07-08',
  2026,
);
assert(hints.program === 'young talent', `program hint = "${hints.program}"`);
assert(hints.from === '2026-07-05', `date hint from = ${hints.from}`);
assert(hints.to === '2026-07-05', `date hint to = ${hints.to}`);

assert(inferUpdateTaskType('update SR young talent 5 July') === 'SR', 'infers SR from free text');
assert(inferUpdateTaskType('call time update same show 14:00') === 'CT', 'infers CT from free text');

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll show-query tests passed');
