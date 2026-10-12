// The yogurTLS tub, drawn with half blocks: each character is two pixels, one on top of the other.
// Shown only on an interactive terminal, so scripts and scheduled jobs get plain output.
const PIXELS = [
  '##............',
  '.###..........',
  '....####......',
  '........####..',
  '.############.',
  '.############.',
  '..##########..',
  '...########...',
  '..............',
  '......##......',
  '.....####.....',
  '..............',
  '...########...',
  '...########...',
  '....######....',
  '..............',
];

const PINK = '\u001b[38;2;255;46;126m';
const PINK_256 = '\u001b[38;5;204m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

function rows() {
  const lines = [];
  for (let i = 0; i < PIXELS.length; i += 2) {
    const top = PIXELS[i];
    const bottom = PIXELS[i + 1] ?? '';
    let line = '';
    for (let x = 0; x < top.length; x++) {
      const a = top[x] === '#';
      const b = bottom[x] === '#';
      line += a && b ? '█' : a ? '▀' : b ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines;
}

export function renderLogo(version, { useColor = true, trueColor = true } = {}) {
  const pink = useColor ? (trueColor ? PINK : PINK_256) : '';
  const bold = useColor ? BOLD : '';
  const reset = useColor ? RESET : '';
  const art = rows();
  const name = `${bold}yogur${pink}TLS${reset}  ${version}`;
  return art
    .map((line, i) => `  ${pink}${line}${reset}${i === 3 ? `   ${name}` : ''}`.trimEnd())
    .join('\n');
}
