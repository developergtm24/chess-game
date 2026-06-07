/**
 * KnightFall Chess — Frontend Game Logic
 * Handles board rendering, user interaction, sounds, AI, and Flask API calls.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */

let gameId = null;
let gameState = null;
let selectedSquare = null;
let legalMovesCache = [];
let pendingPromotion = null;
let soundEnabled = true;
let isComputerThinking = false;
let lastMoveFrom = null, lastMoveTo = null;

/* ═══════════════════════════════════════════════════════════
   PIECE SYMBOLS
═══════════════════════════════════════════════════════════ */

const PIECE_SYMBOLS = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const CAPTURED_LABELS = {
    'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛',
    'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕'
};

/* ═══════════════════════════════════════════════════════════
   SOUND ENGINE (Web Audio API — no files needed)
═══════════════════════════════════════════════════════════ */

let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playTone(frequency, duration, type = 'sine', gain = 0.3) {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gainNode.gain.setValueAtTime(gain, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch(e) {}
}

function playChord(notes, duration, type = 'sine', gain = 0.2) {
    notes.forEach(f => playTone(f, duration, type, gain));
}

const SOUNDS = {
    move() {
        playTone(880, 0.08, 'triangle', 0.25);
    },
    capture() {
        playTone(300, 0.06, 'sawtooth', 0.22);
        setTimeout(() => playTone(200, 0.1, 'sawtooth', 0.15), 50);
    },
    check() {
        playChord([523, 659, 784], 0.18, 'triangle', 0.2);
    },
    checkmate() {
        playTone(196, 0.15, 'sawtooth', 0.25);
        setTimeout(() => playTone(165, 0.2, 'sawtooth', 0.2), 180);
        setTimeout(() => playTone(131, 0.5, 'sawtooth', 0.25), 420);
    },
    castle() {
        playTone(660, 0.07, 'square', 0.18);
        setTimeout(() => playTone(880, 0.12, 'square', 0.18), 80);
    },
    click() {
        playTone(1200, 0.04, 'square', 0.12);
    },
    draw() {
        playChord([330, 392, 494], 0.3, 'sine', 0.15);
    },
    select() {
        playTone(700, 0.05, 'sine', 0.15);
    }
};

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════════════════ */

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function goHome() {
    SOUNDS.click();
    showPage('landing-page');
    gameId = null;
    gameState = null;
}

async function startGame(mode) {
    SOUNDS.click();
    showPage('game-page');
    await initNewGame(mode);
}

async function newGame() {
    SOUNDS.click();
    showPage('landing-page');
}

/* ═══════════════════════════════════════════════════════════
   GAME INIT & API
═══════════════════════════════════════════════════════════ */

async function initNewGame(mode, keepScores = false) {
    const body = { mode };
    if (gameId && keepScores) body.game_id = gameId;

    const res = await fetch('/api/new_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
        gameId = data.game_id;
        gameState = data.state;
        selectedSquare = null;
        legalMovesCache = [];
        lastMoveFrom = null;
        lastMoveTo = null;
        isComputerThinking = false;
        renderBoard();
        renderUI();
        persistScores(gameState.scores);
    }
}

async function fetchLegalMoves(row, col) {
    const res = await fetch(`/api/legal_moves?game_id=${gameId}&square=${row}${col}`);
    const data = await res.json();
    return data.success ? data.moves : [];
}

async function sendMove(from, to, promotion) {
    const res = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: gameId, from, to, promotion })
    });
    return await res.json();
}

async function undoMove() {
    if (!gameId) return;
    SOUNDS.click();

    // If computer mode, undo 2 moves
    const undoCount = (gameState && gameState.mode === 'computer') ? 2 : 1;
    for (let i = 0; i < undoCount; i++) {
        if (!gameState || !gameState.move_history.length) break;
        const res = await fetch('/api/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_id: gameId })
        });
        const data = await res.json();
        if (data.success) {
            gameState = data.state;
        } else break;
    }

    selectedSquare = null;
    legalMovesCache = [];
    // Recalc last move highlight
    if (gameState.move_history.length > 0) {
        const last = gameState.move_history[gameState.move_history.length - 1];
        lastMoveFrom = last.from;
        lastMoveTo = last.to;
    } else {
        lastMoveFrom = null; lastMoveTo = null;
    }
    isComputerThinking = false;
    renderBoard();
    renderUI();
}

