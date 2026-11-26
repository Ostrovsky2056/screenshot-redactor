const assert = require("node:assert/strict");
const test = require("node:test");
const { boxForRange, findRegions, mergeMessageLines, runs } = require("../assets/sensitive-text.js");

function ocrLine(text, x, y, confidence = 80) {
  const spans = [...text.matchAll(/\S/gu)].map(({ index, 0: value }) => ({
    start: index,
    end: index + value.length,
    box: { x0: x + index * 10, y0: y, x1: x + index * 10 + 7, y1: y + 14 },
  }));
  return { text, confidence, spans, box: { ...spans[0].box, x1: spans.at(-1).box.x1 } };
}

test("masks a web link with OCR-spaced punctuation and leaves the sentence punctuation", () => {
  const url = "https: / /example.org/a-b?q=x#docs";
  const line = ocrLine("Use " + url + ". Then check", 10, 20);
  const image = { width: 800, height: 150 };
  const link = boxForRange(line, 4, 4 + url.length);
  assert.deepEqual(findRegions([line], image, image), [
    { type: "url", x: link.x0 - 3, y: 17, width: link.x1 - link.x0 + 6, height: 20 },
  ]);
});

test("uses a complete message reread over a stray tall OCR box and keeps the other row", () => {
  const message = { x0: 10, y0: 40, x1: 175, y1: 120 };
  const bad = { ...ocrLine("aa", 10, 40, 55), box: { x0: 10, y0: 20, x1: 210, y1: 145 } };
  const otherRow = ocrLine("Next row", 24, 93, 87);
  const text = ocrLine("截图自动脱敏", 28, 65, 91);
  const prefix = ocrLine("截图", 28, 65, 99);
  assert.deepEqual(mergeMessageLines([bad, otherRow], [message], [
    [{ x0: 24, y0: 60, x1: 57, y1: 84 }, { line: prefix, confidence: 99 }],
    [message, { line: text, confidence: 91 }],
  ]), [otherRow, text]);
});

test("offers only the text after a masked nickname and its separator", () => {
  const line = ocrLine("阿 云 , 试 试", 20, 40);
  const name = boxForRange(line, 0, 3);
  const choices = runs(line, [name], { skipSeparators: true });
  assert.deepEqual(choices.map(({ start, end }) => line.text.slice(start, end)), ["试 试"]);
});
