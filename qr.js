/*
  Compact QR Code generator based on the public domain qrcode-generator
  algorithm by Kazuhiko Arase. Supports byte-mode QR codes with automatic
  type selection and error correction level M.
*/

const QR_PAD0 = 0xec;
const QR_PAD1 = 0x11;
const QR_ERROR_CORRECT_M = 0;
const QR_MODE_8BIT_BYTE = 1 << 2;

const QR_RS_BLOCK_TABLE = [
  [1, 26, 16],
  [1, 44, 28],
  [1, 70, 44],
  [2, 50, 32],
  [2, 67, 43],
  [4, 43, 27],
  [4, 49, 31],
  [2, 60, 38, 2, 61, 39],
  [3, 58, 36, 2, 59, 37],
  [4, 69, 43, 1, 70, 44],
];

const QR_G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const QR_G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const QR_G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
const QR_PATTERN_POSITION_TABLE = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
];

function drawQrToCanvas(canvas, text, outputSize, marginModules) {
  const qr = createQr(text);
  const moduleCount = qr.moduleCount;
  const totalModules = moduleCount + marginModules * 2;
  const cellSize = Math.floor(outputSize / totalModules);

  if (cellSize < 1) {
    throw new Error("Размер изображения слишком маленький.");
  }

  const realSize = cellSize * totalModules;
  canvas.width = realSize;
  canvas.height = realSize;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, realSize, realSize);
  ctx.fillStyle = "#111827";

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.isDark(row, col)) {
        ctx.fillRect((col + marginModules) * cellSize, (row + marginModules) * cellSize, cellSize, cellSize);
      }
    }
  }
}

function createQr(text) {
  const bytes = Array.from(new TextEncoder().encode(text));

  for (let typeNumber = 1; typeNumber <= QR_RS_BLOCK_TABLE.length; typeNumber += 1) {
    const rsBlocks = getRsBlocks(typeNumber);
    const buffer = new BitBuffer();
    buffer.put(QR_MODE_8BIT_BYTE, 4);
    buffer.put(bytes.length, typeNumber < 10 ? 8 : 16);

    for (const byte of bytes) {
      buffer.put(byte, 8);
    }

    const totalDataCount = getTotalDataCount(rsBlocks);
    const capacityBits = totalDataCount * 8;
    const terminatorBits = Math.min(4, Math.max(0, capacityBits - buffer.length));
    const paddedLength = Math.ceil((buffer.length + terminatorBits) / 8) * 8;

    if (paddedLength <= capacityBits) {
      return makeQr(typeNumber, bytes, rsBlocks);
    }
  }

  throw new Error("Ссылка слишком длинная. Попробуй укоротить URL.");
}

function makeQr(typeNumber, bytes, rsBlocks) {
  let bestModules = null;
  let bestLostPoint = Number.POSITIVE_INFINITY;

  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const modules = setupModules(typeNumber);
    setupTypeInfo(modules, maskPattern);

    if (typeNumber >= 7) {
      setupTypeNumber(modules, typeNumber);
    }

    const data = createData(typeNumber, bytes, rsBlocks);
    mapData(modules, data, maskPattern);
    const lostPoint = getLostPoint(modules);

    if (lostPoint < bestLostPoint) {
      bestLostPoint = lostPoint;
      bestModules = modules;
    }
  }

  return {
    moduleCount: bestModules.length,
    isDark(row, col) {
      return bestModules[row][col];
    },
  };
}

function setupModules(typeNumber) {
  const moduleCount = typeNumber * 4 + 17;
  const modules = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(null));
  setupPositionProbePattern(modules, 0, 0);
  setupPositionProbePattern(modules, moduleCount - 7, 0);
  setupPositionProbePattern(modules, 0, moduleCount - 7);
  setupPositionAdjustPattern(modules, typeNumber);
  setupTimingPattern(modules);
  return modules;
}

function setupPositionProbePattern(modules, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r <= -1 || modules.length <= row + r) {
      continue;
    }

    for (let c = -1; c <= 7; c += 1) {
      if (col + c <= -1 || modules.length <= col + c) {
        continue;
      }

      modules[row + r][col + c] =
        (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
        (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
        (2 <= r && r <= 4 && 2 <= c && c <= 4);
    }
  }
}

function setupTimingPattern(modules) {
  for (let i = 8; i < modules.length - 8; i += 1) {
    if (modules[i][6] === null) {
      modules[i][6] = i % 2 === 0;
    }

    if (modules[6][i] === null) {
      modules[6][i] = i % 2 === 0;
    }
  }
}