async function restartGame() {
    SOUNDS.click();
    const mode = gameState ? gameState.mode : 'friend';
    await initNewGame(mode, true);
}

/* ═══════════════════════════════════════════════════════════
   BOARD RENDERING
═══════════════════════════════════════════════════════════ */

function renderBoard() {
    const board = document.getElementById('chess-board');
    board.innerHTML = '';

    const bs = gameState ? gameState.board : null;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const sq = document.createElement('div');
            sq.classList.add('square', (r + c) % 2 === 0 ? 'light' : 'dark');
            sq.dataset.row = r;
            sq.dataset.col = c;

            // Last move highlight
            if (lastMoveFrom && lastMoveTo) {
                if ((r === lastMoveFrom[0] && c === lastMoveFrom[1]) ||
                    (r === lastMoveTo[0] && c === lastMoveTo[1])) {
                    sq.classList.add((r + c) % 2 === 0 ? 'last-move-light' : 'last-move-dark');
                }
            }

            // Selection highlight
            if (selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c) {
                sq.classList.add('selected');
            }

            // Legal move dots
            const isLegal = legalMovesCache.some(m => m[0] === r && m[1] === c);
            if (isLegal) {
                sq.classList.add('legal-move');
                if (bs && bs[r][c] !== null) sq.classList.add('occupied');
            }

            // King in check highlight
            if (bs && gameState.status === 'check') {
                const turn = gameState.turn;
                const kingPiece = turn === 'white' ? 'K' : 'k';
                if (bs[r][c] === kingPiece) sq.classList.add('in-check');
            }

            // Piece
            if (bs && bs[r][c]) {
                const piece = bs[r][c];
                const div = document.createElement('div');
                div.classList.add('piece');
                div.classList.add(piece === piece.toUpperCase() ? 'white-piece' : 'black-piece');
                div.textContent = PIECE_SYMBOLS[piece] || piece;
                sq.appendChild(div);
            }

            sq.addEventListener('click', onSquareClick);
            board.appendChild(sq);
        }
    }
}

/* ═══════════════════════════════════════════════════════════
   INTERACTION
═══════════════════════════════════════════════════════════ */

async function onSquareClick(e) {
    if (!gameState || isComputerThinking) return;
    if (gameState.status === 'checkmate' || gameState.status === 'stalemate' || gameState.status === 'draw') return;

    // Prevent clicking for computer's turn
    if (gameState.mode === 'computer' && gameState.turn === 'black') return;

    const sq = e.currentTarget;
    const r = parseInt(sq.dataset.row);
    const c = parseInt(sq.dataset.col);
    const piece = gameState.board[r][c];
    const color = piece ? (piece === piece.toUpperCase() ? 'white' : 'black') : null;

    // If a square is already selected
    if (selectedSquare) {
        const [sr, sc] = selectedSquare;

        // Clicking same square: deselect
        if (sr === r && sc === c) {
            selectedSquare = null;
            legalMovesCache = [];
            renderBoard();
            return;
        }

        // Clicking a legal target
        const isLegal = legalMovesCache.some(m => m[0] === r && m[1] === c);
        if (isLegal) {
            await handleMoveAttempt(sr, sc, r, c);
            return;
        }

        // Clicking own piece: select it instead
        if (color === gameState.turn) {
            SOUNDS.select();
            selectedSquare = [r, c];
            legalMovesCache = await fetchLegalMoves(r, c);
            renderBoard();
            return;
        }

        // Clicking enemy non-legal or empty: deselect
        selectedSquare = null;
        legalMovesCache = [];
        renderBoard();
        return;
    }

    // No selection: select own piece
    if (color === gameState.turn) {
        SOUNDS.select();
        selectedSquare = [r, c];
        legalMovesCache = await fetchLegalMoves(r, c);
        renderBoard();
    }
}

