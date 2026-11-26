const assert = require("node:assert/strict");
const test = require("node:test");
const { findRegions, refineRegions, croppedRegions } = require("../assets/chat-mentions.js");
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

test("uses reread symbol boxes for both occurrences of the same mixed-script mention", async () => {
  const speaker = line("Mira", 5);
  const first = line("请 Mira 回复，Mira确认", 28, true);
  const second = line("请 MIRA 回复，Mira确认");
  const result = await refineRegions([speaker, first], { ...layout, participantNames: [speaker.box] }, null, boxes => {
    assert.deepEqual(boxes, [first.box]);
    return new Map([[boxes[0], { line: second, confidence: 95 }]]);
  });
  assert.deepEqual(result, [
    { box: { x0: 32, y0: 28, x1: 72, y1: 37 }, pending: false },
    { box: { x0: 112, y0: 28, x1: 152, y1: 37 }, pending: false },
  ]);
});

test("leaves a name pending when the reread cannot separate it from the surrounding word", async () => {
  const first = line("帮吴晴看下", 28, true);
  const result = await refineRegions([first], layout, null, boxes => {
    assert.deepEqual(boxes, [first.box]);
    return new Map([[boxes[0], { line: first, confidence: 95 }]]);
  });
  assert.deepEqual(result, [{ box: first.box, pending: true }]);
});

test("can recover an explicit mixed-script mention on the reread", async () => {
  const first = line("请 #Mira 确认");
  const second = line("请 @Mira 确认");
  const result = await refineRegions([first], layout, null, boxes =>
    new Map([[boxes[0], { line: second, confidence: 95 }]]));
  assert.deepEqual(result, [{ box: { x0: 42, y0: 28, x1: 82, y1: 37 }, pending: false }]);
});

test("does not reread an outline mistaken for a thin line of text", async () => {
  const outline = line("ee ase ee", 90, true);
  outline.box.y1 = 93;
  outline.confidence = 28;
  const result = await refineRegions([outline], layout, null, () => assert.fail("Unexpected OCR reread"));
  assert.deepEqual(result, []);
});

test("recovers a nickname from a missed color bubble and leaves its message text visible", () => {
  const reading = line("阿澄，试试");
  const crops = new Map([[reading.box, { line: reading, confidence: 94 }]]);
  assert.deepEqual(croppedRegions([], layout, null, crops), [{ x0: 12, y0: 28, x1: 32, y1: 37 }]);
  assert.deepEqual(croppedRegions([], { ...layout, messages: [] }, null, crops), []);
});

test("does not interpret a tall, separated poll control as a mention", () => {
  const poll = line("@ Ends in 1d");
  poll.spans[0].box = { x0: 12, x1: 23, y0: 20, y1: 43 };
  const actual = line("@Mira");
  assert.deepEqual(findRegions([poll, actual], layout), [{ x0: 22, x1: 62, y0: 28, y1: 37 }]);
});

test("isolates a mixed-script account echoed in a card even with noisy title OCR", () => {
  const actual = line("您对 7788 茶 馆 1008 的服务满意吗？", 111);
  const longer = line("您对 7788 茶 馆 10080 的服务满意吗？", 131);
  const different = line("您对 7788 茶 馆 1006 的服务满意吗？", 151);
  const start = actual.text.indexOf("7788");
  const end = actual.text.indexOf("1008") + 4;
  const chat = { ...layout, header: { kind: "inline", text: "7788/X\\Y\\ 381008", bodyTop: 91, pane: {x0: 0, x1: 700} } };
  assert.deepEqual(findRegions([actual, longer, different], chat),
    [{ x0: 12 + 10 * start, y0: 111, x1: 12 + 10 * end, y1: 120 }]);
  assert.deepEqual(findRegions([actual], { ...chat, header: { ...chat.header, count: message } }), []);
});

