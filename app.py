from flask import Flask, render_template, jsonify, request, session
import json
import os
import uuid

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'chess-secret-key-2024-xK9mP2qR')

# In-memory game storage (keyed by session game_id)
games = {}

INITIAL_BOARD = [
    ['r','n','b','q','k','b','n','r'],
    ['p','p','p','p','p','p','p','p'],
    [None,None,None,None,None,None,None,None],
    [None,None,None,None,None,None,None,None],
    [None,None,None,None,None,None,None,None],
    [None,None,None,None,None,None,None,None],
    ['P','P','P','P','P','P','P','P'],
    ['R','N','B','Q','K','B','N','R'],
]

def new_game_state(mode='friend'):
    return {
        'board': [row[:] for row in INITIAL_BOARD],
        'turn': 'white',
        'mode': mode,
        'move_history': [],
        'captured': {'white': [], 'black': []},
        'status': 'playing',  # playing, check, checkmate, draw, stalemate
        'winner': None,
        'scores': {'white': 0, 'black': 0, 'draws': 0},
        'en_passant': None,
        'castling': {
            'white': {'kingside': True, 'queenside': True},
            'black': {'kingside': True, 'queenside': True}
        },
        'half_moves': 0,
        'full_moves': 1
    }

@app.route('/')
def index():
    return render_template('/index.html')

@app.route('/api/new_game', methods=['POST'])
def new_game():
    data = request.get_json()
    mode = data.get('mode', 'friend')
    game_id = str(uuid.uuid4())

    # Preserve scores if continuing
    scores = {'white': 0, 'black': 0, 'draws': 0}
    old_id = data.get('game_id')
    if old_id and old_id in games:
        scores = games[old_id].get('scores', scores)

    state = new_game_state(mode)
    state['scores'] = scores
    state['game_id'] = game_id
    games[game_id] = state

    return jsonify({
        'success': True,
        'game_id': game_id,
        'state': serialize_state(state)
    })

@app.route('/api/move', methods=['POST'])
def make_move():
    data = request.get_json()
    game_id = data.get('game_id')
    from_sq = data.get('from')
    to_sq = data.get('to')
    promotion = data.get('promotion', 'Q')

    if not game_id or game_id not in games:
        return jsonify({'success': False, 'error': 'Game not found'}), 404

    state = games[game_id]

    if state['status'] in ('checkmate', 'stalemate', 'draw'):
        return jsonify({'success': False, 'error': 'Game is over'})

    result = apply_move(state, from_sq, to_sq, promotion)

    if not result['success']:
        return jsonify(result)

    games[game_id] = state
    return jsonify({
        'success': True,
        'state': serialize_state(state),
        'move_result': result
    })

@app.route('/api/undo', methods=['POST'])
def undo_move():
    data = request.get_json()
    game_id = data.get('game_id')

    if not game_id or game_id not in games:
        return jsonify({'success': False, 'error': 'Game not found'}), 404

    state = games[game_id]
    if not state['move_history']:
        return jsonify({'success': False, 'error': 'No moves to undo'})

    # Restore from snapshot stored in history
    last = state['move_history'][-1]
    if 'snapshot' in last:
        snap = last['snapshot']
        state['board'] = [row[:] for row in snap['board']]
        state['turn'] = snap['turn']
        state['en_passant'] = snap['en_passant']
        state['castling'] = json.loads(json.dumps(snap['castling']))
        state['captured'] = json.loads(json.dumps(snap['captured']))
        state['status'] = snap['status']
        state['half_moves'] = snap['half_moves']
        state['full_moves'] = snap['full_moves']

    state['move_history'].pop()

    return jsonify({
        'success': True,
        'state': serialize_state(state)
    })

@app.route('/api/state', methods=['GET'])
def get_state():
    game_id = request.args.get('game_id')
    if not game_id or game_id not in games:
        return jsonify({'success': False, 'error': 'Game not found'}), 404
    return jsonify({'success': True, 'state': serialize_state(games[game_id])})

@app.route('/api/legal_moves', methods=['GET'])
def get_legal_moves():
    game_id = request.args.get('game_id')
    sq = request.args.get('square')

    if not game_id or game_id not in games:
        return jsonify({'success': False, 'error': 'Game not found'}), 404

    state = games[game_id]
    row, col = int(sq[0]), int(sq[1])
    moves = get_legal_moves_for_square(state, row, col)

    return jsonify({'success': True, 'moves': moves})

# ─── Chess Logic ──────────────────────────────────────────────────────────────

