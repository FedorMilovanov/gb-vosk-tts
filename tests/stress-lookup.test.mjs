import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { StressLookup, StressMarkerDict, toVoskPlus } = require('../src/stress-lookup.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
}

const buf = readFileSync(new URL('../data/russian-stress-marker.bin', import.meta.url));
const dict = new StressMarkerDict(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Real-world stress checks (independently known-correct forms, incl. commonly
// mispronounced ones) — proves the FSA decoder, not just that it returns *something*.
check('машина', dict.lookup('машина'), "маши'на");
check('молоко', dict.lookup('молоко'), "молоко'");
check('президент', dict.lookup('президент'), "президе'нт");
check('звонит (correct, not the common mispronunciation)', dict.lookup('звонит'), "звони'т");
check('договор (correct, not the common mispronunciation)', dict.lookup('договор'), "догово'р");
check('торты (correct, not the common mispronunciation)', dict.lookup('торты'), "то'рты");
check('unknown word returns null', dict.lookup('диспенсационализм'), null);

check('toVoskPlus acute', toVoskPlus("маши'на"), 'маш+ина');
check('toVoskPlus grave dropped', toVoskPlus('слу`чай'), 'случай');

const custom = new Map([['диспенсационализм', 'диспенсационал+изм']]);
const lookup = new StressLookup({
  customTerms: custom,
  markerDictBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
});
check('custom layer wins', lookup.getPlusForm('диспенсационализм'), 'диспенсационал+изм');
check('falls through to marker dict', lookup.getPlusForm('машина'), 'маш+ина');
check('unknown returns null (caller falls back to vosk-tts own dict / unstressed)', lookup.getPlusForm('незнакомоеслово123'), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
