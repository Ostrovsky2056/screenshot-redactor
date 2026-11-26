const assert = require("node:assert/strict");
const test = require("node:test");
const { findRegions } = require("../assets/chat-layout.js");
const model = require("../assets/chat-layout-model.js");

function frame(dark = false) {
  const width = 840;
  const height = 440;
  const data = new Uint8ClampedArray(width * height * 4);
  const background = dark ? [25, 28, 34] : [247, 247, 247];
  const ink = dark ? [224, 224, 224] : [125, 130, 135];
  const lines = [];
  function fill(x, y, w, h, color, radius = 0) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const dx = Math.max(0, x + radius - xx, xx - (x + w - 1 - radius));
        const dy = Math.max(0, y + radius - yy, yy - (y + h - 1 - radius));
        if (dx * dx + dy * dy > radius * radius) continue;
        data.set([...color, 255], (yy * width + xx) * 4);
      }
    }
  }
  fill(0, 0, width, height, background);
  function label(text, x, y, recognized = true, size = 12) {
    let index = 0;
    const spans = [];
    Array.from(text).forEach((character, at) => {
      const left = x + at * size;
      if (character.trim()) {
        fill(left + 1, y, size - 3, 13, ink);
        spans.push({ start: index, end: index + character.length, box: { x0: left + 1, y0: y, x1: left + size - 2, y1: y + 13 } });
      }
      index += character.length;
    });
    const box = { x0: spans[0].box.x0, y0: y, x1: spans[spans.length - 1].box.x1, y1: y + 13 };
    if (recognized) lines.push({ box, text, spans });
    return box;
  }
  function avatar(x, y, color) {
    fill(x, y, 48, 48, color, 8);
    fill(x + 13, y + 12, 23, 20, [115, 84, 144], 5);
    fill(x + 15, y + 21, 16, 18, [210, 121, 87], 5);
  }
  return { width, height, data, lines, fill, avatar, label, dark };
}

function covers(list, box) {
  return list.some(other => other.x0 <= box.x0 + 2 && other.x1 >= box.x1 - 2 &&
    other.y0 <= box.y0 + 2 && other.y1 >= box.y1 - 2);
}

for (const dark of [false, true]) {
  test(`${dark ? "dark" : "light"} chat keeps avatars, unlabelled nicknames and quote senders distinct from messages`, () => {
    const pic = frame(dark);
    pic.avatar(22, 30, dark ? [32, 35, 46] : [255, 255, 239]);
    const incomingName = pic.label("mango_7🌙", 89, 32);
    pic.fill(80, 56, 300, 56, dark ? [52, 55, 62] : [230, 231, 235], 9);
    const body = pic.label("普通消息", 100, 76);
    pic.fill(89, 125, 3, 43, dark ? [104, 108, 118] : [205, 205, 205]);
    const quoteLine = pic.label("片羽: 引用正文", 100, 135);

    pic.avatar(765, 216, dark ? [112, 90, 160] : [130, 175, 208]);
    pic.fill(696, 216, 49, 50, dark ? [57, 94, 82] : [153, 233, 175], 9);
    const shortBody = pic.label("OK", 708, 234);

    const result = findRegions(pic, pic.lines, model);
    assert.equal(result.avatars.length, 2);
    assert(covers(result.avatars, { x0: 22, y0: 30, x1: 70, y1: 78 }));
    assert(covers(result.avatars, { x0: 765, y0: 216, x1: 813, y1: 264 }));
    assert(covers(result.associatedNames, incomingName));
    assert(covers(result.associatedNames, { ...quoteLine, x1: 122 }));
    assert(!covers(result.associatedNames, quoteLine));
    assert(!covers(result.associatedNames, body));
    assert(!covers(result.associatedNames, shortBody));
    assert(covers(result.messages, shortBody));
  });
}

test("grey nickname can be detected from its pixels when OCR misses the line", () => {
  const pic = frame();
  pic.avatar(23, 90, [253, 241, 222]);
  const missedName = pic.label("未读名字", 94, 92, false);
  pic.fill(83, 115, 264, 52, [233, 233, 235], 9);
  pic.label("Message", 104, 136);
  const result = findRegions(pic, pic.lines, model);
  assert(covers(result.associatedNames, missedName));
});

test("a central illustrated icon beside a flat widget does not become a chat avatar", () => {
  const pic = frame();
  pic.avatar(260, 110, [143, 207, 167]);
  pic.fill(319, 118, 145, 50, [227, 233, 242], 10);
  pic.label("Settings", 338, 139);
  const result = findRegions(pic, pic.lines, model);
  assert.deepEqual(result.avatars, []);
  assert.deepEqual(result.associatedNames, []);
});