def serialize_state(state):
    return {
        'board': state['board'],
        'turn': state['turn'],
        'mode': state['mode'],
        'move_history': [
            {k: v for k, v in m.items() if k != 'snapshot'}
            for m in state['move_history']
        ],
        'captured': state['captured'],
        'status': state['status'],
        'winner': state['winner'],
        'scores': state['scores'],
        'game_id': state.get('game_id'),
        'en_passant': state['en_passant'],
        'castling': state['castling'],
    }

def is_white(piece):
    return piece is not None and piece.isupper()

def is_black(piece):
    return piece is not None and piece.islower()

def color_of(piece):
    if piece is None: return None
    return 'white' if piece.isupper() else 'black'

def opponent(color):
    return 'black' if color == 'white' else 'white'

def in_bounds(r, c):
    return 0 <= r <= 7 and 0 <= c <= 7

def piece_at(board, r, c):
    if not in_bounds(r, c): return None
    return board[r][c]

def find_king(board, color):
    king = 'K' if color == 'white' else 'k'
    for r in range(8):
        for c in range(8):
            if board[r][c] == king:
                return (r, c)
    return None

def is_square_attacked(board, row, col, by_color, en_passant=None):
    """Check if (row,col) is attacked by by_color."""
    opp = by_color
    # Pawn attacks
    pawn = 'P' if opp == 'white' else 'p'
    pawn_dir = 1 if opp == 'white' else -1  # white pawns attack upward (decreasing row)
    for dc in [-1, 1]:
        r, c = row + pawn_dir, col + dc  # from attacker perspective, pawns below/above
        # Flip: white pawn at (row+1) attacks (row, col±1)
        ar = row - pawn_dir
        ac = col + dc
        if in_bounds(ar, ac) and board[ar][ac] == pawn:
            return True

    # Knight attacks
    knight = 'N' if opp == 'white' else 'n'
    for dr, dc in [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]:
        r, c = row+dr, col+dc
        if in_bounds(r,c) and board[r][c] == knight:
            return True

    # Rook / Queen (straight lines)
    rook = 'R' if opp == 'white' else 'r'
    queen = 'Q' if opp == 'white' else 'q'
    for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
        r, c = row+dr, col+dc
        while in_bounds(r,c):
            p = board[r][c]
            if p is not None:
                if p in (rook, queen):
                    return True
                break
            r, c = r+dr, c+dc

    # Bishop / Queen (diagonals)
    bishop = 'B' if opp == 'white' else 'b'
    for dr, dc in [(-1,-1),(-1,1),(1,-1),(1,1)]:
        r, c = row+dr, col+dc
        while in_bounds(r,c):
            p = board[r][c]
            if p is not None:
                if p in (bishop, queen):
                    return True
                break
            r, c = r+dr, c+dc

    # King attacks
    king = 'K' if opp == 'white' else 'k'
    for dr in [-1,0,1]:
        for dc in [-1,0,1]:
            if dr == 0 and dc == 0: continue
            r, c = row+dr, col+dc
            if in_bounds(r,c) and board[r][c] == king:
                return True

    return False

def is_in_check(board, color, en_passant=None):
    king_pos = find_king(board, color)
    if king_pos is None: return False
    return is_square_attacked(board, king_pos[0], king_pos[1], opponent(color), en_passant)

