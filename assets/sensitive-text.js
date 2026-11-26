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
    { type: "email", pattern: /[A-Z0-9_%+'-]+(?: *\. *[A-Z0-9_%+'-]+)* *@ *(?:[A-Z0-9-]+ *\. *)+[A-Z]{2,24}\b/gi },
    { type: "identity", pattern: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?![\dX])/gi },
    { type: "card", pattern: /(?<!\d)\d(?:[ -]?\d){12,18}(?![ -]?\d)/g, validate: isCard },
    { type: "phone", pattern: /(?<![A-Z\d])(?:\+ *86[ -]*)?1[3-9](?:[ -]?\d){9}(?!\d)/gi },
    { type: "phone", pattern: /(?<![A-Z\d])(?:\+(?:\d[ ().-]?){7,14}\d|(?:\(?\d{3}\)?[ -])\d{3}[ -]\d{4}|0\d{2,3}[- ]\d{7,8})(?!\d)/gi },
    { type: "name", pattern: /(?:^|[^A-Z\d])(?:(?:full |display |user )?name|recipient|contact|姓 *名|名 *字|昵 *称|用 *户 *名|联 *系 *人|收 *件 *人) *[:=] *([\p{L}][\p{L}.'’ -]{1,55})/giu },
    { type: "address", pattern: /(?:^|[^A-Z\d])(?:(?:street|shipping|home) *address|地 *址|住 *址) *[:=] *([^;；|]{3,100})/gi },
  ];

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
          if (boxes.length) lines.push({ ...parts, box: bounds(boxes) });
        }
      }
    }
    return lines;
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

  function findRegions(lines, original, scan) {
    const regions = [];
    for (const { text, spans } of lines) {
      for (const { type, start, end } of matches(text)) {
        const boxes = spans.filter(span => span.start < end && span.end > start && span.box).map(span => span.box);
        if (!boxes.length) continue;
        const region = scaleBox(bounds(boxes), type, original, scan);
        if (region) regions.push(region);
      }
    }
    return regions;
  }

  const scanner = { readLines, findRegions, scaleBox };
  if (typeof module !== "undefined") module.exports = scanner;
  else window.SensitiveText = scanner;
})();