async function handleMoveAttempt(fr, fc, tr, tc) {
    const piece = gameState.board[fr][fc];
    const isPromotion = piece && piece.toUpperCase() === 'P' && (tr === 0 || tr === 7);

    if (isPromotion) {
        const promotion = await askPromotion(gameState.turn);
        if (!promotion) return;
        await executeMove(fr, fc, tr, tc, promotion);
    } else {
        await executeMove(fr, fc, tr, tc, 'Q');
    }
}

async function executeMove(fr, fc, tr, tc, promotion) {
    selectedSquare = null;
    legalMovesCache = [];

    const data = await sendMove(`${fr}${fc}`, `${tr}${tc}`, promotion);

    if (!data.success) {
        renderBoard();
        return;
    }

    gameState = data.state;
    lastMoveFrom = [fr, fc];
    lastMoveTo = [tr, tc];

    // Play sound
    const mt = data.move_result.move_type;
    if (mt === 'checkmate') SOUNDS.checkmate();
    else if (mt === 'check') SOUNDS.check();
    else if (mt === 'capture') SOUNDS.capture();
    else if (mt === 'castle') SOUNDS.castle();
    else SOUNDS.move();

    renderBoard();
    renderUI();

    // Animate last moved piece
    const toSq = document.querySelector(`.square[data-row="${tr}"][data-col="${tc}"]`);
    if (toSq) {
        const p = toSq.querySelector('.piece');
        if (p) { p.classList.add('just-moved'); p.addEventListener('animationend', () => p.classList.remove('just-moved'), {once: true}); }
    }

    // Check game over
    if (gameState.status === 'checkmate' || gameState.status === 'stalemate' || gameState.status === 'draw') {
        persistScores(gameState.scores);
        setTimeout(() => showGameOver(), 600);
        return;
    }

    // Computer move
    if (gameState.mode === 'computer' && gameState.turn === 'black') {
        setTimeout(doComputerMove, 300);
    }
}

/* ═══════════════════════════════════════════════════════════
   PROMOTION MODAL
═══════════════════════════════════════════════════════════ */

function askPromotion(color) {
    return new Promise(resolve => {
        const modal = document.getElementById('promotion-modal');
        const container = document.getElementById('promo-pieces');
        container.innerHTML = '';

        const pieces = color === 'white'
            ? [['Q', '♕'], ['R', '♖'], ['B', '♗'], ['N', '♘']]
            : [['Q', '♛'], ['R', '♜'], ['B', '♝'], ['N', '♞']];

        pieces.forEach(([code, symbol]) => {
            const btn = document.createElement('button');
            btn.className = 'promo-btn';
            btn.textContent = symbol;
            btn.title = code;
            btn.onclick = () => {
                modal.classList.add('hidden');
                SOUNDS.click();
                resolve(code);
            };
            container.appendChild(btn);
        });

        pendingPromotion = resolve;
        modal.classList.remove('hidden');
    });
}

/* ═══════════════════════════════════════════════════════════
   UI RENDERING
═══════════════════════════════════════════════════════════ */

function renderUI() {
    if (!gameState) return;

    // Status
    renderStatus();

    // Scores
    document.getElementById('white-score').textContent = gameState.scores.white;
    document.getElementById('black-score').textContent = gameState.scores.black;
    document.getElementById('draws-score').textContent = gameState.scores.draws;

    // Player names
    const mode = gameState.mode;
    document.getElementById('white-name').textContent = 'White';
    document.getElementById('black-name').textContent = mode === 'computer' ? 'Computer' : 'Black';

    // Turn indicators
    document.getElementById('white-turn-dot').classList.toggle('active', gameState.turn === 'white' && gameState.status === 'playing' || gameState.status === 'check');
    document.getElementById('black-turn-dot').classList.toggle('active', gameState.turn === 'black' && gameState.status === 'playing' || gameState.status === 'check');

    document.getElementById('player-white').classList.toggle('active', gameState.turn === 'white');
    document.getElementById('player-black').classList.toggle('active', gameState.turn === 'black');

    // Captured pieces
    renderCaptured();

    // Move history
    renderMoveHistory();
}