def raw_moves(board, r, c, color, en_passant, castling):
    """Generate pseudo-legal moves for piece at (r,c)."""
    piece = board[r][c]
    if piece is None or color_of(piece) != color:
        return []

    moves = []
    p = piece.upper()

    if p == 'P':
        direction = -1 if color == 'white' else 1
        start_row = 6 if color == 'white' else 1

        # One step forward
        nr = r + direction
        if in_bounds(nr, c) and board[nr][c] is None:
            moves.append((nr, c, None))
            # Two steps from start
            if r == start_row:
                nr2 = r + 2 * direction
                if in_bounds(nr2, c) and board[nr2][c] is None:
                    moves.append((nr2, c, None))

        # Captures
        for dc in [-1, 1]:
            nr, nc = r + direction, c + dc
            if in_bounds(nr, nc):
                target = board[nr][nc]
                if target is not None and color_of(target) != color:
                    moves.append((nr, nc, None))
                # En passant
                if en_passant and (nr, nc) == (en_passant[0], en_passant[1]):
                    moves.append((nr, nc, 'ep'))

    elif p == 'N':
        for dr, dc in [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]:
            nr, nc = r+dr, c+dc
            if in_bounds(nr, nc):
                t = board[nr][nc]
                if t is None or color_of(t) != color:
                    moves.append((nr, nc, None))

    elif p in ('B', 'R', 'Q'):
        directions = []
        if p in ('R', 'Q'): directions += [(-1,0),(1,0),(0,-1),(0,1)]
        if p in ('B', 'Q'): directions += [(-1,-1),(-1,1),(1,-1),(1,1)]
        for dr, dc in directions:
            nr, nc = r+dr, c+dc
            while in_bounds(nr, nc):
                t = board[nr][nc]
                if t is None:
                    moves.append((nr, nc, None))
                else:
                    if color_of(t) != color:
                        moves.append((nr, nc, None))
                    break
                nr, nc = nr+dr, nc+dc

    elif p == 'K':
        for dr in [-1,0,1]:
            for dc in [-1,0,1]:
                if dr == 0 and dc == 0: continue
                nr, nc = r+dr, c+dc
                if in_bounds(nr, nc):
                    t = board[nr][nc]
                    if t is None or color_of(t) != color:
                        moves.append((nr, nc, None))

        # Castling
        back_row = 7 if color == 'white' else 0
        opp_color = opponent(color)
        if r == back_row and c == 4 and not is_square_attacked(board, r, 4, opp_color):
            # Kingside
            if castling[color]['kingside']:
                if board[back_row][5] is None and board[back_row][6] is None:
                    if not is_square_attacked(board, back_row, 5, opp_color) and \
                       not is_square_attacked(board, back_row, 6, opp_color):
                        moves.append((back_row, 6, 'castle_k'))
            # Queenside
            if castling[color]['queenside']:
                if board[back_row][3] is None and board[back_row][2] is None and board[back_row][1] is None:
                    if not is_square_attacked(board, back_row, 3, opp_color) and \
                       not is_square_attacked(board, back_row, 2, opp_color):
                        moves.append((back_row, 2, 'castle_q'))

    return moves

def get_legal_moves_for_square(state, r, c):
    board = state['board']
    color = state['turn']
    en_passant = state['en_passant']
    castling = state['castling']

    piece = board[r][c]
    if piece is None or color_of(piece) != color:
        return []

    pseudo = raw_moves(board, r, c, color, en_passant, castling)
    legal = []

    for (nr, nc, flag) in pseudo:
        test_board = [row[:] for row in board]
        # Make the move on test board
        do_move_on_board(test_board, r, c, nr, nc, flag, color)
        if not is_in_check(test_board, color, None):
            legal.append([nr, nc])

    return legal

def do_move_on_board(board, fr, fc, tr, tc, flag, color):
    piece = board[fr][fc]
    board[fr][fc] = None

    if flag == 'ep':
        # Capture the en-passant pawn
        direction = -1 if color == 'white' else 1
        board[tr - direction][tc] = None

    board[tr][tc] = piece

    if flag == 'castle_k':
        back = 7 if color == 'white' else 0
        board[back][5] = board[back][7]
        board[back][7] = None

    if flag == 'castle_q':
        back = 7 if color == 'white' else 0
        board[back][3] = board[back][0]
        board[back][0] = None

