import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../src/vosk-tts-core.js');

const ref = JSON.parse(readFileSync(new URL('./ref.json', import.meta.url), 'utf-8'));
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
}

// 1. g2p convert
for (const [word, want] of Object.entries(ref.convert)) {
  check(`convert(${word})`, core.g2pConvert(word), want);
}

// 2. tokenizer
const VOCAB = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]",
  "при", "##вет", "мир", "кре", "##щение", "руси", "стало",
  "поворотным", "моментом", "это", "решение", "определило",
  "путь", "страны", "на", "много", "веков", "вперед", "он",
  "спросил", "что", "дальше", "никто", "не", "знал", "точно",
  "слово", "в", "кавычках", "здесь", "-", ",", ".", "?", "!",
  ":", "\"", "...", "(", ")"];
const tok = new core.WordPieceTokenizer(VOCAB.join('\n'));
for (const [text, want] of Object.entries(ref.tokenizer)) {
  const enc = tok.encode(text.replace(/[+_]/g, '').toLowerCase());
  check(`tokenizer(${text}).tokens`, enc.tokens, want.tokens);
  check(`tokenizer(${text}).ids`, enc.ids, want.ids);
}

// 3. multistream_scales streams
const dic = new Map(Object.entries(ref.dic));
for (const [text, want] of Object.entries(ref.multistream_scales)) {
  const got = core.g2pMultistream(text, ref.config, dic, { wordPos: true, scales: true });
  check(`multistream(${text}).streams`, got.streams, want.streams);
  check(`multistream(${text}).durationExtra`, got.durationExtra, want.durationExtra);
}

// 4. number normalization sanity
check('num 1988', core.numberToWords('1988'), 'тысяча девятьсот восемьдесят восемь');
check('num 0', core.numberToWords('0'), 'ноль');
check('num 21', core.numberToWords('21'), 'двадцать один');
check('num 2000000', core.numberToWords('2000000'), 'два миллиона');
check('num 5001', core.numberToWords('5001'), 'пять тысяч один');
check('norm text', core.normalizeText('В 1988 году (по данным «Отчёта») вышло 3 статьи — вот так…'),
  'В тысяча девятьсот восемьдесят восемь году , по данным Отчёта , вышло три статьи - вот так...');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
