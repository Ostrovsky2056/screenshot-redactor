(() => {
  function isCard(value) {
    const digits = value.replace(/\D/g, "");
    if (/^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    for (let index = 0; index < digits.length; index++) {
      const digit = Number(digits[digits.length - index - 1]);
      const doubled = digit * 2;
      sum += index % 2 === 0 ? digit : doubled > 9 ? doubled - 9 : doubled;
    }
    return sum % 10 === 0;
  }

  const rules = [
    { type: "credential", pattern: /(?:^|[^A-Z\d])(?:password|(?:access +)?token|(?:api|access|secret|private) *key|secret|authorization|密 *码|令 *牌|密 *钥|私 *钥) *[:=] *([^,;，；|]{2,120})/gi },
    { type: "credential", pattern: /\b(?:AKIA[A-Z0-9]{16}|gh[pousr]_[A-Z0-9]{24,}|github_pat_[A-Z0-9_]{24,}|sk-[A-Z0-9_-]{16,}|eyJ[A-Z0-9_-]+ *\. *[A-Z0-9_-]+ *\. *[A-Z0-9_-]+)\b/gi },
    { type: "url", pattern: /(?<![A-Z0-9_])(?:https? *: *\/ *\/ *|www\.)[A-Z0-9][A-Z0-9._~%!?$&*+,;=:@/#-]*(?<![.,;:!?])/gi },
    { type: "email", pattern: /[A-Z0-9_%+'-]+(?: *\. *[A-Z0-9_%+'-]+)* *@ *(?:[A-Z0-9-]+ *\. *)+[A-Z]{2,24}\b/gi },
    { type: "identity", pattern: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?![\dX])/gi },
    { type: "card", pattern: /(?<!\d)\d(?:[ -]?\d){12,18}(?![ -]?\d)/g, validate: isCard },
    { type: "phone", pattern: /(?<![A-Z\d])(?:\+ *86[ -]*)?1[3-9](?:[ -]?\d){9}(?!\d)/gi },
    { type: "phone", pattern: /(?<![A-Z\d])(?:\+(?:\d[ ().-]?){7,14}\d|(?:\(?\d{3}\)?[ -])\d{3}[ -]\d{4}|0\d{2,3}[- ]\d{7,8})(?!\d)/gi },
    { type: "name", pattern: /(?:^|[^A-Z\d])(?:(?:full |display |user )?name|recipient|contact|姓 *名|名 *字|昵 *称|用 *户 *名|联 *系 *人|收 *件 *人) *[:=] *([\p{L}][\p{L}.'’ -]{1,55})/giu },
    { type: "address", pattern: /(?:^|[^A-Z\d])(?:(?:street|shipping|home) *address|地 *址|住 *址) *[:=] *([^;；|]{3,100})/gi },
  ];

  const textMaskTypes = new Set(rules.map(({ type }) => type));

  function readLine(words) {
    let text = "";
    const spans = [];
    for (const word of words) {
      const value = word.text.normalize("NFKC").trim();
      if (!value) continue;
      if (text) text += " ";
      const symbols = word.symbols || [];
      // Use character boxes when OCR supplied a complete spelling for this word.
      const canMap = symbols.length && symbols.every(symbol => symbol.bbox) &&
        symbols.map(symbol => symbol.text.normalize("NFKC")).join("") === value;
      for (const part of canMap ? symbols : [{ text: value, bbox: word.bbox }]) {
        const start = text.length;
        text += part.text.normalize("NFKC");
        spans.push({ start, end: text.length, box: part.bbox });
      }
    }
    return { text, spans };
  }

  function matches(text) {
    const ranges = [];
    for (const { type, pattern, validate } of rules) {
      for (const match of text.matchAll(pattern)) {
        const value = (match[1] || match[0]).trim();
        const start = match.index + match[0].lastIndexOf(value);
        const end = start + value.length;
        if (validate && !validate(value)) continue;
        ranges.push({ type, start, end });
      }
    }
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const last = merged[merged.length - 1];
      if (last && range.start < last.end) {
        last.end = Math.max(last.end, range.end);
      } else {
        merged.push(range);
      }
    }
    return merged;
  }

  function bounds(boxes) {
    return {
      x0: Math.min(...boxes.map(box => box.x0)),
      y0: Math.min(...boxes.map(box => box.y0)),
      x1: Math.max(...boxes.map(box => box.x1)),
      y1: Math.max(...boxes.map(box => box.y1)),
    };
  }

  function readLines(blocks) {
    const lines = [];
    for (const block of blocks || []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const parts = readLine(line.words);
          const boxes = parts.spans.filter(span => span.box).map(span => span.box);
          if (boxes.length) lines.push({ ...parts, box: bounds(boxes), confidence: line.confidence });
        }
      }
    }
    return lines;
  }

  function coverage(box, area) {
    const width = Math.min(box.x1, area.x1) - Math.max(box.x0, area.x0);
    const height = Math.min(box.y1, area.y1) - Math.max(box.y0, area.y0);
    const size = (box.x1 - box.x0) * (box.y1 - box.y0);
    return width > 0 && height > 0 && size > 0 ? width * height / size : 0;
  }

  function mergeMessageLines(lines, messages, readings) {
    const best = new Map();
    for (const [crop, { line, confidence }] of readings) {
      if (!line || !(confidence >= 65) || crop.outlined || crop.addressPrefix || !/[\p{L}\p{N}]/u.test(line.text)) continue;
      // A retry of only the nickname cannot replace the rest of the message.
      const message = messages.find(box => coverage(box, crop) >= .82 && coverage(line.box, box) >= .94);
      if (message && (!best.has(message) || confidence > best.get(message).confidence)) {
        best.set(message, { line, confidence });
      }
    }

    const replaced = new Set();
    const recovered = [];
    for (const [message, { line, confidence }] of best) {
      const sameRow = lines.filter(original => {
        const { box } = original;
        const middle = (box.y0 + box.y1) / 2;
        return middle >= message.y0 && middle <= message.y1 &&
          (coverage(line.box, box) >= .55 || coverage(box, line.box) >= .55);
      });
      // Keep a well-positioned, stronger or more complete reading of the row.
      if (sameRow.some(original => coverage(original.box, message) >= .94 &&
          coverage(line.box, original.box) >= .8 &&
          (original.confidence >= confidence || coverage(original.box, line.box) < .8))) continue;
      for (const original of sameRow) {
        if (coverage(original.box, message) < .94 || coverage(original.box, line.box) >= .8) replaced.add(original);
      }
      recovered.push(line);
    }
    return [...lines.filter(line => !replaced.has(line)), ...recovered];
  }

  function runs(line, excludedAreas = [], { skipSeparators = false, splitGaps = true } = {}) {
    const groups = [];
    let group;
    let afterExcluded = false;
    for (const span of line.spans) {
      if (!span.box) continue;
      const covered = excludedAreas.some(area => {
        const { x0, y0, x1, y1 } = span.box;
        const width = Math.min(x1, area.x1) - Math.max(x0, area.x0);
        const height = Math.min(y1, area.y1) - Math.max(y0, area.y0);
        const smaller = Math.min((x1 - x0) * (y1 - y0), (area.x1 - area.x0) * (area.y1 - area.y0));
        return width > 0 && height > 0 && width * height >= .5 * smaller;
      });
      if (covered) {
        // OCR may read details in an avatar or join it to another element.
        group = null;
        afterExcluded = true;
        continue;
      }
      if (skipSeparators && afterExcluded && /^[,，:：]$/u.test(line.text.slice(span.start, span.end))) continue;
      afterExcluded = false;
      const previous = group?.at(-1)?.box;
      if (previous && splitGaps) {
        const height = Math.max(previous.y1 - previous.y0, span.box.y1 - span.box.y0);
        const verticalOverlap = Math.min(previous.y1, span.box.y1) - Math.max(previous.y0, span.box.y0);
        const gap = span.box.x0 - previous.x1;
        const space = line.text.slice(group.at(-1).end, span.start);
        if (gap > 1.6 * height || (space && verticalOverlap <= 0)) group = null;
      }
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(span);
    }
    return groups.map(spans => ({
      start: spans[0].start,
      end: spans.at(-1).end,
      box: bounds(spans.map(span => span.box)),
    }));
  }

  function boxForRange(line, start, end, { wholeWords = false } = {}) {
    const boxes = [];
    for (const span of line.spans) {
      if (!span.box || span.end <= start || span.start >= end) continue;
      const { box } = span;
      if (wholeWords || (span.start >= start && span.end <= end)) {
        boxes.push(box);
        continue;
      }
      // OCR can supply a word box without individual glyph boxes. Crop the matched portion.
      const size = Array.from(line.text.slice(span.start, span.end)).length;
      const from = Array.from(line.text.slice(span.start, Math.max(start, span.start))).length;
      const to = Array.from(line.text.slice(span.start, Math.min(end, span.end))).length;
      const unit = (box.x1 - box.x0) / size;
      boxes.push({ ...box, x0: box.x0 + from * unit, x1: box.x0 + to * unit });
    }
    return boxes.length ? bounds(boxes) : null;
  }

  function exactBoxForRange(line, start, end) {
    let cursor = start;
    const boxes = [];
    for (const { start: left, end: right, box } of line.spans) {
      if (right <= start || left >= end) continue;
      if (!box || box.x1 <= box.x0 || box.y1 <= box.y0 || left < cursor || right > end ||
        line.text.slice(cursor, left).trim()) return null;
      boxes.push(box);
      cursor = right;
    }
    return boxes.length && !line.text.slice(cursor, end).trim() ? bounds(boxes) : null;
  }

  function scaleBox(box, type, original, scan, margin = 3) {
    const scaleX = original.width / scan.width;
    const scaleY = original.height / scan.height;
    const x = Math.max(0, Math.floor((box.x0 - margin) * scaleX));
    const y = Math.max(0, Math.floor((box.y0 - margin) * scaleY));
    const right = Math.min(original.width, Math.ceil((box.x1 + margin) * scaleX));
    const bottom = Math.min(original.height, Math.ceil((box.y1 + margin) * scaleY));
    return right > x && bottom > y ? { type, x, y, width: right - x, height: bottom - y } : null;
  }

  function findRegions(lines, original, scan, excluded = []) {
    const regions = [];
    for (const line of lines) {
      const excerpts = excluded.some(box => coverage(line.box, box) > 0)
        ? runs(line, excluded, { splitGaps: false }) : [{ start: 0, end: line.text.length }];
      for (const { start, end } of excerpts) {
        for (const match of matches(line.text.slice(start, end))) {
          const box = boxForRange(line, start + match.start, start + match.end, { wholeWords: true });
          const region = box && scaleBox(box, match.type, original, scan);
          if (region) regions.push(region);
        }
      }
    }
    return regions;
  }

  function avoidStickers(regions, stickers, original, scan) {
    if (!stickers.length) return regions;
    const areas = stickers.map(box => scaleBox(box, "graphic", original, scan, 0)).filter(Boolean);
    return regions.flatMap(region => {
      if (region.enabled === false && !region.pending) return [region];
      let pieces = [region];
      for (const area of areas) {
        pieces = pieces.flatMap(piece => {
          const right = piece.x + piece.width, bottom = piece.y + piece.height;
          const x0 = Math.max(piece.x, area.x), x1 = Math.min(right, area.x + area.width);
          const y0 = Math.max(piece.y, area.y), y1 = Math.min(bottom, area.y + area.height);
          if (x0 >= x1 || y0 >= y1) return [piece];
          return [
            { ...piece, height: y0 - piece.y },
            { ...piece, y: y1, height: bottom - y1 },
            { ...piece, y: y0, height: y1 - y0, width: x0 - piece.x },
            { ...piece, x: x1, y: y0, height: y1 - y0, width: right - x1 },
          ].filter(box => box.width > 0 && box.height > 0);
        });
      }
      return pieces;
    });
  }

  function alignMaskHeights(regions, lines, messages, original, scan) {
    const candidates = regions.filter(region => textMaskTypes.has(region.type) && region.enabled !== false &&
      !region.avatarNickname && !region.quoteSender && !region.originalBounds).sort((a, b) => b.height - a.height);
    if (candidates.length < 2) return regions;

    const rows = lines.map(({ box }) => scaleBox(box, "text", original, scan, 0)).filter(Boolean);
    const bubbles = messages.map(box => scaleBox(box, "bubble", original, scan, 0)).filter(Boolean);
    // Group similar line heights and use the tallest box in each group.
    let targetHeight = candidates[0].height;
    for (const region of candidates.slice(1)) {
      if (region.height < .75 * targetHeight) targetHeight = region.height;
      if (region.height === targetHeight) continue;

      const end = region.y + region.height;
      const middle = region.y + region.height / 2;
      const right = region.x + region.width;
      const bubble = bubbles.find(box => box.x <= region.x && right <= box.x + box.width &&
        box.y <= region.y && end <= box.y + box.height);
      let top = bubble?.y ?? 0;
      let bottom = bubble ? bubble.y + bubble.height : original.height;
      for (const row of rows) {
        if (row.x >= right || row.x + row.width <= region.x) continue;
        const rowEnd = row.y + row.height;
        if (rowEnd <= middle) top = Math.max(top, Math.min(region.y, rowEnd));
        if (row.y >= middle) bottom = Math.min(bottom, Math.max(end, row.y));
      }

      // Keep the recognized box fully covered and stay between nearby text rows.
      const earliest = Math.max(top, end - targetHeight);
      const latest = Math.min(region.y, bottom - targetHeight);
      if (earliest > latest) continue;
      const centered = region.y - Math.floor((targetHeight - region.height) / 2);
      region.detectedBounds = { x: region.x, y: region.y, width: region.width, height: region.height };
      region.y = Math.min(latest, Math.max(earliest, centered));
      region.height = targetHeight;
    }
    return regions;
  }

  const scanner = { readLines, mergeMessageLines, findRegions, scaleBox, alignMaskHeights, avoidStickers, runs, boxForRange, exactBoxForRange };
  if (typeof module !== "undefined") module.exports = scanner;
  else window.SensitiveText = scanner;
})();