function setupPositionAdjustPattern(modules, typeNumber) {
  const positions = QR_PATTERN_POSITION_TABLE[typeNumber - 1];

  for (const row of positions) {
    for (const col of positions) {
      if (modules[row][col] !== null) {
        continue;
      }

      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          modules[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }
}

function setupTypeNumber(modules, typeNumber) {
  const bits = getBchTypeNumber(typeNumber);

  for (let i = 0; i < 18; i += 1) {
    const mod = ((bits >> i) & 1) === 1;
    modules[Math.floor(i / 3)][(i % 3) + modules.length - 8 - 3] = mod;
    modules[(i % 3) + modules.length - 8 - 3][Math.floor(i / 3)] = mod;
  }
}

function setupTypeInfo(modules, maskPattern) {
  const data = (QR_ERROR_CORRECT_M << 3) | maskPattern;
  const bits = getBchTypeInfo(data);

  for (let i = 0; i < 15; i += 1) {
    const mod = ((bits >> i) & 1) === 1;

    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[modules.length - 15 + i][8] = mod;
    }

    if (i < 8) {
      modules[8][modules.length - i - 1] = mod;
    } else if (i < 9) {
      modules[8][15 - i - 1 + 1] = mod;
    } else {
      modules[8][15 - i - 1] = mod;
    }
  }

  modules[modules.length - 8][8] = true;
}

function createData(typeNumber, bytes, rsBlocks) {
  const buffer = new BitBuffer();
  buffer.put(QR_MODE_8BIT_BYTE, 4);
  buffer.put(bytes.length, typeNumber < 10 ? 8 : 16);

  for (const byte of bytes) {
    buffer.put(byte, 8);
  }

  const totalDataCount = getTotalDataCount(rsBlocks);

  if (buffer.length + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }

  while (buffer.length % 8 !== 0) {
    buffer.putBit(false);
  }

  while (buffer.buffer.length < totalDataCount) {
    buffer.put(QR_PAD0, 8);

    if (buffer.buffer.length >= totalDataCount) {
      break;
    }

    buffer.put(QR_PAD1, 8);
  }

  return createBytes(buffer, rsBlocks);
}

function getTotalDataCount(rsBlocks) {
  let totalDataCount = 0;

  for (const block of rsBlocks) {
    totalDataCount += block.dataCount;
  }

  return totalDataCount;
}

function createBytes(buffer, rsBlocks) {
  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const dcdata = [];
  const ecdata = [];

  for (let r = 0; r < rsBlocks.length; r += 1) {
    const dcCount = rsBlocks[r].dataCount;
    const ecCount = rsBlocks[r].totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    dcdata[r] = buffer.buffer.slice(offset, offset + dcCount);
    offset += dcCount;

    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new Polynomial(dcdata[r], rsPoly.length - 1);
    const modPoly = rawPoly.mod(rsPoly);
    ecdata[r] = Array(ecCount).fill(0);

    for (let i = 0; i < modPoly.length; i += 1) {
      ecdata[r][i + ecdata[r].length - modPoly.length] = modPoly.get(i);
    }
  }

  const totalCodeCount = rsBlocks.reduce((sum, block) => sum + block.totalCount, 0);
  const data = [];

  for (let i = 0; i < maxDcCount; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < dcdata[r].length) {
        data.push(dcdata[r][i]);
      }
    }
  }

  for (let i = 0; i < maxEcCount; i += 1) {
    for (let r = 0; r < rsBlocks.length; r += 1) {
      if (i < ecdata[r].length) {
        data.push(ecdata[r][i]);
      }
    }
  }

  return data.slice(0, totalCodeCount);
}