function renderStatus() {
    const bar = document.getElementById('status-bar');
    const txt = document.getElementById('status-text');
    bar.className = 'status-bar';

    const status = gameState.status;
    const turn = gameState.turn;
    const turnLabel = turn === 'white' ? 'White' : (gameState.mode === 'computer' ? 'Computer' : 'Black');

    if (status === 'playing') {
        txt.textContent = `${turnLabel}'s Turn`;
    } else if (status === 'check') {
        txt.textContent = `${turnLabel} is in Check!`;
        bar.classList.add('check');
    } else if (status === 'checkmate') {
        const winner = gameState.winner === 'white' ? 'White' : (gameState.mode === 'computer' ? 'Computer' : 'Black');
        txt.textContent = `${winner} wins!`;
        bar.classList.add('gameover');
    } else if (status === 'stalemate') {
        txt.textContent = 'Stalemate — Draw!';
        bar.classList.add('gameover');
    } else if (status === 'draw') {
        txt.textContent = 'Draw by 50-move rule';
        bar.classList.add('gameover');
    }

    // Computer thinking indicator
    if (isComputerThinking) {
        txt.textContent = 'Computer is thinking…';
    }
}

function renderCaptured() {
    const capByWhite = gameState.captured.white || [];
    const capByBlack = gameState.captured.black || [];

    // Sort by value desc for visual
    const sorted = arr => [...arr].sort((a, b) => (PIECE_VALUES[b] || 0) - (PIECE_VALUES[a] || 0));

    const cwEl = document.getElementById('captured-by-white');
    const cbEl = document.getElementById('captured-by-black');

    cwEl.textContent = sorted(capByWhite).map(p => CAPTURED_LABELS[p] || p).join('');
    cbEl.textContent = sorted(capByBlack).map(p => CAPTURED_LABELS[p] || p).join('');

    // Material advantage
    const whiteAdv = capByWhite.reduce((s, p) => s + (PIECE_VALUES[p] || 0), 0);
    const blackAdv = capByBlack.reduce((s, p) => s + (PIECE_VALUES[p] || 0), 0);
    document.getElementById('material-white').textContent = whiteAdv > blackAdv ? `+${whiteAdv - blackAdv}` : '';
    document.getElementById('material-black').textContent = blackAdv > whiteAdv ? `+${blackAdv - whiteAdv}` : '';

    // Mobile captured
    const mw = document.getElementById('mob-captured-white');
    const mb = document.getElementById('mob-captured-black');
    if (mw) mw.textContent = sorted(capByWhite).map(p => CAPTURED_LABELS[p] || p).join('') || '—';
    if (mb) mb.textContent = sorted(capByBlack).map(p => CAPTURED_LABELS[p] || p).join('') || '—';
}