def apply_move(state, from_sq, to_sq, promotion='Q'):
    fr, fc = int(from_sq[0]), int(from_sq[1])
    tr, tc = int(to_sq[0]), int(to_sq[1])

    board = state['board']
    color = state['turn']

    piece = board[fr][fc]
    if piece is None or color_of(piece) != color:
        return {'success': False, 'error': 'Not your piece'}

    # Check legality
    legal = get_legal_moves_for_square(state, fr, fc)
    if [tr, tc] not in legal:
        return {'success': False, 'error': 'Illegal move'}

    # Take snapshot for undo
    snapshot = {
        'board': [row[:] for row in board],
        'turn': state['turn'],
        'en_passant': state['en_passant'],
        'castling': json.loads(json.dumps(state['castling'])),
        'captured': json.loads(json.dumps(state['captured'])),
        'status': state['status'],
        'half_moves': state['half_moves'],
        'full_moves': state['full_moves'],
    }

    # Determine flag
    flag = None
    if piece.upper() == 'P' and state['en_passant'] and [tr, tc] == list(state['en_passant']):
        flag = 'ep'
    elif piece.upper() == 'K' and abs(tc - fc) == 2:
        flag = 'castle_k' if tc > fc else 'castle_q'

    # Track captured piece
    captured = board[tr][tc]
    if flag == 'ep':
        direction = -1 if color == 'white' else 1
        captured = board[tr - direction][tc]

    if captured:
        state['captured'][color].append(captured.lower())

    # Track move for notation
    move_notation = build_notation(board, fr, fc, tr, tc, captured, flag, piece)

    # Apply move
    do_move_on_board(board, fr, fc, tr, tc, flag, color)

    # Pawn promotion
    is_promotion = False
    if piece.upper() == 'P' and (tr == 0 or tr == 7):
        promo_piece = promotion.upper() if color == 'white' else promotion.lower()
        board[tr][tc] = promo_piece
        is_promotion = True
        move_notation += '=' + promotion.upper()

    # Update en passant
    state['en_passant'] = None
    if piece.upper() == 'P' and abs(tr - fr) == 2:
        state['en_passant'] = [(fr + tr) // 2, fc]

    # Update castling rights
    if piece.upper() == 'K':
        state['castling'][color]['kingside'] = False
        state['castling'][color]['queenside'] = False
    if piece.upper() == 'R':
        back = 7 if color == 'white' else 0
        if fr == back and fc == 0: state['castling'][color]['queenside'] = False
        if fr == back and fc == 7: state['castling'][color]['kingside'] = False

    # Update move counters
    if piece.upper() == 'P' or captured:
        state['half_moves'] = 0
    else:
        state['half_moves'] += 1
    if color == 'black':
        state['full_moves'] += 1

    # Switch turn
    next_color = opponent(color)
    state['turn'] = next_color

    # Check game status
    opp_in_check = is_in_check(board, next_color)
    opp_has_moves = has_any_legal_move(state, next_color)

    move_type = 'normal'
    if flag == 'ep': move_type = 'capture'
    elif flag in ('castle_k', 'castle_q'): move_type = 'castle'
    elif captured: move_type = 'capture'

    if opp_in_check:
        if not opp_has_moves:
            state['status'] = 'checkmate'
            state['winner'] = color
            state['scores'][color] += 1
            move_notation += '#'
            move_type = 'checkmate'
        else:
            state['status'] = 'check'
            move_notation += '+'
            move_type = 'check'
    elif not opp_has_moves:
        state['status'] = 'stalemate'
        state['scores']['draws'] += 1
        move_type = 'stalemate'
    elif state['half_moves'] >= 100:
        state['status'] = 'draw'
        state['scores']['draws'] += 1
        move_type = 'draw'
    else:
        state['status'] = 'playing'

    # Full move number for notation
    move_num = state['full_moves'] if color == 'black' else state['full_moves']
    display_num = snapshot['full_moves']

    state['move_history'].append({
        'from': [fr, fc],
        'to': [tr, tc],
        'piece': piece,
        'captured': captured,
        'notation': move_notation,
        'color': color,
        'move_num': display_num,
        'snapshot': snapshot,
        'promotion': promotion if is_promotion else None
    })

    return {
        'success': True,
        'move_type': move_type,
        'captured': captured,
        'notation': move_notation,
        'is_promotion': is_promotion,
        'in_check': opp_in_check,
        'status': state['status'],
        'winner': state['winner']
    }

def has_any_legal_move(state, color):
    board = state['board']
    for r in range(8):
        for c in range(8):
            if color_of(board[r][c]) == color:
                if get_legal_moves_for_square_for_color(state, r, c, color):
                    return True
    return False

def get_legal_moves_for_square_for_color(state, r, c, color):
    board = state['board']
    en_passant = state['en_passant']
    castling = state['castling']
    pseudo = raw_moves(board, r, c, color, en_passant, castling)
    legal = []
    for (nr, nc, flag) in pseudo:
        test_board = [row[:] for row in board]
        do_move_on_board(test_board, r, c, nr, nc, flag, color)
        if not is_in_check(test_board, color, None):
            legal.append([nr, nc])
    return legal

def build_notation(board, fr, fc, tr, tc, captured, flag, piece):
    files = 'abcdefgh'
    if flag == 'castle_k': return 'O-O'
    if flag == 'castle_q': return 'O-O-O'

    p = piece.upper()
    piece_str = '' if p == 'P' else p
    from_file = files[fc]
    to_file = files[tc]
    to_rank = str(8 - tr)

    if p == 'P':
        if captured or flag == 'ep':
            return f"{from_file}x{to_file}{to_rank}"
        return f"{to_file}{to_rank}"

    cap = 'x' if captured else ''
    return f"{piece_str}{cap}{to_file}{to_rank}"

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