function mapData(modules, data, maskPattern) {
  let inc = -1;
  let row = modules.length - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = modules.length - 1; col > 0; col -= 2) {
    if (col === 6) {
      col -= 1;
    }

    while (true) {
      for (let c = 0; c < 2; c += 1) {
        if (modules[row][col - c] === null) {
          let dark = false;

          if (byteIndex < data.length) {
            dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
          }

          if (getMask(maskPattern, row, col - c)) {
            dark = !dark;
          }

          modules[row][col - c] = dark;
          bitIndex -= 1;

          if (bitIndex === -1) {
            byteIndex += 1;
            bitIndex = 7;
          }
        }
      }

      row += inc;

      if (row < 0 || modules.length <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

function getRsBlocks(typeNumber) {
  const row = QR_RS_BLOCK_TABLE[typeNumber - 1];

  if (!row) {
    throw new Error("Некорректный тип QR-кода.");
  }

  const blocks = [];

  for (let i = 0; i < row.length; i += 3) {
    for (let j = 0; j < row[i]; j += 1) {
      blocks.push({
        totalCount: row[i + 1],
        dataCount: row[i + 2],
      });
    }
  }

  return blocks;
}

function getErrorCorrectPolynomial(errorCorrectLength) {
  let poly = new Polynomial([1], 0);

  for (let i = 0; i < errorCorrectLength; i += 1) {
    poly = poly.multiply(new Polynomial([1, QRMath.gexp(i)], 0));
  }

  return poly;
}

function getMask(maskPattern, i, j) {
  switch (maskPattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default:
      throw new Error("Некорректная маска QR-кода.");
  }
}

function getLostPoint(modules) {
  const moduleCount = modules.length;
  let lostPoint = 0;

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      let sameCount = 0;
      const dark = modules[row][col];

      for (let r = -1; r <= 1; r += 1) {
        if (row + r < 0 || moduleCount <= row + r) {
          continue;
        }

        for (let c = -1; c <= 1; c += 1) {
          if (col + c < 0 || moduleCount <= col + c || (r === 0 && c === 0)) {
            continue;
          }

          if (dark === modules[row + r][col + c]) {
            sameCount += 1;
          }
        }
      }

      if (sameCount > 5) {
        lostPoint += 3 + sameCount - 5;
      }
    }
  }

  for (let row = 0; row < moduleCount - 1; row += 1) {
    for (let col = 0; col < moduleCount - 1; col += 1) {
      const count = Number(modules[row][col]) + Number(modules[row + 1][col]) + Number(modules[row][col + 1]) + Number(modules[row + 1][col + 1]);

      if (count === 0 || count === 4) {
        lostPoint += 3;
      }
    }
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount - 6; col += 1) {
      if (
        modules[row][col] &&
        !modules[row][col + 1] &&
        modules[row][col + 2] &&
        modules[row][col + 3] &&
        modules[row][col + 4] &&
        !modules[row][col + 5] &&
        modules[row][col + 6]
      ) {
        lostPoint += 40;
      }
    }
  }

  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount - 6; row += 1) {
      if (
        modules[row][col] &&
        !modules[row + 1][col] &&
        modules[row + 2][col] &&
        modules[row + 3][col] &&
        modules[row + 4][col] &&
        !modules[row + 5][col] &&
        modules[row + 6][col]
      ) {
        lostPoint += 40;
      }
    }
  }

  let darkCount = 0;

  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount; row += 1) {
      if (modules[row][col]) {
        darkCount += 1;
      }
    }
  }

  const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
  return lostPoint + Math.floor(ratio) * 10;
}

function getBchTypeInfo(data) {
  let d = data << 10;

  while (getBchDigit(d) - getBchDigit(QR_G15) >= 0) {
    d ^= QR_G15 << (getBchDigit(d) - getBchDigit(QR_G15));
  }

  return ((data << 10) | d) ^ QR_G15_MASK;
}

function getBchTypeNumber(data) {
  let d = data << 12;

  while (getBchDigit(d) - getBchDigit(QR_G18) >= 0) {
    d ^= QR_G18 << (getBchDigit(d) - getBchDigit(QR_G18));
  }

  return (data << 12) | d;
}

function getBchDigit(data) {
  let digit = 0;

  while (data !== 0) {
    digit += 1;
    data >>>= 1;
  }

  return digit;
}

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }

  put(num, length) {
    for (let i = 0; i < length; i += 1) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);

    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }

    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> this.length % 8;
    }

    this.length += 1;
  }
}

class Polynomial {
  constructor(num, shift) {
    let offset = 0;

    while (offset < num.length && num[offset] === 0) {
      offset += 1;
    }

    this.num = Array(num.length - offset + shift).fill(0);

    for (let i = 0; i < num.length - offset; i += 1) {
      this.num[i] = num[i + offset];
    }
  }

  get length() {
    return this.num.length;
  }

  get(index) {
    return this.num[index];
  }

  multiply(other) {
    const num = Array(this.length + other.length - 1).fill(0);

    for (let i = 0; i < this.length; i += 1) {
      for (let j = 0; j < other.length; j += 1) {
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(other.get(j)));
      }
    }

    return new Polynomial(num, 0);
  }

  mod(other) {
    if (this.length - other.length < 0) {
      return this;
    }

    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(other.get(0));
    const num = this.num.slice();

    for (let i = 0; i < other.length; i += 1) {
      num[i] ^= QRMath.gexp(QRMath.glog(other.get(i)) + ratio);
    }

    return new Polynomial(num, 0).mod(other);
  }
}

const QRMath = {
  expTable: Array(256),
  logTable: Array(256),

  glog(n) {
    if (n < 1) {
      throw new Error("QRMath.glog");
    }

    return this.logTable[n];
  },

  gexp(n) {
    while (n < 0) {
      n += 255;
    }

    while (n >= 256) {
      n -= 255;
    }

    return this.expTable[n];
  },
};

for (let i = 0; i < 8; i += 1) {
  QRMath.expTable[i] = 1 << i;
}

for (let i = 8; i < 256; i += 1) {
  QRMath.expTable[i] = QRMath.expTable[i - 4] ^ QRMath.expTable[i - 5] ^ QRMath.expTable[i - 6] ^ QRMath.expTable[i - 8];
}

for (let i = 0; i < 255; i += 1) {
  QRMath.logTable[QRMath.expTable[i]] = i;
}