function renderMoveHistory() {
    const list = document.getElementById('move-list');
    list.innerHTML = '';

    const history = gameState.move_history || [];
    if (!history.length) {
        list.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem;padding:0.5rem;text-align:center;font-style:italic;">No moves yet</div>';
        return;
    }

    // Group into pairs
    const pairs = [];
    for (let i = 0; i < history.length; i += 2) {
        pairs.push({ white: history[i], black: history[i + 1] || null });
    }

    pairs.forEach((pair, idx) => {
        const row = document.createElement('div');
        row.className = 'move-pair';

        const numEl = document.createElement('div');
        numEl.className = 'move-num';
        numEl.textContent = `${idx + 1}.`;

        const wEl = document.createElement('div');
        wEl.className = 'move-cell white-move';
        wEl.textContent = pair.white ? pair.white.notation : '';

        const bEl = document.createElement('div');
        bEl.className = 'move-cell black-move';
        bEl.textContent = pair.black ? pair.black.notation : '';

        // Latest move highlight
        const isLastPair = idx === pairs.length - 1;
        if (isLastPair) {
            if (pair.black) bEl.classList.add('latest');
            else wEl.classList.add('latest');
        }

        row.appendChild(numEl);
        row.appendChild(wEl);
        row.appendChild(bEl);
        list.appendChild(row);
    });

    // Scroll to bottom
    list.scrollTop = list.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════
   GAME OVER MODAL
═══════════════════════════════════════════════════════════ */

function showGameOver() {
    const modal = document.getElementById('gameover-modal');
    const icon = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const subtitle = document.getElementById('gameover-subtitle');

    const status = gameState.status;

    if (status === 'checkmate') {
        const winner = gameState.winner === 'white' ? 'White' : (gameState.mode === 'computer' ? 'Computer' : 'Black');
        icon.textContent = gameState.winner === 'white' ? '♔' : '♚';
        title.textContent = 'Checkmate!';
        subtitle.textContent = `${winner} wins the match`;
    } else if (status === 'stalemate') {
        icon.textContent = '🤝';
        title.textContent = 'Stalemate';
        subtitle.textContent = 'The game is a draw';
    } else if (status === 'draw') {
        icon.textContent = '⚖';
        title.textContent = 'Draw';
        subtitle.textContent = '50-move rule';
    }

    document.getElementById('go-white-score').textContent = gameState.scores.white;
    document.getElementById('go-black-score').textContent = gameState.scores.black;
    document.getElementById('go-draws-score').textContent = gameState.scores.draws;

    modal.classList.remove('hidden');
}

function hideGameOver() {
    document.getElementById('gameover-modal').classList.add('hidden');
}

async function playAgain() {
    SOUNDS.click();
    hideGameOver();
    const mode = gameState ? gameState.mode : 'friend';
    await initNewGame(mode, true);
}

/* ═══════════════════════════════════════════════════════════
   COMPUTER AI (Minimax with Alpha-Beta, depth 3)
═══════════════════════════════════════════════════════════ */

// Piece-square tables for positional evaluation
const PST = {
    p: [
        [0,  0,  0,  0,  0,  0,  0,  0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5,  5, 10, 25, 25, 10,  5,  5],
        [0,  0,  0, 20, 20,  0,  0,  0],
        [5, -5,-10,  0,  0,-10, -5,  5],
        [5, 10, 10,-20,-20, 10, 10,  5],
        [0,  0,  0,  0,  0,  0,  0,  0]
    ],
    n: [
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
    ],
    b: [
        [-20,-10,-10,-10,-10,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5, 10, 10,  5,  0,-10],
        [-10,  5,  5, 10, 10,  5,  5,-10],
        [-10,  0, 10, 10, 10, 10,  0,-10],
        [-10, 10, 10, 10, 10, 10, 10,-10],
        [-10,  5,  0,  0,  0,  0,  5,-10],
        [-20,-10,-10,-10,-10,-10,-10,-20]
    ],
    r: [
        [0,  0,  0,  0,  0,  0,  0,  0],
        [5, 10, 10, 10, 10, 10, 10,  5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [-5,  0,  0,  0,  0,  0,  0, -5],
        [0,  0,  0,  5,  5,  0,  0,  0]
    ],
    q: [
        [-20,-10,-10, -5, -5,-10,-10,-20],
        [-10,  0,  0,  0,  0,  0,  0,-10],
        [-10,  0,  5,  5,  5,  5,  0,-10],
        [-5,  0,  5,  5,  5,  5,  0, -5],
        [0,  0,  5,  5,  5,  5,  0, -5],
        [-10,  5,  5,  5,  5,  5,  0,-10],
        [-10,  0,  5,  0,  0,  0,  0,-10],
        [-20,-10,-10, -5, -5,-10,-10,-20]
    ],
    k: [
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-30,-40,-40,-50,-50,-40,-40,-30],
        [-20,-30,-30,-40,-40,-30,-30,-20],
        [-10,-20,-20,-20,-20,-20,-20,-10],
        [20, 20,  0,  0,  0,  0, 20, 20],
        [20, 30, 10,  0,  0, 10, 30, 20]
    ]
};

function getPST(piece, r, c) {
    const p = piece.toLowerCase();
    if (!PST[p]) return 0;
    // White: normal, Black: flipped
    const row = piece === piece.toUpperCase() ? r : 7 - r;
    return PST[p][row][c];
}

function evaluateBoard(board) {
    let score = 0;
    const pieceScores = { p:100, n:320, b:330, r:500, q:900, k:20000 };
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            const val = (pieceScores[piece.toLowerCase()] || 0) + getPST(piece, r, c);
            score += piece === piece.toUpperCase() ? -val : val; // black is maximizer
        }
    }
    return score;
}

