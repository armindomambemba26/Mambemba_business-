/*!
 * qrcode.js - vendored minimal QR Code generator (pure JS, no dependencies)
 * Implements the standard QR Code (ISO/IEC 18004) algorithm: byte-mode
 * encoding, Reed-Solomon error correction, matrix placement and mask
 * selection. Works fully offline in the browser. Renders to <canvas>.
 *
 * Usage:
 *   MBQRCode.renderToCanvas(canvasEl, "text to encode", { size: 220 });
 */
(function (global) {
  "use strict";

  var EC_LEVEL_L = 1, EC_LEVEL_M = 0, EC_LEVEL_Q = 3, EC_LEVEL_H = 2;

  var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  function getBCHDigit(data) {
    var digit = 0;
    while (data !== 0) { digit++; data >>>= 1; }
    return digit;
  }
  function getBCHTypeInfo(data) {
    var d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) { d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15))); }
    return ((data << 10) | d) ^ G15_MASK;
  }
  function getBCHTypeNumber(data) {
    var d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) { d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18))); }
    return (data << 12) | d;
  }

  var PATTERN_POSITION_TABLE = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94]
  ];

  var MAX_LENGTH = [
    // index by version(1-20) then EC level M/L/H/Q order not used; we compute capacity generically instead
  ];

  // RS block table: [version][ecLevel] -> {totalCount, dataCount, blocks}
  // We only need EC level L and M for up to version 20 which covers our short strings comfortably.
  var RS_BLOCK_TABLE = {
    L: [
      [26, 19, 1], [44, 34, 1], [70, 55, 1], [100, 80, 1], [134, 108, 1], [172, 136, 1], [196, 156, 2],
      [242, 194, 2], [292, 232, 2], [346, 274, 2], [404, 324, 4], [466, 370, 4], [532, 428, 4],
      [581, 461, 4], [655, 523, 6], [733, 589, 6], [815, 647, 6], [901, 721, 6], [991, 795, 7], [1085, 861, 8]
    ],
    M: [
      [26, 16, 1], [44, 28, 1], [70, 44, 1], [100, 64, 2], [134, 86, 2], [172, 108, 4], [196, 124, 4],
      [242, 154, 4], [292, 182, 5], [346, 216, 5], [404, 254, 5], [466, 290, 8], [532, 334, 9],
      [581, 365, 9], [655, 415, 10], [733, 453, 10], [815, 507, 11], [901, 563, 13], [991, 627, 14], [1085, 669, 16]
    ]
  };

  var EC_CODEWORDS_PER_BLOCK = { L: [7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28],
                                  M: [10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26] };

  var GEXP = new Array(256), GLOG = new Array(256);
  (function initGaloisTables() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GEXP[i] = x; GLOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) GEXP[j] = GEXP[j - 255];
  })();
  function gmul(a, b) { if (a === 0 || b === 0) return 0; return GEXP[GLOG[a] + GLOG[b]]; }

  function rsGeneratorPoly(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], GEXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(dataCodewords, ecCount) {
    var gen = rsGeneratorPoly(ecCount);
    var buf = dataCodewords.slice();
    for (var i = 0; i < ecCount; i++) buf.push(0);
    for (i = 0; i < dataCodewords.length; i++) {
      var coef = buf[i];
      if (coef === 0) continue;
      for (var j = 0; j < gen.length; j++) {
        buf[i + j] ^= gmul(gen[j], coef);
      }
    }
    return buf.slice(dataCodewords.length);
  }

  function chooseVersionAndLevel(byteLength) {
    var levels = ["L", "M"];
    for (var lvIdx = 0; lvIdx < levels.length; lvIdx++) {
      var lv = levels[lvIdx];
      for (var v = 1; v <= 20; v++) {
        var row = RS_BLOCK_TABLE[lv][v - 1];
        var dataCount = row[1];
        // 8-bit byte mode header: 4 bits mode + charCountBits + 8*len, roughly
        var charCountBits = (v <= 9) ? 8 : 16;
        var headerBits = 4 + charCountBits;
        var capacityBits = dataCount * 8;
        var neededBits = headerBits + byteLength * 8 + 4; // + terminator
        if (neededBits <= capacityBits) return { version: v, level: lv };
      }
    }
    return { version: 20, level: "L" };
  }

  function BitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  BitBuffer.prototype.put = function (num, len) {
    for (var i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1);
  };
  BitBuffer.prototype.putBit = function (bit) {
    var idx = Math.floor(this.length / 8);
    if (this.buffer.length <= idx) this.buffer.push(0);
    if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8));
    this.length++;
  };

  function encodeData(text, version, level) {
    var bytes = [];
    var utf8 = unescape(encodeURIComponent(text));
    for (var i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);

    var buf = new BitBuffer();
    buf.put(4, 4); // byte mode
    var charCountBits = (version <= 9) ? 8 : 16;
    buf.put(bytes.length, charCountBits);
    for (i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    var row = RS_BLOCK_TABLE[level][version - 1];
    var totalDataCodewords = row[1];
    var totalCapacityBits = totalDataCodewords * 8;

    if (buf.length + 4 <= totalCapacityBits) buf.put(0, 4);
    while (buf.length % 8 !== 0) buf.putBit(false);

    var padAlt = true;
    while (buf.buffer.length < totalDataCodewords) {
      buf.buffer.push(padAlt ? 0xEC : 0x11);
      padAlt = !padAlt;
      buf.length = buf.buffer.length * 8;
    }
    return buf.buffer.slice(0, totalDataCodewords);
  }

  function buildBlocks(dataCodewords, version, level) {
    var row = RS_BLOCK_TABLE[level][version - 1];
    var totalCount = row[0], dataCount = row[1], numBlocks = row[2];
    var ecCountTotal = totalCount - dataCount;
    var ecCountPerBlock = Math.floor(ecCountTotal / numBlocks);
    var dataCountPerBlock = Math.floor(dataCount / numBlocks);
    var extraBlocks = dataCount % numBlocks; // blocks that get 1 extra data codeword

    var blocks = [];
    var offset = 0;
    for (var b = 0; b < numBlocks; b++) {
      var dc = dataCountPerBlock + (b >= numBlocks - extraBlocks ? 1 : 0);
      var blockData = dataCodewords.slice(offset, offset + dc);
      offset += dc;
      var ec = rsEncode(blockData, ecCountPerBlock);
      blocks.push({ data: blockData, ec: ec });
    }

    var interleaved = [];
    var maxDc = Math.max.apply(null, blocks.map(function (bl) { return bl.data.length; }));
    for (var i = 0; i < maxDc; i++) {
      blocks.forEach(function (bl) { if (i < bl.data.length) interleaved.push(bl.data[i]); });
    }
    var maxEc = ecCountPerBlock;
    for (i = 0; i < maxEc; i++) {
      blocks.forEach(function (bl) { interleaved.push(bl.ec[i]); });
    }
    return interleaved;
  }

  function QRMatrix(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = [];
    for (var r = 0; r < this.size; r++) {
      this.modules.push(new Array(this.size).fill(null));
    }
  }
  QRMatrix.prototype.setFinder = function (row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || rr >= this.size || cc < 0 || cc >= this.size) continue;
        var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        this.modules[rr][cc] = dark;
      }
    }
  };
  QRMatrix.prototype.setTiming = function () {
    for (var i = 8; i < this.size - 8; i++) {
      if (this.modules[i][6] === null) this.modules[i][6] = (i % 2 === 0);
      if (this.modules[6][i] === null) this.modules[6][i] = (i % 2 === 0);
    }
  };
  QRMatrix.prototype.setAlignment = function () {
    var pos = PATTERN_POSITION_TABLE[this.version - 1] || [];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i], col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            var dark = (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
            this.modules[row + r][col + c] = dark;
          }
        }
      }
    }
  };
  QRMatrix.prototype.setDarkModule = function () {
    this.modules[this.size - 8][8] = true;
  };
  QRMatrix.prototype.reserveFormatAreas = function () {
    for (var i = 0; i < 9; i++) {
      if (this.modules[8][i] === null) this.modules[8][i] = false;
      if (this.modules[i][8] === null) this.modules[i][8] = false;
    }
    for (i = 0; i < 8; i++) {
      if (this.modules[8][this.size - 1 - i] === null) this.modules[8][this.size - 1 - i] = false;
      if (this.modules[this.size - 1 - i][8] === null) this.modules[this.size - 1 - i][8] = false;
    }
    if (this.version >= 7) {
      for (var r = 0; r < 6; r++) for (var c = 0; c < 3; c++) {
        this.modules[r][this.size - 11 + c] = false;
        this.modules[this.size - 11 + c][r] = false;
      }
    }
  };
  QRMatrix.prototype.placeData = function (dataBits) {
    var inc = -1, row = this.size - 1, bitIndex = 0, byteIndex = 0;
    var col = this.size - 1;
    while (col > 0) {
      if (col === 6) col--;
      while (true) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (this.modules[row][cc] === null) {
            var dark = false;
            if (byteIndex < dataBits.length) {
              dark = ((dataBits[byteIndex] >>> (7 - bitIndex)) & 1) === 1;
            }
            this.modules[row][cc] = dark;
            bitIndex++;
            if (bitIndex === 8) { bitIndex = 0; byteIndex++; }
          }
        }
        row += inc;
        if (row < 0 || row >= this.size) { row -= inc; inc = -inc; break; }
      }
      col -= 2;
    }
  };
  function maskFunc(maskType, r, c) {
    switch (maskType) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
    return false;
  }
  QRMatrix.prototype.applyMask = function (maskType, isFunctionModule) {
    for (var r = 0; r < this.size; r++) {
      for (var c = 0; c < this.size; c++) {
        if (isFunctionModule[r][c]) continue;
        if (maskFunc(maskType, r, c)) this.modules[r][c] = !this.modules[r][c];
      }
    }
  };
  QRMatrix.prototype.setFormatInfo = function (level, maskType) {
    var levelBits = { L: 1, M: 0, Q: 3, H: 2 }[level];
    var data = (levelBits << 3) | maskType;
    var bits = getBCHTypeInfo(data);
    var n = this.size, i, mod;

    // vertical strip near top-left finder + bottom-left column
    for (i = 0; i < 15; i++) {
      mod = ((bits >>> i) & 1) === 1;
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[n - 15 + i][8] = mod;
    }
    // horizontal strip near top-left finder + top-right row
    for (i = 0; i < 15; i++) {
      mod = ((bits >>> i) & 1) === 1;
      if (i < 8) this.modules[8][n - i - 1] = mod;
      else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
      else this.modules[8][15 - i - 1] = mod;
    }
    // fixed dark module
    this.modules[n - 8][8] = true;
  };
  QRMatrix.prototype.penalty = function () {
    var size = this.size, m = this.modules, score = 0, r, c;
    for (r = 0; r < size; r++) {
      var runColor = null, runLen = 0;
      for (c = 0; c < size; c++) {
        if (m[r][c] === runColor) { runLen++; } else { if (runLen >= 5) score += runLen - 2; runColor = m[r][c]; runLen = 1; }
      }
      if (runLen >= 5) score += runLen - 2;
    }
    for (c = 0; c < size; c++) {
      var runColor2 = null, runLen2 = 0;
      for (r = 0; r < size; r++) {
        if (m[r][c] === runColor2) { runLen2++; } else { if (runLen2 >= 5) score += runLen2 - 2; runColor2 = m[r][c]; runLen2 = 1; }
      }
      if (runLen2 >= 5) score += runLen2 - 2;
    }
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    var darkCount = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) darkCount++;
    var ratio = Math.abs((100 * darkCount / (size * size)) - 50) / 5;
    score += Math.floor(ratio) * 10;
    return score;
  };

  function generateMatrix(text) {
    var choice = chooseVersionAndLevel(unescape(encodeURIComponent(text)).length);
    var version = choice.version, level = choice.level;
    var dataCodewords = encodeData(text, version, level);
    var finalBits = buildBlocks(dataCodewords, version, level);

    var funcMap = [];
    var best = null;
    for (var maskType = 0; maskType < 8; maskType++) {
      var qm = new QRMatrix(version);
      qm.setFinder(0, 0);
      qm.setFinder(0, qm.size - 7);
      qm.setFinder(qm.size - 7, 0);
      qm.setTiming();
      qm.setAlignment();
      qm.setDarkModule();
      qm.reserveFormatAreas();

      var isFunc = [];
      for (var r = 0; r < qm.size; r++) {
        var rowArr = [];
        for (var c = 0; c < qm.size; c++) rowArr.push(qm.modules[r][c] !== null);
        isFunc.push(rowArr);
      }
      qm.placeData(finalBits);
      qm.applyMask(maskType, isFunc);
      qm.setFormatInfo(level, maskType);
      var pen = qm.penalty();
      if (!best || pen < best.pen) best = { qm: qm, pen: pen, maskType: maskType };
    }
    return best.qm;
  }

  function renderToCanvas(canvas, text, opts) {
    opts = opts || {};
    var size = opts.size || 220;
    var margin = opts.margin != null ? opts.margin : 4;
    var dark = opts.dark || "#111111";
    var light = opts.light || "#ffffff";
    var qm = generateMatrix(text);
    var n = qm.size;
    var cell = Math.floor(size / (n + margin * 2));
    if (cell < 1) cell = 1;
    var pixelSize = cell * (n + margin * 2);
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, pixelSize, pixelSize);
    ctx.fillStyle = dark;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qm.modules[r][c]) {
          ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
        }
      }
    }
    return canvas;
  }

  global.MBQRCode = { renderToCanvas: renderToCanvas };
})(window);
