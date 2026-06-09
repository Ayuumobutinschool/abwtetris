(() => {
  "use strict";

  const COLS = 10, ROWS = 20, CELL = 30;

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const nextCanvas = document.getElementById("next");
  const nctx = nextCanvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const linesEl = document.getElementById("lines");
  const levelEl = document.getElementById("level");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("startBtn");

  // Tetromino shapes as NxN matrices. Non-zero value = color id.
  const SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[2, 2], [2, 2]],
    T: [[0, 3, 0], [3, 3, 3], [0, 0, 0]],
    S: [[0, 4, 4], [4, 4, 0], [0, 0, 0]],
    Z: [[5, 5, 0], [0, 5, 5], [0, 0, 0]],
    J: [[6, 0, 0], [6, 6, 6], [0, 0, 0]],
    L: [[0, 0, 7], [7, 7, 7], [0, 0, 0]],
  };
  const COLORS = {
    1: "#00e5e5", 2: "#f5d90a", 3: "#b249f8", 4: "#3cdc5a",
    5: "#ff4d5e", 6: "#3d7bff", 7: "#ff9d2f",
  };
  const TYPES = Object.keys(SHAPES);

  let board, current, nextPiece, bag;
  let score, lines, level, dropInterval, dropCounter, lastTime;
  let running = false, paused = false, gameOver = false, rafId = null;

  // ---------- helpers ----------
  const emptyBoard = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));

  function refillBag() {
    bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  function nextType() {
    if (!bag || bag.length === 0) refillBag();
    return bag.pop();
  }
  function makePiece(type) {
    const matrix = SHAPES[type].map((row) => row.slice());
    return { type, matrix, x: Math.floor((COLS - matrix[0].length) / 2), y: 0 };
  }
  function rotate(matrix) {
    const n = matrix.length;
    const out = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) out[x][n - 1 - y] = matrix[y][x];
    }
    return out;
  }
  function collides(piece) {
    const m = piece.matrix;
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const bx = piece.x + x, by = piece.y + y;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by][bx]) return true;
      }
    }
    return false;
  }
  function merge(piece) {
    piece.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v && piece.y + y >= 0) board[piece.y + y][piece.x + x] = v;
    }));
  }
  function levelSpeed(lvl) {
    return Math.max(80, 800 - (lvl - 1) * 70); // ms per gravity step
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every((v) => v !== 0)) {
        board.splice(y, 1);
        board.unshift(new Array(COLS).fill(0));
        cleared++;
        y++; // re-check the same row index after the shift
      }
    }
    if (cleared) {
      score += [0, 40, 100, 300, 1200][cleared] * level;
      lines += cleared;
      const newLevel = Math.floor(lines / 10) + 1;
      if (newLevel !== level) {
        level = newLevel;
        dropInterval = levelSpeed(level);
      }
      updateHud();
    }
  }

  // ---------- rendering ----------
  function drawCell(c, x, y, colorId, size = CELL) {
    const px = x * size, py = y * size;
    c.fillStyle = COLORS[colorId];
    c.fillRect(px + 1, py + 1, size - 2, size - 2);
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.14));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(150,120,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, canvas.height); ctx.stroke();
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(canvas.width, y * CELL); ctx.stroke();
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (board[y][x]) drawCell(ctx, x, y, board[y][x]);
    }

    if (current) {
      // ghost
      let gy = current.y;
      while (!collides({ matrix: current.matrix, x: current.x, y: gy + 1 })) gy++;
      ctx.globalAlpha = 0.18;
      current.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v) drawCell(ctx, current.x + x, gy + y, v);
      }));
      ctx.globalAlpha = 1;
      // active
      current.matrix.forEach((row, y) => row.forEach((v, x) => {
        if (v && current.y + y >= 0) drawCell(ctx, current.x + x, current.y + y, v);
      }));
    }
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPiece) return;
    const m = nextPiece.matrix, size = 24;
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    m.forEach((row, y) => row.forEach((v, x) => {
      if (v) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }));
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const offX = (nextCanvas.width - w * size) / 2;
    const offY = (nextCanvas.height - h * size) / 2;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!m[y][x]) continue;
        const px = offX + (x - minX) * size, py = offY + (y - minY) * size;
        nctx.fillStyle = COLORS[m[y][x]];
        nctx.fillRect(px + 1, py + 1, size - 2, size - 2);
        nctx.fillStyle = "rgba(255,255,255,0.18)";
        nctx.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.14));
      }
    }
  }

  function updateHud() {
    scoreEl.textContent = score;
    linesEl.textContent = lines;
    levelEl.textContent = level;
  }

  function showOverlay(title, html, showButton) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.style.display = showButton ? "" : "none";
    overlay.classList.remove("hidden");
  }

  // ---------- game flow ----------
  function spawn() {
    current = nextPiece || makePiece(nextType());
    nextPiece = makePiece(nextType());
    drawNext();
    if (collides(current)) endGame();
  }

  function lockPiece() {
    merge(current);
    clearLines();
    spawn();
    dropCounter = 0;
  }

  function move(dir) {
    if (!running || paused || gameOver) return;
    current.x += dir;
    if (collides(current)) current.x -= dir; else draw();
  }

  function softDrop() {
    if (!running || paused || gameOver) return;
    current.y++;
    if (collides(current)) {
      current.y--;
      lockPiece();
    } else {
      score += 1;
      updateHud();
    }
    dropCounter = 0;
    draw();
  }

  function hardDrop() {
    if (!running || paused || gameOver) return;
    let dist = 0;
    while (!collides(current)) { current.y++; dist++; }
    current.y--; dist--;
    if (dist > 0) { score += dist * 2; updateHud(); }
    lockPiece();
    draw();
  }

  function rotateCurrent() {
    if (!running || paused || gameOver) return;
    const prevMatrix = current.matrix, prevX = current.x;
    current.matrix = rotate(current.matrix);
    let ok = false;
    for (const k of [0, -1, 1, -2, 2]) {
      current.x = prevX + k;
      if (!collides(current)) { ok = true; break; }
    }
    if (!ok) { current.matrix = prevMatrix; current.x = prevX; } else draw();
  }

  function tick(time = 0) {
    if (!running) return;
    if (paused) { lastTime = time; rafId = requestAnimationFrame(tick); return; }
    const delta = time - lastTime;
    lastTime = time;
    dropCounter += delta;
    if (dropCounter > dropInterval) {
      current.y++;
      if (collides(current)) { current.y--; lockPiece(); }
      dropCounter = 0;
    }
    draw();
    if (running) rafId = requestAnimationFrame(tick);
  }

  function startGame() {
    board = emptyBoard();
    score = 0; lines = 0; level = 1;
    dropInterval = levelSpeed(level); dropCounter = 0; lastTime = 0;
    bag = null; nextPiece = null;
    gameOver = false; paused = false; running = true;
    updateHud();
    overlay.classList.add("hidden");
    spawn();
    draw();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function togglePause() {
    if (!running || gameOver) return;
    paused = !paused;
    if (paused) {
      showOverlay("PAUSE", 'Drücke <kbd>P</kbd> zum Weiterspielen', false);
    } else {
      overlay.classList.add("hidden");
      lastTime = performance.now();
    }
  }

  async function endGame() {
    running = false;
    gameOver = true;
    cancelAnimationFrame(rafId);
    draw();
    showOverlay("GAME OVER",
      `Score <b>${score.toLocaleString("de-DE")}</b> &middot; ${lines} Lines &middot; Level ${level}`,
      true);
    startBtn.textContent = "Nochmal spielen";
    try {
      await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, lines, level }),
      });
    } catch (e) { /* offline – ignore */ }
    loadLeaderboard();
  }

  // ---------- leaderboard ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadLeaderboard() {
    const lbEl = document.getElementById("leaderboard");
    const personalEl = document.getElementById("personal");
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      const rows = data.leaderboard || [];
      const meName = data.me && data.me.username;

      if (rows.length === 0) {
        lbEl.innerHTML = '<li class="lb-empty">Noch keine Scores – sei der Erste!</li>';
      } else {
        lbEl.innerHTML = rows.map((r, i) => `
          <li>
            <span class="lb-rank">${i + 1}</span>
            <span class="lb-name ${r.username === meName ? "is-me" : ""}">${escapeHtml(r.username)}</span>
            <span class="lb-score">${Number(r.score).toLocaleString("de-DE")}</span>
          </li>`).join("");
      }

      if (data.me && data.me.best > 0) {
        personalEl.innerHTML =
          `Dein Bestwert: <b>${Number(data.me.best).toLocaleString("de-DE")}</b>` +
          (data.me.rank ? ` &middot; Platz ${data.me.rank}` : "");
      } else {
        personalEl.innerHTML = "";
      }
    } catch (e) {
      lbEl.innerHTML = '<li class="lb-empty">Leaderboard nicht erreichbar</li>';
    }
  }

  // ---------- input ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (!running || gameOver)) { startGame(); return; }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    if (!running || paused || gameOver) return;
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); move(-1); break;
      case "ArrowRight": e.preventDefault(); move(1); break;
      case "ArrowDown": e.preventDefault(); softDrop(); break;
      case "ArrowUp": e.preventDefault(); rotateCurrent(); break;
      case " ": e.preventDefault(); hardDrop(); break;
    }
  });
  startBtn.addEventListener("click", startGame);

  // ---------- init ----------
  board = emptyBoard();
  current = null; nextPiece = null;
  score = 0; lines = 0; level = 1;
  updateHud();
  draw();
  showOverlay("BEREIT?", 'Drücke <kbd>Enter</kbd> zum Start', true);
  startBtn.textContent = "Spiel starten";
  loadLeaderboard();
})();
