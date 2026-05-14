const input = document.querySelector("#urlInput");
const sizeInput = document.querySelector("#sizeInput");
const marginInput = document.querySelector("#marginInput");
const canvas = document.querySelector("#qrCanvas");
const generateButton = document.querySelector("#generateButton");
const downloadButton = document.querySelector("#downloadButton");
const message = document.querySelector("#message");

function normalizeUrl(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setDownloadEnabled(enabled) {
  downloadButton.classList.toggle("disabled", !enabled);
  downloadButton.setAttribute("aria-disabled", String(!enabled));
}

function drawEmptyCanvas() {
  const ctx = canvas.getContext("2d");
  const size = Number(sizeInput.value);
  canvas.width = size;
  canvas.height = size;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#c8d1dc";
  ctx.font = "600 16px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("QR появится здесь", size / 2, size / 2);
}

function generate() {
  const url = normalizeUrl(input.value);

  if (!url) {
    setMessage("Вставь ссылку, чтобы создать QR-код.", true);
    setDownloadEnabled(false);
    drawEmptyCanvas();
    return;
  }

  try {
    new URL(url);
  } catch {
    setMessage("Похоже, ссылка написана неверно.", true);
    setDownloadEnabled(false);
    return;
  }

  try {
    const size = Number(sizeInput.value);
    const margin = Number(marginInput.value);
    drawQrToCanvas(canvas, url, size, margin);
    downloadButton.href = canvas.toDataURL("image/png");
    setDownloadEnabled(true);
    setMessage("Готово. QR-код можно сканировать или скачать.");
  } catch (error) {
    setDownloadEnabled(false);
    setMessage(error.message || "Не получилось создать QR-код.", true);
  }
}

generateButton.addEventListener("click", generate);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    generate();
  }
});

sizeInput.addEventListener("change", () => {
  if (input.value.trim()) {
    generate();
  } else {
    drawEmptyCanvas();
  }
});

marginInput.addEventListener("change", () => {
  if (input.value.trim()) {
    generate();
  }
});

drawEmptyCanvas();
