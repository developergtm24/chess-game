# ♚ KnightFall Chess

A production-ready chess web application built with Flask (Python), HTML, CSS, and JavaScript.
Dark premium theme inspired by Chess.com — play against a friend or challenge the computer.

---

## Features

- ✅ Fully legal move validation (server-side Python)
- ✅ Friend mode (2 players, same device)
- ✅ Computer mode (Minimax AI, depth 3 with alpha-beta pruning)
- ✅ Move history panel with algebraic notation
- ✅ Captured pieces display with material advantage
- ✅ Live score tracking with LocalStorage persistence
- ✅ Check / Checkmate / Stalemate / Draw detection
- ✅ En passant, castling, pawn promotion
- ✅ Undo move (undoes 2 moves in computer mode)
- ✅ Game over / winner / draw popups
- ✅ Web Audio API sounds (no sound files needed)
- ✅ Sound toggle button
- ✅ Fully responsive (desktop, tablet, mobile)
- ✅ Dark premium theme with gold accents
- ✅ Keyboard shortcuts (Ctrl+Z = undo, Escape = close modal)

---

## Project Structure

```
project/
│
├── app.py                  # Flask backend — routing, chess engine, API
├── requirements.txt        # Python dependencies
│
├── templates/
│   └── index.html          # Main HTML (landing + game page)
│
├── static/
│   ├── css/
│   │   └── style.css       # Complete stylesheet
│   │
│   ├── js/
│   │   └── game.js         # Frontend logic, AI, sounds
│   │
│   ├── sounds/             # (empty — sounds generated via Web Audio API)
│   └── images/             # (empty — pieces rendered via Unicode)
│
└── README.md
```

---

## Installation (Windows)

### Requirements
- Python 3.8 or higher
- pip

### Steps

**1. Open Command Prompt or PowerShell**

**2. Navigate to the project folder:**
```cmd
cd path\to\chess_app
```

**3. (Optional but recommended) Create a virtual environment:**
```cmd
python -m venv venv
venv\Scripts\activate
```

**4. Install dependencies:**
```cmd
pip install -r requirements.txt
```

**5. Run the application:**
```cmd
python app.py
```

**6. Open your browser and go to:**
```
http://localhost:5000
```

---

## Installation (macOS / Linux)

```bash
cd path/to/chess_app
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open: `http://localhost:5000`

---

## API Endpoints

| Method | Endpoint           | Description                        |
|--------|--------------------|------------------------------------|
| POST   | `/api/new_game`    | Start a new game                   |
| POST   | `/api/move`        | Make a move                        |
| POST   | `/api/undo`        | Undo last move                     |
| GET    | `/api/state`       | Get current game state             |
| GET    | `/api/legal_moves` | Get legal moves for a square       |

---

## Keyboard Shortcuts

| Key       | Action        |
|-----------|---------------|
| `Ctrl+Z`  | Undo move     |
| `Escape`  | Close modals  |

---

## Computer AI

The computer plays Black using a **Minimax algorithm** with:
- Alpha-beta pruning (depth 3)
- Piece-square tables for positional evaluation
- Material evaluation (pawn=100, knight/bishop=320-330, rook=500, queen=900)
- Random move ordering for variety at equal scores
- Always promotes to Queen

---

## Tech Stack

| Layer    | Technology                        |
|----------|-----------------------------------|
| Backend  | Python 3 + Flask                  |
| Frontend | Vanilla HTML5 + CSS3 + JavaScript |
| Sounds   | Web Audio API (no files needed)   |
| Pieces   | Unicode chess symbols             |
| Fonts    | Cinzel + Crimson Pro (Google)     |
| Storage  | Browser LocalStorage (scores)     |

---

## License

MIT — free to use, modify, and distribute.