test("recovers a styled direct address and leaves the sentence punctuation visible", async () => {
  const body = { x0: 0, y0: 20, x1: 300, y1: 55 };
  const chat = { ...layout, groupTitle: line("Weekend plans", 5).box, addressBodies: [body] };
  const first = { ...line("I'll grab it, Jordan."), confidence: 88 };
  const start = first.text.indexOf("Jordan");
  const end = start + "Jordan".length;
  const nameX = first.box.x0 + 10 * start;
  const periodX = first.box.x0 + 10 * end;
  // OCR partly puts the last glyph into the following period's box.
  const local = {
    ...first,
    spans: first.spans.map(span => span.end === end
      ? { ...span, box: { ...span.box, x1: span.box.x0 + 4 } }
      : span.start === end ? { ...span, box: { ...span.box, x0: periodX - 5 } } : span),
  };
  const canvas = {
    width: 310, height: 60, getContext: () => ({
      getImageData(x, y, width, height) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          const col = x + i % width, row = y + Math.floor(i / width);
          const textX = col - first.box.x0;
          const char = first.text[Math.floor(textX / 10)] || " ";
          const offset = textX % 10;
          const stroke = col >= nameX && col < periodX ? 7 : 4;
          const ink = /[a-z]/i.test(char) ? offset >= 2 && offset < stroke && row >= 29 && row < 35 :
            /[,.]/.test(char) && offset >= 2 && offset < 4 && row >= 34 && row < 36;
          const level = ink ? 12 : (row + col) % 2 ? 231 : 234;
          data.fill(level, i * 4, i * 4 + 4);
        }
        return { data };
      },
    }),
  };
  const read = async boxes => {
    assert.deepEqual(boxes, [first.box]);
    return new Map([[first.box, { line: local, confidence: 90 }]]);
  };
  assert.deepEqual(await refineRegions([first], chat, canvas, read), [
    { box: { x0: nameX - 1, y0: 27, x1: periodX + 1, y1: 38 }, pending: false, preserveBounds: true },
  ]);
  assert.deepEqual(await refineRegions([first], { ...chat, addressBodies: [] }, canvas,
    () => assert.fail("Unexpected OCR outside a message")), []);
  const weekday = { ...line("We can go, Friday."), confidence: 88 };
  assert.deepEqual(await refineRegions([weekday], chat, canvas,
    () => assert.fail("Unexpected OCR for a weekday")), []);
  assert.deepEqual(await refineRegions([first], chat, null, read), []);
});

test("recovers a caption participant inside a message and leaves the surrounding words selectable", async () => {
  const original = line("Great. Camille, you in?", 90);
  const quote = line("I spoke with Camille yesterday.", 110);
  const ordinary = line("On May 1, try Camilleston.", 130);
  const crops = [original.box, quote.box, ordinary.box];
  const names = await refineRegions([], { ...layout, captionLabels: ["Camille", "May"], knownNameCrops: crops }, null,
    boxes => {
      assert.deepEqual(boxes, crops);
      return new Map([original, quote, ordinary].map(line => [line.box, { line, confidence: 94 }]));
    });
  assert.deepEqual(names, [
    { box: { x0: 82, y0: 90, x1: 152, y1: 99 }, pending: false, preserveBounds: true },
    { box: { x0: 142, y0: 110, x1: 212, y1: 119 }, pending: false, preserveBounds: true },
  ]);
});

test("replaces a pending message suggestion when a caption confirms the exact name", async () => {
  const speaker = line("Mira", 5);
  const first = line("Hi, Mira, go", 28, true);
  const reading = line(first.text);
  const crop = { x0: 5, y0: 22, x1: 150, y1: 44 };
  const chat = { ...layout, participantNames: [speaker.box], captionLabels: ["Mira"], knownNameCrops: [crop] };
  const names = await refineRegions([speaker, first], chat, null, async boxes => {
    assert.deepEqual(boxes, [first.box, crop]);
    return new Map([[crop, { line: reading, confidence: 91 }]]);
  });
  assert.deepEqual(names, [
    { box: { x0: 52, y0: 28, x1: 92, y1: 37 }, pending: false, preserveBounds: true },
  ]);
});