function getAllMovesForColor(state, color) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = state.board[r][c];
            if (!piece) continue;
            const pColor = piece === piece.toUpperCase() ? 'white' : 'black';
            if (pColor !== color) continue;

            const pseudo = rawMovesJS(state.board, r, c, color, state.en_passant, state.castling);
            for (const [tr, tc, flag] of pseudo) {
                const testBoard = state.board.map(row => [...row]);
                doMoveOnBoard(testBoard, r, c, tr, tc, flag, color);
                if (!isInCheckJS(testBoard, color)) {
                    moves.push({ fr: r, fc: c, tr, tc, flag });
                }
            }
        }
    }
    return moves;
}

function rawMovesJS(board, r, c, color, enPassant, castling) {
    const piece = board[r][c];
    if (!piece) return [];
    const p = piece.toUpperCase();
    const moves = [];
    const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
    const colorOf = p => p ? (p === p.toUpperCase() ? 'white' : 'black') : null;

    if (p === 'P') {
        const dir = color === 'white' ? -1 : 1;
        const start = color === 'white' ? 6 : 1;
        const nr = r + dir;
        if (inB(nr, c) && !board[nr][c]) {
            moves.push([nr, c, null]);
            if (r === start && !board[r + 2*dir][c]) moves.push([r + 2*dir, c, null]);
        }
        for (const dc of [-1, 1]) {
            const [nr2, nc2] = [r + dir, c + dc];
            if (inB(nr2, nc2)) {
                if (board[nr2][nc2] && colorOf(board[nr2][nc2]) !== color) moves.push([nr2, nc2, null]);
                if (enPassant && nr2 === enPassant[0] && nc2 === enPassant[1]) moves.push([nr2, nc2, 'ep']);
            }
        }
    } else if (p === 'N') {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
            const [nr, nc] = [r+dr, c+dc];
            if (inB(nr,nc) && colorOf(board[nr][nc]) !== color) moves.push([nr,nc,null]);
        }
    } else if (['B','R','Q'].includes(p)) {
        const dirs = [];
        if (['R','Q'].includes(p)) dirs.push([-1,0],[1,0],[0,-1],[0,1]);
        if (['B','Q'].includes(p)) dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
        for (const [dr,dc] of dirs) {
            let [nr,nc] = [r+dr,c+dc];
            while (inB(nr,nc)) {
                const t = board[nr][nc];
                if (!t) { moves.push([nr,nc,null]); }
                else { if (colorOf(t) !== color) moves.push([nr,nc,null]); break; }
                nr+=dr; nc+=dc;
            }
        }
    } else if (p === 'K') {
        for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
            if (!dr && !dc) continue;
            const [nr,nc] = [r+dr,c+dc];
            if (inB(nr,nc) && colorOf(board[nr][nc]) !== color) moves.push([nr,nc,null]);
        }
        const back = color === 'white' ? 7 : 0;
        const opp = color === 'white' ? 'black' : 'white';
        if (r === back && c === 4 && !isSquareAttackedJS(board, r, 4, opp)) {
            if (castling[color].kingside && !board[back][5] && !board[back][6]
                && !isSquareAttackedJS(board, back, 5, opp) && !isSquareAttackedJS(board, back, 6, opp))
                moves.push([back, 6, 'castle_k']);
            if (castling[color].queenside && !board[back][3] && !board[back][2] && !board[back][1]
                && !isSquareAttackedJS(board, back, 3, opp) && !isSquareAttackedJS(board, back, 2, opp))
                moves.push([back, 2, 'castle_q']);
        }
    }
    return moves;
}

