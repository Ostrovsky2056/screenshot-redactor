const assert = require("node:assert/strict");
const test = require("node:test");
const { findRegions } = require("../assets/chat-mentions.js");
const { runs } = require("../assets/sensitive-text.js");

const message = { x0: 0, y0: 20, x1: 700, y1: 400 };
const layout = { avatars: [], messages: [message], quoteBodies: [], participantNames: [] };

function line(text, y = 28, wordBox = false) {
  const box = { x0: 12, y0: y, x1: 12 + 10 * text.length, y1: y + 9 };
  const spans = wordBox ? [{ start: 0, end: text.length, box }] :
    [...text.matchAll(/\S/gu)].map(({ index, 0: value }) => ({
      start: index,
      end: index + value.length,
      box: { ...box, x0: box.x0 + 10 * index, x1: box.x0 + 10 * (index + value.length) },
    }));
  return { text, box, spans };
}

test("maps OCR-spaced Chinese characters back to just the name", () => {
  const names = findRegions([line("请 龙 哥 看 看 。找 陈 小 雨 先 确 认")], layout);
  assert.deepEqual(names.sort((a, b) => a.x0 - b.x0), [
    { x0: 32, y0: 28, x1: 62, y1: 37 },
    { x0: 142, y0: 28, x1: 192, y1: 37 },
  ]);
});

test("uses a proportional name region when OCR supplies a single combined word box", () => {
  assert.deepEqual(findRegions([line("帮吴晴看下", 28, true)], layout),
    [{ x0: 22, y0: 28, x1: 42, y1: 37 }]);
});

test("reuses known chat nicknames at word boundaries in messages and quotes", () => {
  const speaker = line("Kira", 5);
  const body = line("Ask Kira, not Kirana.", 28);
  const quote = line("Kira: Kira will check.", 450);
  const names = findRegions([speaker, body, quote], {
    ...layout,
    participantNames: [speaker.box],
    quoteBodies: [{ line: quote, start: 5 }],
  });
  assert.deepEqual(names, [
    { x0: 52, y0: 28, x1: 92, y1: 37 },
    { x0: 72, y0: 450, x1: 112, y1: 459 },
  ]);
});

test("keeps ordinary phrases and family references outside automatic name regions", () => {
  const text = ["什么意思", "请张贴公告", "等我哥来", "我们都很高兴", "让大家确认"];
  assert.deepEqual(findRegions(text.map((value, i) => line(value, 25 + 25 * i)), layout), []);
});

test("keeps adjacent text selectable without adding a second region over an avatar", () => {
  const caption = line("X 松饼");
  const avatar = { x0: 5, y0: 15, x1: 28, y1: 47 };
  assert.deepEqual(runs(caption, [avatar]), [{ start: 2, end: 4, box: { x0: 32, y0: 28, x1: 52, y1: 37 } }]);
  const joinedAvatar = { x0: 12, y0: 28, x1: 30, y1: 37 };
  assert.deepEqual(runs(line("X 松饼", 28, true), [joinedAvatar]), []);
});

function driftingHanLine(text, name) {
  const width = 220, height = 60;
  const data = new Uint8ClampedArray(width * height * 4).fill(247);
  for (const [i, value] of [...text].entries()) {
    const left = 14 + i * 20;
    for (let y = 18; y < 36; y++) {
      for (let x = left; x < left + (value === ":" ? 4 : 15); x++) {
        data.fill(119, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    }
  }
  const box = { x0: 12, y0: 8, x1: 191, y1: 45 };
  const first = text.indexOf(name);
  const spans = [...text].map((_, i) => {
    const x0 = box.x0 + i * 20 + (i >= first && i < first + name.length ? 8 : 0);
    return { start: i, end: i + 1, box: { ...box, x0, x1: x0 + 15 } };
  });
  const line = { text, spans, box };
  const canvas = { width, height, getContext: () => ({ getImageData(x, y, w, h) {
    const crop = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const first = ((y + row) * width + x) * 4;
      crop.set(data.subarray(first, first + w * 4), row * w * 4);
    }
    return { data: crop };
  } }) };
  return { line, canvas };
}

test("uses the gaps between Han glyphs when quote OCR boxes drift into adjacent words", () => {
  const { line, canvas } = driftingHanLine("松饼:麻烦何姐回复", "何姐");
  const [name] = findRegions([line], { ...layout, quoteBodies: [{ line, start: 3 }] }, canvas);
  assert(name.x0 >= 109 && name.x0 <= 114);
  assert(name.x1 >= 149 && name.x1 <= 154);
  assert.deepEqual([name.y0, name.y1], [17, 37]);
});

test("stops an inline nickname box before the next Han glyph in a chat message", () => {
  const { line, canvas } = driftingHanLine("林哥现在到了", "林哥");
  const [name] = findRegions([line], layout, canvas);
  assert.equal(name.x0, 14);
  assert(name.x1 >= 49 && name.x1 <= 54);
  assert.deepEqual([name.y0, name.y1], [17, 37]);
});
