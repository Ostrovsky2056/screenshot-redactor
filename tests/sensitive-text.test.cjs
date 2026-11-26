const assert = require("node:assert/strict");
const test = require("node:test");
const { alignMaskHeights, avoidStickers, boxForRange, findRegions, mergeMessageLines, runs } = require("../assets/sensitive-text.js");

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

test("aligns similar automatic text masks without shrinking the detected bounds", () => {
  const image = { width: 800, height: 320 };
  const comparable = [
    { type: "url", x: 20, y: 80, width: 600, height: 33 },
    { type: "name", x: 420, y: 150, width: 65, height: 42 },
    { type: "name", x: 20, y: 30, width: 150, height: 37 },
  ];
  const untouched = [
    { type: "avatar", x: 730, y: 140, width: 38, height: 38 },
    { type: "bubble", x: 400, y: 128, width: 140, height: 41 },
    { type: "graphic", x: 90, y: 110, width: 36, height: 38 },
    { x: 590, y: 30, width: 80, height: 38 },
    { type: "name", x: 220, y: 150, width: 60, height: 36, originalBounds: {} },
    { type: "name", x: 250, y: 80, width: 50, height: 35, avatarNickname: true },
    { type: "name", x: 520, y: 150, width: 80, height: 36, quoteSender: true },
    { type: "name", x: 30, y: 200, width: 200, height: 85 },
    { type: "name", x: 20, y: 175, width: 160, height: 36, enabled: false },
  ];
  const snapshot = structuredClone(untouched);
  const first = { x: 20, y: 80, width: 600, height: 33 };
  const regions = [...comparable, ...untouched];

  assert.equal(alignMaskHeights(regions, [], [], image, image), regions);
  assert.deepEqual(comparable.map(({ height }) => height), [42, 42, 42]);
  assert.deepEqual(comparable[0].detectedBounds, first);
  assert.equal(comparable[0].x, first.x);
  assert.equal(comparable[0].width, first.width);
  assert(comparable[0].y <= first.y && comparable[0].y + comparable[0].height >= first.y + first.height);
  assert.deepEqual(untouched, snapshot);
});

test("fits text mask padding between adjacent rows and inside message bubbles", () => {
  const image = { width: 510, height: 130 };
  const regions = [
    { type: "name", x: 140, y: 10, width: 25, height: 24 },
    { type: "url", x: 20, y: 34, width: 55, height: 18 },
    { type: "name", x: 120, y: 80, width: 32, height: 18 },
    { type: "email", x: 201, y: 35, width: 60, height: 18 },
    { type: "name", x: 300, y: 0, width: 35, height: 18 },
    { type: "name", x: 425, y: 72, width: 32, height: 18 },
  ];
  const neighboringRows = [
    { box: { x0: 12, y0: 19, x1: 89, y1: 32 } },
    { box: { x0: 14, y0: 53, x1: 88, y1: 63 } },
    { box: { x0: 115, y0: 63, x1: 172, y1: 78 } },
    { box: { x0: 420, y0: 58, x1: 460, y1: 73 } },
  ];
  const bubbles = [{ x0: 196, y0: 33, x1: 267, y1: 54 }];

  alignMaskHeights(regions, neighboringRows, bubbles, image, image);

  assert.deepEqual(regions.map(({ y, height }) => [y, height]), [
    [10, 24], [34, 18], [78, 24], [35, 18], [0, 24], [72, 24],
  ]);
});

test("retains a sticker's email while masking the same email outside on a shared OCR row", () => {
  const email = "badge@example.org";
  const line = ocrLine(email + " " + email, 30, 34);
  const sticker = { x0: 20, y0: 20, x1: 205, y1: 61 };
  const image = { width: 540, height: 100 };
  const other = boxForRange(line, email.length + 1, line.text.length);
  assert.deepEqual(findRegions([line], image, image, [sticker]), [
    { type: "email", x: other.x0 - 3, y: 31, width: other.x1 - other.x0 + 6, height: 20 },
  ]);
});

test("clips automatic mask padding at a sticker without removing outside text or the optional graphic", () => {
  const image = { width: 300, height: 200 };
  const sticker = { x0: 50, y0: 40, x1: 150, y1: 120 };
  const optional = { type: "graphic", x: 50, y: 40, width: 100, height: 80, enabled: false };
  const near = { type: "email", x: 147, y: 80, width: 97, height: 30 };
  const avatar = { type: "avatar", x: 10, y: 32, width: 36, height: 36 };
  const candidate = { type: "name", x: 69, y: 84, width: 40, height: 12, enabled: false, pending: true };
  assert.deepEqual(avoidStickers([near, avatar, candidate, optional], [sticker], image, image),
    [{ ...near, x: 150, width: 94 }, avatar, optional]);
});

test("keeps a sensitive value linked to its external label across a gap beside a sticker", () => {
  const line = {
    text: "contact: Taylor",
    box: { x0: 20, y0: 52, x1: 312, y1: 64 },
    spans: [
      { start: 0, end: 8, box: { x0: 20, y0: 52, x1: 75, y1: 64 } },
      { start: 9, end: 15, box: { x0: 265, y0: 52, x1: 312, y1: 64 } },
    ],
  };
  const sticker = { x0: 99, y0: 25, x1: 253, y1: 113 };
  const image = { width: 440, height: 160 };
  assert.deepEqual(findRegions([line], image, image, [sticker]), [
    { type: "name", x: 262, y: 49, width: 53, height: 18 },
  ]);
});