function isSquareAttackedJS(board, row, col, byColor) {
    const pawn = byColor === 'white' ? 'P' : 'p';
    const knight = byColor === 'white' ? 'N' : 'n';
    const rook = byColor === 'white' ? 'R' : 'r';
    const bishop = byColor === 'white' ? 'B' : 'b';
    const queen = byColor === 'white' ? 'Q' : 'q';
    const king = byColor === 'white' ? 'K' : 'k';
    const inB = (r,c) => r>=0&&r<8&&c>=0&&c<8;
    const pDir = byColor === 'white' ? 1 : -1;

    for (const dc of [-1,1]) {
        const ar = row - pDir, ac = col + dc;
        if (inB(ar,ac) && board[ar][ac] === pawn) return true;
    }
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const [nr,nc] = [row+dr,col+dc];
        if (inB(nr,nc) && board[nr][nc] === knight) return true;
    }
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let [nr,nc] = [row+dr,col+dc];
        while (inB(nr,nc)) {
            if (board[nr][nc]) { if (board[nr][nc]===rook||board[nr][nc]===queen) return true; break; }
            nr+=dr; nc+=dc;
        }
    }
    for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let [nr,nc] = [row+dr,col+dc];
        while (inB(nr,nc)) {
            if (board[nr][nc]) { if (board[nr][nc]===bishop||board[nr][nc]===queen) return true; break; }
            nr+=dr; nc+=dc;
        }
    }
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
        if (!dr&&!dc) continue;
        const [nr,nc] = [row+dr,col+dc];
        if (inB(nr,nc) && board[nr][nc]===king) return true;
    }
    return false;
}

function isInCheckJS(board, color) {
    const king = color === 'white' ? 'K' : 'k';
    let kr=-1, kc=-1;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (board[r][c]===king) { kr=r; kc=c; }
    if (kr<0) return false;
    return isSquareAttackedJS(board, kr, kc, color==='white'?'black':'white');
}

function doMoveOnBoard(board, fr, fc, tr, tc, flag, color) {
    const piece = board[fr][fc];
    board[fr][fc] = null;
    if (flag === 'ep') {
        const dir = color === 'white' ? -1 : 1;
        board[tr - dir][tc] = null;
    }
    board[tr][tc] = piece;
    if (flag === 'castle_k') {
        const back = color === 'white' ? 7 : 0;
        board[back][5] = board[back][7]; board[back][7] = null;
    }
    if (flag === 'castle_q') {
        const back = color === 'white' ? 7 : 0;
        board[back][3] = board[back][0]; board[back][0] = null;
    }
}

