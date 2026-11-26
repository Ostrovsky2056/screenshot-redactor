const assert = require("node:assert/strict");
const test = require("node:test");
const { findRegions, matchQuoteSpeakers } = require("../assets/chat-layout.js");
const mentions = require("../assets/chat-mentions.js");
const { boxForRange } = require("../assets/sensitive-text.js");
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
    const body = pic.label("龙哥刚刚到了", 100, 76);
    pic.fill(89, 125, 3, 43, dark ? [104, 108, 118] : [205, 205, 205]);
    const quoteLine = pic.label("片羽: 麻烦何姐回复", 100, 135);
    pic.label("我找陈小雨确认", 100, 152);

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

    assert.deepEqual(result.quoteBodies.map(({ line, start }) => line.text.slice(start).trim()),
      ["麻烦何姐回复", "我找陈小雨确认"]);
    const names = mentions.findRegions(pic.lines, { ...result, participantNames: result.associatedNames });
    for (const [text, name] of [["龙哥刚刚到了", "龙哥"], ["片羽: 麻烦何姐回复", "何姐"], ["我找陈小雨确认", "陈小雨"]]) {
      const line = pic.lines.find(line => line.text === text);
      const start = text.indexOf(name);
      assert(names.some(box => {
        const expected = boxForRange(line, start, start + name.length);
        return box.x0 === expected.x0 && box.x1 === expected.x1 && box.y0 === expected.y0 && box.y1 === expected.y1;
      }));
    }
    assert.equal(names.length, 3);
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

test("makes a nickname box follow the glyphs when OCR includes extra vertical space", () => {
  const pic = frame();
  pic.avatar(22, 30, [216, 170, 122]);
  const expected = pic.label("小松饼", 89, 37);
  pic.fill(90, 30, 33, 1, [125, 130, 135]);
  pic.fill(90, 34, 9, 2, [125, 130, 135]);
  const nickname = pic.lines[0];
  nickname.box = { ...nickname.box, y0: 30, y1: 57 };
  nickname.spans = nickname.spans.map(span => ({ ...span, box: { ...span.box, y0: 30, y1: 57 } }));
  pic.fill(80, 58, 240, 56, [230, 231, 235], 9);
  pic.label("Message", 105, 78);
  const result = findRegions(pic, pic.lines, model);
  assert.deepEqual(result.associatedNames, [{ ...expected, y0: 34 }]);
  assert.equal(result.profiles[0].name.line, nickname);
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

test("reuses a speaker code on a repeated avatar and matching quote sender", () => {
  const pic = frame();
  const portrait = [128, 178, 214];
  pic.avatar(22, 20, portrait);
  const firstName = pic.label("片 羽", 88, 22);
  pic.fill(80, 45, 234, 55, [230, 231, 235], 9);
  pic.label("刚开始", 100, 65);
  pic.fill(89, 112, 3, 40, [205, 205, 205]);
  const quote = pic.label("片羽：之前的回复", 100, 124);

  pic.avatar(22, 180, [222, 188, 122]);
  pic.label("远岚", 88, 182);
  pic.fill(80, 205, 246, 55, [230, 231, 235], 9);
  pic.label("收到回复", 100, 225);

  pic.avatar(22, 310, portrait);
  pic.fill(80, 310, 232, 52, [230, 231, 235], 9);
  pic.label("再发一次", 100, 329);

  const result = findRegions(pic, pic.lines, model);
  const ordered = [...result.avatars].sort((a, b) => a.y0 - b.y0);
  assert.deepEqual(ordered.map(box => result.speakerIds.get(box)), [0, 1, 0]);
  const nickname = result.associatedNames.find(box => covers([box], firstName));
  const sender = result.associatedNames.find(box => box.y0 === quote.y0);
  assert.equal(result.speakerIds.get(nickname), 0);
  assert.equal(result.speakerIds.get(sender), 0);
});

test("does not merge speakers with different nicknames even if their portraits match", () => {
  const pic = frame();
  const portrait = [200, 163, 195];
  for (const [y, label] of [[35, "木子"], [195, "竹子"]]) {
    pic.avatar(22, y, portrait);
    pic.label(label, 89, y + 2);
    pic.fill(80, y + 25, 234, 55, [230, 231, 235], 9);
    pic.label("一条消息", 100, y + 46);
  }
  const result = findRegions(pic, pic.lines, model);
  assert.equal(result.avatars.length, 2);
  assert.equal(new Set(result.avatars.map(box => result.speakerIds.get(box))).size, 2);
});

test("links a quote to a recovered nickname only when the speaker is unambiguous", () => {
  const first = { avatar: {}, name: { box: {}, label: "" } };
  const second = { avatar: {}, name: { box: {}, label: "山茶" } };
  const ids = new Map([[first.avatar, 0], [second.avatar, 1]]);
  const clear = { box: {}, label: "远 岚" };
  matchQuoteSpeakers([first, second], [clear], ids, new Map([[first.name.box, "远岚"]]));
  assert.equal(ids.get(clear.box), 0);

  const ambiguous = { box: {}, label: "山茶" };
  matchQuoteSpeakers([first, second], [ambiguous], ids, new Map([[first.name.box, "山茶"]]));
  assert.equal(ids.has(ambiguous.box), false);
});

test("covers a group title and the visible part of a repeated avatar at the pane edge", () => {
  const pic = frame();
  const portrait = [176, 197, 231];
  pic.avatar(22, 22, portrait);
  pic.fill(0, 0, pic.width, 50, [247, 247, 247]);
  pic.label("Studio room (4)", 24, 17);
  pic.fill(81, 50, 266, 44, [230, 231, 235]);
  pic.label("First", 99, 68);
  for (const [y, tone] of [[144, portrait], [284, [205, 169, 122]]]) {
    pic.avatar(22, y, tone);
    pic.label("Mira", 88, y + 1);
    pic.fill(81, y + 25, 223, 52, [230, 231, 235], 8);
    pic.label("Message", 100, y + 43);
  }
  const result = findRegions(pic, pic.lines, model);
  assert.equal(result.groupTitle.x1, boxForRange(pic.lines[0], 0, 11).x1);
  const fragment = result.avatars.find(box => box.clipped);
  assert(fragment);
  assert.deepEqual([fragment.y0, fragment.y1], [50, 70]);
  const reference = result.avatars.find(box => box.y0 === 144);
  assert.equal(result.speakerIds.get(fragment), result.speakerIds.get(reference));
});

test("recovers a narrow repeated avatar and uses the same mask size as the other full avatars", () => {
  const pic = frame();
  const portrait = [168, 190, 229];
  for (const [y, tone] of [[24, portrait], [154, [223, 175, 130]]]) {
    pic.avatar(22, y, tone);
    pic.fill(85, y + 23, 214, 52, [230, 231, 235], 8);
    pic.label("Message", 105, y + 44);
  }
  pic.avatar(22, 307, portrait);
  pic.fill(22, 307, 8, 48, [247, 247, 247]);
  pic.fill(62, 307, 8, 48, [247, 247, 247]);
  pic.fill(100, 331, 48, 50, [96, 82, 133], 9);
  const result = findRegions(pic, pic.lines, model);
  assert.equal(result.avatars.length, 3);
  assert(result.avatars.every(box => box.x1 - box.x0 === 48 && box.y1 - box.y0 === 48));
  const matched = result.avatars.filter(box => box.y0 === 24 || box.y0 === 307);
  assert.equal(matched.length, 2);
  assert.equal(new Set(matched.map(box => result.speakerIds.get(box))).size, 1);
});