function minimax(state, depth, alpha, beta, isMaximizing) {
    if (depth === 0) return evaluateBoard(state.board);

    const color = isMaximizing ? 'black' : 'white';
    const moves = getAllMovesForColor(state, color);

    if (!moves.length) {
        if (isInCheckJS(state.board, color)) return isMaximizing ? -100000 : 100000;
        return 0; // stalemate
    }

    if (isMaximizing) {
        let best = -Infinity;
        for (const move of moves) {
            const newBoard = state.board.map(r => [...r]);
            doMoveOnBoard(newBoard, move.fr, move.fc, move.tr, move.tc, move.flag, 'black');
            // Pawn promotion to queen
            if (newBoard[move.tr][move.tc] === 'p' && move.tr === 7) newBoard[move.tr][move.tc] = 'q';
            const newEP = (newBoard[move.tr][move.tc]?.toLowerCase() === 'p' && Math.abs(move.tr - move.fr) === 2)
                ? [(move.fr + move.tr) / 2, move.fc] : null;
            const newState = { ...state, board: newBoard, turn: 'white', en_passant: newEP };
            best = Math.max(best, minimax(newState, depth-1, alpha, beta, false));
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = Infinity;
        for (const move of moves) {
            const newBoard = state.board.map(r => [...r]);
            doMoveOnBoard(newBoard, move.fr, move.fc, move.tr, move.tc, move.flag, 'white');
            if (newBoard[move.tr][move.tc] === 'P' && move.tr === 0) newBoard[move.tr][move.tc] = 'Q';
            const newEP = (newBoard[move.tr][move.tc]?.toLowerCase() === 'p' && Math.abs(move.tr - move.fr) === 2)
                ? [(move.fr + move.tr) / 2, move.fc] : null;
            const newState = { ...state, board: newBoard, turn: 'black', en_passant: newEP };
            best = Math.min(best, minimax(newState, depth-1, alpha, beta, true));
            beta = Math.min(beta, best);
            if (beta <= alpha) break;
        }
        return best;
    }
}

async function doComputerMove() {
    if (!gameState || gameState.turn !== 'black' || isComputerThinking) return;
    isComputerThinking = true;

    // Update UI
    document.getElementById('status-text').textContent = 'Computer is thinking…';

    // Small delay so UI updates
    await new Promise(r => setTimeout(r, 30));

    const moves = getAllMovesForColor(gameState, 'black');
    if (!moves.length) { isComputerThinking = false; return; }

    let bestMove = null, bestScore = -Infinity;
    const depth = 3;

    // Shuffle for variety at equal scores
    const shuffled = moves.sort(() => Math.random() - 0.5);

    for (const move of shuffled) {
        const newBoard = gameState.board.map(r => [...r]);
        doMoveOnBoard(newBoard, move.fr, move.fc, move.tr, move.tc, move.flag, 'black');
        if (newBoard[move.tr][move.tc] === 'p' && move.tr === 7) newBoard[move.tr][move.tc] = 'q';
        const newEP = (newBoard[move.tr][move.tc]?.toLowerCase() === 'p' && Math.abs(move.tr - move.fr) === 2)
            ? [(move.fr + move.tr) / 2, move.fc] : null;
        const newState = { ...gameState, board: newBoard, turn: 'white', en_passant: newEP };
        const score = minimax(newState, depth-1, -Infinity, Infinity, false);
        if (score > bestScore) { bestScore = score; bestMove = move; }
    }

    isComputerThinking = false;

    if (bestMove) {
        const promo = 'Q'; // always promote to queen
        await executeMove(bestMove.fr, bestMove.fc, bestMove.tr, bestMove.tc, promo);
    }
}

/* ═══════════════════════════════════════════════════════════
   SCORE PERSISTENCE
═══════════════════════════════════════════════════════════ */

function persistScores(scores) {
    try {
        localStorage.setItem('knightfall_scores', JSON.stringify(scores));
    } catch(e) {}
}

function loadPersistedScores() {
    try {
        const s = localStorage.getItem('knightfall_scores');
        return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
}

/* ═══════════════════════════════════════════════════════════
   SOUND TOGGLE
═══════════════════════════════════════════════════════════ */

function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('sound-btn');
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    if (soundEnabled) SOUNDS.click();
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════════════════════ */

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const promoModal = document.getElementById('promotion-modal');
        if (!promoModal.classList.contains('hidden')) {
            promoModal.classList.add('hidden');
        }
        const goModal = document.getElementById('gameover-modal');
        if (!goModal.classList.contains('hidden')) {
            goModal.classList.add('hidden');
        }
    }
    if (e.ctrlKey && e.key === 'z') {
        if (document.getElementById('game-page').classList.contains('active')) {
            undoMove();
        }
    }
});

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    // Restore scores display if any
    const scores = loadPersistedScores();
    if (scores) {
        // Will be applied once game starts
    }
});
